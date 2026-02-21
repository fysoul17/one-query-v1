'use client';

import type { AgentRuntimeInfo } from '@autonomy/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Edit3, Hash, Search, Tv2, Zap } from 'lucide-react';

const SHORTS_AGENTS = [
  {
    id: 'shorts-trend-researcher',
    name: 'Trend Researcher',
    icon: Search,
    color: 'text-blue-400',
    glowColor: 'shadow-[0_0_12px_hsl(217,91%,60%,0.25)]',
    borderColor: 'border-blue-500/30',
    bgColor: 'bg-blue-500/5',
    role: '트렌드 분석 · 바이럴 기회 탐색',
    emoji: '📊',
  },
  {
    id: 'shorts-hook-optimizer',
    name: 'Hook Optimizer',
    icon: Zap,
    color: 'text-yellow-400',
    glowColor: 'shadow-[0_0_12px_hsl(45,93%,47%,0.25)]',
    borderColor: 'border-yellow-500/30',
    bgColor: 'bg-yellow-500/5',
    role: '첫 3초 훅 · 스크롤 스탑 최적화',
    emoji: '🎣',
  },
  {
    id: 'youtube-shorts-scripter',
    name: 'Script Writer',
    icon: Tv2,
    color: 'text-primary',
    glowColor: 'shadow-[0_0_12px_hsl(var(--primary)/0.25)]',
    borderColor: 'border-primary/30',
    bgColor: 'bg-primary/5',
    role: '완성 스크립트 · 60초 구조화',
    emoji: '🎬',
  },
  {
    id: 'shorts-editor',
    name: 'Editor',
    icon: Edit3,
    color: 'text-purple-400',
    glowColor: 'shadow-[0_0_12px_hsl(271,91%,65%,0.25)]',
    borderColor: 'border-purple-500/30',
    bgColor: 'bg-purple-500/5',
    role: '퀄리티 검수 · 페이싱 · 감정 임팩트',
    emoji: '✏️',
  },
  {
    id: 'shorts-seo-specialist',
    name: 'SEO Specialist',
    icon: Hash,
    color: 'text-emerald-400',
    glowColor: 'shadow-[0_0_12px_hsl(152,76%,40%,0.25)]',
    borderColor: 'border-emerald-500/30',
    bgColor: 'bg-emerald-500/5',
    role: '타이틀 · 해시태그 · 메타데이터 최적화',
    emoji: '🔍',
  },
];

interface ShortsAgentCardsProps {
  agents: AgentRuntimeInfo[];
}

export function ShortsAgentCards({ agents }: ShortsAgentCardsProps) {
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
      {SHORTS_AGENTS.map((config) => {
        const agent = agentMap.get(config.id);
        const status = agent?.status ?? 'offline';
        const Icon = config.icon;

        return (
          <Card
            key={config.id}
            className={`${config.borderColor} ${config.bgColor} ${status === 'active' || status === 'busy' ? config.glowColor : ''} transition-all duration-300`}
          >
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-center justify-between">
                <div className={`p-1.5 rounded-md ${config.bgColor} border ${config.borderColor}`}>
                  <Icon className={`h-3.5 w-3.5 ${config.color}`} />
                </div>
                <StatusDot status={status} />
              </div>
              <CardTitle className="text-xs font-medium mt-2">
                <span className="mr-1">{config.emoji}</span>
                {config.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-[10px] text-muted-foreground leading-relaxed">{config.role}</p>
              {agent && (
                <div className="mt-2">
                  <Badge
                    variant="outline"
                    className={`text-[9px] px-1.5 py-0 h-4 ${
                      status === 'active' || status === 'busy'
                        ? `${config.color} ${config.borderColor}`
                        : 'text-muted-foreground border-border/40'
                    }`}
                  >
                    {status}
                  </Badge>
                </div>
              )}
              {!agent && (
                <div className="mt-2">
                  <Badge
                    variant="outline"
                    className="text-[9px] px-1.5 py-0 h-4 text-muted-foreground/50 border-border/20"
                  >
                    not loaded
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    idle: 'bg-emerald-500',
    active: 'bg-blue-400 animate-pulse',
    busy: 'bg-yellow-400 animate-pulse',
    error: 'bg-red-500',
    offline: 'bg-muted-foreground/30',
  };

  return (
    <div
      className={`h-2 w-2 rounded-full ${colorMap[status] ?? 'bg-muted-foreground/30'}`}
      title={status}
    />
  );
}
