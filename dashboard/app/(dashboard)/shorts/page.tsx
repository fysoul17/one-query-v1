import { Header } from '@/components/layout/header';
import { getAgents, getCrons, getHealth } from '@/lib/api-server';
import { ShortsAgentCards } from './components/shorts-agent-cards';
import { ShortsCronStatus } from './components/shorts-cron-status';
import { ShortsPipelineCard } from './components/shorts-pipeline-card';
import { ShortsQuickActions } from './components/shorts-quick-actions';

export const dynamic = 'force-dynamic';

const RUNTIME_URL = process.env.RUNTIME_URL ?? 'http://localhost:7820';

export default async function ShortsPage() {
  // Fetch all data server-side in parallel
  const [agents, crons, health] = await Promise.allSettled([
    getAgents(),
    getCrons(),
    getHealth(),
  ]);

  const allAgents = agents.status === 'fulfilled' ? agents.value : [];
  const allCrons = crons.status === 'fulfilled' ? crons.value : [];

  // Filter to only Shorts-related agents and crons
  const shortsAgentIds = new Set([
    'youtube-shorts-scripter',
    'shorts-trend-researcher',
    'shorts-hook-optimizer',
    'shorts-editor',
    'shorts-seo-specialist',
  ]);
  const shortsAgents = allAgents.filter((a) => shortsAgentIds.has(a.id));
  const shortsCrons = allCrons.filter(
    (c) => c.name.includes('Shorts') || c.name.includes('shorts'),
  );

  const isRuntimeOnline = health.status === 'fulfilled';

  return (
    <>
      <Header title="YouTube Shorts Studio" />
      <div className="p-6 space-y-6">
        {/* Header Section */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span>🎬</span>
              <span className="text-primary text-glow-cyan">Shorts</span>
              <span className="text-foreground">Studio</span>
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              풀 파이프라인 · 멀티 에이전트 팀 · 크론 자동화
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div
              className={`h-2 w-2 rounded-full ${isRuntimeOnline ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}
            />
            <span className="text-xs text-muted-foreground">
              {isRuntimeOnline ? 'Runtime Online' : 'Runtime Offline'}
            </span>
          </div>
        </div>

        {/* Pipeline Visualization */}
        <ShortsPipelineCard />

        {/* Agent Team Status */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            👥 에이전트 팀
          </h3>
          <ShortsAgentCards agents={shortsAgents} />
        </div>

        {/* Cron Automation Status */}
        {shortsCrons.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              ⏰ 자동화 스케줄
            </h3>
            <ShortsCronStatus crons={shortsCrons} />
          </div>
        )}

        {/* Quick Actions — Client Component (deepest possible) */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            🚀 빠른 실행
          </h3>
          <ShortsQuickActions runtimeUrl={RUNTIME_URL} />
        </div>

        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <InfoCard
            icon="📊"
            title="트렌드 리서치"
            description="매일 오전 8시 KST에 자동으로 최신 트렌드를 분석하고 바이럴 기회를 탐색합니다."
            detail="Daily at 8 AM KST"
          />
          <InfoCard
            icon="📅"
            title="주간 콘텐츠 플랜"
            description="매주 월요일 오전 9시에 7일치 콘텐츠 캘린더와 우선순위 스크립트를 자동 생성합니다."
            detail="Every Monday 9 AM KST"
          />
          <InfoCard
            icon="🤖"
            title="5인 에이전트 팀"
            description="리서처 → 훅 최적화 → 스크립터 → 편집자 → SEO 전문가가 협업해 최고 품질의 Shorts를 제작합니다."
            detail="Full pipeline automation"
          />
        </div>
      </div>
    </>
  );
}

function InfoCard({
  icon,
  title,
  description,
  detail,
}: {
  icon: string;
  title: string;
  description: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-card/30 p-4 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <h4 className="text-sm font-medium">{title}</h4>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
      <p className="text-[10px] text-primary/60 font-mono">{detail}</p>
    </div>
  );
}
