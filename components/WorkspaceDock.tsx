/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Boxes, Camera, ChevronDown, Crosshair, Grid3x3, Loader2, Move3d, Plus, Rotate3d, Ruler, Trash2 } from 'lucide-react';
import { ReactNode, useState } from 'react';
import { PlannerToggles } from '../WorkspacePlanner';
import { ArmInstance, CameraIntrinsics, CameraStreamProfile, CameraViewToggles, LengthUnit, WorkcellConfig } from '../types';

export interface DockSceneProps {
  unit: LengthUnit;
  onUnit: (u: LengthUnit) => void;
  axesVisible: boolean;
  onAxesToggle: (v: boolean) => void;
  cameraPos: { x: number; y: number; z: number } | null;
}
export interface DockWorkcellProps {
  config: WorkcellConfig;
  onChange: (next: WorkcellConfig) => void;
}
export interface DockArmsProps {
  list: ArmInstance[];
  selectedId: string;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<ArmInstance>) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onApplyPose: () => void;
  toggles: PlannerToggles;
  onToggle: (key: keyof PlannerToggles, v: boolean) => void;
  resolution: number;
  onResolution: (v: number) => void;
  onRecompute: () => void;
  computing: boolean;
  baseResult: { covered: number; total: number } | null;
  onSuggestLayout: () => void; // place all arms for max task coverage
  layoutResult: { covered: number; total: number } | null;
}
export interface DockCameraProps {
  toggles: CameraViewToggles;
  onToggle: (key: keyof CameraViewToggles, v: boolean) => void;
  intrinsics: CameraIntrinsics;
  onIntrinsic: (key: keyof CameraIntrinsics, v: number) => void;
  onReset: () => void;
  streamProfiles: CameraStreamProfile[];
  selectedProfileId: string;
  onStreamProfile: (id: string) => void;
  dragMode: 'translate' | 'rotate';
  onDragMode: (m: 'translate' | 'rotate') => void;
  onComputeCoverage: () => void;
  pos: { x: number; y: number; z: number } | null; // live camera world position
  onMove: (x: number, y: number, z: number) => void; // type exact coordinates
  onAimDown: () => void;
  onSnapToPost: () => void; // mount on the aluminium post + aim down
  wristEnabled: boolean; // gripper-mounted wrist camera feed
  onWristToggle: (v: boolean) => void;
  wristMount: { back: number; up: number; reach: number; fov: number };
  onWristMount: (m: { back: number; up: number; reach: number; fov: number }) => void;
}
export interface DockMeasureProps {
  active: boolean;
  onToggleActive: (v: boolean) => void;
  unit: LengthUnit;
  measurements: Array<{ id: string; distance: number; dx: number; dy: number; dz: number; label: string }>;
  onClear: () => void;
  onRemove: (id: string) => void;
}
export interface DockObjectEntity { key: string; kind: 'arm' | 'camera' | 'post' | 'object'; label: string; bodyId?: number; armId?: string }
export interface DockObjectsProps {
  entities: DockObjectEntity[];
  selectedKey: string | null;
  onSelect: (e: DockObjectEntity) => void;
}

interface WorkspaceDockProps {
  isDarkMode: boolean;
  objects?: DockObjectsProps;
  scene: DockSceneProps;
  workcell: DockWorkcellProps;
  arms: DockArmsProps;
  camera: DockCameraProps;
  measure?: DockMeasureProps;
}

const PLANNER_ROWS: Array<{ key: keyof PlannerToggles; label: string }> = [
  { key: 'outline', label: 'Reach envelope (outline)' },
  { key: 'reach', label: 'Reach heatmap (density)' },
  { key: 'basePlacement', label: 'Best-mount heatmap' },
  { key: 'tasks', label: 'Task-point markers' },
  { key: 'baseDrag', label: 'Drag-to-move base' },
];
const CAMERA_ROWS: Array<{ key: keyof CameraViewToggles; label: string }> = [
  { key: 'frustum', label: 'FOV frustum' },
  { key: 'sensorPip', label: 'Camera view (PIP)' },
  { key: 'footprint', label: 'Ground footprint' },
  { key: 'objectTint', label: 'Highlight what it frames' },
  { key: 'coverage', label: 'Occlusion coverage' },
];

/**
 * WorkspaceDock
 * One object-centric control dock. Each section maps to a thing you're laying out — the Scene,
 * the Workcell (table), the Arms, the Camera, and Measurements — with plain-language controls
 * and live coordinates. Replaces the old scattered CameraControls / ReachabilityControls /
 * CoordinatesHud panels.
 */
export function WorkspaceDock({ isDarkMode, objects, scene, workcell, arms, camera, measure }: WorkspaceDockProps) {
  const subtle = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const arm = arms.list.find((a) => a.id === arms.selectedId) ?? arms.list[0];
  const wc = workcell.config;
  const u = scene.unit; // active length unit (m / mm) for the length sliders

  return (
    <div className={`absolute left-[3.75rem] top-4 bottom-4 z-30 w-72 rounded-2xl glass-panel shadow-xl overflow-hidden flex flex-col ${isDarkMode ? 'bg-slate-900/80 border-white/10 text-slate-100' : 'bg-white/75 border-white/80 text-slate-800'}`}>
      <div className="px-4 py-3 border-b border-black/5 shrink-0">
        <span className="text-xs font-bold uppercase tracking-widest">Workspace</span>
        <span className={`block text-[9px] ${subtle}`}>origin = table center · X→ Y↑ Z out</span>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar divide-y divide-black/5">
        {/* ── Objects: scene tree — click a row to select it in the 3D view ── */}
        {objects && (
          <Section title="Objects" icon={<Boxes className="w-3.5 h-3.5 text-indigo-500" />} isDarkMode={isDarkMode}>
            <div className="space-y-0.5">
              {objects.entities.map((e) => {
                const active = e.key === objects.selectedKey;
                const on = isDarkMode ? 'bg-indigo-500/25 text-indigo-200' : 'bg-indigo-600/10 text-indigo-700';
                const off = isDarkMode ? 'hover:bg-white/5 text-slate-300' : 'hover:bg-black/5 text-slate-700';
                return (
                  <button key={e.key} onClick={() => objects.onSelect(e)}
                    className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-[11px] text-left ${active ? on : off}`}>
                    <span className={`w-1.5 h-1.5 rounded-sm ${active ? 'bg-yellow-400' : isDarkMode ? 'bg-slate-600' : 'bg-slate-300'}`} />
                    <span className="truncate">{e.label}</span>
                  </button>
                );
              })}
            </div>
          </Section>
        )}

        {/* ── Scene: units + axes + live coordinates ── */}
        <Section title="Scene" icon={<Grid3x3 className="w-3.5 h-3.5 text-indigo-500" />} isDarkMode={isDarkMode}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium">Units</span>
            <div className="flex items-center gap-1">
              {(['m', 'mm'] as LengthUnit[]).map((u) => (
                <button key={u} onClick={() => scene.onUnit(u)} className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${scene.unit === u ? (isDarkMode ? 'bg-indigo-500/30 text-indigo-200' : 'bg-indigo-600 text-white') : subtle}`}>{u}</button>
              ))}
            </div>
          </div>
          <Row label="Origin axes" checked={scene.axesVisible} onChange={scene.onAxesToggle} />
          <div className={`rounded-lg px-2 py-1.5 text-[10px] tabular-nums ${isDarkMode ? 'bg-slate-950/50' : 'bg-black/5'}`}>
            <div className="flex justify-between"><span className={subtle}>Camera</span>
              <span>{scene.cameraPos ? `${fmt(scene.cameraPos.x, scene.unit)}  ${fmt(scene.cameraPos.y, scene.unit)}  ${fmt(scene.cameraPos.z, scene.unit)}` : '—'}</span>
            </div>
            {arm && <div className="flex justify-between mt-0.5"><span className={subtle}>{arm.label}</span>
              <span>{fmt(arm.x, scene.unit)}  {fmt(arm.y, scene.unit)}  {(arm.yaw * 180 / Math.PI).toFixed(0)}°</span>
            </div>}
          </div>
        </Section>

        {/* ── Workcell: table shape + size (live) ── */}
        <Section title="Workcell (table)" icon={<Box className="w-3.5 h-3.5 text-indigo-500" />} isDarkMode={isDarkMode}>
          <Slider label="Sides (4 = rectangle)" unit="" min={3} max={8} step={1} value={wc.shapeSides} onChange={(v) => workcell.onChange({ ...wc, shapeSides: Math.round(v) })} subtle={subtle} />
          <Slider label="Length" unit="m" min={0.4} max={1.4} step={0.01} value={wc.length} onChange={(v) => workcell.onChange({ ...wc, length: v })} subtle={subtle} displayUnit={u} />
          <Slider label="Width" unit="m" min={0.4} max={1.4} step={0.01} value={wc.width} onChange={(v) => workcell.onChange({ ...wc, width: v })} subtle={subtle} displayUnit={u} />
          <Slider label="Rail height" unit="m" min={0.012} max={0.08} step={0.002} value={wc.barHeight} onChange={(v) => workcell.onChange({ ...wc, barHeight: v })} subtle={subtle} displayUnit={u} />
          <Slider label="Rail width" unit="m" min={0.012} max={0.08} step={0.002} value={wc.barWidth} onChange={(v) => workcell.onChange({ ...wc, barWidth: v })} subtle={subtle} displayUnit={u} />
          <Slider label="Camera-post height" unit="m" min={0.1} max={1.4} step={0.02} value={wc.postHeight} onChange={(v) => workcell.onChange({ ...wc, postHeight: v })} subtle={subtle} displayUnit={u} />
          <Slider label="Post X (right +)" unit="m" min={-0.6} max={0.6} step={0.005} value={wc.postX} onChange={(v) => workcell.onChange({ ...wc, postX: v })} subtle={subtle} displayUnit={u} />
          <Slider label="Post Y (forward +)" unit="m" min={-0.6} max={0.6} step={0.005} value={wc.postY} onChange={(v) => workcell.onChange({ ...wc, postY: v })} subtle={subtle} displayUnit={u} />

          {/* Extra mount posts — add your own uprights to mount cameras/sensors on (snappable). */}
          {(wc.extraPosts ?? []).map((ep, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className={`text-[9px] font-bold uppercase ${subtle} w-10`}>Post {i + 2}</span>
              <input type="number" step={0.01} value={Number(ep.x.toFixed(2))} onChange={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) { const next = [...wc.extraPosts]; next[i] = { ...next[i], x: v }; workcell.onChange({ ...wc, extraPosts: next }); } }} className={`w-12 bg-transparent text-right tabular-nums text-[10px] outline-none border-b border-transparent focus:border-indigo-400 ${subtle}`} />
              <input type="number" step={0.01} value={Number(ep.y.toFixed(2))} onChange={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) { const next = [...wc.extraPosts]; next[i] = { ...next[i], y: v }; workcell.onChange({ ...wc, extraPosts: next }); } }} className={`w-12 bg-transparent text-right tabular-nums text-[10px] outline-none border-b border-transparent focus:border-indigo-400 ${subtle}`} />
              <button onClick={() => workcell.onChange({ ...wc, extraPosts: wc.extraPosts.filter((_, j) => j !== i) })} className={`ml-auto px-1.5 rounded ${isDarkMode ? 'text-red-300 hover:bg-red-500/20' : 'text-red-600 hover:bg-red-50'}`} title="Remove post">✕</button>
            </div>
          ))}
          <button onClick={() => workcell.onChange({ ...wc, extraPosts: [...(wc.extraPosts ?? []), { x: 0, y: 0, height: wc.postHeight }] })} className={`w-full py-1 rounded-md text-[9px] font-bold uppercase tracking-wide ${isDarkMode ? 'bg-white/5 text-indigo-300 hover:bg-white/10' : 'bg-black/5 text-indigo-600 hover:bg-black/10'}`}>+ Add mount post</button>
          <p className={`text-[9px] ${subtle}`}>Edits apply live — no reload. Add posts to mount cameras on (snappable).</p>
        </Section>

        {/* ── Arms: placement + reachability ── */}
        <Section title="Arms (SO-101)" icon={<Crosshair className="w-3.5 h-3.5 text-emerald-500" />} isDarkMode={isDarkMode}
          action={<button onClick={arms.onAdd} title="Add an SO-101" className={`w-6 h-6 rounded-lg flex items-center justify-center ${isDarkMode ? 'bg-white/10 hover:bg-white/15' : 'bg-black/5 hover:bg-black/10'}`}><Plus className="w-3.5 h-3.5" /></button>}>
          {arm && <>
            <select value={arm.id} onChange={(e) => arms.onSelect(e.target.value)} className={`w-full rounded-lg px-2 py-1.5 text-[11px] font-semibold outline-none ${isDarkMode ? 'bg-slate-950/70 text-slate-100' : 'bg-white/70 text-slate-800'}`}>
              {arms.list.map((a) => <option key={a.id} value={a.id}>{a.label}{a.primary ? ' (primary)' : ''}</option>)}
            </select>
            <Slider label="X (right +)" unit="m" min={-0.6} max={0.6} step={0.01} value={arm.x} onChange={(v) => arms.onChange(arm.id, { x: v })} subtle={subtle} displayUnit={u} />
            <Slider label="Y (forward +)" unit="m" min={-0.6} max={0.6} step={0.01} value={arm.y} onChange={(v) => arms.onChange(arm.id, { y: v })} subtle={subtle} displayUnit={u} />
            <Slider label="Yaw" unit="°" min={-180} max={180} step={1} value={arm.yaw * 180 / Math.PI} onChange={(v) => arms.onChange(arm.id, { yaw: v * Math.PI / 180 })} subtle={subtle} />
            <div className="flex gap-2">
              <button onClick={arms.onApplyPose} disabled={arms.computing} className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide ${isDarkMode ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'} disabled:opacity-50`} title="Re-sync reach overlay (the base already moves live as you drag)">Recompute reach</button>
              {!arm.primary && <button onClick={() => arms.onRemove(arm.id)} title="Remove this arm" className={`w-9 rounded-lg flex items-center justify-center ${isDarkMode ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}><Trash2 className="w-3.5 h-3.5" /></button>}
            </div>
          </>}
          <div className="pt-1 space-y-1.5">
            <h5 className={`text-[8px] font-bold uppercase tracking-widest ${subtle}`}>Reach views</h5>
            {PLANNER_ROWS.map((r) => <Row key={r.key} label={r.label} checked={arms.toggles[r.key]} onChange={(v) => arms.onToggle(r.key, v)} accent="emerald" />)}
          </div>
          <Slider label="Compute detail" unit="" min={5} max={13} step={1} value={arms.resolution} onChange={arms.onResolution} subtle={subtle} suffix="⁴" />
          <button onClick={arms.onRecompute} disabled={arms.computing} className={`w-full py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide flex items-center justify-center gap-2 ${isDarkMode ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'} disabled:opacity-50`}>
            {arms.computing && <Loader2 className="w-3 h-3 animate-spin" />}{arms.computing ? 'Computing…' : 'Recompute reach'}
          </button>
          {arms.toggles.basePlacement && arms.baseResult && <p className={`text-[10px] text-center ${subtle}`}>Best mount covers <span className="font-bold text-emerald-500">{arms.baseResult.covered}/{arms.baseResult.total}</span> objects</p>}
          <button onClick={arms.onSuggestLayout} className={`w-full py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide ${isDarkMode ? 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`} title="Place all arms to maximise task coverage">Suggest optimal layout ({arms.list.length} {arms.list.length === 1 ? 'arm' : 'arms'})</button>
          {arms.layoutResult && <p className={`text-[10px] text-center ${subtle}`}>Layout reaches <span className="font-bold text-indigo-500">{arms.layoutResult.covered}/{arms.layoutResult.total}</span> objects top-down</p>}
        </Section>

        {/* ── Camera (D435i) ── */}
        <Section title="Camera (D435i)" icon={<Camera className="w-3.5 h-3.5 text-indigo-500" />} isDarkMode={isDarkMode}>
          <Row label="Show camera" checked={camera.toggles.enabled} onChange={(v) => camera.onToggle('enabled', v)} />
          <Row label="Wrist camera feed" checked={camera.wristEnabled} onChange={camera.onWristToggle} />
          {camera.wristEnabled && (
            <div className="pl-2 space-y-1 border-l-2 border-indigo-500/20">
              <Slider label="Wrist · back" unit="m" min={0} max={0.15} step={0.005} value={camera.wristMount.back} onChange={(v) => camera.onWristMount({ ...camera.wristMount, back: v })} subtle={subtle} displayUnit={u} />
              <Slider label="Wrist · up" unit="m" min={0} max={0.15} step={0.005} value={camera.wristMount.up} onChange={(v) => camera.onWristMount({ ...camera.wristMount, up: v })} subtle={subtle} displayUnit={u} />
              <Slider label="Wrist · reach" unit="m" min={0.02} max={0.3} step={0.01} value={camera.wristMount.reach} onChange={(v) => camera.onWristMount({ ...camera.wristMount, reach: v })} subtle={subtle} displayUnit={u} />
              <Slider label="Wrist · FOV" unit="°" min={30} max={100} step={1} value={camera.wristMount.fov} onChange={(v) => camera.onWristMount({ ...camera.wristMount, fov: v })} subtle={subtle} />
            </div>
          )}
          <div className={`flex gap-1.5 ${!camera.toggles.enabled ? 'opacity-40 pointer-events-none' : ''}`}>
            <ModeBtn active={camera.dragMode === 'translate'} onClick={() => camera.onDragMode('translate')} icon={<Move3d className="w-3.5 h-3.5" />} label="Move" isDarkMode={isDarkMode} />
            <ModeBtn active={camera.dragMode === 'rotate'} onClick={() => camera.onDragMode('rotate')} icon={<Rotate3d className="w-3.5 h-3.5" />} label="Aim" isDarkMode={isDarkMode} />
          </div>
          {/* Exact position entry — type real coordinates (origin = table centre) to replicate the rig. */}
          <div className={`space-y-1 ${!camera.toggles.enabled ? 'opacity-40 pointer-events-none' : ''}`}>
            <div className="flex items-center justify-between">
              <span className={`text-[8px] font-bold uppercase tracking-widest ${subtle}`}>Position ({u})</span>
              <div className="flex gap-2">
                <button onClick={camera.onSnapToPost} className="text-[8px] font-bold uppercase tracking-wide text-indigo-500 hover:text-indigo-400">Snap to post</button>
                <button onClick={camera.onAimDown} className="text-[8px] font-bold uppercase tracking-wide text-indigo-500 hover:text-indigo-400">Aim down</button>
              </div>
            </div>
            <Vec3Editor pos={camera.pos} unit={u} onChange={camera.onMove} subtle={subtle} />
          </div>
          <div className={`space-y-1.5 ${!camera.toggles.enabled ? 'opacity-40 pointer-events-none' : ''}`}>
            {CAMERA_ROWS.map((r) => <Row key={r.key} label={r.label} checked={camera.toggles[r.key]} onChange={(v) => camera.onToggle(r.key, v)} />)}
            <label className="block">
              <span className={`block text-[9px] font-bold uppercase tracking-widest ${subtle} mb-1`}>Stream profile</span>
              <select value={camera.selectedProfileId} onChange={(e) => camera.onStreamProfile(e.target.value)} className={`w-full rounded-lg px-2 py-1.5 text-[10px] font-semibold outline-none ${isDarkMode ? 'bg-slate-950/80 text-slate-200' : 'bg-white/70 text-slate-700'}`}>
                {camera.selectedProfileId === 'custom' && <option value="custom">Custom</option>}
                {camera.streamProfiles.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <Slider label="H-FOV" unit="°" min={40} max={95} step={0.1} value={camera.intrinsics.hFovDeg} onChange={(v) => camera.onIntrinsic('hFovDeg', v)} subtle={subtle} />
            <Slider label="Min range" unit="m" min={0.05} max={1.0} step={0.01} value={camera.intrinsics.near} onChange={(v) => camera.onIntrinsic('near', v)} subtle={subtle} displayUnit={u} />
            <Slider label="Max range" unit="m" min={1.0} max={6.0} step={0.1} value={camera.intrinsics.far} onChange={(v) => camera.onIntrinsic('far', v)} subtle={subtle} displayUnit={u} />
            <div className="flex gap-2">
              <button onClick={camera.onReset} className={`flex-1 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wide ${isDarkMode ? 'bg-white/5 text-slate-300 hover:bg-white/10' : 'bg-black/5 text-slate-600 hover:bg-black/10'}`}>Reset optics</button>
              {camera.toggles.coverage && <button onClick={camera.onComputeCoverage} className={`flex-1 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wide ${isDarkMode ? 'bg-indigo-500/20 text-indigo-300' : 'bg-indigo-50 text-indigo-600'}`}>Coverage</button>}
            </div>
          </div>
        </Section>

        {/* ── Measure ── */}
        {measure && (
          <Section title="Measure" icon={<Ruler className="w-3.5 h-3.5 text-amber-500" />} isDarkMode={isDarkMode}>
            <Row label="Measure mode (click two points)" checked={measure.active} onChange={measure.onToggleActive} accent="amber" />
            {measure.measurements.length === 0 && <p className={`text-[10px] ${subtle}`}>Enable, then click two objects or points. Shift-click = free point.</p>}
            {measure.measurements.map((m) => (
              <div key={m.id} className={`rounded-lg px-2 py-1.5 text-[10px] tabular-nums flex items-center justify-between ${isDarkMode ? 'bg-slate-950/50' : 'bg-black/5'}`}>
                <div>
                  <div className="font-bold">{m.label}: {fmt(m.distance, measure.unit)} {measure.unit}</div>
                  <div className={subtle}>Δ {fmt(m.dx, measure.unit)}, {fmt(m.dy, measure.unit)}, {fmt(m.dz, measure.unit)} {measure.unit}</div>
                </div>
                <button onClick={() => measure.onRemove(m.id)} className={subtle}><Trash2 className="w-3 h-3" /></button>
              </div>
            ))}
            {measure.measurements.length > 0 && <button onClick={measure.onClear} className={`w-full py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wide ${isDarkMode ? 'bg-white/5 text-slate-300' : 'bg-black/5 text-slate-600'}`}>Clear all</button>}
          </Section>
        )}
      </div>
    </div>
  );
}

function fmt(meters: number, unit: LengthUnit) {
  // compact (no unit suffix per-axis to save space); the section header states the unit context
  return unit === 'mm' ? `${Math.round(meters * 1000)}` : meters.toFixed(2);
}

function Section({ title, icon, isDarkMode, action, children }: { title: string; icon: ReactNode; isDarkMode: boolean; action?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const subtle = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-2 flex-1">
          {icon}
          <span className="text-[10px] font-bold uppercase tracking-widest">{title}</span>
          <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${subtle} ${open ? '' : '-rotate-90'}`} />
        </button>
        {action}
      </div>
      {open && <div className="mt-2 space-y-2">{children}</div>}
    </div>
  );
}

function Row({ label, checked, onChange, accent = 'indigo' }: { label: string; checked: boolean; onChange: (v: boolean) => void; accent?: 'indigo' | 'emerald' | 'amber' }) {
  const a = accent === 'emerald' ? 'accent-emerald-600' : accent === 'amber' ? 'accent-amber-500' : 'accent-indigo-600';
  return (
    <label className="flex items-center justify-between gap-2 cursor-pointer text-[11px] font-medium">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className={`${a} w-3.5 h-3.5`} />
    </label>
  );
}

function Slider({ label, unit, min, max, step, value, onChange, subtle, suffix, displayUnit }: { label: string; unit: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; subtle: string; suffix?: string; displayUnit?: LengthUnit }) {
  // Length sliders (unit==='m') show + accept the value in the active display unit (m or mm).
  const mm = displayUnit === 'mm' && unit === 'm';
  const shownUnit = mm ? 'mm' : unit;
  const toDisplay = (v: number) => (mm ? v * 1000 : v);
  const fromDisplay = (d: number) => (mm ? d / 1000 : d);
  const digits = mm ? 0 : unit === '°' || unit === '' ? (step >= 1 ? 0 : 1) : (step < 0.01 ? 3 : 2);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center text-[10px] font-medium gap-2">
        <span>{label}</span>
        {/* Editable value (CAD-style: drag the slider OR type a number). */}
        <span className={`flex items-center gap-0.5 ${subtle}`}>
          <input
            type="number" min={mm ? min * 1000 : min} max={mm ? max * 1000 : max} step={mm ? Math.max(1, step * 1000) : step}
            value={Number(toDisplay(value).toFixed(digits))}
            onChange={(e) => { const d = parseFloat(e.target.value); if (!Number.isNaN(d)) onChange(clamp(fromDisplay(d))); }}
            className="w-12 bg-transparent text-right tabular-nums outline-none border-b border-transparent focus:border-indigo-400"
          />
          <span>{shownUnit}{suffix ?? ''}</span>
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="w-full h-1 accent-indigo-600 cursor-pointer" />
    </div>
  );
}

// Three editable axis fields (X/Y/Z) in the active length unit. Origin = table centre.
function Vec3Editor({ pos, unit, onChange, subtle }: { pos: { x: number; y: number; z: number } | null; unit: LengthUnit; onChange: (x: number, y: number, z: number) => void; subtle: string }) {
  const mm = unit === 'mm';
  const toDisplay = (v: number) => (mm ? v * 1000 : v);
  const fromDisplay = (d: number) => (mm ? d / 1000 : d);
  const digits = mm ? 0 : 3;
  const axes: Array<{ k: 'x' | 'y' | 'z'; hue: string }> = [
    { k: 'x', hue: 'text-rose-500' },
    { k: 'y', hue: 'text-emerald-500' },
    { k: 'z', hue: 'text-sky-500' },
  ];
  const cur = pos ?? { x: 0, y: 0, z: 0 };
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {axes.map(({ k, hue }) => (
        <label key={k} className="flex items-center gap-1">
          <span className={`text-[9px] font-bold uppercase ${hue}`}>{k}</span>
          <input
            type="number" step={mm ? 1 : 0.005} disabled={!pos}
            value={Number(toDisplay(cur[k]).toFixed(digits))}
            onChange={(e) => {
              const d = parseFloat(e.target.value);
              if (Number.isNaN(d)) return;
              const next = { ...cur, [k]: fromDisplay(d) };
              onChange(next.x, next.y, next.z);
            }}
            className={`w-full bg-transparent text-right tabular-nums text-[10px] outline-none border-b border-transparent focus:border-indigo-400 ${subtle} disabled:opacity-40`}
          />
        </label>
      ))}
    </div>
  );
}

function ModeBtn({ active, onClick, icon, label, isDarkMode }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; isDarkMode: boolean }) {
  const on = isDarkMode ? 'bg-indigo-500/30 text-indigo-200' : 'bg-indigo-600 text-white';
  const off = isDarkMode ? 'bg-white/5 text-slate-400 hover:bg-white/10' : 'bg-black/5 text-slate-500 hover:bg-black/10';
  return <button onClick={onClick} className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide ${active ? on : off}`}>{icon}{label}</button>;
}
