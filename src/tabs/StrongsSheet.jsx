import { useEffect, useMemo, useState } from 'react';
import { MonitorUp } from 'lucide-react';
import { useStore } from '../store.js';
import { lookup, occurrences } from '../lib/strongs.js';
import { refLabel } from '../lib/books.js';
import { Sheet } from '../ui.jsx';

// The Hebrew or Greek behind a KJV word, with a button to put it on screen.
export default function StrongsSheet({ bible, word, nums, at, onClose }) {
  const goLive = useStore((s) => s.goLive);
  const showVerse = useStore((s) => s.showVerse);
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');
  const [usesOf, setUsesOf] = useState(null);
  const ref = at ? refLabel(at.b, at.c, at.v) : '';

  useEffect(() => {
    let on = true;
    Promise.all(nums.map(lookup)).then((list) => on && setEntries(list.filter(Boolean))).catch(() => on && setError("The Strong's dictionary could not be opened."));
    return () => { on = false; };
  }, [nums]);
  const uses = useMemo(() => (usesOf ? occurrences(bible, usesOf) : []), [bible, usesOf]);

  return (
    <Sheet title={`“${word}”${ref ? ` · ${ref}` : ''}`} onClose={onClose}>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!entries && !error && <p className="text-sm text-stone-500">Opening…</p>}
      <div className="space-y-4">
        {entries?.map((e) => (
          <div key={e.num} className="space-y-2">
            <div className="flex items-baseline gap-3">
              <span dir="auto" className="font-serif text-3xl text-gold-600 dark:text-gold-400">{e.lemma}</span>
              <span className="text-sm text-stone-500 dark:text-stone-400">{e.lang} · {e.num}</span>
            </div>
            <p className="text-sm"><b>{e.xlit}</b>{e.pron && <span className="text-stone-500 dark:text-stone-400"> ({e.pron})</span>}</p>
            <p className="text-[15px] leading-snug">{e.def}</p>
            {e.kjv && <p className="text-sm text-stone-600 dark:text-stone-300"><b>KJV:</b> {e.kjv}</p>}
            {e.origin && <p className="text-xs text-stone-500 dark:text-stone-400">{e.origin}</p>}
            <div className="flex flex-wrap gap-2">
              <button onClick={() => { goLive({ type: 'strongs', entry: e, word, ref }); onClose(); }} className="btn-gold flex-1"><MonitorUp size={16} /> Show on screen</button>
              <button onClick={() => setUsesOf(usesOf === e.num ? null : e.num)} className="btn-soft flex-1">{usesOf === e.num ? 'Hide verses' : 'Other verses'}</button>
            </div>
            {usesOf === e.num && (
              <div className="max-h-72 space-y-0.5 overflow-y-auto rounded-xl border border-paper-200 p-1 dark:border-night-700">
                <div className="label px-2 py-1">{uses.length >= 300 ? 'First 300 verses' : `${uses.length} verses`} with {e.num}</div>
                {uses.map((u) => (
                  <button key={`${u.b}.${u.c}.${u.v}`} onClick={() => { showVerse(u.b, u.c, u.v, 1); onClose(); }} className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-paper-200 dark:hover:bg-night-800">
                    <b className="text-gold-600 dark:text-gold-400">{refLabel(u.b, u.c, u.v)}</b> {bible.books[u.b][u.c][u.v]}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11px] text-stone-400">Strong's dictionary (1890/1894) · digital text © Open Scriptures, CC BY-SA.</p>
    </Sheet>
  );
}
