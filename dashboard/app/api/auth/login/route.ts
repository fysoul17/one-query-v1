import { NextResponse } from 'next/server';
import {
  createSessionToken,
  isAuthEnabled,
  SESSION_COOKIE_NAME,
  validateCredentials,
} from '@/lib/auth';

export async function POST(request: Request) {
  if (!isAuthEnabled()) {
    return NextResponse.json({ error: 'Auth not enabled' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!(await validateCredentials(body.username, body.password))) {
    // Small delay to mitigate brute-force
    await new Promise((r) => setTimeout(r, 500));
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const token = await createSessionToken();
  const isProduction = process.env.NODE_ENV === 'production';

  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: Number(process.env.DASHBOARD_SESSION_TTL ?? 86400),
  });

  return response;
}
