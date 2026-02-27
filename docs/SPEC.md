# Autonomous AI Agent Runtime — Template Spec

> Single source of truth. Everything needed to understand and extend this template.
>
> Last synced with codebase: 2026-02-27

---

## 1. What This Is

A template runtime that turns CLI AI tools (`claude -p`, Codex CLI, Gemini CLI, Pi CLI) into an **autonomous agent system** with persistent memory, accessible via a built-in Dashboard UI.

**This is NOT a product.** It's the foundation. Products fork this and add:

- Agent definitions (roles, prompts)
- Domain-specific data (ingest into memory)
- Custom conductor logic (routing, permissions, personality)
- Channel adapters (Telegram, Discord, Slack) _(planned — see Section 16)_
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

    fork해서       fork해서       fork해서
    soul.md 추가   ERP 연동      출판 워크플로우
    메신저 강화    품질 Agent     작가/편집 Agent
    감정분석 추가  리포트 자동화  원고 파이프라인
```

**What this template solves:**

> "claude -p는 강력하지만, 세션이 끝나면 모든 게 사라지고, 24시간 돌릴 수 없고, 여러 agent를 관리할 수 없고, 일반인이 쓸 수 없다"

1. **Memory** — 세션이 끝나도 기억 유지 (4 memory types + Hybrid RAG)
2. **Docker** — 24시간 가동
3. **Agent Manager** — Multi-agent 관리 (5 backends)
4. **Dashboard** — Non-dev도 사용 가능

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
│  │  Rate Limiter │ Auth Middleware │ Usage Tracker             │  │
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
│  │  ├── Episodic     (conversation history)                  │    │
│  │  ├── Semantic     (facts, knowledge)                      │    │
│  │  └── Procedural   (how-to, workflows)                     │    │
│  │                                                           │    │
│  │  Lifecycle:                                               │    │
│  │  ├── Consolidation (every 30 min)                         │    │
│  │  ├── Decay (every 24h)                                    │    │
│  │  ├── Deduplication                                        │    │
│  │  ├── Summarization                                        │    │
│  │  └── Fact extraction                                      │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ Cron Manager  │  │ Control Plane │  │   Plugin System      │   │
│  │ (scheduled    │  │ (auth, usage, │  │   (8 hook points,    │   │
│  │  workflows)   │  │  quotas)      │  │    middleware)        │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ DebugBus     │  │ ActivityLog  │  │ SecretStore           │   │
│  │ (ring buffer │  │ (in-memory   │  │ (encrypted backend    │   │
│  │  + pub/sub)  │  │  ring buffer)│  │  API keys)            │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
│                                                                   │
│  /data volume (persistent)                                       │
│  ├── agents/           # agent definitions + registry            │
│  ├── crons.json        # scheduled task definitions              │
│  ├── config.json       # runtime config                          │
│  └── control-plane.sqlite  # auth, usage, sessions, agents       │
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
  │  │  Memory (embed.) │  │                       │  │
  │  │  Control Plane   │  │  connects to          │  │
  │  │  Cron Manager    │  │  http://runtime:7820  │  │
  │  │  Plugin System   │  │                       │  │
  │  │  /data volume    │  │                       │  │
  │  └─────────────────┘  └───────────────────────┘  │
  │                                                   │
  │  Auth: API key + optional dashboard login          │
  │  DB: bun:sqlite + LanceDB (embedded, zero config)  │
  └──────────────────────────────────────────────────┘

FULL (docker-compose --profile full up)
──────────────────────────────────────────────────────
  ┌──────────────────────────────────────────────────┐
  │  + memory sidecar :7822                           │
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
| Memory        | pyx-memory (git submodule)                                     | Hybrid RAG, graph store, lifecycle       |
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
│   ├── control-plane/           # Auth, usage tracking, quotas, instance registry
│   ├── cron-manager/            # Scheduled task workflows
│   ├── plugin-system/           # Event hooks, middleware pipeline, plugin manager
│   └── server/                  # Bun.serve — wires everything, HTTP + WebSocket + routes
│
├── vendor/
│   └── pyx-memory/              # Git submodule → fysoul17/pyx-memory-v1
│       └── packages/
│           ├── shared/          # Memory types, enums (@pyx-memory/shared)
│           ├── client/          # MemoryInterface + HTTP client (@pyx-memory/client)
│           ├── core/            # SQLite + LanceDB + RAG + embeddings + lifecycle (@pyx-memory/core)
│           ├── server/          # Standalone memory sidecar (:7822)
│           └── dashboard/       # Memory browser UI components
│
├── dashboard/                   # Next.js 16.1 (built-in cyberpunk UI)
│   └── app/
│       ├── (auth)/login/        # Dashboard authentication
│       ├── (dashboard)/         # Home, Agents, Chat, Memory, Automation, Activity, Sessions, Settings
│       ├── api/                 # Next.js API routes (login/logout)
│       ├── components/          # UI components organized by feature
│       ├── hooks/               # Custom React hooks (useWebSocket, etc.)
│       └── lib/                 # api-server.ts (SSR fetch), auth.ts
│
├── docker/
│   ├── Dockerfile.runtime
│   ├── Dockerfile.dashboard
│   ├── Dockerfile.memory
│   └── docker-compose.yaml
│
├── data/                        # Default /data volume contents
│   ├── agents/registry.json     # Persisted agent definitions
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
│     ├── User message → SHORT_TERM                 │
│     └── Assistant response → EPISODIC             │
│     └── BEFORE_MEMORY_STORE hook                  │
└──────────────────────────────────────────────────┘
```

### Session Backend Management

- Each session gets its own `BackendProcess`, lazily spawned
- Per-session config overrides (from `/model sonnet`-style slash commands)
- LRU eviction at 100 concurrent session processes
- Serial message queue (one message at a time per session)

### Agent Management

The Conductor can create and delete agents. Products can extend this with custom logic (permissions, approval workflows, dynamic creation).

### Agent Ownership in Dashboard

```
🤖 Agents

  ┌──────────────────────────────────┐
  │ 품질검사 전문가           [active] │
  │ 리포트 작성               [idle]  │
  │ data-processor            [busy]  │
  └──────────────────────────────────┘

  🔒 Conductor               [active]  ← 시스템 고정
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
| Custom Tools        | ✅          | ❌        | ❌         | ❌     | ❌        |
| Streaming           | ✅          | ✅        | ✅         | ✅     | ✅        |
| Session Persistence | ✅          | ✅        | ✅         | ✅     | ❌ (in-memory) |
| File Access         | ✅          | ✅        | ❌         | ❌     | ❌        |

> **Note:** Ollama is HTTP-based (not CLI-based). It connects to a locally running Ollama server via `/api/chat`. No API key needed.
>
> **Planned:** Tier 2 community backends (Copilot, Cline, Aider). See `docs/CLI-BACKEND-RESEARCH.md` for details.

---

## 7. Memory System (pyx-memory)

Memory is powered by [pyx-memory](https://github.com/fysoul17/pyx-memory-v1), consumed via git submodule at `vendor/pyx-memory`. Runs **embedded** (in-process, zero-latency) or as a **sidecar** (standalone HTTP service with Neo4j graph store).

### Storage Layer

| Store             | Technology                          | Purpose                               |
| ----------------- | ----------------------------------- | ------------------------------------- |
| Structured data   | bun:sqlite (WAL mode)               | Sessions, config, agent registry, graph nodes/edges |
| Vector embeddings | LanceDB (embedded, 384-dim local)   | Semantic search, RAG                  |
| Graph store       | SQLiteGraphStore (default) or Neo4j | Entity/relation graph for Graph RAG   |

### Memory Types

| Type          | Enum              | Purpose                                        |
| ------------- | ----------------- | ---------------------------------------------- |
| Short-term    | `SHORT_TERM`      | Conversation/session state                     |
| Episodic      | `EPISODIC`        | Conversation history (assistant responses)     |
| Semantic      | `SEMANTIC`        | Facts, knowledge, extracted information        |
| Procedural    | `PROCEDURAL`      | How-to instructions, workflows                 |

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

### Ingestion

- Text paste via Dashboard UI
- File upload via Dashboard UI (`POST /api/memory/ingest/file`)
- API endpoint (`POST /api/memory/ingest`)
- Ingestion pipeline with chunkers (semantic, structural), parsers, and classifiers

### Embedding Providers

| Provider   | Enum         | Dimensions | Notes                           |
| ---------- | ------------ | ---------- | ------------------------------- |
| Local      | `LOCAL`      | 384        | Default, no API key needed      |
| Stub       | `STUB`       | 384        | For testing, random vectors     |
| Anthropic  | `ANTHROPIC`  | varies     | Requires API key                |
| OpenAI     | `OPENAI`     | varies     | Requires API key                |

---

## 8. Control Plane

The control plane (`@autonomy/control-plane`) provides production-grade access control and observability, all backed by SQLite (`control-plane.sqlite`).

### Components

| Component          | Purpose                                                          |
| ------------------ | ---------------------------------------------------------------- |
| `AuthStore`        | API key management (create, validate, enable/disable, expire). Keys use `ak_` prefix + SHA-256 hashing. |
| `AuthMiddleware`   | Reads `Authorization: Bearer <key>` or `?token=<key>`. Master key bypass for admin ops. |
| `UsageStore`       | Per-key request tracking (endpoint, duration, status)            |
| `UsageTracker`     | Fire-and-forget tracking after each HTTP response                |
| `QuotaManager`     | Per-key daily/monthly request limits                             |
| `InstanceRegistry` | Multi-instance registry with heartbeat (30s) and stale detection (90s) |
| `AgentStore`       | SQLite persistence for `AgentDefinition` objects. Used by `AgentPool` to restore agents across restarts. |

---

## 9. Dashboard (Built-in UI)

Next.js 16.1, App Router, standalone output. Separate service in docker-compose. Cyberpunk-themed with glass-morphism cards, neon accents, and scanline effects.

```
Dashboard Pages:

├── 🏠 Home              — System health, agent stats, memory stats, instance status (SSR)
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
├── ⚙️ Settings            — Runtime configuration
│   ├── Config            — AI backend, max agents, timeouts, etc.
│   ├── API Keys          — Create, enable, disable, delete API keys
│   ├── Usage             — Daily/monthly request analytics per key
│   └── Backends          — Backend status, API key management, logout
│
└── 🔐 Login               — Dashboard authentication (env-var toggle)
    ├── Username/password  — Via DASHBOARD_USER + DASHBOARD_PASSWORD env vars
    ├── HMAC session token — Signed cookie, no server-side session store
    └── Disabled by default — Zero friction for local dev
```

---

## 10. File Formats

### Agent Definition (`/data/agents/{name}.md`)

Frontmatter = machine config. Body = system prompt for the CLI backend.

Fields: id, name, role, tools (allowed tool list), canModifyFiles, canDelegateToAgents, maxConcurrent, owner (user|conductor|system), persistent (boolean), createdBy, createdAt.

### Agent Registry (`/data/agents/registry.json`)

Array of agent entries: id, file (path to .md), owner, autoStart (boolean).

### Cron Config (`/data/crons.json`)

Version + array of cron entries: id, name, schedule (cron syntax), timezone, enabled, workflow (steps array + output), createdBy, createdAt.

### Platform Config (`/data/config.json`)

Runtime config overrides. Empty `{}` uses defaults from `DEFAULTS` constant.

---

## 11. REST API

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
| `GET`    | `/api/memory/consolidation-log`               | Consolidation log                |
| `GET`    | `/api/memory/query-as-of`                     | Query memory at a point in time  |

### Memory Graph Routes

| Method   | Path                              | Description                     |
| -------- | --------------------------------- | ------------------------------- |
| `GET`    | `/api/memory/graph/nodes`         | List graph nodes                |
| `POST`   | `/api/memory/graph/nodes`         | Create graph node               |
| `DELETE` | `/api/memory/graph/nodes/:id`     | Delete graph node               |
| `GET`    | `/api/memory/graph/edges`         | Graph stats (node/edge counts)  |
| `GET`    | `/api/memory/graph/relationships` | Get entity relationships        |
| `POST`   | `/api/memory/graph/relationships` | Create graph relationship       |
| `POST`   | `/api/memory/graph/query`         | Query the graph (traverse)      |

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

### Auth & Control Plane Routes

| Method   | Path                        | Description                            |
| -------- | --------------------------- | -------------------------------------- |
| `GET`    | `/api/auth/keys`            | List API keys                          |
| `POST`   | `/api/auth/keys`            | Create API key                         |
| `PUT`    | `/api/auth/keys/:id`        | Update API key                         |
| `DELETE` | `/api/auth/keys/:id`        | Delete API key                         |
| `GET`    | `/api/usage/summary`        | Usage analytics                        |
| `GET`    | `/api/usage/quotas/:keyId`  | Get quotas for a key                   |
| `PUT`    | `/api/usage/quotas/:keyId`  | Update quotas for a key                |
| `GET`    | `/api/instances`            | List runtime instances                 |
| `DELETE` | `/api/instances/:id`        | Remove instance                        |

### Backend Routes

| Method   | Path                          | Description                   |
| -------- | ----------------------------- | ----------------------------- |
| `GET`    | `/api/backends/status`        | Status of all backends        |
| `GET`    | `/api/backends/options`       | Config options per backend    |
| `PUT`    | `/api/backends/:name/api-key` | Update backend API key        |
| `POST`   | `/api/backends/:name/logout`  | Logout from backend           |

### Dashboard Auth (Next.js API Routes)

| Method   | Path                      | Description                  |
| -------- | ------------------------- | ---------------------------- |
| `POST`   | `/api/auth/login`         | Validate credentials, set session cookie |
| `POST`   | `/api/auth/logout`        | Clear session cookie         |

These are Next.js API routes (dashboard-side), not runtime routes. Auth is disabled by default — enabled when both `DASHBOARD_USER` and `DASHBOARD_PASSWORD` env vars are set. Session tokens are HMAC-signed cookies (no server-side session store).

---

## 12. WebSocket Protocol

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
| `thinking`         | Model thinking/reasoning content                      |
| `tool_start`       | Tool use started (name, id)                           |
| `tool_input`       | Tool input data                                       |
| `tool_complete`    | Tool use finished (result)                            |
| `agent_status`     | All agent statuses (broadcast every 5s)               |
| `conductor_status` | Pipeline phase: QUEUED, MEMORY_SEARCH, CONTEXT_INJECT, DELEGATING, RESPONDING, MEMORY_STORE, DELEGATION_COMPLETE |
| `SESSION_INIT`     | Session ID assigned                                   |
| `STREAM_RESUME`    | Replay buffered content on reconnect                  |
| `pong`             | Keepalive response                                    |

**Limits:**
- Per-socket rate limit: 10 messages / 60 seconds
- Max message size: 64 KB
- Max concurrent clients: 100

### Stream Buffer

The `StreamBuffer` accumulates streamed content per session. When a client reconnects, it receives a `STREAM_RESUME` message replaying all buffered chunks so far.

---

## 13. Environment Variables

| Variable               | Required  | Default                  | Description                |
| ---------------------- | --------- | ------------------------ | -------------------------- |
| `DATA_DIR`             | No        | `./data`                 | Data volume path           |
| `PORT`                 | No        | `7820`                   | Runtime server port        |
| `RUNTIME_URL`          | Dashboard | `http://localhost:7820`  | Runtime API URL            |
| `AI_BACKEND`           | No        | `claude`                 | CLI backend to use (`claude`, `codex`, `gemini`, `pi`, `ollama`) |
| `IDLE_TIMEOUT_MS`      | No        | `300000`                 | Agent idle timeout (5 min) |
| `MAX_AGENTS`           | No        | `10`                     | Max concurrent agents      |
| `VECTOR_PROVIDER`      | No        | `lancedb`                | Vector DB provider (`lancedb`, `qdrant`) |
| `EMBEDDING_PROVIDER`   | No        | `stub`                   | Embedding provider (`stub`, `local`, `anthropic`, `openai`) |
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
| `DASHBOARD_USER`       | No        | —                        | Dashboard login username (auth disabled if unset) |
| `DASHBOARD_PASSWORD`   | No        | —                        | Dashboard login password (auth disabled if unset) |
| `DASHBOARD_SECRET`     | No        | (uses `DASHBOARD_PASSWORD`) | Separate HMAC signing key for session tokens |
| `DASHBOARD_SESSION_TTL`| No        | `86400`                  | Session duration in seconds (24h) |

---

## 14. Plugin System

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
      hookType: HookType.ON_MESSAGE,
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

## 15. Extension Interface

How products customize this template:

1. **Fork the repo**
2. **Add agent definitions** in `/data/agents/` — or users create via Dashboard UI
3. **Register plugin hooks** — `BEFORE_MESSAGE`, `AFTER_RESPONSE`, `BEFORE_AGENT_CREATE`, `BEFORE_MEMORY_STORE` etc. (see Section 14)
4. **Extend Conductor** — add routing logic, permissions, personality, pending question tracking
5. **Ingest domain data** into Memory via Dashboard UI (file upload) or API
6. **Add packages** to monorepo for product-specific logic
7. **Add channel adapters** by implementing webhook handlers on the server _(see Section 16 for planned adapters)_
8. **Customize Dashboard** — add product-specific pages/sections
9. **Customize Dockerfile** — add product dependencies

**The template provides the autonomous runtime.**
**The product provides the agents, data, and domain logic.**

### Fork-and-Use Scenario (e.g., 제조업 회사)

```
1. git clone template && docker-compose up         ← 5분
2. localhost:7821 접속 (Dashboard)
3. "Create Agent" 버튼 → 품질검사 전문가 생성       ← RPG처럼
4. 같은 방식으로 재고관리, 리포트 작성 Agent 생성
5. Memory에 회사 데이터 Ingest
6. 바로 사용 시작
   "이번 달 불량률 분석해줘"
   → Conductor → Agent에게 위임 → 결과

코드 수정 없이 Dashboard UI만으로 여기까지 가능.
커스텀 코드는 ERP 연동 등 심화 단계에서만 필요.
```

---

## 16. Planned / Future

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

## 17. Build History

Implementation sequence (all complete):

| Step | Package           | What                                                                                                           | Status     |
| ---- | ----------------- | -------------------------------------------------------------------------------------------------------------- | ---------- |
| 1    | Scaffold          | Bun workspace, Turborepo, shared types                                                                         | ✅ Done    |
| 2    | agent-manager     | CLI process spawn/communicate, pool, claude backend                                                            | ✅ Done    |
| 3    | pyx-memory        | SQLite + LanceDB, 4 memory types, Hybrid/Graph/Agentic/Naive RAG, lifecycle, graph store, ingestion pipeline  | ✅ Done    |
| 4    | conductor         | 7-step pipeline with hooks, per-session backends, memory integration                                           | ✅ Done    |
| 5    | server            | REST API, 3 WebSocket endpoints, Bun.serve entry, stream buffer, rate limiter                                  | ✅ Done    |
| 6    | dashboard         | Next.js 16.1, all pages (home, agents, chat, memory, automation, activity, sessions, settings), cyberpunk theme | ✅ Done    |
| 7    | backends          | BackendRegistry, 5 backends (claude, codex, gemini, pi, ollama), session support                               | ✅ Done    |
| 8    | cron-manager      | CronManager class, workflow executor, concurrent guard, server routes, dashboard UI                             | ✅ Done    |
| 9    | docker            | Dockerfile.runtime, Dockerfile.dashboard, docker-compose (minimal + full profiles)                              | ✅ Done    |
| 10   | control-plane     | API key auth (SHA-256), usage tracking, quotas, instance registry, settings UI                                  | ✅ Done    |
| 11   | plugin-system     | HookRegistry (8 hooks), PluginManager, waterfall + fire-and-forget                                             | ✅ Done    |
| 12   | sessions          | SessionStore (SQLite), conversation history API, session browse/resume/delete, dashboard UI                     | ✅ Done    |
| 13   | dashboard-enhance | File upload in memory page, dashboard auth (login/logout), live health widget                                   | ✅ Done    |
| 14   | production        | IP rate limiting, structured JSON logging with redaction, standardized streaming contract                       | ✅ Done    |
| 15   | ci-cd             | GitHub Actions 3-job workflow (quality/e2e/docker), E2E integration tests                                       | ✅ Done    |

### Remaining Work

Gaps between spec and implementation, tracked step-by-step:

| Step | Area              | What                                                                                      | Status        |
| ---- | ----------------- | ----------------------------------------------------------------------------------------- | ------------- |
| R1   | CI/Docker         | Create `docker/Dockerfile.memory` (CI references it but it was missing)                   | ✅ Done       |
| R2   | Pi backend        | Add `logout()` method to `PiBackend` (dashboard calls `/api/backends/:name/logout`)       | ✅ Done       |
| R3   | Codex backend     | Real NDJSON streaming via `--json` flag (currently fakes streaming with single chunk)      | ✅ Done       |
| R4   | Gemini backend    | Real streaming via `--output-format stream-json` (currently fakes streaming)               | ✅ Done       |
| R5   | Ollama backend    | New HTTP-based backend for local LLM via Ollama API (`/api/chat`, `/api/generate`)        | ✅ Done       |
| R6   | Seed agents       | Populate `packages/server/src/seeds/index.ts` with 3 starter agents (Researcher, Writer, Analyst) | ✅ Done       |
| R7   | E2E tests         | Expand E2E test coverage: backends, crons, lifecycle, activity, seeds (36 tests total)     | ✅ Done       |
