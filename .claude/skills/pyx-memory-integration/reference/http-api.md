# pyx-memory HTTP API Reference

## Authentication

When the server has `API_KEY` configured, all requests (except `/health`) require one of:

```
Authorization: Bearer <your-api-key>
X-API-Key: <your-api-key>
```

Destructive operations (DELETE, forget, decay, consolidate, reindex) require `ADMIN_API_KEY` when configured (falls back to `API_KEY`).

`MemoryClient` handles this automatically when `apiKey` is passed to the constructor:
```typescript
const client = new MemoryClient('http://localhost:7822', process.env.MEMORY_API_KEY);
```

## Core (10 endpoints)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Public health check (status only — no internals exposed) |
| GET | `/admin/health` | Admin health check (version, uptime, embedding provider, memory stats) |
| POST | `/api/memory/ingest` | Store a memory (JSON: `{ content, type, metadata, agentId?, sessionId?, targets?, entities?, relationships?, importance?, source?, eventTime?, id?, parentId?, ingestTime? }`) |
| POST | `/api/memory/ingest/file` | Upload file (multipart, 50MB limit) |
| GET | `/api/memory/search?query=...&strategy=...&limit=...` | Search memories — **does NOT support** filters, enableHyDE, enableRerank |
| GET | `/api/memory/stats` | Memory statistics |
| GET | `/api/memory/entries?page=...&limit=...` | List entries (paginated) |
| GET | `/api/memory/entries/:id` | Get entry by ID |
| DELETE | `/api/memory/entries/:id` | Delete entry |
| DELETE | `/api/memory/sessions/:sessionId` | Clear session |

## Graph (4 endpoints)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/memory/graph/nodes?name=...&type=...` | Find graph nodes |
| GET | `/api/memory/graph/edges` | Graph stats |
| GET | `/api/memory/graph/relationships` | List relationships |
| POST | `/api/memory/graph/query` | Traverse (JSON: `{ nodeId, depth? }`) |

## Lifecycle (9 endpoints)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/memory/consolidate` | Run consolidation pipeline |
| POST | `/api/memory/forget/:id` | Soft-delete (JSON: `{ reason? }`) |
| POST | `/api/memory/sessions/:sid/summarize` | Summarize session |
| POST | `/api/memory/decay` | Run decay pass |
| POST | `/api/memory/reindex` | Rebuild FTS5 + vector indices |
| DELETE | `/api/memory/source/:source` | Delete by source |
| GET | `/api/memory/consolidation-log` | Audit trail |
| GET | `/api/memory/query-as-of?asOf=...` | Bi-temporal point-in-time query (asOf, type, agentId, source, limit) |
| GET | `/api/memory/query-by-event-time?startTime=...&endTime=...` | Bi-temporal event time range query (startTime, endTime, type, agentId, source, limit) |

## Response Format

All responses follow: `{ success: boolean, data?: T, error?: string }`

---

## Server Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMORY_SERVER_PORT` | `7822` | HTTP server port |
| `DATA_DIR` | `./data` | Storage directory |
| ~~`EMBEDDING_PROVIDER`~~ | — | **Removed** — embedding is now internal (BGE-M3 via LocalEmbeddingProvider) |
| ~~`EMBEDDING_API_KEY`~~ | — | **Removed** — no external embedding provider needed |
| ~~`EMBEDDING_MODEL`~~ | — | **Removed** — model is always BGE-M3 (ONNX int8 quantized) |
| `EMBEDDING_DIMENSIONS` | `1024` | Dimension override for the internal LocalEmbeddingProvider (default: 1024) |
| `NEO4J_URL` | — | Neo4j bolt URL (enables Neo4j graph store) |
| `NEO4J_USERNAME` | `neo4j` | Neo4j username |
| `NEO4J_PASSWORD` | — | Neo4j password (never logged) |
| `API_KEY` | — | API key for authenticating requests. Unset = open access |
| `ADMIN_API_KEY` | — | Separate admin key for destructive ops (DELETE, forget, decay, consolidate, reindex). Falls back to `API_KEY` |
| `CORS_ORIGIN` | `*` | CORS allowed origin. Set to specific domain in production |
| `MAX_REQUEST_BODY_MB` | `10` | Maximum request body size in MB |
| `NODE_ENV` | `development` | Set to `production` to mask 5xx error details and enable HSTS |
| `PII_POLICY` | `flag` | PII handling: `flag` (detect + tag), `redact` (replace with [REDACTED]), `block` (reject 400) |
| `RATE_LIMIT_RPM` | `0` | Requests per minute per IP. 0 = disabled |
