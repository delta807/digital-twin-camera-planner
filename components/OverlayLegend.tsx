/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CameraViewToggles } from '../types';
import type { PlannerToggles } from '../WorkspacePlanner';

interface Props {
  camera: CameraViewToggles;
  planner: PlannerToggles;
  isDarkMode: boolean;
}

type Shape = 'fill' | 'dash' | 'soft' | 'dot';
interface Item { on: boolean; color: string; shape: Shape; label: string; }

/** A small swatch matching how each overlay reads in the 3D view. */
function Swatch({ color, shape }: { color: string; shape: Shape }) {
  if (shape === 'dash') return <span className="inline-block w-3.5 h-0 border-t-2 border-dashed" style={{ borderColor: color }} />;
  if (shape === 'soft') return <span className="inline-block w-3.5 h-2.5 rounded-sm" style={{ background: color, opacity: 0.45 }} />;
  if (shape === 'dot') return <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />;
  return <span className="inline-block w-3.5 h-2.5 rounded-sm" style={{ background: color }} />;
}

/**
 * OverlayLegend — a lab-instrument legend keyed to the active 3D overlays, using the design's
 * categorical colors (camera=amber, reach=violet, precision=cyan, object=terracotta).
 */
export function OverlayLegend({ camera, planner, isDarkMode }: Props) {
  const all: Item[] = [
    { on: camera.enabled && camera.footprint, color: 'var(--c-cam)', shape: 'soft', label: 'Camera footprint' },
    { on: camera.enabled && camera.frustum, color: 'var(--c-cam)', shape: 'dash', label: 'FOV frustum' },
    { on: planner.outline, color: 'var(--c-reach)', shape: 'dash', label: 'Max reach envelope' },
    { on: planner.outline, color: 'var(--c-precision)', shape: 'fill', label: 'Precision grasp fan' },
    { on: planner.reach, color: 'var(--c-reach)', shape: 'soft', label: 'Reach heatmap' },
    { on: planner.tasks, color: 'var(--c-object)', shape: 'dot', label: 'Task points' },
  ];
  const items = all.filter((i) => i.on);

  if (items.length === 0) return null;
  const panel = isDarkMode ? 'bg-slate-900/85 border-white/10 text-slate-100' : 'bg-white/90 border-white/80 text-slate-700';

  return (
    <div
      className={`absolute bottom-6 left-4 min-[660px]:left-[20.5rem] z-30 rounded-xl glass-panel border shadow-lg px-3 py-2.5 ${panel}`}
      style={{ ['--c-cam' as string]: 'oklch(0.82 0.14 78)', ['--c-reach' as string]: 'oklch(0.70 0.10 292)', ['--c-precision' as string]: 'oklch(0.83 0.13 188)', ['--c-object' as string]: 'oklch(0.78 0.10 35)' }}
    >
      <div className="text-[9px] font-bold uppercase tracking-[0.14em] mb-2 opacity-70">Overlays</div>
      <div className="space-y-1.5">
        {items.map((i) => (
          <div key={i.label} className="flex items-center gap-2">
            <span className="w-3.5 grid place-items-center"><Swatch color={i.color} shape={i.shape} /></span>
            <span className="text-[11px] whitespace-nowrap">{i.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
