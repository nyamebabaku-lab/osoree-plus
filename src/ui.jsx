import { useEffect, useRef, useState } from 'react';
import { Mic, Plus, Check, X } from 'lucide-react';
import { useStore, isLiveVerse } from './store.js';
import { refLabel } from './lib/books.js';
import { slideKey } from './lib/slides.js';
import { IS_NATIVE, Screen } from './lib/output.js';

const verseSlide = (b, c, v, n) => ({ type: 'verse', refs: [{ b, c, v, n }] });

// A verse (or a block of n verses) in a list: tap to put it on screen, + to add it to the service plan.
// With `words` (a Strong's verse split by lib/strongs.js tokens), tagged words open onWord instead.
export function VerseRow({ b, c, v, n, text, showRef, num, words, onWord, names }) {
  const showVerse = useStore((s) => s.showVerse);
  const addPlan = useStore((s) => s.addPlan);
  const span = useStore((s) => s.span);
  const live = useStore((s) => isLiveVerse(s, b, c, v));
  const planKey = slideKey(verseSlide(b, c, v, n || 1));
  const planned = useStore((s) => s.plan.some((x) => slideKey(x) === planKey));
  const ref = useRef(null);
  useEffect(() => { if (live) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [live]);
  return (
    <div ref={ref} className={`flex items-stretch gap-1 rounded-xl ${live ? 'bg-gold-400/20 ring-1 ring-gold-500' : 'hover:bg-paper-200/60 dark:hover:bg-night-800'}`}>
      {words ? (
        <div onClick={() => showVerse(b, c, v, n)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && showVerse(b, c, v, n)} className="min-w-0 flex-1 cursor-pointer px-3 py-2.5 text-left">
          <div className="text-[15px] leading-relaxed">
            {num && <span className="mr-2 text-xs font-bold text-stone-400">{v + 1}</span>}
            {words.map((w, i) => (w.n
              ? <button key={i} onClick={(e) => { e.stopPropagation(); onWord(w.t, w.n, { b, c, v }); }} className="rounded underline decoration-gold-500/60 decoration-dotted underline-offset-4 hover:bg-gold-400/20">{w.t}</button>
              : <span key={i}>{w.t}</span>))}
          </div>
        </div>
      ) : (
        <button onClick={() => showVerse(b, c, v, n)} className="min-w-0 flex-1 px-3 py-2.5 text-left">
          {showRef && <div className="mb-0.5 text-xs font-bold text-gold-600 dark:text-gold-400">{refLabel(b, c, v, n || 1, names)}</div>}
          <div className="text-[15px] leading-snug">
            {num && <span className="mr-2 text-xs font-bold text-stone-400">{v + 1}</span>}
            {text || <span className="italic text-stone-400">Not in this version</span>}
          </div>
        </button>
      )}
      <button onClick={() => addPlan(verseSlide(b, c, v, n || span))} disabled={planned} aria-label={planned ? 'In plan' : 'Add to plan'} className="icon-btn my-auto mr-1 disabled:opacity-100">
        {planned ? <Check size={18} className="text-gold-500" /> : <Plus size={18} />}
      </button>
    </div>
  );
}

// Microphone button. Phone app: Android's speech recogniser. Browser: the Web Speech API where it exists.
// onText receives every way the recogniser heard it (best first), so the caller can pick the one that makes sense.
export function MicButton({ onText }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const [on, setOn] = useState(false);
  const [error, setError] = useState('');
  if (!IS_NATIVE && !SR) return null;
  const start = () => {
    setError('');
    if (IS_NATIVE) {
      setOn(true);
      Screen.listen({ prompt: 'Say a verse, e.g. John 3 16' })
        .then((r) => onText(r.results))
        .catch((e) => { if (!/cancel/i.test(e?.message)) setError(e?.message || 'Voice search did not work.'); })
        .finally(() => setOn(false));
      return;
    }
    const r = new SR();
    r.lang = 'en-US';
    r.maxAlternatives = 5;
    r.onresult = (e) => onText([...e.results[0]].map((x) => x.transcript));
    r.onend = () => setOn(false);
    r.onerror = (e) => { setOn(false); if (e.error !== 'no-speech' && e.error !== 'aborted') setError(e.error === 'not-allowed' ? 'Microphone permission was refused.' : e.error === 'network' ? 'This browser needs internet for voice search.' : 'Voice search did not work.'); };
    setOn(true);
    r.start();
  };
  return (
    <span className="relative">
      <button type="button" onClick={start} aria-label="Speak" className={`icon-btn h-12 w-12 ${on ? 'animate-pulse bg-red-600 text-white dark:text-white' : 'bg-paper-200 dark:bg-night-700'}`}>
        <Mic size={20} />
      </button>
      {error && <span role="alert" onClick={() => setError('')} className="absolute right-0 top-14 z-10 w-60 rounded-xl bg-red-600 px-3 py-2 text-xs font-semibold text-white shadow-lg">{error}</span>}
    </span>
  );
}

export const Empty = ({ children }) => <p className="px-3 py-8 text-center text-sm text-stone-500 dark:text-stone-400">{children}</p>;

export const Seg = ({ value, onChange, options, label }) => (
  <div role="group" aria-label={label} className="inline-flex flex-wrap rounded-xl bg-paper-200 p-1 dark:bg-night-800">
    {options.map(([v, text]) => (
      <button key={String(v)} onClick={() => onChange(v)} aria-pressed={value === v} className={`min-h-9 rounded-lg px-3 text-sm font-semibold ${value === v ? 'bg-white shadow-sm dark:bg-night-700' : 'text-stone-500 dark:text-stone-400'}`}>{text}</button>
    ))}
  </div>
);

export function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()} className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl bg-white dark:bg-night-900 sm:rounded-2xl">
        <div className="flex items-center gap-2 border-b border-paper-200 px-4 py-3 dark:border-night-700">
          <h2 className="mr-auto font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="icon-btn"><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
