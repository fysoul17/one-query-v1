# Autonomous AI Agent Runtime — Template Spec

> Single source of truth. Everything needed to implement this template.

---

## 1. What This Is

A template runtime that turns CLI AI tools (`claude -p`, Codex CLI, Gemini CLI, etc.) into an **autonomous agent system** with persistent memory, accessible via a built-in Dashboard UI.

**This is NOT a product.** It's the foundation. Products fork this and add:

- Agent definitions (roles, prompts)
- Domain-specific data (ingest into memory)
- Custom conductor logic (routing, permissions, personality)
- Channel adapters (Telegram, Discord, Slack)
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

1. **Memory** — 세션이 끝나도 기억 유지
2. **Docker** — 24시간 가동
3. **Agent Manager** — Multi-agent 관리
4. **Dashboard** — Non-dev도 사용 가능

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│              AUTONOMOUS AGENT RUNTIME (Docker, 24/7)             │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Bun.serve (HTTP Server)                                   │  │
│  │                                                            │  │
│  │  /api/*        → REST API (agent CRUD, memory, config)     │  │
│  │  /ws/chat      → WebSocket (real-time streaming)           │  │
│  │  /health       → Health check                              │  │
│  └────────────┬───────────────────────────────────────────────┘  │
│               │                                                   │
│               ▼                                                   │
│  ┌─────────────────────┐                                         │
│  │     CONDUCTOR        │  Simple AI agent with memory.           │
│  │                      │  Responds to messages via AI backend.   │
│  │  Searches memory     │  Delegates if targetAgentId specified.  │
│  │  for context before  │  Can create/delete agents.              │
│  │  responding.         │                                         │
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
│  │  MEMORY SYSTEM                                           │    │
│  │                                                          │    │
│  │  bun:sqlite     → structured data (sessions, config,     │    │
│  │                    agent registry)                        │    │
│  │                                                          │    │
│  │  LanceDB        → vector embeddings (default provider)   │    │
│  │                    semantic search, RAG                   │    │
│  │                                                          │    │
│  │  RAG Strategy:                                           │    │
│  │  └── Naive RAG    (query → retrieve → respond)           │    │
│  │                                                          │    │
│  │  Memory Types:                                           │    │
│  │  ├── Short-term   (conversation/session state)           │    │
│  │  └── Long-term    (persistent across sessions)           │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌──────────────┐                                                │
│  │ Cron Manager  │  Bun.CronJob, scheduled tasks (planned)      │
│  └──────────────┘                                                │
│                                                                   │
│  /data volume (persistent)                                       │
│  ├── agents/          # agent definitions + registry             │
│  ├── memory/          # long-term memory store                   │
│  ├── vectors/         # LanceDB data                             │
│  ├── crons.json       # schedules                                │
│  └── config.json      # runtime config                           │
└──────────────────────────────────────────────────────────────────┘

Dashboard (Next.js 16.1, separate service in docker-compose)
  └── Connects to Runtime API at http://runtime:3001
```

### Deployment Modes

```
SELF-HOSTED (docker-compose up)
──────────────────────────────────────────────────────
  ┌──────────────────────────────────────────────────┐
  │  docker-compose                                   │
  │                                                   │
  │  ┌─────────────────┐  ┌───────────────────────┐  │
  │  │  runtime:3001   │  │  dashboard:3000       │  │
  │  │                  │  │                       │  │
  │  │  Agent Manager   │  │  Next.js 16.1         │  │
  │  │  Conductor       │←─│  (standalone output)  │  │
  │  │  Memory System   │  │                       │  │
  │  │  Cron Manager    │  │  connects to          │  │
  │  │                  │  │  http://runtime:3001  │  │
  │  │  /data volume    │  │                       │  │
  │  └─────────────────┘  └───────────────────────┘  │
  │                                                   │
  │  Auth: basic auth or none (local network)         │
  │  DB: bun:sqlite + LanceDB (embedded, zero config) │
  └──────────────────────────────────────────────────┘
```

---

## 3. Tech Stack

| Layer            | Technology                                         | Why                                      |
| ---------------- | -------------------------------------------------- | ---------------------------------------- |
| Runtime          | Bun (latest)                                       | Fast, native TypeScript, built-in SQLite |
| Language         | TypeScript 5+                                      | Type safety                              |
| Monorepo         | Bun workspaces + Turborepo                         | Build orchestration                      |
| AI Backend       | claude -p (default)                                | Pluggable: codex, gemini, goose          |
| Vector DB        | LanceDB (embedded)                                 | 4MB idle, fast ANN, native TS SDK        |
| Structured DB    | bun:sqlite                                         | Embedded, zero config                    |
| Dashboard        | Next.js latest (App Router) + Tailwind + shadcn/ui | RSC, standalone output                   |
| Container        | Docker + docker-compose                            | One-click deploy                         |
| Linter           | Biome 2.3+                                         | Fast, unified linter + formatter         |
| Tests            | bun:test                                           | Built-in, fast                           |

---

## 4. Project Structure

```
template/
│
├── packages/
│   ├── server/                  # Bun.serve — API, WebSocket
│   ├── conductor/               # Simple AI agent with memory
│   ├── agent-manager/           # CLI AI process lifecycle
│   │   └── backends/            # Pluggable CLI backends (claude, codex, etc.)
│   ├── memory/                  # Persistent memory system
│   │   ├── rag/                 # Naive, Graph, Agentic RAG strategies
│   │   ├── providers/           # LanceDB (default)
│   │   ├── embeddings/          # Pluggable embedding providers (stub, anthropic, openai)
│   │   ├── graph/               # Graph stores (SQLite, Neo4j)
│   │   └── ingestion/           # File parsers + chunking pipeline
│   ├── memory-server/           # Standalone memory sidecar (:7822)
│   ├── cron-manager/            # Autonomous scheduling
│   └── shared/                  # Types, utils, constants
│
├── dashboard/                   # Next.js 16.1 (built-in UI)
│   └── app/
│       ├── (dashboard)/         # Home, Agents, Memory, Automation, Activity
│       ├── chat/                # Direct conversation
│       └── components/          # UI components
│
├── docker/
│   ├── Dockerfile.runtime
│   ├── Dockerfile.dashboard
│   ├── Dockerfile.memory
│   └── docker-compose.yaml
│
├── data/                        # Default /data volume contents
│   ├── agents/registry.json
│   ├── memory/
│   ├── vectors/
│   ├── crons.json
│   └── config.json
│
├── package.json                 # Workspace root
├── turbo.json
├── tsconfig.base.json
└── .env.example
```

---

## 5. Conductor — Simple AI Agent

The Conductor is a simple AI chat agent backed by a CLIBackend (default: `claude -p`). It receives all messages, searches memory for context, and responds. If a message targets a specific agent (`targetAgentId`), it delegates to that agent instead.

### Message Flow

```
User Message
    │
    ▼
┌──────────────────────────────────────────────────┐
│  CONDUCTOR                                        │
│                                                   │
│  1. Memory에서 관련 맥락 검색                      │
│  2. targetAgentId 있으면 → 해당 Agent에 위임       │
│  3. 없으면 → AI backend로 직접 응답 생성           │
│  4. Memory에 대화 저장                             │
│  5. 사용자에게 응답                                │
└──────────────────────────────────────────────────┘
```

### Pipeline

```
Message In → Memory Search → Delegate or Respond → Memory Store → Response Out
               (context)      (AI backend)          (if valuable)   (stream WS)
```

- **Memory search**: Queries vector DB for relevant context, wraps in `<memory-context>` tags
- **Delegation**: If `targetAgentId` is set, forwards message to that agent
- **AI response**: If no target, sends message (with memory context) to own AI backend process
- **Memory store**: Stores the conversation exchange for future retrieval

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

Each agent can use a different CLI backend. The BackendRegistry manages multiple backends:

| Capability          | Claude Code | Codex CLI | Gemini CLI | Goose    |
| ------------------- | ----------- | --------- | ---------- | -------- |
| Streaming           | ✅          | ✅        | ✅         | ✅       |
| Session Persistence | ✅          | ✅        | ✅         | ✅       |
| File Access         | ✅          | ✅        | ✅         | ✅       |

---

## 7. Memory System

### Storage Layer

| Store             | Technology                  | Purpose                                       |
| ----------------- | --------------------------- | --------------------------------------------- |
| Structured data   | bun:sqlite (embedded)       | Sessions, config, agent registry               |
| Vector embeddings | LanceDB (embedded, default) | Semantic search, RAG                           |

### Memory Types

- **Short-term**: Conversation/session state. Lives during a session, cleared after.
- **Long-term**: Persistent across sessions. All conversations, ingested data, agent outputs stored here.

### RAG Strategy

- **Naive RAG**: query → vector search → retrieve top-K → respond

### Ingestion

Dashboard UI에서:

- Text paste
- API endpoint (`POST /api/memory/ingest`)

---

## 8. Dashboard (Built-in UI)

Next.js 16.1, App Router, standalone output. Separate service in docker-compose.

```
Dashboard Pages:

├── 🏠 Home              — System status, recent activity, alerts
│
├── 🤖 Agents             — Agent management
│   ├── Agent list        — Cards: name, role, status, owner, backend badge
│   ├── Create Agent      — Name, role, prompt, tools, backend selector
│   ├── Agent actions     — Restart, delete
│   └── 🔒 Conductor      — View-only (status, system-protected)
│
├── 🧠 Memory             — Memory browser (stub)
│   └── Stats             — Storage used, vector count
│
├── 💬 Chat               — Direct conversation
│   ├── Conductor         — Talk to the Conductor AI
│   └── Direct to Agent   — Talk to specific agent (debugging/testing)
│
├── ⚡ Automation          — Cron management (stub)
│
└── 📊 Activity            — Debug Console
    ├── Timeline          — Who did what, when
    ├── Filters           — Category, level, search
    └── Live stream       — Real-time debug events via WebSocket
```

---

## 9. File Formats

### Agent Definition (`/data/agents/{name}.md`)

Frontmatter = machine config. Body = system prompt for the CLI backend.

Fields: id, name, role, tools (allowed tool list), canModifyFiles, canDelegateToAgents, maxConcurrent, owner (user|conductor|system), persistent (boolean), createdBy, createdAt.

### Agent Registry (`/data/agents/registry.json`)

Array of agent entries: id, file (path to .md), owner, autoStart (boolean).

### Cron Config (`/data/crons.json`)

Version + array of cron entries: id, name, schedule (cron syntax), timezone, enabled, workflow (steps array + output), createdBy, createdAt.

### Platform Config (`/data/config.json`)

Backend selection, API keys (per provider), default model, idle timeout, max agents, memory provider settings.

---

## 10. REST API

| Method   | Path                      | Description                    |
| -------- | ------------------------- | ------------------------------ |
| `GET`    | `/health`                 | Health check + system status   |
| `GET`    | `/api/agents`             | List all agents with status    |
| `POST`   | `/api/agents`             | Create agent                   |
| `PUT`    | `/api/agents/:id`         | Update agent                   |
| `DELETE` | `/api/agents/:id`         | Delete agent                   |
| `POST`   | `/api/agents/:id/restart` | Restart agent process          |
| `GET`    | `/api/memory/search`      | Search memory                  |
| `POST`   | `/api/memory/ingest`      | Ingest text                    |
| `GET`    | `/api/memory/stats`       | Memory statistics              |
| `GET`    | `/api/crons`              | List cron jobs                 |
| `POST`   | `/api/crons`              | Create cron                    |
| `PUT`    | `/api/crons/:id`          | Update cron                    |
| `DELETE` | `/api/crons/:id`          | Delete cron                    |
| `POST`   | `/api/crons/:id/trigger`  | Manually trigger cron          |
| `GET`    | `/api/activity`           | Activity timeline              |
| `GET`    | `/api/config`             | Get config (keys redacted)     |
| `PUT`    | `/api/config`             | Update config                  |

---

## 11. WebSocket Protocol

Client → Server:

- `message`: content + optional targetAgent (for direct agent chat)
- `ping`

Server → Client:

- `chunk`: streaming response content + agent id
- `complete`: response finished
- `error`: error message
- `pong`: keepalive
- `agent_status`: all agent statuses
- `conductor_status`: pipeline phase updates (memory_search, delegating, responding, memory_store)

---

## 12. Environment Variables

| Variable            | Required  | Default               | Description                             |
| ------------------- | --------- | --------------------- | --------------------------------------- |
| `DATA_DIR`          | No        | `./data`              | Data volume path                        |
| `PORT`              | No        | `3001`                | Runtime server port                     |
| `RUNTIME_URL`       | Dashboard | `http://localhost:3001` | Runtime API URL                        |
| `AI_BACKEND`        | No        | `claude`              | CLI backend to use                      |
| `IDLE_TIMEOUT_MS`   | No        | `300000`              | Agent idle timeout (5 min)              |
| `MAX_AGENTS`        | No        | `10`                  | Max concurrent agents                   |
| `VECTOR_PROVIDER`   | No        | `lancedb`             | Vector DB provider                      |
| `LOG_LEVEL`         | No        | `info`                | Log level                               |

---

## 13. Extension Interface

How products customize this template:

1. **Fork the repo**
2. **Add agent definitions** in `/data/agents/` — or users create via Dashboard UI
3. **Extend Conductor** — add routing logic, permissions, personality, pending question tracking
4. **Ingest domain data** into Memory via Dashboard UI or API
5. **Add packages** to monorepo for product-specific logic
6. **Add channel adapters** by implementing webhook handlers on the server
7. **Customize Dashboard** — add product-specific pages/sections
8. **Customize Dockerfile** — add product dependencies

**The template provides the autonomous runtime.**
**The product provides the agents, data, and domain logic.**

### Fork-and-Use Scenario (e.g., 제조업 회사)

```
1. git clone template && docker-compose up         ← 5분
2. localhost:3000 접속 (Dashboard)
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

## 14. Build Order

Implement in this sequence.

| Step | Package           | What                                                           | Status      |
| ---- | ----------------- | -------------------------------------------------------------- | ----------- |
| 1    | Scaffold          | Bun workspace, Turborepo, shared types                         | ✅ Done      |
| 2    | agent-manager     | CLI process spawn/communicate, pool, claude backend            | ✅ Done      |
| 3    | memory            | bun:sqlite schema, LanceDB integration, short/long-term, naive RAG | ✅ Done  |
| 4    | conductor         | Conductor class, agent CRUD, memory integration                | ✅ Done      |
| 5    | server            | REST API, WebSocket, Bun.serve entry                           | ✅ Done      |
| 6    | dashboard         | Next.js 16.1, agent management, chat, debug console            | ✅ Done      |
| 7    | backends          | BackendRegistry, per-agent backend selection, session support   | ✅ Done      |
| 8    | cron-manager      | CronManager class, workflow executor, server routes, dashboard UI | ✅ Done      |
| 9    | docker            | Dockerfile.runtime, Dockerfile.dashboard, docker-compose       | ✅ Done      |
| 10   | memory (advanced) | Memory-server sidecar, pluggable embeddings, Graph/Agentic RAG, file ingestion, Neo4j graph, memory browser UI | ✅ Done      |
| 11   | control-plane     | API key auth, usage tracking, quotas, instance registry, settings UI | ✅ Done      |
