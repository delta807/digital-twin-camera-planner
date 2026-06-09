/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /autoresearch — serialize a campaign's trials to results.json / pareto.csv / top10.md. Pure string
 * builders (the runner writes them to disk). See tasks/autoresearch_scoreconfig.md §9.
 */
import type { Trial } from './pareto';

const cfgSummary = (t: Trial) => {
  const c = t.cfg;
  const a = c.armBases.map((b) => `(${b.x.toFixed(2)},${b.y.toFixed(2)},${(b.yaw * 180 / Math.PI).toFixed(0)}°)`).join(' ');
  return `${c.shapeSides}-gon r${c.size.toFixed(2)} · ${c.arms}arm ${a} · cam(${c.camera.x.toFixed(2)},${c.camera.y.toFixed(2)},${c.camera.z.toFixed(2)},${c.camera.tilt.toFixed(0)}°)`;
};

export function resultsJson(trials: Trial[]): string {
  return JSON.stringify(trials.map((t) => ({ cfg: t.cfg, result: t.result })), null, 2);
}

export function paretoCsv(front: Trial[]): string {
  const head = 'idx,shapeSides,size,arms,taskGrasp,perception,collaboration,torqueStrain,cameraZ';
  const rows = front.map((t, i) => {
    const o = t.result.objectives;
    return [i, t.cfg.shapeSides, t.cfg.size.toFixed(3), t.cfg.arms,
      o.taskGrasp.toFixed(4), o.perception.toFixed(4), o.collaboration == null ? '' : o.collaboration.toFixed(4),
      t.result.penalty.torqueStrain.toFixed(4), t.cfg.camera.z.toFixed(3)].join(',');
  });
  return [head, ...rows].join('\n');
}

/** Top-N by the balanced (min-normalized) score, with the recommended knee called out by the caller. */
export function topMarkdown(trials: Trial[], knee: Trial | null, n = 10): string {
  const feasible = trials.filter((t) => t.result.feasible);
  const scoreOf = (t: Trial) => {
    const o = t.result.objectives;
    return Math.min(o.taskGrasp, o.perception, o.collaboration ?? 1);
  };
  const top = [...feasible].sort((a, b) => scoreOf(b) - scoreOf(a)).slice(0, n);
  const lines = [
    `# /autoresearch — top ${Math.min(n, top.length)} of ${trials.length} trials (${feasible.length} feasible)`,
    '',
    knee ? `**Recommended (Pareto knee):** ${cfgSummary(knee)}` : '_No feasible trial._',
    '',
    '| # | config | taskGrasp | perception | collab | torque | feasible |',
    '|---|---|---|---|---|---|---|',
    ...top.map((t, i) => {
      const o = t.result.objectives;
      return `| ${i + 1} | ${cfgSummary(t)} | ${o.taskGrasp.toFixed(3)} | ${o.perception.toFixed(3)} | ${o.collaboration == null ? '—' : o.collaboration.toFixed(3)} | ${t.result.penalty.torqueStrain.toFixed(3)} | ✓ |`;
    }),
    '',
    '## Infeasible (top failure reasons)',
    ...(() => {
      const counts = new Map<string, number>();
      for (const t of trials) for (const f of t.result.failed) counts.set(f, (counts.get(f) ?? 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([f, c]) => `- ${c}× ${f}`);
    })(),
  ];
  return lines.join('\n');
}
