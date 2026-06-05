/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { ReactNode } from 'react';
import { ChevronRight, Sparkles, Video } from 'lucide-react';

interface Props {
  isDarkMode: boolean;
  /** Feeds panel open/closed (the stacked camera PIPs). */
  open: boolean;
  onToggle: () => void;
  /** Reasoning (Gemini) panel open/closed — its own toggle on the same rail. */
  reasoningOpen: boolean;
  onReasoning: () => void;
  /** Shift the feeds panel left of the full-height reasoning sidebar when it's open. */
  sidebarOpen: boolean;
  /** Per-feed enables surfaced at the top of the panel. */
  toggles: { overhead: boolean; onOverhead: (v: boolean) => void; wrist: boolean; onWrist: (v: boolean) => void };
  /** How many feed cards are currently shown (for the rail badge + empty state). */
  feedCount: number;
  children: ReactNode;
}

/**
 * FeedsDock — collapses every camera PIP (overhead D435i + per-arm wrist + per-station) into ONE
 * height-bounded, scrollable right-edge panel, plus a Reasoning toggle, replacing the old pile of
 * free-floating PIP cards that overflowed the viewport. A slim always-visible rail carries the two
 * toggles; selecting one slides its panel out.
 */
export function FeedsDock({ isDarkMode, open, onToggle, reasoningOpen, onReasoning, sidebarOpen, toggles, feedCount, children }: Props) {
  const panel = isDarkMode ? 'bg-slate-900/85 border-white/10 text-slate-100' : 'bg-white/85 border-white/80 text-slate-800';
  const subtle = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const railBtn = (on: boolean) =>
    `relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${on ? 'bg-indigo-600 text-white' : isDarkMode ? 'bg-white/5 text-slate-300 hover:bg-white/10' : 'bg-black/5 text-slate-600 hover:bg-black/10'}`;

  const Check = ({ label, v, on }: { label: string; v: boolean; on: (b: boolean) => void }) => (
    <label className="flex items-center justify-between gap-2 px-1 py-0.5 cursor-pointer">
      <span className="text-[10px] font-medium">{label}</span>
      <input type="checkbox" checked={v} onChange={(e) => on(e.target.checked)} className="accent-indigo-600 w-3.5 h-3.5" />
    </label>
  );

  return (
    <>
      {/* Slim rail — the two toggles. */}
      <div className={`absolute right-3 top-[6.5rem] z-40 flex flex-col gap-1.5 rounded-xl glass-panel border shadow-lg p-1 ${panel}`}>
        <button onClick={onToggle} title="Camera feeds" className={railBtn(open)}>
          <Video className="w-4 h-4" />
          {feedCount > 0 && <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-0.5 rounded-full bg-indigo-500 text-white text-[8px] font-bold flex items-center justify-center">{feedCount}</span>}
        </button>
        <button onClick={onReasoning} title="Embodied reasoning" className={railBtn(reasoningOpen)}>
          <Sparkles className="w-4 h-4" />
        </button>
      </div>

      {/* Feeds panel — bounded + scrollable; shifts left of the reasoning sidebar when it's open. */}
      {open && (
        <div className={`absolute top-[6.5rem] z-40 w-72 max-[660px]:w-56 right-14 ${sidebarOpen ? 'min-[660px]:right-[26.5rem]' : ''} rounded-2xl glass-panel border shadow-xl overflow-hidden flex flex-col ${panel}`}>
          <div className="flex items-center justify-between px-3 py-2 border-b border-black/5 shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5"><Video className="w-3.5 h-3.5 text-indigo-500" /> Camera Feeds</span>
            <button onClick={onToggle} title="Collapse" className="opacity-60 hover:opacity-100"><ChevronRight className="w-3.5 h-3.5" /></button>
          </div>
          <div className="px-2 py-1.5 border-b border-black/5 shrink-0">
            <Check label="Overhead D435i" v={toggles.overhead} on={toggles.onOverhead} />
            <Check label="Wrist cameras" v={toggles.wrist} on={toggles.onWrist} />
          </div>
          <div className="p-2 space-y-2 overflow-y-auto custom-scrollbar" style={{ maxHeight: 'calc(100vh - 14rem)' }}>
            {children}
            {feedCount === 0 && <p className={`text-[10px] text-center py-4 ${subtle}`}>No feeds enabled. Tick one above.</p>}
          </div>
        </div>
      )}
    </>
  );
}
