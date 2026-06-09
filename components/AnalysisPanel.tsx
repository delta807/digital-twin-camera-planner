/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useState, useRef } from 'react';
import { X, Download, Sparkles, Radio, PanelLeft } from 'lucide-react';
import { drawReachability, drawDepth, drawCoverage, drawConflict, drawLayout, drawManipulability, drawEffort, drawGsd, type ReachData, type DepthData, type CoverageData, type LayoutData, type ManipData, type EffortData, type GsdData } from '../analysis/figures';
import { AnalysisCatalog, type FigureKey } from './AnalysisCatalog';

interface Props {
  open: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  /** Live reach grid + table metrics, computed by App from the current layout (null if not ready). */
  getReach: () => ReachData | null;
  /** Per-workstation reach figures (empty unless there are multiple workstations). */
  getReachStations: () => { label: string; data: ReachData }[];
  /** #8 inter-arm conflict zone (≥2 arms overlap) — null unless All-scope with ≥2 arms. */
  getConflict: () => ReachData | null;
  /** #11 layout optimizer — base-placement coverage scores; null unless All-scope. */
  getLayout: () => LayoutData | null;
  /** #1 manipulability/dexterity — per-cell inverse condition number of the TCP Jacobian. */
  getManip: () => ManipData | null;
  /** #2 effort/torque headroom — per-cell gravity-torque headroom vs servo stall. */
  getEffort: () => EffortData | null;
  /** #5 resolution/GSD — per-cell mm/px the overhead camera resolves. */
  getGsd: () => GsdData | null;
  /** Live overhead depth image (null if no station camera). */
  getDepth: () => DepthData | null;
  /** Live per-camera table coverage (null if no camera). */
  getCoverage: () => CoverageData | null;
  /** Opt-in: re-sweep the reach at high detail for a crisp snapshot/PNG (a 1 s compute). */
  onHighDetail: () => void;
  /** True while the high-detail snapshot is the active reach figure (vs the live grid). */
  highDetail: boolean;
  /** A cheap signature of the scene state that affects the figures (arm + sensor-camera poses). The
   *  figures recompute (debounced) only when this CHANGES — orbiting the VIEW doesn't change it, so it
   *  no longer triggers the heavy depth readback + coverage raycasts on every frame. */
  sig: string;
  /** Swap to the workspace dock (they share the left dock slot, so only one shows at a time). */
  onOpenDock: () => void;
  /** Analysis scope toggle: 'all' or a station id, + the available workstations. */
  scope: string;
  onScope: (id: string) => void;
  stations: { id: string; label: string }[];
  /** Arm count in the current scope — drives the per-scope catalog (#7/#8 need ≥2). */
  armsInScope: number;
}

/** Render one figure to a hi-DPI canvas via `draw`, redrawing ONLY when `rev` changes (not on every
 *  parent render — `draw` is captured in a ref so a new closure each render doesn't force a redraw).
 *  `flash` briefly rings the figure when a catalog card jumps to it (so it's clear WHICH graph). */
function Figure({ title, width, height, draw, rev, flash }: { title: string; width: number; height: number; draw: (c: HTMLCanvasElement) => void; rev: number; flash?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw); drawRef.current = draw;
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = width * dpr; c.height = height * dpr;
    c.style.width = `${width}px`; c.style.height = `${height}px`;
    drawRef.current(c);
  }, [rev, width, height]);
  const download = () => {
    const c = ref.current; if (!c) return;
    c.toBlob((b) => { if (!b) return; const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `${title.replace(/\s+/g, '_').toLowerCase()}.png`; a.click(); URL.revokeObjectURL(u); });
  };
  return (
    <div className={`relative inline-block rounded-lg overflow-hidden border bg-white shadow-sm transition-all ${flash ? 'border-indigo-500 ring-2 ring-indigo-500/60' : 'border-black/10'}`}>
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
export function AnalysisPanel({ open, onClose, isDarkMode, getReach, getReachStations, getDepth, getCoverage, getConflict, getLayout, getManip, getEffort, getGsd, onHighDetail, highDetail, sig, onOpenDock, scope, onScope, stations, armsInScope }: Props) {
  const scopeLabel = scope === 'all' ? 'all workstations' : (stations.find((s) => s.id === scope)?.label ?? 'workstation');
  // Recompute the (heavy) figure data DEBOUNCED, only after the scene signature settles — so dragging
  // an arm or orbiting the view doesn't fire depth-readback + coverage-raycasts every frame (the
  // stutter). Storing the snapshot in state means the canvases also only redraw on settle.
  const [snap, setSnap] = useState<{ reach: ReachData | null; stations: { label: string; data: ReachData }[]; depth: DepthData | null; coverage: CoverageData | null; conflict: ReachData | null; layout: LayoutData | null; manip: ManipData | null; effort: EffortData | null; gsd: GsdData | null; rev: number }>({ reach: null, stations: [], depth: null, coverage: null, conflict: null, layout: null, manip: null, effort: null, gsd: null, rev: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState<string | null>(null); // #2 — briefly ring the figure a card jumps to
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => setSnap((s) => ({ reach: getReach(), stations: getReachStations(), depth: getDepth(), coverage: getCoverage(), conflict: getConflict(), layout: getLayout(), manip: getManip(), effort: getEffort(), gsd: getGsd(), rev: s.rev + 1 })), 160);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sig, highDetail]);
  // Jump a catalog card to its figure AND flash it, so it's obvious which of the graphs is meant.
  const jumpTo = (fig: FigureKey) => {
    scrollRef.current?.querySelector(`[data-figure="${fig}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setFlash(fig);
    window.setTimeout(() => setFlash((f) => (f === fig ? null : f)), 1500);
  };
  if (!open) return null;

  const { reach, stations: stationFigs, depth, coverage, conflict, layout, manip, effort, gsd, rev } = snap;
  const panel = isDarkMode ? 'bg-slate-900/95 border-white/10' : 'bg-white/95 border-black/10';
  const subtle = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  return (
    <div className={`absolute left-[3.75rem] top-4 bottom-4 z-30 w-[680px] max-w-[calc(100vw-5rem)] flex flex-col rounded-2xl glass-panel shadow-2xl border overflow-hidden ${panel}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-black/10 shrink-0">
        <button onClick={onOpenDock} title="Switch to workspace dock" className={`p-1 rounded-md ${isDarkMode ? 'hover:bg-white/10 text-slate-300' : 'hover:bg-black/5 text-slate-600'}`}><PanelLeft className="w-4 h-4" /></button>
        <Radio className="w-3.5 h-3.5 text-emerald-500 animate-pulse-soft" />
        <h2 className={`text-[11px] font-bold uppercase tracking-wide ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>Workspace analysis · live</h2>
        <span className={`text-[9px] ${subtle} hidden min-[560px]:inline`}>updates as you move arms &amp; cameras</span>
        <div className="flex-1" />
        <button onClick={onHighDetail} title="Re-sweep the reach at high detail for a crisp figure/PNG"
          className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold ${highDetail ? 'bg-indigo-600 text-white' : (isDarkMode ? 'bg-white/10 text-slate-200 hover:bg-white/15' : 'bg-black/5 text-slate-600 hover:bg-black/10')}`}>
          <Sparkles className="w-3 h-3" /> High detail
        </button>
        <button onClick={onClose} title="Close" className={`p-1 rounded-md ${isDarkMode ? 'hover:bg-white/10 text-slate-300' : 'hover:bg-black/5 text-slate-600'}`}><X className="w-4 h-4" /></button>
      </div>
      {/* Scope toggle — show All workstations or just one (its reach + its camera footage/coverage). */}
      {stations.length > 1 && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-black/5 shrink-0 overflow-x-auto custom-scrollbar">
          <span className={`text-[9px] font-bold uppercase tracking-wide shrink-0 ${subtle}`}>Scope</span>
          {[{ id: 'all', label: 'All' }, ...stations].map((s) => (
            <button key={s.id} onClick={() => onScope(s.id)}
              className={`shrink-0 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors ${scope === s.id ? 'bg-indigo-600 text-white' : (isDarkMode ? 'bg-white/5 text-slate-300 hover:bg-white/10' : 'bg-black/5 text-slate-600 hover:bg-black/10')}`}>
              {s.label === 'All' ? 'All' : s.label.replace('Workstation', 'WS')}
            </button>
          ))}
        </div>
      )}
      <div ref={scrollRef} className="p-3 overflow-auto custom-scrollbar space-y-3">
        {/* Catalog grid of every layout analysis; live/basic cards jump to (and flash) their figure below. */}
        <AnalysisCatalog isDarkMode={isDarkMode} onSelect={jumpTo} scopeLabel={scopeLabel} armsInScope={armsInScope} />
        <div className="flex flex-wrap gap-3 items-start pt-1 border-t border-black/5">
          {/* Full-width zero-height anchors so the catalog cards can scrollIntoView to each figure. */}
          <div data-figure="reach" className="w-full h-0 -mt-1" />
          {reach
            ? <Figure title="SO-101 reachability" width={420} height={380} draw={(c) => drawReachability(c, reach)} rev={rev} flash={flash === 'reach'} />
            : <p className={`text-xs ${subtle}`}>Reach grid not ready — compute reachability first.</p>}
          {/* B3 — per-workstation reach (only when there are multiple workstations). */}
          {stationFigs.map((s) => <Figure key={s.label} title={`${s.label} reach`} width={420} height={380} draw={(c) => drawReachability(c, s.data)} rev={rev} flash={flash === 'reach'} />)}
          {/* #1 manipulability/dexterity — per-cell inverse condition number of the TCP Jacobian. */}
          <div data-figure="manip" className="w-full h-0" />
          {manip && <Figure title="Manipulability" width={420} height={380} draw={(c) => drawManipulability(c, manip)} rev={rev} flash={flash === 'manip'} />}
          {/* #2 effort/torque headroom — gravity torque vs servo stall, per cell. */}
          <div data-figure="effort" className="w-full h-0" />
          {effort && <Figure title="Effort headroom" width={420} height={380} draw={(c) => drawEffort(c, effort)} rev={rev} flash={flash === 'effort'} />}
          {/* #8 inter-arm conflict + #11 layout optimizer (All-scope). */}
          <div data-figure="conflict" className="w-full h-0" />
          {conflict && <Figure title="Inter-arm conflict" width={420} height={380} draw={(c) => drawConflict(c, conflict)} rev={rev} flash={flash === 'conflict'} />}
          <div data-figure="layout" className="w-full h-0" />
          {layout && <Figure title="Layout optimizer" width={420} height={380} draw={(c) => drawLayout(c, layout)} rev={rev} flash={flash === 'layout'} />}
          <div data-figure="coverage" className="w-full h-0" />
          {coverage && <Figure title="Camera coverage" width={630} height={235} draw={(c) => drawCoverage(c, coverage)} rev={rev} flash={flash === 'coverage'} />}
          <div data-figure="depth" className="w-full h-0" />
          {depth && <Figure title="Camera depth (overhead)" width={420} height={270} draw={(c) => drawDepth(c, depth)} rev={rev} flash={flash === 'depth'} />}
          {/* #5 resolution / GSD map — mm/px the overhead camera resolves across the table. */}
          <div data-figure="gsd" className="w-full h-0" />
          {gsd && <Figure title="Resolution (GSD)" width={420} height={380} draw={(c) => drawGsd(c, gsd)} rev={rev} flash={flash === 'gsd'} />}
        </div>
      </div>
    </div>
  );
}
