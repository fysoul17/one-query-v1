'use client';

import type { GraphVizData } from '@pyxmate/memory/dashboard';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getEdgeWidth,
  getNodeColor,
  getNodeRadius,
  getTypeClusterOffset,
  PALETTE_COLORS,
  RENDER,
  SIMULATION,
} from './graph-style';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface SimNode extends SimulationNodeDatum {
  id: string;
  label: string;
  type: string;
  memoryCount: number;
  degree: number;
  radius: number;
  color: string;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  label: string;
  weight: number;
  color: string;
  width: number;
  /** Cached bezier control point — set during edge draw pass, reused by edge label pass */
  _cpx?: number;
  _cpy?: number;
}

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  color: string;
  life: number;
  maxLife: number;
}

interface GraphForceCanvasProps {
  data: GraphVizData;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function createParticle(w: number, h: number): Particle {
  return {
    x: rand(-w / 2, w / 2),
    y: rand(-h / 2, h / 2),
    vx: rand(-RENDER.particleMaxSpeed, RENDER.particleMaxSpeed),
    vy: rand(-RENDER.particleMaxSpeed, RENDER.particleMaxSpeed),
    size: rand(RENDER.particleMinSize, RENDER.particleMaxSize),
    alpha: rand(RENDER.particleMinAlpha, RENDER.particleMaxAlpha),
    color: PALETTE_COLORS[Math.floor(Math.random() * PALETTE_COLORS.length)] ?? '#00f0ff',
    life: 0,
    maxLife: rand(300, 800),
  };
}

function buildSimData(data: GraphVizData) {
  const nodeMap = new Map<string, SimNode>();
  const nodes: SimNode[] = data.nodes.map((n) => {
    const node: SimNode = {
      id: n.id,
      label: n.label,
      type: n.type,
      memoryCount: n.memoryCount,
      degree: n.degree,
      radius: getNodeRadius(n.degree),
      color: getNodeColor(n.type),
    };
    nodeMap.set(n.id, node);
    return node;
  });

  const links: SimLink[] = data.edges
    .filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target))
    .map((e) => ({
      source: e.source,
      target: e.target,
      label: e.label,
      weight: e.weight,
      color: nodeMap.get(e.source)?.color ?? 'rgba(255,255,255,0.35)',
      width: getEdgeWidth(e.weight),
    }));

  return { nodes, links, nodeMap };
}

function screenToCanvas(sx: number, sy: number, rect: DOMRect, cam: Camera): [number, number] {
  const cx = (sx - rect.left - rect.width / 2) / cam.zoom - cam.x;
  const cy = (sy - rect.top - rect.height / 2) / cam.zoom - cam.y;
  return [cx, cy];
}

function findNodeAt(cx: number, cy: number, nodes: SimNode[]): SimNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (!n || n.x == null || n.y == null) continue;
    const dx = cx - n.x;
    const dy = cy - n.y;
    const hitRadius = n.radius + 6;
    if (dx * dx + dy * dy <= hitRadius * hitRadius) return n;
  }
  return null;
}

function bezierCP(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  curvature: number,
): [number, number] {
  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return [mx - (dy / len) * len * curvature, my + (dx / len) * len * curvature];
}

/* ------------------------------------------------------------------ */
/*  Render functions                                                  */
/* ------------------------------------------------------------------ */

function drawEdge(
  ctx: CanvasRenderingContext2D,
  link: SimLink,
  isHighlighted: boolean,
  isDimmed: boolean,
) {
  const src = link.source as SimNode;
  const tgt = link.target as SimNode;
  if (src.x == null || src.y == null || tgt.x == null || tgt.y == null) return;

  const opacity = isDimmed
    ? RENDER.dimOpacityFar
    : isHighlighted
      ? 0.75
      : RENDER.defaultEdgeOpacity;

  const [cpx, cpy] = bezierCP(src.x, src.y, tgt.x, tgt.y, RENDER.edgeCurvature);
  link._cpx = cpx;
  link._cpy = cpy;

  // Ambient glow pass (non-dimmed edges)
  if (!isDimmed) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    ctx.quadraticCurveTo(cpx, cpy, tgt.x, tgt.y);
    ctx.strokeStyle = link.color;
    ctx.shadowColor = link.color;
    ctx.shadowBlur = isHighlighted ? 12 : 6;
    ctx.globalAlpha = isHighlighted ? 0.35 : 0.12;
    ctx.lineWidth = link.width + 2;
    ctx.stroke();
    ctx.restore();
  }

  // Main edge line
  ctx.beginPath();
  ctx.moveTo(src.x, src.y);
  ctx.quadraticCurveTo(cpx, cpy, tgt.x, tgt.y);
  ctx.strokeStyle = link.color;
  ctx.globalAlpha = opacity;
  ctx.lineWidth = isHighlighted ? link.width + 0.8 : link.width;
  ctx.stroke();

  ctx.globalAlpha = 1;
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  node: SimNode,
  isHovered: boolean,
  isSelected: boolean,
  isDimmed: boolean,
  showLabel: boolean,
  time: number,
) {
  if (node.x == null || node.y == null) return;
  const { x, y, radius, color, label } = node;

  // Pulse calculation
  let pulseScale = 1;
  let pulseAlpha = 0;
  if (!isDimmed) {
    if (isSelected) {
      pulseScale = 1 + Math.sin(time * RENDER.selectedPulseSpeed) * 0.04;
      pulseAlpha = Math.sin(time * RENDER.selectedPulseSpeed) * RENDER.selectedPulseAmplitude;
    } else {
      pulseAlpha = Math.sin(time * RENDER.pulseSpeed + x * 0.01) * RENDER.pulseAmplitude;
    }
  }

  const r = radius * pulseScale;

  // Ambient outer glow (always, unless dimmed)
  if (!isDimmed) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r + 2, 0, Math.PI * 2);
    ctx.shadowColor = color;
    ctx.shadowBlur = isSelected
      ? RENDER.glowBlurSelected
      : isHovered
        ? RENDER.glowBlurHover
        : RENDER.glowBlurDefault;
    ctx.fillStyle = color;
    ctx.globalAlpha =
      (isSelected
        ? RENDER.glowAlphaSelected
        : isHovered
          ? RENDER.glowAlphaHover
          : RENDER.glowAlphaDefault) + pulseAlpha;
    ctx.fill();
    ctx.restore();
  }

  // Secondary bloom pass for hovered/selected
  if ((isHovered || isSelected) && !isDimmed) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r + 6, 0, Math.PI * 2);
    ctx.shadowColor = color;
    ctx.shadowBlur = isSelected ? 50 : 40;
    ctx.fillStyle = color;
    ctx.globalAlpha = isSelected ? 0.18 : 0.1;
    ctx.fill();
    ctx.restore();
  }

  // Node fill - radial gradient for depth
  if (!isDimmed) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, `${color}ee`);
    gradient.addColorStop(0.6, `${color}bb`);
    gradient.addColorStop(1, `${color}44`);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.globalAlpha = RENDER.defaultNodeOpacity;
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = RENDER.dimOpacityNear;
    ctx.fill();
  }

  // Node border ring
  ctx.strokeStyle = color;
  ctx.globalAlpha = isDimmed ? RENDER.dimOpacityFar : isHovered || isSelected ? 0.8 : 0.5;
  ctx.lineWidth = isHovered || isSelected ? 2.5 : 1.5;
  ctx.stroke();

  // Label
  if (showLabel && !isDimmed) {
    const maxLen = RENDER.labelMaxLength;
    const text = label.length > maxLen ? `${label.slice(0, maxLen - 2)}...` : label;

    ctx.font = RENDER.labelFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const tw = ctx.measureText(text).width;

    const px = 6;
    const py = 3;
    const bgX = x - tw / 2 - px;
    const bgY = y + r + RENDER.labelOffsetY - py;
    const bgW = tw + px * 2;
    const bgH = 14 + py * 2;
    const cornerR = 8;

    // Label pill background
    ctx.beginPath();
    ctx.roundRect(bgX, bgY, bgW, bgH, cornerR);
    ctx.fillStyle = 'rgba(10, 10, 15, 0.85)';
    ctx.globalAlpha = 0.9;
    ctx.fill();

    // Label pill border (tinted with node color)
    ctx.strokeStyle = color;
    ctx.globalAlpha = isHovered || isSelected ? 0.5 : 0.2;
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Label text
    ctx.fillStyle = isHovered || isSelected ? color : '#e4e4e7';
    ctx.globalAlpha = 0.95;
    ctx.fillText(text, x, bgY + py + 1);
  }

  ctx.globalAlpha = 1;
}

function drawEdgeLabel(ctx: CanvasRenderingContext2D, link: SimLink) {
  const src = link.source as SimNode;
  const tgt = link.target as SimNode;
  if (src.x == null || src.y == null || tgt.x == null || tgt.y == null) return;

  // Reuse cached control point from drawEdge pass (avoids recomputation)
  const cpx = link._cpx ?? (src.x + tgt.x) / 2;
  const cpy = link._cpy ?? (src.y + tgt.y) / 2;
  const mx = 0.25 * src.x + 0.5 * cpx + 0.25 * tgt.x;
  const my = 0.25 * src.y + 0.5 * cpy + 0.25 * tgt.y;

  ctx.font = RENDER.edgeLabelFont;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.globalAlpha = 0.75;
  ctx.fillText(link.label, mx, my - 8);
  ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function GraphForceCanvas({ data }: GraphForceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const rafRef = useRef<number>(0);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const rectRef = useRef<DOMRect | null>(null);
  const timeRef = useRef(0);
  const particlesRef = useRef<Particle[]>([]);
  const alwaysAnimateRef = useRef(true);
  const frameSkipRef = useRef(0);
  const neighborIdxRef = useRef(0);
  const initialZoomRef = useRef(1);

  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);

  hoveredRef.current = hoveredNode;
  selectedRef.current = selectedNode;

  // Drag state
  const dragRef = useRef<{
    node: SimNode | null;
    isPanning: boolean;
    startX: number;
    startY: number;
    camStartX: number;
    camStartY: number;
  }>({ node: null, isPanning: false, startX: 0, startY: 0, camStartX: 0, camStartY: 0 });

  /* ---------- Connected-node lookup ---------- */
  const connectedRef = useRef<Map<string, Set<string>>>(new Map());
  const nodeMapRef = useRef<Map<string, SimNode>>(new Map());

  const buildConnectivity = useCallback((links: SimLink[], nodeMap: Map<string, SimNode>) => {
    const connected = new Map<string, Set<string>>();
    for (const link of links) {
      const sId = typeof link.source === 'string' ? link.source : (link.source as SimNode).id;
      const tId = typeof link.target === 'string' ? link.target : (link.target as SimNode).id;
      if (!connected.has(sId)) connected.set(sId, new Set());
      if (!connected.has(tId)) connected.set(tId, new Set());
      connected.get(sId)?.add(tId);
      connected.get(tId)?.add(sId);
    }
    connectedRef.current = connected;
    nodeMapRef.current = nodeMap;
  }, []);

  /* ---------- Draw ---------- */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const { w, h } = sizeRef.current;
    if (w === 0 || h === 0) return;

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }

    const cam = cameraRef.current;
    const nodes = nodesRef.current;
    const links = linksRef.current;
    const hovered = hoveredRef.current;
    const selected = selectedRef.current;
    const activeId = hovered ?? selected;
    const activeNeighbors = activeId ? connectedRef.current.get(activeId) : null;
    const time = timeRef.current;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // --- Ambient particles (screen space, before camera transform) ---
    const particles = particlesRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, (dpr * w) / 2, (dpr * h) / 2);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.life++;

      const hw = w / 2 + 50;
      const hh = h / 2 + 50;
      if (p.x < -hw) p.x = hw;
      if (p.x > hw) p.x = -hw;
      if (p.y < -hh) p.y = hh;
      if (p.y > hh) p.y = -hh;

      const lifeFrac = p.life / p.maxLife;
      const fadeAlpha = lifeFrac < 0.1 ? lifeFrac * 10 : lifeFrac > 0.9 ? (1 - lifeFrac) * 10 : 1;
      const flickerAlpha = p.alpha * fadeAlpha * (0.7 + 0.3 * Math.sin(time * 0.002 + p.x));

      if (p.life >= p.maxLife) {
        p.x = rand(-w / 2, w / 2);
        p.y = rand(-h / 2, h / 2);
        p.vx = rand(-RENDER.particleMaxSpeed, RENDER.particleMaxSpeed);
        p.vy = rand(-RENDER.particleMaxSpeed, RENDER.particleMaxSpeed);
        p.size = rand(RENDER.particleMinSize, RENDER.particleMaxSize);
        p.alpha = rand(RENDER.particleMinAlpha, RENDER.particleMaxAlpha);
        p.color = PALETTE_COLORS[Math.floor(Math.random() * PALETTE_COLORS.length)] ?? '#00f0ff';
        p.life = 0;
        p.maxLife = rand(300, 800);
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = flickerAlpha;
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // --- Camera transform ---
    ctx.setTransform(
      dpr * cam.zoom,
      0,
      0,
      dpr * cam.zoom,
      dpr * (w / 2 + cam.x * cam.zoom),
      dpr * (h / 2 + cam.y * cam.zoom),
    );

    // --- Draw edges ---
    for (const link of links) {
      const src = link.source as SimNode;
      const tgt = link.target as SimNode;
      const isHighlighted = activeId != null && (src.id === activeId || tgt.id === activeId);
      const isDimmed = activeId != null && !isHighlighted;
      drawEdge(ctx, link, isHighlighted, isDimmed);
    }

    // --- Draw edge labels for highlighted edges ---
    if (activeId) {
      for (const link of links) {
        const src = link.source as SimNode;
        const tgt = link.target as SimNode;
        if (src.id === activeId || tgt.id === activeId) {
          drawEdgeLabel(ctx, link);
        }
      }
    }

    // --- Draw nodes ---
    for (const node of nodes) {
      const isHovered = node.id === hovered;
      const isSelected = node.id === selected;
      const isDimmed = activeId != null && node.id !== activeId && !activeNeighbors?.has(node.id);
      const showLabel =
        isHovered ||
        isSelected ||
        (activeId != null && activeNeighbors?.has(node.id)) ||
        cam.zoom > RENDER.labelShowZoom;

      drawNode(ctx, node, isHovered, isSelected, isDimmed, showLabel ?? false, time);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, []);

  /* ---------- Continuous animation loop ---------- */
  const startLoop = useCallback(() => {
    if (rafRef.current) return;
    const loop = () => {
      timeRef.current = performance.now();

      const alpha = simRef.current?.alpha() ?? 0;
      const isSettled = alpha < 0.001;

      // Throttle to ~8fps when simulation is settled (particles don't need 60fps)
      if (isSettled && alwaysAnimateRef.current) {
        frameSkipRef.current++;
        if (frameSkipRef.current % 8 !== 0) {
          rafRef.current = requestAnimationFrame(loop);
          return;
        }
      } else {
        frameSkipRef.current = 0;
      }

      draw();

      if (alwaysAnimateRef.current || !isSettled) {
        rafRef.current = requestAnimationFrame(loop);
      } else {
        rafRef.current = 0;
      }
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [draw]);

  const requestDraw = useCallback(() => {
    startLoop();
  }, [startLoop]);

  /* ---------- Simulation setup ---------- */
  useEffect(() => {
    const { nodes, links, nodeMap } = buildSimData(data);
    nodesRef.current = nodes;
    linksRef.current = links;
    buildConnectivity(links, nodeMap);

    const nodeCount = nodes.length;
    const zoom = nodeCount > 80 ? 0.5 : nodeCount > 40 ? 0.7 : 1;
    cameraRef.current.zoom = zoom;
    initialZoomRef.current = zoom;

    // Initialize ambient particles
    const { w, h } = sizeRef.current;
    const pw = w || 800;
    const ph = h || 600;
    particlesRef.current = Array.from({ length: RENDER.particleCount }, () => {
      const p = createParticle(pw, ph);
      p.life = Math.floor(rand(0, p.maxLife));
      return p;
    });

    const isSparse = links.length < 3;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    alwaysAnimateRef.current = !prefersReducedMotion;

    const sim = forceSimulation<SimNode>(nodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(SIMULATION.linkDistance)
          .strength((l) => 0.3 + l.weight * 0.15),
      )
      .force('charge', forceManyBody<SimNode>().strength(SIMULATION.chargeStrength))
      .force('center', forceCenter(0, 0).strength(SIMULATION.centerStrength))
      .force(
        'collision',
        forceCollide<SimNode>()
          .radius((d) => d.radius + SIMULATION.collisionPadding)
          .strength(0.7),
      )
      .alphaDecay(SIMULATION.alphaDecay)
      .velocityDecay(SIMULATION.velocityDecay)
      .on('tick', () => {}); // Rendering driven by RAF loop, not d3 tick

    // Type-based clustering when graph is sparse/no edges
    if (isSparse) {
      const clusterRadius = Math.max(80, nodeCount * 12);
      sim
        .force(
          'typeX',
          forceX<SimNode>()
            .x((d) => getTypeClusterOffset(d.type, clusterRadius).x)
            .strength(SIMULATION.typeClusterStrength),
        )
        .force(
          'typeY',
          forceY<SimNode>()
            .y((d) => getTypeClusterOffset(d.type, clusterRadius).y)
            .strength(SIMULATION.typeClusterStrength),
        );
    }

    simRef.current = sim;

    if (prefersReducedMotion) {
      sim.stop();
      for (let i = 0; i < 300; i++) sim.tick();
    }
    startLoop();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      sim.stop();
      nodesRef.current.forEach((n) => {
        n.fx = null;
        n.fy = null;
      });
    };
  }, [data, buildConnectivity, startLoop]);

  /* ---------- Resize observer ---------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const updateSize = () => {
      sizeRef.current = { w: canvas.clientWidth, h: canvas.clientHeight };
      rectRef.current = canvas.getBoundingClientRect();
      requestDraw();
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [requestDraw]);

  /* ---------- Mouse events ---------- */
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      const rect = rectRef.current;
      if (!canvas || !rect) return;
      const cam = cameraRef.current;
      const [cx, cy] = screenToCanvas(e.clientX, e.clientY, rect, cam);
      const node = findNodeAt(cx, cy, nodesRef.current);

      if (node) {
        dragRef.current = {
          node,
          isPanning: false,
          startX: e.clientX,
          startY: e.clientY,
          camStartX: 0,
          camStartY: 0,
        };
        node.fx = node.x;
        node.fy = node.y;
        simRef.current?.alphaTarget(0.3).restart();
        startLoop();
      } else {
        dragRef.current = {
          node: null,
          isPanning: true,
          startX: e.clientX,
          startY: e.clientY,
          camStartX: cam.x,
          camStartY: cam.y,
        };
      }
      canvas.setPointerCapture(e.pointerId);
    },
    [startLoop],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      const rect = rectRef.current;
      if (!canvas || !rect) return;
      const cam = cameraRef.current;
      const drag = dragRef.current;

      if (drag.node) {
        const [cx, cy] = screenToCanvas(e.clientX, e.clientY, rect, cam);
        drag.node.fx = cx;
        drag.node.fy = cy;
        requestDraw();
        return;
      }

      if (drag.isPanning) {
        const dx = (e.clientX - drag.startX) / cam.zoom;
        const dy = (e.clientY - drag.startY) / cam.zoom;
        cam.x = drag.camStartX + dx;
        cam.y = drag.camStartY + dy;
        requestDraw();
        return;
      }

      const [cx, cy] = screenToCanvas(e.clientX, e.clientY, rect, cam);
      const node = findNodeAt(cx, cy, nodesRef.current);
      const newId = node?.id ?? null;
      if (newId !== hoveredRef.current) {
        setHoveredNode(newId);
        requestDraw();
      }
      canvas.style.cursor = node ? 'pointer' : 'grab';
    },
    [requestDraw],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;

      if (drag.node) {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (dx * dx + dy * dy < 49) {
          const nodeId = drag.node.id;
          setSelectedNode((prev) => (prev === nodeId ? null : nodeId));
          requestDraw();
        }
        drag.node.fx = null;
        drag.node.fy = null;
        simRef.current?.alphaTarget(0);
      } else if (drag.isPanning) {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (dx * dx + dy * dy < 49) {
          setSelectedNode(null);
          requestDraw();
        }
      }

      dragRef.current = {
        node: null,
        isPanning: false,
        startX: 0,
        startY: 0,
        camStartX: 0,
        camStartY: 0,
      };
      canvasRef.current?.releasePointerCapture(e.pointerId);
    },
    [requestDraw],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const cam = cameraRef.current;
      const delta = -e.deltaY * RENDER.zoomSensitivity;
      const newZoom = Math.min(RENDER.zoomMax, Math.max(RENDER.zoomMin, cam.zoom * (1 + delta)));
      cam.zoom = newZoom;
      requestDraw();
    },
    [requestDraw],
  );

  const handleDoubleClick = useCallback(() => {
    cameraRef.current = { x: 0, y: 0, zoom: initialZoomRef.current };
    requestDraw();
  }, [requestDraw]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Select first node when nothing is selected and user presses Enter or arrow key
      if (!selectedRef.current) {
        if (
          e.key === 'Enter' ||
          ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)
        ) {
          const nodes = nodesRef.current;
          if (nodes.length > 0) {
            const first = nodes.reduce((a, b) => (a.degree >= b.degree ? a : b));
            setSelectedNode(first.id);
            neighborIdxRef.current = 0;
            requestDraw();
            e.preventDefault();
          }
        }
        return;
      }

      const neighbors = connectedRef.current.get(selectedRef.current);
      if (!neighbors || neighbors.size === 0) {
        if (e.key === 'Escape') {
          setSelectedNode(null);
          requestDraw();
        }
        return;
      }

      let nextNodeId: string | null = null;

      if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
        const direction = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
        const arr = Array.from(neighbors);
        neighborIdxRef.current =
          (((neighborIdxRef.current + direction) % arr.length) + arr.length) % arr.length;
        nextNodeId = arr[neighborIdxRef.current] || null;
        e.preventDefault();
      } else if (e.key === 'Escape') {
        setSelectedNode(null);
        requestDraw();
      }

      if (nextNodeId) {
        neighborIdxRef.current = 0;
        setSelectedNode(nextNodeId);
        requestDraw();
      }
    },
    [requestDraw],
  );

  /* ---------- Tooltip content ---------- */
  const hoveredData = hoveredNode ? (nodeMapRef.current.get(hoveredNode) ?? null) : null;
  const selectedData = selectedNode ? (nodeMapRef.current.get(selectedNode) ?? null) : null;
  const activeData = hoveredData ?? selectedData;

  return (
    <div className="graph-canvas-container relative">
      {/* biome-ignore lint/a11y/noInteractiveElementToNoninteractiveRole: canvas needs role="application" for custom keyboard handling per WAI-ARIA */}
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon-cyan/60 focus-visible:outline-offset-[-2px]"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        role="application"
        aria-roledescription="interactive graph"
        aria-label={`Knowledge graph with ${data.nodeCount} entities and ${data.edgeCount} relationships. Press Enter or arrow keys to select a node, arrow keys to navigate neighbors, Escape to deselect.`}
      />

      {/* Vignette overlay */}
      <div className="pointer-events-none absolute inset-0 rounded-[var(--radius)] graph-vignette" />

      {/* HUD: Stats */}
      <div className="pointer-events-none absolute left-3 top-3 select-none">
        <div className="glass pointer-events-auto rounded-lg px-3 py-2 text-[10px] text-muted-foreground">
          <span className="text-neon-cyan font-mono font-bold">{data.nodeCount}</span> nodes
          <span className="mx-2 opacity-30">|</span>
          <span className="text-neon-purple font-mono font-bold">{data.edgeCount}</span> edges
        </div>
      </div>

      {/* HUD: Legend */}
      {Object.keys(data.nodeTypes).length > 0 && (
        <div className="pointer-events-none absolute bottom-3 left-3 select-none">
          <div className="glass pointer-events-auto flex flex-wrap gap-x-3 gap-y-1 rounded-lg px-3 py-2">
            {Object.entries(data.nodeTypes).map(([type, count]) => {
              const color = getNodeColor(type);
              return (
                <div
                  key={type}
                  className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    aria-hidden="true"
                    style={{
                      backgroundColor: color,
                      boxShadow: `0 0 8px ${color}80, 0 0 3px ${color}40`,
                    }}
                  />
                  <span className="font-mono">
                    {type}
                    <span className="ml-1 opacity-50">({count})</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* HUD: Controls hint */}
      <div className="pointer-events-none absolute bottom-3 right-3 select-none">
        <span className="text-[9px] text-muted-foreground/70">
          Drag to pan · Scroll to zoom · Double-click to reset · Arrows to navigate · Esc to
          deselect
        </span>
      </div>

      {/* Screen reader announcements */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {selectedData
          ? `Selected: ${selectedData.label}, Type: ${selectedData.type}, ${selectedData.degree} connections, ${selectedData.memoryCount} linked memories`
          : ''}
      </div>

      {/* Node detail tooltip */}
      {activeData && (
        <output className="pointer-events-none absolute right-3 top-3 block select-none">
          <div className="glass glow-purple rounded-lg px-4 py-3 text-xs">
            <div className="mb-1 font-mono text-sm font-bold" style={{ color: activeData.color }}>
              {activeData.label}
            </div>
            <div className="flex flex-col gap-0.5 text-muted-foreground">
              <span>
                Type: <span className="text-foreground">{activeData.type}</span>
              </span>
              <span>
                Connections: <span className="text-foreground">{activeData.degree}</span>
              </span>
              <span>
                Linked memories: <span className="text-foreground">{activeData.memoryCount}</span>
              </span>
            </div>
          </div>
        </output>
      )}
    </div>
  );
}
