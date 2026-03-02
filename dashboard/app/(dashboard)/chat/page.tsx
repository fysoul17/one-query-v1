import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ChatInterface } from '@/components/chat/chat-interface';
import { Header } from '@/components/layout/header';
import { getAgents, getBackendOptions, getSessionDetail, getSessions } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

/** Cookie name used to remember the last-viewed chat session. */
const LAST_SESSION_COOKIE = 'lastChatSession';

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ sessionId?: string; new?: string }>;
}) {
  const params = await searchParams;
  const sessionId = params.sessionId;
  const isNewChat = params.new !== undefined;

  // If no sessionId and not explicitly starting a new chat, restore the
  // last-viewed session (cookie) or fall back to the most recent session.
  // NOTE: redirect() must be called OUTSIDE try/catch — it works by throwing
  // a special NEXT_REDIRECT error that catch blocks would swallow.
  if (!sessionId && !isNewChat) {
    const cookieStore = await cookies();
    const lastViewedId = cookieStore.get(LAST_SESSION_COOKIE)?.value;

    // Try last-viewed session first (the one the user was on before navigating away)
    if (lastViewedId) {
      const exists = await getSessionDetail(lastViewedId)
        .then(() => true)
        .catch(() => false);
      if (exists) {
        redirect(`/chat?sessionId=${lastViewedId}`);
      }
    }

    // Fall back to the most recent session
    const latestSessionId = await getSessions()
      .then(({ sessions }) => (sessions.length > 0 ? sessions[0]?.id : undefined))
      .catch(() => undefined);
    if (latestSessionId) {
      redirect(`/chat?sessionId=${latestSessionId}`);
    }
  }

  let agents: Awaited<ReturnType<typeof getAgents>> = [];
  try {
    agents = await getAgents();
  } catch {
    agents = [];
  }

  let backendOptions: Awaited<ReturnType<typeof getBackendOptions>>['options'] = [];
  try {
    const result = await getBackendOptions();
    backendOptions = result.options;
  } catch {
    backendOptions = [];
  }

  let initialSessionId: string | undefined;
  let initialMessages:
    | {
        role: string;
        content: string;
        agentId?: string;
        createdAt: string;
        metadata?: Record<string, unknown>;
      }[]
    | undefined;

  if (sessionId) {
    try {
      const detail = await getSessionDetail(sessionId);
      initialSessionId = detail.id;
      initialMessages = detail.messages.map((m) => ({
        role: m.role,
        content: m.content,
        agentId: m.agentId,
        createdAt: m.createdAt,
        metadata: m.metadata,
      }));
    } catch {
      // session not found, proceed without
    }
  }

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      <Header title="Chat" />
      <ChatInterface
        key={initialSessionId ?? 'new'}
        initialAgents={agents}
        initialSessionId={initialSessionId}
        initialMessages={initialMessages}
        backendOptions={backendOptions}
      />
    </div>
  );
}
