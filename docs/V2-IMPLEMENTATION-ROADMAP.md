# Pyx V2 — Implementation Roadmap & Gap Analysis

> Generated from codebase scan + V2 Architecture comparison, 2026-02-17
> Reference docs: `ARCHITECTURE-V2.md`, `CLI-BACKEND-RESEARCH.md`, `PRODUCT-DISCOVERY.md`, `SPEC.md`
> Last updated: 2026-02-17 (Phase 1 complete)

---

## Current State Summary

**7 of 11 build steps complete + V2 Phase 1 complete.** 6 packages + dashboard implemented with 606 tests (1170 assertions). The foundation is solid — V2 Phase 1 (Session Support) has been implemented and reviewed.

### What Exists (Steps 1-7 + V2 Phase 1)

| Package | Status | Key Capabilities |
|---------|--------|-----------------|
| `@autonomy/shared` | Complete + V2 P1 | 33+ interfaces, session types (`AgentLifecycle`, `SessionConfig`), `deriveLifecycle()`, `isAgentPersistent()` utilities, GOOSE backend, fixed capabilities |
| `@autonomy/agent-manager` | Complete + V2 P1 | CLIBackend interface, AgentProcess (lifecycle + message queue + **session persistence**), AgentPool (CRUD + maxAgents), ClaudeBackend (**--session-id/--resume/--no-session-persistence**) |
| `@autonomy/memory` | Complete | SQLiteStore (WAL mode) + LanceDB vectors, NaiveRAG engine, dual-layer memory |
| `@autonomy/conductor` | Complete + V2 P1 | AI router (Opus) + keyword fallback, permissions, activity log, message queue, ConductorEvents, **session persistence (sessionId + conductorName)** |
| `@autonomy/server` | Complete + V2 P1 | Bun.serve HTTP+WS, REST API (agents/memory/activity/config), WebSocket chat + debug streaming, **lifecycle derivation on agent create** |
| `dashboard` | Phases 1-4 + V2 P1 | Next.js 16.1, cyberpunk theme, agents CRUD, chat with streaming, debug console, **LifecycleBadge, lifecycle-grouped agent list, accessible agent selector with lifecycle icons** |

---

## Gap-to-Implementation Map (Ordered by V2 Migration Phases)

### Phase 1: Session Support — COMPLETED (2026-02-17)

> Reviewed by 4-person team (security, quality, test, product). 606 tests, 0 failures. All fixes applied.

| Gap | Status | What Was Done |
|-----|--------|---------------|
| **Session types** | DONE | New `types/session.ts` with `AgentLifecycle` enum, `SessionConfig` interface, `deriveLifecycle()` + `isAgentPersistent()` shared utilities |
| **ClaudeBackend sessions** | DONE | `--session-id` on first send, `--resume` on subsequent, `--no-session-persistence` opt-out. `sessionCreated` state tracking in `ClaudeProcess` |
| **Agent lifecycle fields** | DONE | `AgentDefinition` extended with `lifecycle?`, `parentId?`, `sessionId?`, `department?`, `backend?`, `backendModel?`. `AgentRuntimeInfo` extended with `lifecycle?`, `sessionId?` |
| **Conductor statefulness** | PARTIAL | `ConductorOptions` gains `sessionId?` + `conductorName?`. Conductor passes session to `backend.spawn()`. **Deferred**: full soul (RAG + self-reflection), pending question tracking, dynamic context builder |
| **Backend capabilities** | DONE | Fixed Codex/Gemini (both have sessions+streaming). Added GOOSE to `AIBackend` enum with capabilities |
| **Dashboard** | DONE | `LifecycleBadge` component, lifecycle-grouped agent list, accessible agent selector with `aria-label`, `aria-hidden` on decorative icons |

**Files changed (16 modified, 5 new):**
- `packages/shared/src/types/session.ts` (NEW) — `AgentLifecycle`, `SessionConfig`, `deriveLifecycle()`, `isAgentPersistent()`
- `packages/shared/src/types/agent.ts` — 6 new optional fields on `AgentDefinition`, 2 on `AgentRuntimeInfo`
- `packages/shared/src/types/api.ts` — `CreateAgentRequest` extended with `lifecycle?`, `backend?`, `department?`
- `packages/shared/src/types/a2a.ts` — Added `GOOSE` to `AIBackend`
- `packages/shared/src/constants/capabilities.ts` — Fixed Codex/Gemini, added GOOSE
- `packages/agent-manager/src/backends/types.ts` — `BackendSpawnConfig` gains `sessionId?`, `sessionPersistence?`
- `packages/agent-manager/src/backends/claude.ts` — Session flags in `buildArgs()`, `sessionCreated` tracking
- `packages/agent-manager/src/agent-process.ts` — Private `_sessionId` field (no definition mutation), uses `deriveLifecycle()`/`isAgentPersistent()` from shared
- `packages/conductor/src/types.ts` — `ConductorOptions` gains `sessionId?`, `conductorName?`
- `packages/conductor/src/conductor.ts` — `sessionId` getter, session in `initialize()`, consolidated `createAgent()` → `buildAgentDefinition()`
- `packages/server/src/routes/agents.ts` — Lifecycle derivation + sessionId generation using shared utilities
- `dashboard/app/components/agents/lifecycle-badge.tsx` (NEW) — Anchor/Zap icons, cyan/amber colors
- `dashboard/app/components/agents/agent-card.tsx` — Added LifecycleBadge
- `dashboard/app/components/agents/agent-list.tsx` — Groups by persistent/ephemeral (was by owner)
- `dashboard/app/components/chat/agent-selector.tsx` — Lifecycle icons + `aria-label` accessibility

**Key design decisions:**
- `lifecycle` coexists with `persistent` (backward compat). `persistent` is `@deprecated`; `lifecycle` is canonical.
- Session IDs are always server-generated (`crypto.randomUUID()`), never user-supplied.
- `_sessionId` is a private field on `AgentProcess` — input definition is never mutated.
- Shared `deriveLifecycle()` + `isAgentPersistent()` eliminate duplication across 4 packages.

**Review deferred items (not blockers):**
- SessionId UUID validation in `buildArgs()` — no user-supplied path exists yet
- Agent list owner→lifecycle grouping — OwnerBadge per-card preserves owner info
- Server route session field test coverage — will add in next test pass
- `conductor-session.test.ts` uses `as any` casts instead of typed mocks

---

### Phase 2: Backend Registry (Medium, Replaces Single Backend)

| Gap | Current | V2 Requires | Effort |
|-----|---------|-------------|--------|
| **Single backend** | All agents share one `CLIBackend` instance | `BackendRegistry` mapping `AIBackend → CLIBackend` | Medium |
| **No per-agent backend** | `AgentDefinition` has no `backend` field | Each agent chooses backend (CTO: Claude, QA: Gemini, etc.) | Medium |
| **Wrong capabilities** | `BACKEND_CAPABILITIES` has 3 errors for Codex/Gemini | All Tier 1 backends have sessions + streaming | Low |
| **Missing backends** | Only Claude implemented | Goose (priority 2), Codex (3), Gemini (4) | High (per backend) |

**Concrete files to change:**
- `packages/shared/src/types/a2a.ts` — add `GOOSE` to `AIBackend`, fix capability values
- `packages/shared/src/constants/capabilities.ts` — correct Codex/Gemini capabilities
- `packages/shared/src/types/agent.ts` — add `backend?: AIBackend`, `backendModel?: string`
- `packages/agent-manager/src/backends/` — new `registry.ts`, new `goose.ts`
- `packages/agent-manager/src/agent-pool.ts` — accept `BackendRegistry` instead of single backend

**Why second:** This enables cost optimization (70% savings per V2 estimates) and is prerequisite for Goose/Codex/Gemini agents.

---

### Phase 3: Agent Hierarchy & Ephemeral Lifecycle (Medium)

| Gap | Current | V2 Requires | Effort |
|-----|---------|-------------|--------|
| **Flat agent pool** | No parent-child relationships | `parentId` chain, permission inheritance | Medium |
| **No auto-destroy** | Ephemeral agents accumulate | Auto-cleanup after task completion, timeout | Medium |
| **No delegation approval** | Ad-hoc delegation | Cross-agent requests through Conductor with approval | High |
| **No soul/self-reflection** | Agents don't learn | `store_memory` tool for long-term learning | Medium |

**Concrete files to change:**
- `packages/conductor/src/conductor.ts` — ephemeral tracker map, auto-destroy logic
- `packages/conductor/src/permissions.ts` — permission subsetting (child ⊆ parent)
- `packages/agent-manager/src/agent-pool.ts` — `parentId` tracking, hierarchy queries
- `packages/shared/src/types/agent.ts` — ephemeral options type

---

### Phase 4: Memory Namespacing (Medium)

| Gap | Current | V2 Requires | Effort |
|-----|---------|-------------|--------|
| **No access tiers** | All agents can search all memory | Three-tier: `shared/`, `dept/`, `agent-private/` | Medium |
| **No FTS5** | Vector-only search | Hybrid: vector + BM25 full-text (SQLite FTS5) | Medium |
| **No cross-namespace search** | N/A | Conductor-mediated read-only summaries | Medium |

**Concrete files to change:**
- `packages/memory/src/memory.ts` — add namespace tier enforcement to `search()`
- `packages/memory/src/sqlite-store.ts` — add FTS5 virtual table, hybrid search
- `packages/memory/src/types.ts` — `MemoryNamespace` type with tier + access rules
- `packages/server/src/routes/memory.ts` — namespace-scoped endpoints

---

### Phase 5: Permission & Tool System (Large, New Subsystem)

| Gap | Current | V2 Requires | Effort |
|-----|---------|-------------|--------|
| **No credential isolation** | Env vars (unsafe) | Zero-Knowledge: tool runtime resolves creds, agent never sees them | Very High |
| **No per-tool permissions** | Only agent CRUD permissions | `CredentialTool` registry, per-tool per-agent audit | High |
| **No anomaly detection** | None | First-time tool usage, frequency spikes, cross-scope attempts | Medium |
| **No audit trail** | Activity log only | Immutable audit entries for every tool use + credential access | Medium |

**New files needed:**
- `packages/shared/src/types/credential.ts` — `CredentialTool`, `CredentialStrategy`
- `packages/server/src/credential-vault.ts` — vault adapter (Docker secrets → 1Password → OAuth)
- `packages/server/src/tool-runtime.ts` — sandboxed tool execution with cred injection
- `packages/conductor/src/anomaly-detector.ts` — rule-based anomaly flagging

**Why later:** This is the largest subsystem and blocks on having sessions + hierarchy first.

---

### Phase 6: Organization Templates (Large, New Feature)

| Gap | Current | V2 Requires | Effort |
|-----|---------|-------------|--------|
| **No org templates** | Manual agent creation | YAML org definitions, one-command deploy | High |
| **No template marketplace** | N/A | Pre-built teams (Support, Research, Content) | High |

---

## Dashboard Gaps (Mapped to Phases)

| Dashboard Area | Gap | Phase | Status |
|---|---|---|---|
| **Agents page** | No ephemeral vs persistent visual distinction | Phase 1 | DONE — LifecycleBadge + lifecycle-grouped list |
| **Agents page** | No hierarchy tree / parentId display | Phase 3 | TODO |
| **Agent creation** | Missing: backend, department, model fields | Phase 2 | TODO (lifecycle derived from persistent toggle) |
| **Chat** | No conductor routing explanation ("why this agent") | Phase 1+ | TODO |
| **Chat** | No ephemeral agent labeling in messages | Phase 1 | DONE — lifecycle icons in agent selector |
| **Memory** | Stub page — no namespace browser | Phase 4 | TODO |
| **Settings** | Stub — no conductor identity config (name, personality) | Phase 1+ | TODO |
| **Onboarding** | None — first-time setup flow missing | Phase 6 | TODO |
| **Home** | No soul/ephemeral metrics, no delegation stats | Phase 3 | TODO |
| **Activity** | No soul lifecycle events, no anomaly viewer | Phase 5 | TODO |

---

## Quick Wins

| # | What | Status | Unblocks |
|---|------|--------|----------|
| 1 | **Add session types to shared** | DONE (Phase 1) | Phase 1 |
| 2 | **Extend AgentDefinition** with `lifecycle`, `parentId`, `sessionId`, `department`, `backend` | DONE (Phase 1) | Phase 1-3 |
| 3 | **Fix BACKEND_CAPABILITIES** (Codex/Gemini have sessions+streaming) | DONE (Phase 1) | Phase 2 |
| 4 | **Add Goose to AIBackend enum** | DONE (Phase 1) | Phase 2 |
| 5 | **Add `sessionId` to BackendSpawnConfig** | DONE (Phase 1) | Phase 1 |
| 6 | **Add `--session-id`/`--resume` to ClaudeBackend** | DONE (Phase 1) | Phase 1 |
| 7 | **Define BackendRegistry interface** (no impl yet) | TODO | Phase 2 |
| 8 | **Add FTS5 table to SQLiteStore** | TODO | Phase 4 |
| 9 | **Add ephemeral/persistent badges to dashboard** | DONE (Phase 1) | Phase 1 |
| 10 | **Pending question tracking types** | TODO | Phase 1 (cont.) |

---

## Detailed Backend Gap Analysis

### ClaudeBackend (`packages/agent-manager/src/backends/claude.ts`)

**Current:** Spawns `claude -p <message>` per `send()` call. Supports `--system-prompt`, `--allowed-tools`, `--dangerously-skip-permissions`.

**Missing for V2:**
```
--session-id <uuid>          → first message (creates session)
--resume <uuid>              → subsequent messages (continues session)
--no-session-persistence     → ephemeral agents
--output-format stream-json  → real streaming (currently pre-buffered)
```

**Implementation pattern:**
```typescript
// In BackendSpawnConfig (types.ts):
sessionId?: string;
sessionPersistence?: boolean;  // default true, false for ephemeral

// In ClaudeBackend (claude.ts):
// Track per-agent: sessionCreated: Map<string, boolean>
// First send() → --session-id <uuid>
// Subsequent send() → --resume <uuid>
// Ephemeral → --no-session-persistence (no session flags)
```

### Missing Backends

| Backend | Priority | Key Implementation Notes |
|---------|----------|------------------------|
| **Goose** | High (Phase 2) | `-i -` for stdin, `-q` for clean output, `--system "..."`, `--name` for sessions, `GOOSE_MODE=auto` |
| **Codex** | Medium (Phase 3) | `exec` subcommand, `--json` for JSONL, `exec resume <id>`, `-c 'developer_instructions=...'` |
| **Gemini** | Medium (Phase 4) | `GEMINI_SYSTEM_MD` env var (file path), `--resume latest`, `--approval-mode=yolo` |
| **Copilot** | Low (community) | No system prompt flag, no JSON output |
| **Cline** | Low (community) | No session persistence |
| **Aider** | Low (community) | No stdin pipe support |

---

## Conductor Soul Architecture Gap

### Current Conductor

```
Conductor (stateless router)
  ├── handleMessage() → route → delegate → respond
  ├── AI router (Opus) with keyword fallback
  ├── Message queue (serial processing)
  ├── Activity log (ring buffer)
  └── ConductorEvent callbacks
```

### V2 Conductor (Mother AI with Soul)

```
Conductor (STATEFUL, --resume <uuid>)
  ├── Personality: user-named ("JARVIS", "Friday", etc.)
  ├── Session memory: full conversation history via --resume
  ├── RAG memory: long-term semantic search (conductor/ namespace)
  ├── Self-reflection: learns user preferences, routing patterns
  ├── Dynamic context injection per-message:
  │     <pending-questions>...</pending-questions>
  │     <recent-notifications>...</recent-notifications>
  │     <agents>...</agents>
  │     <memory-context>...</memory-context>
  │     <user-message>...</user-message>
  ├── Pending question tracking (not sticky routing)
  │     Server tracks which agents asked questions
  │     Hybrid expiry: 30min OR 3 unrelated messages
  ├── Opus for all routing (no cheap model, subscription plan)
  └── Routes to ANY agent (persistent or ephemeral)
```

### Gap: What Conductor Needs

1. **Session persistence** — `--resume <conductor-session-uuid>` on every invocation
2. **Personality config** — user-chosen name, stored in config
3. **Dynamic context builder** — `buildRoutingContext()` function assembling pending questions, notifications, agent status, memory results
4. **Pending question tracker** — server-side `Map<agentId, PendingQuestion>` with hybrid expiry
5. **Self-reflection store** — private memory namespace `conductor/` for learned preferences
6. **Notification inbox** — agents report back to Conductor, Conductor surfaces to user

---

## Memory System Gap Analysis

### Current Memory

```
Memory
  ├── SQLiteStore (memory_entries + graph_edges, WAL mode)
  ├── LanceDB vectors (cosine similarity)
  ├── NaiveRAG (embed → search → hydrate)
  └── Query filtering by agentId, sessionId, category, type
```

### V2 Memory (Three-Tier Namespaced)

```
Memory
  ├── SHARED (shared/)
  │     Access: ALL persistent agents (blacklist exceptions)
  │     Contents: org goals, cross-team decisions, common knowledge
  │
  ├── DEPARTMENT (eng/, mktg/, fin/, hr/)
  │     Access: Agents in department (whitelist outsiders)
  │     Contents: domain-specific knowledge, team decisions
  │
  ├── AGENT PRIVATE (cto/, river/, conductor/)
  │     Access: That agent ONLY (no override)
  │     Contents: personal preferences, self-reflections
  │
  ├── Hybrid search: Vector + BM25 FTS5
  ├── Cross-namespace search: Conductor-mediated, read-only summaries
  └── Ephemeral agent access: inherits parent's tiers
```

### Gap: What Memory Needs

1. **Namespace tier enforcement** — `search()` checks caller's access level
2. **FTS5 virtual table** — `CREATE VIRTUAL TABLE memory_fts USING fts5(content, category)`
3. **Hybrid ranking** — combine vector similarity + BM25 relevance scores
4. **Access control middleware** — `canAccess(agentId, namespace): boolean`
5. **Cross-namespace API** — Conductor-only endpoint for cross-department search

---

## Recommended Implementation Order

```
Week 1: Session Foundation (Phase 1) — COMPLETED
  ├── Session types + AgentDefinition extensions (shared) ✓
  ├── BackendSpawnConfig + ClaudeBackend sessions ✓
  ├── AgentProcess session tracking + tests ✓
  ├── Fix BACKEND_CAPABILITIES + add Goose enum ✓
  ├── Conductor session config + --resume wiring ✓
  ├── Dashboard ephemeral/persistent badges ✓
  └── 4-person code review (security, quality, test, product) ✓

NEXT: Conductor Soul (Phase 1 continued — deferred items)
  ├── Pending question tracking types + server tracker
  ├── Dynamic context builder (buildRoutingContext)
  ├── Conductor personality config (name, traits)
  └── Dashboard conductor identity settings

THEN: Backend Registry (Phase 2)
  ├── BackendRegistry interface + implementation
  ├── AgentPool refactor to use registry
  ├── GooseBackend implementation
  ├── Per-agent backend selection in API/dashboard
  └── Tests + integration

THEN: Hierarchy & Memory (Phase 3-4)
  ├── parentId + hierarchy queries in AgentPool
  ├── Permission inheritance (child ⊆ parent)
  ├── Ephemeral auto-destroy + tracker
  ├── FTS5 hybrid search in SQLiteStore
  └── Memory namespace tiers + access control
```

---

## Dependencies & Blockers

| Dependency | Status | Notes |
|------------|--------|-------|
| `claude -p --resume <uuid>` | Confirmed | CLI-BACKEND-RESEARCH.md verified session isolation |
| `goose run --resume --name` | Confirmed | Best automation design per research |
| `codex exec resume <id>` | Confirmed | Has SDK alternative (`@openai/codex-sdk`) |
| `gemini -p --resume` | Confirmed | System prompt via env var (awkward but workable) |
| 1Password SDK | Available on npm | `@1password/connect` for vault integration |
| OAuth2 libraries | Available | `openid-client` or similar for OAuth flows |

---

## Success Metrics

| Metric | Before Phase 1 | After Phase 1 (Current) | Phase 4 Target |
|--------|----------------|------------------------|----------------|
| Agent session persistence | None | Persistent agents get `--session-id`/`--resume` | All agents resume |
| Backend options | 1 (Claude) | 1 (Claude) + GOOSE type defined | 4 (all Tier 1) |
| Memory search quality | Vector-only | Vector-only | Namespaced + hybrid |
| Permission granularity | Agent CRUD only | + session, + lifecycle | + per-tool audit |
| Ephemeral cleanup | Manual | Manual (types ready) | + timeout + metrics |
| Conductor personality | None (anonymous router) | sessionId + conductorName support | + self-reflection + learning |
| Test count | 578 | 606 (28 new session tests) | 800+ |

---

## References

- `docs/ARCHITECTURE-V2.md` — Full V2 architecture design
- `docs/CLI-BACKEND-RESEARCH.md` — Session persistence & backend capabilities
- `docs/PRODUCT-DISCOVERY.md` — Feature documentation & competitive analysis
- `docs/SPEC.md` — Original template specification (steps 1-11)
