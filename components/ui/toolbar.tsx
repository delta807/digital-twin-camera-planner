/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ComponentType, ReactNode } from 'react';

/** Pan/move tool glyph (filled) — used for the Fusion-style hand-pan toolbar button. */
export function PanIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M11 2.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0-3M14 4a3 3 0 1 0-5.895.79L6.15 5.908a3 3 0 1 0 0 4.185l1.955 1.117A3.003 3.003 0 0 0 11 15a3 3 0 1 0-2.15-5.092L6.895 8.79a3 3 0 0 0 0-1.58L8.85 6.092A3 3 0 0 0 14 4m-3 6.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0-3M2.5 8a1.5 1.5 0 1 1 3 0a1.5 1.5 0 0 1-3 0" />
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

export function ToolbarButton({ label, icon: Icon, isActive = false, onClick, isDarkMode }: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  isActive?: boolean;
  onClick: () => void;
  isDarkMode: boolean;
}) {
  const base = isActive
    ? (isDarkMode ? 'bg-indigo-500/25 text-indigo-300' : 'bg-indigo-600/10 text-indigo-600')
    : (isDarkMode ? 'text-slate-200 hover:bg-white/10' : 'text-slate-700 hover:bg-black/10');
  return (
    <div className="relative group">
      <button onClick={onClick} aria-label={label}
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
