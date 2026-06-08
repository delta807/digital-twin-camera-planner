/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useMemo, useRef } from 'react';

export type ViewPreset = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'iso';

interface Props {
  onView: (p: ViewPreset) => void;
  /** Snap toward an arbitrary world direction (Z-up) — cube corners (iso) + edges (45° two-face). */
  onViewDir: (dir: [number, number, number]) => void;
  isDarkMode: boolean;
  /** Live camera orientation: the vector from the orbit target to the camera (world, Z-up). The
   *  cube reads this each frame and rotates to mirror the 3D view — a real CAD view-cube. */
  getOrbit: () => { dx: number; dy: number; dz: number } | null;
  /** Drag the cube to orbit the view by (dAz, dEl) radians. */
  onDragRotate?: (dAz: number, dEl: number) => void;
  /** Sit right of the dock when it's open; tuck against the rail when it's closed (no dead gap). */
  dockOpen: boolean;
  /** When the right panel is open, sit just left of it; when closed, sit in the top-right corner
   *  beside the right-panel drawer toggle. */
  sidebarOpen: boolean;
}

/**
 * NavCube — an interactive CAD-style orientation cube (à la Fusion/SolidWorks/FreeCAD). It tracks
 * the scene camera continuously (always showing the current orientation); its six FACES snap the
 * six orthographic views, its eight CORNERS snap the matching isometric, and its twelve EDGES snap
 * the 45° two-face view. Drag the cube to orbit.
 *
 * Neither OrcaSlicer nor BambuStudio actually ship a view-cube widget (both are keyboard +
 * Camera::select_view only), so this is original — but it uses Bambu's Z-up view set, and the
 * corner/edge directions are the summed face normals (front+top+right = (1,-1,1), etc.).
 *
 * Geometry: each face/edge/corner has a FIXED world direction. We place its hit-zone in cube-local
 * space via the map M(world→local) = (x, -z, -y) (derived from the face CSS transforms), so the
 * per-frame sync rotation carries it to the correct screen position. Only camera-facing zones are
 * click-enabled (dot(dir, camera) > 0), so you never click a hidden back corner.
 *
 * Sync math (turntable): with az = atan2(dx,dy), el = atan2(dz, hypot(dx,dy)) of the target→camera
 * vector, the cube transform is rotateX(-el)·rotateY(az-180).
 */
const FACES: Array<{ view: Exclude<ViewPreset, 'iso'>; label: string; t: string; dir: [number, number, number] }> = [
  { view: 'front',  label: 'FRONT',  t: 'translateZ(var(--h))',                 dir: [0, -1, 0] },
  { view: 'back',   label: 'BACK',   t: 'rotateY(180deg) translateZ(var(--h))', dir: [0, 1, 0] },
  { view: 'right',  label: 'RIGHT',  t: 'rotateY(90deg) translateZ(var(--h))',  dir: [1, 0, 0] },
  { view: 'left',   label: 'LEFT',   t: 'rotateY(-90deg) translateZ(var(--h))', dir: [-1, 0, 0] },
  { view: 'top',    label: 'TOP',    t: 'rotateX(90deg) translateZ(var(--h))',  dir: [0, 0, 1] },
  { view: 'bottom', label: 'BOT',    t: 'rotateX(-90deg) translateZ(var(--h))', dir: [0, 0, -1] },
];

const HALF = 27;       // cube half-extent (matches --h); face/edge/corner zones sit on the surface
/** world (x,y,z) → cube-local CSS (x,y,z), from the face transforms (world -Y=front=+Zlocal, +Z=top=-Ylocal). */
const toLocal = (d: [number, number, number]): [number, number, number] => [d[0], -d[2], -d[1]];

export function NavCube({ onView, onViewDir, isDarkMode, getOrbit, onDragRotate, dockOpen, sidebarOpen }: Props) {
  const cubeRef = useRef<HTMLDivElement>(null);
  // Camera-facing zones (corners/edges/face transform) updated each frame; refs keep DOM writes cheap.
  const zoneRefs = useRef<Array<{ el: HTMLButtonElement | null; dir: [number, number, number] }>>([]);

  // 8 corners (±1,±1,±1) → iso; 12 edges (one axis 0) → 45° two-face.
  const { corners, edges } = useMemo(() => {
    const corners: Array<[number, number, number]> = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) corners.push([x, y, z]);
    const edges: Array<[number, number, number]> = [];
    const signs = [-1, 1];
    for (const a of signs) for (const b of signs) {
      edges.push([0, a, b]); edges.push([a, 0, b]); edges.push([a, b, 0]);
    }
    return { corners, edges };
  }, []);

  // Drag-to-orbit: track the pointer; if it moves, rotate the view and suppress the click.
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const onDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return; // tolerance so a click still snaps
    d.moved = true; d.x = e.clientX; d.y = e.clientY;
    onDragRotate?.(-dx * 0.01, dy * 0.01); // horizontal = azimuth, vertical = elevation
  };
  const onUp = (e: React.PointerEvent) => { (e.target as HTMLElement).releasePointerCapture?.(e.pointerId); };
  const clickGuard = (fn: () => void) => { if (drag.current?.moved) { drag.current = null; return; } drag.current = null; fn(); };

  // Per-frame: rotate the cube to mirror the camera, and enable only camera-facing hit-zones.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const o = getOrbit();
      const cube = cubeRef.current;
      if (o && cube) {
        const az = Math.atan2(o.dx, o.dy) * 180 / Math.PI;
        const el = Math.atan2(o.dz, Math.hypot(o.dx, o.dy)) * 180 / Math.PI;
        cube.style.transform = `rotateX(${-el}deg) rotateY(${az - 180}deg)`;
        const len = Math.hypot(o.dx, o.dy, o.dz) || 1;
        const cx = o.dx / len, cy = o.dy / len, cz = o.dz / len;
        for (const z of zoneRefs.current) {
          if (!z.el) continue;
          const dl = Math.hypot(...z.dir) || 1;
          const facing = (z.dir[0] * cx + z.dir[1] * cy + z.dir[2] * cz) / dl;
          z.el.style.pointerEvents = facing > 0.15 ? 'auto' : 'none';
          z.el.style.opacity = facing > 0.15 ? '1' : '0';
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getOrbit]);

  const faceBg = isDarkMode ? 'rgba(30,34,42,0.92)' : 'rgba(255,255,255,0.92)';
  const faceText = isDarkMode ? '#cbd5e1' : '#475569';
  const faceBorder = isDarkMode ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.14)';
  const panel = isDarkMode ? 'bg-slate-900/80 border-white/10' : 'bg-white/80 border-white/80';

  // Reset the per-frame zone registry on each render so refs match the current element set.
  zoneRefs.current = [];
  const registerZone = (dir: [number, number, number]) => (el: HTMLButtonElement | null) => { zoneRefs.current.push({ el, dir }); };
  const zoneTransform = (dir: [number, number, number]) => {
    const [lx, ly, lz] = toLocal(dir);
    return `translate3d(${lx * HALF}px, ${ly * HALF}px, ${lz * HALF}px)`;
  };

  // Open panel → tuck just left of it; closed → top-right corner beside the drawer toggle.
  const place = sidebarOpen ? 'top-6 right-4 min-[660px]:right-[22.5rem]' : 'top-3 right-16';
  return (
    <div className={`absolute ${place} z-30 flex flex-col items-center gap-1.5 rounded-xl glass-panel border shadow-lg p-2 ${panel}`}>
      <div
        style={{ width: 64, height: 64, perspective: 260, ['--h' as string]: `${HALF}px`, cursor: 'grab', touchAction: 'none' }}
        className="relative"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        title="Drag to orbit · click a face / edge / corner to snap"
      >
        <div ref={cubeRef} style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d', transition: 'transform 80ms linear', transformOrigin: '32px 32px' }}>
          {/* Faces → orthographic views. */}
          {FACES.map((f) => (
            <button
              key={f.view}
              onClick={() => clickGuard(() => onView(f.view))}
              title={f.label}
              className="nav-face"
              style={{
                position: 'absolute', width: 54, height: 54, left: 5, top: 5,
                transform: f.t, backfaceVisibility: 'hidden',
                background: faceBg, color: faceText, border: `1px solid ${faceBorder}`,
                fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                borderRadius: 3,
              }}
            >
              {f.label}
            </button>
          ))}
          {/* Edges → 45° two-face views. */}
          {edges.map((d, i) => (
            <button
              key={`e${i}`}
              ref={registerZone(d)}
              onClick={() => clickGuard(() => onViewDir(d))}
              title="45° view"
              className="nav-zone"
              style={{
                position: 'absolute', width: 18, height: 18, left: 23, top: 23,
                transform: zoneTransform(d), cursor: 'pointer', border: 'none', padding: 0,
              }}
            />
          ))}
          {/* Corners → isometric views. */}
          {corners.map((d, i) => (
            <button
              key={`c${i}`}
              ref={registerZone(d)}
              onClick={() => clickGuard(() => onViewDir(d))}
              title="Isometric"
              className="nav-zone"
              style={{
                position: 'absolute', width: 16, height: 16, left: 24, top: 24,
                transform: zoneTransform(d), cursor: 'pointer', border: 'none', padding: 0,
              }}
            />
          ))}
        </div>
      </div>
      <button
        onClick={() => onView('iso')}
        title="Home (reset to isometric view)"
        className={`flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-300 hover:bg-white/10' : 'text-slate-600 hover:bg-black/5'}`}
      >
        {/* Home glyph */}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 9.5 12 3l9 6.5" />
          <path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10" />
          <path d="M9 21v-6h6v6" />
        </svg>
        Home
      </button>
    </div>
  );
}
