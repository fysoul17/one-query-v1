<div align="center">

# Pyx

### Organization as a Service

Turn any CLI AI tool into a 24/7 autonomous multi-agent system.<br>
One command. Full AI team. Persistent memory. Cyberpunk dashboard.

[Quick Start](#quick-start) &bull; [Architecture](#architecture) &bull; [Features](#features) &bull; [Development](#development) &bull; [Roadmap](#roadmap)

</div>

---

## What is this?

An open-source **runtime template** that wraps CLI AI tools (`claude -p`, Codex CLI, Gemini CLI) into a production-grade multi-agent system with:

- A **Conductor** (Mother AI) that routes, delegates, and orchestrates
- An **Agent Pool** of specialist AI agents with pluggable backends
- **Persistent Memory** with vector search (LanceDB) and structured storage (SQLite)
- A real-time **Cyberpunk Dashboard** with streaming chat, agent management, and debug console
- **Channel adapters** for Telegram, Discord, Slack (planned)
- **Scheduled tasks** via Cron Manager (planned)

**This is not a product. It's the engine.** Fork it, add your agent definitions and domain data, ship your product.

```
                This Template (Engine)
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
   ┌─────────┐  ┌──────────┐  ┌──────────┐
   │  Your   │  │  Your    │  │  Your    │
   │  OaaS   │  │  QA Team │  │  Content │
   │ Product │  │  Product │  │  Product │
   └─────────┘  └──────────┘  └──────────┘
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                    Runtime Container (Bun)                            │
│                                                                      │
│  ┌────────────────┐    ┌──────────────────────────────────────────┐  │
│  │   Bun.serve    │    │          Conductor (Mother AI)           │  │
│  │   HTTP + WS    │───▶│                                          │  │
│  │                │    │  ┌──────────┐ ┌──────────┐ ┌─────────┐  │  │
│  │  /health       │    │  │AI Router │ │ Keyword  │ │ Permis. │  │  │
│  │  /api/*        │    │  │(claude-p)│ │ Fallback │ │ Checker │  │  │
│  │  /ws/chat      │    │  └──────────┘ └──────────┘ └─────────┘  │  │
│  │  /ws/debug     │    │                    │                     │  │
│  └────────────────┘    │         ┌──────────┴──────────┐         │  │
│                        │         ▼                     ▼         │  │
│                        │  ┌─────────────┐     ┌──────────────┐   │  │
│                        │  │ Agent Pool  │     │    Memory     │   │  │
│                        │  │             │     │              │   │  │
│                        │  │ Agent #1    │     │ bun:sqlite   │   │  │
│                        │  │ Agent #2    │     │ LanceDB      │   │  │
│                        │  │ Agent #N    │     │ Naive RAG    │   │  │
│                        │  └─────────────┘     └──────────────┘   │  │
│                        └──────────────────────────────────────────┘  │
│                                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────────┐  │
│  │  DebugBus   │  │ ActivityLog  │  │    Cron Manager (planned)  │  │
│  └─────────────┘  └──────────────┘  └────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                  Dashboard (Next.js 16.1)                             │
│  ┌──────┐ ┌────────┐ ┌──────┐ ┌──────────┐ ┌────────┐ ┌──────────┐ │
│  │ Home │ │ Agents │ │ Chat │ │ Activity │ │ Memory │ │ Settings │ │
│  │ SSR  │ │  CRUD  │ │  WS  │ │  Debug   │ │ (TBD)  │ │  (TBD)   │ │
│  └──────┘ └────────┘ └──────┘ └──────────┘ └────────┘ └──────────┘ │
└──────────────────────────────────────────────────────────────────────┘
      ▲               ▲                ▲
      │               │                │
 ┌────┴────┐   ┌──────┴──────┐  ┌─────┴─────┐
 │ Browser │   │  Telegram   │  │  Discord   │
 │         │   │  (planned)  │  │  (planned) │
 └─────────┘   └─────────────┘  └───────────┘
```

### Conductor Pipeline

Every message flows through a 5-step pipeline:

```
Message In ──▶ Memory Search ──▶ AI Routing ──▶ Dispatch ──▶ Memory Store ──▶ Response Out
                 (context)      (who handles?)  (delegate)   (if valuable)    (stream WS)
```

The AI Router analyzes the message, available agents, and memory context to decide:
- **respond_directly** — Conductor answers itself
- **delegate_to_agent** — Route to an existing specialist
- **create_agent** — Spin up a new specialist on the fly
- **pipeline** — Sequential relay across multiple agents

If AI routing fails, keyword-based scoring takes over automatically.

---

## Features

### Intelligent Orchestration
The Conductor ("Mother AI") receives every message first, searches memory for context, routes via AI (with keyword fallback), and delegates to the right agent. It can create specialist agents dynamically when no suitable one exists. Give it a personality (JARVIS, Friday, Alfred — or your own) and it maintains stateful sessions across restarts via `--resume`.

### Pluggable AI Backends
Swap AI providers without changing code. Any CLI tool that reads stdin and writes stdout works. `claude -p` is the default, but Codex CLI, Gemini CLI, or custom wrappers slot in via the `CLIBackend` interface.

### Persistent Dual-Storage Memory
Structured data in bun:sqlite (WAL mode) + vector embeddings in LanceDB. Naive RAG engine: embed query, vector search, hydrate from SQLite. Memory persists across sessions and agent restarts.

### Agent Lifecycle Management
Full CRUD for AI agents with serial message queues, idle timeout auto-shutdown, configurable pool limits, and ownership-based permissions (user-created vs conductor-created agents).

### Real-time Dashboard
Cyberpunk-themed Next.js dashboard with glass-morphism cards, neon accents, and scanline effects. SSR for initial load, WebSocket for live updates. Includes streaming chat, RPG-style agent cards, and a full debug console.

### Observability Built In
DebugBus (ring buffer + pub/sub) streams events across 5 categories (conductor, agent, memory, websocket, system) to a filterable debug console with pause/resume, search, and JSON expansion.

### Pipeline Visualization
See exactly how the Conductor processes each message: which phase it's in, which agent it's delegating to, timing data per step — all rendered live in the chat UI.

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.2+
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) (for the default `claude -p` backend)

### Development Mode

```bash
# Clone
git clone https://github.com/your-org/pyx.git
cd pyx

# Install dependencies
bun install

# Start everything (runtime + dashboard)
bun run dev

# Or start individually
bun run dev:runtime    # Runtime server on :3000
bun run dev:dashboard  # Dashboard on :3001
```

### Docker (Coming Soon)

```bash
docker-compose up
```

### Run Tests

```bash
bun run test           # All packages (670+ tests)
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
pyx/
├── packages/
│   ├── shared/          # Types, interfaces, constants (31 interfaces)
│   ├── agent-manager/   # CLIBackend, AgentProcess, AgentPool
│   ├── memory/          # SQLite + LanceDB + Naive RAG
│   ├── conductor/       # Mother AI orchestrator + AI routing
│   ├── cron-manager/    # Scheduled tasks (Step 8)
│   └── server/          # Bun.serve HTTP + WebSocket + routes
├── dashboard/           # Next.js 16.1 cyberpunk dashboard
├── docs/
│   ├── SPEC.md          # Full specification (single source of truth)
│   ├── ARCHITECTURE-V2.md    # Pyx V2 product architecture
│   ├── V2-IMPLEMENTATION-ROADMAP.md  # Migration roadmap
│   └── PRODUCT-DISCOVERY.md  # Feature docs + competitive analysis
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
       └──▶ @autonomy/cron-manager
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
| DELETE | `/api/agents/:id` | Delete agent |
| POST | `/api/agents/:id/restart` | Restart agent |
| GET | `/api/memory/search?q=` | Semantic search |
| POST | `/api/memory/ingest` | Store to memory |
| GET | `/api/memory/stats` | Memory statistics |
| GET | `/api/activity` | Activity log |
| GET | `/api/conductor/settings` | Conductor identity + session |
| PUT | `/api/conductor/settings` | Update conductor personality |
| GET | `/api/config` | Runtime config |

### WebSocket

- **`/ws/chat`** — Chat with streaming responses, conductor status events, agent status broadcasts
- **`/ws/debug`** — Real-time debug event stream with history replay

---

## Roadmap

- [x] **Monorepo scaffold** — Bun workspaces + Turborepo + Biome
- [x] **Agent Manager** — CLIBackend abstraction, process lifecycle, pool management
- [x] **Memory System** — SQLite + LanceDB + Naive RAG
- [x] **Conductor** — Mother AI with permissions, routing, activity log
- [x] **Server** — REST API + WebSocket + graceful shutdown
- [x] **Dashboard** — Cyberpunk UI with chat, agents, debug console
- [x] **AI Conductor** — AI-powered routing with fallback chain
- [x] **Session Support** — Agent lifecycle (persistent/ephemeral), `--resume` session persistence
- [x] **Conductor Soul** — Personality config, pending question tracking, settings dashboard
- [ ] **Cron Manager** — Scheduled autonomous tasks
- [ ] **Docker Deployment** — `docker-compose up` for instant setup
- [ ] **Channel Adapters** — Telegram, Discord, Slack
- [ ] **Advanced RAG** — Graph RAG + Agentic RAG
- [ ] **Cloud Mode** — Multi-tenant control plane

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
