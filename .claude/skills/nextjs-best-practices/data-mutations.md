# Data Mutations Reference

<!-- Version: 2026-01 | Next.js 16.x -->

## Quick Decision

| Scenario | Use |
|----------|-----|
| Form submission from Next.js app | Server Action |
| Webhook from external service | Route Handler |
| Public REST API | Route Handler |
| Mobile/external client | Route Handler |
| Internal mutation | Server Action |

---

## Server Actions (Default Choice)

**Define in separate file:**
```typescript
// actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function createPost(formData: FormData) {
  const title = formData.get('title') as string
  await db.post.create({ data: { title } })
  revalidatePath('/posts')
  redirect('/posts')
}

export async function deletePost(id: string) {
  await db.post.delete({ where: { id } })
  revalidatePath('/posts')
}
```

**Use in form (progressive enhancement - works without JS):**
```tsx
import { createPost } from './actions'

export default function Page() {
  return (
    <form action={createPost}>
      <input name="title" required />
      <button type="submit">Create</button>
    </form>
  )
}
```

**Bind arguments:**
```tsx
const updateWithId = updatePost.bind(null, post.id)
<form action={updateWithId}>...</form>
```

**With validation/errors (useActionState):**
```tsx
'use client'
import { useActionState } from 'react'
import { createPost } from './actions'

export function Form() {
  const [state, action, pending] = useActionState(createPost, null)
  return (
    <form action={action}>
      <input name="title" />
      {state?.error && <p>{state.error}</p>}
      <button disabled={pending}>Create</button>
    </form>
  )
}

// actions.ts - return errors
export async function createPost(prev: any, formData: FormData) {
  const title = formData.get('title') as string
  if (title.length < 3) return { error: 'Too short' }
  await db.post.create({ data: { title } })
  redirect('/posts')
}
```

**Optimistic updates:**
```tsx
'use client'
import { useOptimistic } from 'react'

export function TodoList({ todos }) {
  const [optimistic, addOptimistic] = useOptimistic(
    todos,
    (state, newTodo) => [...state, { ...newTodo, pending: true }]
  )
  // ...
}
```

---

## Route Handlers (When Needed)

Use for webhooks, public APIs, streaming, external clients.

```typescript
// app/api/posts/route.ts
export async function GET() {
  const posts = await db.post.findMany()
  return Response.json(posts)
}

export async function POST(request: Request) {
  const body = await request.json()
  const post = await db.post.create({ data: body })
  return Response.json(post, { status: 201 })
}

// app/api/posts/[id]/route.ts
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  await db.post.delete({ where: { id } })
  return new Response(null, { status: 204 })
}
```

**Webhook example:**
```typescript
// app/api/webhook/stripe/route.ts
export async function POST(request: Request) {
  const body = await request.text()
  const sig = (await headers()).get('stripe-signature')!

  const event = stripe.webhooks.constructEvent(body, sig, secret)
  // Process event...
  return Response.json({ received: true })
}
```

---

## Revalidation After Mutation

```typescript
'use server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { updateTag } from 'next/cache'

export async function updateProduct(id: string, data: FormData) {
  await db.product.update({ where: { id }, data: { ... } })

  // Path-based (for specific pages)
  revalidatePath(`/products/${id}`)

  // Tag-based (for fetch cache)
  revalidateTag('products')

  // Tag-based (for 'use cache')
  updateTag('products')
}
```
