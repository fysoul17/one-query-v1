'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  Edit3,
  Hash,
  Loader2,
  Search,
  Tv2,
  Zap,
} from 'lucide-react';

interface QuickAction {
  id: string;
  label: string;
  emoji: string;
  icon: React.ComponentType<{ className?: string }>;
  agentId: string;
  promptTemplate: string;
  color: string;
  description: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'trend-research',
    label: '트렌드 리서치',
    emoji: '📊',
    icon: Search,
    agentId: 'shorts-trend-researcher',
    promptTemplate: '현재 YouTube Shorts에서 가장 핫한 트렌드를 분석해줘. 특히 {topic} 분야에서 바이럴 가능성이 높은 콘텐츠 기회를 찾아줘.',
    color: 'border-blue-500/40 hover:border-blue-500/80 hover:bg-blue-500/5',
    description: '지금 뭐가 뜨는지 분석',
  },
  {
    id: 'hook-optimize',
    label: '훅 최적화',
    emoji: '🎣',
    icon: Zap,
    agentId: 'shorts-hook-optimizer',
    promptTemplate: '이 주제로 YouTube Shorts 훅을 5가지 만들어줘: {topic}. 각각 다른 심리적 트리거를 써줘.',
    color: 'border-yellow-500/40 hover:border-yellow-500/80 hover:bg-yellow-500/5',
    description: '스크롤 멈추는 첫 3초',
  },
  {
    id: 'write-script',
    label: '스크립트 작성',
    emoji: '🎬',
    icon: Tv2,
    agentId: 'youtube-shorts-scripter',
    promptTemplate: '이 주제로 YouTube Shorts 스크립트를 작성해줘: {topic}',
    color: 'border-primary/40 hover:border-primary/80 hover:bg-primary/5',
    description: '60초 완성 스크립트',
  },
  {
    id: 'edit-script',
    label: '스크립트 편집',
    emoji: '✏️',
    icon: Edit3,
    agentId: 'shorts-editor',
    promptTemplate: '이 YouTube Shorts 스크립트를 리뷰하고 개선해줘:\n\n{topic}',
    color: 'border-purple-500/40 hover:border-purple-500/80 hover:bg-purple-500/5',
    description: '퀄리티 검수 & 개선',
  },
  {
    id: 'seo-optimize',
    label: 'SEO 최적화',
    emoji: '🔍',
    icon: Hash,
    agentId: 'shorts-seo-specialist',
    promptTemplate: '이 YouTube Shorts 콘텐츠의 SEO를 최적화해줘 — 타이틀, 해시태그, 설명문 포함: {topic}',
    color: 'border-emerald-500/40 hover:border-emerald-500/80 hover:bg-emerald-500/5',
    description: '검색 노출 극대화',
  },
];

interface ShortsQuickActionsProps {
  runtimeUrl: string;
}

export function ShortsQuickActions({ runtimeUrl }: ShortsQuickActionsProps) {
  const [topic, setTopic] = useState('');
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAction = async (action: QuickAction) => {
    if (!topic.trim()) {
      setError('주제(Topic)을 먼저 입력해주세요.');
      return;
    }

    setActiveAction(action.id);
    setResult(null);
    setError(null);

    const prompt = action.promptTemplate.replace(/{topic}/g, topic.trim());

    try {
      // Connect via WebSocket for streaming
      const wsUrl = runtimeUrl.replace(/^http/, 'ws') + '/ws/chat';
      const ws = new WebSocket(wsUrl);
      let buffer = '';

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'message',
            content: prompt,
            targetAgentId: action.agentId,
          }),
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === 'chunk') {
            buffer += msg.content ?? '';
            setResult(buffer);
          } else if (msg.type === 'complete') {
            ws.close();
            setActiveAction(null);
          } else if (msg.type === 'error') {
            setError(msg.error ?? '알 수 없는 오류가 발생했습니다.');
            setActiveAction(null);
            ws.close();
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onerror = () => {
        setError('런타임 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해주세요.');
        setActiveAction(null);
      };

      ws.onclose = () => {
        if (activeAction === action.id) {
          setActiveAction(null);
        }
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : '연결 실패');
      setActiveAction(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Topic Input */}
      <Card className="border-border/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">주제 / Topic</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            placeholder="예: AI로 돈 버는 방법, 30일 독서 챌린지 후기, 비건 다이어트 7일..."
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="min-h-[80px] resize-none text-sm bg-background/50 border-border/50 focus:border-primary/50 placeholder:text-muted-foreground/50"
          />
          {error && (
            <p className="text-xs text-red-400 flex items-center gap-1">
              <span>⚠️</span> {error}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Quick Action Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon;
          const isLoading = activeAction === action.id;

          return (
            <button
              key={action.id}
              type="button"
              onClick={() => handleAction(action)}
              disabled={!!activeAction}
              className={`flex flex-col items-start gap-2 p-3 rounded-lg border text-left transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${action.color}`}
            >
              <div className="flex items-center gap-2 w-full">
                {isLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                ) : (
                  <span className="text-base">{action.emoji}</span>
                )}
                <span className="text-xs font-medium">{action.label}</span>
              </div>
              <span className="text-[10px] text-muted-foreground">{action.description}</span>
            </button>
          );
        })}
      </div>

      {/* Result Display */}
      {result && (
        <Card className="border-primary/20 bg-card/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-medium text-primary">결과 Output</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] text-muted-foreground hover:text-foreground"
                onClick={() => {
                  navigator.clipboard.writeText(result);
                }}
              >
                복사
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="text-xs whitespace-pre-wrap font-mono text-foreground/90 bg-background/50 rounded-md p-3 border border-border/30 max-h-[500px] overflow-y-auto">
              {result}
            </pre>
          </CardContent>
        </Card>
      )}

      {activeAction && !result && (
        <Card className="border-primary/20">
          <CardContent className="py-8 flex flex-col items-center gap-3">
            <Loader2 className="h-6 w-6 text-primary animate-spin" />
            <p className="text-xs text-muted-foreground">
              {QUICK_ACTIONS.find((a) => a.id === activeAction)?.emoji}{' '}
              {QUICK_ACTIONS.find((a) => a.id === activeAction)?.label} 에이전트가 작업 중...
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
