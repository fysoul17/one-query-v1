import type { BackendStatus, HealthCheckResponse, MemoryStats } from '@autonomy/shared';
import { Bot, Brain, MessageSquare, Plug, Rocket } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface GettingStartedProps {
  health: HealthCheckResponse;
  memoryStats: MemoryStats | null;
  backends: BackendStatus[];
}

interface Step {
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode;
  done: boolean;
  label: string;
}

export function GettingStarted({ health, memoryStats, backends }: GettingStartedProps) {
  const hasAuthenticatedBackend = backends.some((b) => b.authenticated);
  const hasAgents = health.agentCount > 0;
  const hasMemory = (memoryStats?.totalEntries ?? 0) > 0;

  const steps: Step[] = [
    {
      title: 'Configure a Backend',
      description:
        'Connect an AI provider (Claude, Codex, Gemini, Pi, or Ollama) to power your agents.',
      href: '/settings/providers',
      icon: <Plug className="h-4 w-4" />,
      done: hasAuthenticatedBackend,
      label: hasAuthenticatedBackend ? 'Connected' : 'Set up',
    },
    {
      title: 'Review Agents',
      description:
        'Seed agents (Researcher, Writer, Analyst) load on startup. Create custom agents for your use case.',
      href: '/agents',
      icon: <Bot className="h-4 w-4" />,
      done: hasAgents,
      label: hasAgents ? `${health.agentCount} ready` : 'View agents',
    },
    {
      title: 'Add Knowledge',
      description:
        'Ingest domain data so agents have context via the memory API or agent interactions.',
      href: '/memory',
      icon: <Brain className="h-4 w-4" />,
      done: hasMemory,
      label: hasMemory ? `${memoryStats?.totalEntries} entries` : 'Add data',
    },
    {
      title: 'Start Chatting',
      description: 'Send a message to the Conductor or target a specific agent.',
      href: '/chat?new',
      icon: <MessageSquare className="h-4 w-4" />,
      done: false,
      label: 'Open chat',
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  const allDone = completedCount >= 3; // first 3 steps done = ready

  if (allDone) return null;

  return (
    <Card className="glass border-neon-purple/20">
      <CardHeader className="flex flex-row items-center gap-2 pb-3">
        <Rocket className="h-4 w-4 text-neon-purple" />
        <CardTitle className="text-sm font-medium">Getting Started</CardTitle>
        <span className="ml-auto text-[10px] font-mono text-muted-foreground">
          {completedCount}/3
        </span>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          {steps.map((step) => (
            <Link
              key={step.title}
              href={step.href}
              className={`group flex items-start gap-3 rounded-lg border p-3 transition-all ${
                step.done
                  ? 'border-neon-cyan/20 bg-neon-cyan/5'
                  : 'border-border hover:border-neon-purple/30 hover:bg-neon-purple/5'
              }`}
            >
              <div
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                  step.done
                    ? 'bg-neon-cyan/10 text-neon-cyan'
                    : 'bg-muted text-muted-foreground group-hover:text-neon-purple'
                }`}
              >
                {step.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{step.title}</span>
                  <span
                    className={`ml-auto text-[10px] font-mono ${
                      step.done ? 'text-neon-cyan' : 'text-muted-foreground/60'
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
