/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { Moon, Sun, Sliders, X } from 'lucide-react';

interface Props {
  isDarkMode: boolean;
  onToggleTheme: () => void;
}

const ACCENTS: { name: string; h: number }[] = [
  { name: 'Indigo', h: 262 },
  { name: 'Blue', h: 233 },
  { name: 'Cyan', h: 200 },
  { name: 'Green', h: 150 },
  { name: 'Amber', h: 70 },
  { name: 'Rose', h: 12 },
];

/**
 * TweaksPanel — lab-instrument appearance controls: theme (dark/light), accent hue (drives the
 * --accent-h CSS var that the remapped indigo scale reads), and density (compact tightens spacing).
 * Persisted in localStorage. A floating gear opens it.
 */
export function TweaksPanel({ isDarkMode, onToggleTheme }: Props) {
  const [open, setOpen] = useState(false);
  const [hue, setHue] = useState(() => Number(localStorage.getItem('accent-h')) || 262);
  const [compact, setCompact] = useState(() => localStorage.getItem('density') === 'compact');

  useEffect(() => {
    document.documentElement.style.setProperty('--accent-h', String(hue));
    localStorage.setItem('accent-h', String(hue));
  }, [hue]);
  useEffect(() => {
    document.documentElement.dataset.density = compact ? 'compact' : 'spacious';
    document.documentElement.style.fontSize = compact ? '13.5px' : '16px';
    localStorage.setItem('density', compact ? 'compact' : 'spacious');
  }, [compact]);

  const panel = isDarkMode ? 'bg-slate-900/90 border-white/10 text-slate-100' : 'bg-white/95 border-white/80 text-slate-800';
  const subtle = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const seg = (active: boolean) =>
    `flex-1 text-[10px] font-bold uppercase tracking-wide py-1 rounded-md transition-colors ${active ? 'bg-indigo-600 text-white' : isDarkMode ? 'bg-white/5 text-slate-300 hover:bg-white/10' : 'bg-black/5 text-slate-600 hover:bg-black/10'}`;

  return (
    <div className="absolute bottom-6 right-6 z-40 flex flex-col items-end gap-2">
      {open && (
        <div className={`w-56 rounded-2xl glass-panel border shadow-xl p-3 space-y-3 ${panel}`}>
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-bold uppercase tracking-[0.14em] opacity-70">Tweaks</span>
            <button onClick={() => setOpen(false)} className="opacity-60 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
          </div>

          <div className="space-y-1">
            <div className={`text-[9px] font-bold uppercase ${subtle}`}>Theme</div>
            <div className="flex gap-1">
              <button onClick={() => isDarkMode && onToggleTheme()} className={seg(!isDarkMode)}><Sun className="w-3 h-3 inline mr-1" />Light</button>
              <button onClick={() => !isDarkMode && onToggleTheme()} className={seg(isDarkMode)}><Moon className="w-3 h-3 inline mr-1" />Dark</button>
            </div>
          </div>

          <div className="space-y-1">
            <div className={`text-[9px] font-bold uppercase ${subtle}`}>Accent</div>
            <div className="flex gap-1.5">
              {ACCENTS.map((a) => (
                <button
                  key={a.h} onClick={() => setHue(a.h)} title={a.name}
                  className={`w-6 h-6 rounded-full border-2 ${hue === a.h ? 'border-current' : 'border-transparent'}`}
                  style={{ background: `oklch(0.72 0.14 ${a.h})` }}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <div className={`text-[9px] font-bold uppercase ${subtle}`}>Density</div>
            <div className="flex gap-1">
              <button onClick={() => setCompact(false)} className={seg(!compact)}>Spacious</button>
              <button onClick={() => setCompact(true)} className={seg(compact)}>Compact</button>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        title="Appearance tweaks"
        className={`w-10 h-10 rounded-full glass-panel border shadow-lg grid place-items-center ${open ? 'bg-indigo-600 text-white border-indigo-500' : panel}`}
      >
        <Sliders className="w-4 h-4" />
      </button>
    </div>
  );
}
