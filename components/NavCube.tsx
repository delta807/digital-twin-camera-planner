/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ViewPreset = 'top' | 'front' | 'back' | 'left' | 'right' | 'iso';

interface Props {
  onView: (p: ViewPreset) => void;
  isDarkMode: boolean;
}

/**
 * NavCube — a lab-instrument orientation gizmo (top-right). Click the cube faces to snap the
 * 3D view: TOP face → top-down, the two front faces → front / right, and ISO resets the angle.
 * Small face buttons cover the remaining orthographic views.
 */
export function NavCube({ onView, isDarkMode }: Props) {
  const panel = isDarkMode ? 'bg-slate-900/85 border-white/10 text-slate-300' : 'bg-white/90 border-white/80 text-slate-600';
  const top = isDarkMode ? 'oklch(0.42 0.05 262)' : 'oklch(0.85 0.04 262)';
  const faceL = isDarkMode ? 'oklch(0.30 0.012 248)' : 'oklch(0.92 0.006 248)';
  const faceR = isDarkMode ? 'oklch(0.25 0.012 248)' : 'oklch(0.86 0.008 248)';
  const stroke = isDarkMode ? 'oklch(0.45 0.012 248)' : 'oklch(0.78 0.008 248)';

  const Btn = ({ p, label }: { p: ViewPreset; label: string }) => (
    <button onClick={() => onView(p)} className={`text-[8px] font-bold uppercase px-1 py-0.5 rounded ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}>{label}</button>
  );

  return (
    <div className={`absolute top-[34%] left-4 min-[660px]:left-[22.5rem] z-30 flex flex-col items-center gap-1 rounded-xl glass-panel border shadow-lg p-1.5 ${panel}`}>
      <svg width="46" height="46" viewBox="0 0 40 42" className="cursor-pointer">
        {/* top face → top view */}
        <polygon points="20,3 36,12 20,21 4,12" fill={top} stroke={stroke} strokeWidth="1" onClick={() => onView('top')}>
          <title>Top</title>
        </polygon>
        {/* left face → front view */}
        <polygon points="4,12 20,21 20,39 4,30" fill={faceL} stroke={stroke} strokeWidth="1" onClick={() => onView('front')}>
          <title>Front</title>
        </polygon>
        {/* right face → right view */}
        <polygon points="36,12 20,21 20,39 36,30" fill={faceR} stroke={stroke} strokeWidth="1" onClick={() => onView('right')}>
          <title>Right</title>
        </polygon>
      </svg>
      <div className="flex gap-0.5">
        <Btn p="iso" label="ISO" />
        <Btn p="back" label="Bk" />
        <Btn p="left" label="Lt" />
      </div>
    </div>
  );
}
