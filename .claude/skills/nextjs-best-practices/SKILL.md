---
name: nextjs-best-practices
description: Next.js App Router patterns for caching (use cache, cacheLife, PPR), Server/Client components, Server Actions, Route Handlers, streaming, and performance. Proactively use this skill when building, reviewing, or debugging any Next.js code.
allowed-tools: Read, Grep, Glob, Edit, Write
---

<!--
  Version: 2026-01 | Next.js 16.x / App Router
  Source: https://nextjs.org/docs
  Update this skill when Next.js caching or rendering model changes significantly.
-->

# Next.js Best Practices (App Router)

Apply these decision frameworks when working with Next.js App Router. Rules are strict.

## Critical Rules (Always Apply)

1. **Server Components are the default** - Only add `'use client'` when absolutely required
2. **Push client boundaries down** - Never mark pages/layouts as Client Components
3. **Cache Components over unstable_cache** - Use `'use cache'` directive for new code
4. **Server Actions for mutations** - Prefer over Route Handlers for form submissions
5. **Suspense for async boundaries** - Wrap async components, not pages

---

## Decision Tree 1: Server Component vs Client Component

```
START: Writing a new component
    │
    ├─► Does it use React hooks (useState, useEffect, useReducer)?
    │       YES → Client Component ('use client')
    │       NO  ↓
    │
    ├─► Does it use browser APIs (window, localStorage, navigator)?
    │       YES → Client Component ('use client')
    │       NO  ↓
    │
    ├─► Does it attach event handlers (onClick, onChange, onSubmit)?
    │       YES → Client Component ('use client')
    │       NO  ↓
    │
    └─► Keep as Server Component (default, no directive needed)
```

### Correct Pattern: Push Client Boundary Down

```tsx
// page.tsx - Server Component (NO 'use client' here)
import { getProducts } from '@/lib/db'
import { AddToCartButton } from './AddToCartButton'

export default async function ProductPage() {
  const products = await getProducts() // Direct DB access

  return (
    <div>
      <h1>Products</h1>
      {products.map(p => (
        <div key={p.id}>
          <span>{p.name}</span>
          <AddToCartButton productId={p.id} /> {/* Only this is client */}
        </div>
      ))}
    </div>
  )
}

// AddToCartButton.tsx - Client Component (minimal scope)
'use client'

export function AddToCartButton({ productId }: { productId: string }) {
  return <button onClick={() => addToCart(productId)}>Add to Cart</button>
}
```

### WRONG: Do Not Do This

```tsx
// WRONG: Entire page as Client Component
'use client' // ❌ Never do this at page level

export default function ProductPage() {
  const [products, setProducts] = useState([])

  useEffect(() => {
    fetch('/api/products').then(r => r.json()).then(setProducts)
  }, [])
  // ...
}
```

**For detailed patterns, see [components.md](components.md)**

---

## Decision Tree 2: Caching Strategy

```
START: Need to cache data or computation
    │
    ├─► Is it a fetch() request?
    │       │
    │       ├─► Static (rarely changes)?
    │       │       → fetch(url) // Cached by default
    │       │
    │       ├─► Time-based freshness?
    │       │       → fetch(url, { next: { revalidate: 3600 } })
    │       │
    │       └─► Need on-demand invalidation?
    │               → fetch(url, { next: { tags: ['products'] } })
    │
    └─► Is it a database query / ORM / computation?
            │
            ├─► Shared across all users?
            │       → 'use cache' + cacheLife('profile')
            │
            ├─► User-specific but cacheable?
            │       → 'use cache: private' + cacheLife()
            │
            └─► Need on-demand invalidation?
                    → Add cacheTag('tag') + updateTag('tag')
```

### Cache Components Setup (Required)

```typescript
// next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  cacheComponents: true, // REQUIRED for 'use cache'
}

export default nextConfig
```

### cacheLife Profiles (Choose One)

| Profile | Use Case | When to Use |
|---------|----------|-------------|
| `'seconds'` | Real-time data | Stock prices, live scores |
| `'minutes'` | Frequent updates | Social feeds, notifications |
| `'hours'` | Several daily updates | Product inventory, weather |
| `'days'` | Daily updates | Blog posts, articles |
| `'weeks'` | Weekly updates | Podcasts, documentation |
| `'max'` | Rarely changes | Legal pages, about pages |

### Correct Pattern: Cache Components

```typescript
import { cacheLife, cacheTag } from 'next/cache'

// Cache database query with tags
async function getProducts() {
  'use cache'
  cacheLife('hours')
  cacheTag('products')

  return await db.product.findMany()
}

// Invalidate after mutation
'use server'
import { updateTag } from 'next/cache'

export async function createProduct(data: FormData) {
  await db.product.create({ ... })
  updateTag('products') // All 'products' caches invalidated
}
```

### WRONG: Using unstable_cache (Deprecated)

```typescript
// WRONG: Old pattern - migrate to 'use cache'
import { unstable_cache } from 'next/cache' // ❌ Deprecated

const getCachedProducts = unstable_cache(
  async () => db.product.findMany(),
  ['products'],
  { revalidate: 3600 }
)
```

**For detailed caching patterns, see [caching.md](caching.md)**

---

## Decision Tree 3: Data Mutation Approach

```
START: Need to mutate data (create/update/delete)
    │
    ├─► Is it from a form submission?
    │       YES → Server Action (always preferred)
    │
    ├─► Is it called from external clients (webhooks, mobile apps)?
    │       YES → Route Handler (POST/PUT/DELETE)
    │
    ├─► Need to expose as public API?
    │       YES → Route Handler
    │
    └─► Complex request processing (streaming, file upload)?
            YES → Route Handler
            NO  → Server Action
```

### Correct Pattern: Server Action

```typescript
// actions.ts
'use server'

import { revalidatePath } from 'next/cache'

export async function createPost(formData: FormData) {
  const title = formData.get('title') as string

  await db.post.create({ data: { title } })
  revalidatePath('/posts')
}

// page.tsx - Works without JavaScript
export default function NewPost() {
  return (
    <form action={createPost}>
      <input name="title" required />
      <button type="submit">Create</button>
    </form>
  )
}
```

### When to Use Route Handler Instead

```typescript
// app/api/webhook/route.ts - External webhook
export async function POST(request: Request) {
  const payload = await request.json()
  // Process webhook from external service
  return Response.json({ received: true })
}
```

**For detailed patterns, see [data-mutations.md](data-mutations.md)**

---

## Decision Tree 4: Rendering Strategy

```
START: Determining page/component rendering
    │
    ├─► Content is fully static (no data)?
    │       → Static rendering (default)
    │
    ├─► Content from cacheable data source?
    │       → Use 'use cache' + Suspense (PPR)
    │
    ├─► Part of page is user-specific?
    │       → Static shell + Suspense streaming
    │
    └─► Entire page depends on request (cookies, headers)?
            → Dynamic rendering (use connection())
```

### Partial Prerendering (PPR) Pattern

```typescript
import { Suspense } from 'react'
import { cacheLife } from 'next/cache'

export default function Page() {
  return (
    <>
      {/* Static shell - rendered at build time */}
      <Header />
      <Navigation />

      {/* Cached dynamic - included in shell, revalidates */}
      <ProductList />

      {/* Runtime dynamic - streams at request time */}
      <Suspense fallback={<CartSkeleton />}>
        <UserCart />
      </Suspense>
    </>
  )
}

// Cached component (shared across users)
async function ProductList() {
  'use cache'
  cacheLife('hours')

  const products = await db.product.findMany()
  return <ul>{products.map(p => <li key={p.id}>{p.name}</li>)}</ul>
}

// Dynamic component (user-specific)
async function UserCart() {
  const session = await getSession()
  const cart = await getCart(session.userId)
  return <Cart items={cart.items} />
}
```

**For streaming and loading patterns, see [performance.md](performance.md)**

---

## Quick Reference: Common Patterns

### Metadata (SEO)

```typescript
// Static metadata
export const metadata = {
  title: 'My Page',
  description: 'Page description'
}

// Dynamic metadata
export async function generateMetadata({ params }) {
  const post = await getPost(params.slug)
  return {
    title: post.title,
    openGraph: { images: [post.image] }
  }
}
```

### Loading States

```typescript
// app/posts/loading.tsx - Route-level loading
export default function Loading() {
  return <PostsSkeleton />
}

// Component-level with Suspense
<Suspense fallback={<Skeleton />}>
  <AsyncComponent />
</Suspense>
```

### Error Handling

```typescript
// app/posts/error.tsx
'use client'

export default function Error({ error, reset }) {
  return (
    <div>
      <h2>Something went wrong</h2>
      <button onClick={() => reset()}>Try again</button>
    </div>
  )
}
```

### Dynamic Imports (Client-Only Libraries)

```typescript
'use client'
import dynamic from 'next/dynamic'

const Chart = dynamic(() => import('@/components/Chart'), {
  ssr: false, // Only render on client
  loading: () => <ChartSkeleton />
})
```

---

## Anti-Patterns (Never Do These)

| Anti-Pattern | Why It's Wrong | Correct Approach |
|--------------|----------------|------------------|
| `'use client'` at page level | Breaks SSR, larger bundles | Push to leaf components |
| `useEffect` for data fetching | Client waterfall, no SSR | Server Component + async |
| `unstable_cache` in new code | Deprecated API | `'use cache'` directive |
| API Route for form submission | Extra roundtrip | Server Action |
| Fetching in `getServerSideProps` | Pages Router pattern | Server Component fetch |
| `cache: 'no-store'` everywhere | Over-fetching | Use appropriate cacheLife |

---

## File References

- **[caching.md](caching.md)** - Cache Components, cacheLife profiles, PPR, invalidation
- **[components.md](components.md)** - Server/Client patterns, composition, boundaries
- **[data-mutations.md](data-mutations.md)** - Server Actions, Route Handlers, forms
- **[performance.md](performance.md)** - Streaming, dynamic imports, optimization
