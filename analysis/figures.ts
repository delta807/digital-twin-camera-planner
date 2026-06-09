/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Matplotlib-style figures drawn to a <canvas> for the in-app analysis panel (and PNG export).
 * Self-contained 2D-canvas charting — axes, ticks, a vertical colorbar, title — so the figures read
 * like the matplotlib references without a Python round-trip. Each draw* fn renders one figure at the
 * canvas's pixel size; the panel sizes the canvas (incl. devicePixelRatio) before calling.
 */

// ── Colormaps (control points sampled from matplotlib; linear RGB interp) ──
type RGB = [number, number, number];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function rampSampler(stops: RGB[]) {
  return (t: number): RGB => {
    const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
    const i = Math.floor(x), f = x - i;
    const a = stops[i], b = stops[Math.min(stops.length - 1, i + 1)];
    return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
  };
}
export const MAGMA = rampSampler([
  [0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 253, 191],
]);
export const TURBO = rampSampler([
  [48, 18, 59], [70, 134, 251], [27, 229, 198], [122, 254, 86], [225, 220, 55], [253, 141, 39], [219, 39, 8], [122, 4, 3],
]);
export const VIRIDIS = rampSampler([
  [68, 1, 84], [72, 40, 120], [62, 73, 137], [49, 104, 142], [38, 130, 142], [31, 158, 137], [53, 183, 121], [110, 206, 88], [181, 222, 43], [253, 231, 37],
]);
// Stoplight ramp for "headroom" metrics: 0 = red (saturated/danger) → yellow → 1 = green (safe/idle).
export const RDYLGN = rampSampler([
  [165, 0, 38], [215, 48, 39], [244, 109, 67], [253, 174, 97], [254, 224, 139], [217, 239, 139], [166, 217, 106], [102, 189, 99], [26, 152, 80], [0, 104, 55],
]);
const css = (c: RGB) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;

// ── Shared frame: axes box + ticks + title + optional colorbar. Returns the data-area rect. ──
export interface Axes { x0: number; y0: number; x1: number; y1: number; xr: [number, number]; yr: [number, number]; }
interface FrameOpts {
  title?: string; xlabel?: string; ylabel?: string;
  xr: [number, number]; yr: [number, number];
  colorbar?: { label: string; vr: [number, number]; cmap: (t: number) => RGB };
  pad?: { l: number; r: number; t: number; b: number };
  clear?: boolean; // false → draw onto the existing canvas (multi-panel figures)
}
function frame(ctx: CanvasRenderingContext2D, W: number, H: number, o: FrameOpts): Axes {
  if (o.clear !== false) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); }
  const pad = o.pad ?? { l: 64, r: o.colorbar ? 118 : 28, t: o.title ? 56 : 24, b: 52 };
  const a: Axes = { x0: pad.l, y0: pad.t, x1: W - pad.r, y1: H - pad.b, xr: o.xr, yr: o.yr };
  ctx.strokeStyle = '#222'; ctx.fillStyle = '#222'; ctx.lineWidth = 1;
  ctx.font = '13px -apple-system, system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // title (supports a 2nd line after \n), placed in the top padding just above the axes box
  if (o.title) {
    ctx.font = '14px -apple-system, system-ui, sans-serif';
    const lines = o.title.split('\n');
    lines.forEach((line, i) => ctx.fillText(line, (a.x0 + a.x1) / 2, a.y0 - 12 - (lines.length - 1 - i) * 17));
    ctx.font = '13px -apple-system, system-ui, sans-serif';
  }
  ctx.strokeRect(a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0);
  // ticks (nice round steps over the range)
  const ticks = (lo: number, hi: number) => { const out: number[] = []; const step = 0.1; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-6; v += step) out.push(+v.toFixed(2)); return out; };
  for (const tx of ticks(o.xr[0], o.xr[1])) {
    const px = a.x0 + (tx - o.xr[0]) / (o.xr[1] - o.xr[0]) * (a.x1 - a.x0);
    ctx.beginPath(); ctx.moveTo(px, a.y1); ctx.lineTo(px, a.y1 + 5); ctx.stroke();
    ctx.fillText(tx.toFixed(1), px, a.y1 + 16);
  }
  ctx.textAlign = 'right';
  for (const ty of ticks(o.yr[0], o.yr[1])) {
    const py = a.y1 - (ty - o.yr[0]) / (o.yr[1] - o.yr[0]) * (a.y1 - a.y0); // +Y up
    ctx.beginPath(); ctx.moveTo(a.x0 - 5, py); ctx.lineTo(a.x0, py); ctx.stroke();
    ctx.fillText(ty.toFixed(1), a.x0 - 9, py);
  }
  // axis labels
  ctx.textAlign = 'center';
  if (o.xlabel) ctx.fillText(o.xlabel, (a.x0 + a.x1) / 2, H - 14);
  if (o.ylabel) { ctx.save(); ctx.translate(16, (a.y0 + a.y1) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(o.ylabel, 0, 0); ctx.restore(); }
  // colorbar
  if (o.colorbar) {
    const bx = a.x1 + 18, bw = 18, bh = a.y1 - a.y0;
    for (let i = 0; i < bh; i++) { ctx.fillStyle = css(o.colorbar.cmap(1 - i / bh)); ctx.fillRect(bx, a.y0 + i, bw, 1); }
    ctx.strokeRect(bx, a.y0, bw, bh);
    ctx.fillStyle = '#222'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const [lo, hi] = o.colorbar.vr; const n = 5;
    for (let k = 0; k <= n; k++) { const v = lo + (hi - lo) * k / n; const py = a.y1 - (bh * k / n); ctx.fillText(v.toFixed(2), bx + bw + 6, py); }
    ctx.save(); ctx.translate(bx + bw + 56, (a.y0 + a.y1) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(o.colorbar.label, 0, 0); ctx.restore();
  }
  return a;
}
const sx = (a: Axes, x: number) => a.x0 + (x - a.xr[0]) / (a.xr[1] - a.xr[0]) * (a.x1 - a.x0);
const sy = (a: Axes, y: number) => a.y1 - (y - a.yr[0]) / (a.yr[1] - a.yr[0]) * (a.y1 - a.y0);

// ── Figure 2: reachability heatmap ──
export interface ReachData {
  cells: Map<string, number>; cellsMax: Map<string, number>;
  baseX: number; baseY: number; cell: number;
  half: number;            // grid half-extent (m), axes = [-half, half]
  reachPct: number;        // graspable fraction of the table (0..1)
  center: [number, number]; // table-centre marker (world)
  arms?: number;           // >1 → combined multi-arm figure (cell value = # arms reaching, not samples)
  label?: string;          // per-workstation figure title (e.g. "Workstation 2")
}
export function drawReachability(canvas: HTMLCanvasElement, d: ReachData) {
  const ctx = canvas.getContext('2d')!; const W = canvas.width, H = canvas.height;
  // Single arm → cell value is tool-down sample density (1..4). Multi-arm → it's how many arms reach
  // the cell (1..N), so the colour shows where workspaces OVERLAP.
  const multi = (d.arms ?? 1) > 1;
  const vmax = multi ? Math.max(2, d.arms!) : 4;
  const a = frame(ctx, W, H, {
    title: d.label
      ? `${d.label} · ${d.arms} arm${d.arms === 1 ? '' : 's'}\nreach ${Math.round(d.reachPct * 100)}% of worktop`
      : multi
        ? `${d.arms} arms · combined reach\nreach ${Math.round(d.reachPct * 100)}% of table`
        : `SO-101 reachability\nreach ${Math.round(d.reachPct * 100)}% of table`,
    xlabel: 'X (m)', ylabel: 'Y (m)',
    // Axes centred on the figure's centre marker — origin for the primary/combined view, the station
    // origin for a per-workstation figure (B3).
    xr: [d.center[0] - d.half, d.center[0] + d.half], yr: [d.center[1] - d.half, d.center[1] + d.half],
    colorbar: { label: multi ? 'arms reaching / cell' : 'tool-down samples / cell', vr: [1, vmax], cmap: MAGMA },
  });
  const cpx = (a.x1 - a.x0) * (d.cell / (2 * d.half)) + 0.5; // one cell in px (+overlap to avoid seams)
  for (let x = d.center[0] - d.half; x <= d.center[0] + d.half + 1e-6; x += d.cell) {
    for (let y = d.center[1] - d.half; y <= d.center[1] + d.half + 1e-6; y += d.cell) {
      const di = Math.round((x - d.baseX) / d.cell), dj = Math.round((y - d.baseY) / d.cell);
      const key = di + ',' + dj;
      const reach = d.cellsMax.has(key), grasp = d.cells.get(key);
      if (!reach) continue;                              // unreachable → leave white
      ctx.fillStyle = grasp ? css(MAGMA((Math.min(vmax, grasp) - 1) / (vmax - 1))) : '#c8c8c8'; // gray = reachable, not graspable
      ctx.fillRect(sx(a, x) - cpx / 2, sy(a, y) - cpx / 2, cpx, cpx);
    }
  }
  // table-centre marker (cyan +)
  ctx.strokeStyle = '#06b6d4'; ctx.lineWidth = 3;
  const mx = sx(a, d.center[0]), my = sy(a, d.center[1]);
  ctx.beginPath(); ctx.moveTo(mx - 12, my); ctx.lineTo(mx + 12, my); ctx.moveTo(mx, my - 12); ctx.lineTo(mx, my + 12); ctx.stroke();
}

// ── #8 Inter-arm conflict map: cells reachable by ≥2 arms are where the arms share space and can
//    collide; single-arm cells are faint context. Reuses the multi-arm world reach grid (cells = #arms). ──
export function drawConflict(canvas: HTMLCanvasElement, d: ReachData) {
  const ctx = canvas.getContext('2d')!; const W = canvas.width, H = canvas.height;
  const reached = d.cells.size;
  let shared = 0; for (const v of d.cells.values()) if (v >= 2) shared++;
  const pct = reached ? Math.round((100 * shared) / reached) : 0;
  const vmax = Math.max(2, d.arms ?? 2);
  const a = frame(ctx, W, H, {
    title: `Inter-arm conflict zone\n${pct}% of reach is shared (collision-prone)`,
    xlabel: 'X (m)', ylabel: 'Y (m)',
    xr: [d.center[0] - d.half, d.center[0] + d.half], yr: [d.center[1] - d.half, d.center[1] + d.half],
    colorbar: { label: 'arms sharing the cell', vr: [2, vmax], cmap: TURBO },
  });
  const cpx = (a.x1 - a.x0) * (d.cell / (2 * d.half)) + 0.5;
  for (let x = d.center[0] - d.half; x <= d.center[0] + d.half + 1e-6; x += d.cell) {
    for (let y = d.center[1] - d.half; y <= d.center[1] + d.half + 1e-6; y += d.cell) {
      const n = d.cells.get(Math.round(x / d.cell) + ',' + Math.round(y / d.cell)) ?? 0;
      if (n === 0) continue;
      ctx.fillStyle = n >= 2 ? css(TURBO(vmax > 2 ? (n - 2) / (vmax - 2) : 1)) : '#ececec'; // ≥2 = hot conflict, 1 = faint reach context
      ctx.fillRect(sx(a, x) - cpx / 2, sy(a, y) - cpx / 2, cpx, cpx);
    }
  }
}

// ── #11 Layout-optimizer map: score every candidate arm-base position by how much of the worktop it
//    could reach, so the brightest cell = the best mount. star marks the optimum. ──
export interface LayoutData { scored: Array<{ x: number; y: number; cov: number }>; best: { x: number; y: number; cov: number }; maxCov: number; total: number; half: number; cell: number; center: [number, number]; curCov: number; cur: { x: number; y: number }; }
export function drawLayout(canvas: HTMLCanvasElement, d: LayoutData) {
  const ctx = canvas.getContext('2d')!; const W = canvas.width, H = canvas.height;
  const bestPct = d.total ? Math.round((100 * d.best.cov) / d.total) : 0;
  const curPct = d.total && d.curCov >= 0 ? Math.round((100 * d.curCov) / d.total) : -1;
  const gain = curPct >= 0 ? bestPct - curPct : 0;
  // Axes are the candidate-mount position RELATIVE TO THE WORKTOP CENTRE (the cyan +), in cm — so the
  // reader can act on it ("move the base 8 cm toward +X").
  const a = frame(ctx, W, H, {
    title: curPct >= 0
      ? `Best base placement · reaches ${bestPct}% of worktop\nyou're at ${curPct}% — moving the mount gains ${gain >= 0 ? '+' : ''}${gain}%`
      : `Best base placement\nbest mount reaches ${bestPct}% of the worktop`,
    xlabel: 'base X from worktop centre (m)', ylabel: 'base Y from worktop centre (m)',
    xr: [d.center[0] - d.half, d.center[0] + d.half], yr: [d.center[1] - d.half, d.center[1] + d.half],
    colorbar: { label: 'worktop reached (%)', vr: [0, 100], cmap: VIRIDIS },
  });
  const cpx = (a.x1 - a.x0) * (d.cell / (2 * d.half)) + 0.5;
  for (const s of d.scored) {
    ctx.fillStyle = css(VIRIDIS(d.total ? s.cov / d.total : 0));
    ctx.fillRect(sx(a, s.x) - cpx / 2, sy(a, s.y) - cpx / 2, cpx, cpx);
  }
  // worktop centre marker (cyan +) — the figure's origin / frame reference.
  ctx.strokeStyle = '#06b6d4'; ctx.lineWidth = 2;
  const ox = sx(a, d.center[0]), oy = sy(a, d.center[1]);
  ctx.beginPath(); ctx.moveTo(ox - 9, oy); ctx.lineTo(ox + 9, oy); ctx.moveTo(ox, oy - 9); ctx.lineTo(ox, oy + 9); ctx.stroke();
  // current mount = hollow white-ringed dot, with an arrow toward the recommended best.
  if (d.curCov >= 0) {
    const cx = sx(a, d.center[0] + d.cur.x), cy = sy(a, d.center[1] + d.cur.y);
    const bxp = sx(a, d.best.x), byp = sy(a, d.best.y);
    if (Math.hypot(bxp - cx, byp - cy) > 6) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(bxp, byp); ctx.stroke();
    }
    ctx.fillStyle = '#f8fafc'; ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  }
  // mark the best mount with a magenta star
  const bx = sx(a, d.best.x), by = sy(a, d.best.y);
  ctx.strokeStyle = '#ec4899'; ctx.fillStyle = '#ec4899'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let k = 0; k < 10; k++) { const r = k % 2 ? 4 : 9, ang = -Math.PI / 2 + (k * Math.PI) / 5; const px = bx + r * Math.cos(ang), py = by + r * Math.sin(ang); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
  ctx.closePath(); ctx.fill();
  // annotate the star with its offset from centre (cm) so the reader knows exactly where to mount.
  const dxc = Math.round((d.best.x - d.center[0]) * 100), dyc = Math.round((d.best.y - d.center[1]) * 100);
  ctx.fillStyle = '#0f172a'; ctx.font = 'bold 12px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  const label = (Math.abs(dxc) < 1 && Math.abs(dyc) < 1) ? 'at centre' : `${dxc >= 0 ? '+' : ''}${dxc}, ${dyc >= 0 ? '+' : ''}${dyc} cm`;
  const tx = Math.min(bx + 8, a.x1 - 70);
  ctx.fillText(label, tx, by - 8);
}

// ── #1 Manipulability / dexterity map: per top-down-graspable cell, the BEST inverse condition number
//    (σ_min/σ_max) of the TCP translational Jacobian — 1 (bright) = isotropic/agile, →0 (dark) =
//    near-singular (the arm is stretched out or folded, fine moves cost large joint motion). ──
export interface ManipData { cells: Map<string, number>; cell: number; half: number; center: [number, number]; wMax: number; meanDex: number; arms: number; label?: string; }
export function drawManipulability(canvas: HTMLCanvasElement, d: ManipData) {
  const ctx = canvas.getContext('2d')!; const W = canvas.width, H = canvas.height;
  const meanPct = Math.round(d.meanDex * 100);
  const a = frame(ctx, W, H, {
    title: (d.label ? `${d.label} · ` : '') + `Manipulability · dexterity\nmean isotropy ${meanPct}%  ·  peak w ${d.wMax.toFixed(3)}`,
    xlabel: 'X (m)', ylabel: 'Y (m)',
    xr: [d.center[0] - d.half, d.center[0] + d.half], yr: [d.center[1] - d.half, d.center[1] + d.half],
    colorbar: { label: 'dexterity  σ_min / σ_max', vr: [0, 1], cmap: VIRIDIS },
  });
  const cpx = (a.x1 - a.x0) * (d.cell / (2 * d.half)) + 0.5;
  for (let x = d.center[0] - d.half; x <= d.center[0] + d.half + 1e-6; x += d.cell) {
    for (let y = d.center[1] - d.half; y <= d.center[1] + d.half + 1e-6; y += d.cell) {
      const v = d.cells.get(Math.round(x / d.cell) + ',' + Math.round(y / d.cell));
      if (v === undefined) continue;                    // not graspable top-down → leave white
      ctx.fillStyle = css(VIRIDIS(Math.max(0, Math.min(1, v))));
      ctx.fillRect(sx(a, x) - cpx / 2, sy(a, y) - cpx / 2, cpx, cpx);
    }
  }
  // table-centre marker (cyan +)
  ctx.strokeStyle = '#06b6d4'; ctx.lineWidth = 3;
  const mx = sx(a, d.center[0]), my = sy(a, d.center[1]);
  ctx.beginPath(); ctx.moveTo(mx - 12, my); ctx.lineTo(mx + 12, my); ctx.moveTo(mx, my - 12); ctx.lineTo(mx, my + 12); ctx.stroke();
}

// ── #2 Effort / torque headroom map: per top-down-graspable cell, the BEST headroom (1 − |gravity
//    torque| / stall) any reaching config leaves at the most-stressed joint. Green = idle/safe,
//    red = the servo is fighting gravity near saturation (it'll sag / overheat there). ──
export interface EffortData { cells: Map<string, number>; cell: number; half: number; center: [number, number]; minHeadroom: number; meanHeadroom: number; tauMax: number; arms: number; label?: string; }
export function drawEffort(canvas: HTMLCanvasElement, d: EffortData) {
  const ctx = canvas.getContext('2d')!; const W = canvas.width, H = canvas.height;
  const minPct = Math.round(d.minHeadroom * 100), meanPct = Math.round(d.meanHeadroom * 100);
  const a = frame(ctx, W, H, {
    title: (d.label ? `${d.label} · ` : '') + `Effort · gravity-torque headroom\nmin ${minPct}%  ·  mean ${meanPct}%  ·  τ_max ${d.tauMax.toFixed(2)} N·m`,
    xlabel: 'X (m)', ylabel: 'Y (m)',
    xr: [d.center[0] - d.half, d.center[0] + d.half], yr: [d.center[1] - d.half, d.center[1] + d.half],
    colorbar: { label: 'torque headroom  (1 = idle, 0 = saturated)', vr: [0, 1], cmap: RDYLGN },
  });
  const cpx = (a.x1 - a.x0) * (d.cell / (2 * d.half)) + 0.5;
  for (let x = d.center[0] - d.half; x <= d.center[0] + d.half + 1e-6; x += d.cell) {
    for (let y = d.center[1] - d.half; y <= d.center[1] + d.half + 1e-6; y += d.cell) {
      const v = d.cells.get(Math.round(x / d.cell) + ',' + Math.round(y / d.cell));
      if (v === undefined) continue;                    // not graspable top-down → leave white
      ctx.fillStyle = css(RDYLGN(Math.max(0, Math.min(1, v))));
      ctx.fillRect(sx(a, x) - cpx / 2, sy(a, y) - cpx / 2, cpx, cpx);
    }
  }
  // table-centre marker (slate +, so it reads over the green/red map)
  ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 3;
  const mx = sx(a, d.center[0]), my = sy(a, d.center[1]);
  ctx.beginPath(); ctx.moveTo(mx - 12, my); ctx.lineTo(mx + 12, my); ctx.moveTo(mx, my - 12); ctx.lineTo(mx, my + 12); ctx.stroke();
}

// ── Figure 1: overhead depth map (normalized, with sensor-noise speckle) ──
export interface DepthData { depth: Float32Array; w: number; h: number; }
export function drawDepth(canvas: HTMLCanvasElement, d: DepthData) {
  const ctx = canvas.getContext('2d')!; const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  const pad = { l: 12, r: 116, t: 30, b: 12 };
  const x0 = pad.l, y0 = pad.t, x1 = W - pad.r, y1 = H - pad.b;
  // Build the depth image at native res, then blit scaled into the frame.
  const off = document.createElement('canvas'); off.width = d.w; off.height = d.h;
  const octx = off.getContext('2d')!; const img = octx.createImageData(d.w, d.h);
  for (let i = 0; i < d.depth.length; i++) {
    const v = d.depth[i]; const o = i * 4;
    if (Number.isNaN(v)) { img.data[o] = 255; img.data[o + 1] = 255; img.data[o + 2] = 255; img.data[o + 3] = 255; continue; }
    const c = TURBO(v); img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  // Sensor-noise speckle: scattered dark-red dropout pixels (like a real depth sensor).
  octx.fillStyle = 'rgba(130,20,20,0.85)';
  for (let k = 0; k < d.w * d.h * 0.012; k++) octx.fillRect((Math.random() * d.w) | 0, (Math.random() * d.h) | 0, 1, 1);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, x0, y0, x1 - x0, y1 - y0);
  ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.fillStyle = '#222'; ctx.font = '15px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('Camera depth · height above table (overhead)', (x0 + x1) / 2, 14);
  // colorbar (turbo, 0..1 normalized)
  const bx = x1 + 18, bw = 18, bh = y1 - y0;
  for (let i = 0; i < bh; i++) { ctx.fillStyle = css(TURBO(1 - i / bh)); ctx.fillRect(bx, y0 + i, bw, 1); }
  ctx.strokeStyle = '#222'; ctx.strokeRect(bx, y0, bw, bh);
  ctx.fillStyle = '#222'; ctx.textAlign = 'left'; const n = 5;
  for (let k = 0; k <= n; k++) ctx.fillText((k / n * 12).toFixed(0), bx + bw + 6, y1 - bh * k / n); // 0..1 → 0..12 cm band
  ctx.save(); ctx.translate(bx + bw + 56, (y0 + y1) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('height above table (cm)', 0, 0); ctx.restore();
}

// ── Figure 3: camera coverage — overhead / wrist / combined binary maps ──
export interface CoverageData { overhead: boolean[]; wrist: boolean[]; combined: boolean[]; n: number; half: number; }
export function drawCoverage(canvas: HTMLCanvasElement, d: CoverageData) {
  const ctx = canvas.getContext('2d')!; const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#222'; ctx.font = '15px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('Camera coverage', W / 2, 13);
  const yes = css(VIRIDIS(0.95)), no = css(VIRIDIS(0.0)); // yellow = covered, purple = not
  const panels: Array<[string, boolean[]]> = [['overhead', d.overhead], ['wrist', d.wrist], ['combined', d.combined]];
  const gap = 16, pw = (W - gap * 4) / 3;
  panels.forEach(([name, grid], k) => {
    const pct = Math.round(100 * grid.filter(Boolean).length / grid.length);
    const a = frame(ctx, W, H, { // reuse the axes frame, but only over this panel's sub-rect via pad
      title: `${name}\n${pct}% covered`, xlabel: 'X (m)', ylabel: k === 0 ? 'Y (m)' : '',
      xr: [-d.half, d.half], yr: [-d.half, d.half], clear: false,
      pad: { l: gap + k * (pw + gap) + (k === 0 ? 40 : 22), r: W - (gap + k * (pw + gap) + pw), t: 56, b: 44 },
    });
    const cw = (a.x1 - a.x0) / d.n + 0.5, ch = (a.y1 - a.y0) / d.n + 0.5;
    for (let j = 0; j < d.n; j++) for (let i = 0; i < d.n; i++) {
      ctx.fillStyle = grid[j * d.n + i] ? yes : no;
      const px = a.x0 + (i / d.n) * (a.x1 - a.x0), py = a.y1 - ((j + 1) / d.n) * (a.y1 - a.y0); // +Y up
      ctx.fillRect(px, py, cw, ch);
    }
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.strokeRect(a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0);
  });
}
