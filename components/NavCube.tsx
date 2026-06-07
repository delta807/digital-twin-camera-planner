/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useRef } from 'react';

export type ViewPreset = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'iso';

interface Props {
  onView: (p: ViewPreset) => void;
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
 * NavCube — an interactive CAD-style orientation cube (à la Fusion/SolidWorks). It continuously
 * tracks the scene camera (so it always shows the current orientation) and its six faces snap the
 * view. Neither OrcaSlicer nor BambuStudio actually ship a view-cube widget (both are keyboard +
 * Camera::select_view only), so this is an original component using their Z-up orientation set.
 *
 * Sync math (turntable): with az = atan2(dx,dy), el = atan2(dz, hypot(dx,dy)) of the
 * target→camera vector, the cube transform is rotateX(-el)·rotateY(az-180) — derived + verified so
 * front/top/right faces front the viewer at the matching views.
 */
const FACES: Array<{ view: Exclude<ViewPreset, 'iso'>; label: string; t: string }> = [
  { view: 'front',  label: 'FRONT',  t: 'translateZ(var(--h))' },
  { view: 'back',   label: 'BACK',   t: 'rotateY(180deg) translateZ(var(--h))' },
  { view: 'right',  label: 'RIGHT',  t: 'rotateY(90deg) translateZ(var(--h))' },
  { view: 'left',   label: 'LEFT',   t: 'rotateY(-90deg) translateZ(var(--h))' },
  { view: 'top',    label: 'TOP',    t: 'rotateX(90deg) translateZ(var(--h))' },
  { view: 'bottom', label: 'BOT',    t: 'rotateX(-90deg) translateZ(var(--h))' },
];

export function NavCube({ onView, isDarkMode, getOrbit, onDragRotate, dockOpen, sidebarOpen }: Props) {
  const cubeRef = useRef<HTMLDivElement>(null);
  // Drag-to-orbit: track the pointer; if it moves, rotate the view and suppress the face click.
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const onDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return; // tolerance so a click still snaps a face
    d.moved = true; d.x = e.clientX; d.y = e.clientY;
    onDragRotate?.(-dx * 0.01, dy * 0.01); // drag to "turn the cube" — horizontal = azimuth, vertical = elevation
  };
  const onUp = (e: React.PointerEvent) => { (e.target as HTMLElement).releasePointerCapture?.(e.pointerId); };
  const faceClick = (v: ViewPreset) => { if (drag.current?.moved) { drag.current = null; return; } drag.current = null; onView(v); };

  // Per-frame: rotate the cube to mirror the camera's azimuth/elevation.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const o = getOrbit();
      const cube = cubeRef.current;
      if (o && cube) {
        const az = Math.atan2(o.dx, o.dy) * 180 / Math.PI;
        const el = Math.atan2(o.dz, Math.hypot(o.dx, o.dy)) * 180 / Math.PI;
        cube.style.transform = `rotateX(${-el}deg) rotateY(${az - 180}deg)`;
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

  // Open panel → tuck just left of it; closed → top-right corner beside the drawer toggle.
  const place = sidebarOpen ? 'top-6 right-4 min-[660px]:right-[22.5rem]' : 'top-3 right-16';
  return (
    <div className={`absolute ${place} z-30 flex flex-col items-center gap-1.5 rounded-xl glass-panel border shadow-lg p-2 ${panel}`}>
      <div
        style={{ width: 64, height: 64, perspective: 260, ['--h' as string]: '27px', cursor: 'grab', touchAction: 'none' }}
        className="relative"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        title="Drag to orbit · click a face to snap"
      >
        <div ref={cubeRef} style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d', transition: 'transform 80ms linear', pointerEvents: 'none' }}>
          {FACES.map((f) => (
            <button
              key={f.view}
              onClick={() => faceClick(f.view)}
              title={f.label}
              className="nav-face"
              style={{
                position: 'absolute', width: 54, height: 54, left: 5, top: 5,
                transform: f.t, backfaceVisibility: 'hidden', pointerEvents: 'auto',
                background: faceBg, color: faceText, border: `1px solid ${faceBorder}`,
                fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                borderRadius: 3,
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <button
        onClick={() => onView('iso')}
        title="Reset to isometric view"
        className={`flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-300 hover:bg-white/10' : 'text-slate-600 hover:bg-black/5'}`}
      >
        {/* OrcaSlicer-style crosshair "recenter" glyph */}
        <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden>
          <circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <line x1="8" y1="0.5" x2="8" y2="3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="8" y1="13" x2="8" y2="15.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="0.5" y1="8" x2="3" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="13" y1="8" x2="15.5" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        Iso
      </button>
    </div>
  );
}
