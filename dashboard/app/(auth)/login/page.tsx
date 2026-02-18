import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isAuthEnabled, SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/auth';
import { LoginForm } from './login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  if (!isAuthEnabled()) redirect('/');

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (token && (await verifySessionToken(token))) redirect('/');

  const params = await searchParams;
  // Sanitize redirect to prevent open redirect — only allow relative paths
  const raw = params.redirect ?? '/';
  const redirectUrl = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <LoginForm redirectUrl={redirectUrl} />
    </div>
  );
}
