/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useState, useRef } from 'react';
import { Download, Sparkles, Radio, PanelLeft, Maximize2, X } from 'lucide-react';
import { drawReachability, drawDepth, drawCoverage, drawConflict, drawLayout, drawManipulability, drawEffort, drawGsd, drawHandoff, drawCycleTime, drawThroughput, type ReachData, type DepthData, type CoverageData, type LayoutData, type ManipData, type EffortData, type GsdData, type HandoffData, type CycleData, type ThroughputData } from '../analysis/figures';
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
  /** #9 handoff feasibility — bimanual exchange zone + best handoff cell (null unless ≥2 arms in scope). */
  getHandoff: () => HandoffData | null;
  /** #4 cycle time — per-cell round-trip pick service time. */
  getCycleTime: () => CycleData | null;
  /** #10 1-vs-2 arm throughput comparison (null unless ≥2 arms in scope). */
  getThroughput: () => ThroughputData | null;
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
  const bigRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw); drawRef.current = draw;
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = width * dpr; c.height = height * dpr;
    c.style.width = `${width}px`; c.style.height = `${height}px`;
    drawRef.current(c);
  }, [rev, width, height]);
  // Expanded view: render the SAME figure at ~2× on-screen size so the (fixed-px) axis labels and
  // colorbar ticks become readable. Internal resolution is kept at the small view's device size so the
  // 1:1 CSS scale doubles the apparent text — a "view bigger", crisp enough for reading.
  useEffect(() => {
    if (!zoom) return;
    const c = bigRef.current; if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = width * dpr; c.height = height * dpr;
    c.style.width = `${width * 2}px`; c.style.height = `${height * 2}px`;
    drawRef.current(c);
  }, [zoom, rev, width, height]);
  const download = (c: HTMLCanvasElement | null) => {
    if (!c) return;
    c.toBlob((b) => { if (!b) return; const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `${title.replace(/\s+/g, '_').toLowerCase()}.png`; a.click(); URL.revokeObjectURL(u); });
  };
  return (
    // content-visibility:auto lets the browser SKIP painting figures scrolled out of view — with ~11 big
    // canvases inside a backdrop-blurred panel, compositing them all on every scroll frame was the jank.
    // contain-intrinsic-size reserves their box so the scrollbar/layout stays stable while skipped.
    <div className={`relative inline-block rounded-lg overflow-hidden border bg-white shadow-sm transition-all ${flash ? 'border-indigo-500 ring-2 ring-indigo-500/60' : 'border-black/10'}`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: `${width}px ${height}px` }}>
      <canvas ref={ref} />
      <div className="absolute top-2 right-2 flex items-center gap-1">
        <button onClick={() => setZoom(true)} title="Expand to read labels"
          className="flex items-center gap-1 px-2 py-1 rounded-md bg-black/60 text-white text-[10px] font-semibold hover:bg-black/80">
          <Maximize2 className="w-3 h-3" />
        </button>
        <button onClick={() => download(ref.current)} title="Download PNG"
          className="flex items-center gap-1 px-2 py-1 rounded-md bg-black/60 text-white text-[10px] font-semibold hover:bg-black/80">
          <Download className="w-3 h-3" /> PNG
        </button>
      </div>
      {zoom && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6" onClick={() => setZoom(false)}>
          <div className="relative max-w-[95vw] max-h-[92vh] overflow-auto rounded-xl bg-white shadow-2xl p-2" onClick={(e) => e.stopPropagation()}>
            <canvas ref={bigRef} />
            <div className="absolute top-3 right-3 flex items-center gap-1">
              <button onClick={() => download(bigRef.current)} title="Download PNG"
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-black/60 text-white text-[11px] font-semibold hover:bg-black/80">
                <Download className="w-3.5 h-3.5" /> PNG
              </button>
              <button onClick={() => setZoom(false)} title="Close"
                className="p-1.5 rounded-md bg-black/60 text-white hover:bg-black/80">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Analysis dock — a NON-BLOCKING floating panel (not a modal): you can keep it open while you move
 * arms/cameras, and the figures refresh live. A low-frequency tick re-pulls the live data so the
 * depth/coverage track the cameras and the reach follows the arm. The reach uses the fast live grid;
 * "High detail" re-sweeps it finely for a crisp snapshot/PNG.
 */
export function AnalysisPanel({ open, isDarkMode, getReach, getReachStations, getDepth, getCoverage, getConflict, getLayout, getManip, getEffort, getGsd, getHandoff, getCycleTime, getThroughput, onHighDetail, highDetail, sig, onOpenDock, scope, onScope, stations, armsInScope }: Props) {
  const scopeLabel = scope === 'all' ? 'all workstations' : (stations.find((s) => s.id === scope)?.label ?? 'workstation');
  // Recompute the (heavy) figure data DEBOUNCED, only after the scene signature settles — so dragging
  // an arm or orbiting the view doesn't fire depth-readback + coverage-raycasts every frame (the
  // stutter). Storing the snapshot in state means the canvases also only redraw on settle.
  const [snap, setSnap] = useState<{ reach: ReachData | null; stations: { label: string; data: ReachData }[]; depth: DepthData | null; coverage: CoverageData | null; conflict: ReachData | null; layout: LayoutData | null; manip: ManipData | null; effort: EffortData | null; gsd: GsdData | null; handoff: HandoffData | null; cycle: CycleData | null; throughput: ThroughputData | null; rev: number }>({ reach: null, stations: [], depth: null, coverage: null, conflict: null, layout: null, manip: null, effort: null, gsd: null, handoff: null, cycle: null, throughput: null, rev: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState<string | null>(null); // #2 — briefly ring the figure a card jumps to
  useEffect(() => {
    if (!open) return;
    // The figure data is heavy (effort runs mj_forward over thousands of poses; manip runs a
    // finite-difference Jacobian; throughput re-sweeps per arm). Computing all of it in ONE task froze
    // the main thread on a scope switch (the lag). Instead, after the debounce, compute it in GROUPS
    // across animation frames — each group yields to the browser so the UI stays responsive and the
    // figures pop in progressively. Each group bumps `rev` so its figures redraw as they land.
    let cancelled = false;
    const groups: Array<() => void> = [
      () => setSnap((s) => ({ ...s, reach: getReach(), stations: getReachStations(), rev: s.rev + 1 })),
      () => setSnap((s) => ({ ...s, manip: getManip(), rev: s.rev + 1 })),
      () => setSnap((s) => ({ ...s, effort: getEffort(), rev: s.rev + 1 })),
      () => setSnap((s) => ({ ...s, cycle: getCycleTime(), rev: s.rev + 1 })),
      () => setSnap((s) => ({ ...s, conflict: getConflict(), handoff: getHandoff(), layout: getLayout(), throughput: getThroughput(), rev: s.rev + 1 })),
      () => setSnap((s) => ({ ...s, coverage: getCoverage(), depth: getDepth(), gsd: getGsd(), rev: s.rev + 1 })),
    ];
    const t = setTimeout(() => {
      let i = 0;
      const run = () => { if (cancelled) return; groups[i](); if (++i < groups.length) requestAnimationFrame(run); };
      requestAnimationFrame(run);
    }, 160);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sig, highDetail]);
  // Jump a catalog card to its figure AND flash it, so it's obvious which of the graphs is meant.
  const jumpTo = (fig: FigureKey) => {
    scrollRef.current?.querySelector(`[data-figure="${fig}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setFlash(fig);
    window.setTimeout(() => setFlash((f) => (f === fig ? null : f)), 1500);
  };
  if (!open) return null;

  const { reach, stations: stationFigs, depth, coverage, conflict, layout, manip, effort, gsd, handoff, cycle, throughput, rev } = snap;
  const panel = isDarkMode ? 'bg-slate-900/80 border-white/10' : 'bg-white/80 border-black/10';
  const subtle = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  return (
    <div className={`absolute left-[3.75rem] top-4 bottom-4 z-30 w-[680px] max-w-[calc(100vw-5rem)] flex flex-col rounded-2xl glass-panel shadow-2xl border overflow-hidden ${panel}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-black/10 shrink-0">
        <Radio className="w-3.5 h-3.5 text-emerald-500 animate-pulse-soft" />
        <h2 className={`text-[11px] font-bold uppercase tracking-wide ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>Workspace analysis · live</h2>
        <span className={`text-[9px] ${subtle} hidden min-[560px]:inline`}>updates as you move arms &amp; cameras</span>
        <div className="flex-1" />
        <button onClick={onHighDetail} title="Re-sweep the reach at high detail for a crisp figure/PNG"
          className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold ${highDetail ? 'bg-indigo-600 text-white' : (isDarkMode ? 'bg-white/10 text-slate-200 hover:bg-white/15' : 'bg-black/5 text-slate-600 hover:bg-black/10')}`}>
          <Sparkles className="w-3 h-3" /> High detail
        </button>
        {/* Dock⇄analysis swap, moved into the close slot (it dismisses analysis by switching to the dock). */}
        <button onClick={onOpenDock} title="Switch to workspace dock" className={`p-1 rounded-md ${isDarkMode ? 'hover:bg-white/10 text-slate-300' : 'hover:bg-black/5 text-slate-600'}`}><PanelLeft className="w-4 h-4" /></button>
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
          {/* #4 cycle time — per-cell pick+retreat service time. */}
          <div data-figure="cycle" className="w-full h-0" />
          {cycle && <Figure title="Cycle time" width={420} height={380} draw={(c) => drawCycleTime(c, cycle)} rev={rev} flash={flash === 'cycle'} />}
          {/* #8 inter-arm conflict + #11 layout optimizer (All-scope). */}
          <div data-figure="conflict" className="w-full h-0" />
          {conflict && <Figure title="Inter-arm conflict" width={420} height={380} draw={(c) => drawConflict(c, conflict)} rev={rev} flash={flash === 'conflict'} />}
          {/* #9 handoff feasibility — bimanual exchange zone + best handoff cell. */}
          <div data-figure="handoff" className="w-full h-0" />
          {handoff && <Figure title="Handoff feasibility" width={420} height={380} draw={(c) => drawHandoff(c, handoff)} rev={rev} flash={flash === 'handoff'} />}
          {/* #10 1-vs-2 arm throughput comparison. */}
          <div data-figure="throughput" className="w-full h-0" />
          {throughput && <Figure title="1-vs-2 arm throughput" width={420} height={250} draw={(c) => drawThroughput(c, throughput)} rev={rev} flash={flash === 'throughput'} />}
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
