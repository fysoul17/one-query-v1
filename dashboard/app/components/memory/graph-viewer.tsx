import type { GraphVizData } from '@pyx-memory/dashboard';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span>
          {data.nodeCount} node{data.nodeCount !== 1 ? 's' : ''}
        </span>
        <span>
          {data.edgeCount} edge{data.edgeCount !== 1 ? 's' : ''}
        </span>
      </div>

      {Object.keys(data.nodeTypes).length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Node types:</span>
          {Object.entries(data.nodeTypes).map(([type, count]) => (
            <Badge key={type} variant="outline" className="text-[10px]">
              {type} ({count})
            </Badge>
          ))}
        </div>
      )}

      {Object.keys(data.edgeTypes).length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Edge types:</span>
          {Object.entries(data.edgeTypes).map(([type, count]) => (
            <Badge key={type} variant="secondary" className="text-[10px]">
              {type} ({count})
            </Badge>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.nodes.map((node) => (
          <Card key={node.id} className="glass transition-all hover:glow-purple">
            <CardContent className="space-y-2 py-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold">{node.label}</span>
                <Badge variant="outline" className="text-[10px]">
                  {node.type}
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span>
                  {node.memoryCount} linked {node.memoryCount !== 1 ? 'entries' : 'entry'}
                </span>
                <span>degree {node.degree}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
