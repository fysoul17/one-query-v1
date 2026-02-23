# Caching Reference

<!-- Version: 2026-01 | Next.js 16.x -->

## Setup (Required)

```typescript
// next.config.ts
const nextConfig: NextConfig = {
  cacheComponents: true, // Enables 'use cache' directive
}
```

---

## 'use cache' Directive

Cache function/component output. Cache key = function name + serialized args.

```typescript
import { cacheLife, cacheTag } from 'next/cache'

async function getProduct(id: string) {
  'use cache'
  cacheLife('hours')
  cacheTag('products', `product-${id}`)

  return db.product.findUnique({ where: { id } })
}
```

**Variants:**
- `'use cache'` - Shared cache (all users see same data)
- `'use cache: private'` - Per-user cache (can access cookies)

---

## cacheLife() Profiles

| Profile | stale | revalidate | Use Case |
|---------|-------|------------|----------|
| `'seconds'` | ~0 | ~seconds | Stock prices, live scores |
| `'minutes'` | ~min | ~min | Social feeds, notifications |
| `'hours'` | ~hr | ~hr | Product inventory, weather |
| `'days'` | ~day | ~day | Blog posts, articles |
| `'weeks'` | ~wk | ~wk | Documentation, podcasts |
| `'max'` | ~max | ~max | Legal pages, archived content |

**Custom timing:**
```typescript
cacheLife({ stale: 300, revalidate: 900, expire: 3600 })
// stale: client uses without server check
// revalidate: background regeneration interval
// expire: max age before blocking regeneration
```

**Define custom profiles in config:**
```typescript
// next.config.ts
cacheLife: {
  editorial: { stale: 600, revalidate: 3600, expire: 86400 }
}
// Usage: cacheLife('editorial')
```

---

## Cache Invalidation

**Tag cached data:**
```typescript
async function getProducts() {
  'use cache'
  cacheTag('products') // Tag for invalidation
  return db.product.findMany()
}
```

**Invalidate on mutation:**
```typescript
'use server'
import { updateTag } from 'next/cache'

export async function createProduct(data: FormData) {
  await db.product.create({ ... })
  updateTag('products') // Invalidates all 'products' caches
}
```

---

## fetch() Caching

For fetch requests (not ORM), use native options:

```typescript
// Cached indefinitely (default)
fetch(url)

// Time-based revalidation
fetch(url, { next: { revalidate: 3600 } })

// Tag-based invalidation
fetch(url, { next: { tags: ['products'] } })

// No cache
fetch(url, { cache: 'no-store' })
```

---

## Partial Prerendering (PPR)

Static shell + dynamic holes that stream at request time.

```typescript
export default function Page() {
  return (
    <>
      {/* STATIC: In shell, instant */}
      <Header />

      {/* CACHED: In shell, revalidates per cacheLife */}
      <ProductList />

      {/* DYNAMIC: Streams at request time */}
      <Suspense fallback={<Skeleton />}>
        <UserCart />
      </Suspense>
    </>
  )
}

async function ProductList() {
  'use cache'
  cacheLife('hours')
  return <Products data={await db.product.findMany()} />
}

async function UserCart() {
  // No cache - uses cookies, runs per-request
  const session = await cookies()
  return <Cart userId={session.get('userId')} />
}
```

---

## Force Dynamic Rendering

Use `connection()` to opt out of static generation:

```typescript
import { connection } from 'next/server'

export default async function Page() {
  await connection() // Force dynamic
  return <div>Generated: {new Date().toISOString()}</div>
}
```

---

## Migration: unstable_cache → 'use cache'

| Before (deprecated) | After (recommended) |
|---------------------|---------------------|
| `unstable_cache(fn, keys, opts)` | `'use cache'` + `cacheLife()` + `cacheTag()` |
| `revalidateTag('x')` | `updateTag('x')` |
| Manual key array | Automatic from args |
