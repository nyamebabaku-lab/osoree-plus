import { useEffect, useState } from 'react';
import { Check, Copy, CreditCard, KeyRound, Lock, Phone, Ticket } from 'lucide-react';
import { useStore } from './store.js';
import { getDeviceInfo } from './lib/licence.js';
import { DEFAULT_POLICY, FEATURES, checkLicence, getDeviceCode, isUnlocked, licenceId, licenceStatus } from './lib/licence.js';
import { api, openCheckout } from './lib/server.js';
import { IS_IOS, IS_NATIVE, Screen } from './lib/output.js';
import { Sheet } from './ui.jsx';
import { syncStore } from './lib/store-client.js';
import { askNotifications, notify } from './lib/notify.js';
import { SupportLinks } from './Support.jsx';

const policyOf = (st) => ({ ...DEFAULT_POLICY, ...(st.policy ? { trialDays: st.policy.trialDays ?? DEFAULT_POLICY.trialDays, pro: st.policy.pro || DEFAULT_POLICY.pro } : {}) });

function recompute(set) {
  const st = useStore.getState();
  if (!st.deviceCode) return;
  const licStatus = licenceStatus({ licence: st.licence, trialStart: st.trialStart, lastSeen: st.lastSeen }, st.deviceCode, policyOf(st));
  set({ licStatus });
  // The trial has just ended: tell the church once (and how to get Pro).
  if (licStatus.state === 'free' && !st.trialNotified && st.trialStart) {
    set({ trialNotified: true });
    notify('Your Ɔsɔreɛ Plus trial has ended', 'Get Pro to keep live video, streaming, documents and more. Open Ɔsɔreɛ Plus → Get Pro.');
  }
}

/** Waits for a payment to go through, then saves the licence. Returns true when paid. */
export async function checkPayment(ref) {
  const r = await api('buy-status', { ref });
  const { setLicState, setLicence } = useStore.getState();
  if (r.status === 'paid' && r.licence) { setLicence(r.licence); setLicState({ pendingPay: '' }); return true; }
  if (r.status === 'failed') { setLicState({ pendingPay: '' }); throw new Error(r.error ? `The payment did not go through (${r.error}).` : 'The payment did not go through.'); }
  return false;
}

// Works out the device code, starts the trial on first use, keeps the Pro status up to date, and (when there is
// internet) checks in with the server: the trial's real start, prices and Pro features, revoked or moved licences.
// A Pro request paid by Mobile Money: once the Super Admin approves it, the licence arrives here.
export async function checkRequest() {
  const { deviceCode, setLicence, setLicState } = useStore.getState();
  const r = await api('request-status', { device: deviceCode || await getDeviceCode() });
  if (r.status === 'approved' && r.licence) { setLicence(r.licence); setLicState({ pendingReq: '' }); notify('Ɔsɔreɛ Plus Pro is active', 'Your payment was confirmed. Thank you! Every Pro feature is now on.'); }
  else if (r.status !== 'pending') { setLicState({ pendingReq: '' }); if (r.status === 'declined') notify('Pro request not approved', r.reason ? `Reason: ${r.reason}` : 'Open Ɔsɔreɛ Plus for details.'); }
  return r;
}

export const PLATFORM = IS_IOS ? 'ios' : IS_NATIVE ? 'android' : window.osoreeDesktop ? 'windows' : 'web';

export function useLicenceBoot() {
  const licence = useStore((s) => s.licence);
  const policy = useStore((s) => s.policy);
  const setLicState = useStore((s) => s.setLicState);
  useEffect(() => {
    let on = true;
    const refresh = async () => {
      const deviceCode = await getDeviceCode();
      const st = useStore.getState();
      const now = Math.floor(Date.now() / 1000);
      if (!on) return;
      setLicState({ deviceCode, trialStart: st.trialStart || now, lastSeen: Math.max(st.lastSeen || 0, now) });
      if (IS_NATIVE && !IS_IOS) Screen.playAvailable().then((r) => setLicState({ play: !!r.play })).catch(() => {});
      recompute(setLicState);
    };
    const sync = async () => {
      const deviceCode = await getDeviceCode();
      const st = useStore.getState();
      try {
        const id = st.licence ? licenceId(st.licence) : '';
        const usage = st.usage || {};
        const r = await api('hello', { device: deviceCode, platform: PLATFORM, version: __APP_VERSION__, licenceIds: id ? [id] : [], ...(await getDeviceInfo()), features: usage });
        if (!on) return;
        // what was counted has been sent; keep anything counted meanwhile
        const now = useStore.getState().usage || {};
        const left = Object.fromEntries(Object.entries(now).map(([k, v]) => [k, v - (usage[k] || 0)]).filter(([, v]) => v > 0));
        const patch = { policy: r.config, trialStart: Math.min(st.trialStart || r.trialStart, r.trialStart), usage: left, blocked: r.block || null, update: r.update || null, lastCheck: Date.now() };
        let lic = st.licence;
        if (id && r.revoked?.includes(id)) lic = ''; // revoked, or moved to another phone
        const mine = lic && checkLicence(lic, deviceCode, Math.floor(Date.now() / 1000)).ok;
        if (!mine && r.licence) lic = r.licence; // e.g. after reinstalling the app
        if (lic !== st.licence) patch.licence = lic;
        // A new version: tell the church once, with what is new, and keep the notes for after the update.
        if (r.update && r.update.version !== st.updateNotified) {
          patch.updateNotified = r.update.version;
          patch.whatsNew = { version: r.update.version, notes: r.update.notes || '' };
          notify(`Ɔsɔreɛ Plus ${r.update.version} is available`, (r.update.notes ? r.update.notes + ' — ' : '') + (r.update.required ? 'This update is required. Open the app to update.' : 'Open the app to update.'));
        }
        setLicState(patch);
        if (st.pendingPay) await checkPayment(st.pendingPay).catch(() => {});
        if (st.pendingReq) await checkRequest().catch(() => {});
        syncStore().catch(() => {});
      } catch { /* offline: the saved status stands */ }
    };
    refresh().then(sync);
    // Back from the payment page (or any other app): check a waiting payment straight away.
    const back = () => {
      if (document.visibilityState !== 'visible') return;
      const g = useStore.getState();
      if (g.pendingPay) checkPayment(g.pendingPay).catch(() => {});
      if (g.storePending) syncStore().catch(() => {});
    };
    document.addEventListener('visibilitychange', back);
    document.addEventListener('resume', back);
    const q = setInterval(() => { const g = useStore.getState(); if (g.pendingReq) checkRequest().catch(() => {}); if (g.storePending) syncStore().catch(() => {}); }, 30 * 1000);
    const t = setInterval(() => refresh(), 5 * 60 * 1000);
    const s = setInterval(sync, 6 * 60 * 60 * 1000);
    window.osoreeCheckNow = sync; // "Check for updates" in Settings
    return () => { on = false; clearInterval(t); clearInterval(s); clearInterval(q); document.removeEventListener('visibilitychange', back); document.removeEventListener('resume', back); };
  }, [setLicState]);
  useEffect(() => { recompute(setLicState); }, [licence, policy, setLicState]);
}

// Features locked on this device right now (none until the status is known).
export const lockedFeatures = (status) => (status ? (status.pro || DEFAULT_POLICY.pro).filter((f) => !isUnlocked(status, f)) : []);

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

const money = (cur, n) => `${cur === 'GHS' ? 'GH₵' : cur === 'USD' ? 'US$' : cur + ' '}${Number(n).toLocaleString()}`;
const SITE = 'https://nyamebabaku-lab.github.io/osoree-plus/';
const openDoc = (e) => { if (IS_NATIVE) { e.preventDefault(); Screen.openUrl({ url: e.currentTarget.href }); } };
export const Agree = () => <p className="text-[11px] text-stone-500 dark:text-stone-400">By paying you agree to the <a href={SITE + 'terms.html'} target="_blank" rel="noreferrer" onClick={openDoc} className="underline">Terms and Conditions</a> (no refunds once activated) and the <a href={SITE + 'privacy.html'} target="_blank" rel="noreferrer" onClick={openDoc} className="underline">Privacy Policy</a>.</p>;

function BuySection() {
  const { policy, deviceCode, pendingPay, setLicState } = useStore();
  const [product, setProduct] = useState('pro');
  const [phone, setPhone] = useState('');
  const [church, setChurch] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const prices = policy?.prices;
  const abroad = policy?.region === 'INTL';
  useEffect(() => {
    if (!pendingPay) return undefined;
    let tries = 0;
    const t = setInterval(() => {
      if (++tries > 300) { clearInterval(t); return; } // about 15 minutes
      checkPayment(pendingPay).then((paid) => paid && clearInterval(t)).catch((e) => { clearInterval(t); setMsg({ text: e.message, bad: true }); });
    }, 3000);
    return () => clearInterval(t);
  }, [pendingPay]);
  if (!prices) return <p className="text-sm text-stone-500 dark:text-stone-400">Connect to the internet to see prices and buy Pro.</p>;
  const online = policy.onlinePay !== false;
  const choices = [['pro', 'Pro for this device', 'Pay once, no end date'], ['year', 'Pro for one year', 'Renew each year']].filter(([id]) => prices[id] > 0);
  if (!choices.length) return <p className="text-sm text-stone-500 dark:text-stone-400">Pro is not on sale right now.{policy.dealer ? ` Contact ${policy.dealer}.` : ''}</p>;
  const chosen = choices.some(([id]) => id === product) ? product : choices[0][0];
  const pay = async () => {
    setMsg(null); setBusy(true);
    try {
      const r = await api('buy', { device: deviceCode, product: chosen, phone, church: church.trim() || undefined, email: email.trim() || undefined });
      setLicState({ pendingPay: r.ref });
      await openCheckout(r.url);
      setMsg({ text: 'Finish paying in the browser, then come back here. Pro switches on by itself.' });
    } catch (e) { setMsg({ text: e.message, bad: true }); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-2" role="radiogroup" aria-label="Choose Pro">
        {choices.map(([id, title, sub]) => (
          <button key={id} role="radio" aria-checked={chosen === id} onClick={() => setProduct(id)} className={`flex items-center gap-3 rounded-xl p-3 text-left ${chosen === id ? 'bg-green-600/10 ring-2 ring-green-600' : 'bg-paper-100 dark:bg-night-800'}`}>
            <span className="flex-1"><span className="block text-sm font-bold">{title}</span><span className="block text-xs text-stone-500 dark:text-stone-400">{sub}</span></span>
            <span className="text-base font-extrabold">{money(policy.currency, prices[id])}</span>
          </button>
        ))}
      </div>
      {policy.momo && <MomoRequest product={chosen} />}
      {online && (
        <div className="space-y-2">
          {policy.momo && <div className="label pt-1">Or pay online</div>}
          <input className="field" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder={abroad ? 'Your phone number with country code, e.g. +44…' : 'Your phone number (to restore Pro later)'} aria-label="Phone number" />
          {abroad && <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail for the card receipt" aria-label="E-mail for receipt" />}
          <input className="field" value={church} onChange={(e) => setChurch(e.target.value)} placeholder="Church name (optional)" aria-label="Church name" />
          <button onClick={pay} disabled={busy || !phone.trim()} className="btn w-full bg-green-600 text-white hover:bg-green-700"><CreditCard size={16} /> {busy ? 'Starting…' : `Pay ${money(policy.currency, prices[chosen])} ${abroad ? 'by card' : 'with MoMo or card'}`}</button>
          <Agree />
          {policy.provider === 'test' && <p className="text-xs text-amber-700 dark:text-amber-400">Test mode: no money is taken.</p>}
          {pendingPay && <button onClick={() => checkPayment(pendingPay).then((ok) => !ok && setMsg({ text: 'Not paid yet. Finish in the browser, then try again.' })).catch((e) => setMsg({ text: e.message, bad: true }))} className="btn-soft w-full text-sm">I have paid: check now</button>}
          {msg && <p role={msg.bad ? 'alert' : 'status'} className={`text-sm ${msg.bad ? 'text-red-600 dark:text-red-400' : 'text-stone-600 dark:text-stone-300'}`}>{msg.text}</p>}
        </div>
      )}
      {!online && !policy.momo && <p className="text-sm text-stone-500 dark:text-stone-400">{policy.dealer ? `To buy Pro, contact ${policy.dealer}.` : 'Buying is not open yet.'}</p>}
    </div>
  );
}

// Pay the Super Admin by Mobile Money, then send the transaction ID; Pro arrives when it is approved.
function MomoRequest({ product }) {
  const { policy, deviceCode, pendingReq, setLicState } = useStore();
  const [phone, setPhone] = useState('');
  const [ref, setRef] = useState('');
  const [church, setChurch] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [req, setReq] = useState(null);
  const m = policy.momo;
  const amount = money(policy.currency, policy.prices[product]);
  useEffect(() => { if (pendingReq) checkRequest().then(setReq).catch(() => {}); }, [pendingReq]);
  useEffect(() => {
    if (!pendingReq) return undefined;
    const t = setInterval(() => checkRequest().then(setReq).catch(() => {}), 15000);
    return () => clearInterval(t);
  }, [pendingReq]);
  const send = async () => {
    setMsg(null); setBusy(true);
    try {
      const r = await api('request', { device: deviceCode, product, phone, momoRef: ref, church: church.trim() || undefined });
      setLicState({ pendingReq: r.id }); setReq({ status: 'pending' }); askNotifications();
      setMsg({ text: 'Request sent. Pro switches on by itself as soon as your payment is confirmed (keep the internet on).' });
    } catch (e) { setMsg({ text: e.message, bad: true }); } finally { setBusy(false); }
  };
  const check = () => checkRequest().then((r) => { setReq(r); if (r.status === 'pending') setMsg({ text: 'Still waiting for confirmation. You can close this; Pro switches on by itself.' }); }).catch((e) => setMsg({ text: e.message, bad: true }));
  return (
    <div className="space-y-2 rounded-xl bg-amber-400/10 p-3 ring-1 ring-amber-500/40">
      <div className="label">Pay by Mobile Money</div>
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>Send <b>{amount}</b> to {m.network ? `${m.network} ` : ''}MoMo <b className="select-all">{m.number}</b>{m.name ? <> ({m.name})</> : null}.</li>
        <li>Type the number you paid from and the <b>transaction ID</b> from the MoMo message.</li>
        <li>Tap <b>Send Pro request</b>. Pro switches on once the payment is confirmed.</li>
      </ol>
      {pendingReq && req?.status === 'pending' ? (
        <div className="space-y-2">
          <p role="status" className="rounded-lg bg-white/60 p-2 text-sm font-semibold dark:bg-night-900/60">Request sent{req.momo_ref ? ` (transaction ${req.momo_ref})` : ''}. Waiting for confirmation…</p>
          <button onClick={check} className="btn-soft w-full text-sm">Check now</button>
          <button onClick={() => { setLicState({ pendingReq: '' }); setReq(null); }} className="w-full text-xs text-stone-500">Made a mistake? Send a new request</button>
        </div>
      ) : (
        <>
          {req?.status === 'declined' && <p role="alert" className="text-sm text-red-600 dark:text-red-400">Your last request was not approved{req.reason ? `: ${req.reason}` : '.'}{policy.dealer ? ` Contact ${policy.dealer}.` : ''}</p>}
          <input className="field" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Number you paid from" aria-label="Number you paid from" />
          <input className="field" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="MoMo transaction ID" aria-label="MoMo transaction ID" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
          <input className="field" value={church} onChange={(e) => setChurch(e.target.value)} placeholder="Church name (optional)" aria-label="Church name for the request" />
          <button onClick={send} disabled={busy || !phone.trim() || ref.trim().length < 4} className="btn w-full bg-green-600 text-white hover:bg-green-700">{busy ? 'Sending…' : 'Send Pro request'}</button>
          <Agree />
        </>
      )}
      {msg && <p role={msg.bad ? 'alert' : 'status'} className={`text-sm ${msg.bad ? 'text-red-600 dark:text-red-400' : 'text-stone-600 dark:text-stone-300'}`}>{msg.text}</p>}
    </div>
  );
}

// iPhone: Pro through the App Store (Apple's rules); our server turns Apple's signed purchase into the licence.
export const APPLE_IDS = { pro: 'com.osoree.plus.pro', year: 'com.osoree.plus.pro.year' };
function AppleBuy({ onDone }) {
  const { deviceCode, setLicence } = useStore();
  const [products, setProducts] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  useEffect(() => { Screen.iapProducts({ ids: Object.values(APPLE_IDS) }).then((r) => setProducts(r.products)).catch((e) => setMsg({ text: e.message, bad: true })); }, []);
  const claim = async (jws) => { const r = await api('apple', { device: deviceCode, jws }); setLicence(r.licence); return r; };
  const buy = async (id) => {
    setMsg(null); setBusy(id);
    try { const { jws } = await Screen.iapBuy({ id }); await claim(jws); setMsg({ text: 'Thank you! Pro is on.' }); setTimeout(onDone, 1200); }
    catch (e) { if (!/cancel/i.test(e?.message || '')) setMsg({ text: e.message, bad: true }); } finally { setBusy(''); }
  };
  const restore = async () => {
    setMsg(null); setBusy('restore');
    try {
      const { transactions } = await Screen.iapRestore();
      let got = false;
      for (const jws of transactions) { try { await claim(jws); got = true; } catch { /* ended or another app */ } }
      setMsg(got ? { text: 'Pro restored.' } : { text: 'No Pro purchase was found for this Apple ID.', bad: true });
    } catch (e) { setMsg({ text: e.message, bad: true }); } finally { setBusy(''); }
  };
  const order = [[APPLE_IDS.pro, 'Pro for this iPhone', 'Pay once, no end date'], [APPLE_IDS.year, 'Pro for one year', 'Pay once for 12 months']];
  return (
    <div className="space-y-2">
      {!products && !msg && <p className="text-sm text-stone-500">Opening the App Store…</p>}
      {products && !products.length && <p className="text-sm text-stone-500">Pro is not available in the App Store yet.</p>}
      {order.map(([id, title, sub]) => { const p = products?.find((x) => x.id === id); return p && (
        <button key={id} onClick={() => buy(id)} disabled={!!busy} className="flex w-full items-center gap-3 rounded-xl bg-paper-100 p-3 text-left ring-1 ring-green-600/40 dark:bg-night-800">
          <span className="flex-1"><span className="block text-sm font-bold">{title}</span><span className="block text-xs text-stone-500 dark:text-stone-400">{sub}</span></span>
          <span className="text-base font-extrabold">{busy === id ? '…' : p.price}</span>
        </button>
      ); })}
      <button onClick={restore} disabled={!!busy} className="btn-soft w-full text-sm">{busy === 'restore' ? 'Restoring…' : 'Restore purchases'}</button>
      {msg && <p role={msg.bad ? 'alert' : 'status'} className={`text-sm ${msg.bad ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>{msg.text}</p>}
    </div>
  );
}

// Installed from Google Play: Pro through Google Play billing (Google's rules).
export const PLAY_IDS = { pro: 'pro', year: 'pro_year' };
function PlayBuy({ onDone }) {
  const { deviceCode, setLicence } = useStore();
  const [products, setProducts] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  useEffect(() => { Screen.playProducts({ ids: Object.values(PLAY_IDS) }).then((r) => setProducts(r.products)).catch((e) => setMsg({ text: e.message, bad: true })); }, []);
  const claim = async (p) => { const r = await api('google', { device: deviceCode, productId: p.productId, token: p.token }); if (r.licence) setLicence(r.licence); return r; };
  const buy = async (id) => {
    setMsg(null); setBusy(id);
    try { const p = await Screen.playBuy({ id, account: deviceCode.replace(/-/g, '') }); await claim(p); setMsg({ text: 'Thank you! Pro is on.' }); setTimeout(onDone, 1200); }
    catch (e) { if (!/cancel/i.test(e?.message || '')) setMsg({ text: e.message, bad: true }); } finally { setBusy(''); }
  };
  const restore = async () => {
    setMsg(null); setBusy('restore');
    try { const { purchases } = await Screen.playRestore(); let got = false; for (const p of purchases) { try { if ((await claim(p)).licence) got = true; } catch { /* ended */ } } setMsg(got ? { text: 'Pro restored.' } : { text: 'No Pro purchase was found for this Google account.', bad: true }); }
    catch (e) { setMsg({ text: e.message, bad: true }); } finally { setBusy(''); }
  };
  const order = [[PLAY_IDS.pro, 'Pro for this device', 'Pay once, no end date'], [PLAY_IDS.year, 'Pro for one year', 'Pay once for 12 months']];
  return (
    <div className="space-y-2">
      {!products && !msg && <p className="text-sm text-stone-500">Opening Google Play…</p>}
      {products && !products.length && <p className="text-sm text-stone-500">Pro is not available in Google Play yet.</p>}
      {order.map(([id, title, sub]) => { const p = products?.find((x) => x.id === id); return p && (
        <button key={id} onClick={() => buy(id)} disabled={!!busy} className="flex w-full items-center gap-3 rounded-xl bg-paper-100 p-3 text-left ring-1 ring-green-600/40 dark:bg-night-800">
          <span className="flex-1"><span className="block text-sm font-bold">{title}</span><span className="block text-xs text-stone-500 dark:text-stone-400">{sub}</span></span>
          <span className="text-base font-extrabold">{busy === id ? '…' : p.price}</span>
        </button>
      ); })}
      <button onClick={restore} disabled={!!busy} className="btn-soft w-full text-sm">{busy === 'restore' ? 'Restoring…' : 'Restore purchases'}</button>
      {msg && <p role={msg.bad ? 'alert' : 'status'} className={`text-sm ${msg.bad ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>{msg.text}</p>}
    </div>
  );
}

function CodeSection() {
  const { deviceCode, setLicence } = useStore();
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState(null);
  const go = async () => {
    setMsg(null);
    try { const r = await api('redeem', { device: deviceCode, code }); setLicence(r.licence); } catch (e) { setMsg(e.message); }
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input className="field uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. GRACE-7K2M-9QXP" aria-label="Activation code" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
        <button onClick={go} disabled={code.trim().length < 6} className="btn-soft shrink-0"><Ticket size={16} /> Use</button>
      </div>
      {msg && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{msg}</p>}
    </div>
  );
}

function RestoreSection() {
  const { deviceCode, setLicence } = useStore();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState(1);
  const [msg, setMsg] = useState(null);
  const start = async () => { setMsg(null); try { await api('restore-start', { phone }); setStep(2); setMsg({ text: 'We sent a 6-digit code by SMS.' }); } catch (e) { setMsg({ text: e.message, bad: true }); } };
  const finish = async () => { setMsg(null); try { const r = await api('restore-finish', { phone, code, device: deviceCode }); setLicence(r.licence); } catch (e) { setMsg({ text: e.message, bad: true }); } };
  return (
    <div className="space-y-2">
      <p className="text-xs text-stone-500 dark:text-stone-400">New or reset phone? Pro moves here from the phone number used when paying (the old device stops being Pro).</p>
      {step === 1 ? (
        <div className="flex gap-2">
          <input className="field" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Phone number used when paying" aria-label="Restore phone number" />
          <button onClick={start} disabled={!phone.trim()} className="btn-soft shrink-0"><Phone size={16} /> Send code</button>
        </div>
      ) : (
        <div className="flex gap-2">
          <input className="field" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="6-digit code" aria-label="SMS code" />
          <button onClick={finish} disabled={code.trim().length !== 6} className="btn-soft shrink-0">Restore</button>
        </div>
      )}
      {msg && <p role={msg.bad ? 'alert' : 'status'} className={`text-sm ${msg.bad ? 'text-red-600 dark:text-red-400' : 'text-stone-600 dark:text-stone-300'}`}>{msg.text}</p>}
    </div>
  );
}

// Shown when a locked feature is tapped (or the badge): what Pro includes and how to get it.
export function Paywall() {
  const { paywall, openPaywall, licStatus, play } = useStore();
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
            {IS_IOS || play ? (
              <div className="space-y-2"><div className="label">Buy Pro</div>{IS_IOS ? <AppleBuy onDone={close} /> : <PlayBuy onDone={close} />}</div>
            ) : (
              <>
                <div className="space-y-2"><div className="label">Buy Pro</div><BuySection /></div>
                <div className="space-y-2"><div className="label">Have an activation code?</div><CodeSection /></div>
              </>
            )}
            <div className="space-y-2"><div className="label">Restore Pro</div><RestoreSection /></div>
            {!IS_IOS && !play && <details className="rounded-xl bg-paper-100 p-3 dark:bg-night-800">
              <summary className="cursor-pointer text-sm font-semibold">Got a licence code from your dealer?</summary>
              <div className="mt-3 space-y-2">
                <div className="label">This device’s code</div>
                <DeviceCode />
                <LicenceEntry onDone={close} />
              </div>
            </details>}
            <SupportLinks topic="I need help getting Ɔsɔreɛ Plus Pro" />
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
