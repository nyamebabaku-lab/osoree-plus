import { useDeferredValue, useMemo, useState } from 'react';
import { ChevronRight, CornerDownLeft } from 'lucide-react';
import { useStore } from '../store.js';
import { NAMES, bookLabel, parseRefs, refLabel, spokenToRef } from '../lib/books.js';
import { search } from '../lib/bible.js';
import { MAX_REFS } from '../lib/slides.js';
import { tokens } from '../lib/strongs.js';
import { VerseRow, MicButton, Empty } from '../ui.jsx';
import StrongsSheet from './StrongsSheet.jsx';

// Checks typed references against this Bible. Returns { refs } or { error }, or null for "not a reference".
function checkRefs(bible, q) {
  const list = parseRefs(q);
  if (!list) return null;
  const refs = [];
  for (let r of list) {
    const chapters = bible.books[r.b];
    if (!chapters.length) return { error: `${bookLabel(r.b, bible.bookNames)} is not in this version` };
    // One-chapter books: "jude 3" means verse 3.
    if (chapters.length === 1 && r.c != null && r.v == null) r = { ...r, c: 0, v: r.c };
    if (r.c != null && r.c >= chapters.length) return { error: `${bookLabel(r.b, bible.bookNames)} has ${chapters.length} chapters` };
    if (r.c != null && !chapters[r.c].some(Boolean)) return { error: `${refLabel(r.b, r.c, null, 1, bible.bookNames)} is not in this version` };
    if (r.v != null && r.v >= chapters[r.c].length) return { error: `${refLabel(r.b, r.c, null, 1, bible.bookNames)} has ${chapters[r.c].length} verses` };
    const n = r.v2 > r.v ? Math.min(r.v2, chapters[r.c].length - 1) - r.v + 1 : null;
    refs.push({ ...r, n });
  }
  if (refs.length > 1 && refs.some((r) => r.v == null)) return { error: 'Give a verse for each reference, e.g. jn 3 16; rom 5 8' };
  if (refs.length > MAX_REFS) return { error: `Up to ${MAX_REFS} references at a time` };
  return { refs };
}

export default function BibleTab({ bible }) {
  const live = useStore((s) => s.live);
  const span = useStore((s) => s.span);
  const goLive = useStore((s) => s.goLive);
  const strongsOn = useStore((s) => s.strongsOn);
  const setStrongsOn = useStore((s) => s.setStrongsOn);
  const [study, setStudy] = useState(null); // { word, nums, at }
  const names = bible.bookNames;
  const [q, setQ] = useState('');
  const dq = useDeferredValue(q);
  const first = live?.type === 'verse' ? live.refs[0] : null;
  const [view, setView] = useState(first ? { b: first.b, c: first.c } : { b: null, c: null });

  const target = useMemo(() => (q.trim() ? checkRefs(bible, q) : null), [q, bible]);
  // Words that are not a reference (or only name a book) search the whole Bible.
  // A mistyped reference ("jn 3 99") shows what is wrong instead of searching.
  const dTarget = useMemo(() => (dq.trim() ? checkRefs(bible, dq) : null), [dq, bible]);
  const wordSearch = dq.trim().length >= 2 && (!dTarget || (dTarget.refs && dTarget.refs.every((r) => r.c == null)));
  const hits = useMemo(() => (wordSearch ? search(bible, dq) : []), [wordSearch, bible, dq]);

  const go = (t) => {
    if (!t?.refs) return;
    const r = t.refs[t.refs.length - 1];
    setView({ b: r.b, c: r.c });
    if (r.v != null) goLive({ type: 'verse', refs: t.refs.map((x) => ({ b: x.b, c: x.c, v: x.v, n: x.n || (t.refs.length > 1 ? 1 : span) })) });
    setQ('');
  };

  const book = view.b != null ? bible.books[view.b] : null;
  const chapter = book && view.c != null ? book[view.c] : null;
  const showsVerse = target?.refs && target.refs[0].v != null;

  return (
    <div className="space-y-3">
      <form onSubmit={(e) => { e.preventDefault(); if (target?.refs?.[0].c != null) go(target); }} className="flex gap-2">
        <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="jn 3 16 · rom 5 8; 6 23 · or words" aria-label="Verse or words" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go" />
        <MicButton onText={(heard) => {
          // Take the first interpretation that is a real verse; otherwise search the words.
          for (const t of heard) { const c = checkRefs(bible, spokenToRef(t)); if (c?.refs?.[0].v != null) { go(c); return; } }
          const c = checkRefs(bible, spokenToRef(heard[0]));
          setQ(c ? spokenToRef(heard[0]) : heard[0]);
        }} />
      </form>

      {target?.error && <p className="px-1 text-sm text-red-600 dark:text-red-400">{target.error}</p>}
      {target?.refs && (target.refs[0].c != null || target.refs.length === 1) && (
        <button onClick={() => (target.refs[0].c == null ? (setView({ b: target.refs[0].b, c: bible.books[target.refs[0].b].length === 1 ? 0 : null }), setQ('')) : go(target))} className="flex w-full items-center gap-2 rounded-xl bg-gold-400/20 px-3 py-2.5 text-left text-sm ring-1 ring-gold-500">
          <CornerDownLeft size={16} className="shrink-0 text-gold-600 dark:text-gold-400" />
          <span className="min-w-0 flex-1 truncate">
            <b>{target.refs.map((r) => (r.c == null ? bookLabel(r.b, names) : refLabel(r.b, r.c, r.v, r.n || 1, names))).join('; ')}</b>
            {showsVerse && target.refs.length === 1 && <span className="text-stone-500 dark:text-stone-400"> — {bible.books[target.refs[0].b][target.refs[0].c][target.refs[0].v]}</span>}
          </span>
          <span className="shrink-0 text-xs font-bold text-gold-700 dark:text-gold-300">{showsVerse ? 'SHOW' : 'OPEN'}</span>
        </button>
      )}

      {wordSearch ? (
        !hits.length ? <Empty>No verse in {bible.abbr} has those words.</Empty> : (
          <div className="space-y-0.5">
            <div className="label px-1">{hits.length >= 150 ? 'First 150 verses' : `${hits.length} ${hits.length === 1 ? 'verse' : 'verses'}`} with these words</div>
            {hits.map((h) => <VerseRow key={`${h.b}.${h.c}.${h.v}`} {...h} text={bible.books[h.b][h.c][h.v]} showRef names={names} />)}
          </div>
        )
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1 text-sm font-semibold">
            <button onClick={() => setView({ b: null, c: null })} className={view.b == null ? '' : 'text-gold-600 dark:text-gold-400'}>Books</button>
            {view.b != null && <><ChevronRight size={14} className="text-stone-400" /><button onClick={() => setView({ b: view.b, c: null })} className={view.c == null ? '' : 'text-gold-600 dark:text-gold-400'}>{bookLabel(view.b, names)}</button></>}
            {chapter && <><ChevronRight size={14} className="text-stone-400" /><span>Chapter {view.c + 1}</span></>}
            {chapter && bible.tagged && (
              <button onClick={() => setStrongsOn(!strongsOn)} aria-pressed={strongsOn} className={`ml-auto rounded-lg px-2.5 py-1 text-xs font-bold ${strongsOn ? 'bg-gold-400/25 text-gold-700 ring-1 ring-gold-500 dark:text-gold-300' : 'bg-paper-200 text-stone-500 dark:bg-night-800'}`}>Strong's {strongsOn ? 'on' : 'off'}</button>
            )}
          </div>

          {view.b == null && [['Old Testament', 0, 39], ['New Testament', 39, 66]].map(([title, from, to]) => (
            <section key={title}>
              <div className="label mb-2">{title}</div>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                {NAMES.slice(from, to).map((n, i) => (
                  <button key={n} disabled={!bible.books[from + i].length} onClick={() => setView({ b: from + i, c: bible.books[from + i].length === 1 ? 0 : null })} className="btn-soft min-h-10 truncate px-2 text-[13px]">{bookLabel(from + i, names)}</button>
                ))}
              </div>
            </section>
          ))}

          {book && !chapter && (
            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
              {book.map((_, c) => <button key={c} onClick={() => setView({ b: view.b, c })} className="btn-soft min-h-11 px-0">{c + 1}</button>)}
            </div>
          )}

          {chapter && (
            <div className="space-y-0.5">
              {bible.tagged && strongsOn && <p className="px-1 pb-1 text-xs text-stone-500 dark:text-stone-400">Tap an underlined word for its Hebrew or Greek meaning; tap elsewhere on the verse to show it.</p>}
              {chapter.map((t, v) => (
                <VerseRow key={v} b={view.b} c={view.c} v={v} text={t} num
                  words={bible.tagged && strongsOn ? tokens(bible.tagged[view.b][view.c][v]) : null}
                  onWord={(word, nums, at) => setStudy({ word, nums, at })} />
              ))}
              <div className="flex gap-2 pt-3">
                <button disabled={view.c === 0} onClick={() => setView({ b: view.b, c: view.c - 1 })} className="btn-soft flex-1">Previous chapter</button>
                <button disabled={view.c >= book.length - 1} onClick={() => setView({ b: view.b, c: view.c + 1 })} className="btn-soft flex-1">Next chapter</button>
              </div>
            </div>
          )}
        </>
      )}
      {study && <StrongsSheet bible={bible} {...study} onClose={() => setStudy(null)} />}
    </div>
  );
}
