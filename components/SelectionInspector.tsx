/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { Crosshair, Trash2, X } from 'lucide-react';
import type { SelectionInfo } from '../SelectionController';
import type { CameraIntrinsics, CameraStreamProfile, CameraViewToggles, LengthUnit, WorkcellConfig } from '../types';
import type { PlannerToggles } from '../WorkspacePlanner';

/** Camera controls migrated from the dock into the primary-camera selection card. */
export interface CameraCardControls {
  enabled: boolean; onEnabled: (v: boolean) => void;
  toggles: CameraViewToggles; onToggle: (k: keyof CameraViewToggles, v: boolean) => void;
  intrinsics: CameraIntrinsics; onIntrinsic: (k: keyof CameraIntrinsics, v: number) => void; onReset: () => void;
  streamProfiles: CameraStreamProfile[]; selectedProfileId: string; onStreamProfile: (id: string) => void;
  wristEnabled: boolean; onWristToggle: (v: boolean) => void;
}

export interface InspectorProps {
  selection: SelectionInfo | null;
  unit: LengthUnit;
  isDarkMode: boolean;
  // Live entity transforms (the panel edits the entity's own control point, not the bbox centre).
  arm: { x: number; y: number; yaw: number } | null;
  station: { x: number; y: number; yaw: number; shapeSides: number; length: number; width: number; sideExtents?: [number, number, number, number]; cornerRadii?: number[] } | null;
  onStation: (p: { x?: number; y?: number; yaw?: number; shapeSides?: number; length?: number; width?: number; sideExtents?: [number, number, number, number]; cornerRadii?: number[] }) => void;
  onCloneStation: () => void;
  extraCamera: { x: number; y: number; z: number } | null;
  onExtraCamera: (p: { x?: number; y?: number; z?: number; rotX?: number; rotY?: number; rotZ?: number }) => void;
  // Decoupled prop (Three.js cube): full transform + size/colour + duplicate/delete.
  prop?: { x: number; y: number; z: number; yaw: number; size: number; color: string } | null;
  onProp?: (p: Partial<{ x: number; y: number; z: number; yaw: number; size: number; color: string }>) => void;
  onCloneProp?: () => void;
  onRemoveProp?: () => void;
  // Extra mount post (selected by index).
  extraPost?: { x: number; y: number; height: number } | null;
  onExtraPost?: (p: Partial<{ x: number; y: number; height: number }>) => void;
  onCloneExtraPost?: () => void;
  onRemoveExtraPost?: () => void;
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
  // Wrist-camera mount (gripper-relative) — surfaced here so the selection card edits the same
  // params as the dock: X/Y/Z offset, tilt, FOV, plus save / factory-reset.
  wristMount?: { posX: number; posY: number; posZ: number; fov: number; tilt: number } | null;
  onWristMount?: (m: { posX: number; posY: number; posZ: number; fov: number; tilt: number }) => void;
  onSaveWristMount?: () => void;
  onResetWristMount?: () => void;
  // Migrated dock controls (#6): each renders inside the matching item's card.
  camera?: CameraCardControls;                                  // primary D435i optics/profile/toggles
  armReach?: { toggles: PlannerToggles; onToggle: (k: keyof PlannerToggles, v: boolean) => void; canRemove: boolean; onRemove: () => void };
  // Per-arm joint jog: slider per actuated joint (primary drives live physics; others pose their ghost).
  armJoints?: { info: { name: string; lo: number; hi: number }[]; values: number[]; onChange: (index: number, angle: number) => void };
  workcell?: { config: WorkcellConfig; onChange: (next: WorkcellConfig) => void }; // primary table rail/post
  /** Render as a flow card inside the reasoning sidebar instead of a floating panel. */
  inline?: boolean;
  /** Override the floating-panel position/size classes (used when it's its own standalone sidebar). */
  floatClass?: string;
}

const CAMERA_TOGGLE_ROWS: Array<{ key: keyof CameraViewToggles; label: string }> = [
  { key: 'frustum', label: 'FOV frustum' },
  { key: 'sensorPip', label: 'Camera view (PIP)' },
  { key: 'footprint', label: 'Ground footprint' },
  { key: 'objectTint', label: 'Highlight what it frames' },
  { key: 'coverage', label: 'Occlusion coverage' },
];
const PLANNER_TOGGLE_ROWS: Array<{ key: keyof PlannerToggles; label: string }> = [
  { key: 'outline', label: 'Reach envelope (outline)' },
  { key: 'reach', label: 'Reach heatmap (density)' },
  { key: 'basePlacement', label: 'Best-mount heatmap' },
  { key: 'tasks', label: 'Task-point markers' },
  { key: 'baseDrag', label: 'Drag-to-move base' },
];

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
    // Standalone floating panel ("its own sidebar"). Position/size come from floatClass (set by App
    // so it sits beside the main sidebar); default to top-right when none is given.
    : `${p.floatClass ?? 'absolute top-[9rem] right-3 z-30 w-[300px]'} max-h-[calc(100vh-3rem)] overflow-y-auto custom-scrollbar rounded-2xl glass-panel shadow-xl border px-4 py-3 ${panel}`;

  return (
    <div className={rootClass}>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2.5 h-2.5 rounded-sm bg-yellow-400" />
        <span className="font-bold text-[12px] flex-1 truncate">{sel.label}</span>
        <button onClick={p.onFrame} title="Frame (F)" className={`p-1 rounded-md ${p.isDarkMode ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}><Crosshair className="w-3.5 h-3.5" /></button>
        <button onClick={p.onDeselect} title="Deselect" className={`p-1 rounded-md ${p.isDarkMode ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}><X className="w-3.5 h-3.5" /></button>
      </div>

      {sel.kind === 'station' && p.station && (
        <div className="space-y-1.5">
          <Row3 unit={p.unit} subtle={subtle}
            fields={[
              { k: 'X', v: p.station.x, on: (v) => p.onStation({ x: v }) },
              { k: 'Y', v: p.station.y, on: (v) => p.onStation({ y: v }) },
            ]} />
          <Angle subtle={subtle} label="Yaw" deg={p.station.yaw * 180 / Math.PI} on={(d) => p.onStation({ yaw: d * Math.PI / 180 })} />
          <Sliders subtle={subtle} fields={[
            { k: 'X', v: p.station.x, min: -2, max: 2, unit: 'm', on: (v) => p.onStation({ x: v }) },
            { k: 'Y', v: p.station.y, min: -2, max: 2, unit: 'm', on: (v) => p.onStation({ y: v }) },
            { k: 'Yaw', v: p.station.yaw * 180 / Math.PI, min: -180, max: 180, unit: '°', on: (v) => p.onStation({ yaw: v * Math.PI / 180 }) },
          ]} />
          <div className={`pt-1.5 mt-1 border-t ${p.isDarkMode ? 'border-white/10' : 'border-black/10'} space-y-1.5`}>
            <span className={`text-[9px] font-bold uppercase tracking-widest ${subtle}`}>Shape &amp; size</span>
            <Sliders subtle={subtle} fields={[
              { k: 'Sides', v: p.station.shapeSides, min: 3, max: 8, on: (v) => p.onStation({ shapeSides: Math.round(v) }) },
              { k: 'Length', v: p.station.length * 1000, min: 400, max: 1400, unit: 'mm', on: (v) => p.onStation({ length: v / 1000 }) },
              { k: 'Width', v: p.station.width * 1000, min: 400, max: 1400, unit: 'mm', on: (v) => p.onStation({ width: v / 1000 }) },
            ]} />
            {/* Per-rail sizing: 4-sided → independent edge distances from centre; N>4 → per-corner radius. */}
            <RailSizers station={p.station} subtle={subtle} onStation={p.onStation} />
          </div>
          {sel.stationId === 'primary' && p.workcell && (
            <div className={`pt-1.5 mt-1 border-t ${p.isDarkMode ? 'border-white/10' : 'border-black/10'} space-y-1`}>
              <span className={`text-[9px] font-bold uppercase tracking-widest ${subtle}`}>Rails &amp; post</span>
              <WMSlider label="Rail height" min={12} max={80} step={2} value={p.workcell.config.barHeight * 1000} on={(v) => p.workcell!.onChange({ ...p.workcell!.config, barHeight: v / 1000 })} subtle={subtle} unit="mm" />
              <WMSlider label="Rail width" min={12} max={80} step={2} value={p.workcell.config.barWidth * 1000} on={(v) => p.workcell!.onChange({ ...p.workcell!.config, barWidth: v / 1000 })} subtle={subtle} unit="mm" />
              <WMSlider label="Post height" min={100} max={1400} step={20} value={p.workcell.config.postHeight * 1000} on={(v) => p.workcell!.onChange({ ...p.workcell!.config, postHeight: v / 1000 })} subtle={subtle} unit="mm" />
              <WMSlider label="Post X" min={-600} max={600} step={5} value={p.workcell.config.postX * 1000} on={(v) => p.workcell!.onChange({ ...p.workcell!.config, postX: v / 1000 })} subtle={subtle} unit="mm" />
              <WMSlider label="Post Y" min={-600} max={600} step={5} value={p.workcell.config.postY * 1000} on={(v) => p.workcell!.onChange({ ...p.workcell!.config, postY: v / 1000 })} subtle={subtle} unit="mm" />
            </div>
          )}
          {sel.stationId !== 'primary' && <button onClick={p.onCloneStation} className="w-full text-[9px] font-bold uppercase tracking-wide text-indigo-500 hover:text-indigo-400 py-1">Clone this workstation</button>}
          <p className={`text-[9px] ${subtle}`}>{sel.stationId === 'primary' ? 'Right-click → Duplicate to clone into a workstation, or Aim to rotate.' : 'Moves the worktop + its arm as a unit. Right-click → Aim to rotate.'}</p>
        </div>
      )}

      {sel.kind === 'arm' && p.arm && (
        <div className="space-y-1.5">
          <Row3 unit={p.unit} subtle={subtle}
            fields={[
              { k: 'X', v: p.arm.x, on: (v) => p.onArm({ x: v }) },
              { k: 'Y', v: p.arm.y, on: (v) => p.onArm({ y: v }) },
            ]} />
          <Angle subtle={subtle} label="Yaw" deg={p.arm.yaw * 180 / Math.PI} on={(d) => p.onArm({ yaw: d * Math.PI / 180 })} />
          <Sliders subtle={subtle} fields={[
            { k: 'X', v: p.arm.x, min: -0.6, max: 0.6, unit: 'm', on: (v) => p.onArm({ x: v }) },
            { k: 'Y', v: p.arm.y, min: -0.6, max: 0.6, unit: 'm', on: (v) => p.onArm({ y: v }) },
            { k: 'Yaw', v: p.arm.yaw * 180 / Math.PI, min: -180, max: 180, unit: '°', on: (v) => p.onArm({ yaw: v * Math.PI / 180 }) },
          ]} />
          <div className="flex gap-2">
            <button onClick={() => p.onArm({ x: 0, y: 0, yaw: 0 })} className="flex-1 text-[9px] font-bold uppercase tracking-wide text-indigo-500 hover:text-indigo-400 py-1">Centre on origin</button>
            <button onClick={p.onSnapToEdge} className="flex-1 text-[9px] font-bold uppercase tracking-wide text-indigo-500 hover:text-indigo-400 py-1">Snap to edge · face in</button>
          </div>
          {p.armJoints && p.armJoints.info.length > 0 && (
            <div className={`pt-1.5 mt-1 border-t ${p.isDarkMode ? 'border-white/10' : 'border-black/10'} space-y-0.5`}>
              <span className={`text-[9px] font-bold uppercase tracking-widest ${subtle}`}>Jog joints</span>
              {p.armJoints.info.map((j, i) => (
                <div key={j.name} className="flex items-center gap-2">
                  <span className={`text-[9px] font-bold uppercase w-16 shrink-0 truncate ${subtle}`}>{j.name}</span>
                  <input type="range" min={j.lo} max={j.hi} step={(j.hi - j.lo) / 240} value={p.armJoints!.values[i] ?? 0}
                    onChange={(e) => p.armJoints!.onChange(i, parseFloat(e.target.value))}
                    className="flex-1 h-1 accent-indigo-600 cursor-pointer" />
                  <span className={`text-[9px] tabular-nums w-8 text-right ${subtle}`}>{((p.armJoints!.values[i] ?? 0) * 180 / Math.PI).toFixed(0)}°</span>
                </div>
              ))}
            </div>
          )}
          {p.armReach && (
            <div className={`pt-1.5 mt-1 border-t ${p.isDarkMode ? 'border-white/10' : 'border-black/10'} space-y-1`}>
              <span className={`text-[9px] font-bold uppercase tracking-widest ${subtle}`}>Reach views</span>
              {PLANNER_TOGGLE_ROWS.map((r) => <Check key={r.key} label={r.label} checked={p.armReach!.toggles[r.key]} onChange={(v) => p.armReach!.onToggle(r.key, v)} accent="emerald" />)}
              {p.armReach.canRemove && (
                <button onClick={p.armReach.onRemove} className={`w-full mt-1 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wide flex items-center justify-center gap-1.5 ${p.isDarkMode ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}><Trash2 className="w-3 h-3" /> Remove this arm</button>
              )}
            </div>
          )}
        </div>
      )}

      {sel.kind === 'camera' && sel.cameraId && p.extraCamera && (
        <div className="space-y-1.5">
          <Row3 unit={p.unit} subtle={subtle}
            fields={[
              { k: 'X', v: p.extraCamera.x, on: (v) => p.onExtraCamera({ x: v }) },
              { k: 'Y', v: p.extraCamera.y, on: (v) => p.onExtraCamera({ y: v }) },
              { k: 'Z', v: p.extraCamera.z, on: (v) => p.onExtraCamera({ z: v }) },
            ]} />
          <Sliders subtle={subtle} fields={[
            { k: 'X', v: p.extraCamera.x, min: -2, max: 2, unit: 'm', on: (v) => p.onExtraCamera({ x: v }) },
            { k: 'Y', v: p.extraCamera.y, min: -2, max: 2, unit: 'm', on: (v) => p.onExtraCamera({ y: v }) },
            { k: 'Z', v: p.extraCamera.z, min: 0, max: 2, unit: 'm', on: (v) => p.onExtraCamera({ z: v }) },
          ]} />
          <button onClick={() => p.onExtraCamera({ rotX: 0, rotY: 0, rotZ: 0 })} className="w-full text-[9px] font-bold uppercase tracking-wide text-indigo-500 hover:text-indigo-400 py-1">Aim straight down</button>
          <p className={`text-[9px] ${subtle}`}>Right-click → Aim to tilt/rotate the camera in the viewport.</p>
        </div>
      )}

      {sel.kind === 'camera' && !sel.cameraId && p.cameraPos && (
        <div className="space-y-1.5">
          <Row3 unit={p.unit} subtle={subtle}
            fields={[
              { k: 'X', v: p.cameraPos.x, on: (v) => p.onCamera(v, p.cameraPos!.y, p.cameraPos!.z) },
              { k: 'Y', v: p.cameraPos.y, on: (v) => p.onCamera(p.cameraPos!.x, v, p.cameraPos!.z) },
              { k: 'Z', v: p.cameraPos.z, on: (v) => p.onCamera(p.cameraPos!.x, p.cameraPos!.y, v) },
            ]} />
          <Sliders subtle={subtle} fields={[
            { k: 'X', v: p.cameraPos.x, min: -0.6, max: 0.6, unit: 'm', on: (v) => p.onCamera(v, p.cameraPos!.y, p.cameraPos!.z) },
            { k: 'Y', v: p.cameraPos.y, min: -0.6, max: 0.6, unit: 'm', on: (v) => p.onCamera(p.cameraPos!.x, v, p.cameraPos!.z) },
            { k: 'Z', v: p.cameraPos.z, min: 0, max: 1.4, unit: 'm', on: (v) => p.onCamera(p.cameraPos!.x, p.cameraPos!.y, v) },
          ]} />
          <div className="flex gap-2">
            <button onClick={p.onSnapToPost} className="flex-1 text-[9px] font-bold uppercase tracking-wide text-indigo-500 hover:text-indigo-400 py-1">Snap to post</button>
            <button onClick={p.onAimDown} className="flex-1 text-[9px] font-bold uppercase tracking-wide text-indigo-500 hover:text-indigo-400 py-1">Aim down</button>
          </div>
          {p.camera && (
            <div className={`pt-1.5 mt-1 border-t ${p.isDarkMode ? 'border-white/10' : 'border-black/10'} space-y-1.5`}>
              <Check label="Show camera" checked={p.camera.enabled} onChange={p.camera.onEnabled} />
              <Check label="Wrist camera feed" checked={p.camera.wristEnabled} onChange={p.camera.onWristToggle} />
              {CAMERA_TOGGLE_ROWS.map((r) => <Check key={r.key} label={r.label} checked={p.camera!.toggles[r.key]} onChange={(v) => p.camera!.onToggle(r.key, v)} />)}
              <label className="block">
                <span className={`block text-[9px] font-bold uppercase tracking-widest ${subtle} mb-1`}>Stream profile</span>
                <select value={p.camera.selectedProfileId} onChange={(e) => p.camera!.onStreamProfile(e.target.value)} className={`w-full rounded-lg px-2 py-1.5 text-[10px] font-semibold outline-none ${p.isDarkMode ? 'bg-slate-950/80 text-slate-200' : 'bg-white/70 text-slate-700'}`}>
                  {p.camera.selectedProfileId === 'custom' && <option value="custom">Custom</option>}
                  {p.camera.streamProfiles.map((sp) => <option key={sp.id} value={sp.id}>{sp.label}</option>)}
                </select>
              </label>
              <WMSlider label="H-FOV" min={40} max={95} step={0.5} value={p.camera.intrinsics.hFovDeg} on={(v) => p.camera!.onIntrinsic('hFovDeg', v)} subtle={subtle} unit="°" />
              <WMSlider label="Min range" min={50} max={1000} step={10} value={p.camera.intrinsics.near * 1000} on={(v) => p.camera!.onIntrinsic('near', v / 1000)} subtle={subtle} unit="mm" />
              <WMSlider label="Max range" min={1000} max={6000} step={50} value={p.camera.intrinsics.far * 1000} on={(v) => p.camera!.onIntrinsic('far', v / 1000)} subtle={subtle} unit="mm" />
              <button onClick={p.camera.onReset} className={`w-full py-1 rounded-lg text-[9px] font-bold uppercase tracking-wide ${p.isDarkMode ? 'bg-white/5 text-slate-300 hover:bg-white/10' : 'bg-black/5 text-slate-600 hover:bg-black/10'}`}>Reset optics</button>
            </div>
          )}
        </div>
      )}

      {sel.kind === 'prop' && p.prop && p.onProp && (
        <div className="space-y-1.5">
          <Row3 unit={p.unit} subtle={subtle}
            fields={[
              { k: 'X', v: p.prop.x, on: (v) => p.onProp!({ x: v }) },
              { k: 'Y', v: p.prop.y, on: (v) => p.onProp!({ y: v }) },
              { k: 'Z', v: p.prop.z, on: (v) => p.onProp!({ z: v }) },
            ]} />
          <Sliders subtle={subtle} fields={[
            { k: 'X', v: p.prop.x, min: -1, max: 1, unit: 'm', on: (v) => p.onProp!({ x: v }) },
            { k: 'Y', v: p.prop.y, min: -1, max: 1, unit: 'm', on: (v) => p.onProp!({ y: v }) },
            { k: 'Z', v: p.prop.z, min: 0, max: 1, unit: 'm', on: (v) => p.onProp!({ z: v }) },
            { k: 'Yaw', v: p.prop.yaw * 180 / Math.PI, min: -180, max: 180, unit: '°', on: (v) => p.onProp!({ yaw: v * Math.PI / 180 }) },
          ]} />
          <WMSlider label="Size" min={10} max={300} step={5} value={p.prop.size * 1000} on={(v) => p.onProp!({ size: v / 1000 })} subtle={subtle} unit="mm" />
          <label className="flex items-center justify-between gap-2 text-[10px] font-medium">
            <span>Colour</span>
            <input type="color" value={p.prop.color} onChange={(e) => p.onProp!({ color: e.target.value })} className="w-8 h-5 rounded cursor-pointer bg-transparent" />
          </label>
          <div className="flex gap-2">
            {p.onCloneProp && <button onClick={p.onCloneProp} className="flex-1 text-[9px] font-bold uppercase tracking-wide text-indigo-500 hover:text-indigo-400 py-1">Duplicate</button>}
            {p.onRemoveProp && <button onClick={p.onRemoveProp} className="flex-1 text-[9px] font-bold uppercase tracking-wide text-red-500 hover:text-red-400 py-1">Delete</button>}
          </div>
          <p className={`text-[9px] ${subtle}`}>A decoupled prop (no physics). Right-click → Move / Aim, or duplicate freely.</p>
        </div>
      )}

      {sel.kind === 'wristcam' && p.wristMount && p.onWristMount && (
        <div className="space-y-1.5">
          <p className={`text-[9px] ${subtle}`}>Pinned on the gripper (rigid). Offset + tilt to taste.</p>
          <WMSlider label="X (side)" min={-100} max={100} step={5} value={p.wristMount.posX * 1000} on={(v) => p.onWristMount!({ ...p.wristMount!, posX: v / 1000 })} subtle={subtle} unit="mm" />
          <WMSlider label="Y (along)" min={-50} max={200} step={5} value={p.wristMount.posY * 1000} on={(v) => p.onWristMount!({ ...p.wristMount!, posY: v / 1000 })} subtle={subtle} unit="mm" />
          <WMSlider label="Z (face)" min={-100} max={100} step={5} value={p.wristMount.posZ * 1000} on={(v) => p.onWristMount!({ ...p.wristMount!, posZ: v / 1000 })} subtle={subtle} unit="mm" />
          <WMSlider label="Tilt" min={0} max={360} step={1} value={p.wristMount.tilt} on={(v) => p.onWristMount!({ ...p.wristMount!, tilt: v })} subtle={subtle} unit="°" />
          <WMSlider label="FOV" min={30} max={100} step={1} value={p.wristMount.fov} on={(v) => p.onWristMount!({ ...p.wristMount!, fov: v })} subtle={subtle} unit="°" />
          <div className="flex gap-2">
            {p.onSaveWristMount && <button onClick={p.onSaveWristMount} className="flex-1 text-[9px] font-bold uppercase tracking-wide text-emerald-600 hover:text-emerald-500 py-1">Save wrist cam position</button>}
            {p.onResetWristMount && <button onClick={p.onResetWristMount} className="flex-1 text-[9px] font-bold uppercase tracking-wide text-indigo-500 hover:text-indigo-400 py-1">Factory reset</button>}
          </div>
          <p className={`text-[9px] ${subtle}`}>Right-click → Move / Aim to drag it in the viewport.</p>
        </div>
      )}

      {sel.kind === 'post' && sel.postIndex === undefined && (
        <Row3 unit={p.unit} subtle={subtle}
          fields={[
            { k: 'X', v: p.post.x, on: (v) => p.onPost(v, p.post.y) },
            { k: 'Y', v: p.post.y, on: (v) => p.onPost(p.post.x, v) },
          ]} />
      )}

      {sel.kind === 'post' && sel.postIndex !== undefined && p.extraPost && p.onExtraPost && (
        <div className="space-y-1.5">
          <Row3 unit={p.unit} subtle={subtle}
            fields={[
              { k: 'X', v: p.extraPost.x, on: (v) => p.onExtraPost!({ x: v }) },
              { k: 'Y', v: p.extraPost.y, on: (v) => p.onExtraPost!({ y: v }) },
            ]} />
          <Sliders subtle={subtle} fields={[
            { k: 'X', v: p.extraPost.x, min: -2, max: 2, unit: 'm', on: (v) => p.onExtraPost!({ x: v }) },
            { k: 'Y', v: p.extraPost.y, min: -2, max: 2, unit: 'm', on: (v) => p.onExtraPost!({ y: v }) },
          ]} />
          <WMSlider label="Height" min={100} max={1400} step={20} value={p.extraPost.height * 1000} on={(v) => p.onExtraPost!({ height: v / 1000 })} subtle={subtle} unit="mm" />
          <div className="flex gap-2">
            {p.onCloneExtraPost && <button onClick={p.onCloneExtraPost} className="flex-1 text-[9px] font-bold uppercase tracking-wide text-indigo-500 hover:text-indigo-400 py-1">Duplicate</button>}
            {p.onRemoveExtraPost && <button onClick={p.onRemoveExtraPost} className="flex-1 text-[9px] font-bold uppercase tracking-wide text-red-500 hover:text-red-400 py-1">Delete</button>}
          </div>
          <p className={`text-[9px] ${subtle}`}>A mount post — snap cameras/sensors onto it. Right-click → Move.</p>
        </div>
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

/** Drag sliders per axis, each with a live value readout (auto-precision by range) + optional unit. */
function Sliders({ fields, subtle }: { fields: { k: string; v: number; min: number; max: number; unit?: string; on: (v: number) => void }[]; subtle: string }) {
  return (
    <div className="space-y-0.5">
      {fields.map(({ k, v, min, max, unit, on }) => {
        const range = max - min;
        const digits = range >= 100 ? 0 : range >= 10 ? 1 : 2;
        return (
          <div key={k} className="flex items-center gap-2">
            <span className={`text-[9px] font-bold uppercase w-11 shrink-0 ${AXIS_HUE[k] ?? subtle}`}>{k}</span>
            <input type="range" min={min} max={max} step={(max - min) / 240} value={v}
              onChange={(e) => on(parseFloat(e.target.value))}
              className="flex-1 h-1 accent-indigo-600 cursor-pointer" />
            <span className={`text-[9px] tabular-nums w-12 text-right shrink-0 ${subtle}`}>{Number(v.toFixed(digits))}{unit ? ` ${unit}` : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Per-rail worktop sizing. 4-sided → 4 independent edge distances from centre (Right/Left/Front/
 *  Back); N>4 → one radius per corner. Falls back to the uniform length/width until edited. */
function RailSizers({ station, subtle, onStation }: {
  station: { shapeSides: number; length: number; width: number; sideExtents?: [number, number, number, number]; cornerRadii?: number[] };
  subtle: string;
  onStation: (p: { sideExtents?: [number, number, number, number]; cornerRadii?: number[] }) => void;
}) {
  const sides = Math.round(station.shapeSides);
  if (sides === 4) {
    const e = station.sideExtents ?? [station.length / 2, station.length / 2, station.width / 2, station.width / 2];
    const set = (i: number, v: number) => { const n = [...e] as [number, number, number, number]; n[i] = v / 1000; onStation({ sideExtents: n }); };
    return (
      <div className="pt-1 mt-1 border-t border-black/5 space-y-1">
        <span className={`text-[9px] font-bold uppercase tracking-widest ${subtle}`}>Rails · per side</span>
        <Sliders subtle={subtle} fields={[
          { k: 'Right', v: e[0] * 1000, min: 50, max: 900, unit: 'mm', on: (v) => set(0, v) },
          { k: 'Left', v: e[1] * 1000, min: 50, max: 900, unit: 'mm', on: (v) => set(1, v) },
          { k: 'Front', v: e[2] * 1000, min: 50, max: 900, unit: 'mm', on: (v) => set(2, v) },
          { k: 'Back', v: e[3] * 1000, min: 50, max: 900, unit: 'mm', on: (v) => set(3, v) },
        ]} />
      </div>
    );
  }
  const def = station.length / 2;
  const r = station.cornerRadii && station.cornerRadii.length === sides ? station.cornerRadii : Array.from({ length: sides }, () => def);
  const set = (i: number, v: number) => { const n = [...r]; n[i] = v / 1000; onStation({ cornerRadii: n }); };
  return (
    <div className="pt-1 mt-1 border-t border-black/5 space-y-1">
      <span className={`text-[9px] font-bold uppercase tracking-widest ${subtle}`}>Rails · per corner</span>
      <Sliders subtle={subtle} fields={r.map((rv, i) => ({ k: `C${i + 1}`, v: rv * 1000, min: 50, max: 900, unit: 'mm', on: (v: number) => set(i, v) }))} />
    </div>
  );
}

/** Boxed numeric inputs — one row per axis with a large, clearly-clickable field + unit (Orca-style),
 *  so the value is easy to read and the input/steppers are a comfortable hit target. */
function Row3({ fields, unit, subtle }: { fields: { k: string; v: number; on: (v: number) => void }[]; unit: LengthUnit; subtle: string }) {
  const mm = unit === 'mm';
  const toDisp = (v: number) => (mm ? v * 1000 : v);
  const fromDisp = (d: number) => (mm ? d / 1000 : d);
  const digits = mm ? 0 : 3;
  return (
    <div className="space-y-1.5">
      {fields.map(({ k, v, on }) => (
        <label key={k} className="flex items-center gap-2">
          <span className={`text-[11px] font-bold uppercase w-8 shrink-0 ${AXIS_HUE[k] ?? subtle}`}>{k}</span>
          <input type="number" step={mm ? 1 : 0.005} value={Number(toDisp(v).toFixed(digits))}
            onChange={(e) => { const d = parseFloat(e.target.value); if (!Number.isNaN(d)) on(fromDisp(d)); }}
            className="flex-1 min-w-0 text-right tabular-nums text-[13px] px-2.5 py-1.5 rounded-lg border bg-black/[0.03] border-black/10 outline-none focus:border-indigo-400 focus:bg-white/40" />
          <span className={`text-[10px] w-6 shrink-0 ${subtle}`}>{mm ? 'mm' : 'm'}</span>
        </label>
      ))}
    </div>
  );
}

/** A compact checkbox row — for the migrated camera/reach toggles. */
function Check({ label, checked, onChange, accent = 'indigo' }: { label: string; checked: boolean; onChange: (v: boolean) => void; accent?: 'indigo' | 'emerald' }) {
  const a = accent === 'emerald' ? 'accent-emerald-600' : 'accent-indigo-600';
  return (
    <label className="flex items-center justify-between gap-2 cursor-pointer text-[11px] font-medium">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className={`${a} w-3.5 h-3.5`} />
    </label>
  );
}

/** A labelled slider with a typeable numeric value + unit — for the wrist-cam mount controls. */
function WMSlider({ label, min, max, step, value, on, subtle, unit }: { label: string; min: number; max: number; step: number; value: number; on: (v: number) => void; subtle: string; unit: string }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between items-center text-[10px] font-medium gap-2">
        <span>{label}</span>
        <span className={`flex items-center gap-0.5 ${subtle}`}>
          <input type="number" min={min} max={max} step={step} value={Number(value.toFixed(0))}
            onChange={(e) => { const d = parseFloat(e.target.value); if (!Number.isNaN(d)) on(clamp(d)); }}
            className="w-11 bg-transparent text-right tabular-nums outline-none border-b border-transparent focus:border-indigo-400" />
          <span>{unit}</span>
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => on(parseFloat(e.target.value))} className="w-full h-1 accent-indigo-600 cursor-pointer" />
    </div>
  );
}

function Angle({ label, deg, on, subtle }: { label: string; deg: number; on: (d: number) => void; subtle: string }) {
  return (
    <label className="flex items-center gap-2">
      <span className={`text-[11px] font-bold uppercase w-8 shrink-0 ${AXIS_HUE[label] ?? subtle}`}>{label}</span>
      <input type="number" step={1} value={Number(deg.toFixed(0))}
        onChange={(e) => { const d = parseFloat(e.target.value); if (!Number.isNaN(d)) on(d); }}
        className="flex-1 min-w-0 text-right tabular-nums text-[13px] px-2.5 py-1.5 rounded-lg border bg-black/[0.03] border-black/10 outline-none focus:border-indigo-400 focus:bg-white/40" />
      <span className={`text-[10px] w-6 shrink-0 ${subtle}`}>°</span>
    </label>
  );
}
