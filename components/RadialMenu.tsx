/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LucideIcon } from 'lucide-react';

export interface RadialItem {
  id: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: RadialItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
  isDarkMode: boolean;
}

/**
 * RadialMenu — a lean right-click radial menu (no motion / base-ui deps). Arranges the items in a
 * ring around the cursor; selecting one fires onSelect. Used to switch an object's interaction mode
 * (Jog / Move / Aim) without the dock, reusing the existing mode functions (DRY).
 */
export function RadialMenu({ x, y, items, onSelect, onClose, isDarkMode }: Props) {
  const R = items.length > 1 ? 58 : 0; // ring radius (single item sits at the cursor)
  const start = -90; // first item points up
  const itemBg = isDarkMode ? 'bg-slate-800/95 border-white/10 text-slate-100' : 'bg-white/95 border-black/10 text-slate-700';

  return (
    <>
      {/* click/right-click anywhere (or Esc) closes */}
      <div
        className="fixed inset-0 z-[55]"
        onPointerDown={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div className="fixed z-[56] pointer-events-none" style={{ left: x, top: y }}>
        {/* centre pip */}
        <span className={`absolute -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full ${isDarkMode ? 'bg-white/40' : 'bg-black/30'}`} />
        {items.map((it, i) => {
          const ang = ((start + (360 / items.length) * i) * Math.PI) / 180;
          const dx = Math.cos(ang) * R, dy = Math.sin(ang) * R;
          const Icon = it.icon;
          return (
            <button
              key={it.id}
              onClick={() => { onSelect(it.id); onClose(); }}
              title={it.label}
              aria-label={it.label}
              className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1 px-1 py-1 rounded-2xl border shadow-lg glass-panel transition-transform hover:scale-105 ${it.active ? 'bg-indigo-600 text-white border-indigo-500' : itemBg}`}
              style={{ left: dx, top: dy, animation: 'pop-in .12s ease both' }}
            >
              <span className="w-9 h-9 grid place-items-center"><Icon className="w-[18px] h-[18px]" /></span>
              <span className="text-[9px] font-bold uppercase tracking-wide whitespace-nowrap px-1 pb-0.5">{it.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
