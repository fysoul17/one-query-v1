<div align="center">

# Agent Forge

### Autonomous AI Agent Runtime

Turn any CLI AI tool into an autonomous agent system.<br>
Persistent memory. Pluggable backends. Cyberpunk dashboard.

[Quick Start](#quick-start) &bull; [Architecture](#architecture) &bull; [Features](#features) &bull; [Development](#development) &bull; [Roadmap](#roadmap)

</div>

---

## What is this?

An open-source **runtime template** that wraps CLI AI tools (`claude -p`, Codex CLI, Gemini CLI) into an agent system with:

- A **Conductor** — AI agent that responds to messages, searches memory for context, and delegates to specialist agents
- An **Agent Pool** of AI agents with pluggable backends (per-agent backend selection)
- **Persistent Memory** with vector search (LanceDB) and structured storage (SQLite)
- A real-time **Cyberpunk Dashboard** with streaming chat, agent management, and debug console
- **Scheduled tasks** via Cron Manager
- **Control Plane** with API key auth, usage tracking, quotas, and instance registry

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
│                        │  │ Agent #1    │     │ bun:sqlite   │    │  │
│                        │  │ Agent #2    │     │ LanceDB      │    │  │
│                        │  │ Agent #N    │     │ Naive RAG    │    │  │
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
Swap AI providers without changing code. Any CLI tool that reads stdin and writes stdout works. `claude -p` is the default. Codex CLI, Gemini CLI, and Ollama slot in via the `CLIBackend` interface. Each agent can use a different backend via the BackendRegistry.

### Persistent Dual-Storage Memory
Structured data in bun:sqlite (WAL mode) + vector embeddings in LanceDB. Naive RAG engine: embed query, vector search, hydrate from SQLite. Memory persists across sessions and agent restarts.

### Agent Lifecycle Management
Full CRUD for AI agents with serial message queues, idle timeout auto-shutdown, configurable pool limits, session persistence (`--resume` flags), and ownership-based permissions (user-created vs conductor-created agents).

### Real-time Dashboard
Cyberpunk-themed Next.js dashboard with glass-morphism cards, neon accents, and scanline effects. SSR for initial load, WebSocket for live updates. Includes streaming chat, agent cards with backend/status badges, and a full debug console. Optional username/password authentication via env vars — disabled by default for frictionless local dev, one line to enable for shared networks.

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
# Clone
git clone https://github.com/fysoul17/agent-forge.git
cd agent-forge

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
| `AI_BACKEND` | `claude` | AI backend (`claude`, `codex`, `gemini`, `ollama`) |
| `MAX_AGENTS` | `10` | Maximum concurrent agents |
| `LOG_LEVEL` | `info` | Log level (`debug`, `info`, `warn`, `error`) |
| `DASHBOARD_USER` | *(empty)* | Set with `DASHBOARD_PASSWORD` to enable dashboard auth |
| `DASHBOARD_PASSWORD` | *(empty)* | Dashboard login password |
| `EMBEDDING_PROVIDER` | `stub` | Embedding provider for memory (full profile) |
| `EMBEDDING_API_KEY` | *(empty)* | API key for embedding provider (full profile) |
| `NEO4J_PASSWORD` | `password` | Neo4j password (full profile, local container) |

### Run Tests

```bash
bun run test           # All packages (925 tests)
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
│   ├── memory/          # SQLite + LanceDB + Naive/Graph/Agentic RAG + embeddings + ingestion
│   ├── memory-server/   # Standalone memory sidecar (:7822) — optional
│   ├── conductor/       # Simple AI agent with memory + delegation
│   ├── cron-manager/    # Scheduled tasks
│   ├── control-plane/   # API key auth, usage tracking, quotas, instance registry
│   ├── plugin-system/   # Event hooks, middleware pipeline, plugin manager
│   └── server/          # Bun.serve HTTP + WebSocket + routes
├── dashboard/           # Next.js 16.1 cyberpunk dashboard
├── docs/
│   ├── SPEC.md          # Full specification (single source of truth)
│   └── CLI-BACKEND-RESEARCH.md  # Backend capabilities research
├── package.json         # Monorepo root
├── turbo.json           # Turborepo config
└── biome.json           # Linter config
```

### Package Dependencies

```
@autonomy/shared
       │
       ├──▶ @autonomy/agent-manager
       ├──▶ @autonomy/memory
       │         │
       │         └──▶ @autonomy/memory-server (optional sidecar :7822)
       ├──▶ @autonomy/cron-manager
       ├──▶ @autonomy/control-plane (auth, usage, quotas)
       └──▶ @autonomy/plugin-system (hooks, middleware)
                    │
                    ▼
            @autonomy/conductor
                    │
                    ▼
             @autonomy/server  ◀──  dashboard (HTTP + WS)
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

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | System health + uptime |
| GET | `/api/agents` | List all agents |
| POST | `/api/agents` | Create agent |
| PUT | `/api/agents/:id` | Update agent |
| DELETE | `/api/agents/:id` | Delete agent |
| POST | `/api/agents/:id/restart` | Restart agent |
| GET | `/api/memory/search?q=` | Semantic search |
| POST | `/api/memory/ingest` | Store to memory |
| POST | `/api/memory/ingest/file` | Upload file to memory |
| GET | `/api/memory/stats` | Memory statistics |
| GET | `/api/crons` | List cron jobs |
| POST | `/api/crons` | Create cron |
| PUT | `/api/crons/:id` | Update cron |
| DELETE | `/api/crons/:id` | Delete cron |
| POST | `/api/crons/:id/trigger` | Trigger cron manually |
| GET | `/api/activity` | Activity log |
| GET | `/api/config` | Runtime config |
| PUT | `/api/config` | Update config |
| GET | `/api/auth/keys` | List API keys |
| POST | `/api/auth/keys` | Create API key |
| PUT | `/api/auth/keys/:id` | Update API key |
| DELETE | `/api/auth/keys/:id` | Delete API key |
| GET | `/api/usage/summary` | Usage analytics |
| GET | `/api/usage/quotas/:keyId` | Get quotas |
| PUT | `/api/usage/quotas/:keyId` | Update quotas |
| GET | `/api/instances` | List runtime instances |
| GET | `/api/sessions` | List sessions |
| POST | `/api/sessions` | Create session |
| GET | `/api/sessions/:id` | Get session with messages |
| PUT | `/api/sessions/:id` | Update session |
| DELETE | `/api/sessions/:id` | Delete session |
| POST | `/api/auth/login` | Dashboard login (Next.js) |
| POST | `/api/auth/logout` | Dashboard logout (Next.js) |

### WebSocket

- **`/ws/chat`** — Chat with streaming responses, conductor status events, agent status broadcasts
- **`/ws/debug`** — Real-time debug event stream with history replay

### Dashboard Pages

| Path | Description |
|------|-------------|
| `/` | Home — system health, agent stats, memory stats, instance status |
| `/agents` | Agent management — CRUD, status badges, backend selection |
| `/chat` | Real-time chat with streaming + pipeline visualization |
| `/memory` | Memory browser — search, filter, file upload, graph visualization |
| `/automation` | Cron management — create, edit, trigger scheduled tasks |
| `/activity` | Debug console — live event stream, filters, search |
| `/settings` | Runtime configuration — AI backend, max agents, etc. |
| `/settings/keys` | API key management — create, enable, disable, delete |
| `/sessions` | Session browser — browse, resume, delete conversations |
| `/settings/usage` | Usage analytics — daily/monthly request tracking |
| `/login` | Login page — shown when dashboard auth is enabled |

---

## Roadmap

### Core Template (Steps 1-7) ✅

- [x] **Monorepo scaffold** — Bun workspaces + Turborepo + Biome
- [x] **Agent Manager** — CLIBackend abstraction, process lifecycle, pool management
- [x] **Memory System** — SQLite + LanceDB + Naive RAG
- [x] **Conductor** — AI agent with memory search + delegation
- [x] **Server** — REST API + WebSocket + graceful shutdown
- [x] **Dashboard** — Cyberpunk UI with chat, agents, debug console
- [x] **Backend Registry** — Per-agent backend selection, session support

### Infrastructure (Steps 8-11) ✅

- [x] **Step 8: Cron Manager** — CronManager class, workflow executor, server routes, dashboard Automation page
- [x] **Step 9: Docker** — Dockerfile.runtime, Dockerfile.dashboard, docker-compose.yaml
- [x] **Step 10: Advanced Memory** — Memory-server sidecar, pluggable embeddings, Graph/Agentic RAG, file ingestion, Neo4j graph, memory browser UI
- [x] **Step 11: Control Plane** — API key auth, usage tracking, quotas, instance registry, settings UI

### Extensibility (Steps 12-14) ✅

- [x] **Step 12: Plugin System** — Event hooks, middleware pipeline, `onMessage`/`onResponse`/`onAgentCreate` hooks
- [x] **Step 13: Sessions** — Conversation history API, session browse/resume/delete, dashboard sessions UI
- [x] **Step 14: Dashboard Enhancements** — File upload, dashboard auth (login/logout), live health widget

### Production & CI/CD (Steps 15-16) ✅

- [x] **Step 15: Production Hardening** — IP rate limiting, structured JSON logging, standardized streaming contract
- [x] **Step 16: CI/CD Pipeline** — 3-job GitHub Actions (quality/e2e/docker), 27 E2E integration tests

### Extension Points

- [ ] **Channel Adapters** — Telegram, Discord, Slack (extension point)

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

TBD

---

<div align="center">

**Built with Bun, TypeScript, and Claude.**

[Report Bug](../../issues) &bull; [Request Feature](../../issues)

</div>
