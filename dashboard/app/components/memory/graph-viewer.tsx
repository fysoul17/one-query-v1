'use client';

import type { GraphNode } from '@autonomy/shared';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { getGraphData } from '@/lib/api';

export function GraphViewer() {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getGraphData();
      setNodes(data.nodes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load graph');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  if (loading) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">Loading graph...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-12 text-center">
        <p className="text-neon-red">{error}</p>
      </div>
    );
  }

  if (nodes.length === 0) {
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
      <p className="text-sm text-muted-foreground">
        {nodes.length} node{nodes.length !== 1 ? 's' : ''} in knowledge graph
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {nodes.map((node) => (
          <Card key={node.id} className="glass transition-all hover:glow-purple">
            <CardContent className="space-y-2 py-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold">{node.name}</span>
                <Badge variant="outline" className="text-[10px]">
                  {node.type}
                </Badge>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {node.memoryEntryIds.length} linked entr
                {node.memoryEntryIds.length !== 1 ? 'ies' : 'y'}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
