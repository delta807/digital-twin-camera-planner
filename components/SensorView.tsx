/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Video, X } from 'lucide-react';
import { Ref } from 'react';

interface SensorViewProps {
  /** App owns this ref (object or callback); its node is handed to attachPip(). */
  canvasHostRef: Ref<HTMLDivElement>;
  isDarkMode: boolean;
  sidebarOpen: boolean;
  aspect: number;
  onClose: () => void;
  title?: string;
  /** Stack a second feed below the first instead of at the top. */
  secondary?: boolean;
  /** Absolute top offset in rem — overrides `secondary` to stack many feeds (wrist-per-arm). */
  topRem?: number;
}

/**
 * SensorView
 * Floating picture-in-picture panel that displays the live render from the placeable
 * sensor camera — "what the footage looks like" to the robot / teleoperator.
 * The inner host div follows the selected camera stream profile aspect ratio.
 */
export function SensorView({ canvasHostRef, isDarkMode, sidebarOpen, aspect, onClose, title = 'Sensor View · D435i', secondary = false, topRem }: SensorViewProps) {
  const panelStyle = isDarkMode ? 'bg-slate-900/80 border-white/10 text-slate-100' : 'bg-white/70 border-white/80 text-slate-800';
  // Tuck the panel left of the analysis sidebar when it's open (desktop only).
  const rightClass = sidebarOpen ? 'min-[660px]:right-[25rem]' : 'min-[660px]:right-6';
  // Explicit rem offset (many stacked wrist feeds) wins; else the legacy two-slot class.
  const topClass = topRem !== undefined ? '' : secondary ? 'top-[15.5rem]' : 'top-6';
  const topStyle = topRem !== undefined ? { top: `${topRem}rem` } : undefined;

  return (
    <div style={topStyle} className={`absolute ${topClass} right-6 ${rightClass} z-30 w-72 max-[660px]:w-56 rounded-2xl glass-panel shadow-xl overflow-hidden ${panelStyle}`}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-black/5">
        <div className="flex items-center gap-2">
          <Video className="w-3.5 h-3.5 text-indigo-500" />
          <span className="text-[10px] font-bold uppercase tracking-widest">{title}</span>
        </div>
        <button onClick={onClose} title="Hide sensor view" className="opacity-60 hover:opacity-100 transition-opacity">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div ref={canvasHostRef} style={{ aspectRatio: aspect }} className="w-full bg-black/80 [&>canvas]:w-full [&>canvas]:h-full [&>canvas]:block" />
    </div>
  );
}
