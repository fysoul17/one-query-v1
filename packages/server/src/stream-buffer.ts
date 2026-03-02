const BUFFER_TTL_MS = 30_000; // 30 seconds TTL after completion
const CLEANUP_INTERVAL_MS = 15_000; // Cleanup check every 15 seconds

type StreamBufferStatus = 'streaming' | 'complete' | 'error' | 'abandoned';

/** Per-session in-memory buffer that decouples conductor streaming from WebSocket connections. */
export class StreamBuffer {
  accumulatedContent = '';
  status: StreamBufferStatus = 'streaming';
  completedAt?: number;
  readonly agentId: string;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  /** Track text content from chunk messages. */
  append(msg: object): void {
    const m = msg as { type?: string; content?: string };
    if (m.type === 'chunk' && typeof m.content === 'string') {
      this.accumulatedContent += m.content;
    }
  }

  markComplete(): void {
    this.status = 'complete';
    this.completedAt = Date.now();
  }

  markError(): void {
    this.status = 'error';
    this.completedAt = Date.now();
  }

  markAbandoned(): void {
    this.status = 'abandoned';
    this.completedAt = Date.now();
  }
}

/** Manages per-session stream buffers with TTL-based cleanup. */
export class SessionStreamBufferManager {
  private readonly buffers = new Map<string, StreamBuffer>();
  private readonly cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    // Don't keep the process alive just for cleanup
    if (
      typeof this.cleanupInterval === 'object' &&
      this.cleanupInterval !== null &&
      'unref' in this.cleanupInterval
    ) {
      (this.cleanupInterval as { unref(): void }).unref();
    }
  }

  getOrCreate(sessionId: string, agentId: string): StreamBuffer {
    const existing = this.buffers.get(sessionId);
    if (existing) return existing;
    const buffer = new StreamBuffer(agentId);
    this.buffers.set(sessionId, buffer);
    return buffer;
  }

  get(sessionId: string): StreamBuffer | undefined {
    return this.buffers.get(sessionId);
  }

  remove(sessionId: string): void {
    this.buffers.delete(sessionId);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [sessionId, buffer] of this.buffers) {
      if (
        buffer.status !== 'streaming' &&
        buffer.completedAt !== undefined &&
        now - buffer.completedAt > BUFFER_TTL_MS
      ) {
        this.buffers.delete(sessionId);
      }
    }
  }

  shutdown(): void {
    clearInterval(this.cleanupInterval);
    this.buffers.clear();
  }

  /** Exposed for testing. */
  get size(): number {
    return this.buffers.size;
  }
}
