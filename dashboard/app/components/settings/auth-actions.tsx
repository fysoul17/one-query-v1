'use client';

import type { BackendStatus } from '@autonomy/shared';
import { ChevronDown, ChevronUp, Key, LogOut } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { logoutBackend, updateBackendApiKey } from '@/lib/api';
import { getErrorMessage } from '@/lib/utils';
import { CliLoginTerminal } from './cli-login-terminal';

interface AuthActionsProps {
  backend: BackendStatus;
  onAuthChange: () => void;
}

/** Per-backend placeholder and label for API key input. */
const API_KEY_META: Record<string, { placeholder: string; label: string; description: string }> = {
  claude: {
    placeholder: 'sk-ant-...',
    label: 'Anthropic API key',
    description: 'Set an API key to use this provider.',
  },
  codex: {
    placeholder: 'sk-...',
    label: 'OpenAI API key',
    description: 'Enter your OpenAI API key to use Codex.',
  },
  gemini: {
    placeholder: 'AIza...',
    label: 'Google API key',
    description: 'Enter your Google API key to use Gemini.',
  },
};

/** CLI product names — intentionally different from display labels (e.g. "Claude Code" vs "Claude"). */
const CLI_PRODUCT_NAMES: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
};

function getKeyMeta(backendName: string) {
  return (
    API_KEY_META[backendName] ?? {
      placeholder: '...',
      label: 'API key',
      description: 'Enter your API key.',
    }
  );
}

function getCliProductName(backendName: string) {
  return CLI_PRODUCT_NAMES[backendName] ?? backendName;
}

function ApiKeyInput({
  value,
  onChange,
  onSave,
  saving,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  saving: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <div className="flex gap-2">
      <Input
        type="password"
        placeholder={placeholder ?? 'sk-ant-...'}
        aria-label={ariaLabel ?? 'API key'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-xs"
        onKeyDown={(e) => e.key === 'Enter' && onSave()}
      />
      <Button size="sm" className="h-8 text-xs" disabled={saving || !value.trim()} onClick={onSave}>
        {saving ? 'Saving...' : 'Save'}
      </Button>
    </div>
  );
}

function useApiKeyActions(backendName: string, onAuthChange: () => void) {
  const [showForm, setShowForm] = useState(false);
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!apiKeyValue.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await updateBackendApiKey(backendName, apiKeyValue.trim());
      setApiKeyValue('');
      setShowForm(false);
      onAuthChange();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to update API key'));
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setSaving(true);
    setError(null);
    try {
      await updateBackendApiKey(backendName, null);
      onAuthChange();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to clear API key'));
    } finally {
      setSaving(false);
    }
  }

  return {
    showForm,
    setShowForm,
    apiKeyValue,
    setApiKeyValue,
    saving,
    error,
    handleSave,
    handleClear,
  };
}

// ---- Shared: API key already set (change / clear) ----

function ApiKeyModeActions({
  backendName,
  onAuthChange,
}: {
  backendName: string;
  onAuthChange: () => void;
}) {
  const {
    showForm,
    setShowForm,
    apiKeyValue,
    setApiKeyValue,
    saving,
    error,
    handleSave,
    handleClear,
  } = useApiKeyActions(backendName, onAuthChange);
  const [confirmClear, setConfirmClear] = useState(false);
  const meta = getKeyMeta(backendName);

  return (
    <div className="space-y-2 border-t border-border/50 pt-3">
      {error && (
        <div className="text-xs text-red-400" role="alert">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs"
          disabled={saving}
          aria-expanded={showForm}
          onClick={() => setShowForm(!showForm)}
        >
          <Key className="mr-1 h-3 w-3" />
          Change Key
        </Button>
        {!confirmClear ? (
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs text-red-400 hover:text-red-300"
            disabled={saving}
            onClick={() => setConfirmClear(true)}
          >
            Clear Key
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs text-red-400 hover:text-red-300 border-red-500/30"
            disabled={saving}
            onClick={() => {
              handleClear();
              setConfirmClear(false);
            }}
            onBlur={() => setConfirmClear(false)}
          >
            {saving ? 'Clearing...' : 'Confirm Clear'}
          </Button>
        )}
      </div>
      {showForm && (
        <ApiKeyInput
          value={apiKeyValue}
          onChange={setApiKeyValue}
          onSave={handleSave}
          saving={saving}
          placeholder={meta.placeholder}
          ariaLabel={meta.label}
        />
      )}
    </div>
  );
}

// ---- CLI authenticated (any backend with CLI login) ----

function CliAuthenticatedActions({
  backendName,
  onAuthChange,
}: {
  backendName: string;
  onAuthChange: () => void;
}) {
  const {
    showForm,
    setShowForm,
    apiKeyValue,
    setApiKeyValue,
    saving,
    error: keyError,
    handleSave,
  } = useApiKeyActions(backendName, onAuthChange);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const meta = getKeyMeta(backendName);

  async function handleLogout() {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await logoutBackend(backendName);
      onAuthChange();
    } catch (err) {
      setLogoutError(getErrorMessage(err, 'Logout failed'));
    } finally {
      setLoggingOut(false);
    }
  }

  const displayError = logoutError ?? keyError;

  return (
    <div className="space-y-2 border-t border-border/50 pt-3">
      {displayError && (
        <div className="text-xs text-red-400" role="alert">
          {displayError}
        </div>
      )}
      <Button
        variant="outline"
        size="sm"
        className="w-full text-xs text-red-400 hover:text-red-300"
        disabled={loggingOut}
        onClick={handleLogout}
      >
        <LogOut className="mr-1 h-3 w-3" />
        {loggingOut ? 'Logging out...' : 'Logout'}
      </Button>
      <CliLoginTerminal backendName={backendName} isAuthenticated onComplete={onAuthChange} />
      <button
        type="button"
        className="flex w-full items-center justify-between text-xs text-muted-foreground hover:text-foreground/70 transition-colors"
        aria-expanded={showForm}
        onClick={() => setShowForm(!showForm)}
      >
        <span>Or use API key instead</span>
        {showForm ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {showForm && (
        <ApiKeyInput
          value={apiKeyValue}
          onChange={setApiKeyValue}
          onSave={handleSave}
          saving={saving}
          placeholder={meta.placeholder}
          ariaLabel={meta.label}
        />
      )}
    </div>
  );
}

// ---- CLI not found (any backend) ----

function NoCliAvailableActions({
  backendName,
  onAuthChange,
}: {
  backendName: string;
  onAuthChange: () => void;
}) {
  const { showForm, setShowForm, apiKeyValue, setApiKeyValue, saving, error, handleSave } =
    useApiKeyActions(backendName, onAuthChange);
  const meta = getKeyMeta(backendName);
  const label = getCliProductName(backendName);

  return (
    <div className="space-y-2 border-t border-border/50 pt-3">
      {error && (
        <div className="text-xs text-red-400" role="alert">
          {error}
        </div>
      )}
      <div className="text-xs text-muted-foreground">
        {label} CLI not found. Set an API key to use this provider.
      </div>
      <button
        type="button"
        className="flex w-full items-center justify-between text-xs text-muted-foreground hover:text-foreground/70 transition-colors"
        aria-expanded={showForm}
        onClick={() => setShowForm(!showForm)}
      >
        <span>Set API key</span>
        {showForm ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {showForm && (
        <ApiKeyInput
          value={apiKeyValue}
          onChange={setApiKeyValue}
          onSave={handleSave}
          saving={saving}
          placeholder={meta.placeholder}
          ariaLabel={meta.label}
        />
      )}
    </div>
  );
}

// ---- CLI available but not authenticated (any backend) ----

function CliNotAuthenticatedActions({
  backendName,
  onAuthChange,
}: {
  backendName: string;
  onAuthChange: () => void;
}) {
  const { showForm, setShowForm, apiKeyValue, setApiKeyValue, saving, error, handleSave } =
    useApiKeyActions(backendName, onAuthChange);
  const meta = getKeyMeta(backendName);

  return (
    <div className="space-y-2 border-t border-border/50 pt-3">
      {error && (
        <div className="text-xs text-red-400" role="alert">
          {error}
        </div>
      )}
      <CliLoginTerminal backendName={backendName} onComplete={onAuthChange} />
      <button
        type="button"
        className="flex w-full items-center justify-between text-xs text-muted-foreground hover:text-foreground/70 transition-colors"
        aria-expanded={showForm}
        onClick={() => setShowForm(!showForm)}
      >
        <span>Or use API key instead</span>
        {showForm ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {showForm && (
        <ApiKeyInput
          value={apiKeyValue}
          onChange={setApiKeyValue}
          onSave={handleSave}
          saving={saving}
          placeholder={meta.placeholder}
          ariaLabel={meta.label}
        />
      )}
    </div>
  );
}

// ---- Main dispatcher ----

/** Backends that support CLI subscription login. */
const CLI_LOGIN_BACKENDS = new Set(['claude', 'codex', 'gemini']);

export function AuthActions({ backend, onAuthChange }: AuthActionsProps) {
  // CLI-capable backends (Claude, Codex, Gemini): full flow (CLI login + API key fallback)
  if (CLI_LOGIN_BACKENDS.has(backend.name)) {
    if (backend.authMode === 'api_key') {
      return <ApiKeyModeActions backendName={backend.name} onAuthChange={onAuthChange} />;
    }
    if (backend.authMode === 'cli_login') {
      return <CliAuthenticatedActions backendName={backend.name} onAuthChange={onAuthChange} />;
    }
    if (!backend.available) {
      return <NoCliAvailableActions backendName={backend.name} onAuthChange={onAuthChange} />;
    }
    return <CliNotAuthenticatedActions backendName={backend.name} onAuthChange={onAuthChange} />;
  }

  // Fallback for unknown backends: API key only
  if (backend.authMode === 'api_key') {
    return <ApiKeyModeActions backendName={backend.name} onAuthChange={onAuthChange} />;
  }
  return <NoCliAvailableActions backendName={backend.name} onAuthChange={onAuthChange} />;
}
