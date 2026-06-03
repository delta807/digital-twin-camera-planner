/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Camera, ChevronDown, Move3d, Rotate3d } from 'lucide-react';
import { useState } from 'react';
import { CameraIntrinsics, CameraStreamProfile, CameraViewToggles } from '../types';

interface CameraControlsProps {
  toggles: CameraViewToggles;
  onToggle: (key: keyof CameraViewToggles, value: boolean) => void;
  intrinsics: CameraIntrinsics;
  onIntrinsic: (key: keyof CameraIntrinsics, value: number) => void;
  onResetIntrinsics: () => void;
  streamProfiles: CameraStreamProfile[];
  selectedProfileId: string;
  onStreamProfile: (id: string) => void;
  dragMode: 'translate' | 'rotate';
  onDragMode: (mode: 'translate' | 'rotate') => void;
  onComputeCoverage: () => void;
  isDarkMode: boolean;
}

const VIEW_ROWS: Array<{ key: keyof CameraViewToggles; label: string }> = [
  { key: 'frustum', label: 'FOV frustum' },
  { key: 'sensorPip', label: 'Sensor view (PIP)' },
  { key: 'footprint', label: 'Ground footprint' },
  { key: 'objectTint', label: 'Highlight in view' },
  { key: 'coverage', label: 'Coverage (occlusion)' },
];

/**
 * CameraControls
 * Collapsible panel to place/aim the sensor camera, toggle its overlays, and tune its
 * D435i optics. Pure presentation — all state lives in App and drives WorkspaceCameraRig.
 */
export function CameraControls(props: CameraControlsProps) {
  const { toggles, onToggle, intrinsics, onIntrinsic, onResetIntrinsics, streamProfiles, selectedProfileId, onStreamProfile, dragMode, onDragMode, onComputeCoverage, isDarkMode } = props;
  const [open, setOpen] = useState(true);

  const panelStyle = isDarkMode ? 'bg-slate-900/80 border-white/10 text-slate-100' : 'bg-white/70 border-white/80 text-slate-800';
  const subtle = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const disabled = !toggles.enabled;

  return (
    <div className={`absolute left-4 top-20 z-30 w-60 rounded-2xl glass-panel shadow-xl overflow-hidden ${panelStyle}`}>
      {/* Header / master enable */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-black/5">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-2 flex-1">
          <Camera className="w-4 h-4 text-indigo-500" />
          <span className="text-[11px] font-bold uppercase tracking-widest">Camera Planner</span>
          <ChevronDown className={`w-3.5 h-3.5 ml-auto transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
      </div>

      {open && (
        <div className="p-3 space-y-3">
          {/* Master toggle */}
          <Row label="Show camera" checked={toggles.enabled} onChange={(v) => onToggle('enabled', v)} />

          {/* Move / Aim */}
          <div className={`flex gap-1.5 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
            <ModeBtn active={dragMode === 'translate'} onClick={() => onDragMode('translate')} icon={<Move3d className="w-3.5 h-3.5" />} label="Move" isDarkMode={isDarkMode} />
            <ModeBtn active={dragMode === 'rotate'} onClick={() => onDragMode('rotate')} icon={<Rotate3d className="w-3.5 h-3.5" />} label="Aim" isDarkMode={isDarkMode} />
          </div>

          {/* View toggles */}
          <div className={`space-y-1.5 pt-1 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
            <h4 className={`text-[8px] font-bold uppercase tracking-widest ${subtle}`}>Views</h4>
            {VIEW_ROWS.map((r) => (
              <Row key={r.key} label={r.label} checked={toggles[r.key]} onChange={(v) => onToggle(r.key, v)} />
            ))}
          </div>

          {/* Intrinsics */}
          <div className={`space-y-2 pt-1 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
            <div className="flex items-center justify-between">
              <h4 className={`text-[8px] font-bold uppercase tracking-widest ${subtle}`}>Optics (D435i)</h4>
              <button onClick={onResetIntrinsics} className="text-[8px] font-bold uppercase tracking-widest text-indigo-500 hover:text-indigo-400">Reset</button>
            </div>
            <label className="space-y-1 block">
              <span className={`block text-[9px] font-bold uppercase tracking-widest ${subtle}`}>Stream profile</span>
              <select
                value={selectedProfileId}
                onChange={(e) => onStreamProfile(e.target.value)}
                className={`w-full rounded-lg border px-2 py-1.5 text-[10px] font-semibold outline-none ${isDarkMode ? 'border-white/10 bg-slate-950/80 text-slate-200' : 'border-black/10 bg-white/70 text-slate-700'}`}
              >
                {selectedProfileId === 'custom' && <option value="custom">Custom</option>}
                {streamProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.label}</option>
                ))}
              </select>
            </label>
            <Slider label="H-FOV" unit="°" min={40} max={95} step={0.1} value={intrinsics.hFovDeg} onChange={(v) => onIntrinsic('hFovDeg', v)} subtle={subtle} />
            <Slider label="Near" unit="m" min={0.05} max={1.0} step={0.01} value={intrinsics.near} onChange={(v) => onIntrinsic('near', v)} subtle={subtle} />
            <Slider label="Far" unit="m" min={1.0} max={6.0} step={0.1} value={intrinsics.far} onChange={(v) => onIntrinsic('far', v)} subtle={subtle} />
          </div>

          {toggles.coverage && (
            <button onClick={onComputeCoverage} className={`w-full py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-colors ${isDarkMode ? 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'} ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
              Recompute coverage
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 cursor-pointer text-[11px] font-medium">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-indigo-600 w-3.5 h-3.5" />
    </label>
  );
}

function Slider({ label, unit, min, max, step, value, onChange, subtle }: { label: string; unit: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; subtle: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] font-medium">
        <span>{label}</span>
        <span className={subtle}>{value.toFixed(unit === '°' ? 1 : 2)}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="w-full h-1 accent-indigo-600 cursor-pointer" />
    </div>
  );
}

function ModeBtn({ active, onClick, icon, label, isDarkMode }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; isDarkMode: boolean }) {
  const base = 'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wide transition-colors';
  const on = isDarkMode ? 'bg-indigo-500/30 text-indigo-200' : 'bg-indigo-600 text-white';
  const off = isDarkMode ? 'bg-white/5 text-slate-400 hover:bg-white/10' : 'bg-black/5 text-slate-500 hover:bg-black/10';
  return (
    <button onClick={onClick} className={`${base} ${active ? on : off}`}>{icon}{label}</button>
  );
}
