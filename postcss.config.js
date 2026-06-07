/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

// Vite auto-detects this config and runs it over imported CSS (index.css), compiling the
// @tailwind directives at build time — no runtime CDN/JIT.
export default {
  plugins: [tailwindcss, autoprefixer],
};
