/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { Bookmark, ClipboardCopy, CloudUpload, Save, Trash2 } from 'lucide-react';
import type { LayoutProfile } from '../profiles';

interface Props {
  profiles: LayoutProfile[];
  onSave: (name: string) => void;
  onLoad: (p: LayoutProfile) => void;
  onDelete: (name: string) => void;
  /** Publish this device's layouts to the team's shared store (Netlify Blobs). Returns success. */
  onPublish?: () => Promise<boolean>;
  isDarkMode: boolean;
}

/**
 * LayoutProfiles — save/restore the workspace's positional config (worktop + arm bases + overhead
 * camera) as named profiles, so a layout mapped to the real rig can be stored and switched between.
 */
export function LayoutProfiles({ profiles, onSave, onLoad, onDelete, onPublish, isDarkMode }: Props) {
  const [name, setName] = useState('');
  const [open, setOpen] = useState(true); // open expanded when summoned (the old collapsed default hid the save UI)
  const panel = isDarkMode ? 'bg-slate-900/85 border-white/10 text-slate-100' : 'bg-white/90 border-white/80 text-slate-800';
  const subtle = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const inputCls = isDarkMode ? 'bg-white/5 border-white/10 placeholder:text-slate-500' : 'bg-black/5 border-black/10 placeholder:text-slate-400';

  const [copied, setCopied] = useState(false);
  const commitSave = () => {
    const n = name.trim();
    if (!n) return;
    onSave(n);
    setName('');
  };
  // Copy every profile as JSON so it can be pasted into presets.ts (BUILTIN_PROFILES) and committed,
  // making the layouts available to teammates who clone the repo / open the hosted site (#6).
  const exportJson = () => {
    navigator.clipboard?.writeText(JSON.stringify(profiles, null, 2)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => { /* clipboard blocked */ });
  };
  // Publish to the team's shared store (Netlify Blobs). Reports status (it's a no-op locally).
  const [pub, setPub] = useState<'idle' | 'busy' | 'ok' | 'fail'>('idle');
  const publish = async () => {
    if (!onPublish) return;
    setPub('busy');
    const ok = await onPublish();
    setPub(ok ? 'ok' : 'fail');
    setTimeout(() => setPub('idle'), 2500);
  };

  return (
    <div className={`absolute top-16 left-1/2 -translate-x-1/2 z-40 w-64 rounded-2xl glass-panel shadow-xl border ${panel}`}>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 px-3 py-2">
        <Bookmark className="w-3.5 h-3.5 text-indigo-500" />
        <span className="text-[10px] font-bold uppercase tracking-widest flex-1 text-left">Layout profiles</span>
        <span className={`text-[10px] ${subtle}`}>{profiles.length}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commitSave()}
              placeholder="Name this layout…"
              className={`flex-1 min-w-0 px-2 py-1 rounded-md text-[11px] outline-none border ${inputCls}`}
            />
            <button
              onClick={commitSave}
              title="Save current layout"
              className="px-2 py-1 rounded-md bg-indigo-600 text-white text-[10px] font-bold uppercase flex items-center gap-1 hover:bg-indigo-500"
            >
              <Save className="w-3 h-3" /> Save
            </button>
          </div>

          {profiles.length === 0 ? (
            <p className={`text-[10px] leading-tight ${subtle}`}>Map your arm/camera positions, then save them here. Profiles persist across reloads.</p>
          ) : (
            <div className="space-y-0.5 max-h-48 overflow-y-auto">
              {profiles.map((p) => (
                <div key={p.name} className={`flex items-center gap-1.5 rounded-md px-2 py-1 ${isDarkMode ? 'hover:bg-white/5' : 'hover:bg-black/5'}`}>
                  <button onClick={() => onLoad(p)} title="Load this layout" className="flex-1 min-w-0 text-left">
                    <div className="text-[11px] font-medium truncate flex items-center gap-1.5">{p.name}
                      {p.builtin && <span className={`text-[8px] font-bold uppercase tracking-wide px-1 py-0.5 rounded ${isDarkMode ? 'bg-white/10 text-slate-300' : 'bg-black/10 text-slate-500'}`}>built-in</span>}
                      {p.shared && !p.builtin && <span className={`text-[8px] font-bold uppercase tracking-wide px-1 py-0.5 rounded ${isDarkMode ? 'bg-sky-500/20 text-sky-300' : 'bg-sky-100 text-sky-600'}`}>team</span>}
                    </div>
                    <div className={`text-[9px] ${subtle}`}>{p.arms.length} arm{p.arms.length === 1 ? '' : 's'}</div>
                  </button>
                  {!p.builtin && !p.shared && (
                    <button onClick={() => onDelete(p.name)} title="Delete" className={`p-1 rounded ${isDarkMode ? 'text-slate-500 hover:text-red-400' : 'text-slate-400 hover:text-red-500'}`}>
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {profiles.length > 0 && (
            <div className="space-y-1">
              {onPublish && (
                <button onClick={publish} disabled={pub === 'busy'} title="Publish your layouts to the team's shared store (live on the hosted site)"
                  className={`w-full flex items-center justify-center gap-1.5 px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-wide ${isDarkMode ? 'bg-sky-500/20 text-sky-300 hover:bg-sky-500/30' : 'bg-sky-50 text-sky-700 hover:bg-sky-100'} disabled:opacity-50`}>
                  <CloudUpload className="w-3 h-3" /> {pub === 'busy' ? 'Publishing…' : pub === 'ok' ? 'Published to team ✓' : pub === 'fail' ? 'Sync unavailable (deploy first)' : 'Publish to team'}
                </button>
              )}
              <button onClick={exportJson} title="Copy all profiles as JSON — paste into presets.ts to ship them to teammates"
                className={`w-full flex items-center justify-center gap-1.5 px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-wide ${isDarkMode ? 'bg-white/5 text-slate-300 hover:bg-white/10' : 'bg-black/5 text-slate-600 hover:bg-black/10'}`}>
                <ClipboardCopy className="w-3 h-3" /> {copied ? 'Copied JSON ✓' : 'Export JSON (for repo)'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
