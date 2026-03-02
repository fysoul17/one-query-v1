'use client';

import '@xterm/xterm/css/xterm.css';
import { Copy, ExternalLink, LogIn, RefreshCw, RotateCcw, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { logoutBackend } from '@/lib/api';
import { RUNTIME_URL } from '@/lib/constants';

type LoginState = 'idle' | 'running' | 'success' | 'error' | 'cancelled';

interface CliLoginTerminalProps {
  /** Which backend this terminal logs into. */
  backendName: string;
  /** Whether the user is already authenticated via CLI login. */
  isAuthenticated?: boolean;
  onComplete?: () => void;
}

/** Per-backend configuration for the login terminal. */
const BACKEND_LOGIN_CONFIG: Record<
  string,
  { command: string; label: string; hint: string; trustedDomains: string[] }
> = {
  claude: {
    command: 'claude /login',
    label: 'Claude',
    hint: 'Click the link above to log in, then paste the code into the terminal. The terminal closes automatically when login is detected.',
    trustedDomains: [
      'console.anthropic.com',
      'anthropic.com',
      'claude.ai',
      'platform.claude.com',
      'accounts.google.com',
      'github.com',
      'login.microsoftonline.com',
    ],
  },
  codex: {
    command: 'codex login --device-auth',
    label: 'Codex',
    hint: 'Click the link above and enter the code shown in the terminal. Login completes automatically.',
    trustedDomains: [
      'auth0.openai.com',
      'auth.openai.com',
      'chat.openai.com',
      'openai.com',
      'platform.openai.com',
      'accounts.google.com',
      'login.microsoftonline.com',
      'github.com',
      'appleid.apple.com',
    ],
  },
  gemini: {
    command: 'gemini auth login',
    label: 'Gemini',
    hint: 'Click the link above to log in, then paste the verification code into the terminal.',
    trustedDomains: [
      'accounts.google.com',
      'myaccount.google.com',
      'cloud.google.com',
      'aistudio.google.com',
      'gemini.google.com',
      'login.microsoftonline.com',
    ],
  },
};

function getBackendConfig(backendName: string) {
  return (
    BACKEND_LOGIN_CONFIG[backendName] ?? {
      command: `${backendName} login`,
      label: backendName,
      hint: 'Follow the instructions in the terminal to complete login.',
      trustedDomains: [],
    }
  );
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC char needed for ANSI stripping
const URL_REGEX = /https?:\/\/[^\s"'<>\x1b]+/g;

/** Extract trusted login URLs from text (strips ANSI codes and line breaks first). */
function extractAuthUrl(text: string, trustedDomains: Set<string>): string | null {
  const clean = text
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC char needed for ANSI stripping
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    // Strip \r\n added by PTY line-wrapping — URLs span multiple terminal lines
    .replace(/[\r\n]+/g, '');
  const matches = clean.match(URL_REGEX);
  if (!matches) return null;
  for (const url of matches) {
    try {
      if (trustedDomains.has(new URL(url).hostname)) {
        return url;
      }
    } catch {
      // Malformed URL — skip
    }
  }
  return null;
}

/**
 * Xterm.js-based terminal that connects to the server's PTY via WebSocket.
 * The CLI gets a real TTY so interactive prompts (including auth code input) work.
 */
function XtermTerminal({
  backendName,
  onExit,
  onUrlDetected,
}: {
  backendName: string;
  onExit: (exitCode: number | null) => void;
  onUrlDetected: (url: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import('@xterm/xterm').Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    const config = getBackendConfig(backendName);
    const trustedDomains = new Set(config.trustedDomains);
    const wsUrl = `${RUNTIME_URL.replace(/^http/, 'ws')}/ws/terminal?backend=${encodeURIComponent(backendName)}`;

    (async () => {
      // Dynamic import to avoid SSR issues
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');

      if (disposed || !containerRef.current) return;

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 12,
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        theme: {
          background: '#0a0a0a',
          foreground: '#e5e5e5',
          cursor: '#e5e5e5',
          selectionBackground: '#3b82f680',
        },
        rows: 14,
        cols: 80,
        convertEol: true,
        scrollback: 500,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      fitAddon.fit();
      term.focus();
      termRef.current = term;

      // Connect WebSocket to server PTY
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        term.write(`\x1b[90m$ ${config.command}\x1b[0m\r\n`);
      };

      ws.onmessage = (event) => {
        let text: string;
        if (event.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(event.data);
          term.write(bytes);
          text = new TextDecoder().decode(bytes);
        } else {
          term.write(event.data);
          text = event.data;
        }
        // Detect auth URL in output
        const url = extractAuthUrl(text, trustedDomains);
        if (url) onUrlDetected(url);
      };

      ws.onclose = () => {
        if (!disposed) {
          onExit(0);
        }
      };

      ws.onerror = () => {
        term.write('\r\n\x1b[31mWebSocket connection failed\x1b[0m\r\n');
        onExit(1);
      };

      // Forward user keystrokes (including paste) to server PTY.
      // xterm.js natively handles paste via browser paste events and fires
      // onData with the pasted text — no custom handler needed.
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      // Handle resize
      resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
      });
      resizeObserver.observe(containerRef.current);
    })();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      wsRef.current?.close();
      wsRef.current = null;
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, [backendName, onExit, onUrlDetected]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Terminal container — keyboard events handled by xterm.js
    // biome-ignore lint/a11y/noStaticElementInteractions: Interactive terminal container
    <div
      ref={containerRef}
      className="rounded-md overflow-hidden border border-border/50 cursor-text"
      style={{ height: '260px' }}
      onClick={() => termRef.current?.focus()}
    />
  );
}

/** Clickable auth URL link with copy button. */
function AuthUrlLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // fallback: select text
      });
  }, [url]);

  return (
    <div className="flex items-center gap-2 rounded-md bg-blue-500/10 border border-blue-500/20 px-3 py-2">
      <ExternalLink className="h-3 w-3 shrink-0 text-blue-400" />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2 truncate min-w-0"
      >
        Open login page
      </a>
      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 text-blue-400 hover:text-blue-300 transition-colors"
        title="Copy URL"
      >
        <Copy className="h-3 w-3" />
      </button>
      {copied && <span className="text-[10px] text-blue-300 shrink-0">Copied!</span>}
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: terminal UI requires complex state management
export function CliLoginTerminal({
  backendName,
  isAuthenticated,
  onComplete,
}: CliLoginTerminalProps) {
  const [state, setState] = useState<LoginState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const config = getBackendConfig(backendName);

  const handleExit = useCallback(
    (exitCode: number | null) => {
      setState(exitCode === 0 ? 'success' : 'error');
      if (exitCode !== 0 && exitCode !== null) {
        setErrorMessage(`Process exited with code ${exitCode}`);
      }
      onComplete?.();
    },
    [onComplete],
  );

  const handleUrlDetected = useCallback((url: string) => {
    setAuthUrl(url);
  }, []);

  const doLogoutFirst = useCallback(async () => {
    try {
      await logoutBackend(backendName);
    } catch {
      // Ignore logout errors
    }
  }, [backendName]);

  const handleStart = useCallback(async () => {
    setErrorMessage(null);
    setAuthUrl(null);
    if (isAuthenticated) await doLogoutFirst();
    setState('running');
  }, [doLogoutFirst, isAuthenticated]);

  const handleClose = useCallback(() => {
    setState(authUrl ? 'success' : 'cancelled');
    onComplete?.();
  }, [authUrl, onComplete]);

  if (state === 'idle') {
    return (
      <Button variant="outline" size="sm" className="w-full text-xs" onClick={handleStart}>
        {isAuthenticated ? (
          <>
            <RefreshCw className="mr-1 h-3 w-3" />
            Switch Account
          </>
        ) : (
          <>
            <LogIn className="mr-1 h-3 w-3" />
            Login with {config.label}
          </>
        )}
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      {/* Clickable auth URL (blue link) */}
      {state === 'running' && authUrl && <AuthUrlLink url={authUrl} />}

      {/* Real PTY terminal via xterm.js */}
      {state === 'running' && (
        <XtermTerminal
          backendName={backendName}
          onExit={handleExit}
          onUrlDetected={handleUrlDetected}
        />
      )}

      {/* Hint */}
      {state === 'running' && authUrl && (
        <p className="text-[10px] text-muted-foreground">{config.hint}</p>
      )}

      {/* Status messages */}
      {state === 'success' && (
        <div className="text-xs text-green-400" role="alert">
          Login completed successfully.
        </div>
      )}
      {state === 'error' && (
        <div className="text-xs text-red-400" role="alert">
          {errorMessage ?? 'Login failed.'}
        </div>
      )}
      {state === 'cancelled' && (
        <output className="block text-xs text-muted-foreground">
          Login cancelled before completion.
        </output>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        {state === 'running' ? (
          <Button
            variant="outline"
            size="sm"
            className={`flex-1 text-xs ${authUrl ? '' : 'text-red-400 hover:text-red-300'}`}
            onClick={handleClose}
          >
            <Square className="mr-1 h-3 w-3" />
            {authUrl ? 'Done' : 'Cancel'}
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={handleStart}>
            <RotateCcw className="mr-1 h-3 w-3" />
            {state === 'success' ? 'Login Again' : 'Retry'}
          </Button>
        )}
      </div>
    </div>
  );
}
