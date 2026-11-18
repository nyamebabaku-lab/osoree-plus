import { useEffect, useRef, useState } from 'react';
import { Ear, Play, Volume2, VolumeX, X } from 'lucide-react';
import { useStore } from './store.js';
import { IS_NATIVE, Screen } from './lib/output.js';
import { findRefs, refKey, refName } from './lib/listen.js';
import { askNotifications, buzz, notify } from './lib/notify.js';
import { useGate, ProLock } from './Pro.jsx';

const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const canListen = () => IS_NATIVE || (!!SR && !window.osoreeDesktop);

/**
 * Listens to the preacher and offers the scriptures it hears. Nothing goes on screen until the operator taps Show.
 * `feed(text)` is exposed for tests (window.osoreeHear).
 */
export default function ListenPanel({ bible }) {
  const gate = useGate();
  const goLive = useStore((s) => s.goLive);
  const span = useStore((s) => s.span);
  const sound = useStore((s) => s.listenSound);
  const setLicState = useStore((s) => s.setLicState);
  const [on, setOn] = useState(false);
  const [heard, setHeard] = useState('');
  const [error, setError] = useState('');
  const [cards, setCards] = useState([]); // [{ key, ref, at }]
  const recent = useRef(new Map()); // key → time last offered
  const web = useRef(null);
  const bibleRef = useRef(bible);
  bibleRef.current = bible;

  const feed = (text) => {
    setHeard(text);
    const live = useStore.getState().live;
    const ctx = live?.type === 'verse' ? live.refs[live.refs.length - 1] : null;
    const found = findRefs(text, bibleRef.current, ctx);
    const now = Date.now();
    const fresh = found.filter((r) => { const k = refKey(r); const t = recent.current.get(k); if (t && now - t < 60000) return false; recent.current.set(k, now); return true; });
    if (!fresh.length) return;
    setCards((c) => [...fresh.map((ref) => ({ key: refKey(ref) + now, ref, at: now })).reverse(), ...c].slice(0, 5));
    const st = useStore.getState();
    buzz({ sound: st.listenSound });
    notify('Scripture heard', fresh.map((r) => refName(r, bibleRef.current.bookNames)).join(', ') + ' — open Ɔsɔreɛ Plus to show it', { channel: 'scripture', onlyHidden: true });
  };
  const feedRef = useRef(feed);
  feedRef.current = feed;
  useEffect(() => { window.osoreeHear = (t) => feedRef.current(t); return () => { delete window.osoreeHear; }; }, []);

  const stop = () => {
    setOn(false); setHeard('');
    if (IS_NATIVE) Screen.stopListening().catch(() => {});
    else if (web.current) { const r = web.current; web.current = null; try { r.stop(); } catch { /* already */ } }
  };
  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // phone: events from the native listener
  useEffect(() => {
    if (!IS_NATIVE || !on) return undefined;
    const subs = [];
    Screen.addListener('speech', (e) => feedRef.current(e.text)).then((h) => subs.push(h));
    Screen.addListener('listen', (e) => { if (e.state === 'error') setError(e.message); if (e.state === 'off') setOn(false); }).then((h) => subs.push(h));
    return () => subs.forEach((h) => h.remove());
  }, [on]);

  const start = async () => {
    if (!gate('listen')) return;
    setError('');
    askNotifications();
    useStore.getState().countUse('listen');
    if (IS_NATIVE) {
      const { granted } = await Screen.requestMicrophone();
      if (!granted) { setError('Allow the microphone to listen for scriptures.'); return; }
      try { await Screen.startListening({ lang: 'en-US' }); setOn(true); } catch (e) { setError(e.message); }
      return;
    }
    const r = new SR();
    r.lang = 'en-US'; r.continuous = true; r.interimResults = true;
    r.onresult = (e) => { const res = e.results[e.results.length - 1]; feedRef.current(res[0].transcript); };
    r.onerror = (e) => { if (e.error === 'not-allowed') { setError('Microphone permission was refused.'); stop(); } else if (e.error === 'network') setError('This browser needs internet to listen.'); };
    r.onend = () => { if (web.current === r) try { r.start(); } catch { /* restarting */ } }; // keep listening
    web.current = r;
    try { r.start(); setOn(true); } catch (e) { setError(e.message); }
  };

  const show = (card) => {
    const { b, c, v, v2 } = card.ref;
    goLive({ type: 'verse', refs: [{ b, c, v: v ?? 0, n: v2 != null ? v2 - v + 1 : (v == null ? 1 : span) }] });
    setCards((cs) => cs.filter((x) => x !== card));
  };
  const text = (r) => { const end = r.v2 ?? r.v ?? 0; const vs = []; for (let k = r.v ?? 0; k <= Math.min(end, (r.v ?? 0) + 2); k++) vs.push(bible.books[r.b]?.[r.c]?.[k] || ''); return vs.join(' ').replace(/\[([^|\]]*)\|[^\]]*\]/g, '$1'); };

  if (!canListen()) return null;
  return (
    <section className={`rounded-2xl p-3 ${on ? 'bg-red-600/10 ring-1 ring-red-500/50' : 'bg-paper-100 dark:bg-night-800'}`} aria-label="Scripture listener">
      <div className="flex items-center gap-2">
        <button onClick={on ? stop : start} className={`btn min-h-10 flex-1 justify-start px-3 text-sm ${on ? 'bg-red-600 text-white' : 'btn-soft'}`}>
          {on ? <><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" /> Listening for scriptures… tap to stop</> : <><Ear size={16} /> Listen for scriptures <ProLock feature="listen" /></>}
        </button>
        <button onClick={() => setLicState({ listenSound: !sound })} aria-label={sound ? 'Alert sound on' : 'Alert sound off'} title="Alert sound" className="icon-btn h-10 w-10">{sound ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
      </div>
      {on && heard && <p className="mt-2 truncate text-xs italic text-stone-500 dark:text-stone-400" aria-label="Words heard">“{heard}”</p>}
      {error && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {cards.length > 0 && (
        <div className="mt-2 space-y-2">
          {cards.map((card) => (
            <div key={card.key} className="flex items-start gap-2 rounded-xl bg-white p-2.5 shadow-sm ring-1 ring-gold-500/60 dark:bg-night-900" aria-label={`Heard ${refName(card.ref, bible.bookNames)}`}>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-extrabold text-gold-600 dark:text-gold-400">{refName(card.ref, bible.bookNames)}</div>
                <div className="line-clamp-2 text-xs text-stone-600 dark:text-stone-300">{text(card.ref)}</div>
              </div>
              <button onClick={() => show(card)} className="btn-gold min-h-10 shrink-0 px-3 text-sm"><Play size={14} /> Show</button>
              <button onClick={() => setCards((cs) => cs.filter((x) => x !== card))} aria-label="Dismiss" className="icon-btn h-10 w-8 shrink-0"><X size={16} /></button>
            </div>
          ))}
        </div>
      )}
      {!on && !cards.length && <p className="mt-1.5 text-[11px] text-stone-500 dark:text-stone-400">Hears references like “John chapter three verse sixteen” and asks you before showing them.</p>}
    </section>
  );
}
