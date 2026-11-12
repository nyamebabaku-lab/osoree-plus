import { ChevronLeft, ChevronRight, Pause, PictureInPicture2, Play, Repeat, RotateCcw, SlidersHorizontal, Volume2, VolumeX, X } from 'lucide-react';
import { useState } from 'react';
import { useStore } from '../store.js';
import { Seg, Sheet } from '../ui.jsx';

const PRESETS = [
  ['↖', { x: 4, y: 6 }], ['↗', { x: 66, y: 6 }], ['↙', { x: 4, y: 48 }], ['↘', { x: 66, y: 48 }], ['Centre', { x: 35, y: 25 }],
];

function Slider({ label, value, min, max, step, onChange, show }) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm font-semibold"><span>{label}</span><span className="tabular-nums text-stone-500">{show(value)}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} aria-label={label} className="mt-2 w-full accent-gold-500" />
    </div>
  );
}

// Every setting of the picture-in-picture box.
export function PipSettings() {
  const { pipLook: l, setPipLook, pip, media } = useStore();
  const m = media.find((x) => x.id === pip.mediaId);
  const presetFor = (p) => setPipLook({ ...p, x: Math.min(p.x, 100 - l.w) });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Box position">
        {PRESETS.map(([name, p]) => <button key={name} onClick={() => presetFor(name === 'Centre' ? { x: (100 - l.w) / 2, y: p.y } : p)} className="btn-soft min-h-9 px-3 text-sm">{name}</button>)}
      </div>
      <Slider label="Size" value={l.w} min={10} max={90} step={1} onChange={(w) => setPipLook({ w, x: Math.min(l.x, 100 - w) })} show={(v) => `${v}% of width`} />
      <Slider label="Across" value={l.x} min={0} max={100 - l.w} step={0.5} onChange={(x) => setPipLook({ x })} show={(v) => `${Math.round(v)}%`} />
      <Slider label="Down" value={l.y} min={0} max={90} step={0.5} onChange={(y) => setPipLook({ y })} show={(v) => `${Math.round(v)}%`} />
      <Slider label="Strength" value={l.opacity} min={0.2} max={1} step={0.05} onChange={(opacity) => setPipLook({ opacity })} show={(v) => `${Math.round(v * 100)}%`} />
      {m?.kind === 'video' && <Slider label="Volume" value={l.volume} min={0} max={1} step={0.05} onChange={(volume) => setPipLook({ volume, muted: volume === 0 })} show={(v) => `${Math.round(v * 100)}%`} />}
      <Slider label="Round corners" value={l.radius} min={0} max={8} step={0.5} onChange={(radius) => setPipLook({ radius })} show={(v) => (v ? `${v}` : 'Square')} />
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold">Border</span><Seg label="Box border" value={l.border} onChange={(border) => setPipLook({ border })} options={[[true, 'On'], [false, 'Off']]} /></div>
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold">Shadow</span><Seg label="Box shadow" value={l.shadow} onChange={(shadow) => setPipLook({ shadow })} options={[[true, 'On'], [false, 'Off']]} /></div>
      <p className="text-xs text-stone-500 dark:text-stone-400">The box sits over the camera and slides; the verse bar, name tag and ticker stay on top of it.</p>
    </div>
  );
}

// Quick controls in the live panel while a box is showing.
export function PipBar() {
  const { pip, media, pipLook, hidePip, setPip, setPipLook } = useStore();
  const [open, setOpen] = useState(false);
  const m = media.find((x) => x.id === pip.mediaId);
  if (!m) return null;
  const pages = m.kind === 'pdf' ? m.pages.length : 0;
  return (
    <div className="space-y-1.5 rounded-lg bg-gold-400/15 px-2 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <PictureInPicture2 size={14} className="shrink-0 text-gold-700 dark:text-gold-300" />
        <span className="font-bold text-gold-700 dark:text-gold-300">BOX</span>
        <span className="min-w-0 flex-1 truncate font-semibold">{m.name}{pages ? ` · ${pip.page + 1}/${pages}` : ''}</span>
        <button onClick={() => setOpen(true)} aria-label="Adjust the box" className="rounded p-1 hover:bg-paper-300 dark:hover:bg-night-700"><SlidersHorizontal size={14} /></button>
        <button onClick={hidePip} aria-label="Hide the box" className="rounded p-1 hover:bg-paper-300 dark:hover:bg-night-700"><X size={14} /></button>
      </div>
      {(m.kind === 'video' || pages > 1) && (
        <div className="flex items-center gap-1.5">
          {m.kind === 'video' && (
            <>
              <button onClick={() => setPip({ playing: !pip.playing })} aria-label={pip.playing ? 'Pause box video' : 'Play box video'} className="btn-soft min-h-8 px-2">{pip.playing ? <Pause size={14} /> : <Play size={14} />}</button>
              <button onClick={() => setPip({ playing: true, seq: pip.seq + 1 })} aria-label="Box video from the start" className="btn-soft min-h-8 px-2"><RotateCcw size={14} /></button>
              <button onClick={() => setPipLook({ loop: !pipLook.loop })} aria-pressed={pipLook.loop} aria-label="Repeat box video" className={`btn min-h-8 px-2 ${pipLook.loop ? 'bg-gold-400/30' : 'bg-paper-200 dark:bg-night-800'}`}><Repeat size={14} /></button>
              <button onClick={() => setPipLook({ muted: !pipLook.muted })} aria-label={pipLook.muted ? 'Box sound off' : 'Box sound on'} className="btn-soft min-h-8 px-2">{pipLook.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>
              <input type="range" min="0" max="1" step="0.05" value={pipLook.muted ? 0 : pipLook.volume} onChange={(e) => { const v = parseFloat(e.target.value); setPipLook({ volume: v, muted: v === 0 }); }} aria-label="Box volume" className="min-w-0 flex-1 accent-gold-500" />
            </>
          )}
          {pages > 1 && (
            <>
              <button onClick={() => setPip({ page: Math.max(0, pip.page - 1) })} disabled={pip.page === 0} aria-label="Box previous page" className="btn-soft min-h-8 px-2"><ChevronLeft size={14} /></button>
              <button onClick={() => setPip({ page: Math.min(pages - 1, pip.page + 1) })} disabled={pip.page >= pages - 1} aria-label="Box next page" className="btn-soft min-h-8 px-2"><ChevronRight size={14} /></button>
            </>
          )}
        </div>
      )}
      {open && <Sheet title="Picture-in-picture box" onClose={() => setOpen(false)}><PipSettings /></Sheet>}
    </div>
  );
}
