import { useRef, useState } from 'react';
import { FileText, Film, ImagePlus, Layers, ListPlus, MonitorPlay, Moon, PictureInPicture2, Play, Trash2 } from 'lucide-react';
import { useStore } from '../store.js';
import { addMediaFiles, formatName, formatSize, pickNativeMedia, removeMediaFile, useMediaUrl } from '../lib/media.js';
import { IS_NATIVE } from '../lib/output.js';
import { slideKey } from '../lib/slides.js';
import { Empty, Seg, Sheet } from '../ui.jsx';

export function Thumb({ item, className = '' }) {
  const url = useMediaUrl(item?.src);
  if (!item) return null;
  return (
    <div className={`relative overflow-hidden bg-black ${className}`}>
      {url && (item.kind === 'video'
        ? <video src={url + '#t=0.5'} muted playsInline preload="metadata" className="h-full w-full object-cover" />
        : <img src={url} alt="" className={`h-full w-full ${item.kind === 'pdf' ? 'bg-white object-contain' : 'object-cover'}`} />)}
      {item.kind === 'video' && <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white"><Film size={10} className="mr-0.5 inline" />VIDEO</span>}
      {item.kind === 'pdf' && <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white"><FileText size={10} className="mr-0.5 inline" />{formatName(item).toUpperCase()} · {item.pages.length}</span>}
    </div>
  );
}

function PageTile({ src, n, live, onClick }) {
  const url = useMediaUrl(src);
  return (
    <button onClick={onClick} aria-label={`Page ${n}`} className={`relative aspect-[3/4] overflow-hidden rounded-lg bg-white ${live ? 'ring-2 ring-red-600' : 'ring-1 ring-paper-300 dark:ring-night-700'}`}>
      {url && <img src={url} alt="" loading="lazy" className="h-full w-full object-contain" />}
      <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 text-[10px] font-bold text-white">{n}</span>
    </button>
  );
}

function PdfSheet({ item, onClose }) {
  const { goLive, addPlan, plan, live, mode, updateMedia, removeMedia, showPip } = useStore();
  const inPlan = plan.some((p) => slideKey(p) === slideKey({ type: 'pdf', mediaId: item.id, page: 0 }));
  return (
    <Sheet title={item.name} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-stone-500 dark:text-stone-400">{formatName(item)} · tap a {item.format === 'pptx' ? 'slide' : 'page'} to show it. Use Next and Back to turn pages, and zoom or move it from the live panel.{item.format && item.format !== 'pdf' ? ' (For an exact copy of a complex file, save it as PDF and add that.)' : ''}{item.more ? ` Only the first ${item.pages.length} of ${item.more} pages were added.` : ''}</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {item.pages.map((src, i) => (
            <PageTile key={src} src={src} n={i + 1} live={mode === 'show' && live?.type === 'pdf' && live.mediaId === item.id && (live.page || 0) === i} onClick={() => goLive({ type: 'pdf', mediaId: item.id, page: i })} />
          ))}
        </div>
        <button onClick={() => { showPip(item.id, 0); onClose(); }} className="btn-soft w-full"><PictureInPicture2 size={18} /> Show in a box over the screen</button>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => addPlan({ type: 'pdf', mediaId: item.id, page: 0 })} disabled={inPlan} className="btn-soft"><ListPlus size={16} /> {inPlan ? 'In plan' : 'Add to plan'}</button>
          <button onClick={() => { if (window.confirm(`Remove "${item.name}"?`)) { removeMediaFile(item); removeMedia(item.id); onClose(); } }} className="btn-soft text-red-600 dark:text-red-400"><Trash2 size={16} /> Remove</button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold">On screen</span>
          <Seg label="Page fit" value={item.fit || 'contain'} onChange={(fit) => updateMedia(item.id, { fit })} options={[['contain', 'Whole page'], ['cover', 'Fill width']]} />
        </div>
      </div>
    </Sheet>
  );
}

function MediaSheet({ item, onClose }) {
  if (item.kind === 'pdf') return <PdfSheet item={item} onClose={onClose} />;
  return <PictureSheet item={item} onClose={onClose} />;
}

function PictureSheet({ item, onClose }) {
  const { goLive, addPlan, plan, idleId, setIdle, style, setStyle, updateMedia, removeMedia, showPip } = useStore();
  const inPlan = plan.some((p) => slideKey(p) === slideKey({ type: 'media', mediaId: item.id }));
  const isIdle = idleId === item.id, isBg = style.bgId === item.id;
  return (
    <Sheet title={item.name} onClose={onClose}>
      <div className="space-y-3">
        <Thumb item={item} className="aspect-video rounded-xl" />
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => { goLive({ type: 'media', mediaId: item.id }); onClose(); }} className="btn-gold"><Play size={18} /> Show on screen</button>
          <button onClick={() => { showPip(item.id); onClose(); }} className="btn-soft"><PictureInPicture2 size={18} /> In a box</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setIdle(isIdle ? '' : item.id)} aria-pressed={isIdle} className={isIdle ? 'btn bg-gold-400/20 ring-1 ring-gold-500' : 'btn-soft'}><Moon size={16} /> {isIdle ? 'Idle screen ✓' : 'Use as idle screen'}</button>
          <button onClick={() => setStyle({ bgId: isBg ? '' : item.id })} aria-pressed={isBg} className={isBg ? 'btn bg-gold-400/20 ring-1 ring-gold-500' : 'btn-soft'}><Layers size={16} /> {isBg ? 'Text background ✓' : 'Behind verses & songs'}</button>
          <button onClick={() => addPlan({ type: 'media', mediaId: item.id })} disabled={inPlan} className="btn-soft"><ListPlus size={16} /> {inPlan ? 'In plan' : 'Add to plan'}</button>
          <button onClick={() => { if (window.confirm(`Remove "${item.name}"?`)) { removeMediaFile(item); removeMedia(item.id); onClose(); } }} className="btn-soft text-red-600 dark:text-red-400"><Trash2 size={16} /> Remove</button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold">On screen</span>
          <Seg label="Picture fit" value={item.fit || 'contain'} onChange={(fit) => updateMedia(item.id, { fit })} options={[['contain', 'Show all'], ['cover', 'Fill screen']]} />
        </div>
        <p className="text-xs text-stone-500 dark:text-stone-400">{item.kind === 'video' ? 'Video' : 'Picture'}{item.size ? ` · ${formatSize(item.size)}` : ''}. The idle screen shows whenever you press Clear.</p>
      </div>
    </Sheet>
  );
}

export default function MediaTab() {
  const { media, addMedia, live, mode, idleId, style } = useStore();
  const [openId, setOpenId] = useState(null);
  const [msg, setMsg] = useState(null);
  const file = useRef(null);

  const added = (items, problems = []) => {
    addMedia(items);
    const ok = items.length ? `Added ${items.length} ${items.length === 1 ? 'file' : 'files'}.` : '';
    if (problems.length) setMsg({ text: [ok, ...problems].filter(Boolean).join(' '), bad: true });
    else setMsg(items.length ? { text: ok } : { text: 'Choose pictures, MP4 videos, PDFs or PowerPoint, Word and Excel files.', bad: true });
  };
  const pick = () => {
    if (!IS_NATIVE) { file.current.click(); return; }
    setMsg({ text: 'Copying… PDFs take a moment while each page is prepared.' });
    const problems = [];
    pickNativeMedia((text) => setMsg({ text: `Preparing ${text}…` }), problems).then((items) => added(items, problems)).catch((e) => setMsg(/cancel/i.test(e.message) ? null : { text: e.message || 'Those files could not be added.', bad: true }));
  };
  const onFiles = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    setMsg({ text: 'Saving…' });
    const problems = [];
    try { added(await addMediaFiles(files, (text) => setMsg({ text: `Preparing ${text}…` }), problems), problems); } catch (err) { setMsg({ text: /password/i.test(err?.message) ? 'That PDF is password-protected.' : err?.name === 'InvalidPDFException' ? 'That PDF could not be read.' : err?.message && !/quota/i.test(err.message) ? err.message : 'There is not enough space to keep those files.', bad: true }); }
  };

  const open = media.find((m) => m.id === openId);
  return (
    <div className="space-y-3">
      <button onClick={pick} className="btn-gold w-full"><ImagePlus size={18} /> Add pictures, videos or documents</button>
      <input ref={file} type="file" accept="image/*,video/mp4,video/webm,.mp4,.m4v,application/pdf,.pdf,.pptx,.docx,.xlsx,.csv,.txt,.ppt,.doc,.xls" multiple hidden onChange={onFiles} />
      {msg && <p className={`px-1 text-sm ${msg.bad ? 'text-red-600 dark:text-red-400' : 'text-stone-600 dark:text-stone-300'}`}>{msg.text}</p>}
      {!media.length ? <Empty>Add your church logo, announcement pictures, MP4 videos, PDFs, PowerPoint, Word and Excel files. They stay on this device and work without internet.</Empty> : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {media.map((m) => {
            const on = mode === 'show' && (live?.type === 'media' || live?.type === 'pdf') && live.mediaId === m.id;
            return (
              <button key={m.id} onClick={() => setOpenId(m.id)} className={`overflow-hidden rounded-xl text-left ${on ? 'ring-2 ring-red-600' : 'card'}`}>
                <Thumb item={m} className="aspect-video" />
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold">{m.name}</span>
                  {on && <MonitorPlay size={14} className="shrink-0 text-red-600" />}
                  {idleId === m.id && <Moon size={14} className="shrink-0 text-gold-500" aria-label="Idle screen" />}
                  {style.bgId === m.id && <Layers size={14} className="shrink-0 text-gold-500" aria-label="Text background" />}
                </div>
              </button>
            );
          })}
        </div>
      )}
      {open && <MediaSheet item={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}
