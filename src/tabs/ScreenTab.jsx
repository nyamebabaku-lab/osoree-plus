import { useEffect, useRef, useState } from 'react';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, ArchiveRestore, Cast, Download, MonitorUp, Trash2, Upload, Wifi } from 'lucide-react';
import { useStore, DEFAULT_STYLE } from '../store.js';
import { IS_NATIVE, Screen, openScreenWindow, saveTextFile } from '../lib/output.js';
import { BUILTIN, backupData, decodeXml, deleteImported, parseXmlBible, readBackup, saveImported } from '../lib/bible.js';
import { FONTS } from '../lib/fonts.js';
import { Seg } from '../ui.jsx';
import { Thumb } from './MediaTab.jsx';
import { ProLock, ProSection, useGate } from '../Pro.jsx';

const BGS = ['#000000', '#0b1f3a', '#12301f', '#3a0d12', '#2b1a45', '#ffffff'];
const FGS = ['#ffffff', '#f4db8c', '#000000'];

export const Swatches = ({ value, onChange, colours, label }) => (
  <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
    {colours.map((c) => <button key={c} onClick={() => onChange(c)} aria-label={c} style={{ background: c }} className={`h-9 w-9 rounded-full border border-stone-400/50 ${value === c ? 'ring-2 ring-gold-500 ring-offset-2 ring-offset-white dark:ring-offset-night-900' : ''}`} />)}
    <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`Other ${label.toLowerCase()} colour`} className="h-9 w-9 cursor-pointer rounded-full border-0 bg-transparent p-0" />
  </div>
);
export const Row = ({ label, children }) => <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm font-semibold">{label}</span>{children}</div>;

const ALIGN = [['left', AlignLeft, 'Left'], ['center', AlignCenter, 'Centre'], ['right', AlignRight, 'Right'], ['justify', AlignJustify, 'Justify']];

// Pick a picture or video from the Media library (or none).
export function MediaChoice({ value, onChange, label, none, imagesOnly }) {
  const media = useStore((s) => s.media).filter((m) => (imagesOnly ? m.kind === 'image' : m.kind !== 'pdf'));
  if (!media.length) return <p className="text-sm text-stone-500 dark:text-stone-400">Add pictures or videos in the Media tab first.</p>;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={label}>
      <button onClick={() => onChange('')} aria-pressed={!value} className={`flex h-16 w-24 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold ${!value ? 'border-gold-500 ring-2 ring-gold-500' : 'border-paper-300 dark:border-night-700'}`}>{none}</button>
      {media.map((m) => (
        <button key={m.id} onClick={() => onChange(m.id)} aria-pressed={value === m.id} aria-label={m.name} className={`h-16 w-24 shrink-0 overflow-hidden rounded-lg ${value === m.id ? 'ring-2 ring-gold-500' : ''}`}>
          <Thumb item={m} className="h-full w-full" />
        </button>
      ))}
    </div>
  );
}

const Dot = ({ on }) => <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${on ? 'bg-green-500' : 'bg-stone-400'}`} />;

// Phone app only: the projector or TV on a cable or wireless display, and screens that join over Wi-Fi.
function PhoneScreens() {
  const gate = useGate();
  const [st, setSt] = useState({ display: false, displayName: '', server: false, urls: [], clients: 0 });
  const [error, setError] = useState('');
  useEffect(() => {
    let handle;
    const refresh = () => Screen.status().then(setSt).catch(() => {});
    refresh();
    Screen.addListener('status', setSt).then((h) => { handle = h; });
    const timer = setInterval(refresh, 3000); // the number of Wi-Fi screens changes without an event
    return () => { clearInterval(timer); handle?.remove(); };
  }, []);
  const run = (p) => { setError(''); p.then((r) => r && setSt(r)).catch((e) => setError(e.message || 'That did not work.')); };

  return (
    <>
      <section className="card space-y-3 p-4">
        <div className="label">Projector or TV</div>
        <div className="flex items-center gap-2 text-sm font-semibold"><Dot on={st.display} />{st.display ? `Showing on ${st.displayName || 'the screen'}` : 'No screen connected'}</div>
        <p className="text-sm text-stone-500 dark:text-stone-400">Plug the phone into the projector with an HDMI adapter, or connect to a wireless display. The verse appears there on its own; this phone keeps the controls.</p>
        <button onClick={() => run(Screen.openCastSettings())} className="btn-soft w-full"><Cast size={18} /> Connect a wireless display</button>
      </section>

      <section className="card space-y-3 p-4">
        <div className="label">Screens over Wi-Fi</div>
        <div className="flex items-center gap-2 text-sm font-semibold"><Dot on={st.server && st.clients > 0} />{!st.server ? 'Off' : st.clients ? `${st.clients} ${st.clients === 1 ? 'screen' : 'screens'} connected` : 'On, waiting for a screen'}</div>
        {st.server && (st.urls.length
          ? (
            <div className="space-y-2">
              <p className="text-sm text-stone-500 dark:text-stone-400">On the laptop or smart TV, join the same Wi-Fi or this phone's hotspot, open a browser and type:</p>
              {st.urls.map((u) => <div key={u} className="select-all rounded-xl bg-paper-100 px-3 py-2.5 text-center font-mono text-lg font-bold dark:bg-night-800">{u}</div>)}
            </div>
          )
          : <p className="text-sm text-red-600 dark:text-red-400">This phone is not on a network. Join a Wi-Fi network or turn on the hotspot.</p>)}
        <button onClick={() => (st.server ? run(Screen.stopServer()) : gate('wifi') && run(Screen.startServer()))} className={`${st.server ? 'btn-soft' : 'btn-gold'} w-full`}><Wifi size={18} /> {st.server ? 'Turn off Wi-Fi screens' : 'Turn on Wi-Fi screens'} <ProLock feature="wifi" /></button>
        {!st.server && <p className="text-sm text-stone-500 dark:text-stone-400">No internet is needed, only a shared Wi-Fi network or this phone's hotspot.</p>}
      </section>
      {error && <p className="px-1 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </>
  );
}

export default function ScreenTab() {
  const { style, setStyle, themeMode, setThemeMode, imported, addImported, removeImported, setVersion, idleId, setIdle, songs, addSongs } = useStore();
  const gate = useGate();
  const file = useRef(null);
  const backupFile = useRef(null);
  const [msg, setMsg] = useState(null);

  // Several XML Bibles at once; each stays on this device until removed.
  const importFiles = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    const done = [], failed = [];
    // A zip holds many Bibles: take every .xml inside it (sub-folders too).
    const sources = [];
    for (const f of files) {
      if (!/\.zip$/i.test(f.name) && f.type !== 'application/zip') { sources.push({ name: f.name, read: async () => decodeXml(new Uint8Array(await f.arrayBuffer())) }); continue; }
      setMsg({ text: `Opening ${f.name}…` });
      try {
        const { unzipSync } = await import('fflate');
        const entries = unzipSync(new Uint8Array(await f.arrayBuffer()), { filter: (e) => /\.xml$/i.test(e.name) && !/(^|\/)(__MACOSX|\.)/.test(e.name) });
        const names = Object.keys(entries).sort();
        if (!names.length) failed.push(`${f.name}: no XML Bibles inside`);
        names.forEach((n) => sources.push({ name: n.split('/').pop(), read: async () => decodeXml(entries[n]) }));
      } catch {
        failed.push(`${f.name}: this zip could not be opened`);
      }
    }
    for (const f of sources) {
      setMsg({ text: `Reading ${f.name}…` });
      try {
        const bible = parseXmlBible(await f.read(), f.name);
        // Two versions with the same short name would be confusing in the list and on screen: "KJV" → "KJV-2".
        const taken = new Set([...BUILTIN, ...useStore.getState().imported].map((x) => x.abbr.toUpperCase()));
        for (let n = 2; taken.has(bible.abbr.toUpperCase()); n++) bible.abbr = `${bible.abbr.replace(/-\d+$/, '')}-${n}`;
        await saveImported(bible);
        addImported({ id: bible.id, abbr: bible.abbr, name: bible.name });
        done.push(bible);
        if (bible.emptyBooks) failed.push(`${bible.name}: ${bible.emptyBooks.join(', ')} ${bible.emptyBooks.length === 1 ? 'has' : 'have'} no text in this file. Everything else was added.`);
        if (bible.damaged) failed.push(`${bible.name}: this file is damaged, so some text is missing (${bible.damaged.slice(0, 4).join(', ')}${bible.damaged.length > 4 ? '…' : ''}). Everything else was added; replace it with a fresh copy when you can.`);
      } catch (err) {
        failed.push(`${f.name}: ${err.message || 'could not be read'}`);
      }
    }
    if (done.length === 1) setVersion(done[0].id);
    setMsg({ text: [done.length && `Added ${done.map((b) => b.name).join(', ')}.`, ...failed].filter(Boolean).join(' '), bad: failed.length > 0 });
  };

  const saveBackup = async () => {
    if (!gate('backup')) return;
    setMsg({ text: 'Preparing backup…' });
    try {
      const text = await backupData(imported, songs);
      await saveTextFile(`osoree-plus-backup-${new Date().toISOString().slice(0, 10)}.json`, text);
      setMsg({ text: `Backup saved: ${imported.length} ${imported.length === 1 ? 'Bible' : 'Bibles'} and ${songs.length} songs.` });
    } catch (err) {
      setMsg(/cancel/i.test(err?.message) ? null : { text: err?.message || 'The backup could not be saved.', bad: true });
    }
  };

  const restore = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const { bibles, songs: restored } = readBackup(await f.text());
      let nb = 0;
      for (const b of bibles) {
        if (imported.some((x) => x.id === b.id)) continue;
        await saveImported(b);
        addImported({ id: b.id, abbr: b.abbr, name: b.name });
        nb++;
      }
      const have = new Set(songs.map((x) => x.id));
      const ns = restored.filter((x) => x?.id && x.lyrics && !have.has(x.id));
      addSongs(ns);
      setMsg({ text: `Restored ${nb} ${nb === 1 ? 'Bible' : 'Bibles'} and ${ns.length} songs. Items already on this device were kept as they were.` });
    } catch (err) {
      setMsg({ text: err.message || 'That backup could not be read.', bad: true });
    }
  };

  return (
    <div className="space-y-4">
      <ProSection />
      {IS_NATIVE ? <PhoneScreens /> : (
        <section className="card space-y-3 p-4">
          <div className="label">Screen</div>
          <button onClick={openScreenWindow} className="btn-gold w-full"><MonitorUp size={18} /> Open screen window</button>
          <p className="text-sm text-stone-500 dark:text-stone-400">Drag the window onto the projector or TV, then click it once for full screen. Keys on this computer: → next, ← back, C clear, B black.</p>
        </section>
      )}

      <section className="card space-y-4 p-4">
        <div className="flex items-center justify-between">
          <div className="label">Text on screen</div>
          <button onClick={() => setStyle({ ...DEFAULT_STYLE, bgId: style.bgId })} className="text-xs font-semibold text-stone-500">Reset</button>
        </div>
        <div>
          <div className="mb-2 text-sm font-semibold">Font</div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {FONTS.map(([id, name, stack]) => (
              <button key={id} onClick={() => setStyle({ font: id })} aria-pressed={style.font === id} style={{ fontFamily: stack }} className={`min-h-11 truncate rounded-xl px-3 text-left text-[15px] font-semibold ${style.font === id ? 'bg-gold-400/20 ring-2 ring-gold-500' : 'bg-paper-100 dark:bg-night-800'}`}>{name}</button>
            ))}
          </div>
        </div>
        <Row label="Alignment">
          <div role="group" aria-label="Alignment" className="inline-flex rounded-xl bg-paper-200 p-1 dark:bg-night-800">
            {ALIGN.map(([v, Icon, name]) => (
              <button key={v} onClick={() => setStyle({ align: v })} aria-pressed={style.align === v} aria-label={name} title={name} className={`flex h-9 w-11 items-center justify-center rounded-lg ${style.align === v ? 'bg-white shadow-sm dark:bg-night-700' : 'text-stone-500 dark:text-stone-400'}`}><Icon size={18} /></button>
            ))}
          </div>
        </Row>
        <Row label="Largest text size"><Seg label="Largest text size" value={style.size} onChange={(size) => setStyle({ size })} options={[['S', 'S'], ['M', 'M'], ['L', 'L'], ['XL', 'XL']]} /></Row>
        <Row label="Text colour"><Swatches label="Text" value={style.fg} onChange={(fg) => setStyle({ fg })} colours={FGS} /></Row>
        <Row label="Reference / song title"><Seg label="Reference" value={style.showRef} onChange={(showRef) => setStyle({ showRef })} options={[[true, 'Show'], [false, 'Hide']]} /></Row>
        <Row label="Capital letters"><Seg label="Capital letters" value={style.upper} onChange={(upper) => setStyle({ upper })} options={[[true, 'On'], [false, 'Off']]} /></Row>
      </section>

      <section className="card space-y-4 p-4">
        <div className="label">Background</div>
        <Row label="Colour"><Swatches label="Background" value={style.bg} onChange={(bg) => setStyle({ bg })} colours={BGS} /></Row>
        <div>
          <div className="mb-2 text-sm font-semibold">Picture or video behind verses and songs</div>
          <MediaChoice label="Text background" value={style.bgId} onChange={(bgId) => setStyle({ bgId })} none="Colour only" />
        </div>
        {style.bgId && (
          <>
            <div>
              <div className="flex items-center justify-between text-sm font-semibold"><span>Blend picture into background colour</span><span className="text-stone-500">{Math.round(style.blend * 100)}%</span></div>
              <input type="range" min="0" max="0.95" step="0.05" value={style.blend} onChange={(e) => setStyle({ blend: parseFloat(e.target.value) })} aria-label="Blend picture into background colour" className="mt-2 w-full accent-gold-500" />
              <p className="text-xs text-stone-500 dark:text-stone-400">Higher makes the picture fainter and the background colour stronger, so the words are easier to read.</p>
            </div>
            <Row label="Text shadow"><Seg label="Text shadow" value={style.shadow} onChange={(shadow) => setStyle({ shadow })} options={[[true, 'On'], [false, 'Off']]} /></Row>
          </>
        )}
      </section>

      <section className="card space-y-3 p-4">
        <div className="label">Idle screen</div>
        <p className="text-sm text-stone-500 dark:text-stone-400">Shown whenever you press Clear: your logo, a welcome picture or a looping video (played without sound).</p>
        <MediaChoice label="Idle screen" value={idleId} onChange={setIdle} none="Plain colour" />
      </section>

      <section className="card space-y-3 p-4">
        <div className="label">Bibles</div>
        <p className="text-sm text-stone-500 dark:text-stone-400">{BUILTIN.map((b) => b.abbr).join(', ')} are built in. Add Bibles you have the right to use from XML files (Zefania or OpenSong): choose several at once, or a zip that holds them all. They stay on this device, work offline and keep their own book names.</p>
        {imported.map((b) => (
          <div key={b.id} className="flex items-center gap-2 rounded-xl bg-paper-100 px-3 py-2 dark:bg-night-800">
            <span className="min-w-0 flex-1 truncate text-sm"><b>{b.abbr}</b> · {b.name}</span>
            <button onClick={async () => { if (!window.confirm(`Remove ${b.name} from this device?`)) return; await deleteImported(b.id); removeImported(b.id); }} aria-label={`Remove ${b.name}`} className="icon-btn"><Trash2 size={16} /></button>
          </div>
        ))}
        <input ref={file} type="file" accept=".xml,text/xml,application/xml,.zip,application/zip" multiple hidden onChange={importFiles} />
        <button onClick={() => file.current.click()} className="btn-soft w-full"><Upload size={18} /> Add Bibles (XML or zip)</button>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={saveBackup} className="btn-soft"><Download size={16} /> Back up <ProLock feature="backup" /></button>
          <button onClick={() => gate('backup') && backupFile.current.click()} className="btn-soft"><ArchiveRestore size={16} /> Restore <ProLock feature="backup" /></button>
        </div>
        <input ref={backupFile} type="file" accept=".json,application/json" hidden onChange={restore} />
        <p className="text-xs text-stone-500 dark:text-stone-400">The backup holds your added Bibles and songs, to move them to another phone or laptop.</p>
        {msg && <p className={`text-sm ${msg.bad ? 'text-red-600 dark:text-red-400' : 'text-stone-600 dark:text-stone-300'}`}>{msg.text}</p>}
      </section>

      <section className="card p-4">
        <Row label="App theme"><Seg label="App theme" value={themeMode} onChange={setThemeMode} options={[['dark', 'Dark'], ['light', 'Light'], ['system', 'Auto']]} /></Row>
      </section>

      <p className="px-1 pb-2 text-[11px] leading-relaxed text-stone-400">
        Ɔsɔreɛ Plus version {__APP_VERSION__}.<br />
        Built-in texts: KJV, ASV, BBE, YLT and WEB (public domain); Berean Standard Bible (public domain); KJV with Strong's numbers from eBible.org (public domain).
        Strong's Hebrew and Greek dictionaries: digital text © Open Scriptures, CC BY-SA. Fonts from Google Fonts under the SIL Open Font License.
      </p>
    </div>
  );
}
