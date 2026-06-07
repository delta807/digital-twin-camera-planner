/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Build-time Tailwind config (migrated from the inline `tailwind.config` that used to live in
 * index.html under the Play CDN). The theme is a verbatim port: the "lab-instrument" palette remaps
 * Tailwind's neutral (slate) + accent (indigo) scales to OKLCH ramps so the whole app reskins at the
 * token level, plus categorical overlay colors. `<alpha-value>` keeps opacity modifiers
 * (e.g. bg-slate-900/85) working; the indigo ramp reads `--accent-h` so the accent hue stays live.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      backdropBlur: { xs: '2px' },
      colors: {
        slate: {
          50: 'oklch(0.967 0.004 248 / <alpha-value>)',
          100: 'oklch(0.925 0.006 248 / <alpha-value>)',
          200: 'oklch(0.86 0.008 248 / <alpha-value>)',
          300: 'oklch(0.75 0.01 248 / <alpha-value>)',
          400: 'oklch(0.635 0.01 248 / <alpha-value>)',
          500: 'oklch(0.505 0.011 248 / <alpha-value>)',
          600: 'oklch(0.40 0.012 248 / <alpha-value>)',
          700: 'oklch(0.315 0.012 248 / <alpha-value>)',
          800: 'oklch(0.248 0.012 248 / <alpha-value>)',
          900: 'oklch(0.212 0.012 248 / <alpha-value>)',
          950: 'oklch(0.175 0.012 248 / <alpha-value>)',
        },
        indigo: {
          300: 'oklch(0.82 0.085 var(--accent-h,262) / <alpha-value>)',
          400: 'oklch(0.775 0.11 var(--accent-h,262) / <alpha-value>)',
          500: 'oklch(0.72 0.13 var(--accent-h,262) / <alpha-value>)',
          600: 'oklch(0.655 0.155 var(--accent-h,262) / <alpha-value>)',
          700: 'oklch(0.575 0.16 var(--accent-h,262) / <alpha-value>)',
        },
        // categorical overlay legend colors (camera/reach/precision/task object)
        cam: 'oklch(0.82 0.14 78 / <alpha-value>)',
        reach: 'oklch(0.70 0.10 292 / <alpha-value>)',
        precision: 'oklch(0.83 0.13 188 / <alpha-value>)',
        object: 'oklch(0.78 0.10 35 / <alpha-value>)',
      },
    },
  },
  plugins: [],
};
