// Blocking and updates, both decided by the Super Admin in the admin app and picked up when the app checks in.
import { useEffect, useState } from 'react';
import { Crown, Download, Lock, RefreshCw, ShieldCheck, Sparkles, X } from 'lucide-react';
import { SupportLinks } from './Support.jsx';
import { Paywall } from './Pro.jsx';
import { useStore } from './store.js';
import { IS_IOS, IS_NATIVE, Screen } from './lib/output.js';
import { PLATFORM } from './Pro.jsx';

const pct = (p) => (p?.total ? Math.round((p.received / p.total) * 100) + '%' : p ? Math.round(p.received / 1e6) + ' MB' : '');

/** Downloads and installs the new version: Windows installs by itself; Android opens its Install screen. */
export async function installUpdate(u, onProgress) {
  if (PLATFORM === 'windows' && window.osoreeDesktop?.installUpdate) {
    window.osoreeDesktop.onUpdateProgress?.(onProgress);
    return window.osoreeDesktop.installUpdate(u.url);
  }
  if (IS_IOS) return Screen.installUpdate({ appId: '' });
  if (IS_NATIVE) {
    const h = await Screen.addListener('update', onProgress);
    try { await Screen.installUpdate({ url: u.url }); } finally { h.remove(); }
    return true;
  }
  window.location.reload(); // web: the newest version loads by itself
  return true;
}

function useInstaller() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const go = async (u) => {
    setError(''); setBusy(true); setProgress(null);
    try { await installUpdate(u, setProgress); } catch (e) { setError(e?.message || 'The update did not finish.'); } finally { setBusy(false); }
  };
  return { busy, progress, error, go };
}

const label = () => (IS_IOS ? 'Update in the App Store' : PLATFORM === 'windows' ? 'Download and install' : PLATFORM === 'android' ? 'Download and install' : 'Load the new version');

/** "A new version is available": a banner for optional updates, a full screen for required ones. */
export function UpdatePrompt() {
  const update = useStore((s) => s.update);
  const autoUpdate = useStore((s) => s.autoUpdate);
  const autoTried = useStore((s) => s.autoTried);
  const setLicState = useStore((s) => s.setLicState);
  const [hidden, setHidden] = useState('');
  const inst = useInstaller();
  // Automatic updates: once per version (Windows installs silently; Android opens the Install screen).
  useEffect(() => {
    if (!update || !autoUpdate || autoTried === update.version || IS_IOS || PLATFORM === 'web') return;
    setLicState({ autoTried: update.version });
    const t = setTimeout(() => inst.go(update), 8000);
    return () => clearTimeout(t);
  }, [update, autoUpdate, autoTried]); // eslint-disable-line react-hooks/exhaustive-deps
  const whatsNew = useStore((s) => s.whatsNew);
  if (whatsNew && whatsNew.version === __APP_VERSION__ && whatsNew.notes) {
    return (
      <div className="mx-4 mb-2 flex items-start gap-2 rounded-xl bg-green-600/15 p-3 text-sm ring-1 ring-green-600/50" role="status" aria-label="What's new">
        <Sparkles size={18} className="mt-0.5 shrink-0 text-green-600" />
        <div className="min-w-0 flex-1"><b>What's new in {whatsNew.version}</b><p className="text-stone-600 dark:text-stone-300">{whatsNew.notes}</p></div>
        <button onClick={() => setLicState({ whatsNew: null })} aria-label="Close what's new" className="icon-btn h-8 w-8 shrink-0"><X size={16} /></button>
      </div>
    );
  }
  if (!update || PLATFORM === 'web') return null;
  const body = (
    <>
      {update.notes && <p className="text-sm text-stone-600 dark:text-stone-300">{update.notes}</p>}
      {inst.busy && <p className="text-sm font-semibold">Downloading… {pct(inst.progress)}</p>}
      {inst.error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{inst.error}</p>}
    </>
  );
  if (update.required) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6" role="dialog" aria-label="Update required">
        <div className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-5 text-center dark:bg-night-900">
          <Sparkles className="mx-auto text-gold-500" size={36} />
          <h2 className="text-lg font-bold">Please update Ɔsɔreɛ Plus</h2>
          <p className="text-sm">Version {update.version} is required. You have {__APP_VERSION__}.</p>
          {body}
          <button onClick={() => inst.go(update)} disabled={inst.busy} className="btn-gold w-full"><Download size={18} /> {label()}</button>
        </div>
      </div>
    );
  }
  if (hidden === update.version) return null;
  return (
    <div className="mx-4 mb-2 flex items-center gap-2 rounded-xl bg-gold-400/20 p-2.5 text-sm ring-1 ring-gold-500" role="status" aria-label="Update available">
      <Sparkles size={18} className="shrink-0 text-gold-600 dark:text-gold-400" />
      <div className="min-w-0 flex-1"><b>A new version is available</b> ({update.version}){inst.busy ? ` · downloading ${pct(inst.progress)}` : ''}{inst.error ? <span className="block text-xs text-red-600">{inst.error}</span> : null}</div>
      <button onClick={() => inst.go(update)} disabled={inst.busy} className="btn-gold min-h-9 shrink-0 px-3 text-sm"><Download size={14} /> {IS_IOS ? 'Update' : 'Download'}</button>
      <button onClick={() => setHidden(update.version)} aria-label="Later" className="icon-btn h-9 w-8 shrink-0"><X size={16} /></button>
    </div>
  );
}

/** The Super Admin blocked this device: what to do next (update, get Pro, contact for help). */
export function BlockScreen({ block }) {
  const update = useStore((s) => s.update);
  const openPaywall = useStore((s) => s.openPaywall);
  const pro = useStore((s) => s.licStatus?.state === 'pro');
  const inst = useInstaller();
  const trial = block.kind === 'trial';
  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto p-6" role="alert" aria-label="Device blocked">
      <div className="w-full max-w-sm space-y-4 text-center">
        <Lock size={44} className="mx-auto text-red-500" />
        <h1 className="text-xl font-bold">{trial ? 'Your free trial has ended' : 'This device has been blocked'}</h1>
        {block.reason && <p className="text-sm">{trial ? block.reason.replace(/^Your free trial has ended\.?\s*/i, '') : `Reason: ${block.reason}`}</p>}
        {!pro && (
          <button onClick={() => openPaywall('about')} className="btn w-full bg-green-600 text-white"><Crown size={18} /> Get Ɔsɔreɛ Plus Pro</button>
        )}
        {update && PLATFORM !== 'web' && (
          <div className="space-y-1">
            <button onClick={() => inst.go(update)} disabled={inst.busy} className="btn-gold w-full"><Download size={18} /> {inst.busy ? `Downloading… ${pct(inst.progress)}` : `Update to version ${update.version}`}</button>
            {inst.error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{inst.error}</p>}
          </div>
        )}
        <div className="rounded-2xl bg-paper-100 p-3 text-left dark:bg-night-800"><SupportLinks topic={trial ? 'I want to get Ɔsɔreɛ Plus Pro' : 'My Ɔsɔreɛ Plus device is blocked'} /></div>
        <button onClick={() => window.osoreeCheckNow?.()} className="btn-soft w-full"><RefreshCw size={16} /> Check again</button>
        {trial && <p className="text-xs text-stone-500 dark:text-stone-400">After paying, this device unlocks by itself.</p>}
      </div>
      <Paywall />
    </div>
  );
}

/** Settings → this version, check for updates, automatic updates, privacy. */
export function UpdateSection() {
  const { update, autoUpdate, setLicState, lastCheck } = useStore();
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState('');
  const inst = useInstaller();
  const check = async () => {
    setChecking(true); setNote('');
    await window.osoreeCheckNow?.();
    setChecking(false);
    const u = useStore.getState().update;
    setNote(u ? '' : navigator.onLine === false ? 'No internet. Try again when online.' : 'You have the newest version.');
  };
  return (
    <section className="card space-y-3 p-4">
      <div className="label">App version and updates</div>
      <div className="flex items-center justify-between text-sm"><span>This version</span><b>{__APP_VERSION__}</b></div>
      {update && (
        <div className="space-y-2 rounded-xl bg-gold-400/15 p-3 text-sm">
          <p><b>Version {update.version} is available{update.required ? ' (required)' : ''}.</b></p>
          {update.notes && <p className="text-stone-600 dark:text-stone-300">{update.notes}</p>}
          <button onClick={() => inst.go(update)} disabled={inst.busy} className="btn-gold w-full"><Download size={16} /> {inst.busy ? `Downloading… ${pct(inst.progress)}` : label()}</button>
          {inst.error && <p role="alert" className="text-red-600 dark:text-red-400">{inst.error}</p>}
        </div>
      )}
      <button onClick={check} disabled={checking} className="btn-soft w-full"><RefreshCw size={16} className={checking ? 'animate-spin' : ''} /> {checking ? 'Checking…' : 'Check for updates'}</button>
      {note && <p className="text-sm text-green-700 dark:text-green-400" role="status">{note}</p>}
      {lastCheck > 0 && <p className="text-xs text-stone-500">Last checked {new Date(lastCheck).toLocaleString()}</p>}
      {!IS_IOS && PLATFORM !== 'web' && (
        <label className="flex items-center justify-between gap-3 text-sm">
          <span><b>Update automatically</b><span className="block text-xs text-stone-500 dark:text-stone-400">{PLATFORM === 'windows' ? 'New versions install by themselves.' : 'New versions download by themselves; tap Install when Android asks.'}</span></span>
          <input type="checkbox" checked={autoUpdate} onChange={(e) => setLicState({ autoUpdate: e.target.checked })} className="h-5 w-5 accent-gold-500" aria-label="Update automatically" />
        </label>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-gold-600 dark:text-gold-400">
        <ShieldCheck size={16} />
        {[['terms.html', 'Terms and Conditions'], ['privacy.html', 'Privacy Policy'], ['licenses.html', 'Copyright notices']].map(([f, t]) => (
          <a key={f} href={`https://nyamebabaku-lab.github.io/osoree-plus/${f}`} target="_blank" rel="noreferrer" onClick={(e) => { if (IS_NATIVE) { e.preventDefault(); Screen.openUrl({ url: e.currentTarget.href }); } }} className="underline-offset-2 hover:underline">{t}</a>
        ))}
      </div>
      <p className="text-xs text-stone-500 dark:text-stone-400">© 2026 Brands Media, Ghana. All rights reserved. Ɔsɔreɛ Plus {__APP_VERSION__}.</p>
    </section>
  );
}
