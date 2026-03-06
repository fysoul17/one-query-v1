# Autonomous AI Agent Runtime — Template Spec

> Single source of truth. Everything needed to understand and extend this template.
>
> Last synced with codebase: 2026-03-05 (entity extraction + doc sync)

---

## 1. What This Is

A template runtime that turns CLI AI tools (`claude -p`, Codex CLI, Gemini CLI, Pi CLI) into an **autonomous agent system** with persistent memory, accessible via a built-in Dashboard UI.

**This is NOT a product.** It's the foundation. Products fork this and add:

- Agent definitions (roles, prompts)
- Domain-specific data (ingest into memory)
- Custom conductor logic (routing, permissions, personality)
- Channel adapters (Telegram, Discord, Slack) _(planned — see Section 15)_
- Branding / additional UI

**Template = Game Engine. Product = Game built on the engine.**

```
                    This Template
                        │
          ┌─────────────┼─────────────┐
          │             │             │
          ▼             ▼             ▼
    ┌──────────┐  ┌──────────┐  ┌──────────┐
    │  Your    │  │  Your    │  │  Your    │
    │  OaaS   │  │  QA Team │  │  Content │
    │ Product  │  │ Product  │  │ Product  │
    └──────────┘  └──────────┘  └──────────┘
```

**What this template solves:**

> "claude -p is powerful, but everything is lost when the session ends, it can't run 24/7, you can't manage multiple agents, and non-developers can't use it."

1. **Memory** — Persists across sessions (4 memory types + Hybrid RAG)
2. **Docker** — Runs 24/7
3. **Agent Manager** — Multi-agent management (5 backends)
4. **Dashboard** — Accessible to non-developers

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│              AUTONOMOUS AGENT RUNTIME (Docker, 24/7)             │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Bun.serve (HTTP Server)                         :7820     │  │
│  │                                                            │  │
│  │  /api/*          → REST API (agents, memory, config, etc.) │  │
│  │  /ws/chat        → WebSocket (real-time streaming)         │  │
│  │  /ws/debug       → WebSocket (debug event stream)          │  │
│  │  /ws/terminal    → WebSocket (PTY for CLI auth flows)      │  │
│  │  /health         → Health check                            │  │
│  └────────────┬───────────────────────────────────────────────┘  │
│               │                                                   │
│  ┌────────────┴───────────────────────────────────────────────┐  │
│  │  Rate Limiter                                              │  │
│  └────────────┬───────────────────────────────────────────────┘  │
│               │                                                   │
│               ▼                                                   │
│  ┌─────────────────────┐                                         │
│  │     CONDUCTOR        │  AI orchestrator with 7-step pipeline.  │
│  │                      │  Hooks at every phase.                  │
│  │  1. BEFORE_MESSAGE   │  Per-session backend processes          │
│  │  2. Memory search    │  (LRU, max 100).                       │
│  │  3. AFTER_MEMORY     │  Delegates if targetAgentId set.       │
│  │  4. Dispatch         │                                         │
│  │  5. BEFORE_RESPONSE  │                                         │
│  │  6. AFTER_RESPONSE   │                                         │
│  │  7. Memory store     │                                         │
│  └──────┬───────────────┘                                         │
│         │                                                         │
│    ┌────┴─────┬──────────┬──────────┐                            │
│    ▼          ▼          ▼          ▼                             │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────────┐                     │
│ │Agent │ │Agent │ │Agent │ │Agent (any    │                     │
│ │  A   │ │  B   │ │  C   │ │backend)      │                     │
│ └──────┘ └──────┘ └──────┘ └──────────────┘                     │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  MEMORY SYSTEM (pyx-memory)                               │    │
│  │                                                           │    │
│  │  bun:sqlite     → structured data (sessions, config,      │    │
│  │                    agent registry, graph nodes/edges)      │    │
│  │                                                           │    │
│  │  LanceDB        → vector embeddings (384-dim local)       │    │
│  │                    semantic search                         │    │
│  │                                                           │    │
│  │  RAG Strategies:                                          │    │
│  │  ├── Hybrid RAG  (graph + vector + optional LLM rerank)   │    │
│  │  ├── Graph RAG   (entity/relation traversal)              │    │
│  │  ├── Agentic RAG (multi-query decomposition)              │    │
│  │  └── Naive RAG   (query → retrieve → respond)             │    │
│  │                                                           │    │
│  │  Memory Types:                                            │    │
│  │  ├── Short-term   (conversation/session state)            │    │
│  │  ├── Long-term    (persistent knowledge)                  │    │
│  │  ├── Working      (active task context)                   │    │
│  │  ├── Episodic     (conversation history)                  │    │
│  │  └── Summary      (condensed session summaries)           │    │
│  │                                                           │    │
│  │  Lifecycle:                                               │    │
│  │  ├── Consolidation (every 30 min)                         │    │
│  │  ├── Decay (every 24h)                                    │    │
│  │  ├── Deduplication                                        │    │
│  │  ├── Summarization                                        │    │
│  │  └── Fact extraction                                      │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌──────────────┐  ┌──────────────────────┐                      │
│  │ Cron Manager  │  │   Plugin System      │                      │
│  │ (scheduled    │  │   (8 hook points,    │                      │
│  │  workflows)   │  │    middleware)        │                      │
│  └──────────────┘  └──────────────────────┘                      │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ DebugBus     │  │ ActivityLog  │  │ SecretStore           │   │
│  │ (ring buffer │  │ (in-memory   │  │ (encrypted backend    │   │
│  │  + pub/sub)  │  │  ring buffer)│  │  API keys)            │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
│                                                                   │
│  /data volume (persistent)                                       │
│  ├── agents/           # agent-specific data                     │
│  ├── cli-config/       # CLI backend config cache                │
│  ├── config.json       # runtime config overrides                │
│  ├── crons.json        # scheduled task definitions              │
│  ├── memory/           # memory SQLite databases (WAL mode)      │
│  ├── vectors/          # LanceDB vector store                    │
│  └── workspaces/       # per-workspace session data              │
└──────────────────────────────────────────────────────────────────┘

Dashboard (Next.js 16.1, separate service in docker-compose)  :7821
  └── Connects to Runtime API at http://runtime:7820
```

### Deployment Modes

```
MINIMAL (docker-compose up) — default
──────────────────────────────────────────────────────
  ┌──────────────────────────────────────────────────┐
  │  docker-compose                                   │
  │                                                   │
  │  ┌─────────────────┐  ┌───────────────────────┐  │
  │  │  runtime:7820   │  │  dashboard:7821       │  │
  │  │                  │  │                       │  │
  │  │  Agent Manager   │  │  Next.js 16.1         │  │
  │  │  Conductor       │←─│  (standalone output)  │  │
  │  │  Cron Manager    │  │                       │  │
  │  │  Plugin System   │  │  connects to          │  │
  │  │  /data volume    │  │  http://runtime:7820  │  │
  │  │  (no memory)     │  │                       │  │
  │  └─────────────────┘  └───────────────────────┘  │
  │                                                   │
  │  DB: bun:sqlite (agents, sessions — no memory)     │
  └──────────────────────────────────────────────────┘

FULL (docker-compose --profile full up)
──────────────────────────────────────────────────────
  ┌──────────────────────────────────────────────────┐
  │  + memory sidecar :7822 (runtime connects via     │
  │    MemoryClient when MEMORY_URL is set)            │
  │  + Neo4j :7474/:7687 (Graph RAG)                  │
  └──────────────────────────────────────────────────┘
```

---

## 3. Tech Stack

| Layer         | Technology                                                     | Why                                      |
| ------------- | -------------------------------------------------------------- | ---------------------------------------- |
| Runtime       | Bun 1.2+                                                       | Fast, native TypeScript, built-in SQLite |
| Language      | TypeScript 5.7+                                                | Type safety                              |
| Monorepo      | Bun workspaces + Turborepo v2                                  | Build orchestration                      |
| AI Backends   | claude -p (default), codex, gemini, pi, ollama                 | Pluggable via CLIBackend interface       |
| Vector DB     | LanceDB (embedded)                                             | 4MB idle, fast ANN, native TS SDK        |
| Structured DB | bun:sqlite (WAL mode)                                          | Embedded, zero config                    |
| Memory        | pyx-memory (@pyxmate/memory SDK + Docker)                      | Hybrid RAG, graph store, lifecycle       |
| Dashboard     | Next.js 16.1 (App Router) + Tailwind CSS 4 + shadcn/ui        | RSC, standalone output                   |
| Container     | Docker + docker-compose                                        | One-click deploy                         |
| Linter        | Biome 2.4+                                                     | Fast, unified linter + formatter         |
| Tests         | bun:test                                                       | Built-in, fast                           |

---

## 4. Project Structure

```
agent-forge/
│
├── packages/
│   ├── shared/                  # Types, interfaces, constants, logger
│   ├── agent-manager/           # CLI AI process lifecycle
│   │   └── src/backends/        # Pluggable backends (claude, codex, gemini, pi, ollama)
│   ├── conductor/               # AI orchestrator with 7-step pipeline
│   ├── cron-manager/            # Scheduled task workflows
│   ├── plugin-system/           # Event hooks, middleware pipeline, plugin manager
│   └── server/                  # Bun.serve — wires everything, HTTP + WebSocket + routes
│       └── src/
│           ├── index.ts             # main() entry point, Bun.serve composition root
│           ├── server-factory.ts    # Factory functions for subsystem init (DB, backends, plugins, pool, conductor)
│           ├── websocket.ts         # Chat WS handler, streaming, StreamContext
│           ├── ws-utils.ts          # safeSend/safeSendRaw — shared WS send helpers
│           ├── ws-debug.ts          # Conductor event → WS debug payload helpers
│           ├── ws-session.ts        # Session creation + message persistence helpers
│           ├── ws-slash-commands.ts  # Slash command handler (/model, /help, /config)
│           ├── debug-websocket.ts   # /ws/debug handler
│           ├── terminal-ws.ts       # /ws/terminal PTY bridge handler
│           ├── stream-buffer.ts     # Per-session stream buffer for reconnect replay
│           ├── step-metadata.ts     # Agent step metadata accumulation
│           └── routes/              # REST route handlers (agents, memory, crons, etc.)
│
├── dashboard/                   # Next.js 16.1 (built-in cyberpunk UI)
│   └── app/
│       ├── (dashboard)/         # Home, Agents, Chat, Memory, Automation, Activity, Sessions, Settings
│       ├── components/          # UI components organized by feature
│       ├── hooks/               # Custom React hooks (useWebSocket, etc.)
│       └── lib/                 # api-server.ts (SSR fetch), api.ts (client fetch)
│
├── docker/
│   ├── Dockerfile.runtime
│   ├── Dockerfile.dashboard
│   └── docker-compose.yaml
│
├── data/                        # Default /data volume contents
│   ├── agents/
│   │   └── registry.json       # Seed agent definitions (restored on startup)
│   ├── runtime.sqlite           # Sessions + agents (bun:sqlite, WAL mode, created at runtime)
│   ├── crons.json               # Scheduled task definitions
│   └── config.json              # Runtime config overrides
│
├── package.json                 # Workspace root (bun)
├── turbo.json                   # Turborepo config
├── tsconfig.base.json
├── biome.json
└── .env.example
```

---

## 5. Conductor — AI Orchestrator

The Conductor is the central AI orchestrator. It receives all incoming messages, runs a 7-step hook-integrated pipeline, and either responds directly via its own AI backend or delegates to a specific agent in the pool.

### Pipeline (7 Steps)

```
Message In
    │
    ▼
┌──────────────────────────────────────────────────┐
│  CONDUCTOR PIPELINE                               │
│                                                   │
│  1. BEFORE_MESSAGE hook (can transform/reject)    │
│  2. Memory search (Hybrid RAG, limit 5)           │
│     └── wraps results in <memory-context> tags    │
│  3. AFTER_MEMORY_SEARCH hook                      │
│  4. Dispatch:                                     │
│     ├── targetAgentId set → AgentPool.send()      │
│     └── no target → own BackendProcess.send()     │
│  5. BEFORE_RESPONSE hook                          │
│  6. AFTER_RESPONSE hook (can transform content)   │
│  7. Memory store:                                 │
│     ├── Entity extraction (LLM → graph entities)  │
│     ├── User message → SHORT_TERM (+graph if any) │
│     └── Assistant response → EPISODIC             │
│     └── BEFORE_MEMORY_STORE hook                  │
└──────────────────────────────────────────────────┘
```

### Session Backend Management

- Each session gets its own `BackendProcess`, lazily spawned
- Per-session config overrides (from `/model sonnet`-style slash commands)
- LRU eviction at 100 concurrent session processes
- Serial message queue (one message at a time per session)
- **Session resume persistence**: The native CLI session ID (e.g., Claude `--resume` UUID) is persisted to SQLite (`backend_session_id` column in `sessions` table). When the backend process is respawned after Docker rebuild or LRU eviction, the stored ID is restored so the CLI resumes from full conversation history.

### Module Structure

The Conductor's logic is split across focused modules:

- `conductor.ts` — core orchestrator class with pipeline, queue, and agent management
- `conductor-memory.ts` — memory search and conversation storage (extracted free functions)
- `entity-extractor.ts` — LLM-powered entity/relationship extraction for knowledge graph population
- `conductor-hooks.ts` — hook execution helpers (before_message, after_memory_search, after_response)
- `conductor-prompt.ts` — memory-augmented prompt builder with system context
- `session-process-pool.ts` — per-session backend process lifecycle (LRU, spawn, resume)
- `system-context.ts` — system awareness layer for agent platform context
- `system-action-executor.ts` — executes structured system actions (agent create/delete, cron ops)
- `system-action-parser.ts` — parses system action blocks from AI responses
- `activity-log.ts` — in-memory activity ring buffer

### Agent Management

The Conductor can create and delete agents. Products can extend this with custom logic (permissions, approval workflows, dynamic creation).

### Agent Ownership in Dashboard

```
Agents

  ┌──────────────────────────────────┐
  │ QA Specialist             [active] │
  │ Report Writer             [idle]  │
  │ data-processor            [busy]  │
  └──────────────────────────────────┘

  Conductor                   [active]  ← system-protected
```

---

## 6. Agent-to-Agent Communication (A2A)

### Direct Delegation (via Conductor)

```
User sends message with targetAgentId
  → Conductor delegates to that agent
  → Agent responds
  → Response streams back to user
```

### Backend Selection per Agent

Each agent can use a different CLI backend. The `BackendRegistry` manages multiple backends:

| Capability          | Claude Code | Codex CLI | Gemini CLI | Pi CLI | Ollama    |
| ------------------- | ----------- | --------- | ---------- | ------ | --------- |
| Custom Tools        | ✅          | ✅        | ✅         | ❌     | ✅        |
| Streaming           | ✅          | ✅        | ✅         | ✅     | ✅        |
| Session Persistence | ✅          | ✅        | ✅         | ✅     | ❌ (in-memory) |
| File Access         | ✅          | ✅        | ❌         | ❌     | ❌        |

> **Note:** Ollama is HTTP-based (not CLI-based). It connects to a locally running Ollama server via `/api/chat`. No API key needed.
>
> **Planned:** Tier 2 community backends (Copilot, Cline, Aider). See `docs/CLI-BACKEND-RESEARCH.md` for details.

---

## 7. Memory System (pyx-memory)

Memory is powered by [pyx-memory](https://github.com/fysoul17/pyx-memory-v1), consumed via the [`@pyxmate/memory`](https://www.npmjs.com/package/@pyxmate/memory) npm SDK. The runtime connects to pyx-memory as a **sidecar** (Docker container: `ghcr.io/fysoul17/pyx-memory`) via `MemoryClient` when `MEMORY_URL` is set. When no memory server is configured, the runtime uses `DisabledMemory` (no-op) and all memory features are unavailable.

### Storage Layer (managed by pyx-memory sidecar)

| Store             | Technology                          | Purpose                               |
| ----------------- | ----------------------------------- | ------------------------------------- |
| Structured data   | bun:sqlite (WAL mode)               | Memory entries, graph nodes/edges, config |
| Vector embeddings | LanceDB (embedded, 384-dim local)   | Semantic search, RAG                  |
| Graph store       | SQLiteGraphStore (default) or Neo4j | Entity/relation graph for Graph RAG   |

> **Note:** These stores are owned and managed by the pyx-memory sidecar, not the runtime. The runtime accesses them indirectly via `MemoryClient` HTTP calls. The runtime has its own `runtime.sqlite` (in `/data`) for sessions and agent definitions.

### Memory Types

| Type          | Enum              | Purpose                                        |
| ------------- | ----------------- | ---------------------------------------------- |
| Short-term    | `SHORT_TERM`      | Conversation/session state                     |
| Long-term     | `LONG_TERM`       | Persistent knowledge and facts                 |
| Working       | `WORKING`         | Active task context                            |
| Episodic      | `EPISODIC`        | Conversation history (assistant responses)     |
| Summary       | `SUMMARY`         | Condensed session summaries                    |

### RAG Strategies

| Strategy    | Enum       | How it works                                                   |
| ----------- | ---------- | -------------------------------------------------------------- |
| **Hybrid**  | `HYBRID`   | Combines Graph + Vector search with optional LLM reranking (default) |
| Graph       | `GRAPH`    | Entity/relation traversal via graph store                      |
| Agentic     | `AGENTIC`  | Multi-query decomposition + transformer pipeline               |
| Naive       | `NAIVE`    | Simple query → vector search → retrieve top-K → respond       |

### Memory Lifecycle

Automated background processes manage memory health:

| Process          | Interval  | What it does                                    |
| ---------------- | --------- | ----------------------------------------------- |
| Consolidation    | 30 min    | Merges related memories, extracts facts         |
| Decay            | 24 hours  | Reduces importance of old/unused memories       |
| Deduplication    | On ingest | Detects and merges semantically similar entries |
| Summarization    | On demand | Rolls up session conversations                  |
| Fact extraction  | On ingest | Extracts structured facts from content          |

### Entity Extraction (Knowledge Graph Population)

At conversation store time, the Conductor extracts named entities and relationships from the message text using the Anthropic Messages API (`claude-haiku-4-5-20251001`). Extracted entities are validated against a fixed type enum (`PERSON`, `ORGANIZATION`, `LOCATION`, `TOOL`, `CONCEPT`, `EVENT`, `PRODUCT`, `OTHER`) and stored alongside the memory entry with `targets: [SQLITE, VECTOR, GRAPH]`. This populates the knowledge graph automatically from conversation content without requiring explicit ingestion.

- **Input**: Full text (user message + assistant response), truncated to 4000 chars
- **Timeout**: 10 seconds (non-blocking, fails gracefully to empty)
- **Validation**: Entity name length ≤ 200, type must be in enum, relationships must reference valid entities
- **Requires**: `ANTHROPIC_API_KEY` env var (skips extraction silently if absent)

See `packages/conductor/src/entity-extractor.ts` for implementation.

### Ingestion

- Text paste via Dashboard UI
- File upload via Dashboard UI (`POST /api/memory/ingest/file`)
- API endpoint (`POST /api/memory/ingest`)
- Ingestion pipeline with chunkers (semantic, structural), parsers, and classifiers

### Embedding Providers

| Provider   | Enum         | Dimensions | Notes                           |
| ---------- | ------------ | ---------- | ------------------------------- |
| Local      | `LOCAL`      | 384        | Default, no API key needed      |
| Stub       | `STUB`       | 1024       | For testing, random vectors     |
| Anthropic  | `ANTHROPIC`  | varies     | Requires API key                |
| OpenAI     | `OPENAI`     | varies     | Requires API key                |

---

## 8. Dashboard (Built-in UI)

Next.js 16.1, App Router, standalone output. Separate service in docker-compose. Cyberpunk-themed with glass-morphism cards, neon accents, and scanline effects.

```
Dashboard Pages:

├── 🏠 Home              — System health, agent stats, memory stats (SSR)
│
├── 🤖 Agents             — Agent management
│   ├── Agent list        — Cards: name, role, status, owner, backend badge
│   ├── Create Agent      — Name, role, prompt, tools, backend selector
│   ├── Agent actions     — Restart, delete
│   └── 🔒 Conductor      — View-only (status, system-protected)
│
├── 🧠 Memory             — Memory browser
│   ├── Search            — Semantic search with filters
│   ├── Entries           — Browse, view, delete memory entries
│   ├── Graph             — Graph visualization (nodes, edges, relations)
│   ├── File upload       — Ingest files into memory
│   └── Stats             — Storage used, vector count, type breakdown
│
├── 💬 Chat               — Direct conversation
│   ├── Conductor         — Talk to the Conductor AI (WebSocket streaming)
│   ├── Direct to Agent   — Talk to specific agent (debugging/testing)
│   ├── Session restore   — Resume previous conversations
│   └── Pipeline viz      — Real-time conductor pipeline visualization
│
├── ⚡ Automation          — Cron management
│   ├── Cron list         — View all scheduled tasks with status
│   ├── Create/Edit       — Schedule, workflow steps, enable/disable
│   ├── Trigger           — Manual execution
│   └── Logs              — Execution history
│
├── 📊 Activity            — Debug Console
│   ├── Timeline          — Who did what, when
│   ├── Filters           — Category (conductor/agent/memory/websocket/system), level, search
│   └── Live stream       — Real-time debug events via /ws/debug
│
├── 💬 Sessions            — Conversation history
│   ├── Session list      — Browse past conversations
│   ├── Resume session    — Continue a previous conversation
│   └── Delete session    — Remove conversation history
│
└── ⚙️ Settings            — Runtime configuration
    ├── Config            — AI backend, max agents, timeouts, etc.
    └── Backends          — Backend status, API key management, logout
```

---

## 9. Data Storage

### Agent Definitions

Agents are created through the Dashboard UI or REST API (`POST /api/agents`). The `AgentStore` (SQLite, in `runtime.sqlite`) persists agent definitions. The `AgentPool` restores agents from the store across restarts.

Fields: id, name, role, systemPrompt, tools (allowed tool list), backend, owner (user|conductor|system), createdAt, updatedAt.

### Cron Config (`/data/crons.json`)

Version + array of cron entries: id, name, schedule (cron syntax), timezone, enabled, workflow (steps array + output), createdBy, createdAt.

### Platform Config (`/data/config.json`)

Runtime config overrides. Empty `{}` uses defaults from `DEFAULTS` constant.

---

## 10. REST API

### Core Routes

| Method   | Path                        | Description                  |
| -------- | --------------------------- | ---------------------------- |
| `GET`    | `/health`                   | Health check + system status |
| `GET`    | `/api/agents`               | List all agents with status  |
| `POST`   | `/api/agents`               | Create agent                 |
| `PUT`    | `/api/agents/:id`           | Update agent                 |
| `DELETE` | `/api/agents/:id`           | Delete agent                 |
| `POST`   | `/api/agents/:id/restart`   | Restart agent process        |
| `GET`    | `/api/activity`             | Activity timeline            |
| `GET`    | `/api/config`               | Get config (keys redacted)   |
| `PUT`    | `/api/config`               | Update config                |

### Memory Routes

| Method   | Path                            | Description                     |
| -------- | ------------------------------- | ------------------------------- |
| `GET`    | `/api/memory/search`            | Semantic search (query, strategy, limit) |
| `POST`   | `/api/memory/ingest`            | Ingest text                     |
| `POST`   | `/api/memory/ingest/file`       | Upload and ingest file          |
| `GET`    | `/api/memory/stats`             | Memory statistics               |
| `GET`    | `/api/memory/entries`           | List/filter memory entries      |
| `GET`    | `/api/memory/entries/:id`       | Get single memory entry         |
| `DELETE` | `/api/memory/entries/:id`       | Delete memory entry             |
| `DELETE` | `/api/memory/sessions/:sessionId` | Clear session memory          |

### Memory Lifecycle Routes

| Method   | Path                                          | Description                      |
| -------- | --------------------------------------------- | -------------------------------- |
| `POST`   | `/api/memory/consolidate`                     | Trigger memory consolidation     |
| `POST`   | `/api/memory/forget/:id`                      | Forget specific memory (soft-delete) |
| `POST`   | `/api/memory/sessions/:sessionId/summarize`   | Summarize a session              |
| `POST`   | `/api/memory/decay`                           | Run memory decay                 |
| `POST`   | `/api/memory/reindex`                         | Reindex vector embeddings        |
| `DELETE` | `/api/memory/source/:source`                  | Delete memories by source        |

### Memory Graph Routes

| Method   | Path                              | Description                     |
| -------- | --------------------------------- | ------------------------------- |
| `GET`    | `/api/memory/graph/nodes`         | List graph nodes (filter by name, type, limit) |
| `GET`    | `/api/memory/graph/edges`         | Graph stats (node/edge counts)  |
| `POST`   | `/api/memory/graph/query`         | Query the graph (traverse by nodeId + depth) |

### Cron Routes

| Method   | Path                      | Description                  |
| -------- | ------------------------- | ---------------------------- |
| `GET`    | `/api/crons`              | List cron jobs with status   |
| `POST`   | `/api/crons`              | Create cron                  |
| `PUT`    | `/api/crons/:id`          | Update cron                  |
| `DELETE` | `/api/crons/:id`          | Delete cron                  |
| `POST`   | `/api/crons/:id/trigger`  | Manually trigger cron        |
| `GET`    | `/api/crons/logs`         | Get execution logs           |

### Session Routes

| Method   | Path                      | Description                      |
| -------- | ------------------------- | -------------------------------- |
| `GET`    | `/api/sessions`           | List sessions                    |
| `POST`   | `/api/sessions`           | Create session                   |
| `GET`    | `/api/sessions/:id`       | Get session with messages        |
| `PUT`    | `/api/sessions/:id`       | Update session                   |
| `DELETE` | `/api/sessions/:id`       | Delete session                   |

### Backend Routes

| Method   | Path                          | Description                   |
| -------- | ----------------------------- | ----------------------------- |
| `GET`    | `/api/backends/status`        | Status of all backends        |
| `GET`    | `/api/backends/options`       | Config options per backend    |
| `PUT`    | `/api/backends/api-key`       | Update backend API key (name in body) |
| `PUT`    | `/api/backends/:name/api-key` | Update backend API key (name in path) |
| `POST`   | `/api/backends/:name/logout`  | Logout from backend           |

---

## 11. WebSocket Protocol

### Endpoints

- **`/ws/chat`** — Chat with streaming responses, conductor status events, agent status broadcasts
- **`/ws/debug`** — Real-time debug event stream with history replay
- **`/ws/terminal`** — PTY bridge for CLI backend authentication flows

### Chat WebSocket (`/ws/chat`)

**Client → Server:**

| Type       | Description                                          |
| ---------- | ---------------------------------------------------- |
| `message`  | Content + optional `targetAgent` + optional `sessionId` |
| `CANCEL`   | Abort in-flight stream (per-session AbortController) |
| `ping`     | Keepalive                                            |
| Slash cmds | `/model sonnet`, `/help`, `/config` — stored as config overrides |

**Server → Client:**

| Type               | Description                                           |
| ------------------ | ----------------------------------------------------- |
| `chunk`            | Streaming response content + agent id                 |
| `complete`         | Response finished                                     |
| `error`            | Error message                                         |
| `agent_step`       | Agent tool/thinking events with `stepType` discriminant: `tool_start`, `tool_input`, `tool_complete`, `thinking` |
| `agent_status`     | All agent statuses (broadcast every 5s)               |
| `conductor_status` | Pipeline phase (see below)                            |
| `session_init`     | Session ID assigned                                   |
| `stream_resume`    | Replay buffered content on reconnect                  |
| `debug_event`      | Real-time debug event (also on `/ws/debug`)           |
| `debug_history`    | Debug event history replay on connect                 |
| `pong`             | Keepalive response                                    |

**`agent_step` sub-types** (via `stepType` field):

| stepType        | Description                                |
| --------------- | ------------------------------------------ |
| `tool_start`    | Tool use started (name, id)                |
| `tool_input`    | Tool input data (incremental delta)        |
| `tool_complete` | Tool use finished (duration, result)       |
| `thinking`      | Model thinking/reasoning content           |

**`conductor_status` phases:**

`queued`, `analyzing`, `creating_agent`, `delegating`, `memory_search`, `context_inject`, `routing_complete`, `memory_store`, `delegation_complete`, `responding`

**Limits:**
- Per-socket rate limit: 10 messages / 60 seconds
- Max message size: 64 KB
- Max concurrent clients: 100

### Stream Buffer

The `StreamBuffer` accumulates streamed content per session. When a client reconnects, it receives a `STREAM_RESUME` message replaying all buffered chunks so far.

---

## 12. Environment Variables

| Variable               | Required  | Default                  | Description                |
| ---------------------- | --------- | ------------------------ | -------------------------- |
| `DATA_DIR`             | No        | `./data`                 | Data volume path           |
| `PORT`                 | No        | `7820`                   | Runtime server port        |
| `RUNTIME_URL`          | Dashboard | `http://localhost:7820`  | Runtime API URL            |
| `AI_BACKEND`           | No        | `claude`                 | CLI backend to use (`claude`, `codex`, `gemini`, `pi`, `ollama`) |
| `IDLE_TIMEOUT_MS`      | No        | `300000`                 | Agent idle timeout (5 min) |
| `MAX_AGENTS`           | No        | `10`                     | Max concurrent agents      |
| `EMBEDDING_PROVIDER`   | No        | `stub`                   | Embedding provider — **pyx-memory sidecar** env var (`stub`, `local`, `anthropic`, `openai`) |
| `LOG_LEVEL`            | No        | `info`                   | Log level (`debug`, `info`, `warn`, `error`) |
| `MODE`                 | No        | `standalone`             | Deployment mode (`standalone`, `managed`) |
| `MEMORY_SERVER_PORT`   | No        | `7822`                   | Memory sidecar port        |
| `MEMORY_URL`           | No        | —                        | Memory sidecar URL (set automatically in `--profile full`) |
| `RATE_LIMIT_MAX`       | No        | `100`                    | Max requests per window per IP |
| `RATE_LIMIT_WINDOW_MS` | No        | `60000`                  | Rate limit window duration (ms) |
| `TRUST_PROXY`          | No        | `false`                  | Trust X-Forwarded-For for IP extraction |
| `STREAM_TIMEOUT_MS`    | No        | `300000`                 | Max stream duration for AI responses (ms) |
| `OLLAMA_BASE_URL`      | No        | `http://localhost:11434` | Ollama API base URL                  |
| `OLLAMA_MODEL`         | No        | `llama3.2`               | Default Ollama model                 |
| `PI_API_KEY`           | No        | —                        | API key for Pi backend               |
| `PI_MODEL`             | No        | —                        | Pi model override (e.g., `openai/gpt-4.1`) |
| `ANTHROPIC_API_KEY`    | No        | —                        | API key for Claude CLI                               |
| `CODEX_API_KEY`        | No        | —                        | API key for OpenAI Codex CLI                         |
| `GEMINI_API_KEY`       | No        | —                        | API key for Google Gemini CLI                        |
| `CORS_ORIGIN`          | No        | `http://localhost:7821`  | Allowed CORS origin (e.g., `https://yourdomain.com`) |
| `FALLBACK_BACKEND`     | No        | —                        | Fallback AI backend if primary fails to spawn |
| `ENABLE_TERMINAL_WS`   | No        | `true`                   | PTY-based CLI login WebSocket (opt-out with `false`) |
| `ENABLE_ADVANCED_MEMORY`| No       | `true`                   | Consolidation, decay, summarization routes (opt-out with `false`) |
| `ENABLE_DEBUG_WS`      | No        | `true`                   | Enable debug event WebSocket |
| `DEBUG_WS_TOKEN`       | No        | —                        | Token to protect debug WebSocket endpoint |
| `MEMORY_RETRY_COUNT`   | No        | `30`                     | Number of retries when connecting to memory server at startup |
| `MEMORY_RETRY_DELAY_MS`| No        | `3000`                   | Delay between memory connection retries (ms) |

> **Note:** `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `PI_API_KEY`, and `PI_MODEL` are consumed directly by their respective backend implementations (not by `parseEnvConfig()`). Similarly, `ENABLE_DEBUG_WS` and `DEBUG_WS_TOKEN` are read ad-hoc in `main()`. All are functionally correct but not part of the typed `EnvironmentConfig` object.

---

## 13. Plugin System

The plugin system (`@autonomy/plugin-system`) provides event hooks and a middleware pipeline so products can customize behavior without modifying core source files.

### Core Components

| Component            | Purpose                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `HookRegistry`       | Central event bus — register handlers for hook points, emit fire-and-forget or waterfall events |
| `PluginManager`      | Plugin lifecycle — load, unload, shutdown; declarative hook registration                        |

### Hook Points

| Hook Name              | Enum Constant            | Location                 | Can Modify        | Can Reject        |
| ---------------------- | ------------------------ | ------------------------ | ----------------- | ----------------- |
| Before Message         | `BEFORE_MESSAGE`         | Before memory search     | message content   | Yes (return null) |
| After Memory Search    | `AFTER_MEMORY_SEARCH`    | After memory search      | memory results    | No                |
| Before Response        | `BEFORE_RESPONSE`        | Before AI call           | prompt text       | No                |
| After Response         | `AFTER_RESPONSE`         | After response generated | response content  | No                |
| Before Agent Create    | `BEFORE_AGENT_CREATE`    | Before agent spawn       | agent definition  | Yes (return null) |
| After Agent Create     | `AFTER_AGENT_CREATE`     | After agent spawn        | observation only  | No                |
| Before Agent Delete    | `BEFORE_AGENT_DELETE`    | Before agent stop        | —                 | Yes (return null) |
| Before Memory Store    | `BEFORE_MEMORY_STORE`    | Before memory store      | content, metadata | Yes (return null) |

### Design Principles

- **Zero overhead** when no plugins registered (fast-path `if` checks)
- **Error isolation** — buggy plugin handlers are caught and logged, never crash the system
- **Priority ordering** — handlers execute in priority order (lower = first)
- **Waterfall pattern** — data flows through handlers sequentially; returning `null` signals rejection

### Plugin Definition

```typescript
const myPlugin: PluginDefinition = {
  name: "my-plugin",
  version: "1.0.0",
  hooks: [
    {
      hookType: HookType.BEFORE_MESSAGE,
      handler: (data) => {
        /* transform */ return data;
      },
    },
  ],
  initialize: (registry) => {
    /* optional setup */
  },
  shutdown: () => {
    /* optional cleanup */
  },
};
```

### Integration Points

- **Conductor** accepts optional `hookRegistry` in `ConductorOptions` — fires 5 hooks during message processing (before_message, after_memory_search, before_response, after_response, before_memory_store)
- **AgentPool** accepts optional `hookRegistry` in `AgentPoolOptions` — fires 3 hooks during agent lifecycle (before_agent_create, after_agent_create, before_agent_delete)
- **Server bootstrap** creates `HookRegistry` + `PluginManager` and passes to both

---

## 14. Extension Interface

How products customize this template:

1. **Fork the repo**
2. **Add agent definitions** in `/data/agents/` — or users create via Dashboard UI
3. **Register plugin hooks** — `BEFORE_MESSAGE`, `AFTER_RESPONSE`, `BEFORE_AGENT_CREATE`, `BEFORE_MEMORY_STORE` etc. (see Section 13)
4. **Extend Conductor** — add routing logic, permissions, personality, pending question tracking
5. **Ingest domain data** into Memory via Dashboard UI (file upload) or API
6. **Add packages** to monorepo for product-specific logic
7. **Add channel adapters** by implementing webhook handlers on the server _(see Section 15 for planned adapters)_
8. **Customize Dashboard** — add product-specific pages/sections
9. **Customize Dockerfile** — add product dependencies

**The template provides the autonomous runtime.**
**The product provides the agents, data, and domain logic.**

### Fork-and-Use Scenario (e.g., Manufacturing Company)

```
1. git clone template && docker-compose up         ← 5 minutes
2. Open localhost:7821 (Dashboard)
3. Click "Create Agent" → create a QA specialist    ← like building an RPG party
4. Same flow for inventory management, report writing agents
5. Ingest company data into Memory
6. Start using immediately
   "Analyze this month's defect rate"
   → Conductor → delegates to Agent → result

All of the above works through the Dashboard UI alone — no code changes.
Custom code is only needed for advanced integrations (e.g., ERP).
```

---

## 15. Planned / Future

Items not yet implemented but part of the vision:

### Channel Adapters _(extension point)_

Webhook handlers for messaging platforms:

- Telegram
- Discord
- Slack

These would be implemented as additional packages in the monorepo that register webhook routes on the server and translate platform-specific message formats into the Conductor's `IncomingMessage` interface.

### Additional Backends

Community-contributed backends via the plugin SDK:

- **Copilot** — GitHub-native, missing structured output
- **Cline** — No session persistence
- **Aider** — No stdin pipe, one-shot only

### Organization Templates

YAML-based agent team definitions for pre-configuring multi-agent setups.

---

