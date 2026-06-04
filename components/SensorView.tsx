/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Layers, Video, X } from 'lucide-react';
import { Ref } from 'react';

/** Superimpose a real reference frame (e.g. the live Jetson overhead feed) over the sim PIP. */
export interface CompareOverlay {
  src: string;                       // image/MJPEG URL of the real camera
  on: boolean; onToggle: (v: boolean) => void;
  opacity: number; onOpacity: (v: number) => void;
  blend: 'normal' | 'difference'; onBlend: (b: 'normal' | 'difference') => void;
}

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
  /** When provided, shows a real-vs-sim superimpose control + overlays the real frame on the PIP. */
  compare?: CompareOverlay;
  /** When provided, shows an RGB/Depth toggle (simulated D435i depth stream). */
  depth?: { on: boolean; onToggle: (v: boolean) => void };
}

/**
 * SensorView
 * Floating picture-in-picture panel that displays the live render from the placeable
 * sensor camera — "what the footage looks like" to the robot / teleoperator.
 * The inner host div follows the selected camera stream profile aspect ratio.
 */
export function SensorView({ canvasHostRef, isDarkMode, sidebarOpen, aspect, onClose, title = 'Sensor View · D435i', secondary = false, topRem, compare, depth }: SensorViewProps) {
  const panelStyle = isDarkMode ? 'bg-slate-900/80 border-white/10 text-slate-100' : 'bg-white/70 border-white/80 text-slate-800';
  // Tuck the panel left of the analysis sidebar when it's open (desktop only).
  const rightClass = sidebarOpen ? 'min-[660px]:right-[25rem]' : 'min-[660px]:right-6';
  // Explicit rem offset (many stacked wrist feeds) wins; else the legacy two-slot class.
  const topClass = topRem !== undefined ? '' : secondary ? 'top-[15.5rem]' : 'top-6';
  const topStyle = topRem !== undefined ? { top: `${topRem}rem` } : undefined;
  const subtle = isDarkMode ? 'text-slate-400' : 'text-slate-500';

  return (
    <div style={topStyle} className={`absolute ${topClass} right-6 ${rightClass} z-30 w-72 max-[660px]:w-56 rounded-2xl glass-panel shadow-xl overflow-hidden ${panelStyle}`}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-black/5">
        <div className="flex items-center gap-2">
          <Video className="w-3.5 h-3.5 text-indigo-500" />
          <span className="text-[10px] font-bold uppercase tracking-widest">{title}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {depth && (
            <button
              onClick={() => depth.onToggle(!depth.on)}
              title="Toggle simulated D435i depth stream (RGB ↔ Depth)"
              className={`px-1.5 py-0.5 rounded text-[8px] font-bold tracking-wider ${depth.on ? 'bg-indigo-600 text-white' : isDarkMode ? 'bg-white/10 text-slate-300 hover:bg-white/15' : 'bg-black/5 text-slate-600 hover:bg-black/10'}`}
            >
              {depth.on ? 'DEPTH' : 'RGB'}
            </button>
          )}
          {compare && (
            <button
              onClick={() => compare.onToggle(!compare.on)}
              title="Superimpose the live real camera frame to compare"
              className={`p-0.5 rounded ${compare.on ? 'text-indigo-500' : 'opacity-60 hover:opacity-100'}`}
            >
              <Layers className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={onClose} title="Hide sensor view" className="opacity-60 hover:opacity-100 transition-opacity">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* PIP render + (optional) real-frame overlay for superimposing. */}
      <div className="relative w-full" style={{ aspectRatio: aspect }}>
        <div ref={canvasHostRef} className="absolute inset-0 bg-black/80 [&>canvas]:w-full [&>canvas]:h-full [&>canvas]:block" />
        {compare?.on && (
          <img
            src={compare.src}
            alt="real camera reference"
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ objectFit: 'fill', opacity: compare.opacity, mixBlendMode: compare.blend === 'difference' ? 'difference' : 'normal' }}
          />
        )}
      </div>

      {/* Superimpose controls — opacity blend + difference mode (black where sim matches reality). */}
      {compare?.on && (
        <div className="px-3 py-2 border-t border-black/5 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className={`text-[9px] font-bold uppercase tracking-wide w-10 ${subtle}`}>Blend</span>
            <input
              type="range" min={0} max={1} step={0.02} value={compare.opacity}
              onChange={(e) => compare.onOpacity(parseFloat(e.target.value))}
              className="flex-1 h-1 accent-indigo-600 cursor-pointer"
            />
            <span className={`text-[9px] tabular-nums w-8 text-right ${subtle}`}>{Math.round(compare.opacity * 100)}%</span>
          </div>
          <div className="flex items-center gap-1">
            {(['normal', 'difference'] as const).map((b) => (
              <button
                key={b}
                onClick={() => compare.onBlend(b)}
                className={`flex-1 text-[9px] font-bold uppercase tracking-wide py-1 rounded-md ${
                  compare.blend === b
                    ? 'bg-indigo-600 text-white'
                    : isDarkMode ? 'bg-white/5 text-slate-300 hover:bg-white/10' : 'bg-black/5 text-slate-600 hover:bg-black/10'
                }`}
              >
                {b === 'normal' ? 'Overlay' : 'Difference'}
              </button>
            ))}
          </div>
          <p className={`text-[9px] leading-tight ${subtle}`}>
            {compare.blend === 'difference'
              ? 'Dark = sim matches the real frame. Move/aim the camera to minimise the bright mismatch.'
              : 'Real overhead feed over the sim render — slide to crossfade, then align the camera.'}
          </p>
        </div>
      )}
    </div>
  );
}
