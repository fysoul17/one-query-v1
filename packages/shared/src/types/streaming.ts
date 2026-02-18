export interface StreamEvent {
  type: 'chunk' | 'complete' | 'error';
  content?: string;
  error?: string;
}
