import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { PART_HEX, graphData } from '../lib/content';
import { moduleCompletion, useProgress } from '../lib/progress';
import { indexData } from '../lib/content';

const W = 960;
const H = 600;

interface SimNode extends SimulationNodeDatum {
  id: string;
  title: string;
  partIndex: number;
  addon: boolean;
  weeks: [number, number] | null;
  r: number;
}

interface Tooltip {
  x: number;
  y: number;
  node: SimNode;
}

function radiusOf(weeks: [number, number] | null): number {
  const span = weeks ? weeks[1] - weeks[0] + 1 : 1;
  return 15 + span * 2.5;
}

/** Settle the force layout once, deterministically (seeded ring positions). */
function computeLayout(): { nodes: SimNode[]; links: Array<SimulationLinkDatum<SimNode> & { weight: number }> } {
  const nodes: SimNode[] = graphData.nodes.map((n, i) => {
    const angle = (i / graphData.nodes.length) * Math.PI * 2;
    return {
      ...n,
      r: radiusOf(n.weeks),
      x: W / 2 + Math.cos(angle) * 210,
      y: H / 2 + Math.sin(angle) * 180,
    };
  });
  const links = graphData.edges.map((e) => ({ source: e.source, target: e.target, weight: e.weight }));

  const sim = forceSimulation(nodes)
    .force(
      'link',
      forceLink<SimNode, SimulationLinkDatum<SimNode> & { weight: number }>(links)
        .id((d) => d.id)
        .distance((l) => 200 - Math.min(l.weight, 5) * 14)
        .strength((l) => 0.05 + Math.min(l.weight, 5) * 0.02),
    )
    .force('charge', forceManyBody().strength(-620))
    .force('center', forceCenter(W / 2, H / 2))
    .force('collide', forceCollide<SimNode>((d) => d.r + 32))
    .force('x', forceX(W / 2).strength(0.018))
    .force('y', forceY(H / 2).strength(0.035))
    .stop();

  for (let i = 0; i < 300; i++) sim.tick();

  // clamp into the viewbox
  for (const n of nodes) {
    n.x = Math.max(n.r + 60, Math.min(W - n.r - 60, n.x!));
    n.y = Math.max(n.r + 34, Math.min(H - n.r - 34, n.y!));
  }
  return { nodes, links: links as never };
}

export default function Constellation() {
  const navigate = useNavigate();
  const { state } = useProgress();
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const groupRefs = useRef(new Map<string, SVGGElement>());
  const layout = useMemo(computeLayout, []);

  // gentle orbital idle wobble, applied to the DOM directly
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const loop = (t: number) => {
      if (!document.hidden) {
        layout.nodes.forEach((n, i) => {
          const g = groupRefs.current.get(n.id);
          if (!g) return;
          const dx = Math.sin(t * 0.0004 + i * 1.8) * 3;
          const dy = Math.cos(t * 0.00033 + i * 2.4) * 3;
          g.setAttribute('transform', `translate(${n.x! + dx}, ${n.y! + dy})`);
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [layout]);

  const byId = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);

  return (
    <div className="constellation-wrap">
      <svg className="constellation-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Module constellation">
        <defs>
          <filter id="node-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {layout.links.map((l, i) => {
          const s = typeof l.source === 'object' ? (l.source as SimNode) : byId.get(String(l.source))!;
          const t = typeof l.target === 'object' ? (l.target as SimNode) : byId.get(String(l.target))!;
          return (
            <line
              key={i}
              x1={s.x}
              y1={s.y}
              x2={t.x}
              y2={t.y}
              stroke="rgba(148, 163, 184, 0.13)"
              strokeWidth={0.8 + Math.min(l.weight, 4) * 0.5}
            />
          );
        })}

        {layout.nodes.map((n) => {
          const hue = PART_HEX[n.partIndex];
          const meta = indexData.modules.find((m) => m.id === n.id)!;
          const completion = moduleCompletion(meta, state);
          const ring = 2 * Math.PI * (n.r + 5);
          return (
            <g
              key={n.id}
              ref={(el) => {
                if (el) groupRefs.current.set(n.id, el);
              }}
              className="node-group"
              transform={`translate(${n.x}, ${n.y})`}
              onClick={() => navigate(`/module/${n.id}`)}
              onMouseEnter={(e) => setTooltip({ x: e.clientX, y: e.clientY, node: n })}
              onMouseMove={(e) => setTooltip({ x: e.clientX, y: e.clientY, node: n })}
              onMouseLeave={() => setTooltip(null)}
            >
              <circle r={n.r + 12} fill="transparent" />
              <circle r={n.r} fill={`${hue}1f`} stroke={hue} strokeWidth={1.4} strokeDasharray={n.addon ? '4 4' : undefined} filter="url(#node-glow)" />
              {completion.pct > 0 && (
                <circle
                  r={n.r + 5}
                  fill="none"
                  stroke={hue}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeDasharray={`${completion.pct * ring} ${ring}`}
                  transform="rotate(-90)"
                  opacity={0.9}
                />
              )}
              <text className="node-id" fill={hue}>
                {n.id}
              </text>
              <text className="node-label" y={n.r + 20}>
                {n.title.length > 26 ? `${n.title.slice(0, 24)}…` : n.title}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="constellation-hint">each star is a module · links are cross-references · click to enter</p>
      {tooltip && (
        <div className="constellation-tooltip" style={{ left: tooltip.x + 16, top: tooltip.y + 12 }}>
          <div className="tt-title">
            {tooltip.node.id} — {tooltip.node.title}
          </div>
          <div className="tt-meta">
            {indexData.parts.find((p) => p.index === tooltip.node.partIndex)?.label}
            {tooltip.node.weeks ? ` · weeks ${tooltip.node.weeks[0]}–${tooltip.node.weeks[1]}` : ''}
            {tooltip.node.addon ? ' · add-on' : ''}
          </div>
        </div>
      )}
    </div>
  );
}
