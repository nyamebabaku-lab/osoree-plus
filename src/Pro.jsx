import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Lock } from 'lucide-react';
import { useStore } from './store.js';
import { DEFAULT_POLICY, FEATURES, checkLicence, getDeviceCode, isUnlocked, licenceStatus } from './lib/licence.js';
import { Sheet } from './ui.jsx';

// Works out the device code, starts the trial on first use, and keeps the Pro status up to date.
export function useLicenceBoot() {
  const licence = useStore((s) => s.licence);
  const setLicState = useStore((s) => s.setLicState);
  useEffect(() => {
    let on = true;
    const refresh = async () => {
      const deviceCode = await getDeviceCode();
      const st = useStore.getState();
      const now = Math.floor(Date.now() / 1000);
      const trialStart = st.trialStart || now;
      const lastSeen = Math.max(st.lastSeen || 0, now);
      const licStatus = licenceStatus({ licence: st.licence, trialStart, lastSeen }, deviceCode, DEFAULT_POLICY);
      if (on) setLicState({ deviceCode, trialStart, lastSeen, licStatus });
    };
    refresh();
    const t = setInterval(refresh, 5 * 60 * 1000);
    return () => { on = false; clearInterval(t); };
  }, [licence, setLicState]);
}

// Features locked on this device right now (none until the status is known).
export const lockedFeatures = (status) => (status ? DEFAULT_POLICY.pro.filter((f) => !isUnlocked(status, f)) : []);

/** Returns a check: gate('stream') is true when allowed; otherwise it opens the Pro sheet and is false. */
export function useGate() {
  const status = useStore((s) => s.licStatus);
  const openPaywall = useStore((s) => s.openPaywall);
  return (feature) => {
    if (!status || isUnlocked(status, feature)) return true;
    openPaywall(feature);
    return false;
  };
}

export function useUnlocked(feature) {
  const status = useStore((s) => s.licStatus);
  return !status || isUnlocked(status, feature);
}

// Next to the app name: Pro (bold green), the trial's days left, or Free.
export function ProBadge() {
  const status = useStore((s) => s.licStatus);
  const openPaywall = useStore((s) => s.openPaywall);
  if (!status) return null;
  if (status.state === 'pro') return <span className="ml-1.5 text-lg font-extrabold text-green-600 dark:text-green-500" aria-label="Pro">Pro</span>;
  if (status.state === 'trial') return <button onClick={() => openPaywall('about')} className="ml-1.5 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">TRIAL · {status.daysLeft} {status.daysLeft === 1 ? 'DAY' : 'DAYS'}</button>;
  return <button onClick={() => openPaywall('about')} className="ml-1.5 rounded-md bg-paper-200 px-1.5 py-0.5 text-[10px] font-bold text-stone-600 dark:bg-night-700 dark:text-stone-300">FREE · GET PRO</button>;
}

// A small lock on locked buttons and sections.
export const ProLock = ({ feature }) => (useUnlocked(feature) ? null : <span className="inline-flex items-center gap-0.5 rounded bg-green-600/15 px-1 py-px text-[10px] font-extrabold text-green-700 dark:text-green-400"><Lock size={10} />PRO</span>);

function DeviceCode() {
  const code = useStore((s) => s.deviceCode);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 select-all rounded-xl bg-paper-100 px-3 py-2.5 text-center font-mono text-lg font-bold tracking-wider dark:bg-night-800">{code || '…'}</code>
      <button onClick={() => navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {})} aria-label="Copy device code" className="icon-btn h-11 w-11 bg-paper-200 dark:bg-night-700">{copied ? <Check size={16} /> : <Copy size={16} />}</button>
    </div>
  );
}

function LicenceEntry({ onDone }) {
  const setLicence = useStore((s) => s.setLicence);
  const deviceCode = useStore((s) => s.deviceCode);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const activate = async () => {
    const now = Math.max(Math.floor(Date.now() / 1000), useStore.getState().lastSeen || 0);
    const r = checkLicence(text, deviceCode, now);
    if (!r.ok) { setError(r.reason); return; }
    setError('');
    setLicence(text.trim().replace(/\s+/g, ''));
    onDone?.();
  };
  return (
    <div className="space-y-2">
      <textarea value={text} onChange={(e) => { setText(e.target.value); setError(''); }} rows={3} aria-label="Licence code" placeholder="Paste the licence code (starts with OSP1.)" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="field py-3 font-mono text-xs" />
      <button onClick={activate} disabled={!text.trim()} className="btn w-full bg-green-600 text-white hover:bg-green-700"><KeyRound size={16} /> Activate Pro</button>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

// Shown when a locked feature is tapped (or the badge): what Pro includes and how to get it.
export function Paywall() {
  const { paywall, openPaywall, licStatus } = useStore();
  if (!paywall) return null;
  const close = () => openPaywall('');
  const done = licStatus?.state === 'pro';
  return (
    <Sheet title="Ɔsɔreɛ Plus Pro" onClose={close}>
      <div className="space-y-4">
        {done ? <p className="rounded-xl bg-green-600/15 p-3 text-sm font-semibold text-green-700 dark:text-green-400">Pro is active on this device. Thank you!</p>
          : FEATURES[paywall] && <p className="rounded-xl bg-amber-500/15 p-3 text-sm font-semibold text-amber-800 dark:text-amber-300">{FEATURES[paywall]} {licStatus?.state === 'free' ? 'needs Pro: the 30-day trial has ended.' : 'is part of Pro.'}</p>}
        <div>
          <div className="label mb-2">Pro includes</div>
          <ul className="space-y-1.5 text-sm">{Object.values(FEATURES).map((f) => <li key={f} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-green-600" />{f}</li>)}</ul>
          <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">The Bible, search, songs, pictures, videos and the projector stay free for ever.</p>
        </div>
        {!done && (
          <>
            <div className="space-y-2">
              <div className="label">This device’s code</div>
              <DeviceCode />
              <p className="text-xs text-stone-500 dark:text-stone-400">To buy Pro, send this code to your Ɔsɔreɛ Plus dealer. You will receive a licence code to paste below. (Paying in the app with MoMo or card is coming soon.)</p>
            </div>
            <div className="space-y-2"><div className="label">Have a licence?</div><LicenceEntry onDone={close} /></div>
          </>
        )}
      </div>
    </Sheet>
  );
}

// Screen tab: where this device stands, its code, and the place to paste a licence.
export function ProSection() {
  const { licStatus: st, openPaywall } = useStore();
  if (!st) return null;
  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center gap-2">
        <div className="label mr-auto">Ɔsɔreɛ Plus Pro</div>
        {st.state === 'pro' ? <span className="text-base font-extrabold text-green-600 dark:text-green-500">Pro</span>
          : st.state === 'trial' ? <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-400">Trial</span>
            : <span className="rounded-md bg-paper-200 px-2 py-0.5 text-[11px] font-bold dark:bg-night-700">Free</span>}
      </div>
      <p className="text-sm text-stone-600 dark:text-stone-300">
        {st.state === 'pro' ? <>Pro is active{st.church ? ` for ${st.church}` : ''}{st.expires ? `, until ${new Date(st.expires * 1000).toLocaleDateString()} (${st.daysLeft} days)` : ', with no end date'}.</>
          : st.state === 'trial' ? <>Every feature is open for your free trial: {st.daysLeft} {st.daysLeft === 1 ? 'day' : 'days'} left. After that, Pro features need a licence.</>
            : <>The free trial has ended. Bible, songs, pictures and the projector still work; Pro features need a licence.</>}
      </p>
      {st.problem && <p className="text-sm text-red-600 dark:text-red-400">{st.problem}</p>}
      <div className="label">This device’s code</div>
      <DeviceCode />
      {st.state !== 'pro' && <button onClick={() => openPaywall('about')} className="btn w-full bg-green-600 text-white hover:bg-green-700">Get Pro or enter a licence</button>}
      {st.state === 'pro' && st.expires > 0 && st.daysLeft <= 30 && <LicenceEntry />}
    </section>
  );
}
