/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import { Focus, GripVertical, Hand, House, Moon, Pause, Play, Redo2, RotateCcw, Ruler, Sliders, Sun, Undo2 } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { IconToolbar, JogIcon, ToolbarButton, ToolbarDivider } from './ui/toolbar';

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
  // Jog (drag a link to rotate), Pan (Fusion-style hand) + Measure are surfaced here as toggles.
  jogActive?: boolean;
  onToggleJog?: () => void;
  panActive?: boolean;
  onTogglePan?: () => void;
  measureActive?: boolean;
  onToggleMeasure?: () => void;
  /** Undo / redo the layout timeline. */
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  /** Pointer-down handler for the drag grip (lets the user reposition the floating toolbar). */
  onDragHandle?: (e: ReactPointerEvent) => void;
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
  panActive = false,
  onTogglePan,
  measureActive = false,
  onToggleMeasure,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onDragHandle,
}: ToolbarProps) {
  const panelStyle = isDarkMode ? "bg-slate-900/80 border-white/10 text-slate-100" : "bg-white/70 border-white/80 text-slate-800";
  const activeStyle = isDarkMode ? 'text-indigo-400 bg-slate-800' : 'text-indigo-600 bg-white';
  const iconFill = isDarkMode ? "fill-slate-100" : "fill-slate-800";

  // Inline: a clean horizontal pill toolbar (icon buttons + hover tooltips), grouped by divider.
  if (inline) {
    return (
      <div className="flex justify-center">
        <IconToolbar isDarkMode={isDarkMode} className="flex-wrap">
          {onDragHandle && (
            <div onPointerDown={onDragHandle} title="Drag to move the toolbar"
              className={`h-8 w-5 -ml-0.5 flex items-center justify-center cursor-grab active:cursor-grabbing rounded-md ${isDarkMode ? 'text-slate-500 hover:bg-white/10' : 'text-slate-400 hover:bg-black/10'}`}>
              <GripVertical className="h-4 w-4" />
            </div>
          )}
          {onUndo && <ToolbarButton label="Undo (⌘Z)" icon={Undo2} onClick={onUndo} disabled={!canUndo} isDarkMode={isDarkMode} />}
          {onRedo && <ToolbarButton label="Redo (⇧⌘Z)" icon={Redo2} onClick={onRedo} disabled={!canRedo} isDarkMode={isDarkMode} />}
          {(onUndo || onRedo) && <ToolbarDivider isDarkMode={isDarkMode} />}
          <ToolbarButton label="Home view (ISO)" icon={House} onClick={onResetView} isDarkMode={isDarkMode} />
          <ToolbarButton label="Fit camera to selected object" icon={Focus} onClick={onFrameSelection} isDarkMode={isDarkMode} />
          {(onToggleJog || onTogglePan || onToggleMeasure) && <ToolbarDivider isDarkMode={isDarkMode} />}
          {onToggleJog && <ToolbarButton label="Jog joints — drag a link to rotate" icon={JogIcon} isActive={jogActive} onClick={onToggleJog} isDarkMode={isDarkMode} />}
          {onTogglePan && <ToolbarButton label="Pan view — drag to move the camera" icon={Hand} isActive={panActive} onClick={onTogglePan} isDarkMode={isDarkMode} />}
          {onToggleMeasure && <ToolbarButton label="Measure — click two points" icon={Ruler} isActive={measureActive} onClick={onToggleMeasure} isDarkMode={isDarkMode} />}
          <ToolbarDivider isDarkMode={isDarkMode} />
          <ToolbarButton label={isDarkMode ? 'Light mode' : 'Dark mode'} icon={isDarkMode ? Sun : Moon} onClick={toggleDarkMode} isDarkMode={isDarkMode} />
          <ToolbarButton label="Appearance tweaks" icon={Sliders} isActive={tweaksOpen} onClick={onToggleTweaks} isDarkMode={isDarkMode} />
        </IconToolbar>
      </div>
    );
  }

  // Floating (non-inline): bottom-centre bar of large buttons, clearing the left dock.
  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 z-30">

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

      {/* Pan view — Fusion-style hand: drag to move the camera (was the jog button) */}
      {onTogglePan && (
        <button
          onClick={onTogglePan}
          className={`w-14 h-14 rounded-2xl glass-panel flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-xl ${panActive ? activeStyle : panelStyle}`}
          title="Pan view — drag to move the camera"
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
