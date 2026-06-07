/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SceneMap — a self-contained isometric SVG schematic of a workstation setup.
 * Ported from the design's `SceneSVG`. World: X right, Y forward (depth), Z up;
 * origin = table centre. Pure SVG, 2:1 isometric projection, non-interactive.
 * Used by the A/B compare view to render two setups side by side.
 */
import type { JSX } from 'react';
import type { WorkcellConfig } from '../types';

export interface CompareSetup {
  table: { length: number; width: number; railH: number }; // metres; railH ~ 0.024
  post: { x: number; y: number; h: number }; // world m
  camera: { x: number; y: number; z: number; fovH: number }; // fovH = horizontal FOV degrees
  arm: { x: number; y: number; yawDeg: number }; // base pose; yaw in DEGREES
  blocks: Array<{ id: string; x: number; y: number; color: 'orange' | 'teal' }>;
  /** Rich payload for the WebGL compare panes (real meshes). Falls back to the SVG schematic if absent. */
  scene3d?: {
    workcell: WorkcellConfig;
    arms: Array<{ x: number; y: number; yaw: number; joints?: number[] }>;
    blocks: Array<{ x: number; y: number; z: number }>;
  };
}

type P = [number, number];
/** A metre→svg-px projector. Rotatable: built from camera azimuth/elevation so the compare panes
 *  can orbit in sync with the NavCube (z-up world; az=atan2(x,y), el = elevation). */
export type Proj = (x: number, y: number, z?: number) => P;

// --- categorical OKLCH scheme (inline; not CSS vars since this renders standalone) ---
const CAM = 'oklch(0.82 0.14 78)';
const REACH = 'oklch(0.70 0.10 292)';
const PRECISION = 'oklch(0.83 0.13 188)';
const OBJECT = 'oklch(0.78 0.10 35)';
const TEAL = 'oklch(0.83 0.13 188)';
const TABLE_FILL = 'oklch(0.65 0.155 262 / 0.12)';
const RAIL = 'oklch(0.32 0.012 250)';
const METAL = 'oklch(0.80 0.006 250)';
const METAL_D = 'oklch(0.64 0.006 250)';

// --- rotatable orthographic projection (metre -> svg px) ---
const K = 360;
const CX = 500;
const CY = 320;
/** Build a projector for a given camera azimuth + elevation (radians). Default ≈ the old 2:1 iso. */
function makeProj(az: number, el: number): Proj {
  const ca = Math.cos(az), sa = Math.sin(az), se = Math.sin(el), ce = Math.cos(el);
  return (x: number, y: number, z = 0): P => [
    CX + (x * ca - y * sa) * K,
    CY + ((x * sa + y * ca) * se - z * ce) * K,
  ];
}
const pts = (arr: P[]) => arr.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
const line = (a: P, b: P) => ({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] });

/** flat ring on a z-plane (reach envelope) */
function isoRing(iso: Proj, cx: number, cy: number, r: number, z: number, seg = 72): string {
  let d = '';
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const [sx, sy] = iso(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z);
    d += (i === 0 ? 'M' : 'L') + sx.toFixed(1) + ' ' + sy.toFixed(1);
  }
  return d + 'Z';
}
/** filled sector wedge (precision fan) */
function isoSector(iso: Proj, cx: number, cy: number, r: number, a0: number, a1: number, z: number, seg = 48): string {
  const [ox, oy] = iso(cx, cy, z);
  let d = 'M' + ox.toFixed(1) + ' ' + oy.toFixed(1);
  for (let i = 0; i <= seg; i++) {
    const a = a0 + (a1 - a0) * (i / seg);
    const [sx, sy] = iso(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z);
    d += 'L' + sx.toFixed(1) + ' ' + sy.toFixed(1);
  }
  return d + 'Z';
}

/** little box drawn as 3 visible iso faces (left/right/top, with brightness shading) */
function Cube({ iso, x, y, z, w, d, h, color, opacity = 1 }: {
  iso: Proj; x: number; y: number; z: number; w: number; d: number; h: number; color: string; opacity?: number;
}) {
  const x0 = x - w / 2, x1 = x + w / 2, y0 = y - d / 2, y1 = y + d / 2, z1 = z + h;
  const top = [iso(x0, y0, z1), iso(x1, y0, z1), iso(x1, y1, z1), iso(x0, y1, z1)];
  const left = [iso(x0, y1, z), iso(x1, y1, z), iso(x1, y1, z1), iso(x0, y1, z1)];
  const right = [iso(x1, y0, z), iso(x1, y1, z), iso(x1, y1, z1), iso(x1, y0, z1)];
  return (
    <g opacity={opacity}>
      <polygon points={pts(left)} fill={color} style={{ filter: 'brightness(0.72)' }} />
      <polygon points={pts(right)} fill={color} style={{ filter: 'brightness(0.9)' }} />
      <polygon points={pts(top)} fill={color} style={{ filter: 'brightness(1.14)' }} />
    </g>
  );
}

/** SO-101 arm glyph: hex base, shoulder, two links, gripper tip */
function ArmGlyph({ iso, arm, z }: { iso: Proj; arm: CompareSetup['arm']; z: number }) {
  const baseTop = z + 0.04;
  const hex: P[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    hex.push(iso(arm.x + Math.cos(a) * 0.055, arm.y + Math.sin(a) * 0.055, baseTop));
  }
  const yaw = (arm.yawDeg * Math.PI) / 180;
  const sh = iso(arm.x, arm.y, baseTop + 0.06);
  const elbow = iso(arm.x + Math.cos(yaw) * 0.11, arm.y + Math.sin(yaw) * 0.11, baseTop + 0.13);
  const wrist = iso(arm.x + Math.cos(yaw) * 0.2, arm.y + Math.sin(yaw) * 0.2, baseTop + 0.07);
  const tip = iso(arm.x + Math.cos(yaw) * 0.24, arm.y + Math.sin(yaw) * 0.24, z + 0.03);
  const base = iso(arm.x, arm.y, z);
  const joints = [sh, elbow, wrist];
  return (
    <g>
      <ellipse cx={base[0]} cy={base[1]} rx={46} ry={23} fill="rgba(0,0,0,0.32)" />
      <Cube iso={iso} x={arm.x} y={arm.y} z={z} w={0.1} d={0.1} h={0.04} color={METAL_D} />
      <polygon points={pts(hex)} fill={METAL} stroke={METAL_D} strokeWidth={1.2} />
      <line {...line(sh, elbow)} stroke={METAL} strokeWidth={9} strokeLinecap="round" />
      <line {...line(elbow, wrist)} stroke={METAL} strokeWidth={8} strokeLinecap="round" />
      <line {...line(wrist, tip)} stroke={METAL_D} strokeWidth={5} strokeLinecap="round" />
      {joints.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={i === 1 ? 6 : 5} fill={METAL_D} stroke={METAL} strokeWidth={1.5} />
      ))}
      <circle cx={sh[0]} cy={sh[1]} r={8} fill={METAL} stroke={METAL_D} strokeWidth={1.5} />
      <circle cx={tip[0]} cy={tip[1]} r={3.5} fill={OBJECT} />
    </g>
  );
}

/** aluminium-extrusion post with mounting plate */
function PostGlyph({ iso, post, z }: { iso: Proj; post: CompareSetup['post']; z: number }) {
  const top = z + post.h;
  return (
    <g>
      <Cube iso={iso} x={post.x} y={post.y} z={z} w={0.03} d={0.03} h={post.h} color="oklch(0.58 0.006 250)" />
      <Cube iso={iso} x={post.x} y={post.y} z={top} w={0.06} d={0.06} h={0.012} color="oklch(0.5 0.006 250)" />
    </g>
  );
}

/** D435i camera body */
function CameraGlyph({ iso, camera }: { iso: Proj; camera: CompareSetup['camera'] }) {
  const p = iso(camera.x, camera.y, camera.z);
  return (
    <g transform={`translate(${p[0]},${p[1]})`}>
      <rect x={-22} y={-10} width={44} height={20} rx={5} fill="oklch(0.30 0.01 250)" stroke="oklch(0.5 0.01 250)" strokeWidth={1.2} />
      <circle cx={-9} cy={0} r={5.5} fill="oklch(0.20 0.02 250)" stroke={CAM} strokeWidth={1.4} />
      <circle cx={7} cy={0} r={5.5} fill="oklch(0.20 0.02 250)" stroke="oklch(0.55 0.01 250)" strokeWidth={1.2} />
      <circle cx={18} cy={-4} r={1.6} fill={CAM} />
    </g>
  );
}

export function SceneMap({ setup, isDarkMode, az = Math.PI / 4, el = 0.62 }: { setup: CompareSetup; isDarkMode: boolean; az?: number; el?: number }): JSX.Element {
  const { table, post, camera, arm, blocks } = setup;
  const iso = makeProj(az, el); // rotatable: az/el come from the shared orbit so both panes turn together
  const hw = table.length / 2;
  const hd = table.width / 2;
  const z = table.railH;

  const bg = isDarkMode ? 'oklch(0.22 0.012 248)' : 'oklch(0.97 0.004 248)';
  const grid = isDarkMode ? 'oklch(0.30 0.012 248)' : 'oklch(0.90 0.006 248)';

  const tc = [iso(-hw, -hd, z), iso(hw, -hd, z), iso(hw, hd, z), iso(-hw, hd, z)];
  const camPt = iso(camera.x, camera.y, camera.z);
  const reach = camera.z * Math.tan((camera.fovH * Math.PI) / 180 / 2);
  const fpCorners = [
    iso(camera.x - reach, camera.y - reach * 0.7, z),
    iso(camera.x + reach, camera.y - reach * 0.7, z),
    iso(camera.x + reach, camera.y + reach * 1.1, z),
    iso(camera.x - reach, camera.y + reach * 1.1, z),
  ];
  const yaw = arm.yawDeg;

  return (
    <svg viewBox="0 0 1000 640" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block' }}>
      <rect x={0} y={0} width={1000} height={640} fill={bg} />

      {/* ground grid */}
      <g>
        {Array.from({ length: 19 }).map((_, i) => {
          const t = -0.9 + i * 0.1;
          return (
            <g key={i}>
              <line {...line(iso(t, -0.9, 0), iso(t, 0.9, 0))} stroke={grid} strokeWidth={1} />
              <line {...line(iso(-0.9, t, 0), iso(0.9, t, 0))} stroke={grid} strokeWidth={1} />
            </g>
          );
        })}
      </g>

      {/* table polygon (top face at z = railH) */}
      <polygon points={pts(tc)} fill={TABLE_FILL} stroke="oklch(0.65 0.155 262 / 0.55)" strokeWidth={1.5} />
      <polygon points={pts(tc)} fill="none" stroke={RAIL} strokeWidth={7} strokeLinejoin="round" opacity={0.85} />

      {/* reach envelope (violet, dashed) */}
      <path
        d={isoRing(iso, arm.x, arm.y, 0.33, z + 0.001)}
        fill={REACH}
        fillOpacity={0.06}
        stroke={REACH}
        strokeWidth={1.5}
        strokeDasharray="7 5"
        opacity={0.85}
      />

      {/* precision fan (cyan), +-95 deg around arm yaw */}
      <path
        d={isoSector(iso, arm.x, arm.y, 0.24, ((yaw - 95) * Math.PI) / 180, ((yaw + 95) * Math.PI) / 180, z + 0.002)}
        fill={PRECISION}
        fillOpacity={0.15}
        stroke={PRECISION}
        strokeWidth={1.5}
      />

      {/* camera footprint (amber) */}
      <polygon points={pts(fpCorners)} fill={CAM} fillOpacity={0.1} stroke={CAM} strokeWidth={1.5} strokeDasharray="2 4" />

      {/* blocks */}
      {blocks.map((b) => (
        <Cube key={b.id} iso={iso} x={b.x} y={b.y} z={z} w={0.05} d={0.05} h={0.05} color={b.color === 'teal' ? TEAL : OBJECT} />
      ))}

      <ArmGlyph iso={iso} arm={arm} z={z} />
      <PostGlyph iso={iso} post={post} z={z} />

      {/* frustum lines from camera to footprint corners + post top */}
      <g>
        {fpCorners.map((c, i) => (
          <line key={i} {...line(camPt, c)} stroke={CAM} strokeWidth={1.2} strokeDasharray="3 3" opacity={0.6} />
        ))}
        <line {...line(camPt, iso(post.x, post.y, z + post.h))} stroke="oklch(0.5 0.01 250)" strokeWidth={2} opacity={0.5} />
      </g>

      <CameraGlyph iso={iso} camera={camera} />
    </svg>
  );
}
