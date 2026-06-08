/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ComponentType, ReactNode } from 'react';

/** Jog-joints glyph — used for the jog toolbar toggle. */
export function JogIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" className={className} aria-hidden="true">
      <g fill="currentColor">
        <path d="M1.553 1.105a1 1 0 0 1 1.341.448L4.703 5.17A5.01 5.01 0 0 1 10.583 8H8.23A3 3 0 0 0 6 7c-1.63 0-3 1.365-3 3a3 3 0 0 0 3 3a3 3 0 0 0 2.231-1h2.352a5 5 0 1 1-7.67-5.934L1.106 2.447a1 1 0 0 1 .448-1.342" />
        <path d="M6 8c.74 0 1.384.403 1.73 1H14a1 1 0 0 1 0 2H7.73A2 2 0 1 1 6 8" />
      </g>
    </svg>
  );
}

/**
 * A compact horizontal icon toolbar (pill) with hover tooltips — adapted to this project's stack
 * (plain React + Tailwind, our glass-panel theme; CSS transitions instead of framer-motion, no
 * shadcn tokens). Compose with <ToolbarButton> and <ToolbarDivider>.
 */
export function IconToolbar({ isDarkMode, children, className = '' }: { isDarkMode: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={`inline-flex items-center gap-1 p-1 rounded-xl border shadow-lg backdrop-blur ${isDarkMode ? 'bg-slate-900/80 border-white/10' : 'bg-white/80 border-black/10'} ${className}`}>
      {children}
    </div>
  );
}

export function ToolbarDivider({ isDarkMode }: { isDarkMode: boolean }) {
  return <span className={`w-px h-6 mx-0.5 ${isDarkMode ? 'bg-white/15' : 'bg-black/10'}`} />;
}

export function ToolbarButton({ label, icon: Icon, isActive = false, onClick, isDarkMode, disabled = false }: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  isActive?: boolean;
  onClick: () => void;
  isDarkMode: boolean;
  disabled?: boolean;
}) {
  const base = disabled
    ? 'opacity-30 cursor-not-allowed text-slate-400'
    : isActive
      ? (isDarkMode ? 'bg-indigo-500/25 text-indigo-300' : 'bg-indigo-600/10 text-indigo-600')
      : (isDarkMode ? 'text-slate-200 hover:bg-white/10' : 'text-slate-700 hover:bg-black/10');
  return (
    <div className="relative group">
      <button onClick={onClick} aria-label={label} disabled={disabled}
        className={`h-8 w-8 flex items-center justify-center rounded-md transition-colors duration-200 focus:outline-none ${base}`}>
        <Icon className="h-4 w-4" />
      </button>
      {/* Hover tooltip (CSS only) */}
      <span className="pointer-events-none absolute bottom-9 left-1/2 -translate-x-1/2 z-50 whitespace-nowrap rounded-md bg-slate-800 text-white text-[10px] font-medium px-2 py-1 shadow-lg opacity-0 translate-y-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-y-0">
        {label}
      </span>
    </div>
  );
}
