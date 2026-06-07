/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import { Focus, Hand, House, Moon, Pause, Play, RotateCcw, Ruler, Sliders, Sun } from 'lucide-react';

interface ToolbarProps {
  isPaused: boolean;
  togglePause: () => void;
  onReset: () => void;
  showSidebar: boolean;
  toggleSidebar: () => void;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  onResetView: () => void;       // recenter to default iso view (Home)
  onFrameSelection: () => void;  // zoom to the selected object (F)
  tweaksOpen: boolean;
  onToggleTweaks: () => void;    // appearance tweaks (theme/accent) panel
  inline?: boolean;             // render as a compact wrap-row inside the sidebar dashboard
  // Jog joints + Measure are surfaced here as toggles (instead of their own dock sections).
  jogActive?: boolean;
  onToggleJog?: () => void;
  measureActive?: boolean;
  onToggleMeasure?: () => void;
}

/**
 * Toolbar
 * Floating control bar for simulation actions.
 */
export function Toolbar({ 
  isPaused, 
  togglePause, 
  onReset,
  showSidebar,
  toggleSidebar,
  isDarkMode,
  toggleDarkMode,
  onResetView,
  onFrameSelection,
  tweaksOpen,
  onToggleTweaks,
  inline,
  jogActive = false,
  onToggleJog,
  measureActive = false,
  onToggleMeasure
}: ToolbarProps) {
  const panelStyle = isDarkMode ? "bg-slate-900/80 border-white/10 text-slate-100" : "bg-white/70 border-white/80 text-slate-800";
  const activeStyle = isDarkMode ? 'text-indigo-400 bg-slate-800' : 'text-indigo-600 bg-white';
  const iconFill = isDarkMode ? "fill-slate-100" : "fill-slate-800";

  // Inline: a compact wrap-row inside the sidebar (child-selector overrides shrink the w-14 buttons).
  // Otherwise: bottom-centre floating bar clearing the left dock.
  return (
    <div className={inline
      ? 'flex flex-wrap items-center justify-center gap-1.5 [&_button]:w-9 [&_button]:h-9 [&_button]:rounded-xl [&_button]:shadow-none [&_svg]:w-4 [&_svg]:h-4'
      : 'absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 z-30'}>
      
      {/* Play/Pause Button */}
      <button 
        onClick={togglePause} 
        className={`w-14 h-14 rounded-2xl glass-panel flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-xl ${panelStyle}`}
        title={isPaused ? "Resume" : "Pause"}
      >
        {isPaused ? <Play className={`w-6 h-6 ${iconFill}`} /> : <Pause className={`w-6 h-6 ${iconFill}`} />}
      </button>
      
      {/* Reset Button */}
      <button
        onClick={onReset}
        className={`w-14 h-14 rounded-2xl glass-panel flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-xl ${panelStyle}`}
        title="Reset Simulation"
      >
        <RotateCcw className="w-6 h-6" />
      </button>

      {/* Reset View (Home) — recenter the camera if you get lost in orientation */}
      <button
        onClick={onResetView}
        className={`w-14 h-14 rounded-2xl glass-panel flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-xl ${panelStyle}`}
        title="Reset view (Home)"
      >
        <House className="w-6 h-6" />
      </button>

      {/* Frame Selection (F) — zoom to the selected object */}
      <button
        onClick={onFrameSelection}
        className={`w-14 h-14 rounded-2xl glass-panel flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-xl ${panelStyle}`}
        title="Frame selection (F)"
      >
        <Focus className="w-6 h-6" />
      </button>

      {/* Jog joints — drag a link to rotate it about its joint (was its own dock section) */}
      {onToggleJog && (
        <button
          onClick={onToggleJog}
          className={`w-14 h-14 rounded-2xl glass-panel flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-xl ${jogActive ? activeStyle : panelStyle}`}
          title="Jog joints — click a link, drag to rotate"
        >
          <Hand className="w-6 h-6" />
        </button>
      )}

      {/* Measure — pick two points for a live dimension (was its own dock section) */}
      {onToggleMeasure && (
        <button
          onClick={onToggleMeasure}
          className={`w-14 h-14 rounded-2xl glass-panel flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-xl ${measureActive ? activeStyle : panelStyle}`}
          title="Measure — click two points for a dimension"
        >
          <Ruler className="w-6 h-6" />
        </button>
      )}

      {/* Dark Mode Toggle */}
      <button
        onClick={toggleDarkMode}
        className={`w-14 h-14 rounded-2xl glass-panel flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-xl ${panelStyle}`}
        title={isDarkMode ? "Light Mode" : "Dark Mode"}
      >
        {isDarkMode ? <Sun className="w-6 h-6" /> : <Moon className="w-6 h-6" />}
      </button>

      {/* Appearance tweaks (theme + accent) — folded in from the old floating gear. */}
      <button
        onClick={onToggleTweaks}
        className={`w-14 h-14 rounded-2xl glass-panel flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-xl ${tweaksOpen ? (isDarkMode ? 'text-indigo-400 bg-slate-800' : 'text-indigo-600 bg-white') : panelStyle}`}
        title="Appearance tweaks"
      >
        <Sliders className="w-6 h-6" />
      </button>
      {/* The panel open/close toggle now lives in the panel header (PanelRightClose) — see #1. */}
    </div>
  );
}
