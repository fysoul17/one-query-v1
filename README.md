<div align="center">

# Agent Forge

### Autonomous AI Agent Runtime

Turn any CLI AI tool into an autonomous agent system.<br>
Persistent memory. Pluggable backends. Cyberpunk dashboard.

[Quick Start](#quick-start) &bull; [Architecture](#architecture) &bull; [Features](#features) &bull; [Development](#development)

</div>

---

## What is this?

An open-source **runtime template** that wraps CLI AI tools (`claude -p`, Codex CLI, Gemini CLI) into an agent system with:

- A **Conductor** — AI agent that responds to messages, searches memory for context, and delegates to specialist agents
- An **Agent Pool** of AI agents with pluggable backends (per-agent backend selection)
- **Persistent Memory** via [pyx-memory](https://github.com/fysoul17/pyx-memory-v1) — vector search (LanceDB), structured storage (SQLite), Graph RAG (Neo4j), and file ingestion. Connects as a sidecar via `MemoryClient`.
- A real-time **Cyberpunk Dashboard** with streaming chat, agent management, and debug console
- **Scheduled tasks** via Cron Manager

**This is not a product. It's the engine.** Fork it, add your agent definitions and domain data, ship your product.

```
              This Template (Engine)
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
   ┌─────────┐  ┌──────────┐  ┌──────────┐
   │  Your   │  │  Your    │  │  Your    │
   │  OaaS   │  │  QA Team │  │  Content │
   │ Product │  │ Product  │  │ Product  │
   └─────────┘  └──────────┘  └──────────┘
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                    Runtime Container (Bun)                            │
│                                                                      │
│  ┌────────────────┐    ┌──────────────────────────────────────────┐  │
│  │   Bun.serve    │    │       Conductor (AI Agent)               │  │
│  │   HTTP + WS    │───▶│                                          │  │
│  │                │    │  ┌────────────┐  ┌───────────────────┐   │  │
│  │  /health       │    │  │  Memory    │  │  AI Response      │   │  │
│  │  /api/*        │    │  │  Search    │  │  (CLIBackend)     │   │  │
│  │  /ws/chat      │    │  └────────────┘  └───────────────────┘   │  │
│  │  /ws/debug     │    │         │                                │  │
│  └────────────────┘    │         ▼                                │  │
│                        │  ┌─────────────┐     ┌──────────────┐    │  │
│                        │  │ Agent Pool  │     │    Memory     │    │  │
│                        │  │             │     │              │    │  │
│                        │  │ Agent #1    │     │ pyx-memory   │    │  │
│                        │  │ Agent #2    │     │ (sidecar via │    │  │
│                        │  │ Agent #N    │     │ MemoryClient)│    │  │
│                        │  └─────────────┘     └──────────────┘    │  │
│                        └──────────────────────────────────────────┘  │
│                                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────────┐  │
│  │  DebugBus   │  │ ActivityLog  │  │       Cron Manager         │  │
│  └─────────────┘  └──────────────┘  └────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                  Dashboard (Next.js 16.1)                             │
│  ┌──────┐ ┌────────┐ ┌──────┐ ┌──────────┐ ┌────────┐ ┌──────────┐ │
│  │ Home │ │ Agents │ │ Chat │ │ Activity │ │ Memory │ │Automation│ │
│  │ SSR  │ │  CRUD  │ │  WS  │ │  Debug   │ │Browser │ │  Crons   │ │
│  └──────┘ └────────┘ └──────┘ └──────────┘ └────────┘ └──────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### Conductor Pipeline

Every message flows through a simple pipeline:

```
Message In ──▶ Memory Search ──▶ Respond or Delegate ──▶ Memory Store ──▶ Response Out
                 (context)       (AI backend / agent)     (if valuable)    (stream WS)
```

The Conductor is a simple AI agent: it searches memory for context, then either responds directly via its AI backend or delegates to a specific agent when `targetAgentId` is set.

---

## Features

### Pluggable AI Backends
Swap AI providers without changing code. `claude -p` is the default. Codex CLI, Gemini CLI, Pi, and Ollama slot in via the `CLIBackend` interface. Each agent can use a different backend via the BackendRegistry. Custom tool support is wired up for Claude (`--allowed-tools`), Codex (`--enable`), Gemini (`--allowed-tools`), and Ollama (API `tools` parameter).

### Persistent Memory (pyx-memory)
Memory is powered by [pyx-memory](https://github.com/fysoul17/pyx-memory-v1), extracted as a standalone repo and consumed via git submodule at `vendor/pyx-memory`. Provides structured data in bun:sqlite (WAL mode) + vector embeddings in LanceDB + four RAG strategies (Hybrid, Graph, Agentic, Naive). The runtime connects to pyx-memory as a **sidecar** (standalone HTTP service) via `MemoryClient` when `MEMORY_URL` is configured. Memory persists across sessions and agent restarts.

### Agent Lifecycle Management
Full CRUD for AI agents with serial message queues, idle timeout auto-shutdown, configurable pool limits, session persistence (`--resume` flags), and ownership-based permissions (user-created vs conductor-created agents).

### Real-time Dashboard
Cyberpunk-themed Next.js dashboard with glass-morphism cards, neon accents, and scanline effects. SSR for initial load, WebSocket for live updates. Includes streaming chat, agent cards with backend/status badges, and a full debug console.

### Observability Built In
DebugBus (ring buffer + pub/sub) streams events across 5 categories (conductor, agent, memory, websocket, system) to a filterable debug console with pause/resume, search, and JSON expansion.

### Pipeline Visualization
See exactly how the Conductor processes each message: which phase it's in, timing data per step — all rendered live in the chat UI.

### Plugin System
Event hooks and middleware pipeline for customizing behavior without modifying core source. 8 hook points (`onBeforeMessage`, `onAfterResponse`, `onBeforeAgentCreate`, etc.) with waterfall data flow, priority ordering, and error isolation. Plugins register declaratively via `PluginManager`.

### Session Management
Full conversation history with browse, resume, and delete. Sessions track messages per agent, persist across restarts, and integrate with WebSocket chat for seamless session continuity.

### Production Hardening
IP-based rate limiting (configurable window + max), structured JSON logging with log levels, and a standardized streaming contract across all AI backends. Ready for deployment behind a reverse proxy.

### CI/CD Pipeline
3-job GitHub Actions workflow: quality gate (lint + typecheck + unit tests), E2E integration tests (27 end-to-end scenarios), and Docker build verification. Runs on push to main and PRs.

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.2+
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) (for the default `claude -p` backend)

### Development Mode

```bash
# Clone (include submodules for pyx-memory)
git clone --recurse-submodules https://github.com/fysoul17/agent-forge.git
cd agent-forge

# Or if already cloned without submodules:
git submodule update --init --recursive

# Install dependencies
bun install

# Start everything (runtime + dashboard)
bun run dev

# Or start individually
bun run dev:runtime    # Runtime server on :7820
bun run dev:dashboard  # Dashboard on :7821
```

### Docker

```bash
# Minimal — runtime (:7820) + dashboard (:7821)
docker compose -f docker/docker-compose.yaml up

# Rebuild images after code changes
docker compose -f docker/docker-compose.yaml up --build

# Full stack — adds memory server (:7822) + Neo4j (:7474/:7687)
docker compose -f docker/docker-compose.yaml --profile full up

# Detached mode (background)
docker compose -f docker/docker-compose.yaml up -d

# Stop everything
docker compose -f docker/docker-compose.yaml down
```

**Environment variables** (optional, set in `.env` or pass inline):

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_BACKEND` | `claude` | AI backend (`claude`, `codex`, `gemini`, `pi`, `ollama`) |
| `FALLBACK_BACKEND` | *(empty)* | Fallback if primary fails to spawn |
| `ANTHROPIC_API_KEY` | *(empty)* | API key for Claude CLI |
| `CODEX_API_KEY` | *(empty)* | API key for OpenAI Codex CLI |
| `GEMINI_API_KEY` | *(empty)* | API key for Google Gemini CLI |
| `PI_API_KEY` | *(empty)* | API key for Pi backend |
| `PI_MODEL` | *(empty)* | Pi model override (e.g., `openai/gpt-4.1`) |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API URL (no key needed) |
| `MAX_AGENTS` | `10` | Maximum concurrent agents |

See `.env.example` for all variables, or [`docs/SPEC.md` Section 12](docs/SPEC.md#12-environment-variables) for the full reference.

### Run Tests

```bash
bun run test           # All packages
bun run typecheck      # TypeScript checking
bun run lint           # Biome linting
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun + TypeScript |
| Monorepo | Bun workspaces + Turborepo v2 |
| Frontend | Next.js 16.1 + Tailwind CSS 4 + shadcn/ui |
| Backend | Bun.serve (HTTP + WebSocket) |
| Structured DB | bun:sqlite (embedded, WAL mode) |
| Vector DB | LanceDB (embedded) |
| AI Backend | `claude -p` (default), pluggable |
| Linter | Biome 2.4+ |
| Tests | bun:test |

---

## Project Structure

```
agent-forge/
├── packages/
│   ├── shared/          # Types, interfaces, constants
│   ├── agent-manager/   # CLIBackend, AgentProcess, AgentPool, BackendRegistry
│   ├── conductor/       # Simple AI agent with memory + delegation
│   ├── cron-manager/    # Scheduled tasks
│   ├── plugin-system/   # Event hooks, middleware pipeline, plugin manager
│   └── server/          # Bun.serve HTTP + WebSocket + routes + agent store
├── vendor/
│   └── pyx-memory/      # Git submodule → fysoul17/pyx-memory-v1
│       └── packages/
│           ├── shared/  # Memory types (@pyx-memory/shared)
│           ├── client/  # MemoryInterface + HTTP client (@pyx-memory/client)
│           └── core/    # SQLite + LanceDB + RAG + embeddings (@pyx-memory/core)
├── dashboard/           # Next.js 16.1 cyberpunk dashboard
├── docker/              # Dockerfile.runtime, Dockerfile.dashboard, docker-compose.yaml
├── package.json         # Monorepo root
├── turbo.json           # Turborepo config
└── biome.json           # Linter config
```

### Package Dependencies

```
@autonomy/shared             @pyx-memory/shared
       │                            │
       ├──▶ @autonomy/agent-manager │
       │                     @pyx-memory/client ◀── MemoryInterface contract
       │                            │
       │                     @pyx-memory/core   ◀── Memory, RAG, embeddings
       │                            │
       ├──▶ @autonomy/conductor ────┘ (uses @pyx-memory/client)
       ├──▶ @autonomy/cron-manager
       └──▶ @autonomy/plugin-system (hooks, middleware)
                    │
                    ▼
             @autonomy/server  ◀── uses @pyx-memory/client (sidecar)
                    │                  or DisabledMemory (no-op)
                    │                  + AgentStore (bun:sqlite)
                    ▼
               dashboard (HTTP + WS)
```

---

## Development

```bash
# Install
bun install

# Development (all packages + dashboard)
bun run dev

# Individual packages
bun run dev:runtime          # Server only
bun run dev:dashboard        # Dashboard only

# Testing
bun run test                 # All tests
bun test packages/conductor  # Single package

# Code quality
bun run lint                 # Check
bun run lint:fix             # Auto-fix
bun run typecheck            # Type checking
```

### API & WebSocket

REST endpoints across route groups: agents, memory (search + lifecycle + graph + paginated listing), sessions, crons, config, backends, activity, and health.

3 WebSocket endpoints: `/ws/chat` (streaming chat), `/ws/debug` (event stream), `/ws/terminal` (PTY-based CLI login).

See [`docs/SPEC.md` Section 10-11](docs/SPEC.md#10-rest-api) for the full endpoint reference.

### Dashboard Pages

| Path | Description |
|------|-------------|
| `/` | Home — system health, agent stats, memory stats |
| `/agents` | Agent management — CRUD, status badges, backend selection |
| `/chat` | Real-time chat with streaming + pipeline visualization |
| `/memory` | Memory browser — search, filter, file upload, graph stats |
| `/automation` | Cron management — create, edit, trigger scheduled tasks |
| `/activity` | Debug console — live event stream, filters, search |
| `/sessions` | Session browser — browse, resume, delete conversations |
| `/settings` | Runtime configuration — AI backend, max agents, etc. |
| `/settings/providers` | Backend credential management — API keys, OAuth login/logout |

---

## Future

Community extension points — not part of the core template:

- **Channel Adapters** — Telegram, Discord, Slack webhook handlers
- **Community Backends** — Copilot, Cline, Aider via the `CLIBackend` interface
- **Organization Templates** — YAML-based agent team definitions

---

## Extending the Template

This template is designed to be forked and extended. Products add:

1. **Custom Conductor logic** — routing, permissions, personality, question tracking
2. **Agent definitions** — roles, prompts, tools
3. **Domain data** — ingest into memory via API or dashboard
4. **Channel adapters** — webhook handlers for messaging platforms
5. **Additional dashboard pages** — product-specific UI
6. **Organization templates** — YAML-based agent team definitions

---

## Contributing

Contributions welcome. Please read the spec at `docs/SPEC.md` before contributing.

```bash
# Fork, clone, create branch
git checkout -b feat/your-feature

# Make changes, test, lint
bun run test && bun run lint

# Submit PR
```

---

## License

MIT

---

<div align="center">

**Built with Bun, TypeScript, and Claude.**

[Report Bug](../../issues) &bull; [Request Feature](../../issues)

</div>
