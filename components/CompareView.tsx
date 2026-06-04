/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { Camera, Copy, X } from 'lucide-react';
import type { CameraIntrinsics } from '../types';

interface Props {
  cameraPos: { x: number; y: number; z: number } | null;
  intrinsics: CameraIntrinsics;
  baseResult: { covered: number; total: number } | null;
  taskCount: number;
  isDarkMode: boolean;
  onExit: () => void;
}

interface Setup { z: number; fovDeg: number }
interface Metrics { heightCm: number; fovDeg: number; footprintCm2: number; coverPct: number }

/** Footprint area + how much of the worktop the camera frames, from height + FOV (top-down model). */
function compute(s: Setup): Metrics {
  const reach = s.z * Math.tan((s.fovDeg * Math.PI / 180) / 2); // half-width on the floor
  const footprintCm2 = Math.round((reach * 2) * (reach * 1.8) * 1e4);
  // fraction of an 0.83×0.83 m worktop the footprint spans (capped at 100%).
  const coverPct = Math.min(100, Math.round(((reach * 2) * (reach * 1.8)) / (0.83 * 0.83) * 100));
  return { heightCm: Math.round(s.z * 100), fovDeg: s.fovDeg, footprintCm2, coverPct };
}

function Col({ tag, accent, m, isDarkMode }: { tag: string; accent: string; m: Metrics; isDarkMode: boolean }) {
  const sub = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const Row = ({ k, v, u }: { k: string; v: string; u: string }) => (
    <div className="flex items-baseline justify-between gap-2">
      <span className={`text-[10px] uppercase tracking-wide ${sub}`}>{k}</span>
      <span className="font-mono text-[13px] font-semibold tabular-nums">{v}<span className={`text-[9px] ml-0.5 ${sub}`}>{u}</span></span>
    </div>
  );
  return (
    <div className="flex-1 space-y-1.5">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-6 h-6 rounded-md grid place-items-center text-white text-[12px] font-bold" style={{ background: accent }}>{tag}</span>
        <span className="font-mono text-[10px] opacity-60">cam Z {(m.heightCm / 100).toFixed(2)} · {m.fovDeg}°</span>
      </div>
      <Row k="Cam height" v={String(m.heightCm)} u="cm" />
      <Row k="H-FOV" v={String(m.fovDeg)} u="°" />
      <Row k="Footprint" v={m.footprintCm2.toLocaleString()} u="cm²" />
      <Row k="Worktop framed" v={String(m.coverPct)} u="%" />
    </div>
  );
}

/**
 * CompareView — Compare A/B camera placements against the same workcell. A is a snapshot you take;
 * B is the live camera (move/aim it while in Compare mode and the numbers update). A verdict calls
 * which setup frames more of the worktop, so camera-placement decisions are quantified.
 */
export function CompareView({ cameraPos, intrinsics, baseResult, taskCount, isDarkMode, onExit }: Props) {
  const live: Setup = { z: cameraPos?.z ?? 0.85, fovDeg: intrinsics.hFovDeg };
  const [setupA, setSetupA] = useState<Setup>(live);
  const mA = compute(setupA);
  const mB = compute(live);

  const verdict = mA.coverPct === mB.coverPct
    ? 'Equal worktop coverage — decide on reach/angle.'
    : `Setup ${mA.coverPct > mB.coverPct ? 'A' : 'B'} frames ${Math.abs(mA.coverPct - mB.coverPct)}% more of the worktop.`;
  const reachNote = baseResult && baseResult.total > 0
    ? `Arm reaches ${baseResult.covered}/${baseResult.total} task points (camera-independent).`
    : `${taskCount} task points on the bench.`;

  const panel = isDarkMode ? 'bg-slate-900/90 border-white/10 text-slate-100' : 'bg-white/92 border-white/80 text-slate-800';

  return (
    <div className={`absolute top-20 left-[4.75rem] z-30 w-[26rem] max-w-[calc(100vw-7rem)] rounded-2xl glass-panel border shadow-2xl ${panel}`}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-black/5">
        <Camera className="w-4 h-4 text-indigo-500" />
        <span className="text-[11px] font-bold uppercase tracking-widest flex-1">Compare A / B · camera</span>
        <button onClick={onExit} aria-label="Exit compare" className="opacity-60 hover:opacity-100"><X className="w-4 h-4" /></button>
      </div>

      <div className="px-4 py-3">
        <p className={`text-[11px] leading-snug mb-3 ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
          <b>A</b> is a saved snapshot; <b>B</b> is the live camera — move/aim it (Edit the camera) and B updates.
        </p>
        <div className="flex gap-4">
          <Col tag="A" accent="oklch(0.72 0.13 262)" m={mA} isDarkMode={isDarkMode} />
          <span className="w-px self-stretch bg-current opacity-10" />
          <Col tag="B" accent="oklch(0.70 0.13 292)" m={mB} isDarkMode={isDarkMode} />
        </div>
      </div>

      <div className="px-4 py-2.5 border-t border-black/5 space-y-2">
        <div className="text-[12px] font-medium">{verdict}</div>
        <div className={`text-[10px] ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>{reachNote}</div>
        <button
          onClick={() => setSetupA(live)}
          className="w-full mt-1 flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wide py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-500"
        >
          <Copy className="w-3 h-3" /> Snapshot current as A
        </button>
      </div>
    </div>
  );
}
