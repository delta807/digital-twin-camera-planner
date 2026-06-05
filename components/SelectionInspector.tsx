/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { Crosshair, X } from 'lucide-react';
import type { SelectionInfo } from '../SelectionController';
import type { LengthUnit } from '../types';

export interface InspectorProps {
  selection: SelectionInfo | null;
  unit: LengthUnit;
  isDarkMode: boolean;
  // Live entity transforms (the panel edits the entity's own control point, not the bbox centre).
  arm: { x: number; y: number; yaw: number } | null;
  cameraPos: { x: number; y: number; z: number } | null;
  post: { x: number; y: number };
  // Write-backs.
  onArm: (p: { x?: number; y?: number; yaw?: number }) => void;
  onCamera: (x: number, y: number, z: number) => void;
  onPost: (x: number, y: number) => void;
  onObject: (bodyId: number, x: number, y: number, z: number) => void;
  onAimDown: () => void;
  onSnapToPost: () => void;
  onDeselect: () => void;
  onFrame: () => void;
  // Rod snapping: mount the selection on a rod, then slide it along (0..1).
  onSnapToRod: () => void;
  onSnapToEdge: () => void;
  onSlideAlongRod: (t: number) => void;
  rodLabel: string | null;
  rodT: number;
  /** Render as a flow card inside the reasoning sidebar instead of a floating panel. */
  inline?: boolean;
}

/**
 * SelectionInspector — OrcaSlicer-style: when an object is selected in the viewport (or tree),
 * this floating card shows its editable coordinates so you act on the THING, not a sidebar.
 * Each kind edits its own control point with the right write-back (arm base, camera pose, post
 * X/Y, or a task block's freejoint). Numbers are unit-aware (m / mm) with origin = table centre.
 */
export function SelectionInspector(p: InspectorProps) {
  const { selection: sel } = p;
  if (!sel) return null;

  const panel = p.isDarkMode ? 'bg-slate-900/85 border-white/10 text-slate-100' : 'bg-white/90 border-white/80 text-slate-800';
  const subtle = p.isDarkMode ? 'text-slate-400' : 'text-slate-500';

  const rootClass = p.inline
    ? `rounded-xl border px-3 py-2.5 ${p.isDarkMode ? 'bg-white/5 border-white/10' : 'bg-black/[0.03] border-black/10'}`
    : `absolute bottom-24 left-1/2 -translate-x-1/2 z-30 w-[300px] rounded-2xl glass-panel shadow-xl border px-4 py-3 ${panel}`;

  return (
    <div className={rootClass}>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2.5 h-2.5 rounded-sm bg-yellow-400" />
        <span className="font-bold text-[12px] flex-1 truncate">{sel.label}</span>
        <button onClick={p.onFrame} title="Frame (F)" className={`p-1 rounded-md ${p.isDarkMode ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}><Crosshair className="w-3.5 h-3.5" /></button>
        <button onClick={p.onDeselect} title="Deselect" className={`p-1 rounded-md ${p.isDarkMode ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}><X className="w-3.5 h-3.5" /></button>
      </div>

      {sel.kind === 'arm' && p.arm && (
        <div className="space-y-1.5">
          <Row3 unit={p.unit} subtle={subtle}
            fields={[
              { k: 'X', v: p.arm.x, on: (v) => p.onArm({ x: v }) },
              { k: 'Y', v: p.arm.y, on: (v) => p.onArm({ y: v }) },
            ]} />
          <Angle subtle={subtle} label="Yaw" deg={p.arm.yaw * 180 / Math.PI} on={(d) => p.onArm({ yaw: d * Math.PI / 180 })} />
          <Sliders subtle={subtle} fields={[
            { k: 'X', v: p.arm.x, min: -0.6, max: 0.6, on: (v) => p.onArm({ x: v }) },
            { k: 'Y', v: p.arm.y, min: -0.6, max: 0.6, on: (v) => p.onArm({ y: v }) },
            { k: 'Yaw', v: p.arm.yaw * 180 / Math.PI, min: -180, max: 180, on: (v) => p.onArm({ yaw: v * Math.PI / 180 }) },
          ]} />
          <div className="flex gap-2">
            <button onClick={() => p.onArm({ x: 0, y: 0, yaw: 0 })} className="flex-1 text-[9px] font-bold uppercase tracking-wide text-indigo-500 hover:text-indigo-400 py-1">Centre on origin</button>
            <button onClick={p.onSnapToEdge} className="flex-1 text-[9px] font-bold uppercase tracking-wide text-indigo-500 hover:text-indigo-400 py-1">Snap to edge · face in</button>
          </div>
        </div>
      )}

      {sel.kind === 'camera' && p.cameraPos && (
        <div className="space-y-1.5">
          <Row3 unit={p.unit} subtle={subtle}
            fields={[
              { k: 'X', v: p.cameraPos.x, on: (v) => p.onCamera(v, p.cameraPos!.y, p.cameraPos!.z) },
              { k: 'Y', v: p.cameraPos.y, on: (v) => p.onCamera(p.cameraPos!.x, v, p.cameraPos!.z) },
              { k: 'Z', v: p.cameraPos.z, on: (v) => p.onCamera(p.cameraPos!.x, p.cameraPos!.y, v) },
            ]} />
          <Sliders subtle={subtle} fields={[
            { k: 'X', v: p.cameraPos.x, min: -0.6, max: 0.6, on: (v) => p.onCamera(v, p.cameraPos!.y, p.cameraPos!.z) },
            { k: 'Y', v: p.cameraPos.y, min: -0.6, max: 0.6, on: (v) => p.onCamera(p.cameraPos!.x, v, p.cameraPos!.z) },
            { k: 'Z', v: p.cameraPos.z, min: 0, max: 1.4, on: (v) => p.onCamera(p.cameraPos!.x, p.cameraPos!.y, v) },
          ]} />
          <div className="flex gap-2">
            <button onClick={p.onSnapToPost} className="flex-1 text-[9px] font-bold uppercase tracking-wide text-indigo-500 hover:text-indigo-400 py-1">Snap to post</button>
            <button onClick={p.onAimDown} className="flex-1 text-[9px] font-bold uppercase tracking-wide text-indigo-500 hover:text-indigo-400 py-1">Aim down</button>
          </div>
        </div>
      )}

      {sel.kind === 'post' && (
        <Row3 unit={p.unit} subtle={subtle}
          fields={[
            { k: 'X', v: p.post.x, on: (v) => p.onPost(v, p.post.y) },
            { k: 'Y', v: p.post.y, on: (v) => p.onPost(p.post.x, v) },
          ]} />
      )}

      {sel.kind === 'object' && sel.bodyId !== undefined && (
        <Row3 unit={p.unit} subtle={subtle}
          fields={[
            { k: 'X', v: sel.x, on: (v) => p.onObject(sel.bodyId!, v, sel.y, sel.z) },
            { k: 'Y', v: sel.y, on: (v) => p.onObject(sel.bodyId!, sel.x, v, sel.z) },
            { k: 'Z', v: sel.z, on: (v) => p.onObject(sel.bodyId!, sel.x, sel.y, v) },
          ]} />
      )}

      {/* Mount on a rod (post / rail) and slide along it — mimics moving along the alu extrusion. */}
      {(sel.kind === 'camera' || sel.kind === 'arm' || sel.kind === 'object') && (
        <div className="mt-2 pt-2 border-t border-black/5 space-y-1.5">
          <button onClick={p.onSnapToRod} className={`w-full text-[9px] font-bold uppercase tracking-wide py-1 rounded-md ${p.isDarkMode ? 'bg-white/5 text-indigo-300 hover:bg-white/10' : 'bg-black/5 text-indigo-600 hover:bg-black/10'}`}>
            {p.rodLabel ? `Snapped to ${p.rodLabel} — re-snap` : 'Snap to nearest rod'}
          </button>
          {p.rodLabel && (
            <label className="flex items-center gap-2">
              <span className={`text-[9px] font-bold uppercase ${subtle}`}>Along</span>
              <input type="range" min={0} max={1} step={0.01} value={p.rodT}
                onChange={(e) => p.onSlideAlongRod(parseFloat(e.target.value))}
                className="flex-1 h-1 accent-indigo-600 cursor-pointer" />
              <span className={`text-[9px] tabular-nums w-7 text-right ${subtle}`}>{Math.round(p.rodT * 100)}%</span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

const AXIS_HUE: Record<string, string> = { X: 'text-rose-500', Y: 'text-emerald-500', Z: 'text-sky-500', Yaw: 'text-amber-500' };

/** Drag sliders per axis (in addition to the typeable numbers above). */
function Sliders({ fields, subtle }: { fields: { k: string; v: number; min: number; max: number; on: (v: number) => void }[]; subtle: string }) {
  return (
    <div className="space-y-0.5">
      {fields.map(({ k, v, min, max, on }) => (
        <div key={k} className="flex items-center gap-2">
          <span className={`text-[9px] font-bold uppercase w-7 ${AXIS_HUE[k] ?? subtle}`}>{k}</span>
          <input type="range" min={min} max={max} step={(max - min) / 240} value={v}
            onChange={(e) => on(parseFloat(e.target.value))}
            className="flex-1 h-1 accent-indigo-600 cursor-pointer" />
        </div>
      ))}
    </div>
  );
}

function Row3({ fields, unit, subtle }: { fields: { k: string; v: number; on: (v: number) => void }[]; unit: LengthUnit; subtle: string }) {
  const mm = unit === 'mm';
  const toDisp = (v: number) => (mm ? v * 1000 : v);
  const fromDisp = (d: number) => (mm ? d / 1000 : d);
  const digits = mm ? 0 : 3;
  return (
    <div className={`grid gap-1.5`} style={{ gridTemplateColumns: `repeat(${fields.length}, minmax(0,1fr))` }}>
      {fields.map(({ k, v, on }) => (
        <label key={k} className="flex items-center gap-1">
          <span className={`text-[10px] font-bold uppercase ${AXIS_HUE[k] ?? subtle}`}>{k}</span>
          <input type="number" step={mm ? 1 : 0.005} value={Number(toDisp(v).toFixed(digits))}
            onChange={(e) => { const d = parseFloat(e.target.value); if (!Number.isNaN(d)) on(fromDisp(d)); }}
            className={`w-full bg-transparent text-right tabular-nums text-[11px] outline-none border-b border-transparent focus:border-indigo-400 ${subtle}`} />
        </label>
      ))}
      <span className={`text-[9px] self-center ${subtle}`}>{mm ? 'mm' : 'm'}</span>
    </div>
  );
}

function Angle({ label, deg, on, subtle }: { label: string; deg: number; on: (d: number) => void; subtle: string }) {
  return (
    <label className="flex items-center gap-2">
      <span className={`text-[10px] font-bold uppercase ${subtle}`}>{label}</span>
      <input type="number" step={1} value={Number(deg.toFixed(0))}
        onChange={(e) => { const d = parseFloat(e.target.value); if (!Number.isNaN(d)) on(d); }}
        className={`flex-1 bg-transparent text-right tabular-nums text-[11px] outline-none border-b border-transparent focus:border-indigo-400 ${subtle}`} />
      <span className={`text-[9px] ${subtle}`}>°</span>
    </label>
  );
}
