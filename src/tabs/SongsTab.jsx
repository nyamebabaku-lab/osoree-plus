import { useMemo, useRef, useState } from 'react';
import { ChevronLeft, FileUp, ListPlus, Music, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useStore } from '../store.js';
import { newSongId, songFromText, songSlides } from '../lib/songs.js';
import { slideKey } from '../lib/slides.js';
import { Empty, Seg, Sheet } from '../ui.jsx';

function SongEditor({ song, onClose, onSaved }) {
  const saveSong = useStore((s) => s.saveSong);
  const songLines = useStore((s) => s.songLines);
  const [draft, setDraft] = useState(song || { id: newSongId(), title: '', author: '', lyrics: '' });
  const slides = songSlides(draft.lyrics, songLines);
  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });
  const save = () => {
    const s = { ...draft, title: draft.title.trim() || 'Untitled song', author: draft.author.trim() };
    saveSong(s);
    onSaved?.(s.id);
    onClose();
  };
  return (
    <Sheet title={song ? 'Edit song' : 'New song'} onClose={onClose}>
      <div className="space-y-3">
        <input className="field" value={draft.title} onChange={set('title')} placeholder="Song title" aria-label="Song title" />
        <input className="field" value={draft.author} onChange={set('author')} placeholder="Writer or source (optional)" aria-label="Writer" />
        <textarea value={draft.lyrics} onChange={set('lyrics')} rows={12} aria-label="Lyrics" placeholder={'Verse 1\nFirst line\nSecond line\n\nChorus\nChorus line…'} className="field min-h-[14rem] py-3 font-mono text-[14px] leading-relaxed" />
        <p className="text-sm text-stone-500 dark:text-stone-400">Leave a blank line between slides. A line such as <b>Verse 2</b>, <b>Chorus</b> or <b>[Bridge]</b> names the slide and is not shown on screen.</p>
        <div className="label">{slides.length} {slides.length === 1 ? 'slide' : 'slides'}</div>
        <div className="flex gap-2">
          <button onClick={onClose} className="btn-soft flex-1">Cancel</button>
          <button onClick={save} disabled={!draft.lyrics.trim()} className="btn-gold flex-1">Save song</button>
        </div>
      </div>
    </Sheet>
  );
}

function SongView({ song, onBack, onEdit }) {
  const { live, mode, goLive, addPlan, plan, songLines, deleteSong } = useStore();
  const slides = songSlides(song.lyrics, songLines);
  const inPlan = plan.some((p) => slideKey(p) === slideKey({ type: 'song', songId: song.id, idx: 0 }));
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1">
        <button onClick={onBack} aria-label="All songs" className="icon-btn"><ChevronLeft size={20} /></button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-bold">{song.title}</h2>
          {song.author && <p className="truncate text-xs text-stone-500 dark:text-stone-400">{song.author}</p>}
        </div>
        <button onClick={() => addPlan({ type: 'song', songId: song.id, idx: 0 })} disabled={inPlan} aria-label="Add song to plan" className="icon-btn disabled:opacity-30"><ListPlus size={18} /></button>
        <button onClick={onEdit} aria-label="Edit song" className="icon-btn"><Pencil size={18} /></button>
        <button onClick={() => { if (window.confirm(`Delete "${song.title}"?`)) { deleteSong(song.id); onBack(); } }} aria-label="Delete song" className="icon-btn"><Trash2 size={18} /></button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {slides.map((sl, idx) => {
          const on = mode === 'show' && live?.type === 'song' && live.songId === song.id && (live.idx || 0) === idx;
          return (
            <button key={idx} onClick={() => goLive({ type: 'song', songId: song.id, idx })} className={`rounded-xl p-3 text-left ${on ? 'bg-gold-400/20 ring-1 ring-gold-500' : 'card hover:border-gold-500'}`}>
              <div className="mb-1 text-xs font-bold uppercase tracking-wide text-gold-600 dark:text-gold-400">{sl.label}</div>
              <div className="whitespace-pre-line text-[14px] leading-snug">{sl.lines.join('\n')}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function SongsTab() {
  const { songs, songLines, setSongLines, addSongs, live } = useStore();
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(live?.type === 'song' ? live.songId : null);
  const [editing, setEditing] = useState(null); // null | 'new' | song
  const [msg, setMsg] = useState('');
  const file = useRef(null);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const sorted = [...songs].sort((a, b) => a.title.localeCompare(b.title));
    if (!t) return sorted;
    return sorted.filter((s) => s.title.toLowerCase().includes(t) || s.lyrics.toLowerCase().includes(t));
  }, [songs, q]);

  const importFiles = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    const added = [];
    for (const f of files) {
      const text = await f.text();
      if (text.trim()) added.push({ ...songFromText(text, f.name), id: newSongId() });
    }
    addSongs(added);
    setMsg(added.length ? `Added ${added.length} ${added.length === 1 ? 'song' : 'songs'}.` : 'No lyrics found in those files.');
  };

  const open = songs.find((s) => s.id === openId);
  return (
    <div className="space-y-3">
      {open ? <SongView song={open} onBack={() => setOpenId(null)} onEdit={() => setEditing(open)} /> : (
        <>
          <div className="relative">
            <Search size={18} className="pointer-events-none absolute left-3.5 top-3.5 text-stone-400" />
            <input className="field pl-11" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a song by title or words" aria-label="Find a song" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setEditing('new')} className="btn-gold flex-1"><Plus size={18} /> New song</button>
            <button onClick={() => file.current.click()} className="btn-soft flex-1"><FileUp size={18} /> Import .txt</button>
            <input ref={file} type="file" accept=".txt,text/plain" multiple hidden onChange={importFiles} />
          </div>
          {msg && <p className="px-1 text-sm text-stone-600 dark:text-stone-300">{msg}</p>}
          {!list.length ? <Empty>{songs.length ? 'No song matches.' : 'No songs yet. Add one with "New song".'}</Empty> : (
            <div className="space-y-1">
              {list.map((s) => (
                <button key={s.id} onClick={() => { setOpenId(s.id); setQ(''); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${live?.type === 'song' && live.songId === s.id ? 'bg-gold-400/20 ring-1 ring-gold-500' : 'hover:bg-paper-200/60 dark:hover:bg-night-800'}`}>
                  <Music size={18} className="shrink-0 text-gold-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{s.title}</span>
                    <span className="block truncate text-xs text-stone-500 dark:text-stone-400">{s.author || s.lyrics.split('\n').find((l) => l.trim() && !/^\[?(verse|chorus)/i.test(l))}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-paper-200 pt-3 dark:border-night-700">
            <span className="text-sm font-semibold">Lines per slide</span>
            <Seg label="Lines per slide" value={songLines} onChange={setSongLines} options={[[0, 'Whole verse'], [2, '2'], [4, '4']]} />
          </div>
        </>
      )}
      {editing && <SongEditor song={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(id) => setOpenId(id)} />}
    </div>
  );
}
