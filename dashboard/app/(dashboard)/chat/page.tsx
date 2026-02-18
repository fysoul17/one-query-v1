import { ChatInterface } from '@/components/chat/chat-interface';
import { Header } from '@/components/layout/header';
import { getAgents, getSessionDetail } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ sessionId?: string }>;
}) {
  const { sessionId } = await searchParams;

  let agents: Awaited<ReturnType<typeof getAgents>> = [];
  try {
    agents = await getAgents();
  } catch {
    agents = [];
  }

  let initialSessionId: string | undefined;
  let initialMessages:
    | { role: string; content: string; agentId?: string; createdAt: string }[]
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
      }));
    } catch {
      // session not found, proceed without
    }
  }

  return (
    <>
      <Header title="Chat" />
      <ChatInterface
        initialAgents={agents}
        initialSessionId={initialSessionId}
        initialMessages={initialMessages}
      />
    </>
  );
}
