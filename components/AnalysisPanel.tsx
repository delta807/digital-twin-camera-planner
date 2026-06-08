/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useRef } from 'react';
import { X, Download } from 'lucide-react';
import { drawReachability, type ReachData } from '../analysis/figures';

interface Props {
  open: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  /** Live reach grid + table metrics, computed by App from the current layout (null if not ready). */
  getReach: () => ReachData | null;
}

/** Render one figure to a hi-DPI canvas via `draw`, with a "Download PNG" button. */
function Figure({ title, width, height, draw }: { title: string; width: number; height: number; draw: (c: HTMLCanvasElement) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = width * dpr; c.height = height * dpr;
    c.style.width = `${width}px`; c.style.height = `${height}px`;
    draw(c);
  });
  const download = () => {
    const c = ref.current; if (!c) return;
    c.toBlob((b) => { if (!b) return; const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `${title.replace(/\s+/g, '_').toLowerCase()}.png`; a.click(); URL.revokeObjectURL(u); });
  };
  return (
    <div className="relative inline-block rounded-lg overflow-hidden border border-black/10 bg-white shadow-sm">
      <canvas ref={ref} />
      <button onClick={download} title="Download PNG"
        className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-md bg-black/60 text-white text-[10px] font-semibold hover:bg-black/80">
        <Download className="w-3 h-3" /> PNG
      </button>
    </div>
  );
}

/** Analysis overlay: matplotlib-style figures for the LIVE layout, each exportable as a PNG. */
export function AnalysisPanel({ open, onClose, isDarkMode, getReach }: Props) {
  if (!open) return null;
  const reach = getReach();
  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className={`relative max-h-full overflow-auto rounded-2xl shadow-2xl border p-5 ${isDarkMode ? 'bg-slate-900 border-white/10' : 'bg-white border-black/10'}`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className={`text-sm font-bold uppercase tracking-wide ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>Workspace analysis · live layout</h2>
          <button onClick={onClose} className={`p-1 rounded-md ${isDarkMode ? 'hover:bg-white/10 text-slate-300' : 'hover:bg-black/5 text-slate-600'}`}><X className="w-4 h-4" /></button>
        </div>
        <div className="flex flex-wrap gap-4 items-start">
          {reach
            ? <Figure title="SO-101 reachability" width={620} height={560} draw={(c) => drawReachability(c, reach)} />
            : <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Reach grid not ready — compute reachability first.</p>}
        </div>
      </div>
    </div>
  );
}
