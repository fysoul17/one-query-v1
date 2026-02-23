# Performance Reference

<!-- Version: 2026-01 | Next.js 16.x -->

## Streaming with Suspense

**Route-level loading:**
```tsx
// app/posts/loading.tsx
export default function Loading() {
  return <PostsSkeleton />
}
```

**Component-level (granular):**
```tsx
import { Suspense } from 'react'

export default function Page() {
  return (
    <>
      <Header /> {/* Instant */}

      <Suspense fallback={<StatsSkeleton />}>
        <Stats /> {/* Streams when ready */}
      </Suspense>

      <Suspense fallback={<ChartSkeleton />}>
        <Chart /> {/* Streams independently */}
      </Suspense>
    </>
  )
}
```

---

## Parallel Data Fetching

**Wrong - sequential waterfall:**
```tsx
const user = await getUser()     // 200ms
const posts = await getPosts()   // 300ms
const comments = await getComments() // 250ms
// Total: 750ms
```

**Correct - parallel:**
```tsx
const [user, posts, comments] = await Promise.all([
  getUser(),      // 200ms
  getPosts(),     // 300ms  } Run simultaneously
  getComments()   // 250ms
])
// Total: 300ms (slowest one)
```

**Best - parallel with streaming:**
```tsx
<Suspense fallback={<UserSkeleton />}>
  <User /> {/* ~200ms */}
</Suspense>
<Suspense fallback={<PostsSkeleton />}>
  <Posts /> {/* ~300ms */}
</Suspense>
// Each streams independently as it completes
```

---

## Dynamic Imports

**Heavy component in separate chunk:**
```tsx
import dynamic from 'next/dynamic'

const HeavyChart = dynamic(() => import('./HeavyChart'), {
  loading: () => <ChartSkeleton />
})
```

**Browser-only (no SSR):**
```tsx
const Map = dynamic(() => import('./Map'), {
  ssr: false, // Uses window/document
  loading: () => <MapSkeleton />
})
```

**Conditional loading:**
```tsx
'use client'
const Modal = dynamic(() => import('./Modal'))

export function Page() {
  const [show, setShow] = useState(false)
  return (
    <>
      <button onClick={() => setShow(true)}>Open</button>
      {show && <Modal />} {/* Only loaded when needed */}
    </>
  )
}
```

---

## Image Optimization

```tsx
import Image from 'next/image'

// LCP image - add priority
<Image src={hero} alt="Hero" priority />

// Responsive
<Image
  src={product.image}
  alt={product.name}
  fill
  sizes="(max-width: 768px) 100vw, 50vw"
/>

// Remote images require config
// next.config.ts
images: {
  remotePatterns: [{ hostname: 'cdn.example.com' }]
}
```

---

## Error Handling

```tsx
// app/posts/error.tsx
'use client'

export default function Error({
  error,
  reset
}: {
  error: Error
  reset: () => void
}) {
  return (
    <div>
      <h2>Error: {error.message}</h2>
      <button onClick={reset}>Retry</button>
    </div>
  )
}
```

---

## Checklist

- [ ] Server Components by default
- [ ] `'use client'` only at leaf components
- [ ] `Promise.all` for parallel fetches
- [ ] Suspense around slow async components
- [ ] `priority` on LCP image only
- [ ] `dynamic()` for heavy/browser-only components
- [ ] `'use cache'` + appropriate `cacheLife`
