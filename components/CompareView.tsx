/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Columns2, Info, Camera, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SceneMap, CompareSetup } from './SceneMap';

interface Props {
  setupA: CompareSetup | null;
  setupB: CompareSetup | null;
  isDarkMode: boolean;
  sidebarOpen: boolean;
  onSnapshot: (slot: 'A' | 'B') => void;
  onExit: () => void;
  /** Shared orbit: read the live camera angle (so both panes match the 3D view) … */
  getOrbit: () => { dx: number; dy: number; dz: number } | null;
  /** … and orbit it by (dAz, dEl) when a pane is dragged (drives both panes + the NavCube). */
  onOrbit: (dAz: number, dEl: number) => void;
}

interface Metrics { heightCm: number; footprintCm2: number; coveragePct: number; reachPct: number; inFp: number; reachable: number; total: number }

/** Footprint + how many task blocks fall inside the camera frame / within arm reach, for a setup.
 *  Mirrors the design's metricsFor: footprint ≈ (2·reach)×(1.8·reach); coverage = blocks in the
 *  asymmetric footprint; reach = blocks within the precision-fan radius of the arm base. */
function metricsFor(s: CompareSetup): Metrics {
  const reach = s.camera.z * Math.tan((s.camera.fovH * Math.PI / 180) / 2);
  const fpArea = (reach * 2) * (reach * 1.8);
  const inFp = s.blocks.filter((b) =>
    Math.abs(b.x - s.camera.x) < reach && (b.y - s.camera.y) > -reach * 0.7 && (b.y - s.camera.y) < reach * 1.1).length;
  const reachable = s.blocks.filter((b) => Math.hypot(b.x - s.arm.x, b.y - s.arm.y) < 0.24).length;
  const total = s.blocks.length || 1;
  return {
    heightCm: Math.round(s.camera.z * 100),
    footprintCm2: Math.round(fpArea * 1e4),
    coveragePct: Math.round((inFp / total) * 100),
    reachPct: Math.round((reachable / total) * 100),
    inFp, reachable, total: s.blocks.length,
  };
}

function MiniMetric({ label, value, unit, pct, good, isDarkMode }: { label: string; value: string; unit?: string; pct?: boolean; good?: boolean; isDarkMode: boolean }) {
  const sub = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const color = pct ? (good ? 'oklch(0.72 0.16 150)' : 'oklch(0.70 0.16 25)') : undefined;
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className={`text-[8.5px] font-bold uppercase tracking-wide ${sub}`}>{label}</span>
      <div className="flex items-baseline gap-1">
        <span className="font-mono text-[17px] font-semibold tabular-nums" style={{ color }}>{value}</span>
        {unit && <span className={`text-[10px] ${sub}`}>{unit}</span>}
      </div>
    </div>
  );
}

function Pane({ tag, accent, setup, slot, onSnapshot, isDarkMode, az, el, onOrbit }: {
  tag: string; accent: string; setup: CompareSetup | null; slot: 'A' | 'B'; onSnapshot: (s: 'A' | 'B') => void; isDarkMode: boolean;
  az: number; el: number; onOrbit: (dAz: number, dEl: number) => void;
}) {
  const sub = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const m = setup ? metricsFor(setup) : null;
  // Drag anywhere on the scene to orbit BOTH panes (+ the NavCube), like grabbing the model.
  let drag: { x: number; y: number } | null = null;
  const onDown = (e: React.PointerEvent) => { drag = { x: e.clientX, y: e.clientY }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); };
  const onMove = (e: React.PointerEvent) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY }; onOrbit(-dx * 0.01, dy * 0.01); };
  const onUp = (e: React.PointerEvent) => { drag = null; (e.target as HTMLElement).releasePointerCapture?.(e.pointerId); };
  return (
    <div className="flex-1 min-w-0 flex flex-col relative">
      {/* badge + readout */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
        <span className="w-6 h-6 rounded-md grid place-items-center text-white text-[12px] font-bold shadow" style={{ background: accent }}>{tag}</span>
        {setup && (
          <span className={`font-mono text-[10px] px-2 py-1 rounded-md border ${isDarkMode ? 'bg-slate-900/70 border-white/10 text-slate-300' : 'bg-white/80 border-black/10 text-slate-600'}`}>
            cam Z {setup.camera.z.toFixed(2)} · {Math.round(setup.camera.fovH)}°
          </span>
        )}
        <button
          onClick={() => onSnapshot(slot)}
          title={`Capture the current live layout into ${tag}`}
          className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-2 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-500 shadow"
        >
          <Camera className="w-3 h-3" /> Snapshot
        </button>
      </div>

      {/* scene map or empty state — drag to orbit both setups in sync */}
      <div className="flex-1 min-h-0" style={setup ? { cursor: 'grab', touchAction: 'none' } : undefined}
        onPointerDown={setup ? onDown : undefined} onPointerMove={setup ? onMove : undefined} onPointerUp={setup ? onUp : undefined}>
        {setup ? (
          <SceneMap setup={setup} isDarkMode={isDarkMode} az={az} el={el} />
        ) : (
          <div className={`h-full grid place-items-center text-center px-6 ${sub}`}>
            <div>
              <Camera className="w-6 h-6 mx-auto mb-2 opacity-40" />
              <p className="text-[12px] font-medium">Setup {tag} is empty</p>
              <p className="text-[10px] mt-1">Arrange the workcell, then click <b>Snapshot</b> to capture it here.</p>
            </div>
          </div>
        )}
      </div>

      {/* metrics */}
      {m && (
        <div className={`grid grid-cols-4 gap-2 px-4 py-2.5 border-t ${isDarkMode ? 'border-white/10 bg-slate-900/40' : 'border-black/5 bg-black/[0.02]'}`}>
          <MiniMetric label="Cam height" value={String(m.heightCm)} unit="cm" isDarkMode={isDarkMode} />
          <MiniMetric label="Footprint" value={m.footprintCm2.toLocaleString()} unit="cm²" isDarkMode={isDarkMode} />
          <MiniMetric label="In frame" value={`${m.coveragePct}%`} pct good={m.coveragePct >= 75} isDarkMode={isDarkMode} />
          <MiniMetric label="Reachable" value={`${m.reachPct}%`} pct good={m.reachPct >= 75} isDarkMode={isDarkMode} />
        </div>
      )}
    </div>
  );
}

/**
 * CompareView — A/B side-by-side comparison of two whole WORKSTATION SETUPS (not just camera
 * footage). Each pane is an isometric scene map of a captured layout (table, arm, camera, post,
 * blocks, reach + footprint) with coverage/reach metrics; a verdict calls which setup frames /
 * reaches more of the task objects. "Snapshot" captures the current live layout into A or B.
 */
export function CompareView({ setupA, setupB, isDarkMode, sidebarOpen, onSnapshot, onExit, getOrbit, onOrbit }: Props) {
  const panel = isDarkMode ? 'bg-slate-900/90 border-white/10 text-slate-100' : 'bg-white/92 border-white/80 text-slate-800';
  // Mirror the live camera angle so both panes show the setups from the SAME orientation; updates
  // as the NavCube (or a pane drag) orbits — that's "move the cube, both setups move".
  const [view, setView] = useState({ az: Math.PI / 4, el: 0.62 });
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const o = getOrbit();
      if (o) {
        const az = Math.atan2(o.dx, o.dy);
        const el = Math.atan2(o.dz, Math.hypot(o.dx, o.dy));
        setView((p) => (Math.abs(p.az - az) > 1e-3 || Math.abs(p.el - el) > 1e-3 ? { az, el } : p));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getOrbit]);
  const mA = setupA ? metricsFor(setupA) : null;
  const mB = setupB ? metricsFor(setupB) : null;

  let verdict = 'Snapshot a layout into A and B to compare.';
  if (mA && mB) {
    const frame = mA.coveragePct === mB.coveragePct
      ? 'Equal frame coverage'
      : `Setup ${mA.coveragePct > mB.coveragePct ? 'A' : 'B'} frames ${Math.abs(mA.coveragePct - mB.coveragePct)}% more`;
    const reach = mA.reachPct === mB.reachPct
      ? 'equal reach'
      : `${mA.reachPct > mB.reachPct ? 'A' : 'B'} reaches ${Math.abs(mA.reachPct - mB.reachPct)}% more`;
    verdict = `${frame}; ${reach} of the task objects.`;
  }

  return (
    <div className={`absolute top-4 bottom-4 left-[4.75rem] ${sidebarOpen ? 'right-[22.5rem]' : 'right-4'} z-30 rounded-2xl glass-panel border shadow-2xl flex flex-col overflow-hidden ${panel}`}>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-black/10 shrink-0">
        <Columns2 className="w-4 h-4 text-indigo-500" />
        <span className="text-[11px] font-bold uppercase tracking-widest flex-1">Compare workstation setups · A / B</span>
        <button onClick={onExit} aria-label="Exit compare" className="opacity-60 hover:opacity-100"><X className="w-4 h-4" /></button>
      </div>

      <div className="flex-1 min-h-0 flex">
        <Pane tag="A" accent="oklch(0.655 0.155 262)" setup={setupA} slot="A" onSnapshot={onSnapshot} isDarkMode={isDarkMode} az={view.az} el={view.el} onOrbit={onOrbit} />
        <span className={`w-px self-stretch ${isDarkMode ? 'bg-white/10' : 'bg-black/10'}`} />
        <Pane tag="B" accent="oklch(0.70 0.13 292)" setup={setupB} slot="B" onSnapshot={onSnapshot} isDarkMode={isDarkMode} az={view.az} el={view.el} onOrbit={onOrbit} />
      </div>

      <div className={`flex items-center gap-2 px-4 py-2.5 border-t shrink-0 ${isDarkMode ? 'border-white/10 bg-slate-900/50' : 'border-black/5 bg-black/[0.02]'}`}>
        <Info className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
        <span className="text-[12px] font-medium">{verdict}</span>
      </div>
    </div>
  );
}
