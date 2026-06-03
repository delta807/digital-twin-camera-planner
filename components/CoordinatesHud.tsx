/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Axis3d } from 'lucide-react';
import { ArmInstance, LengthUnit, formatLen } from '../types';

interface CoordinatesHudProps {
  cameraPos: { x: number; y: number; z: number } | null;
  arms: ArmInstance[];
  selectedArmId: string;
  unit: LengthUnit;
  onUnit: (u: LengthUnit) => void;
  axesVisible: boolean;
  onAxesToggle: (v: boolean) => void;
  isDarkMode: boolean;
}

/**
 * CoordinatesHud
 * Live world-coordinate readout (origin = table center) for the camera and the selected arm,
 * with a metre/millimetre toggle and an origin-axes toggle. So you always know where things sit.
 */
export function CoordinatesHud({ cameraPos, arms, selectedArmId, unit, onUnit, axesVisible, onAxesToggle, isDarkMode }: CoordinatesHudProps) {
  const panel = isDarkMode ? 'bg-slate-900/80 border-white/10 text-slate-100' : 'bg-white/70 border-white/80 text-slate-800';
  const subtle = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const arm = arms.find((a) => a.id === selectedArmId) ?? arms[0];

  const Axis = ({ c, v }: { c: string; v: number }) => (
    <span className="tabular-nums"><span className={subtle}>{c}</span> {formatLen(v, unit)}</span>
  );

  return (
    <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-20 rounded-2xl glass-panel shadow-lg px-4 py-2.5 ${panel}`}>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Axis3d className="w-3.5 h-3.5 text-indigo-500" />
          <span className="text-[9px] font-bold uppercase tracking-widest">Coords · origin = table center</span>
        </div>
        <div className="flex items-center gap-1">
          {(['m', 'mm'] as LengthUnit[]).map((u) => (
            <button
              key={u}
              onClick={() => onUnit(u)}
              className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide transition-colors ${unit === u ? (isDarkMode ? 'bg-indigo-500/30 text-indigo-200' : 'bg-indigo-600 text-white') : subtle}`}
            >
              {u}
            </button>
          ))}
          <label className="flex items-center gap-1 ml-1 cursor-pointer text-[9px] font-bold uppercase tracking-wide">
            <input type="checkbox" checked={axesVisible} onChange={(e) => onAxesToggle(e.target.checked)} className="accent-indigo-600 w-3 h-3" />
            axes
          </label>
        </div>
      </div>
      <div className="flex items-center gap-5 mt-1.5 text-[11px] font-medium">
        <div className="flex items-center gap-2">
          <span className={`text-[9px] font-bold uppercase ${subtle}`}>Cam</span>
          {cameraPos
            ? <><Axis c="X" v={cameraPos.x} /><Axis c="Y" v={cameraPos.y} /><Axis c="Z" v={cameraPos.z} /></>
            : <span className={subtle}>—</span>}
        </div>
        {arm && (
          <div className="flex items-center gap-2">
            <span className={`text-[9px] font-bold uppercase ${subtle}`}>{arm.label}</span>
            <Axis c="X" v={arm.x} /><Axis c="Y" v={arm.y} />
            <span className="tabular-nums"><span className={subtle}>yaw</span> {(arm.yaw * 180 / Math.PI).toFixed(0)}°</span>
          </div>
        )}
      </div>
    </div>
  );
}
