import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Radio, RefreshCw, Square } from 'lucide-react';
import { useStore } from '../store.js';
import { IS_NATIVE, Screen } from '../lib/output.js';
import { Seg } from '../ui.jsx';

// Where each platform's server address and stream key come from.
export const PLATFORMS = {
  youtube: { name: 'YouTube', url: 'rtmps://a.rtmps.youtube.com/live2', help: 'YouTube Studio → Create → Go live → Stream. Copy the "Stream key".' },
  facebook: { name: 'Facebook', url: 'rtmps://live-api-s.facebook.com:443/rtmp/', help: 'Facebook → Live video → Streaming software. Copy the "Stream key" (the server address is already filled in).' },
  instagram: { name: 'Instagram', url: '', help: 'Professional accounts: instagram.com on a computer → Create → Live → copy the "Stream URL" and "Stream key". They change for each broadcast.' },
  tiktok: { name: 'TikTok', url: '', help: 'Accounts allowed to go LIVE with a stream key: TikTok LIVE Center / LIVE Studio → copy the "Server URL" and "Stream key".' },
  twitch: { name: 'Twitch', url: 'rtmp://live.twitch.tv/app', help: 'Twitch → Creator Dashboard → Settings → Stream. Copy the "Primary stream key".' },
  custom: { name: 'Other (custom)', url: '', help: 'Any service that gives an RTMP or RTMPS address and a stream key (Vimeo, Restream, your own server…).' },
};

const QUALITY = { '480p': { w: 848, h: 480, bitrate: 1_200_000 }, '720p': { w: 1280, h: 720, bitrate: 2_500_000 }, '1080p': { w: 1920, h: 1080, bitrate: 4_500_000 } };
const fmtTime = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const STATE = { connecting: ['Connecting…', 'bg-amber-500'], live: ['LIVE', 'bg-red-600'], retrying: ['Reconnecting…', 'bg-amber-500'], stopped: ['Stopped', 'bg-stone-500'], idle: ['Waiting', 'bg-stone-500'] };

function TargetCard({ t, n, disabled }) {
  const setTarget = useStore((s) => s.setStreamTarget);
  const [show, setShow] = useState(false);
  const p = PLATFORMS[t.platform];
  return (
    <div className={`space-y-2 rounded-xl p-3 ${t.on ? 'bg-paper-100 ring-1 ring-gold-500/60 dark:bg-night-800' : 'bg-paper-100/60 dark:bg-night-800/60'}`}>
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={t.on} disabled={disabled} onChange={(e) => setTarget(t.id, { on: e.target.checked })} aria-label={`Use platform ${n}`} className="h-5 w-5 accent-gold-500" />
        <select value={t.platform} disabled={disabled} onChange={(e) => setTarget(t.id, { platform: e.target.value, url: PLATFORMS[e.target.value].url })} aria-label={`Platform ${n}`} className="min-h-10 flex-1 rounded-xl border border-paper-300 bg-white px-2 text-sm font-semibold dark:border-night-700 dark:bg-night-900">
          {Object.entries(PLATFORMS).map(([id, x]) => <option key={id} value={id}>{x.name}</option>)}
        </select>
      </div>
      {t.on && (
        <>
          <input className="field min-h-10 text-sm" value={t.url} disabled={disabled} onChange={(e) => setTarget(t.id, { url: e.target.value })} placeholder="Server address (rtmp:// or rtmps://)" aria-label={`Server address ${n}`} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          <div className="flex gap-2">
            <input className="field min-h-10 text-sm" type={show ? 'text' : 'password'} value={t.key} disabled={disabled} onChange={(e) => setTarget(t.id, { key: e.target.value.trim() })} placeholder="Stream key" aria-label={`Stream key ${n}`} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide key' : 'Show key'} className="icon-btn h-10 w-10 bg-paper-200 dark:bg-night-700">{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400">{p.help}</p>
        </>
      )}
    </div>
  );
}

// Phone app only (the browser has no stream encoder): the laptop route is OBS.
export function GoLiveSection() {
  return IS_NATIVE ? <GoLivePanel /> : null;
}

function GoLivePanel() {
  const { streamCfg: cfg, setStreamCfg, onAir, setOnAir, cam } = useStore();
  const [inputs, setInputs] = useState([]);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  const loadInputs = () => Screen.audioInputs().then((r) => setInputs(r.inputs)).catch(() => {});
  useEffect(() => { loadInputs(); Screen.streamStatus().then((st) => { setStatus(st); setOnAir(st.running); }).catch(() => {}); }, [setOnAir]);
  useEffect(() => {
    if (!onAir) return undefined;
    timer.current = setInterval(() => Screen.streamStatus().then((st) => { setStatus(st); if (!st.running) setOnAir(false); }).catch(() => {}), 1000);
    return () => clearInterval(timer.current);
  }, [onAir, setOnAir]);

  const chosen = cfg.targets.filter((t) => t.on);
  const q = QUALITY[cfg.quality];
  const upload = ((q.bitrate + 128_000) * chosen.length) / 1e6;

  const goLive = async () => {
    setError('');
    const bad = chosen.find((t) => !/^rtmps?:\/\//i.test(t.url.trim()) || (!t.key && !/\/[^/]{8,}$/.test(t.url.trim())));
    if (!chosen.length) { setError('Tick at least one platform.'); return; }
    if (bad) { setError(`${PLATFORMS[bad.platform].name}: fill in the server address (rtmp:// or rtmps://) and the stream key.`); return; }
    setBusy(true);
    try {
      const { granted } = await Screen.requestMicrophone();
      if (!granted) { setError('Allow the microphone so the stream has sound.'); return; }
      if (cam.on && cam.source === 'phone') await Screen.requestCamera();
      const portrait = cfg.shape === 'portrait';
      const st = await Screen.streamStart({
        targets: chosen.map((t) => ({ name: PLATFORMS[t.platform].name, url: t.url.trim(), key: t.key.trim() })),
        width: portrait ? q.h : q.w, height: portrait ? q.w : q.h, fps: 30, bitrate: q.bitrate, audioInput: cfg.audioInput, stereo: true,
      });
      setStatus(st);
      setOnAir(true);
    } catch (e) {
      setError(e?.message || 'The stream could not start.');
    } finally {
      setBusy(false);
    }
  };
  const end = async () => {
    if (!window.confirm('End the live stream on every platform?')) return;
    const st = await Screen.streamStop().catch(() => null);
    setStatus(st);
    setOnAir(false);
  };

  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center gap-2">
        <div className="label mr-auto">Go live (YouTube, Facebook…)</div>
        {onAir && <span className="rounded-md bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white">ON AIR</span>}
      </div>
      <p className="text-sm text-stone-500 dark:text-stone-400">This phone streams what the projector shows: the camera with verses, songs and names along the bottom, slides and pictures full screen, the ticker and your logo. Streaming needs internet.</p>

      {cfg.targets.map((t, i) => <TargetCard key={t.id} t={t} n={i + 1} disabled={onAir} />)}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">Picture</span>
        <Seg label="Stream shape" value={cfg.shape} onChange={(shape) => !onAir && setStreamCfg({ shape })} options={[['landscape', 'Landscape 16:9'], ['portrait', 'Portrait 9:16']]} />
      </div>
      {cfg.shape === 'portrait' && <p className="text-xs text-stone-500 dark:text-stone-400">Portrait suits TikTok and Instagram. YouTube and Facebook look best in landscape.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">Quality</span>
        <Seg label="Stream quality" value={cfg.quality} onChange={(quality) => !onAir && setStreamCfg({ quality })} options={[['480p', '480p'], ['720p', '720p'], ['1080p', '1080p']]} />
      </div>
      <div className="flex items-center gap-2">
        <select value={cfg.audioInput} disabled={onAir} onChange={(e) => setStreamCfg({ audioInput: parseInt(e.target.value, 10) })} aria-label="Sound input" className="field min-h-11 flex-1 text-sm">
          <option value={-1}>Sound: automatic (mixer if plugged in, else phone mic)</option>
          <option value={0}>Sound: phone microphone</option>
          {inputs.filter((x) => !/^Phone microphone$/.test(x.name)).map((x) => <option key={x.id} value={x.id}>Sound: {x.name}</option>)}
        </select>
        <button onClick={loadInputs} aria-label="Look for sound inputs again" className="icon-btn h-11 w-11 bg-paper-200 dark:bg-night-700"><RefreshCw size={16} /></button>
      </div>
      <p className="text-xs text-stone-500 dark:text-stone-400">For clean sound, connect the mixer’s output to the phone with a USB sound adapter (or a TRRS cable), then tap ↻. Needs about {upload.toFixed(1)} Mbit/s upload for {chosen.length || 'no'} {chosen.length === 1 ? 'platform' : 'platforms'}.</p>

      {status?.running && (
        <div className="space-y-2 rounded-xl bg-paper-100 p-3 dark:bg-night-800">
          {status.targets.map((t) => {
            const [label, colour] = STATE[t.state] || STATE.idle;
            return (
              <div key={t.name} className="text-sm">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${colour}`}>{label}</span>
                  <b className="mr-auto">{t.name}</b>
                  {t.state === 'live' && <span className="tabular-nums text-stone-500">{fmtTime(t.uptime)} · {t.kbps} kbit/s</span>}
                </div>
                {t.message && <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">{t.message}</p>}
              </div>
            );
          })}
          <div>
            <div className="mb-1 flex justify-between text-xs text-stone-500"><span>Sound: {status.audioInput}</span><span>{status.level < 0.02 ? 'no sound?' : ''}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-paper-300 dark:bg-night-700"><div className={`h-full ${status.level > 0.9 ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${Math.min(100, Math.round(status.level * 100))}%` }} /></div>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {onAir
        ? <button onClick={end} className="btn w-full bg-red-600 text-white"><Square size={16} /> End stream</button>
        : <button onClick={goLive} disabled={busy} className="btn-gold w-full"><Radio size={18} /> {busy ? 'Starting…' : 'Go live'}</button>}
      <p className="text-xs text-stone-500 dark:text-stone-400">Keep Ɔsɔreɛ Plus open and the phone plugged in while live. Stream keys stay on this phone only.</p>
    </section>
  );
}

// Streaming from a laptop with OBS Studio (free), using the overlay above.
export function ObsGuide() {
  const [open, setOpen] = useState(!IS_NATIVE);
  return (
    <section className="card space-y-3 p-4">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between">
        <span className="label">Stream from a laptop with OBS</span><span className="text-xs font-semibold text-gold-600 dark:text-gold-400">{open ? 'Hide' : 'Show steps'}</span>
      </button>
      {open && (
        <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 dark:text-stone-300">
          <li>Install <b>OBS Studio</b> (free, obsproject.com) on the laptop.</li>
          <li>In OBS, <b>Sources → + → Video Capture Device</b>: choose the webcam or the HDMI capture card from the church camera.</li>
          <li><b>Sources → + → Browser</b>: paste the overlay address shown above, width 1920, height 1080. Put it above the camera in the list.</li>
          <li><b>Settings → Audio</b>: set Mic/Auxiliary to the input that comes from the sound mixer.</li>
          <li><b>Settings → Stream</b>: choose YouTube, Facebook Live, Twitch… and paste the stream key. For several platforms at once, use OBS’s “Multiple RTMP outputs” plugin or Restream.</li>
          <li>Press <b>Start Streaming</b>. Show verses, songs and names from this app as usual: they appear on the stream as lower thirds.</li>
        </ol>
      )}
    </section>
  );
}
