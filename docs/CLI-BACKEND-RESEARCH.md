# CLI Backend Research — Session Persistence & Automation Capabilities

> Researched 2026-02-17. Covers all major AI CLI tools for backend wrapping feasibility.

---

## Key Discovery: Session Persistence in `claude -p`

### Finding

`claude -p` is **NOT stateless**. The `--session-id` and `--resume` flags enable full conversation persistence across invocations.

### Verified Behavior

| Flag | Behavior |
|------|----------|
| `--session-id <uuid>` | Creates a named session. Persists to `~/.claude/projects/.../UUID.jsonl`. Cannot reuse after creation — use `--resume` for follow-ups. |
| `--resume <uuid>` | Continues an existing session with **full conversation history**. All prior context is retained. |
| `--system-prompt` | Works on session creation. On resume, the original system prompt persists from the session file. |
| `--no-session-persistence` | Throwaway invocation — no file written. True stateless mode. |
| `--continue` | Resumes the most recent session in the current directory. |

### Isolation Test Results

```bash
# Session A: "I am Alice. My project is about rockets."
# Session B: "I am Bob. My project is about cooking."
#
# Resume A → "Your name is Alice and your project is about rockets."
# Resume B → "Your name is Bob and your project is about cooking."
#
# ✅ Zero cross-contamination between sessions.
```

### Session Files

Sessions persist as JSONL files at `~/.claude/projects/<project-hash>/<UUID>.jsonl`. They contain full conversation turns, tool calls, and responses.

### Architecture Implication

This enables **per-workspace stateful Conductor** without multiple processes:

```
Conductor (one claude -p backend)
    │
    ├── Workspace: "Engineering"
    │     session-id: uuid-eng-xxx
    │     --resume uuid-eng-xxx on each message
    │     Full conversation history retained
    │
    └── Workspace: "Personal"
          session-id: uuid-personal-xxx
          Completely isolated conversation history
```

Two layers of memory per workspace:
1. **Session memory** (free, via `--resume`) — full conversation history
2. **RAG memory** (our Memory system) — long-term semantic search, scoped by workspace namespace

---

## CLI Backend Comparison Matrix

### Tier 1: Production-Ready Backends (Full Automation Support)

| Capability | Claude CLI | Codex CLI | Gemini CLI | Goose |
|---|---|---|---|---|
| **Binary** | `claude` | `codex` | `gemini` | `goose` |
| **Runtime** | Node.js | Rust | Node.js | Rust |
| **Package** | `@anthropic-ai/claude-code` | `@openai/codex` | `@google/gemini-cli` | `goose-ai` (binary) |
| **Non-interactive flag** | `-p` | `exec` subcommand | `-p` | `run -t "..."` |
| **Stdin pipe** | Yes (direct pipe) | `-` argument | Yes (direct pipe) | `-i -` flag |
| **Stdout output** | Text (default) | Text (stderr=progress, stdout=response) | Text (default) | Text (default) |
| **Streaming JSON** | `--output-format stream-json` | `--json` (JSONL events) | `--output-format stream-json` | `--output-format stream-json` |
| **System prompt** | `--system-prompt "..."` | `-c 'model_instructions_file=...'` or `developer_instructions` | `GEMINI_SYSTEM_MD` env var (file path) | `--system "..."` |
| **Session create** | `--session-id <uuid>` | Auto (persisted by default) | Auto (per-project) | `--name <name>` / `--session-id` |
| **Session resume** | `--resume <uuid>` | `exec resume <id>` or `--last` | `--resume <id\|index\|latest>` | `--resume` / `-r` |
| **Session list** | N/A (file-based) | N/A | `--list-sessions` | `session list` |
| **No persistence** | `--no-session-persistence` | `--ephemeral` | N/A | `--no-session` |
| **Skip permissions** | `--dangerously-skip-permissions` | `--yolo` / `--full-auto` | `--approval-mode=yolo` | `GOOSE_MODE=auto` |
| **Model selection** | `--model <name>` | `-m <name>` | `-m <name>` / `GEMINI_MODEL` | `GOOSE_MODEL` env var |
| **Tool filtering** | `--allowedTools` / `--disallowedTools` | `--enable` / `--disable` | `--allowed-tools` | N/A (extension-based) |
| **Working dir** | `--add-dir` | `--cd` / `-C` | `--include-directories` | N/A |
| **Sandbox** | N/A (permission flags) | `--sandbox read-only\|workspace-write` | `--sandbox` (Docker/Podman) | N/A |
| **Auth env var** | `ANTHROPIC_API_KEY` | `CODEX_API_KEY` | `GEMINI_API_KEY` | `GOOSE_PROVIDER` + provider key |
| **Default model** | Claude Opus/Sonnet | GPT-5.3 Codex | Gemini 3 (auto) | Configurable (any provider) |
| **SDK available** | N/A | `@openai/codex-sdk` | N/A | N/A |
| **ACP support** | N/A | N/A | N/A | `goose acp` (stdio/TCP) |

### Tier 2: Viable with Limitations

| Capability | Copilot CLI | Cline CLI | Aider | Amazon Q CLI |
|---|---|---|---|---|
| **Binary** | `copilot` / `gh copilot` | `cline` | `aider` | `q` |
| **Runtime** | Node.js/Go | Node.js | Python | Rust |
| **Non-interactive** | `-p "..."` | `cline "..." -y` | `--message "..."` | `--no-interactive` |
| **Stdin pipe** | Yes | Yes | No | `--stdin` |
| **Streaming JSON** | `--stream on/off` (no JSON) | `--json` (NDJSON) | No | No |
| **System prompt** | No flag | No flag | No flag (conventions file) | No flag (prompt profiles) |
| **Session resume** | `--resume` / `--continue` | No | `--restore-chat-history` (partial) | `--resume` |
| **Skip permissions** | `--allow-all-tools` | `-y` / `--yolo` | `--yes-always` | `--trust-all-tools` |
| **Auth** | `GH_TOKEN` | API key in config | API key in env/config | AWS Builder ID (browser!) |
| **ACP support** | `--acp` (stdio/TCP) | `--acp` | No | No |
| **Key limitation** | No system prompt, no JSON output | No session persistence | No stdin, no JSON output | Browser auth required |

### Tier 3: Not Viable as Backend

| Tool | Reason |
|------|--------|
| **MiniMax Mini-Agent** | Interactive-only, no non-interactive mode, no stdin/stdout protocol, demo project |
| **Cursor CLI** | No stdin pipe support (critical gap), closed-source, beta, subscription-locked |
| **Continue CLI** | Minimal headless mode, no JSON output, no system prompt, sparse docs |

---

## Detailed Backend Profiles

### Claude CLI (`claude`)

**Spawn pattern:**
```bash
claude -p "message" \
  --session-id <uuid>          # first message (creates session)
  --system-prompt "You are..." \
  --dangerously-skip-permissions \
  --output-format stream-json
```

**Resume pattern:**
```bash
claude -p "follow-up" \
  --resume <uuid>              # subsequent messages
  --dangerously-skip-permissions \
  --output-format stream-json
```

**Implementation**: All spawn/resume patterns above are implemented in `packages/agent-manager/src/backends/claude.ts` including `--session-id`, `--resume`, and `--output-format stream-json`.

---

### Codex CLI (`codex`)

**Spawn pattern:**
```bash
codex exec \
  --json \                              # JSONL event stream on stdout
  --full-auto \                         # workspace-write + on-request approval
  --skip-git-repo-check \
  --color never \
  -c 'developer_instructions=You are...' \
  "message"
```

**Resume pattern:**
```bash
codex exec resume <session-id> "follow-up message"
```

**JSONL event types:** `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.*`, `error`

**Key differences from Claude:**
- `exec` subcommand (not `-p` flag)
- System prompt via config override, not CLI flag
- Built-in sandbox modes (`read-only`, `workspace-write`, `danger-full-access`)
- Written in Rust — faster startup, lower memory
- Has an SDK (`@openai/codex-sdk`) for programmatic use without CLI spawning

---

### Gemini CLI (`gemini`)

**Spawn pattern:**
```bash
GEMINI_SYSTEM_MD=/path/to/prompt.md \
gemini -p "message" \
  --output-format stream-json \
  --approval-mode=yolo
```

**Resume pattern:**
```bash
GEMINI_SYSTEM_MD=/path/to/prompt.md \
gemini -p "follow-up" \
  --resume latest \        # or specific index/UUID
  --output-format stream-json \
  --approval-mode=yolo
```

**Stream-JSON event types:** `init`, `message`, `tool_use`, `tool_result`, `result`

**Key differences from Claude:**
- System prompt via `GEMINI_SYSTEM_MD` env var pointing to a .md file (no CLI flag)
- Session resume by index, UUID, or `"latest"`
- `--list-sessions` for session discovery
- Built-in Docker/Podman sandbox mode
- Model auto-selection by task complexity

---

### Goose (`goose`)

**Spawn pattern:**
```bash
GOOSE_MODE=auto \
GOOSE_PROVIDER=anthropic \
GOOSE_MODEL=claude-sonnet-4-20250514 \
goose run \
  -i - \                        # read from stdin
  -q \                          # quiet mode (clean stdout)
  --output-format stream-json \
  --system "You are..." \
  --name my-agent \             # named session
  --max-turns 100
```

**Resume pattern:**
```bash
goose run --resume --name my-agent -i - -q --output-format stream-json
```

**Key differences from Claude:**
- Stdin via `-i -` flag (not direct pipe)
- Quiet mode (`-q`) suppresses non-response output
- Named sessions (`--name`) in addition to UUIDs
- `--system` flag for inline system prompt
- Provider-agnostic: any LLM via `GOOSE_PROVIDER` + `GOOSE_MODEL`
- Recipe system (YAML workflows)
- ACP server mode (`goose acp`) for formal programmatic interface

---

## Current Backend Capabilities

The capability matrix in `packages/shared/src/constants/capabilities.ts` reflects what the template's backend implementations actually support (conservative values — not raw CLI capability):

| Backend | Custom Tools | Streaming | Session Persistence | File Access |
|---------|-------------|-----------|-------------------|-------------|
| Claude | Yes | Yes | Yes | Yes |
| Codex | Yes | Yes | Yes | Yes |
| Gemini | Yes | Yes | Yes | No |
| Pi | No | Yes | Yes | No |
| Ollama | Yes | Yes | No | No |

> **Note:** Pi does not support custom tools as it's a multi-provider gateway where tool support depends on the underlying provider.

**Tier 2 candidates (not yet implemented):** Goose, Copilot, Cline, Aider

---

## Backend Viability Ranking

| Rank | Backend | Tier | Session | Stdin | JSON Stream | System Prompt | Overall |
|------|---------|------|---------|-------|-------------|---------------|---------|
| 1 | **Claude** | 1 | `--resume <uuid>` | Direct pipe | `stream-json` | `--system-prompt` | Best overall. Our default. |
| 2 | **Goose** | 1 | `--name` / `--resume` | `-i -` | `stream-json` | `--system "..."` | Best automation design. Provider-agnostic. |
| 3 | **Codex** | 1 | `exec resume <id>` | `-` argument | `--json` JSONL | `-c 'developer_instructions=...'` | Strong. Rust-fast. Has SDK. |
| 4 | **Gemini** | 1 | `--resume <id>` | Direct pipe | `stream-json` | `GEMINI_SYSTEM_MD` env var | Good. System prompt via env var is awkward. |
| 5 | **Copilot** | 2 | `--resume` / `--continue` | Pipe supported | No JSON format | No flag | GitHub-native. Missing structured output. |
| 6 | **Cline** | 2 | None | Pipe supported | `--json` NDJSON | No flag | No session persistence. |
| 7 | **Aider** | 2 | Partial (`--restore`) | No stdin pipe | None | No flag | One-shot only via `--message`. |
| 8 | **Amazon Q** | 2 | `--resume` | `--stdin` | None | No flag | Browser auth required — no headless. |

---

## Implementation Recommendations

> **Status (2026-02-28):** Phases 1–4 are complete. The template ships with 5 backends:
> Claude, Codex, Gemini, Pi, and Ollama. Goose was evaluated but not included —
> Pi (multi-provider gateway) and Ollama (local LLM) were chosen instead for broader
> coverage without adding a 6th CLI dependency.

### Phase 1: Fix Current Backend (Claude) — ✅ Done

Session support added to `ClaudeBackend`:
- `sessionId` in `BackendSpawnConfig`
- First `send()` uses `--session-id <uuid>`
- Subsequent `send()` calls use `--resume <uuid>`
- `sessionCreated` boolean tracked in `ClaudeProcess`

### Phase 2: Add Codex Backend — ✅ Done

- `codex exec --json` for JSONL streaming
- `exec resume <id>` for session continuity

### Phase 3: Add Gemini Backend — ✅ Done

- `gemini -p` with `--output-format stream-json`
- System prompt via `GEMINI_SYSTEM_MD` env var
- `--resume` for session continuity

### Phase 4: Add Pi + Ollama Backends — ✅ Done

- **Pi**: Multi-provider gateway (`PI_API_KEY` + `PI_MODEL`)
- **Ollama**: Local HTTP-based LLM (`OLLAMA_BASE_URL` + `OLLAMA_MODEL`)

### Phase 5: Tier 2 Backends (Community)

Copilot, Cline, Aider — implement as community-contributed backends via plugin SDK.

### Not Implemented: Goose

Goose was researched and documented above as a strong Tier 1 candidate. It was not included because:
- Pi already covers the "provider-agnostic" use case via its multi-provider gateway
- Ollama covers the "local LLM" use case without external dependencies
- Adding a 6th backend adds maintenance burden with diminishing returns for a template

---

## Spawn Pattern Reference (Copy-Paste)

### Claude
```bash
# Create session
claude -p "msg" --session-id UUID --system-prompt "..." --dangerously-skip-permissions --output-format stream-json

# Resume session
claude -p "msg" --resume UUID --dangerously-skip-permissions --output-format stream-json

# Ephemeral (no session)
claude -p "msg" --no-session-persistence --system-prompt "..." --dangerously-skip-permissions
```

### Codex
```bash
# Create session
codex exec --json --full-auto --skip-git-repo-check --color never -c 'developer_instructions=...' "msg"

# Resume session
codex exec resume SESSION_ID --json --full-auto "follow-up msg"

# Ephemeral
codex exec --ephemeral --json --full-auto "msg"
```

### Gemini
```bash
# Create session
GEMINI_SYSTEM_MD=/tmp/prompt.md gemini -p "msg" --output-format stream-json --approval-mode=yolo

# Resume session
gemini -p "msg" --resume latest --output-format stream-json --approval-mode=yolo

# List sessions
gemini --list-sessions
```

### Goose
```bash
# Create named session
GOOSE_MODE=auto goose run -i - -q --output-format stream-json --system "..." --name agent-1 <<< "msg"

# Resume session
GOOSE_MODE=auto goose run --resume --name agent-1 -i - -q --output-format stream-json <<< "msg"

# No session
GOOSE_MODE=auto goose run --no-session -i - -q --output-format stream-json --system "..." <<< "msg"
```
