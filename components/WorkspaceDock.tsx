/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Bookmark, Box, Boxes, Camera, ChevronDown, Eye, EyeOff, Grid3x3, Loader2, Package, PanelLeftClose, Plus, Save } from 'lucide-react';
import { ReactNode, useState } from 'react';
import { PlannerToggles } from '../WorkspacePlanner';
import type { LayoutProfile } from '../profiles';
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
  onAddProp?: () => void;
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
export interface DockObjectEntity { key: string; kind: 'arm' | 'camera' | 'post' | 'object' | 'station' | 'wristcam' | 'prop'; label: string; bodyId?: number; armId?: string; stationId?: string; propId?: string; postIndex?: number }
export interface DockObjectsProps {
  entities: DockObjectEntity[];
  selectedKey: string | null;
  onSelect: (e: DockObjectEntity) => void;
  hidden: Set<string>;
  onToggleVisible: (e: DockObjectEntity) => void;
}
export interface DockTemplatesProps {
  profiles: LayoutProfile[];
  onLoad: (p: LayoutProfile) => void;
  onSave: (name: string) => void;
}

interface WorkspaceDockProps {
  isDarkMode: boolean;
  objects?: DockObjectsProps;
  scene: DockSceneProps;
  workcell: DockWorkcellProps;
  arms: DockArmsProps;
  templates?: DockTemplatesProps;
  /** Open the layout-profiles panel to save/load the whole workspace. */
  onSaveWorkspace?: () => void;
  /** Collapse the dock (the matching open affordance is the top-left drawer button). */
  onClose?: () => void;
}

// Bodies grouping: every scene entity bucketed by kind, in a stable, readable order.
const OUTLINER_GROUPS: Array<{ kind: DockObjectEntity['kind']; label: string }> = [
  { kind: 'arm', label: 'Arms' },
  { kind: 'station', label: 'Workcells' },
  { kind: 'camera', label: 'Cameras' },
  { kind: 'wristcam', label: 'Wrist cams' },
  { kind: 'post', label: 'Posts' },
  { kind: 'prop', label: 'Props' },
  { kind: 'object', label: 'Objects' },
];

/** SO-101 arm glyph (provided) — used on the Insert palette card. */
function So101Icon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className} aria-hidden>
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5">
        <path d="m9.25 18.876l-6.512-4.682m3.002-2.673l5.143 3.813M.751 11.751a2.5 2.5 0 1 0 5 0a2.5 2.5 0 0 0-5 0m4.886-.746l5.611-5.465m-.856-3.962L1.257 10.25m8.492-7a2.5 2.5 0 1 0 5 0a2.5 2.5 0 0 0-5 0m6.545 4.132l-2.3-2.35m1.756 3.719a2 2 0 1 0 4 0a2 2 0 0 0-4 0" />
        <path d="M19.7 8.3a3 3 0 0 1 3.55 2.951m-3 3A3 3 0 0 1 17.3 10.7M1 23.251h22m-13.75 0V18a3 3 0 0 1 6 0v5.25" />
      </g>
    </svg>
  );
}

/** Mount-post glyph (provided) — used on the Insert palette card. */
function PostIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="currentColor" d="m11 3l1-1l1 1v17a2 2 0 0 1 2 2H9c0-1.1.9-2 2-2z" />
    </svg>
  );
}

/**
 * WorkspaceDock — the left "build" panel, organised as three jobs-to-be-done:
 *  • Insert — a click-to-add palette (also reachable via right-click → create here).
 *  • Outliner — every object in the scene, grouped by type; click to select, eye to hide.
 *  • Scene & templates — global toggles, the live coordinate readout, saved/built-in layout
 *    templates to load, and the reachability compute controls.
 * Per-item editing lives in each object's Selection card (right panel), not here.
 */
export function WorkspaceDock({ isDarkMode, objects, scene, workcell, arms, templates, onSaveWorkspace, onClose }: WorkspaceDockProps) {
  const subtle = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const arm = arms.list.find((a) => a.id === arms.selectedId) ?? arms.list[0];
  const wc = workcell.config;
  // Inline "save current layout" (the previous flow — a separate floating panel — was unclear).
  const [tplName, setTplName] = useState('');
  const [tplSaved, setTplSaved] = useState('');
  const saveTpl = () => { const n = tplName.trim(); if (!n || !templates) return; templates.onSave(n); setTplSaved(n); setTplName(''); setTimeout(() => setTplSaved(''), 2200); };

  return (
    <div className={`absolute left-[3.75rem] top-4 bottom-4 z-30 w-72 rounded-2xl glass-panel shadow-xl overflow-hidden flex flex-col ${isDarkMode ? 'bg-slate-900/80 border-white/10 text-slate-100' : 'bg-white/75 border-white/80 text-slate-800'}`}>
      <div className="px-4 py-3 border-b border-black/5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-widest">Workspace</span>
          {onClose && (
            <button onClick={onClose} title="Collapse dock" className={`p-1.5 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-white/10 text-slate-400' : 'hover:bg-black/10 text-slate-500'}`}>
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
        </div>
        <span className={`block text-[9px] ${subtle} mt-1`}>origin = table center · X→ Y↑ Z out</span>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar divide-y divide-black/5">
        {/* ── Templates (saved layouts): load / save profiles — at the top so it's the first thing ── */}
        <Section title="Layouts" icon={<Bookmark className="w-3.5 h-3.5 text-indigo-500" />} isDarkMode={isDarkMode}
          action={onSaveWorkspace ? <button onClick={onSaveWorkspace} className="text-[9px] font-bold uppercase tracking-wide text-indigo-500 hover:text-indigo-400">Manage</button> : undefined}>
          <div className="flex items-center gap-1.5">
            <input value={tplName} onChange={(e) => setTplName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveTpl()}
              placeholder="Name this layout to save it" className={`flex-1 min-w-0 px-2 py-1 rounded-md text-[11px] outline-none border ${isDarkMode ? 'bg-white/5 border-white/10 placeholder:text-slate-500' : 'bg-black/5 border-black/10 placeholder:text-slate-400'}`} />
            <button onClick={saveTpl} disabled={!tplName.trim()} title={tplName.trim() ? 'Save this layout' : 'Type a name first'} className="px-2 py-1 rounded-md bg-indigo-600 text-white text-[10px] font-bold uppercase flex items-center gap-1 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed">
              <Save className="w-3 h-3" /> Save
            </button>
          </div>
          {tplSaved
            ? <p className="text-[9px] text-emerald-500 font-medium">Saved “{tplSaved}” on this device ✓</p>
            : <p className={`text-[9px] ${subtle}`}>Saved on this device. Share via Manage → Export JSON → presets.ts.</p>}
          {(!templates || templates.profiles.length === 0)
            ? <p className={`text-[9px] ${subtle}`}>No saved layouts yet.</p>
            : templates.profiles.slice(0, 8).map((p) => (
              <button key={p.name} onClick={() => templates.onLoad(p)} title="Load this layout"
                className={`w-full flex items-center gap-2 rounded-md px-2 py-1 text-left ${isDarkMode ? 'hover:bg-white/5' : 'hover:bg-black/5'}`}>
                <Bookmark className="w-3 h-3 text-indigo-400 shrink-0" />
                <span className="text-[11px] font-medium truncate flex-1">{p.name}</span>
                {p.builtin && <span className={`text-[8px] font-bold uppercase px-1 py-0.5 rounded ${isDarkMode ? 'bg-white/10 text-slate-300' : 'bg-black/10 text-slate-500'}`}>built-in</span>}
                <span className={`text-[9px] ${subtle}`}>{p.arms.length}a</span>
              </button>
            ))}
        </Section>

        {/* ── Insert: click-to-add palette (mirrors the right-click → create-here radial) ── */}
        <Section title="Insert" icon={<Plus className="w-3.5 h-3.5 text-indigo-500" />} isDarkMode={isDarkMode}>
          <div className="grid grid-cols-2 gap-1.5">
            <InsertCard icon={<So101Icon className="w-4 h-4" />} label="SO-101" onClick={arms.onAdd} isDarkMode={isDarkMode} />
            <InsertCard icon={<Camera className="w-4 h-4" />} label="D435i cam" onClick={workcell.onAddExtraCamera} isDarkMode={isDarkMode} />
            <InsertCard icon={<Box className="w-4 h-4" />} label="Workstation" onClick={workcell.onAddStation} isDarkMode={isDarkMode} />
            <InsertCard icon={<PostIcon className="w-4 h-4" />} label="Mount post" onClick={() => workcell.onChange({ ...wc, extraPosts: [...(wc.extraPosts ?? []), { x: 0, y: 0, height: wc.postHeight }] })} isDarkMode={isDarkMode} />
            {arms.onAddProp && <InsertCard icon={<Package className="w-4 h-4" />} label="Object" onClick={arms.onAddProp} isDarkMode={isDarkMode} />}
          </div>
          <p className={`text-[9px] ${subtle}`}>Adds at the origin. Or right-click / double-click empty space to place at a point.</p>
        </Section>

        {/* ── Bodies: every object in the scene, grouped by type ── */}
        {objects && (
          <Section title="Bodies" icon={<Boxes className="w-3.5 h-3.5 text-indigo-500" />} isDarkMode={isDarkMode}>
            <div className="space-y-2">
              {OUTLINER_GROUPS.map(({ kind, label }) => {
                const rows = objects.entities.filter((e) => e.kind === kind);
                if (rows.length === 0) return null;
                return (
                  <div key={kind} className="space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className={`text-[8px] font-bold uppercase tracking-widest ${subtle}`}>{label}</span>
                      <span className={`text-[8px] font-bold tabular-nums ${subtle}`}>{rows.length}</span>
                    </div>
                    {rows.map((e) => {
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
                );
              })}
            </div>
          </Section>
        )}

        {/* ── Scene: global toggles, coords, reachability ── */}
        <Section title="Scene" icon={<Grid3x3 className="w-3.5 h-3.5 text-indigo-500" />} isDarkMode={isDarkMode}>
          <Row label="Origin axes" checked={scene.axesVisible} onChange={scene.onAxesToggle} />
          <div className={`rounded-lg px-2 py-1.5 text-[10px] tabular-nums ${isDarkMode ? 'bg-slate-950/50' : 'bg-black/5'}`}>
            <div className="flex justify-between"><span className={subtle}>Camera</span>
              <span>{scene.cameraPos ? `${fmt(scene.cameraPos.x, scene.unit)}  ${fmt(scene.cameraPos.y, scene.unit)}  ${fmt(scene.cameraPos.z, scene.unit)}` : '—'}</span>
            </div>
            {arm && <div className="flex justify-between mt-0.5"><span className={subtle}>{arm.label}</span>
              <span>{fmt(arm.x, scene.unit)}  {fmt(arm.y, scene.unit)}  {(arm.yaw * 180 / Math.PI).toFixed(0)}°</span>
            </div>}
          </div>

          {/* Reachability — global compute (per-arm reach views live in the arm's Selection card). */}
          <div className={`pt-1.5 mt-1 border-t ${isDarkMode ? 'border-white/10' : 'border-black/5'} space-y-1.5`}>
            <span className={`text-[8px] font-bold uppercase tracking-widest ${subtle}`}>Reachability</span>
            <Slider label="Compute detail" unit="" min={5} max={13} step={1} value={arms.resolution} onChange={arms.onResolution} subtle={subtle} suffix="⁴" />
            <button onClick={arms.onRecompute} disabled={arms.computing} className={`w-full py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide flex items-center justify-center gap-2 ${isDarkMode ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'} disabled:opacity-50`}>
              {arms.computing && <Loader2 className="w-3 h-3 animate-spin" />}{arms.computing ? 'Computing…' : 'Recompute reach'}
            </button>
            {arms.toggles.basePlacement && arms.baseResult && <p className={`text-[10px] text-center ${subtle}`}>Best mount covers <span className="font-bold text-emerald-500">{arms.baseResult.covered}/{arms.baseResult.total}</span> objects</p>}
            <button onClick={arms.onSuggestLayout} className={`w-full py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide ${isDarkMode ? 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`} title="Place all arms to maximise task coverage">Suggest optimal layout ({arms.list.length} {arms.list.length === 1 ? 'arm' : 'arms'})</button>
            {arms.layoutResult && <p className={`text-[10px] text-center ${subtle}`}>Layout reaches <span className="font-bold text-indigo-500">{arms.layoutResult.covered}/{arms.layoutResult.total}</span> objects top-down</p>}
          </div>
        </Section>
      </div>
    </div>
  );
}

function fmt(meters: number, unit: LengthUnit) {
  // compact (no unit suffix per-axis to save space); the section header states the unit context
  return unit === 'mm' ? `${Math.round(meters * 1000)}` : meters.toFixed(2);
}

function InsertCard({ icon, label, onClick, isDarkMode }: { icon: ReactNode; label: string; onClick: () => void; isDarkMode: boolean }) {
  return (
    <button onClick={onClick} title={`Add ${label}`}
      className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border transition-colors ${isDarkMode ? 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10' : 'bg-black/[0.03] border-black/10 text-slate-700 hover:bg-black/[0.06]'}`}>
      <span className="text-indigo-500">{icon}</span>
      <span className="text-[10px] font-bold uppercase tracking-wide">{label}</span>
    </button>
  );
}

function Section({ title, icon, isDarkMode, action, children, defaultOpen = true }: { title: string; icon: ReactNode; isDarkMode: boolean; action?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
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
