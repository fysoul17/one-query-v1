import type { GraphVizData } from '@pyxmate/memory/dashboard';
import { GraphForceCanvas } from './graph-force-canvas';

interface GraphViewerProps {
  data: GraphVizData | null;
  isLoading: boolean;
  error: Error | null;
}

export function GraphViewer({ data, isLoading, error }: GraphViewerProps) {
  if (isLoading && !data) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">Loading graph...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="py-12 text-center">
        <p className="text-neon-red">{error.message}</p>
      </div>
    );
  }

  if (!data || data.nodeCount === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">
          No graph nodes yet. Ingest content with entity extraction to populate the knowledge graph.
        </p>
      </div>
    );
  }

  if (data.nodeCount > 0 && data.edgeCount === 0) {
    return (
      <div className="relative h-full w-full">
        <GraphForceCanvas data={data} />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/10">
          <div className="rounded-lg border border-neon-cyan/30 bg-black/40 px-6 py-4 text-center backdrop-blur">
            <p className="text-sm text-neon-cyan mb-2">
              Graph loaded with {data.nodeCount} entities
            </p>
            <p className="text-xs text-muted-foreground">
              No relationships found yet — relationships will appear as you ingest more content and
              link entities together.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <GraphForceCanvas data={data} />;
}
