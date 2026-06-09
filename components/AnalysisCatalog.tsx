/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { Gauge, Zap, Target, Timer, Scan, Eye, Layers, ShieldAlert, Hand, TrendingUp, Wand2 } from 'lucide-react';
import type { ComponentType } from 'react';

/** The 11 layout analyses from LAYOUT_ANALYSIS_GUIDE.md, plus which we run live today. */
type Status = 'live' | 'basic' | 'planned';
interface Analysis {
  n: number; title: string; purpose: string; metric: string; status: Status;
  icon: ComponentType<{ className?: string }>;
  figure?: FigureKey; // which live figure this maps to (status === 'live'/'basic')
}
export type FigureKey = 'reach' | 'coverage' | 'depth' | 'conflict' | 'layout' | 'manip';

export const ANALYSES: Analysis[] = [
  { n: 1, title: 'Manipulability / dexterity', purpose: 'How well-conditioned the arm is per cell — agile vs near-singular.', metric: 'Yoshikawa w + inverse condition number', status: 'live', icon: Gauge, figure: 'manip' },
  { n: 2, title: 'Effort / torque headroom', purpose: 'Where gravity alone pushes the STS3215 servos toward saturation.', metric: '1 − |τ_gravity| / τ_max (min over joints)', status: 'planned', icon: Zap },
  { n: 3, title: 'Reachability / capability', purpose: 'Which table cells the arm can actually grasp top-down.', metric: 'tool-down samples / cell', status: 'live', icon: Target, figure: 'reach' },
  { n: 4, title: 'Cycle time / throughput', purpose: 'Layout speed — pick → place → retreat time per cycle.', metric: 'trapezoidal joint time, slowest-joint synced', status: 'planned', icon: Timer },
  { n: 5, title: 'Resolution (GSD) map', purpose: 'How fine (mm/px) the camera resolves across the table.', metric: '2·z·tan(HFOV/2) / h_px', status: 'planned', icon: Scan },
  { n: 6, title: 'Camera coverage / occlusion', purpose: 'Which cells each camera sees, and the blind spots.', metric: 'covered / occluded fraction', status: 'live', icon: Eye, figure: 'coverage' },
  { n: 7, title: 'Shared workspace', purpose: 'Where arms overlap (handover) vs have exclusive lanes.', metric: 'union / intersection / exclusive', status: 'live', icon: Layers, figure: 'reach' },
  { n: 8, title: 'Inter-arm collision', purpose: 'Where arms share space (≥2 reach) and can collide.', metric: 'shared / collision-prone fraction', status: 'live', icon: ShieldAlert, figure: 'conflict' },
  { n: 9, title: 'Handoff feasibility', purpose: 'Where the two arms can actually exchange an object.', metric: 'bimanual reachable ∩ collision-free', status: 'planned', icon: Hand },
  { n: 10, title: '1-vs-2 arm throughput', purpose: 'Whether a second arm is worth the added cost.', metric: 'throughput gain vs collision cost', status: 'planned', icon: TrendingUp },
  { n: 11, title: 'Layout optimizer', purpose: 'Score every base position by worktop coverage — best mount wins.', metric: 'argmax worktop reached over base X/Y', status: 'live', icon: Wand2, figure: 'layout' },
];

const STATUS_META: Record<Status, { label: string; chip: string }> = {
  live: { label: 'Live', chip: 'bg-emerald-500/15 text-emerald-600' },
  basic: { label: 'Basic', chip: 'bg-amber-500/15 text-amber-600' },
  planned: { label: 'Planned', chip: 'bg-slate-500/15 text-slate-500' },
};

/**
 * AnalysisCatalog — a grid of the layout analyses available for this setup. Live/basic cards jump to
 * their figure below; planned cards describe what's coming. Sits at the top of the analysis dock.
 */
export function AnalysisCatalog({ isDarkMode, onSelect, scopeLabel, armsInScope }: { isDarkMode: boolean; onSelect: (figure: FigureKey) => void; scopeLabel: string; armsInScope: number }) {
  const cardBase = isDarkMode ? 'border-white/10 bg-white/5' : 'border-black/10 bg-black/[0.02]';
  const subtle = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  // Per-scope catalog: shared workspace (#7) + inter-arm collision (#8) need ≥2 arms IN THIS SCOPE,
  // so for a 1-arm workstation they fall back to "needs ≥2 arms" instead of LIVE.
  const needsTwo = (n: number) => (n === 7 || n === 8) && armsInScope < 2;
  const effStatus = (a: Analysis): Status => (needsTwo(a.n) ? 'planned' : a.status);
  const liveCount = ANALYSES.filter((a) => effStatus(a) !== 'planned').length;
  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className={`text-[10px] font-bold uppercase tracking-widest ${subtle}`}>Analyses · {scopeLabel}</span>
        <span className={`text-[9px] ${subtle}`}>{liveCount} of {ANALYSES.length} runnable</span>
      </div>
      <div className="grid grid-cols-1 min-[520px]:grid-cols-2 gap-2">
        {ANALYSES.map((a) => {
          const Icon = a.icon;
          const status = effStatus(a);
          const runnable = status !== 'planned' && a.figure;
          const sm = STATUS_META[status];
          return (
            <button key={a.n} type="button" disabled={!runnable} onClick={() => runnable && a.figure && onSelect(a.figure)}
              className={`text-left rounded-xl border p-2.5 transition-colors ${cardBase} ${runnable ? (isDarkMode ? 'hover:bg-white/10 cursor-pointer' : 'hover:bg-black/[0.05] cursor-pointer') : 'opacity-70 cursor-default'}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`shrink-0 w-5 h-5 rounded-md grid place-items-center text-[9px] font-bold ${isDarkMode ? 'bg-white/10 text-slate-300' : 'bg-black/[0.06] text-slate-500'}`}>{a.n}</span>
                <Icon className={`w-3.5 h-3.5 shrink-0 ${status === 'live' ? 'text-emerald-500' : status === 'basic' ? 'text-amber-500' : subtle}`} />
                <span className="text-[11px] font-semibold leading-tight flex-1 min-w-0 truncate">{a.title}</span>
                <span className={`shrink-0 text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${sm.chip}`}>{sm.label}</span>
              </div>
              <p className={`text-[10px] leading-snug ${subtle}`}>{needsTwo(a.n) ? 'Needs ≥2 arms in this workstation.' : a.purpose}</p>
              <p className={`mt-1 text-[9px] font-mono leading-tight ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>{a.metric}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
