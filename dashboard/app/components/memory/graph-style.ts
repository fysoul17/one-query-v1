/** Color mapping and visual constants for the force-directed graph */

export const NODE_TYPE_COLORS: Record<string, string> = {
  Person: '#00f0ff',
  Technology: '#a855f7',
  Concept: '#22c55e',
  Place: '#f59e0b',
  Event: '#ef4444',
  Organization: '#00f0ff',
  Tool: '#a855f7',
  Topic: '#22c55e',
  Location: '#f59e0b',
};

const DEFAULT_NODE_COLOR = 'rgba(148, 163, 184, 0.8)';

export function getNodeColor(type: string): string {
  return NODE_TYPE_COLORS[type] ?? DEFAULT_NODE_COLOR;
}

/** Node radius: 8px base, scaled by log(degree+1), clamped to [8, 34] */
export function getNodeRadius(degree: number): number {
  return Math.min(34, Math.max(8, 8 + Math.log2(degree + 1) * 6));
}

/** Edge width: 1.2px base, scaled by weight, clamped to [1.2, 4] */
export function getEdgeWidth(weight: number): number {
  return Math.min(4, Math.max(1.2, 1.2 + weight * 0.6));
}

// Force simulation tuning
export const SIMULATION = {
  chargeStrength: -160,
  linkDistance: 100,
  centerStrength: 0.06,
  collisionPadding: 6,
  alphaDecay: 0.018,
  velocityDecay: 0.35,
  // Type-clustering force strength (for sparse/no-edge graphs)
  typeClusterStrength: 0.04,
} as const;

// Rendering constants
export const RENDER = {
  // Labels
  labelFont: '500 11px "Geist Mono", ui-monospace, "Cascadia Code", "Fira Code", monospace',
  edgeLabelFont: '9px "Geist Mono", ui-monospace, "Cascadia Code", "Fira Code", monospace',
  labelOffsetY: 18,
  labelShowZoom: 0.6,
  labelMaxLength: 24,

  // Node opacity
  defaultNodeOpacity: 1.0,
  dimOpacityNear: 0.3,
  dimOpacityFar: 0.12,

  // Edge opacity
  defaultEdgeOpacity: 0.4,

  // Glow
  glowBlurDefault: 20,
  glowAlphaDefault: 0.3,
  glowBlurHover: 30,
  glowAlphaHover: 0.5,
  glowBlurSelected: 36,
  glowAlphaSelected: 0.65,

  // Pulse animation
  pulseSpeed: 0.0008,
  pulseAmplitude: 0.12,
  selectedPulseSpeed: 0.003,
  selectedPulseAmplitude: 0.2,

  // Camera
  zoomMin: 0.15,
  zoomMax: 6,
  zoomSensitivity: 0.002,

  // Ambient particles
  particleCount: 50,
  particleMinSize: 0.6,
  particleMaxSize: 2.0,
  particleMaxSpeed: 0.3,
  particleMinAlpha: 0.08,
  particleMaxAlpha: 0.2,

  // Bezier edge curvature (0 = straight, higher = more curved)
  edgeCurvature: 0.12,
} as const;

/** Unique deduplicated palette colors for particles */
export const PALETTE_COLORS = [...new Set(Object.values(NODE_TYPE_COLORS))];

/** Generate a layout position offset for type-based clustering.
 *  Uses a deterministic hash so the mapping is stable across remounts. */
export function getTypeClusterOffset(type: string, radius: number): { x: number; y: number } {
  let hash = 0;
  for (let i = 0; i < type.length; i++) {
    hash = ((hash << 5) - hash + type.charCodeAt(i)) | 0;
  }
  const angle = (Math.abs(hash) % 360) * (Math.PI / 180);
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}
