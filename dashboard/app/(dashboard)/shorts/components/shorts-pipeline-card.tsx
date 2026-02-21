'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRight, CheckCircle2, Circle, Loader2 } from 'lucide-react';

interface PipelineStep {
  id: string;
  label: string;
  agentId: string;
  description: string;
  status: 'pending' | 'active' | 'complete';
}

const PIPELINE_STEPS: PipelineStep[] = [
  {
    id: 'research',
    label: '1. Trend Research',
    agentId: 'shorts-trend-researcher',
    description: '트렌드 분석 · 바이럴 기회 탐색',
    status: 'pending',
  },
  {
    id: 'hook',
    label: '2. Hook Optimization',
    agentId: 'shorts-hook-optimizer',
    description: '첫 3초 훅 최적화 · 스크롤 스탑',
    status: 'pending',
  },
  {
    id: 'script',
    label: '3. Script Writing',
    agentId: 'youtube-shorts-scripter',
    description: '완성 스크립트 · 60초 구조화',
    status: 'pending',
  },
  {
    id: 'edit',
    label: '4. Editorial Review',
    agentId: 'shorts-editor',
    description: '퀄리티 검수 · 페이싱 최적화',
    status: 'pending',
  },
  {
    id: 'seo',
    label: '5. SEO Optimization',
    agentId: 'shorts-seo-specialist',
    description: '타이틀 · 해시태그 · 메타데이터',
    status: 'pending',
  },
];

interface ShortsPipelineCardProps {
  activeStep?: string;
  completedSteps?: string[];
}

export function ShortsPipelineCard({
  activeStep,
  completedSteps = [],
}: ShortsPipelineCardProps) {
  return (
    <Card className="border-primary/20 bg-card/50 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <span className="text-primary text-glow-cyan">⚡</span>
          멀티 에이전트 파이프라인
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-1 overflow-x-auto pb-2">
          {PIPELINE_STEPS.map((step, index) => {
            const isComplete = completedSteps.includes(step.id);
            const isActive = activeStep === step.id;

            return (
              <div key={step.id} className="flex items-center gap-1 min-w-0">
                <div
                  className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg border transition-all duration-300 min-w-[120px] ${
                    isActive
                      ? 'border-primary/60 bg-primary/10 shadow-[0_0_12px_hsl(var(--primary)/0.3)]'
                      : isComplete
                        ? 'border-emerald-500/40 bg-emerald-500/10'
                        : 'border-border/40 bg-muted/20'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {isActive ? (
                      <Loader2 className="h-3 w-3 text-primary animate-spin" />
                    ) : isComplete ? (
                      <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                    ) : (
                      <Circle className="h-3 w-3 text-muted-foreground/40" />
                    )}
                    <span
                      className={`text-[10px] font-medium ${
                        isActive
                          ? 'text-primary'
                          : isComplete
                            ? 'text-emerald-500'
                            : 'text-muted-foreground'
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                  <span className="text-[9px] text-muted-foreground/60 text-center leading-tight">
                    {step.description}
                  </span>
                </div>

                {index < PIPELINE_STEPS.length - 1 && (
                  <ArrowRight className="h-3 w-3 text-muted-foreground/30 shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export { PIPELINE_STEPS };
