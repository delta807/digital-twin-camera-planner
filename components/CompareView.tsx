/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Columns2, X, MousePointer2 } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  isDarkMode: boolean;
  sidebarOpen: boolean;
  onExit: () => void;
  /** Pane (cell) labels. */
  labelA?: string;
  labelB?: string;
  /** Per-pane feed stacks (overhead + wrist), rendered top-right of each half. */
  feedsA?: ReactNode;
  feedsB?: ReactNode;
}

/**
 * CompareView v2 — a transparent HUD over the LIVE split canvas. The two setups are rendered by the
 * single MuJoCo renderer into left/right scissor halves (see RenderSystem.renderCompareSplit), so
 * this overlay only draws chrome: the A/B badges, the centre seam, per-pane camera feeds, and exit.
 * It is pointer-events-none over the scene, so dragging rotates BOTH cells via OrbitControls and the
 * scene stays fully live/editable (move objects, jog arms) underneath.
 */
export function CompareView({ isDarkMode, onExit, labelA = 'Cell A', labelB = 'Cell B', feedsA, feedsB }: Props) {
  const badge = (tag: string, label: string, accent: string, side: 'l' | 'r') => (
    <div className={`absolute top-3 ${side === 'l' ? 'left-[4.75rem]' : 'left-[calc(50%+0.75rem)]'} z-10 flex items-center gap-2 pointer-events-none`}>
      <span className="w-6 h-6 rounded-md grid place-items-center text-white text-[12px] font-bold shadow" style={{ background: accent }}>{tag}</span>
      <span className={`font-mono text-[10px] px-2 py-1 rounded-md border ${isDarkMode ? 'bg-slate-900/70 border-white/10 text-slate-300' : 'bg-white/80 border-black/10 text-slate-600'}`}>{label}</span>
    </div>
  );

  return (
    <div className="absolute inset-0 z-30 pointer-events-none">
      {/* centre seam between the two scissor halves */}
      <span className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px ${isDarkMode ? 'bg-white/15' : 'bg-black/15'}`} />

      {badge('A', labelA, 'oklch(0.655 0.155 262)', 'l')}
      {badge('B', labelB, 'oklch(0.70 0.13 292)', 'r')}

      {/* per-pane feed stacks (overhead + wrist) */}
      {feedsA && <div className="absolute top-3 left-[calc(50%-13.5rem)] z-10 flex flex-col gap-2 pointer-events-auto">{feedsA}</div>}
      {feedsB && <div className="absolute top-3 right-3 z-10 flex flex-col gap-2 pointer-events-auto">{feedsB}</div>}

      {/* exit */}
      <button onClick={onExit} aria-label="Exit compare"
        className={`absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide shadow pointer-events-auto ${isDarkMode ? 'bg-slate-900/85 border border-white/10 text-slate-200 hover:bg-slate-800' : 'bg-white/90 border border-black/10 text-slate-700 hover:bg-white'}`}>
        <Columns2 className="w-3.5 h-3.5 text-indigo-500" /> Compare <X className="w-3.5 h-3.5 opacity-70" />
      </button>

      {/* hint footer */}
      <div className={`absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium shadow pointer-events-none ${isDarkMode ? 'bg-slate-900/80 border border-white/10 text-slate-300' : 'bg-white/85 border border-black/10 text-slate-600'}`}>
        <MousePointer2 className="w-3.5 h-3.5 text-indigo-500" /> Drag to orbit both · objects stay live &amp; editable
      </div>
    </div>
  );
}
