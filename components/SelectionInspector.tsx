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
  station: { x: number; y: number; yaw: number; shapeSides: number; length: number; width: number } | null;
  onStation: (p: { x?: number; y?: number; yaw?: number; shapeSides?: number; length?: number; width?: number }) => void;
  onCloneStation: () => void;
  extraCamera: { x: number; y: number; z: number } | null;
  onExtraCamera: (p: { x?: number; y?: number; z?: number; rotX?: number; rotY?: number; rotZ?: number }) => void;
  // Decoupled prop (Three.js cube): full transform + size/colour + duplicate/delete.
  prop?: { x: number; y: number; z: number; yaw: number; size: number; color: string } | null;
  onProp?: (p: Partial<{ x: number; y: number; z: number; yaw: number; size: number; color: string }>) => void;
  onCloneProp?: () => void;
  onRemoveProp?: () => void;
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
  workcell?: { config: WorkcellConfig; onChange: (next: WorkcellConfig) => void }; // primary table rail/post
  /** Render as a flow card inside the reasoning sidebar instead of a floating panel. */
  inline?: boolean;
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
    // Floats top-right BELOW the nav cube (which sits beside the drawer toggle) when panels are closed (#1, #4).
    : `absolute top-[9rem] right-3 z-30 w-[300px] max-h-[calc(100vh-10.5rem)] overflow-y-auto custom-scrollbar rounded-2xl glass-panel shadow-xl border px-4 py-3 ${panel}`;

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
            { k: 'X', v: p.station.x, min: -2, max: 2, on: (v) => p.onStation({ x: v }) },
            { k: 'Y', v: p.station.y, min: -2, max: 2, on: (v) => p.onStation({ y: v }) },
            { k: 'Yaw', v: p.station.yaw * 180 / Math.PI, min: -180, max: 180, on: (v) => p.onStation({ yaw: v * Math.PI / 180 }) },
          ]} />
          <div className={`pt-1.5 mt-1 border-t ${p.isDarkMode ? 'border-white/10' : 'border-black/10'} space-y-1.5`}>
            <span className={`text-[9px] font-bold uppercase tracking-widest ${subtle}`}>Shape &amp; size</span>
            <Sliders subtle={subtle} fields={[
              { k: 'Sides', v: p.station.shapeSides, min: 3, max: 8, on: (v) => p.onStation({ shapeSides: Math.round(v) }) },
              { k: 'Length', v: p.station.length * 1000, min: 400, max: 1400, on: (v) => p.onStation({ length: v / 1000 }) },
              { k: 'Width', v: p.station.width * 1000, min: 400, max: 1400, on: (v) => p.onStation({ width: v / 1000 }) },
            ]} />
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
            { k: 'X', v: p.arm.x, min: -0.6, max: 0.6, on: (v) => p.onArm({ x: v }) },
            { k: 'Y', v: p.arm.y, min: -0.6, max: 0.6, on: (v) => p.onArm({ y: v }) },
            { k: 'Yaw', v: p.arm.yaw * 180 / Math.PI, min: -180, max: 180, on: (v) => p.onArm({ yaw: v * Math.PI / 180 }) },
          ]} />
          <div className="flex gap-2">
            <button onClick={() => p.onArm({ x: 0, y: 0, yaw: 0 })} className="flex-1 text-[9px] font-bold uppercase tracking-wide text-indigo-500 hover:text-indigo-400 py-1">Centre on origin</button>
            <button onClick={p.onSnapToEdge} className="flex-1 text-[9px] font-bold uppercase tracking-wide text-indigo-500 hover:text-indigo-400 py-1">Snap to edge · face in</button>
          </div>
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
            { k: 'X', v: p.extraCamera.x, min: -2, max: 2, on: (v) => p.onExtraCamera({ x: v }) },
            { k: 'Y', v: p.extraCamera.y, min: -2, max: 2, on: (v) => p.onExtraCamera({ y: v }) },
            { k: 'Z', v: p.extraCamera.z, min: 0, max: 2, on: (v) => p.onExtraCamera({ z: v }) },
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
            { k: 'X', v: p.cameraPos.x, min: -0.6, max: 0.6, on: (v) => p.onCamera(v, p.cameraPos!.y, p.cameraPos!.z) },
            { k: 'Y', v: p.cameraPos.y, min: -0.6, max: 0.6, on: (v) => p.onCamera(p.cameraPos!.x, v, p.cameraPos!.z) },
            { k: 'Z', v: p.cameraPos.z, min: 0, max: 1.4, on: (v) => p.onCamera(p.cameraPos!.x, p.cameraPos!.y, v) },
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
            { k: 'X', v: p.prop.x, min: -1, max: 1, on: (v) => p.onProp!({ x: v }) },
            { k: 'Y', v: p.prop.y, min: -1, max: 1, on: (v) => p.onProp!({ y: v }) },
            { k: 'Z', v: p.prop.z, min: 0, max: 1, on: (v) => p.onProp!({ z: v }) },
            { k: 'Yaw', v: p.prop.yaw * 180 / Math.PI, min: -180, max: 180, on: (v) => p.onProp!({ yaw: v * Math.PI / 180 }) },
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
          <span className={`text-[9px] font-bold uppercase w-11 shrink-0 ${AXIS_HUE[k] ?? subtle}`}>{k}</span>
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
      <span className={`text-[10px] font-bold uppercase ${subtle}`}>{label}</span>
      <input type="number" step={1} value={Number(deg.toFixed(0))}
        onChange={(e) => { const d = parseFloat(e.target.value); if (!Number.isNaN(d)) on(d); }}
        className={`flex-1 bg-transparent text-right tabular-nums text-[11px] outline-none border-b border-transparent focus:border-indigo-400 ${subtle}`} />
      <span className={`text-[9px] ${subtle}`}>°</span>
    </label>
  );
}
