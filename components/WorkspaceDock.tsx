/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Boxes, ChevronDown, Crosshair, Eye, EyeOff, Grid3x3, Loader2, Plus, Save, Search, Trash2 } from 'lucide-react';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { PlannerToggles } from '../WorkspacePlanner';
import { ArmInstance, LengthUnit, WorkcellConfig } from '../types';

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
  onAddStation: () => void;
  onRemoveStation: (id: string) => void;
  onCloneStation: (id: string) => void;
  onAddExtraCamera: () => void;
  onRemoveExtraCamera: (id: string) => void;
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
export interface DockObjectEntity { key: string; kind: 'arm' | 'camera' | 'post' | 'object' | 'station' | 'wristcam'; label: string; bodyId?: number; armId?: string; stationId?: string }
export interface DockObjectsProps {
  entities: DockObjectEntity[];
  selectedKey: string | null;
  onSelect: (e: DockObjectEntity) => void;
  hidden: Set<string>;
  onToggleVisible: (e: DockObjectEntity) => void;
}

interface WorkspaceDockProps {
  isDarkMode: boolean;
  objects?: DockObjectsProps;
  scene: DockSceneProps;
  workcell: DockWorkcellProps;
  arms: DockArmsProps;
  /** Open the layout-profiles panel to save/load the whole workspace. */
  onSaveWorkspace?: () => void;
}

/**
 * WorkspaceDock
 * One object-centric control dock. Each section maps to a thing you're laying out — the Scene,
 * the Workcell (table), the Arms, the Camera, and Measurements — with plain-language controls
 * and live coordinates. Replaces the old scattered CameraControls / ReachabilityControls /
 * CoordinatesHud panels.
 */
export function WorkspaceDock({ isDarkMode, objects, scene, workcell, arms, onSaveWorkspace }: WorkspaceDockProps) {
  const subtle = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const arm = arms.list.find((a) => a.id === arms.selectedId) ?? arms.list[0];
  const wc = workcell.config;
  const u = scene.unit; // active length unit (m / mm) for the length sliders

  // Search/filter the dock: type (or press '/') to keep only sections matching the query.
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement)?.tagName;
      if (e.key === '/' && t !== 'INPUT' && t !== 'TEXTAREA') { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const q = query.trim().toLowerCase();
  const matches = (kw: string) => !q || kw.toLowerCase().includes(q);
  const KW = ['objects tree entities task block arm camera post', 'scene units mm axes coordinates origin readout', 'workcell table shape length width rail post mount height', 'arms so-101 reach jog layout base envelope heatmap recompute', 'camera d435i fov frustum footprint pip stream profile wrist depth coverage move aim', 'measure distance dimension ruler'];
  const anyMatch = KW.some(matches);

  return (
    <div className={`absolute left-[3.75rem] top-4 bottom-4 z-30 w-72 rounded-2xl glass-panel shadow-xl overflow-hidden flex flex-col ${isDarkMode ? 'bg-slate-900/80 border-white/10 text-slate-100' : 'bg-white/75 border-white/80 text-slate-800'}`}>
      <div className="px-4 py-3 border-b border-black/5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-widest">Workspace</span>
          {onSaveWorkspace && (
            <button onClick={onSaveWorkspace} title="Save / load this workspace layout"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-colors ${isDarkMode ? 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
              <Save className="w-3.5 h-3.5" /> Save
            </button>
          )}
        </div>
        <span className={`block text-[9px] ${subtle} mt-1`}>origin = table center · X→ Y↑ Z out</span>
        <div className={`mt-2 flex items-center gap-1.5 px-2 py-1 rounded-md border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'}`}>
          <Search className={`w-3 h-3 ${subtle}`} />
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search controls…  ( / )" className={`flex-1 min-w-0 bg-transparent text-[11px] outline-none ${isDarkMode ? 'placeholder:text-slate-500' : 'placeholder:text-slate-400'}`} />
          {query && <button onClick={() => setQuery('')} className={`text-[10px] ${subtle}`}>✕</button>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar divide-y divide-black/5">
        {/* ── Objects: scene tree — click a row to select it in the 3D view ── */}
        {objects && (
          <Section title="Objects" defaultOpen={false} hidden={!matches(KW[0])} icon={<Boxes className="w-3.5 h-3.5 text-indigo-500" />} isDarkMode={isDarkMode}>
            <div className="space-y-0.5">
              {objects.entities.map((e) => {
                const active = e.key === objects.selectedKey;
                const isHidden = objects.hidden.has(e.key);
                const on = isDarkMode ? 'bg-indigo-500/25 text-indigo-200' : 'bg-indigo-600/10 text-indigo-700';
                const off = isDarkMode ? 'hover:bg-white/5 text-slate-300' : 'hover:bg-black/5 text-slate-700';
                return (
                  <div key={e.key} className={`group w-full flex items-center gap-2 pr-1 rounded-md ${active ? on : off}`}>
                    <button onClick={() => objects.onSelect(e)}
                      className={`flex-1 min-w-0 flex items-center gap-2 px-2 py-1 text-[11px] text-left ${isHidden ? 'opacity-40' : ''}`}>
                      <span className={`w-1.5 h-1.5 rounded-sm shrink-0 ${active ? 'bg-yellow-400' : isDarkMode ? 'bg-slate-600' : 'bg-slate-300'}`} />
                      <span className="truncate">{e.label}</span>
                    </button>
                    <button onClick={() => objects.onToggleVisible(e)} title={isHidden ? 'Show' : 'Hide'}
                      className={`shrink-0 p-1 rounded ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-black/10'} ${isHidden ? subtle : (isDarkMode ? 'text-slate-400' : 'text-slate-500')} ${isHidden ? '' : 'opacity-0 group-hover:opacity-100'}`}>
                      {isHidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    </button>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* ── Scene: units + axes + live coordinates ── */}
        <Section title="Scene" hidden={!matches(KW[1])} icon={<Grid3x3 className="w-3.5 h-3.5 text-indigo-500" />} isDarkMode={isDarkMode}>
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
        <Section title="Workcell (table)" hidden={!matches(KW[2])} icon={<Box className="w-3.5 h-3.5 text-indigo-500" />} isDarkMode={isDarkMode}>
          <p className={`text-[9px] ${subtle}`}>Shape, size, rails &amp; post live in the table's Selection card — right-click the table (or pick “Workcell (table)” above).</p>

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

          {/* Workstations — each is its own worktop + an arm, for laying out a multi-cell lab. */}
          <div className={`mt-2 pt-2 border-t ${isDarkMode ? 'border-white/10' : 'border-black/5'} space-y-1.5`}>
            <span className={`text-[9px] font-bold uppercase tracking-widest ${subtle}`}>Workstations</span>
            {(wc.stations ?? []).map((st, i) => (
              <div key={st.id} className="flex items-center gap-1.5">
                <span className={`text-[9px] font-bold uppercase ${subtle} w-12`}>Cell {i + 2}</span>
                <input type="number" step={0.05} value={Number(st.x.toFixed(2))} onChange={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) { const next = [...wc.stations]; next[i] = { ...next[i], x: v }; workcell.onChange({ ...wc, stations: next }); } }} className={`w-12 bg-transparent text-right tabular-nums text-[10px] outline-none border-b border-transparent focus:border-indigo-400 ${subtle}`} title="X" />
                <input type="number" step={0.05} value={Number(st.y.toFixed(2))} onChange={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) { const next = [...wc.stations]; next[i] = { ...next[i], y: v }; workcell.onChange({ ...wc, stations: next }); } }} className={`w-12 bg-transparent text-right tabular-nums text-[10px] outline-none border-b border-transparent focus:border-indigo-400 ${subtle}`} title="Y" />
                <button onClick={() => workcell.onCloneStation(st.id)} className={`ml-auto px-1.5 rounded ${isDarkMode ? 'text-indigo-300 hover:bg-white/10' : 'text-indigo-600 hover:bg-black/5'}`} title="Clone this workstation">⧉</button>
                <button onClick={() => workcell.onRemoveStation(st.id)} className={`px-1.5 rounded ${isDarkMode ? 'text-red-300 hover:bg-red-500/20' : 'text-red-600 hover:bg-red-50'}`} title="Remove workstation + its arm">✕</button>
              </div>
            ))}
            <button onClick={workcell.onAddStation} className={`w-full py-1 rounded-md text-[9px] font-bold uppercase tracking-wide ${isDarkMode ? 'bg-white/5 text-indigo-300 hover:bg-white/10' : 'bg-black/5 text-indigo-600 hover:bg-black/10'}`}>+ Add workstation (clone of primary)</button>
            <p className={`text-[9px] ${subtle}`}>Adds a copy of the primary worktop + an arm. ⧉ clones a station; select one to edit its shape/size.</p>
          </div>

          {/* Extra overhead D435i cameras — each looks straight down + gets a Feeds PIP. */}
          <div className={`mt-2 pt-2 border-t ${isDarkMode ? 'border-white/10' : 'border-black/5'} space-y-1.5`}>
            <span className={`text-[9px] font-bold uppercase tracking-widest ${subtle}`}>Overhead D435i cameras</span>
            {(wc.extraCameras ?? []).map((cam, i) => (
              <div key={cam.id} className="flex items-center gap-1.5">
                <span className={`text-[9px] font-bold uppercase ${subtle} w-12`}>Cam {i + 2}</span>
                {(['x', 'y', 'z'] as const).map((ax) => (
                  <input key={ax} type="number" step={0.05} value={Number(cam[ax].toFixed(2))} title={ax.toUpperCase()}
                    onChange={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) { const next = [...wc.extraCameras]; next[i] = { ...next[i], [ax]: v }; workcell.onChange({ ...wc, extraCameras: next }); } }}
                    className={`w-11 bg-transparent text-right tabular-nums text-[10px] outline-none border-b border-transparent focus:border-indigo-400 ${subtle}`} />
                ))}
                <button onClick={() => workcell.onRemoveExtraCamera(cam.id)} className={`ml-auto px-1.5 rounded ${isDarkMode ? 'text-red-300 hover:bg-red-500/20' : 'text-red-600 hover:bg-red-50'}`} title="Remove camera">✕</button>
              </div>
            ))}
            <button onClick={workcell.onAddExtraCamera} className={`w-full py-1 rounded-md text-[9px] font-bold uppercase tracking-wide ${isDarkMode ? 'bg-white/5 text-indigo-300 hover:bg-white/10' : 'bg-black/5 text-indigo-600 hover:bg-black/10'}`}>+ Add overhead camera</button>
            <p className={`text-[9px] ${subtle}`}>Each looks straight down from X/Y/Z; see its feed in the Feeds dock.</p>
          </div>
        </Section>

        {/* ── Arms: placement + reachability ── */}
        <Section title="Arms (SO-101)" hidden={!matches(KW[3])} icon={<Crosshair className="w-3.5 h-3.5 text-emerald-500" />} isDarkMode={isDarkMode}
          action={<button onClick={arms.onAdd} title="Add an SO-101" className={`w-6 h-6 rounded-lg flex items-center justify-center ${isDarkMode ? 'bg-white/10 hover:bg-white/15' : 'bg-black/5 hover:bg-black/10'}`}><Plus className="w-3.5 h-3.5" /></button>}>
          {arm && <>
            <select value={arm.id} onChange={(e) => arms.onSelect(e.target.value)} className={`w-full rounded-lg px-2 py-1.5 text-[11px] font-semibold outline-none ${isDarkMode ? 'bg-slate-950/70 text-slate-100' : 'bg-white/70 text-slate-800'}`}>
              {arms.list.map((a) => <option key={a.id} value={a.id}>{a.label}{a.primary ? ' (primary)' : ''}</option>)}
            </select>
            <p className={`text-[9px] ${subtle}`}>Position &amp; yaw: right-click the arm in the view (or pick it in Objects) — edit in the Selection card.</p>
            <div className="flex gap-2">
              <button onClick={arms.onApplyPose} disabled={arms.computing} className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide ${isDarkMode ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'} disabled:opacity-50`} title="Re-sync reach overlay (the base already moves live as you drag)">Recompute reach</button>
              {!arm.primary && <button onClick={() => arms.onRemove(arm.id)} title="Remove this arm" className={`w-9 rounded-lg flex items-center justify-center ${isDarkMode ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}><Trash2 className="w-3.5 h-3.5" /></button>}
            </div>
          </>}
          <p className={`text-[9px] ${subtle}`}>Reach overlays + per-arm remove live in the arm's Selection card (click an arm).</p>
          <Slider label="Compute detail" unit="" min={5} max={13} step={1} value={arms.resolution} onChange={arms.onResolution} subtle={subtle} suffix="⁴" />
          <button onClick={arms.onRecompute} disabled={arms.computing} className={`w-full py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide flex items-center justify-center gap-2 ${isDarkMode ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'} disabled:opacity-50`}>
            {arms.computing && <Loader2 className="w-3 h-3 animate-spin" />}{arms.computing ? 'Computing…' : 'Recompute reach'}
          </button>
          {arms.toggles.basePlacement && arms.baseResult && <p className={`text-[10px] text-center ${subtle}`}>Best mount covers <span className="font-bold text-emerald-500">{arms.baseResult.covered}/{arms.baseResult.total}</span> objects</p>}
          <button onClick={arms.onSuggestLayout} className={`w-full py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide ${isDarkMode ? 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`} title="Place all arms to maximise task coverage">Suggest optimal layout ({arms.list.length} {arms.list.length === 1 ? 'arm' : 'arms'})</button>
          {arms.layoutResult && <p className={`text-[10px] text-center ${subtle}`}>Layout reaches <span className="font-bold text-indigo-500">{arms.layoutResult.covered}/{arms.layoutResult.total}</span> objects top-down</p>}
        </Section>

        {!anyMatch && <div className={`px-4 py-6 text-center text-[11px] ${subtle}`}>No controls match “{query}”.</div>}
      </div>
    </div>
  );
}

function fmt(meters: number, unit: LengthUnit) {
  // compact (no unit suffix per-axis to save space); the section header states the unit context
  return unit === 'mm' ? `${Math.round(meters * 1000)}` : meters.toFixed(2);
}

function Section({ title, icon, isDarkMode, action, children, hidden, defaultOpen = true }: { title: string; icon: ReactNode; isDarkMode: boolean; action?: ReactNode; children: ReactNode; hidden?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const subtle = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  if (hidden) return null;
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
