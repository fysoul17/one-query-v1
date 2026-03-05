# Feature Parity: Embedded vs Sidecar

**Most features are available in both modes.** The HTTP API and MemoryClient forward all core `StoreInput` fields. A few advanced search parameters remain embedded-only.

## store() Field Parity

| Field | Embedded `Memory.store()` | Sidecar `MemoryClient.store()` |
|-------|--------------------------|-------------------------------|
| content | yes | yes |
| type | yes | yes |
| metadata | yes | yes |
| agentId | yes | yes |
| sessionId | yes | yes |
| targets | yes | yes |
| entities | yes | yes |
| relationships | yes | yes |
| importance | yes | yes |
| source | yes | yes |
| eventTime | yes | yes |
| id (custom) | yes | yes |
| parentId | yes | yes |
| ingestTime | yes | yes |

**All StoreInput fields are forwarded.** Full parity.

## search() Param Parity

| Param | Embedded `Memory.search()` | Sidecar `MemoryClient.search()` |
|-------|---------------------------|--------------------------------|
| query, limit, type, agentId, strategy | yes | yes |
| eventTimeRange (bi-temporal search) | yes | yes |
| asOf (point-in-time search) | yes | yes |
| **filters** (source, importanceMin, parentId, contentType) | yes | **NO** — not forwarded |
| **enableHyDE** | yes | **NO** — not forwarded |
| **enableRerank** | yes | **NO** — not forwarded |

**Impact**: Sidecar consumers cannot use advanced search filters, HyDE query expansion, or reranking. Temporal search filters (eventTimeRange, asOf) ARE supported.

## Endpoint Coverage by Client

| Server Endpoint | MemoryClient | DashboardClient |
|----------------|-------------|-----------------|
| All core (9) | yes | yes (inherited) |
| Graph nodes/edges/query (3) | yes (concrete methods) | yes (inherited) |
| **Graph relationships** | **NO** | yes (`graphRelationships()`) |
| All lifecycle (7) | yes | yes (inherited) |
| **Consolidation log** | **NO** | yes (`consolidationLog()`) |
| Query as-of (bi-temporal) | yes (`queryAsOf()`) | yes (inherited) |
| Query by event time | yes (`queryByEventTime()`) | yes (inherited) |

## Security Features (Server-side)

| Feature | Configuration |
|---------|--------------|
| API key auth | `API_KEY` env var (unset = open access) |
| Admin key for destructive ops | `ADMIN_API_KEY` env var |
| Rate limiting | `RATE_LIMIT_RPM` env var (0 = disabled) |
| CORS | `CORS_ORIGIN` env var (default: `*`) |
| Security headers | Always on (CSP, X-Frame-Options, nosniff) |
| HSTS | Auto-enabled when `NODE_ENV=production` |
| PII policy | `PII_POLICY` env var (`flag` / `redact` / `block`) |
| Body size limit | `MAX_REQUEST_BODY_MB` env var (default: 10) |
| Error masking | 5xx details hidden when `NODE_ENV=production` |
