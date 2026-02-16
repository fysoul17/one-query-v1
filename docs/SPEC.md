# Autonomous AI Agent Runtime — Final Spec

> Single source of truth. Everything needed to implement this template.

---

## 1. What This Is

A template runtime that turns CLI AI tools (`claude -p`, Codex CLI, Gemini CLI, etc.) into a **24/7 autonomous multi-agent system** with persistent memory, accessible remotely via messaging channels (Telegram, Discord, Slack) and a built-in Dashboard UI.

**This is NOT a product.** It's the foundation. Products fork this and add:

- Agent definitions (roles, prompts)
- Domain-specific data (ingest into memory)
- Custom orchestration logic
- Branding / additional UI

**Template = Game Engine. Product = Game built on the engine.**

```
                    This Template
                        │
          ┌─────────────┼─────────────┐
          │             │             │
          ▼             ▼             ▼
    ┌──────────┐  ┌──────────┐  ┌──────────┐
    │   Pyx    │  │  제조업   │  │  출판사   │
    │          │  │ Company  │  │ Publisher │
    │ OaaS/   │  │          │  │          │
    │ CaaS    │  │ AI 품질팀│  │ AI 작가팀│
    │ product │  │          │  │          │
    └──────────┘  └──────────┘  └──────────┘

    fork해서       fork해서       fork해서
    soul.md 추가   ERP 연동      출판 워크플로우
    메신저 강화    품질 Agent     작가/편집 Agent
    감정분석 추가  리포트 자동화  원고 파이프라인
```

**Use cases enabled by this template:**

- **OaaS** (Organization as a Service) — AI agent teams that collaborate
- **CaaS** (Companion as a Service) — Personalized AI companions
- **Domain-specific agent workforce** — manufacturing QA, publishing, research, etc.

**What this template solves:**

> "claude -p는 강력하지만, 세션이 끝나면 모든 게 사라지고, 24시간 돌릴 수 없고, 여러 agent를 조율할 수 없고, 일반인이 쓸 수 없다"

1. **Memory** — 세션이 끝나도 기억 유지
2. **Docker + Channel** — 24시간 가동 + 원격 접근
3. **Agent Manager + Conductor** — Multi-agent 협업
4. **Dashboard** — Non-dev도 사용 가능

---

## 2. Architecture

### 2.1 Runtime Container (핵심)

```
┌──────────────────────────────────────────────────────────────────┐
│              AUTONOMOUS AGENT RUNTIME (Docker, 24/7)             │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Bun.serve (HTTP Server)                                   │  │
│  │                                                            │  │
│  │  /api/*        → REST API (agent CRUD, cron, config)       │  │
│  │  /ws/chat      → WebSocket (real-time streaming)           │  │
│  │  /webhook/*    → Channel webhooks (Telegram/Discord/Slack) │  │
│  │  /health       → Health check                              │  │
│  └────────────┬───────────────────────────────────────────────┘  │
│               │                                                   │
│               ▼                                                   │
│  ┌─────────────────────┐                                         │
│  │     CONDUCTOR        │  System-level AI. Cannot be deleted.    │
│  │     (Mother AI)      │  Receives all messages first.           │
│  │                      │  Routes, delegates, synthesizes.        │
│  │  Can create/modify/  │  Has full memory access.                │
│  │  delete agents       │                                         │
│  └──────┬───────────────┘                                         │
│         │                                                         │
│    ┌────┴─────┬──────────┬──────────┐                            │
│    ▼          ▼          ▼          ▼                             │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────────┐                     │
│ │Agent │ │Agent │ │Agent │ │Agent (temp   │                     │
│ │  A   │ │  B   │ │  C   │ │or permanent) │                     │
│ │(user)│ │(user)│ │(cond)│ │(conductor-   │                     │
│ │      │ │      │ │      │ │ created)     │                     │
│ └──┬───┘ └──────┘ └──────┘ └──────────────┘                     │
│    │         ▲                                                    │
│    └── A2A ──┘  (direct if CLI supports, else Conductor relays)  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  MEMORY SYSTEM                                           │    │
│  │                                                          │    │
│  │  bun:sqlite     → structured data (sessions, config,     │    │
│  │                    graph edges, agent registry)           │    │
│  │                                                          │    │
│  │  LanceDB        → vector embeddings (default provider)   │    │
│  │  (or Qdrant)      semantic search, RAG                   │    │
│  │                                                          │    │
│  │  RAG Strategies:                                         │    │
│  │  ├── Naive RAG    (query → retrieve → respond)           │    │
│  │  ├── Graph RAG    (entity graph + vector search)         │    │
│  │  └── Agentic RAG  (query → retrieve → reason → retrieve)│    │
│  │                                                          │    │
│  │  Memory Types:                                           │    │
│  │  ├── Short-term   (conversation/session state)           │    │
│  │  └── Long-term    (persistent across sessions)           │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐                              │
│  │ Cron Manager  │  │ Channel      │                              │
│  │               │  │ Adapter      │                              │
│  │ Bun.CronJob   │  │              │                              │
│  │ Self-modifying│  │ Telegram     │                              │
│  │ (agents can   │  │ Discord      │                              │
│  │  edit crons)  │  │ Slack        │                              │
│  └──────────────┘  └──────────────┘                              │
│                                                                   │
│  /data volume (persistent)                                       │
│  ├── agents/          # agent definitions + registry             │
│  ├── memory/          # long-term memory store                   │
│  ├── vectors/         # LanceDB data                             │
│  ├── crons.json       # schedules                                │
│  └── config.json      # runtime config                           │
└──────────────────────────────────────────────────────────────────┘

Dashboard (Next.js 15, separate service in docker-compose)
  └── Connects to Runtime API at http://runtime:3001
```

### 2.2 Deployment Modes

```
SELF-HOSTED (docker-compose up)
──────────────────────────────────────────────────────

  ┌──────────────────────────────────────────────────┐
  │  docker-compose                                   │
  │                                                   │
  │  ┌─────────────────┐  ┌───────────────────────┐  │
  │  │  runtime:3001   │  │  dashboard:3000       │  │
  │  │                  │  │                       │  │
  │  │  Agent Manager   │  │  Next.js 15           │  │
  │  │  Conductor       │←─│  (standalone output)  │  │
  │  │  Memory System   │  │                       │  │
  │  │  Cron Manager    │  │  connects to          │  │
  │  │  Channel Adapter │  │  http://runtime:3001  │  │
  │  │                  │  │                       │  │
  │  │  /data volume    │  │                       │  │
  │  └─────────────────┘  └───────────────────────┘  │
  │                                                   │
  │  Auth: basic auth or none (local network)         │
  │  DB: bun:sqlite + LanceDB (embedded, zero config) │
  └──────────────────────────────────────────────────┘


CLOUD MODE (managed service, like n8n Cloud)
──────────────────────────────────────────────────────

  ┌──────────────────────────────────────────────────┐
  │  CONTROL PLANE (shared)                           │
  │                                                   │
  │  ┌──────────┐  ┌───────────┐  ┌──────────┐      │
  │  │  Auth    │  │ Container │  │ Billing  │      │
  │  │(Supabase)│  │ Orch.     │  │ (Stripe) │      │
  │  └──────────┘  └─────┬─────┘  └──────────┘      │
  │                       │                           │
  │  ┌────────────────────┼────────────────────┐     │
  │  │  Portal Website    │  (Next.js)         │     │
  │  │  - Landing page    │                    │     │
  │  │  - Auth pages      │                    │     │
  │  │  - Onboarding      │                    │     │
  │  │  - Billing/Plans   │                    │     │
  │  └────────────────────┼────────────────────┘     │
  └───────────────────────┼──────────────────────────┘
                          │
            Reverse Proxy │ (user-id.domain.com → container)
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
  │ User Container│ │ User Container│ │ User Container│
  │ (SAME IMAGE  │ │ (SAME IMAGE  │ │ (SAME IMAGE  │
  │  as self-    │ │  as self-    │ │  as self-    │
  │  hosted!)    │ │  hosted!)    │ │  hosted!)    │
  └──────────────┘ └──────────────┘ └──────────────┘

  Auth: Supabase (JWT from Control Plane)
  DB: Supabase PostgreSQL (shared)

  Key insight: Same Docker image in both modes.
  Environment variable MODE=standalone vs MODE=managed
```

---

## 3. Tech Stack

| Layer                | Technology                                         | Why                                      |
| -------------------- | -------------------------------------------------- | ---------------------------------------- |
| Runtime              | Bun (latest)                                       | Fast, native TypeScript, built-in SQLite |
| Language             | TypeScript 5+                                      | Type safety                              |
| Monorepo             | Bun workspaces + Turborepo                         | Build orchestration                      |
| AI Backend           | claude -p (default)                                | Pluggable: codex, gemini, etc.           |
| Vector DB            | LanceDB (embedded)                                 | 4MB idle, fast ANN, native TS SDK        |
| Vector DB (optional) | Qdrant                                             | For large-scale production               |
| Structured DB        | bun:sqlite                                         | Embedded, zero config                    |
| Dashboard            | Next.js latest (App Router) + Tailwind + shadcn/ui | RSC, standalone output                   |
| Container            | Docker + docker-compose                            | One-click deploy                         |
| Channels             | grammY, discord.js, @slack/bolt                    | Telegram, Discord, Slack                 |
| Cloud (optional)     | Fly.io Machines API, Railway, AWS, GCP             | Container orchestration                  |
| Auth (optional)      | Supabase Auth                                      | Cloud mode only                          |

---

## 4. Project Structure

```
template/
│
├── packages/
│   ├── server/                  # Bun.serve — API, WebSocket, Webhooks
│   ├── conductor/               # Mother AI — system-level orchestrator
│   ├── agent-manager/           # CLI AI process lifecycle + A2A
│   │   └── backends/            # Pluggable CLI backends (claude, codex, etc.)
│   ├── memory/                  # Persistent memory system
│   │   ├── rag/                 # Naive, Graph, Agentic RAG strategies
│   │   └── providers/           # LanceDB (default), Qdrant (optional)
│   ├── cron-manager/            # Autonomous scheduling
│   └── shared/                  # Types, utils, constants
│
├── dashboard/                   # Next.js 15 (built-in UI)
│   └── app/
│       ├── agents/              # RPG-style agent creation/management
│       ├── memory/              # Memory browser + ingest
│       ├── chat/                # Direct conversation
│       ├── automation/          # Cron management
│       ├── activity/            # Monitoring + A2A logs
│       ├── channels/            # Telegram/Discord/Slack setup
│       └── settings/            # API keys, backend, system config
│
├── control-plane/               # Cloud mode only (same monorepo)
│   ├── portal/                  # Landing, Auth, Onboarding, Billing
│   └── orchestrator/            # Container lifecycle (Fly/AWS/GCP providers)
│
├── docker/
│   ├── Dockerfile.runtime
│   ├── Dockerfile.dashboard
│   └── docker-compose.yaml
│
├── agents/                      # Default agent definitions
│   └── default.md
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

## 5. Conductor — Mother AI

System-level orchestrator. Cannot be deleted. Receives all messages first.

### Permissions

```
Conductor permissions:

  Agents it created (temporary or permanent):
  ├── Create   ✅ freely
  ├── Modify   ✅ freely
  └── Delete   ✅ freely

  User-created agents:
  ├── Delegate tasks to   ✅ freely
  ├── Modify              ⚠️ requires user approval
  └── Delete              ⚠️ requires user approval

  Itself:
  └── Modify/Delete       ❌ system-protected, impossible

  Memory:
  └── Full access         ✅ read/write

  Crons:
  └── Full access         ✅ create/modify/delete
```

### Message Flow

```
User Message (from any channel)
    │
    ▼
┌──────────────────────────────────────────────────┐
│  CONDUCTOR                                        │
│                                                   │
│  1. Memory에서 관련 맥락 검색                      │
│  2. 기존 Agent 중 적합한 것 확인                   │
│  3. 필요하면 새 Agent 생성 (permanent or temporary)│
│  4. Task 분배 (parallel or sequential)            │
│  5. A2A로 Agent들이 서로 결과 주고받기             │
│  6. 최종 결과 종합                                 │
│  7. Memory에 결과 저장                             │
│  8. 사용자에게 응답                                │
└──────────┬──────────┬──────────┬─────────────────┘
           │          │          │
     delegate    delegate    delegate
           │          │          │
           ▼          ▼          ▼
       ┌──────┐  ┌──────┐  ┌──────┐
       │Agent │  │Agent │  │Agent │
       │  A   │  │  B   │  │  C   │
       └──┬───┘  └──────┘  └──┬───┘
          │                    │
          └──── A2A comm ──────┘
```

### AI Routing (Step 7)

The Conductor has its own `CLIBackend` process that makes intelligent routing decisions. When a message arrives:

1. **Memory search** → relevant context retrieved
2. **AI routing** → Conductor AI receives available agents list + memory context + user message, outputs JSON `{ agentIds, createAgent?, reason }`
3. **Dynamic agent creation** → if no suitable agent exists, Conductor creates one on the fly (conductor-owned, non-persistent)
4. **Delegation** → message forwarded to selected/created agent(s) with memory context wrapped in `<memory-context>` tags

**Fallback chain**: AI returns valid JSON → use it; invalid JSON → keyword router; hallucinated agent IDs → filter then keyword fallback; AI process fails → keyword router. Backward compatible — if no CLIBackend is provided, falls back to keyword-based routing.

**Safety**: `validateAgentCreation()` enforces length limits and blocklists dangerous patterns (curl, wget, process.env, etc.) in AI-generated system prompts. MaxAgents enforcement with idle conductor-agent eviction. Delegation depth limit (default: 5).

**Real-time status**: `ConductorEvent` callback emits routing/creating_agent/agent_created/delegating events. Server maps these to `conductor_status` WebSocket messages. Dashboard renders them as system status messages.

### Agent Ownership in Dashboard

```
🤖 Agents

  User-created (수정/삭제 가능)
  ┌──────────────────────────────────┐
  │ 📌 품질검사 전문가       [active] │
  │ 📌 리포트 작성           [idle]   │
  └──────────────────────────────────┘

  Conductor-created (Conductor가 관리)
  ┌──────────────────────────────────┐
  │ 🔄 section-analyst-1     [busy]  │  ← 임시 또는 영구
  │ 🔄 data-processor        [idle]  │  ← Conductor 판단으로 생성
  │ 🔄 temp-translator       [busy]  │
  └──────────────────────────────────┘

  🔒 Conductor               [active]  ← 시스템 고정, 수정 불가
```

---

## 6. Agent-to-Agent Communication (A2A)

### Direct A2A (CLI가 custom tools 지원하는 경우: Claude Code)

```
Agent PM ──(delegate_to_agent tool)──▶ Agent Researcher
           "이 주제 리서치해줘"            │
                                          ▼
                                        리서치 완료
                                          │
                                          ▼
Agent PM ◀──(tool_result로 반환)─────── 결과 수신
    │
    └──(delegate_to_agent tool)──▶ Agent Writer
       "이 리서치 결과로 초안 써줘"       │
                                          ▼
                                        초안 완료
                                          │
Agent PM ◀──(tool_result로 반환)─────── 결과 수신
    │
    └── 최종 결과 종합 → Conductor → 사용자
```

`delegate_to_agent`: Agent의 allowed tools에 주입되는 custom tool.
Agent가 다른 Agent에게 직접 task를 보내고 결과를 받음.

### Conductor Relay (CLI가 custom tools 미지원하는 경우: Codex CLI 등)

```
Agent A completes task
  → result returns to Conductor
    → Conductor sends to Agent B with context
      → Agent B completes
        → result returns to Conductor
          → Conductor synthesizes
```

### Backend Capability Detection

| Capability          | Claude Code | Codex CLI | Gemini CLI |
| ------------------- | ----------- | --------- | ---------- |
| Custom Tools (A2A)  | ✅ direct   | ❌ relay  | TBD        |
| Streaming           | ✅          | ✅        | TBD        |
| Session Persistence | ✅          | ❌        | TBD        |
| File Access         | ✅          | ✅        | TBD        |

Dashboard에서 Backend 선택 시:

```
┌─────────────────────────────────────────────┐
│ Backend: [Claude Code ▼]                     │
│                                              │
│ ✅ Agent-to-Agent Communication              │
│ ✅ Streaming Output                          │
│ ✅ Session Persistence                       │
│ ✅ File Access                               │
│──────────────────────────────────────────────│
│ Backend: [Codex CLI ▼]                       │
│                                              │
│ ⚠️ Agent-to-Agent: Conductor 중계 모드       │
│    (직접 A2A 불가, Conductor가 대신 전달)     │
│ ✅ Streaming Output                          │
│ ⚠️ Session Persistence: 미지원               │
│ ✅ File Access                               │
└─────────────────────────────────────────────┘
```

---

## 7. Memory System

### Storage Layer

| Store             | Technology                               | Purpose                                       |
| ----------------- | ---------------------------------------- | --------------------------------------------- |
| Structured data   | bun:sqlite (embedded)                    | Sessions, config, graph edges, agent registry |
| Vector embeddings | LanceDB (embedded, default)              | Semantic search, RAG                          |
| Vector embeddings | Qdrant (optional, docker-compose add-on) | Large-scale production                        |

### Memory Types

- **Short-term**: Conversation/session state. Lives during a session, cleared after.
- **Long-term**: Persistent across sessions. All conversations, ingested data, agent outputs stored here.

### RAG Strategies

- **Naive RAG**: query → vector search → retrieve top-K → respond
- **Graph RAG**: entity extraction → knowledge graph → graph traversal + vector search → respond
- **Agentic RAG**: query → retrieve → reason about relevance → retrieve again → respond (multi-step)

### Ingestion

Dashboard UI에서:

- File upload (PDF, CSV, TXT)
- Text paste
- API endpoint (`POST /api/memory/ingest`)

---

## 8. Dashboard (Built-in UI)

Next.js 15, App Router, standalone output. Separate service in docker-compose.

```
Dashboard Pages:

├── 🚀 Onboarding         — First-run setup (shown once, admin only)
│   ├── Backend auth      — BYOK (paste API key) or CLI login (e.g. claude login)
│   ├── Backend select    — Choose CLI backend + capability preview
│   └── First agent       — Optional: create first agent via wizard
│
├── 🏠 Home              — System status, recent activity, alerts
│
├── 🤖 Agents             — RPG-style agent management
│   ├── Agent list        — Cards: name, role, status, owner (📌user / 🔄conductor)
│   ├── Create Agent      — Wizard: name, role, prompt, tools, permissions
│   │
│   │   ┌─────────────────────────────────────┐
│   │   │ 🤖 New Agent                        │
│   │   │                                     │
│   │   │ Name: [ ________________           ]│
│   │   │ Role: [ ________________           ]│
│   │   │ Tools: ☑ Read ☑ Grep ☐ Write ☐ Bash│
│   │   │ Can delegate to other agents: ☑ Yes │
│   │   │ Persistent: ☑ Yes                   │
│   │   │                                     │
│   │   │ System Prompt:                      │
│   │   │ ┌─────────────────────────────────┐ │
│   │   │ │                                 │ │
│   │   │ └─────────────────────────────────┘ │
│   │   │                                     │
│   │   │         [Create Agent]              │
│   │   └─────────────────────────────────────┘
│   │
│   ├── Agent detail      — Edit prompt, view activity logs, restart
│   └── 🔒 Conductor      — View-only (status, routing decisions, created agents)
│
├── 🧠 Memory             — Memory browser
│   ├── Browse            — Search, filter, view entries
│   ├── Ingest            — Upload files (PDF, CSV, TXT), paste text
│   └── Stats             — Storage used, vector count, recent access
│
├── 💬 Chat               — Direct conversation
│   ├── Conductor         — Normal conversation (routes automatically)
│   └── Direct to Agent   — Talk to specific agent (debugging/testing)
│
├── ⚡ Automation          — Cron management
│   ├── Schedule list     — Active/inactive, next run time
│   ├── Create/Edit       — Cron expression builder, workflow steps
│   └── History           — Execution logs with results
│
├── 📊 Activity            — Monitoring
│   ├── Timeline          — Who did what, when
│   ├── A2A Log           — Agent-to-agent communication history
│   └── Cost tracking     — API calls, tokens used, estimated cost
│
├── 📡 Channels            — External connections
│   ├── Connected         — Telegram/Discord/Slack status
│   └── Add channel       — Linking code flow
│
└── ⚙️ Settings
    ├── Backend           — Select CLI backend + capability display
    ├── Auth              — BYOK (API key) or CLI login (re-auth anytime)
    └── System            — Memory provider, idle timeout, max agents
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
| `DELETE` | `/api/agents/:id`         | Delete agent (user-owned only) |
| `POST`   | `/api/agents/:id/restart` | Restart agent process          |
| `GET`    | `/api/memory/search`      | Search memory                  |
| `POST`   | `/api/memory/ingest`      | Ingest file/text               |
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
- `a2a_event`: agent-to-agent delegation event (from, to, task)

---

## 12. Environment Variables

| Variable            | Required  | Default               | Description                             |
| ------------------- | --------- | --------------------- | --------------------------------------- |
| `DATA_DIR`          | No        | `./data`              | Data volume path (`./data` local, `/data` Docker) |
| `PORT`              | No        | `3001`                | Runtime server port                     |
| `RUNTIME_URL`       | Dashboard | `http://localhost:3001` | Runtime API URL (`http://runtime:3001` in Docker) |
| `AI_BACKEND`        | No        | `claude`              | CLI backend to use                      |
| `IDLE_TIMEOUT_MS`   | No        | `300000`              | Agent idle timeout (5 min)              |
| `MAX_AGENTS`        | No        | `10`                  | Max concurrent agents                   |
| `VECTOR_PROVIDER`   | No        | `lancedb`             | Vector DB provider                      |
| `QDRANT_URL`        | No        | —                     | Qdrant URL (if using Qdrant)            |
| `LOG_LEVEL`         | No        | `info`                | Log level                               |
| `MODE`              | No        | `standalone`          | `standalone` or `managed`               |

---

## 13. Extension Interface

How products customize this template:

1. **Fork the repo**
2. **Add agent definitions** in `/data/agents/` — or users create via Dashboard UI
3. **Override Conductor routing** via `conductor.setRouter(customFn)`
4. **Ingest domain data** into Memory via Dashboard UI or API
5. **Add packages** to monorepo for product-specific logic
6. **Add channel modules** connecting to the server webhooks
7. **Customize Dashboard** — add product-specific pages/sections
8. **Customize Dockerfile** — add product dependencies
9. **Add Control Plane Portal** — for cloud SaaS offering

**The template provides the autonomous runtime.**
**The product provides the agents, data, and domain logic.**

### Fork-and-Use Scenario (e.g., 제조업 회사)

```
1. git clone template && docker-compose up         ← 5분
2. localhost:3000 접속 (Dashboard)
3. Onboarding: API key 입력 또는 CLI 로그인 (예: claude login) ← 1분
4. "Create Agent" 버튼 → 품질검사 전문가 생성       ← RPG처럼
5. 같은 방식으로 재고관리, 리포트 작성 Agent 생성
6. Memory에 회사 데이터 Ingest (PDF, CSV 업로드)
7. Channel 연결 (Telegram/Slack)                    ← 선택
8. 바로 사용 시작
   "이번 달 불량률 분석해줘"
   → Conductor → 품질검사 Agent + 리포트 Agent 협업 → 결과

코드 수정 없이 Dashboard UI만으로 여기까지 가능.
커스텀 코드는 ERP 연동 등 심화 단계에서만 필요.
```

---

## 14. Build Order

Implement in this sequence. Steps 1-7 complete.

| Step | Package           | What                                                                     | Test                                    |
| ---- | ----------------- | ------------------------------------------------------------------------ | --------------------------------------- |
| 1    | Scaffold          | Bun workspace, Turborepo, shared types                                   | Build passes                            |
| 2    | agent-manager     | CLI process spawn/communicate, pool, claude backend                      | Spawn agent, send message, get response |
| 3    | memory            | bun:sqlite schema, LanceDB integration, short/long-term, naive RAG       | Store, search, retrieve                 |
| 4    | conductor         | Router, Conductor class, agent CRUD with ownership                       | Route messages, multi-agent delegation  |
| 5    | server            | REST API, WebSocket, webhook receivers, Bun.serve entry                  | Full message flow via WS                |
| 6    | dashboard         | Next.js 16, agent management, memory browser, chat, monitoring, settings | UI functional                           |
| 7    | conductor (AI)    | AI-powered routing, dynamic agent creation, conductor_status WS events   | AI routes, creates agents, emits events |
| 8    | cron-manager      | File watcher, workflow executor                                          | Create cron, verify execution           |
| 9    | docker            | Dockerfile.runtime, Dockerfile.dashboard, docker-compose, default data   | `docker-compose up`, full flow          |
| 10   | memory (advanced) | Graph RAG, Agentic RAG, file ingest (PDF/CSV/TXT), Qdrant provider       | Can parallel with 8-9                   |
| 11   | control-plane     | ContainerProvider + Fly.io, Auth (Supabase), Billing (Stripe), Portal    | Optional, cloud mode                    |
