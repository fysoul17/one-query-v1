---
name: conductor-soul
description: >
  Guide for configuring the conductor's constitutional identity and cognitive
  architecture. Use when setting up a new deployment, customizing the conductor's
  personality, defining core identity, or understanding the soul/memory/experience
  layering model. Triggers on: 'conductor soul', 'conductor identity',
  'customize persona', 'core memory', 'constitutional rules', 'setup conductor',
  'rebrand', 'white-label', 'conductor personality'.
---

# Conductor Soul — Configuration Guide

The conductor uses a three-layer cognitive architecture:

## The Three Layers

### Layer 1: Soul (`data/soul.md`) — Immutable at Runtime
- Constitutional rules, purpose, and behavioral constraints
- Loaded once at boot from `data/soul.md`
- No API endpoint or system-action can modify it
- Only human admins with filesystem/Docker access can edit

### Layer 2: Core Memory (`MemoryType.LONG_TERM` with `core: true`) — Admin-Only
- Name, company identity, personality traits
- Stored in memory with `metadata: { core: true, adminOnly: true }`
- The conductor reads core memory via RAG but cannot write it
- Set via Dashboard or admin API

### Layer 3: Experience (regular memory) — Automatic
- Conversations, learned facts, session context
- Written automatically by the conductor pipeline
- Searched via RAG on every incoming message

## Customizing the Soul

### Step 1: Edit `data/soul.md`

The soul file is pure Markdown. It should contain:
- Core purpose (why does this system exist?)
- Constitutional rules (what will it never do?)
- Communication style (how should it speak?)
- Behavioral constraints

The soul should NOT contain:
- Name (set via Core Memory after deployment)
- Company-specific details (set via Core Memory)
- Domain knowledge (ingest into regular memory)

See `references/customization-guide.md` for a full template and examples.

### Step 2: Set Core Identity via Memory

After deployment, seed core identity as memory entries:
```
POST /api/memory/ingest
{
  "content": "My name is Acme AI. I serve Acme Corp, a manufacturing company.",
  "type": "long-term",
  "metadata": { "core": true, "adminOnly": true }
}
```

### Step 3: Ingest Domain Knowledge

Use Dashboard file upload or the memory ingestion API to add domain-specific knowledge that agents can retrieve via RAG.

## Security Model

See `references/security-model.md` for full details.

**Key guarantees:**
- The soul file (`data/soul.md`) is read-only at runtime
- No REST endpoint writes to the soul file
- No `<system-action>` can modify the soul
- The conductor cannot alter its own constitutional rules
- Core memory entries with `adminOnly: true` are not writable by agents

## File Locations

| File | Purpose |
|------|---------|
| `data/soul.md` | The conductor's soul (edit to customize) |
| `packages/conductor/src/soul.ts` | Soul loader (reads file, falls back to default) |
| `packages/conductor/src/system-context.ts` | Dynamic runtime context (agents, actions) |
| `packages/conductor/src/conductor.ts` | Orchestrator that composes soul + context + memory |

## Prompt Composition Order

```
[Soul]           <- from data/soul.md (identity, rules)
[System Context] <- dynamic: agent list, actions, memory rules
[Memory Context] <- from RAG search results
[User Message]   <- the actual message
```
