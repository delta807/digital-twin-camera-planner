/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ComponentType, useState } from 'react';
import { Box, Move3d, Columns2, Bookmark } from 'lucide-react';

export type WorkMode = 'edit' | 'compare';

interface Props {
  mode: WorkMode;
  onMode: (m: WorkMode) => void;
  dockOpen: boolean;
  onToggleDock: () => void;
  perceiveOpen: boolean;
  onTogglePerceive: () => void;
  layoutsOpen: boolean;
  onToggleLayouts: () => void;
  analysisOpen: boolean;
  onToggleAnalysis: () => void;
  isDarkMode: boolean;
}

/** Workspace-analysis icon (a monitor with bar-chart + stand) — provided by the user, not in lucide. */
export function AnalysisIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" className={className} aria-hidden="true">
      <path fill="currentColor" d="m665.2 768l110.9 192h-73.9L591.4 768H433L322.2 960h-73.9l110.9-192H160a32 32 0 0 1-32-32V192H64a32 32 0 0 1 0-64h896a32 32 0 1 1 0 64h-64v544a32 32 0 0 1-32 32zM832 192H192v512h640zM352 448a32 32 0 0 1 32 32v64a32 32 0 0 1-64 0v-64a32 32 0 0 1 32-32m160-64a32 32 0 0 1 32 32v128a32 32 0 0 1-64 0V416a32 32 0 0 1 32-32m160-64a32 32 0 0 1 32 32v192a32 32 0 1 1-64 0V352a32 32 0 0 1 32-32" />
    </svg>
  );
}

function RailBtn({ icon: Icon, label, active, accent, onClick, isDarkMode }: {
  icon: ComponentType<{ className?: string }>; label: string; active?: boolean; accent?: boolean; onClick: () => void; isDarkMode: boolean;
}) {
  const [hover, setHover] = useState(false);
  const bg = active
    ? accent ? 'bg-indigo-600 text-white' : 'bg-indigo-500/20 text-indigo-500'
    : hover ? (isDarkMode ? 'bg-white/10' : 'bg-black/5') : 'text-current opacity-60';
  return (
    <div className="relative" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
      <button onClick={onClick} aria-label={label} aria-pressed={active} className={`w-10 h-10 rounded-xl grid place-items-center transition-colors ${bg}`}>
        <Icon className="w-[18px] h-[18px]" />
      </button>
      {hover && (
        <div className={`absolute left-[3rem] top-2 whitespace-nowrap z-50 px-2 py-1 rounded-md text-[11px] shadow-lg pointer-events-none ${isDarkMode ? 'bg-slate-800 text-slate-100 border border-white/10' : 'bg-white text-slate-700 border border-black/10'}`}>{label}</div>
      )}
    </div>
  );
}

/**
 * ModeRail — the lab-instrument left icon rail: brand mark, the Edit/Compare work modes, and
 * dock / perceive toggles. Sits at the far-left edge; the dock + left-anchored overlays shift right.
 */
export function ModeRail({ mode, onMode, dockOpen, onToggleDock, perceiveOpen, onTogglePerceive, layoutsOpen, onToggleLayouts, analysisOpen, onToggleAnalysis, isDarkMode }: Props) {
  const panel = isDarkMode ? 'bg-slate-900/85 border-white/10 text-slate-100' : 'bg-white/85 border-white/80 text-slate-700';
  return (
    <div className={`absolute left-0 top-0 bottom-0 z-40 w-14 flex flex-col items-center py-3 gap-1.5 glass-panel border-r ${panel}`}>
      <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white grid place-items-center shadow-md mb-2">
        <Box className="w-[18px] h-[18px]" />
      </div>
      <RailBtn icon={Move3d} label="Edit workcell" active={mode === 'edit'} onClick={() => onMode('edit')} isDarkMode={isDarkMode} />
      <RailBtn icon={Columns2} label="Compare A/B cameras" active={mode === 'compare'} onClick={() => onMode('compare')} isDarkMode={isDarkMode} />
      <RailBtn icon={Bookmark} label="Layout profiles" active={layoutsOpen} onClick={onToggleLayouts} isDarkMode={isDarkMode} />
      <RailBtn icon={AnalysisIcon} label="Workspace analysis" active={analysisOpen} onClick={onToggleAnalysis} isDarkMode={isDarkMode} />
      {/* Dock / perceive toggles removed — the top-corner drawer buttons (PanelLeft/PanelRight) own that now (#5). */}
    </div>
  );
}
