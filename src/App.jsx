import { useEffect, useState } from 'react';
import {
  BookOpen, ChevronLeft, ChevronRight, EyeOff, Image, ListOrdered, ListPlus, Minus, Monitor, Moon, Music, Pause, Play,
  Plus, Radio, Repeat, RotateCcw, Square, Sun, Volume2, VolumeX, X,
} from 'lucide-react';
import { useStore, MAX_SPAN } from './store.js';
import { BUILTIN, blockSize, loadBible } from './lib/bible.js';
import { refLabel, setExtraBookNames } from './lib/books.js';
import { IS_NATIVE, Screen, send } from './lib/output.js';
import { screenState, slideKey, slideTitle, stepSlide, MAX_REFS } from './lib/slides.js';
import BibleTab from './tabs/BibleTab.jsx';
import SongsTab from './tabs/SongsTab.jsx';
import MediaTab from './tabs/MediaTab.jsx';
import PlanTab from './tabs/PlanTab.jsx';
import ScreenTab from './tabs/ScreenTab.jsx';
import LiveTab from './tabs/LiveTab.jsx';
import CameraMode from './CameraMode.jsx';
import { startWifiCamera } from './lib/wificam.js';

const TABS = [['bible', 'Bible', BookOpen], ['songs', 'Songs', Music], ['media', 'Media', Image], ['live', 'Live', Radio], ['plan', 'Plan', ListOrdered], ['screen', 'Screen', Monitor]];

function useDark(mode) {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', mode === 'dark' || (mode === 'system' && mq.matches));
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [mode]);
}

// Loads a Bible by id; keeps showing the previous one until the new one is ready.
function useBible(id) {
  const [state, setState] = useState({ bible: null, failed: false });
  useEffect(() => {
    if (!id) { setState({ bible: null, failed: false }); return undefined; }
    let on = true;
    loadBible(id).then((bible) => on && setState({ bible, failed: false })).catch(() => on && setState((s) => ({ ...s, failed: true })));
    return () => { on = false; };
  }, [id]);
  return state;
}

const Toggle = ({ on, onClick, label, children }) => (
  <button onClick={onClick} aria-pressed={on} aria-label={label} title={label} className={`btn min-h-9 px-3 ${on ? 'bg-gold-400/25 text-gold-700 ring-1 ring-gold-500 dark:text-gold-300' : 'bg-paper-200 text-stone-600 dark:bg-night-800 dark:text-stone-300'}`}>{children}</button>
);

// The preview gets what to show straight from this app (as every same-device screen does). In the phone app it
// is also told where the phone's screen server is, so the live camera picture shows on the phone as well.
function usePreviewUrl() {
  const [url, setUrl] = useState(IS_NATIVE ? '' : './display.html?preview');
  useEffect(() => {
    if (!IS_NATIVE) return;
    Screen.status().then((st) => setUrl(st.port ? `./display.html?preview&server=${encodeURIComponent(`http://127.0.0.1:${st.port}`)}` : './display.html?preview&nocam')).catch(() => setUrl('./display.html?preview&nocam'));
  }, []);
  return url;
}

// What is on screen right now, with the controls the operator needs most.
function LivePanel({ bible, versions }) {
  const s = useStore();
  const previewUrl = usePreviewUrl();
  const { live, mode, span, combine, compareId, versionId, video, songs, media, songLines } = s;
  const ctx = { bible, songs, media, songLines, span, people: s.people };
  const move = (dir) => { const n = stepSlide(live, dir, ctx); if (n) s.goLive(n); };
  const toggle = (m) => s.setMode(mode === m ? (live ? 'show' : 'clear') : m);
  const canNext = !!live && !!stepSlide(live, 1, ctx);
  const canPrev = !!live && !!stepSlide(live, -1, ctx);
  const isVerse = live?.type === 'verse';
  const liveMedia = live?.type === 'media' ? media.find((m) => m.id === live.mediaId) : null;
  const title = live ? slideTitle(live, ctx) + (isVerse ? ` · ${bible.abbr}` : '') : 'Nothing shown yet';
  const planSlide = live && (live.type === 'song' ? { ...live, idx: 0 } : live.type === 'pdf' ? { ...live, page: 0 } : live);
  const inPlan = planSlide && s.plan.some((p) => slideKey(p) === slideKey(planSlide));

  return (
    <div className="card overflow-hidden">
      <div className="relative aspect-video bg-black">
        {previewUrl && <iframe src={previewUrl} title="Screen preview" tabIndex={-1} allow="camera; autoplay" className="pointer-events-none absolute inset-0 h-full w-full border-0" />}
      </div>
      <div className="space-y-2 p-3">
        <div className="flex items-center gap-2">
          <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${mode === 'show' && live ? 'bg-red-600 text-white' : 'bg-paper-200 text-stone-600 dark:bg-night-700 dark:text-stone-300'}`}>
            {mode === 'show' && live ? 'LIVE' : mode === 'black' ? 'BLACK' : 'IDLE'}
          </span>
          {s.onAir && <span className="rounded-md bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white" title="Streaming live">ON AIR</span>}
          {s.cam.on && <span className="rounded-md bg-red-600/15 px-1.5 py-0.5 text-[10px] font-bold text-red-600 dark:text-red-400" title="Live video: text shows as a lower third">CAM</span>}
          <span className="min-w-0 flex-1 truncate text-sm font-bold">{title}</span>
          <button onClick={() => s.addPlan(planSlide)} disabled={!live || inPlan} aria-label="Add what is showing to the plan" className="icon-btn h-8 w-8 disabled:opacity-30"><ListPlus size={18} /></button>
        </div>

        {s.nameOn && (() => { const p = s.people.find((x) => x.id === s.nameOn); return p && (
          <div className="flex items-center gap-2 rounded-lg bg-gold-400/15 px-2 py-1 text-xs">
            <span className="font-bold text-gold-700 dark:text-gold-300">NAME TAG</span>
            <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
            <button onClick={() => s.toggleName(p.id)} aria-label="Hide the name tag" className="rounded p-1 hover:bg-paper-300 dark:hover:bg-night-700"><X size={12} /></button>
          </div>
        ); })()}
        {isVerse && live.refs.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {live.refs.map((r, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-paper-200 py-0.5 pl-2 pr-0.5 text-xs font-semibold dark:bg-night-800">
                {refLabel(r.b, r.c, r.v, blockSize(bible, r), bible.bookNames)}
                <button onClick={() => s.removeRef(i)} aria-label={`Remove ${refLabel(r.b, r.c, r.v)}`} className="rounded p-1 hover:bg-paper-300 dark:hover:bg-night-700"><X size={12} /></button>
              </span>
            ))}
          </div>
        )}

        <div className="grid grid-cols-4 gap-2">
          <button onClick={() => move(-1)} disabled={!canPrev} aria-label="Previous" className="btn-soft px-0"><ChevronLeft size={20} /></button>
          <button onClick={() => move(1)} disabled={!canNext} aria-label="Next" className="btn-gold px-0"><ChevronRight size={20} /></button>
          <button onClick={() => toggle('clear')} className={`${mode === 'clear' && live ? 'btn-on' : 'btn-soft'} px-0`}><EyeOff size={16} /> Clear</button>
          <button onClick={() => toggle('black')} className={`${mode === 'black' ? 'btn-on' : 'btn-soft'} px-0`}><Square size={16} /> Black</button>
        </div>

        {liveMedia?.kind === 'video' ? (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => s.setVideo({ playing: !video.playing })} className="btn-gold min-h-9 px-3">{video.playing ? <><Pause size={16} /> Pause</> : <><Play size={16} /> Play</>}</button>
            <button onClick={s.restartVideo} aria-label="Play from the start" title="Play from the start" className="btn-soft min-h-9 px-3"><RotateCcw size={16} /></button>
            <Toggle on={video.loop} onClick={() => s.setVideo({ loop: !video.loop })} label="Repeat video"><Repeat size={16} /></Toggle>
            <Toggle on={!video.muted} onClick={() => s.setVideo({ muted: !video.muted })} label={video.muted ? 'Sound off' : 'Sound on'}>{video.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</Toggle>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <span className="hidden font-semibold sm:inline">Verses</span>
            <div className="inline-flex items-center rounded-xl bg-paper-200 dark:bg-night-800">
              <button onClick={() => s.setSpan(span - 1)} disabled={span <= 1} aria-label="Fewer verses together" className="icon-btn h-9 w-9 disabled:opacity-30"><Minus size={16} /></button>
              <span className="w-5 text-center font-bold" aria-label="Verses together">{span}</span>
              <button onClick={() => s.setSpan(span + 1)} disabled={span >= MAX_SPAN} aria-label="More verses together" className="icon-btn h-9 w-9 disabled:opacity-30"><Plus size={16} /></button>
            </div>
            <Toggle on={combine} onClick={() => s.setCombine(!combine)} label={`Combine: tapping a verse adds it to the screen (up to ${MAX_REFS})`}>Combine</Toggle>
            <select value={compareId} onChange={(e) => s.setCompare(e.target.value)} aria-label="Compare with another version" className="min-h-9 min-w-0 flex-1 rounded-xl border border-paper-300 bg-white px-2 text-sm font-semibold dark:border-night-700 dark:bg-night-800">
              <option value="">Compare</option>
              {versions.filter((v) => v.id !== versionId).map((v) => <option key={v.id} value={v.id}>+ {v.abbr}</option>)}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

// Phone app, live video with "This phone": the camera is opened here once. The preview (same page family)
// takes this stream directly and the projector opens the same camera itself, so no network is needed.
// Screens on other devices get it over Wi-Fi through this phone's screen server.
function usePhoneCamera() {
  const on = useStore((s) => IS_NATIVE && s.cam.on && s.cam.source === 'phone');
  const facing = useStore((s) => s.cam.facing);
  const setCamStatus = useStore((s) => s.setCamStatus);
  useEffect(() => {
    if (!on) { setCamStatus(null); return undefined; }
    let stopWifi = null, stream = null, cancelled = false;
    setCamStatus({ state: 'starting', screens: 0 });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then(async (s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        window.osoreeCamStream = s; // read by the preview frame
        setCamStatus({ state: 'on' });
        const st = await Screen.status();
        const fn = await startWifiCamera({ address: `127.0.0.1:${st.port}`, stream: s, onStatus: (x) => !cancelled && x.screens && setCamStatus({ state: 'on', wifi: x.screens }) });
        if (cancelled) fn(); else stopWifi = fn;
      })
      .catch((e) => !cancelled && setCamStatus({ error: e?.name === 'NotAllowedError' ? 'Camera permission is needed.' : e?.name === 'NotReadableError' ? 'The camera is busy in another app. Close it and try again.' : e?.message || 'The camera could not start.' }));
    return () => {
      cancelled = true;
      stopWifi?.();
      stream?.getTracks().forEach((t) => t.stop());
      if (window.osoreeCamStream === stream) delete window.osoreeCamStream;
    };
  }, [on, facing, setCamStatus]);
}

// Keyboard control for laptops: → / Space / PageDown next, ← / PageUp back, C clear, B black.
function useKeys(bible) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || document.querySelector('[role=dialog]')) return;
      const s = useStore.getState();
      const ctx = { bible, songs: s.songs, media: s.media, songLines: s.songLines, span: s.span };
      const dir = { ArrowRight: 1, PageDown: 1, ' ': 1, ArrowLeft: -1, PageUp: -1 }[e.key];
      if (dir) { const n = stepSlide(s.live, dir, ctx); if (n) { e.preventDefault(); s.goLive(n); } return; }
      const k = e.key.toLowerCase();
      if (k === 'c' || k === 'b') { const m = k === 'c' ? 'clear' : 'black'; s.setMode(s.mode === m ? (s.live ? 'show' : 'clear') : m); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bible]);
}

export default function App() {
  const state = useStore();
  const { versionId, compareId, setVersion, setCompare, themeMode, setThemeMode, imported, plan, songs, media } = state;
  const { bible, failed } = useBible(versionId);
  const { bible: compare, failed: compareFailed } = useBible(compareId);
  const [tab, setTab] = useState('bible');
  const [cameraMode, setCameraMode] = useState(false);
  useDark(themeMode);
  useKeys(bible);
  usePhoneCamera();
  useEffect(() => { setExtraBookNames(bible?.bookNames); }, [bible]);

  // Keep every screen in step with the operator.
  const message = bible ? screenState(state, { bible, compare: compareId ? compare : null, songs, media }) : null;
  const json = message ? JSON.stringify(message) : '';
  useEffect(() => { if (json) send(JSON.parse(json)); }, [json]);

  const isDark = document.documentElement.classList.contains('dark');
  const versions = [...BUILTIN, ...imported];

  if (cameraMode) return <CameraMode onExit={() => setCameraMode(false)} />;

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col">
      <header className="flex items-center gap-2 px-4 pb-2 pt-[max(.75rem,env(safe-area-inset-top))]">
        <h1 className="mr-auto text-lg font-bold tracking-tight">Ɔsɔreɛ <span className="text-gold-500">Plus</span></h1>
        <select value={versionId} onChange={(e) => setVersion(e.target.value)} aria-label="Bible version" className="min-h-10 max-w-[11rem] rounded-xl border border-paper-300 bg-white px-2 text-sm font-semibold dark:border-night-700 dark:bg-night-800">
          {versions.map((v) => <option key={v.id} value={v.id}>{v.abbr} · {v.name}</option>)}
        </select>
        <button onClick={() => setThemeMode(isDark ? 'light' : 'dark')} aria-label="Switch theme" className="icon-btn">{isDark ? <Sun size={18} /> : <Moon size={18} />}</button>
      </header>

      {!bible ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-stone-500">
          {failed ? <div className="space-y-3"><p>This Bible could not be opened.</p><button onClick={() => setVersion('kjv')} className="btn-soft">Use KJV</button></div> : 'Opening the Bible…'}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 lg:flex-row lg:gap-5">
          <div className="shrink-0 lg:w-[400px]"><LivePanel bible={bible} versions={versions} /></div>
          <main className="min-h-0 flex-1 overflow-y-auto px-px pb-4 pt-px">
            {failed && <p className="mb-2 text-sm text-red-600 dark:text-red-400">That Bible could not be opened; still showing {bible.abbr}.</p>}
            {compareFailed && <p className="mb-2 text-sm text-red-600 dark:text-red-400">The comparison Bible could not be opened. <button onClick={() => setCompare('')} className="font-semibold underline">Turn compare off</button></p>}
            {tab === 'bible' && <BibleTab bible={bible} />}
            {tab === 'songs' && <SongsTab />}
            {tab === 'media' && <MediaTab />}
            {tab === 'plan' && <PlanTab bible={bible} />}
            {tab === 'live' && <LiveTab onCameraMode={() => setCameraMode(true)} />}
            {tab === 'screen' && <ScreenTab />}
          </main>
        </div>
      )}

      <nav className="grid grid-cols-6 border-t border-paper-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-night-700 dark:bg-night-900">
        {TABS.map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)} className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${tab === id ? 'text-gold-600 dark:text-gold-400' : 'text-stone-500 dark:text-stone-400'}`}>
            <span className="relative">
              <Icon size={20} />
              {id === 'plan' && plan.length > 0 && <span className="absolute -right-4 -top-1.5 rounded-full bg-gold-400 px-1.5 text-[10px] font-bold text-night-950">{plan.length}</span>}
            </span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
