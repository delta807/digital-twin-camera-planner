/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useState, useRef } from 'react';
import { X, Download, Sparkles, Radio } from 'lucide-react';
import { drawReachability, drawDepth, drawCoverage, type ReachData, type DepthData, type CoverageData } from '../analysis/figures';

interface Props {
  open: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  /** Live reach grid + table metrics, computed by App from the current layout (null if not ready). */
  getReach: () => ReachData | null;
  /** Live overhead depth image (null if no station camera). */
  getDepth: () => DepthData | null;
  /** Live per-camera table coverage (null if no camera). */
  getCoverage: () => CoverageData | null;
  /** Opt-in: re-sweep the reach at high detail for a crisp snapshot/PNG (a 1 s compute). */
  onHighDetail: () => void;
  /** True while the high-detail snapshot is the active reach figure (vs the live grid). */
  highDetail: boolean;
}

/** Render one figure to a hi-DPI canvas via `draw`, redrawing whenever `rev` changes. */
function Figure({ title, width, height, draw, rev }: { title: string; width: number; height: number; draw: (c: HTMLCanvasElement) => void; rev: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = width * dpr; c.height = height * dpr;
    c.style.width = `${width}px`; c.style.height = `${height}px`;
    draw(c);
  }, [rev, width, height, draw]);
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

/**
 * Analysis dock — a NON-BLOCKING floating panel (not a modal): you can keep it open while you move
 * arms/cameras, and the figures refresh live. A low-frequency tick re-pulls the live data so the
 * depth/coverage track the cameras and the reach follows the arm. The reach uses the fast live grid;
 * "High detail" re-sweeps it finely for a crisp snapshot/PNG.
 */
export function AnalysisPanel({ open, onClose, isDarkMode, getReach, getDepth, getCoverage, onHighDetail, highDetail }: Props) {
  // Live refresh: bump a revision ~2.5×/s while open so the figures redraw against the current scene.
  const [rev, setRev] = useState(0);
  useEffect(() => {
    if (!open) return;
    const iv = setInterval(() => setRev((r) => r + 1), 400);
    return () => clearInterval(iv);
  }, [open]);
  if (!open) return null;

  const reach = getReach();
  const depth = getDepth();
  const coverage = getCoverage();
  const panel = isDarkMode ? 'bg-slate-900/95 border-white/10' : 'bg-white/95 border-black/10';
  const subtle = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  return (
    <div className={`absolute bottom-3 left-3 z-30 w-[660px] max-w-[calc(100vw-1.5rem)] max-h-[calc(100vh-7rem)] flex flex-col rounded-2xl glass-panel shadow-2xl border overflow-hidden ${panel}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-black/10 shrink-0">
        <Radio className="w-3.5 h-3.5 text-emerald-500 animate-pulse-soft" />
        <h2 className={`text-[11px] font-bold uppercase tracking-wide ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>Workspace analysis · live</h2>
        <span className={`text-[9px] ${subtle}`}>updates as you move arms &amp; cameras</span>
        <div className="flex-1" />
        <button onClick={onHighDetail} title="Re-sweep the reach at high detail for a crisp figure/PNG"
          className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold ${highDetail ? 'bg-indigo-600 text-white' : (isDarkMode ? 'bg-white/10 text-slate-200 hover:bg-white/15' : 'bg-black/5 text-slate-600 hover:bg-black/10')}`}>
          <Sparkles className="w-3 h-3" /> High detail
        </button>
        <button onClick={onClose} title="Close" className={`p-1 rounded-md ${isDarkMode ? 'hover:bg-white/10 text-slate-300' : 'hover:bg-black/5 text-slate-600'}`}><X className="w-4 h-4" /></button>
      </div>
      <div className="flex flex-wrap gap-3 items-start p-3 overflow-auto custom-scrollbar">
        {reach
          ? <Figure title="SO-101 reachability" width={420} height={380} draw={(c) => drawReachability(c, reach)} rev={rev} />
          : <p className={`text-xs ${subtle}`}>Reach grid not ready — compute reachability first.</p>}
        {depth && <Figure title="Camera depth (overhead)" width={420} height={270} draw={(c) => drawDepth(c, depth)} rev={rev} />}
        {coverage && <Figure title="Camera coverage" width={630} height={235} draw={(c) => drawCoverage(c, coverage)} rev={rev} />}
      </div>
    </div>
  );
}
