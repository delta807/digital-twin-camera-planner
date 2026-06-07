/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ComponentType, ReactNode } from 'react';

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
