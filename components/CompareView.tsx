/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MousePointer2 } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  isDarkMode: boolean;
  sidebarOpen: boolean;
  /** All cells the panes can frame, and which each pane currently shows (repointable). */
  cells: { id: string; label: string }[];
  cellA: string;
  cellB: string;
  onCellA: (id: string) => void;
  onCellB: (id: string) => void;
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
export function CompareView({ isDarkMode, cells, cellA, cellB, onCellA, onCellB, feedsA, feedsB }: Props) {
  // Pane header: A/B chip + a dropdown to repoint the pane at any cell (compare with Workstation 3, etc.).
  const badge = (tag: string, value: string, onChange: (id: string) => void, accent: string, side: 'l' | 'r') => (
    <div className={`absolute top-3 ${side === 'l' ? 'left-[4.75rem]' : 'left-[calc(50%+0.75rem)]'} z-20 flex items-center gap-2 pointer-events-auto`}>
      <span className="w-6 h-6 rounded-md grid place-items-center text-white text-[12px] font-bold shadow" style={{ background: accent }}>{tag}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className={`text-[10px] font-semibold px-2 py-1 rounded-md border outline-none cursor-pointer shadow ${isDarkMode ? 'bg-slate-900/80 border-white/10 text-slate-200' : 'bg-white/85 border-black/10 text-slate-700'}`}>
        {cells.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
    </div>
  );

  return (
    <div className="absolute inset-0 z-30 pointer-events-none">
      {/* centre seam between the two scissor halves */}
      <span className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px ${isDarkMode ? 'bg-white/15' : 'bg-black/15'}`} />

      {badge('A', cellA, onCellA, 'oklch(0.655 0.155 262)', 'l')}
      {badge('B', cellB, onCellB, 'oklch(0.70 0.13 292)', 'r')}

      {/* per-pane feed stacks (overhead + wrist) — anchored in each pane's OWN bottom-outer corner so
          they never collide with the centred A/B pickers + Compare pill at the top. */}
      {feedsA && <div className="absolute bottom-4 left-[4.75rem] z-10 flex flex-col gap-2 pointer-events-auto">{feedsA}</div>}
      {feedsB && <div className="absolute bottom-4 right-3 z-10 flex flex-col gap-2 pointer-events-auto">{feedsB}</div>}

      {/* No exit pill here — leave Compare via the left sidebar's mode menu (Edit).
          Hint sits at TOP-centre (where the exit pill used to be) so it never collides with the
          bottom-centre edit toolbar that renders over this overlay. */}
      <div className={`absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium shadow pointer-events-none ${isDarkMode ? 'bg-slate-900/80 border border-white/10 text-slate-300' : 'bg-white/85 border border-black/10 text-slate-600'}`}>
        <MousePointer2 className="w-3.5 h-3.5 text-indigo-500" /> Drag to orbit both
      </div>
    </div>
  );
}
