# Pyx Architecture v2 — Hierarchical Multi-Agent Security Model

> Evolved from flat agent pool to hierarchical organization with separation of powers.
> This document supersedes the agent/conductor sections of SPEC.md for the Pyx product layer.
> Written 2026-02-17. Updated 2026-02-17 with: Conductor as Mother AI with soul (stateful,
> --resume), pending question tracking, Opus-only routing, "Ask Conductor" agent creation flow,
> Agent Soul model (persistent vs ephemeral), Zero-Knowledge Architecture (agents untrusted).
>
> **Naming convention**: "Conductor" is the architectural role. Users choose their own name
> for the Conductor during initial setup (e.g., "JARVIS", "Friday", "Alfred", "Athena").
> This document uses "Conductor" for the role. "JARVIS" appears only in Iron Man analogies.

---

## 1. Design Philosophy

### Why This Architecture Exists (5 Whys)

**Why does the Conductor exist?**
→ To route messages to the right agent.

**Why not let one agent handle everything (like OpenClaw)?**
→ Because one agent with all access is a security risk.

**Why is one agent with all access a security risk?**
→ Because if it's compromised, prompt-injected, or malfunctions, it has keys to everything.

**Why can't we just trust one agent?**
→ Because LLMs are probabilistic. They hallucinate, get prompt-injected, and their conversations may leak to training data. No single entity should hold all power.

**Why does this matter for Pyx specifically?**
→ Because Pyx manages REAL resources for users — their GitHub, finances, communications. A single agent leaking one API key is catastrophic.

**Root principle**: The Conductor exists to enforce **separation of powers** — not just routing. It's a security architecture, not a convenience feature.

### Core Tenets

1. **Least Privilege**: Every agent gets ONLY the permissions it needs. Nothing more.
2. **Zero-Knowledge Credentials**: No agent ever sees passwords, tokens, or secrets. Tools resolve credentials in a sandboxed runtime.
3. **Separation of Powers**: No single agent can do everything. Agents audit each other.
4. **Hierarchical Delegation**: Conductor → Persistent agents → Ephemeral workers. Permissions decrease with each level. Hierarchy emerges from `parentId`, not enforced tiers.
5. **Cross-LLM Optimization**: Different LLMs for different tasks based on cost, quality, and capability.
6. **Defense in Depth**: Multiple layers of security — permissions, credential isolation, audit trails, anomaly detection.

---

## 2. System Overview — The Jarvis Model

### 2.1 Mental Model

```
User = Tony Stark (CEO)
Conductor = Mother AI (stateful, has soul, controls all agents on user's behalf)
Persistent Agents = Specialists with identity, memory, and accumulated expertise
Ephemeral Agents = Temporary workers, created for a task, destroyed after

The user talks ONLY to the Conductor. The Conductor is not just a router —
it's a PERSON. It has personality, remembers everything, learns user
preferences, and grows. Like JARVIS in Iron Man: Tony's most trusted
companion who also happens to manage an army of systems.

Users name their Conductor at first launch (e.g., "JARVIS", "Friday",
"Alfred", "Athena"). The name becomes part of the Conductor's identity.
```

### 2.2 The Conductor as Mother AI (Stateful with Soul)

```
The Conductor is a PERSON, not a switchboard.

  Conductor (Mother AI): --resume <uuid>
    • Stateful: remembers all conversations with the user
    • Has personality: loyal, proactive, grows over time
    • Has soul: session memory + RAG memory + self-reflection
    • Learns: user preferences, routing patterns, org awareness
    • Routes: delegates to specialists when needed
    • Protects: enforces permissions, security, audit
    • Uses Opus (best reasoning, subscription plan — cost irrelevant)
    • The user's MAIN interface — all interaction goes through the Conductor

  Conductor's session = the user-Conductor conversation
    • ONE conversation thread (not 100 mixed topics)
    • CLI handles compaction when context window fills
    • Important context preserved in Memory (RAG) long-term
    • Dynamic context (agent status, pending questions) injected per-message

  Context pollution solved differently than stateless approach:
    • Conductor sees the user conversation, NOT internal agent chatter
    • Each persistent agent has its OWN session for domain-deep work
    • Results come back as summaries, not full transcripts
    • Opus reasoning handles topic switching naturally (humans do this all day)
    • Memory system provides fresh context even if session compacts old messages
```

### 2.3 Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Pyx Runtime Container                            │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                    SYSTEM LAYER (Protected)                    │  │
│  │                                                                │  │
│  │  ┌──────────────────┐  ┌──────────────┐  ┌────────────────┐   │  │
│  │  │   Conductor       │  │  Credential  │  │   Audit Log    │   │  │
│  │  │  "Mother AI"      │  │   Vault      │  │  (Immutable)   │   │  │
│  │  │                   │  │              │  │                │   │  │
│  │  │ • STATEFUL        │  │ • Docker     │  │ • Who did what │   │  │
│  │  │ • --resume <uuid> │  │   secrets    │  │ • When & why   │   │  │
│  │  │ • Opus model      │  │ • OAuth mgr  │  │ • Tool usage   │   │  │
│  │  │ • Has SOUL        │  │ • Vault/     │  │ • Perm checks  │   │  │
│  │  │ • Routes + guards │  │   1Password  │  │ • Ring buffer + │  │  │
│  │  │ • Enforce perms   │  └──────────────┘  │   persistent   │   │  │
│  │  │ • Never holds     │                     └────────────────┘   │  │
│  │  │   credentials     │                                          │  │
│  │  │ • Remembers user  │  ← session + RAG + self-reflection       │  │
│  │  │   conversations   │                                          │  │
│  │  └────────┬──────────┘                                          │  │
│  │           │                                                      │  │
│  └───────────┼──────────────────────────────────────────────────────┘  │
│              │                                                       │
│  ┌───────────┼────────────────────────────────────────────────────┐  │
│  │           │          ORGANIZATION LAYER                        │  │
│  │           │                                                    │  │
│  │     ┌─────┴──────┬──────────────┬──────────────┐              │  │
│  │     ▼            ▼              ▼              ▼              │  │
│  │  ┌────────┐  ┌────────┐  ┌──────────┐  ┌──────────┐         │  │
│  │  │  CTO   │  │  CMO   │  │   CFO    │  │  CHRO    │         │  │
│  │  │(Claude)│  │ (GPT)  │  │(Gemini)  │  │(Claude)  │         │  │
│  │  │        │  │        │  │          │  │          │         │  │
│  │  │STATEFUL│  │STATEFUL│  │ STATEFUL │  │ STATEFUL │         │  │
│  │  │--resume│  │--resume│  │ --resume │  │ --resume │         │  │
│  │  │        │  │        │  │          │  │          │         │  │
│  │  │ Perms: │  │ Perms: │  │ Perms:   │  │ Perms:   │         │  │
│  │  │ github │  │ social │  │ sheets   │  │ calendar │         │  │
│  │  │ docker │  │ email  │  │ invoices │  │ hr-tools │         │  │
│  │  │ aws    │  │ cms    │  │ banking* │  │ comms    │         │  │
│  │  │        │  │        │  │          │  │          │         │  │
│  │  │Memory: │  │Memory: │  │ Memory:  │  │ Memory:  │         │  │
│  │  │ eng/   │  │ mktg/  │  │ fin/     │  │ hr/      │         │  │
│  │  └───┬────┘  └───┬────┘  └────┬─────┘  └────┬─────┘         │  │
│  │      │           │            │              │               │  │
│  │  ┌───┴───┐   ┌───┴───┐   ┌───┴───┐     ┌───┴───┐           │  │
│  │  │Sub-   │   │Sub-   │   │Sub-   │     │Sub-   │           │  │
│  │  │agents │   │agents │   │agents │     │agents │           │  │
│  │  │       │   │       │   │       │     │       │           │  │
│  │  │Narrow │   │Narrow │   │Narrow │     │Narrow │           │  │
│  │  │perms  │   │perms  │   │perms  │     │perms  │           │  │
│  │  └───────┘   └───────┘   └───────┘     └───────┘           │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                    INFRASTRUCTURE LAYER                        │  │
│  │                                                                │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐   │  │
│  │  │ Memory System │  │ Tool Runtime │  │  Backend Registry  │   │  │
│  │  │              │  │  (Sandbox)   │  │                    │   │  │
│  │  │ bun:sqlite   │  │              │  │ ClaudeBackend      │   │  │
│  │  │ + LanceDB    │  │ Executes     │  │ CodexBackend       │   │  │
│  │  │ + FTS5       │  │ tools with   │  │ GeminiBackend      │   │  │
│  │  │              │  │ real creds   │  │ GooseBackend       │   │  │
│  │  │ Namespaced   │  │ Agent never  │  │                    │   │  │
│  │  │ per agent    │  │ sees secrets │  │ Per-agent backend  │   │  │
│  │  └──────────────┘  └──────────────┘  │ selection          │   │  │
│  │                                       └────────────────────┘   │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Agent Hierarchy

### 3.1 Agent Lifecycle Model (Persistent vs Ephemeral)

The fundamental distinction is **lifecycle**, not rigid tiers. Hierarchy emerges from usage, not enforced structure.

```
Conductor (Mother AI, System-Protected, STATEFUL, Immortal)
  ├── Cannot be modified or deleted by any agent or user
  ├── STATEFUL: --resume <uuid> (remembers all user conversations)
  ├── Has SOUL: session memory + RAG memory + self-reflection
  ├── Has personality: user-named at first launch (e.g., "JARVIS", "Friday")
  ├── Uses Opus model (best reasoning, subscription plan, cost irrelevant)
  ├── Dynamic context (agent status, pending questions) injected per-message
  ├── Routes to ANY agent — persistent or ephemeral, regardless of "rank"
  ├── Enforces permission boundaries across all agents
  ├── Manages credential tool registry (which agent can use which tool)
  ├── Maintains immutable audit log of ALL actions
  ├── Anomaly detection: flags unusual patterns (agent accessing unfamiliar tools)
  ├── Never holds credentials, tokens, or secrets itself
  ├── Learns user preferences and routing patterns over time
  └── Backend: Claude Opus (single model for routing + security + reasoning)

Persistent Agents (Stateful, Long-Lived, Have Identity)
  ├── Created by user (or by Conductor with user approval)
  ├── Session: REQUIRED, persistent (--resume <uuid>)
  ├── Own memory namespace: isolated per agent/domain
  ├── Accumulated expertise: remembers past decisions, context, preferences
  ├── Scoped permissions: only tools relevant to their domain
  ├── Can spawn ephemeral workers via delegate_to_agent tool
  ├── LLM reasoning IS the routing — agent decides self-solve vs delegate
  ├── Can choose backend for spawned workers (cross-LLM optimization)
  ├── Cannot access other agents' memory or tools
  ├── Backend: chosen per agent (Claude, GPT, Gemini, etc.)
  └── Examples: CTO, CMO, River (companion), Content Curator

Ephemeral Agents (Temporary, Task-Scoped, Disposable)
  ├── Created by any persistent agent or by Conductor directly
  ├── Session: NONE (--no-session-persistence)
  ├── No own memory — results captured in parent's memory namespace
  ├── Narrowest permissions: ONLY what the specific task needs
  ├── Cannot spawn other agents
  ├── Cannot access tools outside their granted set
  ├── Auto-destroyed after task completion
  ├── Backend: chosen by spawner (cost/quality optimization)
  └── Examples: "research X", "write draft", "review PR", "fix typo"
```

**Key principle**: "C-level" is a label (a persistent agent with a broad domain), not a code path. The same AgentPool holds all agents. `parentId` enables hierarchy when needed. The Conductor routes to whoever is best for the task — a persistent domain expert for complex work, an ephemeral worker for simple tasks.

### 3.2 Permission Scoping Example

```
Conductor (System)
  └── Can use: [route, audit, permission_check, anomaly_detect]

CTO Agent (persistent)
  └── Can use: [github_read, github_write, docker_deploy, aws_ec2, jira_manage]
      Cannot use: [stripe_charge, social_post, email_send_external]
      │
      ├── Code Reviewer (ephemeral, spawned by CTO)
      │     Can use: [github_read, github_comment]
      │     Cannot use: [github_write, docker_deploy, aws_ec2]
      │
      ├── DevOps Engineer (persistent, long-running specialist)
      │     Can use: [docker_deploy, aws_ec2, github_read]
      │     Cannot use: [github_write, jira_manage]
      │
      └── "review PR #42" (ephemeral, one-off task)
            Can use: [github_read]
            Auto-destroyed after completion

CMO Agent (persistent)
  └── Can use: [social_post, email_draft, cms_publish, analytics_read]
      Cannot use: [github_read, docker_deploy, stripe_charge]
```

**Permission inheritance rule**: Ephemeral agents can ONLY receive a subset of their spawner's permissions. A CTO spawning a worker cannot grant it `stripe_charge` (which CTO doesn't have). Persistent agents get permissions at creation time from the user or Conductor.

### 3.3 Cross-Agent Requests

When a persistent agent needs capabilities it doesn't have:

```
CMO needs a landing page deployed:
  1. CMO Agent sends request to Conductor: "Need landing page deployed"
  2. Conductor checks: CMO has no deploy permissions
  3. Conductor routes to CTO Agent: "CMO requests deployment of landing page at /campaign"
  4. CTO Agent reviews (content + technical feasibility) — LLM reasoning
  5. CTO spawns ephemeral worker: "Deploy these files to /campaign"
     (or delegates to persistent DevOps specialist if one exists)
  6. Worker executes with docker_deploy permission (subset of CTO's)
  7. Result flows back: Worker → CTO → Conductor → CMO

The CMO never touches deploy tools. The CTO audits the request.
Cross-agent collaboration without permission escalation.
```

---

## 4. Zero-Knowledge Credential System

### 4.1 The Problem

```
DANGEROUS (traditional approach):
  User stores GITHUB_TOKEN=ghp_abc123 in env
  Agent receives env var in context
  Agent uses token directly in API calls
  Token appears in:
    • LLM conversation history → may leak to training data
    • Session files on disk → may be exposed via file access
    • Debug logs → may be visible in dashboard
    • Agent's stdout → may be captured by other processes
```

### 4.2 The Solution: Tool-Level Credential Resolution

```
SAFE (Pyx approach):

  Agent context sees:
    Tool: github_push
    Description: "Push commits to a GitHub repository"
    Parameters: { repo: string, branch: string, files: string[] }
    ← NO credential parameters. Agent cannot even request a token.

  Execution flow:

  ┌──────────────────────────────────────────────────────────────┐
  │  Agent (LLM Process)                                         │
  │                                                              │
  │  "I need to push these files to the repo"                    │
  │  → Calls tool: github_push({ repo: "org/app", ... })        │
  │                                                              │
  │  Agent sees: tool name + parameters + result                 │
  │  Agent NEVER sees: tokens, passwords, secrets                │
  └──────────────────────────┬───────────────────────────────────┘
                             │
                             ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  Permission Layer                                            │
  │                                                              │
  │  1. Check: Does this agent have 'github_push' permission?    │
  │  2. Check: Is this agent's parent allowed github access?     │
  │  3. Log: Audit entry (agent_id, tool, params, timestamp)     │
  │  4. Check: Anomaly? (first time this agent uses this tool?)  │
  └──────────────────────────┬───────────────────────────────────┘
                             │ approved
                             ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  Tool Runtime (Isolated Sandbox)                             │
  │                                                              │
  │  Credential resolution (agent CANNOT see this):              │
  │                                                              │
  │  ┌─────────────────────────────────────────────────────┐     │
  │  │  Strategy 1: Vault Lookup                           │     │
  │  │  → 1Password Connect API → fetch 'github-token'    │     │
  │  │  → Bitwarden SDK → fetch credential                 │     │
  │  │  → HashiCorp Vault → dynamic secret generation      │     │
  │  ├─────────────────────────────────────────────────────┤     │
  │  │  Strategy 2: OAuth2 Session                         │     │
  │  │  → Pre-authenticated OAuth token (user granted)     │     │
  │  │  → Auto-refresh via refresh token                   │     │
  │  │  → Scoped to minimum required permissions           │     │
  │  ├─────────────────────────────────────────────────────┤     │
  │  │  Strategy 3: ZK-Proof Authorization                 │     │
  │  │  → Agent proves it has permission to act            │     │
  │  │  → Without revealing what the credential is         │     │
  │  │  → Verifier confirms authorization, executes action │     │
  │  ├─────────────────────────────────────────────────────┤     │
  │  │  Strategy 4: Docker/Runtime Secrets                 │     │
  │  │  → Mounted as files in sandbox, not env vars        │     │
  │  │  → Tool reads from /run/secrets/github-token        │     │
  │  │  → Never passed through LLM context                 │     │
  │  └─────────────────────────────────────────────────────┘     │
  │                                                              │
  │  Execute: GitHub API call with resolved credential           │
  │  Return to agent: "Push successful: 3 files to main"        │
  │  Credential is discarded after use (never cached in LLM)     │
  └──────────────────────────────────────────────────────────────┘
```

### 4.3 Credential Tool Registry

```typescript
interface CredentialTool {
  name: string;                    // "github_push"
  description: string;             // shown to agent
  parameters: JSONSchema;          // what the agent provides
  credentialStrategy: CredentialStrategy;  // how to resolve the secret
  credentialRef: string;           // vault path or secret name
  requiredPermission: string;      // "github.push"
  auditLevel: 'normal' | 'high';  // high = extra logging for sensitive ops
}

type CredentialStrategy =
  | { type: 'vault'; provider: '1password' | 'bitwarden' | 'hashicorp'; path: string }
  | { type: 'oauth2'; provider: string; scopes: string[] }
  | { type: 'zk-proof'; verifier: string; claim: string }
  | { type: 'docker-secret'; secretName: string }
  | { type: 'env'; variable: string }  // last resort, least secure
```

### 4.4 What the Agent Sees vs What Happens

```
Agent's view (LLM context):
  Available tools:
    - github_push(repo, branch, files) → "Push files to GitHub"
    - github_read(repo, path) → "Read file from GitHub repo"
    - slack_send(channel, message) → "Send message to Slack channel"

  The agent sees NO credential fields. It cannot even TRY to
  pass a token. The tool interface simply doesn't accept one.

Reality (tool runtime):
  github_push("org/app", "main", ["src/index.ts"]):
    1. Permission check: agent has 'github.push' → ✅
    2. Credential resolve: 1Password → fetch 'github-org-token' → ghp_xxx
    3. API call: POST https://api.github.com/repos/org/app/... with Bearer ghp_xxx
    4. Credential discarded from memory
    5. Return: { success: true, commit: "abc123" }
    6. Audit log: { agent: "devops", tool: "github_push", repo: "org/app", time: "..." }
```

---

## 5. Session Persistence Strategy

### 5.1 Session Architecture

Based on CLI backend research (`docs/CLI-BACKEND-RESEARCH.md`), all Tier 1 backends support session persistence:

| Backend | Create Session | Resume Session | No Session |
|---------|---------------|----------------|------------|
| Claude | `--session-id <uuid>` | `--resume <uuid>` | `--no-session-persistence` |
| Codex | Auto-persisted | `exec resume <id>` | `--ephemeral` |
| Gemini | Auto-persisted | `--resume <id>` | N/A |
| Goose | `--name <name>` | `--resume --name <name>` | `--no-session` |

### 5.2 Session Assignment by Tier

```
Conductor (Mother AI):
  Session: REQUIRED, persistent (--resume <uuid>)
  Rationale: The Conductor is a PERSON, not a router. Like JARVIS in
             Iron Man — it remembers, has personality, learns, grows.
             Conductor's session = the user-Conductor conversation (one thread).
             Context pollution solved by: Conductor sees user conversation only
             (not internal agent chatter), each agent has own session,
             results come back as summaries, Opus handles topic switching.
  Strategy: One persistent session. CLI compacts when context fills.
            Memory (RAG) preserves important context long-term.
            Server still injects dynamic context per-message (agent status,
            pending questions) alongside the session history.

Persistent Agents (CTO, CMO, Companions, Curators, etc.):
  Session: REQUIRED, persistent (--resume <uuid>)
  Rationale: These agents have deep, ongoing conversations and accumulated
             expertise. A CTO that remembers past architecture decisions is
             dramatically more useful than a stateless one.
             Companions need personality continuity and relationship memory.
  Strategy: One session per agent. Persistent indefinitely.
            CLI handles internal compaction when context window fills.

Ephemeral Agents (Workers, One-Off Tasks):
  Session: NONE (--no-session-persistence)
  Rationale: Created for a specific task, destroyed after completion.
             Results captured in the spawner's memory namespace.
             No session overhead, no resource accumulation.
  Strategy: Spawned by Conductor or any persistent agent. Auto-destroyed.
```

### 5.3 Three Layers of Memory

Each agent can have up to three layers of memory, each serving a different purpose:

```
Layer 1: Session Memory (via --resume)
  ├── Source: CLI session persistence (free, built-in)
  ├── Scope: Per agent, full conversation history
  ├── Strength: Perfect recall of recent conversations
  ├── Weakness: Context window limited, only this agent's conversations
  └── Use case: "What did we discuss about the auth refactor?"

Layer 2: RAG Memory (via Memory system)
  ├── Source: bun:sqlite + LanceDB + FTS5 (our memory package)
  ├── Scope: Namespaced (see 5.3.1), semantic search
  ├── Strength: Long-term, cross-agent, semantic similarity
  ├── Weakness: Lossy (embedding quality), requires explicit storage
  └── Use case: "What do we know about customer churn across all teams?"

Layer 3: Structured State (via bun:sqlite)
  ├── Source: Direct SQLite tables (agent registry, cron jobs, config)
  ├── Scope: System-wide, queryable
  ├── Strength: Exact, structured, queryable
  ├── Weakness: No semantic understanding, manual schema
  └── Use case: "How many agents are running? What cron jobs exist?"
```

### 5.3.1 Memory Namespace Tiers

RAG Memory is organized in three access tiers, like a real organization:

```
SHARED MEMORY (org-wide, centralized)
  Namespace: shared/
  Contents: org goals, cross-team decisions, common knowledge, client context
  Access: ALL persistent agents by default (blacklist exceptions)
  Writers: Conductor (org decisions), any agent (proposals, server validates), user (dashboard)
  Example: "We chose PostgreSQL over MySQL" — every agent should know this

DEPARTMENT MEMORY (team-scoped)
  Namespace: eng/, mktg/, fin/, hr/, etc.
  Contents: domain-specific knowledge, team decisions, project context
  Access: Agents in that department (whitelist outsiders for cross-dept collaboration)
  Writers: Agents in the department
  Example: "Auth system uses JWT with RS256" — engineering agents need this

AGENT PRIVATE MEMORY (personal, the agent's "soul")
  Namespace: cto/, river/, conductor/
  Contents: personal preferences, conversation insights, self-reflections
  Access: That agent ONLY (no override, truly private)
  Writers: That agent only (via self-reflection / store_memory tool)
  Example: "User prefers concise answers" — learned by this agent
```

**Search behavior** — when an agent searches memory, it queries all accessible tiers:

```
CTO searches: "database strategy"
  → cto/ (private):     "I prefer microservices with isolated DBs"
  → eng/ (department):  "Auth service uses PostgreSQL, sessions in Redis"
  → shared/ (org-wide): "Company decided PostgreSQL as standard (Jan 2026)"
  All results merged, ranked by relevance. Agent sees unified context.
```

**Ephemeral agent access**: Inherits parent's tiers (shared + parent's department). Cannot access parent's private memory.

**CaaS mode**:
- `shared/` = user's common facts (birthday, preferences, interests) — all companions know you
- `river/`, `alex/` = companion private memories — their unique relationship with you
- Configurable: `sharing: "open"` (companions can request each other's context via Conductor) or `sharing: "strict"` (fully isolated)

### 5.4 Dynamic Context vs Static System Prompt

**For the Conductor (STATEFUL, Mother AI)**:
The Conductor uses `--resume`, so the system prompt is set once at session creation and the session accumulates conversation history. Dynamic context (agent status, pending questions) is injected per-message in the content. NOTE: For Claude Code backend, prefer NOT setting `--system-prompt` — the built-in system prompt is already excellent. Only append role identity if needed.

```
--system-prompt (set ONCE at session creation, optional):
  "You are [user-chosen name], the Conductor. You manage all agents on
   behalf of the user, enforce security, and protect the organization..."
  (Or: omit entirely and let Claude Code's built-in prompt handle it.
   Inject Conductor identity in the first message instead.)

Message content (dynamic context injected per-message by server):
  <pending-questions>...</pending-questions>
  <recent-notifications>...</recent-notifications>
  <agents>...</agents>
  <memory-context>...</memory-context>
  <user-message>We need to add rate limiting to the API</user-message>
```

**For Persistent Agents (STATEFUL)**:
These also use `--resume`, so the system prompt is set once and the session accumulates conversation history. Dynamic context (agent list, memory) is injected per-message in the content.

```
--system-prompt (set ONCE at session creation, never changes):
  "You are the CTO of this organization. You manage engineering agents
   and make technical decisions. You have access to: github, docker, aws."

Message content (injected fresh each invocation):
  <current-agents>
    - code-reviewer (Claude, idle)
    - devops (Codex, busy)
    - qa-engineer (Gemini, idle)
  </current-agents>

  <memory-context>
    Relevant past decisions:
    - 2026-02-15: Chose PostgreSQL over MySQL for the API
    - 2026-02-16: Deployed v2.1 to staging
  </memory-context>

  <user-message>
    We need to add rate limiting to the API
  </user-message>
```

This way, the session accumulates conversation history naturally, while each message gets fresh context about the current state.

---

## 6. Conductor Routing Architecture

### 6.1 The Complete Message Flow

Every user message goes through this pipeline:

```
User sends "proceed"
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  SERVER (Node/Bun process)                                   │
│                                                              │
│  Step 1: Assemble Routing Context                            │
│  ┌─────────────────────────────────────────────────────┐     │
│  │  pendingQuestions: [                                  │     │
│  │    { agentId: "cto", question: "Should I use         │     │
│  │      PostgreSQL or MySQL?", timestamp: 1708... },    │     │
│  │    { agentId: "cmo", question: "Which campaign        │     │
│  │      should I prioritize?", timestamp: 1708... }     │     │
│  │  ]                                                    │     │
│  │  recentNotifications: [                               │     │
│  │    { agentId: "devops", msg: "Deploy v2.1 complete" } │     │
│  │  ]                                                    │     │
│  │  agents: [ cto(idle), cmo(busy), devops(idle) ]       │     │
│  │  memoryResults: [ ...relevant memories from RAG... ]  │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                              │
│  Step 2: Send to Conductor (Opus, STATEFUL --resume)         │
│  ┌─────────────────────────────────────────────────────┐     │
│  │  claude -p "<routing context + user message>"         │     │
│  │    --resume <conductor-session-uuid>                  │     │
│  │    (session has full user-Conductor conversation)     │     │
│  │                                                       │     │
│  │  Conductor sees:                                      │     │
│  │    "User said 'proceed'. CTO asked 'PostgreSQL or     │     │
│  │     MySQL?' 5 min ago. CMO asked 'Which campaign?'    │     │
│  │     2 min ago. DevOps just notified deploy complete."  │     │
│  │                                                       │     │
│  │  Conductor reasons:                                   │     │
│  │    "User is answering the CTO's database question.    │     │
│  │     'proceed' = go ahead with the suggestion.         │     │
│  │     Route to CTO."                                    │     │
│  │                                                       │     │
│  │  Output: { action: "delegate_to_agent",               │     │
│  │           agentId: "cto",                             │     │
│  │           context: "User confirmed: proceed with      │     │
│  │                     the database choice" }            │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                              │
│  Step 3: Dispatch to Agent                                   │
│  ┌─────────────────────────────────────────────────────┐     │
│  │  claude -p "<enriched message>"                       │     │
│  │    --resume <cto-session-uuid>                        │     │
│  │                                                       │     │
│  │  CTO has full conversation history (via session).     │     │
│  │  Knows they asked about PostgreSQL vs MySQL.          │     │
│  │  "proceed" → continues with PostgreSQL implementation │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                              │
│  Step 4: Store & Respond                                     │
│  ┌─────────────────────────────────────────────────────┐     │
│  │  • Check if response should be stored in memory       │     │
│  │  • Clear CTO's pending question from tracking         │     │
│  │  • Stream response back to user via WebSocket         │     │
│  └─────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 Pending Question Tracking

The server tracks which agents have unanswered questions. This is NOT sticky routing (which tracks "last agent to respond") — it specifically tracks agents that ASKED something.

```typescript
interface PendingQuestion {
  agentId: string;
  question: string;       // the text ending with "?"
  timestamp: number;
  messageId: string;      // for deduplication
}

interface RoutingContext {
  pendingQuestions: PendingQuestion[];    // agents waiting for user answer
  recentNotifications: Notification[];   // informational messages (no question)
  agents: AgentStatus[];                 // all agents + state
  memoryResults: MemoryEntry[];          // RAG search results
}
```

**Detection heuristic**: When an agent response ends with a question mark (or contains a question in the last sentence), it's tracked as a pending question. When the user's reply gets routed to that agent, the pending question is cleared.

**Why not sticky routing?** Sticky routing tracks "last agent to respond" and forwards ambiguous messages there. This breaks when:
- Multiple agents respond (CTO asks a question, then DevOps sends a notification)
- The user leaves and returns — "proceed" goes to wrong agent
- The last response was informational, not a question

Pending question tracking solves all these cases by tracking WHO ASKED, not who spoke last.

### 6.3 Server-Level Context Assembly

The server (not the Conductor) assembles routing context before each Conductor invocation:

```typescript
function buildRoutingContext(
  userMessage: string,
  state: RuntimeState
): string {
  const sections: string[] = [];

  // 1. Pending questions (highest priority for routing)
  if (state.pendingQuestions.length > 0) {
    sections.push('<pending-questions>');
    for (const pq of state.pendingQuestions) {
      const ago = humanizeTimeDiff(pq.timestamp);
      sections.push(`  ${pq.agentId} asked ${ago}: "${pq.question}"`);
    }
    sections.push('</pending-questions>');
  }

  // 2. Recent notifications (context, not questions)
  if (state.recentNotifications.length > 0) {
    sections.push('<recent-notifications>');
    for (const n of state.recentNotifications) {
      sections.push(`  ${n.agentId}: ${n.summary}`);
    }
    sections.push('</recent-notifications>');
  }

  // 3. Available agents
  sections.push('<agents>');
  for (const agent of state.agents) {
    sections.push(`  ${agent.id} (${agent.backend}, ${agent.status}): ${agent.role}`);
  }
  sections.push('</agents>');

  // 4. Memory context (RAG results)
  if (state.memoryResults.length > 0) {
    sections.push('<memory-context>');
    for (const m of state.memoryResults) {
      sections.push(`  [${m.category}] ${m.content.slice(0, 200)}`);
    }
    sections.push('</memory-context>');
  }

  // 5. The actual user message
  sections.push(`<user-message>${userMessage}</user-message>`);

  return sections.join('\n');
}
```

### 6.4 Why Opus for Everything

```
Decision: Use Claude Opus for the Conductor. No separate cheap router.

Reasoning:
  • Subscription plan → cost is irrelevant (flat fee regardless of usage)
  • Speed: Opus is fast enough for routing (single JSON decision, not long generation)
  • Quality: Opus reasons correctly about ambiguous messages ("proceed", "yes", "do it")
  • Reliability: No "confidently wrong" risk (Haiku sometimes picks wrong agent with high confidence)
  • Simplicity: One model, one invocation, one decision. No confidence thresholds,
    no fallback chains, no secondary verification.

What the Conductor returns (JSON):
  { action: "delegate_to_agent", agentId: "cto", context: "..." }
  { action: "respond_directly", response: "..." }
  { action: "create_agent", spec: { name: "...", role: "...", ... } }
  { action: "pipeline", agents: ["cto", "cmo"], context: "..." }
```

---

## 7. Agent Creation Flows

### 7.1 Three Paths to Creating Agents

```
Path A: Templates (Onboarding)
  "Start with a template"
  → Choose: Startup Engineering, Marketing Team, Personal Companions, etc.
  → YAML template applied → agents created automatically
  → Good for: first-time users, standard org structures

Path B: Ask Conductor (Primary — Natural Language) ★ RECOMMENDED
  User: "I need someone to handle my GitHub PRs"
  Conductor: "I'll create a Code Reviewer agent with github.read and
              github.comment permissions under the CTO. Here's the spec:
              - Name: Code Reviewer
              - Backend: Claude Sonnet (good quality, fast)
              - Permissions: github.read, github.comment
              - Session: persistent (remembers past reviews)
              - Reports to: CTO
              Shall I proceed?"
  User: "yes"
  → Agent created

  The user describes what they need in natural language. The Conductor
  proposes the agent configuration. User approves. Done.

Path C: Dashboard RPG UI (Power Users)
  → Visual agent creation in the cyberpunk dashboard
  → Drag-and-drop permissions, model selection, personality tuning
  → Good for: users who want fine-grained control
```

### 7.2 Path B in Detail: The "Ask Conductor" Flow

```
Step 1: User describes need
  "I need help managing my social media content calendar"

Step 2: Conductor (stateful, --resume) receives message + injected routing context
  No existing agent matches. Conductor decides: create_agent.

Step 3: Conductor proposes agent spec
  {
    action: "create_agent",
    spec: {
      name: "Social Media Manager",
      role: "Manages content calendar, drafts posts, schedules publishing",
      lifecycle: "persistent",
      parentId: "cmo",           // under CMO department
      backend: "claude",
      model: "claude-sonnet-4-5",
      permissions: ["social.draft", "social.schedule", "cms.read"],
      memoryNamespace: "marketing",
      sessionPersistence: true,
      systemPrompt: "You are a social media manager..."
    }
  }

Step 4: Server validates spec
  • validateAgentCreation() — security blocklists
  • Permission check — proposed tools are within parent's scope
  • Pool capacity check — maxAgents enforcement

Step 5: User confirmation (via WebSocket)
  Dashboard shows: "Conductor wants to create 'Social Media Manager'.
    Permissions: social.draft, social.schedule, cms.read
    Reports to: CMO | Backend: Claude Sonnet | Session: persistent
    [Approve] [Modify] [Reject]"

Step 6: Agent created
  → AgentProcess spawned with --session-id <new-uuid>
  → Registered in pool with parent relationship
  → User's original message forwarded as first task
```

### 7.3 Agent Creation Security

The Conductor proposes agents, but the SERVER enforces constraints:

```
Validation rules:
  1. Agent name: no injection characters, reasonable length
  2. Permissions: MUST be subset of parent agent's permissions
     (ephemeral worker under CTO cannot get social.post if CTO doesn't have it)
  3. System prompt: blocklist check (no curl, wget, process.env, etc.)
  4. Backend: must be a registered backend in BackendRegistry
  5. Lifecycle: ephemeral agents must have a parentId, persistent agents must be user-approved
  6. Pool capacity: reject if maxAgents exceeded (after eviction attempt)
```

---

## 8. Cross-LLM Backend Selection

### 8.1 Why Different LLMs for Different Agents

```
Not all tasks need the most expensive model:

  ┌──────────────────────────────────────────────────────────┐
  │              Cost vs Quality Optimization                 │
  │                                                          │
  │  High quality,                                           │
  │  high cost     ●  Security decisions (Conductor: Claude) │
  │       ▲        ●  Code architecture (CTO: Claude)        │
  │       │        ●  Creative writing (Content: Claude/GPT) │
  │       │                                                  │
  │       │        ●  General routing (CMO: GPT)             │
  │       │        ●  Data analysis (CFO: GPT)               │
  │       │                                                  │
  │       │        ●  Test generation (QA: Gemini)           │
  │       │        ●  SEO analysis (SEO: Gemini)             │
  │       │        ●  Data extraction (Bookkeeper: Gemini)   │
  │  Low cost,                                               │
  │  adequate      ●  Log parsing (Monitor: Gemini Flash)    │
  │                                                          │
  └──────────────────────────────────────────────────────────┘

  Monthly cost with all-Claude:   ~$500
  Monthly cost with cross-LLM:    ~$150  (70% savings)
  Quality difference:             negligible for routine tasks
```

### 8.2 Backend Selection Rules

```typescript
interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  lifecycle: 'persistent' | 'ephemeral';
  parentId?: string;              // parent agent (for delegation chain)
  backend: AIBackend;             // which LLM to use
  backendModel?: string;          // specific model override
  systemPrompt?: string;          // optional — prefer not overwriting CLI built-in
  permissions: string[];          // tool permissions
  memoryNamespace: string;        // memory isolation (shared/, eng/, agent-private/)
  sessionId?: string;             // assigned at creation (persistent agents only)
}

// Persistent agents choose backends for spawned workers:
const ctoAgent: AgentDefinition = {
  id: 'cto',
  name: 'CTO',
  role: 'Chief Technology Officer',
  lifecycle: 'persistent',
  backend: AIBackend.CLAUDE,      // best for architecture decisions
  permissions: ['github.*', 'docker.*', 'aws.ec2.*'],
  memoryNamespace: 'engineering',
};

const qaWorker: AgentDefinition = {
  id: 'qa-task-42',
  name: 'QA Review',
  role: 'Review PR #42',
  lifecycle: 'ephemeral',
  parentId: 'cto',                // spawned by CTO
  backend: AIBackend.GEMINI,      // cheap for one-off test generation
  permissions: ['github.read', 'test.run'],  // subset of CTO's permissions
  memoryNamespace: 'engineering',  // inherits from parent
};
```

### 8.3 Backend Registry

The runtime maintains multiple backend instances simultaneously:

```typescript
// BackendRegistry manages multiple CLIBackend instances
class BackendRegistry {
  private backends: Map<AIBackend, CLIBackend> = new Map();

  register(backend: CLIBackend): void;
  get(name: AIBackend): CLIBackend;
  list(): AIBackend[];
}

// AgentPool uses registry to spawn agents with correct backend
class AgentPool {
  constructor(
    private registry: BackendRegistry,  // NEW: replaces single backend
    private options?: PoolOptions
  ) {}

  async createAgent(definition: AgentDefinition): Promise<AgentProcess> {
    const backend = this.registry.get(definition.backend);
    return new AgentProcess(definition, backend, {
      sessionId: definition.sessionId,
      sessionPersistence: definition.sessionPersistence,
    });
  }
}
```

---

## 9. OaaS vs CaaS Configuration

### 9.1 OaaS (Organization as a Service)

The user creates an AI organization that manages real work:

```yaml
# Example: Startup Engineering Org
organization:
  name: "Acme AI Engineering"
  conductor:
    backend: claude
    model: claude-opus-4-6    # best reasoning for routing + security
    session: true             # STATEFUL — Mother AI with soul, remembers user

  departments:
    - name: "Engineering"
      head:
        name: "CTO"
        backend: claude
        model: claude-opus-4-6
        permissions: [github.*, docker.*, aws.ec2.*, jira.*]
        memory: engineering
      agents:
        - name: "Senior Engineer"
          backend: claude
          model: claude-sonnet-4-5-20250929
          permissions: [github.read, github.write, test.run]
          session: true
        - name: "DevOps"
          backend: codex
          permissions: [docker.*, aws.ec2.*, github.read]
          session: true
        - name: "QA"
          backend: gemini
          permissions: [github.read, test.run]
          session: false  # ephemeral test runs

    - name: "Marketing"
      head:
        name: "CMO"
        backend: claude
        permissions: [social.*, email.draft, cms.*, analytics.read]
        memory: marketing
      agents:
        - name: "Content Writer"
          backend: claude
          permissions: [cms.draft, cms.publish]
          session: true
        - name: "SEO Analyst"
          backend: gemini
          permissions: [analytics.read, serp.query]
          session: false

    - name: "Finance"
      head:
        name: "CFO"
        backend: gemini
        model: gemini-2.5-pro
        permissions: [sheets.*, invoicing.*, banking.read]
        memory: finance
      agents:
        - name: "Bookkeeper"
          backend: gemini
          permissions: [sheets.read, sheets.write, invoicing.read]
          session: true

  credentials:
    github:
      strategy: oauth2
      provider: github
      scopes: [repo, workflow]
    aws:
      strategy: vault
      provider: 1password
      path: "DevOps/AWS Credentials"
    stripe:
      strategy: docker-secret
      secretName: stripe-api-key
```

### 9.2 CaaS (Companions as a Service)

The user creates AI friends/assistants with distinct personalities:

```yaml
# Example: Personal Companion Setup
companions:
  conductor:
    backend: claude
    model: claude-opus-4-6
    session: true   # STATEFUL — Mother AI with soul, remembers user

  friends:
    - name: "Alex"
      personality: "Creative, enthusiastic, loves brainstorming"
      backend: claude           # best for creative conversation
      model: claude-opus-4-6
      permissions: [calendar.read, spotify.*, notes.*]
      memory: personal/alex
      session: true             # remembers your conversations

    - name: "Morgan"
      personality: "Organized, direct, productivity-focused"
      backend: claude
      model: claude-sonnet-4-5-20250929
      permissions: [todo.*, calendar.*, email.draft]
      memory: personal/morgan
      session: true

    - name: "River"
      personality: "Curious, analytical, research-oriented"
      backend: gemini           # cheap for information gathering
      model: gemini-2.5-flash
      permissions: [web.search, notes.*, files.read]
      memory: personal/river
      session: true

    - name: "Sage"
      personality: "Calm, thoughtful, great listener"
      backend: claude
      model: claude-opus-4-6    # best for empathetic conversation
      permissions: [notes.*, journal.*]
      memory: personal/sage
      session: true             # remembers your life context

  credentials:
    spotify:
      strategy: oauth2
      provider: spotify
      scopes: [user-read-playback-state, user-modify-playback-state]
    google:
      strategy: oauth2
      provider: google
      scopes: [calendar.readonly, gmail.compose]
```

### 9.3 Structural Comparison

```
OaaS (Organization):                    CaaS (Companions):

User (Tony Stark / CEO)                 User (the person)
    │                                       │
    └── Conductor (Mother AI, stateful)  └── Conductor (Mother AI, stateful)
          │                                   │
          ├── CTO (persistent, soul)      ├── Alex (persistent, creative)
          │   ├── Engineer (persistent)   ├── Morgan (persistent, productivity)
          │   ├── DevOps (persistent)     ├── River (persistent, research)
          │   └── workers (ephemeral)     └── Sage (persistent, listener)
          │
          ├── CMO (persistent, soul)     No hierarchy needed —
          │   ├── Writer (persistent)    each companion is
          │   └── workers (ephemeral)    independent with its
          │                              own personality, memory,
          └── CFO (persistent, soul)     and soul.
              └── workers (ephemeral)

Emergent hierarchy,                      Flat structure,
strict permissions,                      personality-driven,
cross-agent collaboration.               session persistence is key.
Conductor routes + enforces security.    Conductor routes by personality match.
```

---

## 10. Audit & Anomaly Detection

### 10.1 Audit Log Schema

Every action across the system is logged immutably:

```typescript
interface AuditEntry {
  id: string;
  timestamp: number;
  agentId: string;
  agentLifecycle: 'conductor' | 'persistent' | 'ephemeral';
  action: AuditAction;
  tool?: string;
  parameters?: Record<string, unknown>;  // sanitized, no credentials
  result: 'success' | 'denied' | 'error';
  reason?: string;                       // why denied or error
  parentAgentId?: string;                // who delegated this
}

type AuditAction =
  | 'tool_use'              // agent used a tool
  | 'tool_denied'           // permission check failed
  | 'agent_create'          // agent spawned a child agent
  | 'agent_delete'          // agent destroyed a child agent
  | 'delegation'            // agent delegated to another
  | 'cross_agent'           // cross-agent collaboration request
  | 'credential_access'     // tool resolved a credential
  | 'anomaly_flagged'       // unusual behavior detected
  | 'session_start'         // agent session started
  | 'session_resume';       // agent session resumed
```

### 10.2 Anomaly Detection Rules

```
Rule 1: First-time tool usage
  "QA Engineer used github_write for the first time"
  → Flag, notify CTO agent for review

Rule 2: Frequency spike
  "DevOps made 50 docker_deploy calls in 1 hour (normal: 5)"
  → Flag, pause agent, notify Conductor

Rule 3: Cross-scope attempt
  "Content Writer attempted to use github_push"
  → Deny, log, flag for review

Rule 4: Time anomaly
  "CFO agent active at 3am (no scheduled tasks)"
  → Flag, notify user

Rule 5: Data volume anomaly
  "SEO Analyst reading 10x normal amount of analytics data"
  → Flag, rate limit, notify CMO
```

---

## 11. Migration from Current Architecture

### What Exists Today (SPEC.md / Steps 1-7)

```
Current:
  Conductor (flat router) → AgentPool (flat list) → Memory (global)
  - Single CLIBackend (Claude only, implemented)
  - 2-tier permissions (conductor-owned vs user-owned)
  - Global memory (no namespacing)
  - No session persistence in backend
  - No credential isolation
```

### What Needs to Change

```
Phase 1: Session Support — COMPLETED (2026-02-17)
  ├── Add sessionId to BackendSpawnConfig ✓
  ├── ClaudeProcess tracks sessionCreated flag ✓
  ├── First send() → --session-id, subsequent → --resume ✓
  ├── Tests: verify isolation, verify resume ✓
  ├── Conductor Soul: personality config, pending questions, RoutingContext ✓
  ├── REST API: GET/PUT /api/conductor/settings ✓
  └── Dashboard: ConductorSettingsForm (name, style, traits, presets) ✓

Phase 2: Backend Registry (medium, replaces single backend)
  ├── BackendRegistry class (Map<AIBackend, CLIBackend>)
  ├── AgentPool accepts registry instead of single backend
  ├── Implement CodexBackend, GeminiBackend, GooseBackend
  └── Per-agent backend selection in AgentDefinition

Phase 3: Agent Lifecycle Model (medium, extends agent model)
  ├── Add lifecycle field to AgentDefinition ('persistent' | 'ephemeral')
  ├── Add parentId for parent-child delegation chain
  ├── Persistent agents can spawn/manage ephemeral workers
  ├── Conductor routes to any agent (persistent or ephemeral)
  ├── Agent soul: self-reflection → store_memory tool for long-term learning
  └── Ephemeral auto-cleanup after task completion

Phase 4: Memory Namespacing (medium, extends memory)
  ├── Three-tier namespaces: shared/, department/, agent-private/
  ├── Agents search all accessible tiers merged by relevance
  ├── Persistent agents own their namespace
  ├── Ephemeral workers inherit parent namespace
  ├── Conductor-mediated cross-namespace search (read-only summaries)
  └── Add FTS5 hybrid search (vector + full-text)

Phase 5: Permission & Tool System (large, new subsystem)
  ├── CredentialTool registry
  ├── Zero-Knowledge Architecture: agents untrusted, tool runtime trusted
  ├── Tool runtime sandbox (agent calls tool by name, runtime injects creds)
  ├── Credential resolution: Docker secrets (self-hosted), vault/OAuth (cloud)
  └── Audit log with anomaly detection

Phase 6: Organization Templates (large, new feature)
  ├── YAML/JSON org definition format
  ├── Template registry (built-in + community)
  ├── One-command deploy: pyx deploy --template startup-engineering
  ├── Dashboard UI for visual org creation
  └── Import/export org configurations
```

---

## 12. Open Questions

### Resolved (from design discussions)

- **Conductor statefulness?** → RESOLVED (revised): STATEFUL. `--resume <uuid>`. The Conductor is a Mother AI with a soul — a PERSON, not a router. Remembers user conversations, has personality, learns preferences, grows over time. Context pollution solved by: Conductor sees user conversation only (not internal agent chatter), each persistent agent has own session, results come back as summaries, Opus handles topic switching naturally. Server still injects dynamic context (agent status, pending questions) per-message. Users name their Conductor at first launch.
- **Routing model?** → RESOLVED: Opus for everything. Subscription plan = cost irrelevant. No Haiku, no confidence thresholds, no fallback chain.
- **Ambiguous message routing ("proceed")?** → RESOLVED: Pending question tracking (not sticky routing). Server tracks which agents asked questions. Conductor (Opus) reasons about all pending questions to route correctly.
- **Agent creation flow?** → RESOLVED: Path B ("Ask Conductor") is primary. User describes need in natural language, Conductor proposes config, user approves. Templates for onboarding, Dashboard RPG for power users.
- **User role?** → RESOLVED: User = Tony Stark (CEO). Conductor = Mother AI (user-named). Persistent agents = specialized modules. User talks only to the Conductor.
- **C-level pipeline vs direct delegation?** → RESOLVED: No separate pipeline for persistent agents. The distinction is Persistent vs Ephemeral, not rigid tiers. Persistent agents use their own LLM reasoning to self-solve or delegate (the LLM IS the router). Conductor routes to any agent regardless of lifecycle — persistent domain expert for complex work, ephemeral worker for simple tasks. Hierarchy emerges from `parentId` + delegation permissions, not enforced tiers. "C-level" is a label, not a code path.
- **Permission escalation?** → RESOLVED: No escalation. Agents report findings to parent. Parent re-delegates with appropriate permissions. If a worker (github_read only) finds a critical bug, it reports back to parent. Parent validates, then either self-solves or spawns a new worker WITH the needed permission (github_write) scoped to the specific task. Principle of least privilege enforced at every spawn. Matches real-world: interns don't get prod access because they found a bug.
- **Cross-LLM tool compatibility?** → RESOLVED: Backend adapter pattern. Agent definitions use universal tool names (`tools: ["github_read"]`). Each CLIBackend adapter translates to backend-specific flags (Claude: `--allowedTools`, Codex: `--enable`, Gemini: `--allowed-tools`, Goose: extension config). If a backend doesn't support a tool, adapter skips it or fails at spawn. Tool schema differences are handled by CLI internals — we only filter which built-in tools are available, not define their schemas. Custom tools (MCP servers) configured per-backend via backend's own config mechanism.
- **ZK-proof / credential strategy?** → RESOLVED: Drop "ZK-proof" terminology — implies a cryptographic protocol we don't need. The correct term is **"Zero-Knowledge Architecture"**: agents have zero knowledge of credentials. Agents are explicitly UNTRUSTED (hallucination, prompt injection, non-determinism). A2A is explicitly UNTRUSTED. All trust lives in OUR CODE: (1) Tool Runtime (trusted) — agent calls tool by name+params, runtime validates, injects credentials from secret store, makes API call, sanitizes response. Agent never sees tokens. (2) A2A Relay (trusted) — server mediates ALL inter-agent messages, logs, sanitizes, enforces permissions. Agents never talk directly. (3) Secret Store (trusted) — Docker secrets / vault / 1Password. Encrypted at rest. Implementation: start with tool runtime resolution + Docker secrets (self-hosted) / OAuth + vault (cloud). No cryptographic ZK needed.

- **Organization Template marketplace?** → RESOLVED: YAML only. No code in templates (security risk — arbitrary code execution from untrusted sources, npm supply chain attack problem). Templates define agent configs, permissions, memory namespaces, and hierarchy. Custom tools via user's own MCP config. Custom routing via system prompts, not code.
- **CaaS memory isolation?** → RESOLVED: Yes, Conductor-mediated memory sharing. Companions can REQUEST cross-memory search via the Conductor, get read-only summaries (not raw memory). No direct memory access between agents. Conductor decides relevance + privacy. User-configurable isolation level (`strict` = no sharing, `open` = Conductor-mediated). Agents must collaborate for synergy — isolation is for security, sharing is for better ideas/results. Same applies to OaaS: CTO can request CMO's marketing context through the Conductor when cross-domain collaboration is needed.
- **Centralized shared memory?** → RESOLVED: Three-tier memory namespaces. (1) `shared/` = org-wide centralized memory accessible by all persistent agents (blacklist exceptions). Contains goals, cross-team decisions, common knowledge. (2) Department-scoped (`eng/`, `mktg/`, etc.) for team knowledge. (3) Agent-private for personal soul/preferences. Agents search all accessible tiers merged by relevance. Ephemeral workers inherit parent's access. See Section 5.3.1.
- **Pending question expiry?** → RESOLVED: Hybrid — 30 minutes OR 3 unrelated messages, whichever comes first. Time-based alone fails during active chats (stale after 20 messages). Interaction-based alone fails during AFK (3-hour-old question persists). Conductor determines "unrelated" as part of routing reasoning. Server tracks `unrelatedMessageCount` per pending question.
- **Session rotation for persistent agents?** → RESOLVED: Let the CLI handle internal compaction. Claude Code and other Tier 1 backends already handle context window management (compaction, summarization). Important insights are preserved in RAG Memory via the agent's self-reflection (store_memory tool). If CLI compaction loses something, RAG has it. No need for manual session rotation — it adds complexity for a problem the CLI already solves.

### Still Open

(All questions resolved as of 2026-02-17.)

---

## 13. References

- `docs/SPEC.md` — Original template specification (build steps 1-11)
- `docs/PRODUCT-DISCOVERY.md` — Feature docs, competitive analysis, OpenClaw deep dive
- `docs/CLI-BACKEND-RESEARCH.md` — Session persistence and backend capabilities research
- `packages/shared/src/types/a2a.ts` — Current AIBackend enum and capability types
- `packages/agent-manager/src/backends/` — Current backend implementations
- `packages/conductor/src/permissions.ts` — Current 2-tier permission model
