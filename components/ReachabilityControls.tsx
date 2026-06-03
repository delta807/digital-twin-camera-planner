/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ChevronDown, Crosshair, Loader2, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PlannerToggles } from '../WorkspacePlanner';
import { ArmInstance, WorkcellConfig } from '../types';

interface ReachabilityControlsProps {
  toggles: PlannerToggles;
  onToggle: (key: keyof PlannerToggles, value: boolean) => void;
  resolution: number;
  onResolution: (v: number) => void;
  onRecompute: () => void;
  computing: boolean;
  baseResult: { covered: number; total: number } | null;
  workcell: WorkcellConfig;
  onWorkcellChange: (next: WorkcellConfig) => void;
  onApplyWorkcell: () => void;
  arms: ArmInstance[];
  selectedArmId: string;
  onSelectArm: (id: string) => void;
  onArmChange: (id: string, patch: Partial<ArmInstance>) => void;
  onAddArm: () => void;
  onRemoveArm: (id: string) => void;
  onApplyArmPose: () => void;
  isDarkMode: boolean;
}

const VIEW_ROWS: Array<{ key: keyof PlannerToggles; label: string }> = [
  { key: 'outline', label: 'Reach outline' },
  { key: 'reach', label: 'Reach heatmap' },
  { key: 'basePlacement', label: 'Base placement' },
  { key: 'tasks', label: 'Task points' },
  { key: 'baseDrag', label: 'Drag base (reload)' },
];

/**
 * ReachabilityControls
 * Panel to compute/toggle the SO-101 reachability heatmap and inverse base-placement.
 */
export function ReachabilityControls(props: ReachabilityControlsProps) {
  const {
    toggles,
    onToggle,
    resolution,
    onResolution,
    onRecompute,
    computing,
    baseResult,
    workcell,
    onWorkcellChange,
    onApplyWorkcell,
    arms,
    selectedArmId,
    onSelectArm,
    onArmChange,
    onAddArm,
    onRemoveArm,
    onApplyArmPose,
    isDarkMode,
  } = props;
  const [open, setOpen] = useState(true);
  const panelStyle = isDarkMode ? 'bg-slate-900/80 border-white/10 text-slate-100' : 'bg-white/70 border-white/80 text-slate-800';
  const subtle = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const section = isDarkMode ? 'border-white/10' : 'border-black/5';
  const selectedArm = arms.find((arm) => arm.id === selectedArmId) ?? arms[0];

  return (
    <div className={`absolute left-4 bottom-28 z-30 w-64 max-h-[44vh] rounded-2xl glass-panel shadow-xl overflow-hidden ${panelStyle}`}>
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-black/5">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-2 flex-1">
          <Crosshair className="w-4 h-4 text-emerald-500" />
          <span className="text-[11px] font-bold uppercase tracking-widest">Reachability</span>
          <ChevronDown className={`w-3.5 h-3.5 ml-auto transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
      </div>

      {open && (
        <div className="p-3 space-y-3 overflow-y-auto custom-scrollbar max-h-[calc(44vh-2.75rem)]">
          <div className="space-y-1.5">
            {VIEW_ROWS.map((r) => (
              <label key={r.key} className="flex items-center justify-between gap-2 cursor-pointer text-[11px] font-medium">
                <span>{r.label}</span>
                <input type="checkbox" checked={toggles[r.key]} onChange={(e) => onToggle(r.key, e.target.checked)} className="accent-emerald-600 w-3.5 h-3.5" />
              </label>
            ))}
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[10px] font-medium">
              <span>Resolution</span>
              <span className={subtle}>{resolution}{'⁴'} configs</span>
            </div>
            <input type="range" min={5} max={13} step={1} value={resolution} onChange={(e) => onResolution(parseInt(e.target.value))} className="w-full h-1 accent-emerald-600 cursor-pointer" />
          </div>

          <button
            onClick={onRecompute}
            disabled={computing}
            className={`w-full py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-colors ${isDarkMode ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'} disabled:opacity-50`}
          >
            {computing && <Loader2 className="w-3 h-3 animate-spin" />}
            {computing ? 'Computing…' : 'Recompute'}
          </button>

          {toggles.basePlacement && baseResult && (
            <p className={`text-[10px] text-center font-medium ${subtle}`}>
              Best mount covers <span className="font-bold text-emerald-500">{baseResult.covered}/{baseResult.total}</span> objects
            </p>
          )}

          <div className={`pt-3 border-t ${section} space-y-2`}>
            <h4 className={`text-[8px] font-bold uppercase tracking-widest ${subtle}`}>Base geometry</h4>
            <Slider label="Length" unit="m" min={0.7} max={1.4} step={0.01} value={workcell.length} onChange={(v) => onWorkcellChange({ ...workcell, length: v })} subtle={subtle} />
            <Slider label="Width" unit="m" min={0.7} max={1.4} step={0.01} value={workcell.width} onChange={(v) => onWorkcellChange({ ...workcell, width: v })} subtle={subtle} />
            <Slider label="Bar H" unit="m" min={0.01} max={0.08} step={0.002} value={workcell.barHeight} onChange={(v) => onWorkcellChange({ ...workcell, barHeight: v })} subtle={subtle} />
            <Slider label="Bar W" unit="m" min={0.01} max={0.08} step={0.002} value={workcell.barWidth} onChange={(v) => onWorkcellChange({ ...workcell, barWidth: v })} subtle={subtle} />
            <Slider label="Post H" unit="m" min={0.1} max={1.4} step={0.02} value={workcell.postHeight} onChange={(v) => onWorkcellChange({ ...workcell, postHeight: v })} subtle={subtle} />
            <Slider label="Sides" unit="" min={3} max={8} step={1} value={workcell.shapeSides} onChange={(v) => onWorkcellChange({ ...workcell, shapeSides: Math.round(v) })} subtle={subtle} />
            <button
              onClick={onApplyWorkcell}
              disabled={computing}
              className={`w-full py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-colors ${isDarkMode ? 'bg-slate-800 text-slate-200 hover:bg-slate-700' : 'bg-slate-900 text-white hover:bg-black'} disabled:opacity-50`}
            >
              Apply base
            </button>
          </div>

          {selectedArm && (
            <div className={`pt-3 border-t ${section} space-y-2`}>
              <div className="flex items-center justify-between gap-2">
                <h4 className={`text-[8px] font-bold uppercase tracking-widest ${subtle}`}>SO101 arms</h4>
                <button onClick={onAddArm} className={`w-7 h-7 rounded-lg flex items-center justify-center ${isDarkMode ? 'bg-white/10 hover:bg-white/15' : 'bg-black/5 hover:bg-black/10'}`} title="Add SO101">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              <select
                value={selectedArm.id}
                onChange={(e) => onSelectArm(e.target.value)}
                className={`w-full rounded-xl px-2 py-1.5 text-[11px] font-semibold outline-none ${isDarkMode ? 'bg-slate-950/70 text-slate-100' : 'bg-white/70 text-slate-800'}`}
              >
                {arms.map((arm) => <option key={arm.id} value={arm.id}>{arm.label}</option>)}
              </select>
              <Slider label="X" unit="m" min={-0.6} max={0.6} step={0.01} value={selectedArm.x} onChange={(v) => onArmChange(selectedArm.id, { x: v })} subtle={subtle} />
              <Slider label="Y" unit="m" min={-0.6} max={0.6} step={0.01} value={selectedArm.y} onChange={(v) => onArmChange(selectedArm.id, { y: v })} subtle={subtle} />
              <Slider label="Yaw" unit="°" min={-180} max={180} step={1} value={radToDeg(selectedArm.yaw)} onChange={(v) => onArmChange(selectedArm.id, { yaw: degToRad(v) })} subtle={subtle} />
              <div className="flex gap-2">
                <button
                  onClick={onApplyArmPose}
                  disabled={computing}
                  className={`flex-1 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-colors ${isDarkMode ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'} disabled:opacity-50`}
                >
                  Apply pose
                </button>
                {!selectedArm.primary && (
                  <button onClick={() => onRemoveArm(selectedArm.id)} className={`w-10 rounded-xl flex items-center justify-center ${isDarkMode ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25' : 'bg-red-50 text-red-600 hover:bg-red-100'}`} title="Remove selected SO101">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function degToRad(value: number) {
  return value * Math.PI / 180;
}

function radToDeg(value: number) {
  return value * 180 / Math.PI;
}

function Slider({ label, unit, min, max, step, value, onChange, subtle }: { label: string; unit: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; subtle: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] font-medium">
        <span>{label}</span>
        <span className={subtle}>{value.toFixed(unit === '°' || unit === '' ? 0 : 2)}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="w-full h-1 accent-emerald-600 cursor-pointer" />
    </div>
  );
}
