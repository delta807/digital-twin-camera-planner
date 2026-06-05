/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

interface Props {
  armCount: number;
  baseResult: { covered: number; total: number } | null;
  isPaused: boolean;
  isDarkMode: boolean;
  /** Render the status row bare (no floating pill chrome) — used inside the sidebar header. */
  inline?: boolean;
}

function Stat({ label, value, good }: { label: string; value: string; good?: boolean }) {
  // Mid-lightness hues so the value reads on BOTH the white and dark panel variants.
  const color = good === undefined ? undefined : good ? 'oklch(0.58 0.15 150)' : 'oklch(0.64 0.15 70)';
  return (
    <div className="flex flex-col items-end leading-none">
      <span className="text-[8px] font-bold uppercase tracking-[0.08em] opacity-60 whitespace-nowrap">{label}</span>
      <span className="font-mono text-[12px] font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}

/**
 * MetricBar — the lab-instrument status readout: how many task points the arms reach, the arm
 * count, and the live MuJoCo sim state. A compact floating pill at the top of the viewport.
 */
export function MetricBar({ armCount, baseResult, isPaused, isDarkMode, inline }: Props) {
  const panel = isDarkMode ? 'bg-slate-900/85 border-white/10 text-slate-100' : 'bg-white/90 border-white/80 text-slate-700';
  const reachPct = baseResult && baseResult.total > 0 ? Math.round((baseResult.covered / baseResult.total) * 100) : null;

  const content = (
    <>
      <span className="text-[11px] font-semibold whitespace-nowrap">SO-101 Digital Twin</span>
      <span className="w-px h-5 bg-current opacity-15" />
      <Stat label="Arms" value={String(armCount)} />
      <span className="w-px h-5 bg-current opacity-15" />
      <Stat label="Reach" value={reachPct !== null ? `${reachPct}%` : '—'} good={reachPct !== null ? reachPct >= 75 : undefined} />
      <span className="w-px h-5 bg-current opacity-15" />
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${isPaused ? 'bg-amber-400' : 'animate-pulse-soft'}`} style={isPaused ? undefined : { background: 'oklch(0.74 0.16 150)' }} />
        <span className="font-mono text-[10px] opacity-70 whitespace-nowrap">MuJoCo · {isPaused ? 'paused' : '60 Hz'}</span>
      </div>
    </>
  );

  // Inline: bare row for the sidebar header (no absolute pill chrome).
  if (inline) {
    return <div className="flex items-center gap-3 min-w-0" style={{ ['--c-cam' as string]: 'oklch(0.82 0.14 78)' }}>{content}</div>;
  }

  return (
    <div
      className={`absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-4 rounded-full glass-panel border shadow-lg px-4 py-1.5 ${panel}`}
      style={{ ['--c-cam' as string]: 'oklch(0.82 0.14 78)' }}
    >
      {content}
    </div>
  );
}
