import { useEffect, useState } from 'react';
import { Copy, ListPlus, Pencil, Plus, RefreshCw, Smartphone, Trash2, UserRound, Video, VideoOff } from 'lucide-react';
import { useStore, DEFAULT_LT } from '../store.js';
import { IS_NATIVE, Screen } from '../lib/output.js';
import { FONTS } from '../lib/fonts.js';
import { slideKey } from '../lib/slides.js';
import { Empty, Seg, Sheet } from '../ui.jsx';
import { MediaChoice, Row, Swatches } from './ScreenTab.jsx';
import { GoLiveSection, ObsGuide } from './GoLive.jsx';

const BARS = ['#0b1f3a', '#000000', '#12301f', '#3a0d12', '#2b1a45', '#ffffff'];
const ACCENTS = ['#e2b232', '#ffffff', '#ef4444', '#22c55e', '#38bdf8'];

// Cameras this computer can use (webcams, capture cards). Labels appear once permission is given.
function useCameras() {
  const [list, setList] = useState([]);
  const [error, setError] = useState('');
  const refresh = async (ask) => {
    setError('');
    try {
      if (ask) { const s = await navigator.mediaDevices.getUserMedia({ video: true }); s.getTracks().forEach((t) => t.stop()); }
      const all = await navigator.mediaDevices.enumerateDevices();
      setList(all.filter((d) => d.kind === 'videoinput'));
    } catch (e) {
      setError(e?.name === 'NotAllowedError' ? 'Camera permission was refused. Allow it in the browser’s address bar, then try again.' : e?.name === 'NotFoundError' ? 'No camera found. Plug in the webcam or capture card.' : 'Cameras cannot be used on this page. Open Ɔsɔreɛ Plus from this computer (not over Wi-Fi).');
    }
  };
  useEffect(() => { if (!IS_NATIVE && navigator.mediaDevices?.enumerateDevices) refresh(false); }, []);
  return { list, error, refresh };
}

function PhoneCamStatus() {
  const st = useStore((s) => s.camStatus);
  if (!st) return null;
  if (st.error) return <p className="text-sm text-red-600 dark:text-red-400">{st.error}</p>;
  if (st.state === 'starting') return <p className="text-sm text-stone-500 dark:text-stone-400">Starting the camera…</p>;
  return <p className="text-sm text-stone-500 dark:text-stone-400">Camera on: showing here and on the projector (no internet needed){st.wifi ? `, and on ${st.wifi} Wi-Fi ${st.wifi === 1 ? 'screen' : 'screens'}` : ''}.</p>;
}

function CameraSection() {
  const { cam, setCam } = useStore();
  const { list, error, refresh } = useCameras();
  const [note, setNote] = useState('');
  const [st, setSt] = useState({ display: true, camera: false, urls: [], server: false });
  useEffect(() => {
    if (!IS_NATIVE) return undefined;
    const get = () => Screen.status().then(setSt).catch(() => {});
    get();
    const t = setInterval(get, 2000);
    return () => clearInterval(t);
  }, [cam.on, cam.source]);
  const remote = cam.source === 'remote';

  const turnOn = async () => {
    setNote('');
    if (IS_NATIVE && remote) {
      // The camera phone reaches this phone through the screen server, so Wi-Fi screens must be on.
      await Screen.startServer().then(setSt).catch(() => {});
      setCam({ on: true });
      return;
    }
    if (IS_NATIVE) {
      const { granted } = await Screen.requestCamera().catch(() => ({ granted: false }));
      if (!granted) { setNote('Camera permission is needed for live video.'); return; }
      setCam({ on: true, source: 'phone', deviceId: '' });
      return;
    }
    if (!list.some((d) => d.label)) await refresh(true);
    setCam({ on: true, source: 'device' });
  };

  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center gap-2">
        <div className="label mr-auto">Live video</div>
        <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${cam.on ? 'bg-red-600 text-white' : 'bg-paper-200 text-stone-500 dark:bg-night-700'}`}>{cam.on ? 'CAMERA ON' : 'OFF'}</span>
      </div>
      <p className="text-sm text-stone-500 dark:text-stone-400">The camera fills the screen and verses, songs and names appear in a bar along the bottom.</p>
      {cam.on
        ? <button onClick={() => setCam({ on: false })} className="btn-soft w-full"><VideoOff size={18} /> Turn off live video</button>
        : <button onClick={turnOn} className="btn-gold w-full"><Video size={18} /> Turn on live video</button>}

      {IS_NATIVE ? (
        <>
          <Row label="Camera"><Seg label="Camera source" value={remote ? 'remote' : 'phone'} onChange={(v) => setCam({ source: v })} options={[['phone', 'This phone'], ['remote', 'Another phone']]} /></Row>
          {!remote && <Row label="Phone camera"><Seg label="Phone camera" value={cam.facing} onChange={(facing) => setCam({ facing })} options={[['environment', 'Back'], ['user', 'Front']]} /></Row>}
          {!remote && cam.on && <PhoneCamStatus />}
          {remote && (
            <div className="space-y-2 rounded-xl bg-paper-100 p-3 text-sm dark:bg-night-800">
              <p>On the camera phone: open Ɔsɔreɛ Plus → <b>Live</b> → <b>Use this phone as a camera</b>, and type:</p>
              {st.server && st.urls.length
                ? st.urls.map((u) => <div key={u} className="select-all rounded-lg bg-white px-3 py-2 text-center font-mono text-lg font-bold dark:bg-night-900">{u.replace('http://', '')}</div>)
                : <p className="text-amber-600 dark:text-amber-400">{st.server ? 'Join a Wi-Fi network or turn on this phone’s hotspot to get an address.' : 'Turn on live video to get the address.'}</p>}
              <p className="flex items-center gap-2 font-semibold"><span className={`inline-block h-2.5 w-2.5 rounded-full ${st.camera ? 'bg-green-500' : 'bg-stone-400'}`} />{st.camera ? 'Camera phone connected' : 'Waiting for the camera phone'}</p>
            </div>
          )}
        </>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <select value={cam.deviceId} onChange={(e) => setCam({ deviceId: e.target.value, source: 'device' })} aria-label="Camera" className="field min-h-11 flex-1">
              <option value="">Default camera</option>
              {list.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
            </select>
            <button onClick={() => refresh(true)} aria-label="Find cameras" title="Find cameras" className="icon-btn h-11 w-11 bg-paper-200 dark:bg-night-700"><RefreshCw size={18} /></button>
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400">A webcam or an HDMI capture card from the church camera both appear here.</p>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
      )}
      <Row label="Mirror picture"><Seg label="Mirror picture" value={cam.mirror} onChange={(mirror) => setCam({ mirror })} options={[[false, 'Off'], [true, 'On']]} /></Row>
      {note && <p className="text-sm text-red-600 dark:text-red-400">{note}</p>}
    </section>
  );
}

function CameraDeviceSection({ onCameraMode }) {
  return (
    <section className="card space-y-3 p-4">
      <div className="label">Use this {IS_NATIVE ? 'phone' : 'device'} as a camera</div>
      <p className="text-sm text-stone-500 dark:text-stone-400">Point this {IS_NATIVE ? 'phone' : 'device'} at the pulpit and send its camera over Wi-Fi to the main phone’s projector and screens. No internet needed.</p>
      <button onClick={onCameraMode} className="btn-soft w-full"><Smartphone size={18} /> Open camera mode</button>
    </section>
  );
}

function WatermarkSection() {
  const { watermark: w, setWatermark } = useStore();
  return (
    <section className="card space-y-3 p-4">
      <div className="label">Church logo watermark</div>
      <p className="text-sm text-stone-500 dark:text-stone-400">A small logo in a corner of the live stream. Pick a picture from Media (a PNG with a see-through background looks best).</p>
      <MediaChoice label="Watermark picture" value={w.id} onChange={(id) => setWatermark({ id })} none="No logo" imagesOnly />
      {w.id && (
        <>
          <Row label="Corner"><Seg label="Watermark corner" value={w.corner} onChange={(corner) => setWatermark({ corner })} options={[['tl', '↖'], ['tr', '↗'], ['bl', '↙'], ['br', '↘']]} /></Row>
          <Row label="Size"><Seg label="Watermark size" value={w.size} onChange={(size) => setWatermark({ size })} options={[[0.07, 'S'], [0.1, 'M'], [0.14, 'L']]} /></Row>
          <div>
            <div className="flex items-center justify-between text-sm font-semibold"><span>Strength</span><span className="text-stone-500">{Math.round(w.opacity * 100)}%</span></div>
            <input type="range" min="0.3" max="1" step="0.05" value={w.opacity} onChange={(e) => setWatermark({ opacity: parseFloat(e.target.value) })} aria-label="Watermark strength" className="mt-2 w-full accent-gold-500" />
          </div>
          <Row label="Show on"><Seg label="Watermark shows on" value={w.where} onChange={(where) => setWatermark({ where })} options={[['stream', 'Stream only'], ['all', 'All screens']]} /></Row>
        </>
      )}
    </section>
  );
}

function OverlaySection() {
  const [urls, setUrls] = useState([]);
  const [server, setServer] = useState(false);
  const [copied, setCopied] = useState('');
  useEffect(() => {
    if (!IS_NATIVE) return undefined;
    const get = () => Screen.status().then((s) => { setServer(s.server); setUrls(s.urls); }).catch(() => {});
    get();
    const t = setInterval(get, 4000);
    return () => clearInterval(t);
  }, []);
  const links = IS_NATIVE ? urls.map((u) => `${u}/?overlay`) : [new URL('display.html?overlay', location.href).href];
  const copy = (u) => navigator.clipboard?.writeText(u).then(() => { setCopied(u); setTimeout(() => setCopied(''), 1500); }).catch(() => {});
  return (
    <section className="card space-y-3 p-4">
      <div className="label">Overlay for OBS / vMix</div>
      <p className="text-sm text-stone-500 dark:text-stone-400">For Facebook or YouTube streams: add a <b>Browser source</b> in OBS (or a Web Browser input in vMix), 1920 × 1080, with this address. It shows only the lower third and ticker on a see-through background, on top of your camera.</p>
      {IS_NATIVE && !server && <button onClick={() => Screen.startServer().then((s) => { setServer(s.server); setUrls(s.urls); }).catch(() => {})} className="btn-soft w-full">Turn on Wi-Fi screens to get the address</button>}
      {links.map((u) => (
        <div key={u} className="flex items-center gap-2">
          <code className="min-w-0 flex-1 select-all truncate rounded-xl bg-paper-100 px-3 py-2.5 text-sm font-bold dark:bg-night-800">{u}</code>
          <button onClick={() => copy(u)} aria-label="Copy address" className="icon-btn h-11 w-11 bg-paper-200 dark:bg-night-700"><Copy size={16} /></button>
        </div>
      ))}
      {copied && <p className="text-xs text-green-600">Copied.</p>}
      {!IS_NATIVE && <p className="text-xs text-stone-500 dark:text-stone-400">This address follows this browser only. For OBS on another program or computer, use the phone app’s Wi-Fi address (or the Windows app when it is ready).</p>}
    </section>
  );
}

function PersonEditor({ person, onClose }) {
  const savePerson = useStore((s) => s.savePerson);
  const [d, setD] = useState(person || { name: '', title: '' });
  return (
    <Sheet title={person ? 'Edit name' : 'New name'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (d.name.trim()) { savePerson({ ...d, name: d.name.trim(), title: d.title.trim() }); onClose(); } }} className="space-y-3">
        <input className="field" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Name, e.g. Rev. Kwame Mensah" aria-label="Name" autoFocus />
        <input className="field" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="Title, e.g. Senior Pastor" aria-label="Title" />
        <div className="flex gap-2"><button type="button" onClick={onClose} className="btn-soft flex-1">Cancel</button><button disabled={!d.name.trim()} className="btn-gold flex-1">Save</button></div>
      </form>
    </Sheet>
  );
}

function PeopleSection() {
  const { people, deletePerson, goLive, addPlan, plan, live, mode } = useStore();
  const [editing, setEditing] = useState(null);
  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center justify-between"><div className="label">Names &amp; titles</div><button onClick={() => setEditing('new')} className="btn-soft min-h-9 px-3"><Plus size={16} /> Add</button></div>
      {!people.length && <Empty>Add the preacher, worship leader or guest to show their name.</Empty>}
      {people.map((p) => {
        const on = mode === 'show' && live?.type === 'name' && live.personId === p.id;
        const inPlan = plan.some((x) => slideKey(x) === slideKey({ type: 'name', personId: p.id }));
        return (
          <div key={p.id} className={`flex items-center gap-1 rounded-xl ${on ? 'bg-gold-400/20 ring-1 ring-gold-500' : 'bg-paper-100 dark:bg-night-800'}`}>
            <button onClick={() => goLive({ type: 'name', personId: p.id })} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left">
              <UserRound size={18} className="shrink-0 text-gold-500" />
              <span className="min-w-0"><span className="block truncate text-sm font-bold">{p.name}</span>{p.title && <span className="block truncate text-xs text-stone-500 dark:text-stone-400">{p.title}</span>}</span>
            </button>
            <button onClick={() => addPlan({ type: 'name', personId: p.id })} disabled={inPlan} aria-label={`Add ${p.name} to plan`} className="icon-btn disabled:opacity-30"><ListPlus size={16} /></button>
            <button onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`} className="icon-btn"><Pencil size={16} /></button>
            <button onClick={() => window.confirm(`Remove ${p.name}?`) && deletePerson(p.id)} aria-label={`Remove ${p.name}`} className="icon-btn mr-1"><Trash2 size={16} /></button>
          </div>
        );
      })}
      {editing && <PersonEditor person={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function TickerSection() {
  const { ticker, setTicker } = useStore();
  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center gap-2">
        <div className="label mr-auto">Scrolling announcement</div>
        <Seg label="Ticker" value={ticker.on} onChange={(on) => setTicker({ on })} options={[[false, 'Off'], [true, 'On']]} />
      </div>
      <textarea value={ticker.text} onChange={(e) => setTicker({ text: e.target.value })} rows={3} aria-label="Announcement text" placeholder="e.g. Welcome to our visitors · Bible study on Wednesday at 6pm · MoMo offering: 024 000 0000" className="field py-3" />
      <Row label="Speed"><Seg label="Ticker speed" value={ticker.speed} onChange={(speed) => setTicker({ speed })} options={[[0.6, 'Slow'], [1, 'Normal'], [1.6, 'Fast']]} /></Row>
      <p className="text-xs text-stone-500 dark:text-stone-400">It runs along the bottom of every screen, with or without live video, until you turn it off.</p>
    </section>
  );
}

function LookSection() {
  const { lt, setLt } = useStore();
  return (
    <section className="card space-y-4 p-4">
      <div className="flex items-center justify-between"><div className="label">Lower-third look</div><button onClick={() => setLt(DEFAULT_LT)} className="text-xs font-semibold text-stone-500">Reset</button></div>
      <Row label="Bar colour"><Swatches label="Bar" value={lt.bg} onChange={(bg) => setLt({ bg })} colours={BARS} /></Row>
      <div>
        <div className="flex items-center justify-between text-sm font-semibold"><span>Bar see-through</span><span className="text-stone-500">{Math.round((1 - lt.opacity) * 100)}%</span></div>
        <input type="range" min="0" max="0.9" step="0.05" value={1 - lt.opacity} onChange={(e) => setLt({ opacity: Math.round((1 - parseFloat(e.target.value)) * 100) / 100 })} aria-label="Bar see-through" className="mt-2 w-full accent-gold-500" />
      </div>
      <Row label="Text colour"><Swatches label="Bar text" value={lt.fg} onChange={(fg) => setLt({ fg })} colours={['#ffffff', '#f4db8c', '#000000']} /></Row>
      <Row label="Accent"><Swatches label="Accent" value={lt.accent} onChange={(accent) => setLt({ accent })} colours={ACCENTS} /></Row>
      <Row label="Size"><Seg label="Lower-third size" value={lt.size} onChange={(size) => setLt({ size })} options={[['S', 'S'], ['M', 'M'], ['L', 'L']]} /></Row>
      <Row label="Alignment"><Seg label="Lower-third alignment" value={lt.align} onChange={(align) => setLt({ align })} options={[['left', 'Left'], ['center', 'Centre']]} /></Row>
      <Row label="Font">
        <select value={lt.font} onChange={(e) => setLt({ font: e.target.value })} aria-label="Lower-third font" className="min-h-10 rounded-xl border border-paper-300 bg-white px-2 text-sm font-semibold dark:border-night-700 dark:bg-night-800">
          {FONTS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </Row>
    </section>
  );
}

export default function LiveTab({ onCameraMode }) {
  return (
    <div className="space-y-4">
      <CameraSection />
      <GoLiveSection />
      <PeopleSection />
      <TickerSection />
      <LookSection />
      <WatermarkSection />
      <OverlaySection />
      <ObsGuide />
      <CameraDeviceSection onCameraMode={onCameraMode} />
    </div>
  );
}
