# Server/Client Components Reference

<!-- Version: 2026-01 | Next.js 16.x -->

## Core Rule

All components are **Server Components by default**. Only add `'use client'` when required.

---

## When to Use 'use client'

Add `'use client'` ONLY if the component:
- Uses hooks: `useState`, `useEffect`, `useRef`, `useReducer`, `useContext`
- Uses browser APIs: `window`, `localStorage`, `document`
- Attaches event handlers: `onClick`, `onChange`, `onSubmit`
- Uses third-party hooks libraries

If none apply → Keep as Server Component (no directive).

---

## Pattern: Push Client Boundary Down

**Correct:** Only interactive leaf is Client Component
```tsx
// page.tsx - Server Component
export default async function Page() {
  const products = await db.product.findMany()
  return (
    <div>
      <h1>Products</h1>
      {products.map(p => (
        <ProductCard key={p.id} product={p}>
          <AddToCartButton id={p.id} /> {/* Only this is client */}
        </ProductCard>
      ))}
    </div>
  )
}

// AddToCartButton.tsx - Client Component
'use client'
export function AddToCartButton({ id }: { id: string }) {
  return <button onClick={() => addToCart(id)}>Add</button>
}
```

**Wrong:** Entire page as Client Component
```tsx
'use client' // ❌ Never at page level
export default function Page() {
  const [data, setData] = useState([])
  useEffect(() => { fetch('/api/x').then(...) }, [])
  // ...
}
```

---

## Pattern: Composition via Children

Pass Server Components as children to preserve server rendering:

```tsx
// Modal.tsx - Client Component
'use client'
export function Modal({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && <div className="modal">{children}</div>}
    </>
  )
}

// page.tsx - Server Component
export default async function Page() {
  const data = await fetchData()
  return (
    <Modal>
      <ServerContent data={data} /> {/* Still server-rendered */}
    </Modal>
  )
}
```

---

## Pattern: Context Provider Boundary

```tsx
// providers.tsx - Client Component
'use client'
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <CartProvider>{children}</CartProvider>
    </ThemeProvider>
  )
}

// layout.tsx - Server Component
export default function Layout({ children }) {
  return (
    <html>
      <body>
        <Providers>{children}</Providers> {/* Server children work */}
      </body>
    </html>
  )
}
```

---

## Pattern: Form with Server Action

```tsx
// page.tsx - Server Component
import { createPost } from './actions'
import { SubmitButton } from './SubmitButton'

export default function Page() {
  return (
    <form action={createPost}>
      <input name="title" required />
      <SubmitButton /> {/* Only button needs client */}
    </form>
  )
}

// SubmitButton.tsx - Client Component
'use client'
import { useFormStatus } from 'react-dom'

export function SubmitButton() {
  const { pending } = useFormStatus()
  return <button disabled={pending}>{pending ? 'Saving...' : 'Save'}</button>
}
```

---

## Quick Reference

| Component Type | 'use client'? |
|----------------|---------------|
| Page/Layout | No |
| Data display | No |
| Form container | No |
| Submit button (with pending state) | Yes |
| Interactive widget | Yes |
| Context provider | Yes |
| error.tsx | Yes (needs reset) |
| loading.tsx | No |
