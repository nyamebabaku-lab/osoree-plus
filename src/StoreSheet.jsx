import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Check, Clock, Download, Image as ImageIcon, Music, ShoppingBag, Smartphone } from 'lucide-react';
import { useStore } from './store.js';
import { api, openCheckout } from './lib/server.js';
import { Agree } from './Pro.jsx';
import { install, installedIds, loadStore, syncStore } from './lib/store-client.js';
import { Empty, Seg, Sheet } from './ui.jsx';
import { askNotifications } from './lib/notify.js';
import { IS_IOS, Screen } from './lib/output.js';

const money = (cur, n) => `${cur === 'GHS' ? 'GH₵' : cur === 'USD' ? 'US$' : (cur || '') + ' '}${Number(n).toLocaleString()}`;
const mb = (n) => (n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');

export function StoreButton({ className = 'btn-soft w-full', start = 'bible', label = 'Store: Bibles, hymns and backgrounds' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className={className}><ShoppingBag size={18} /> {label}</button>
      {open && <StoreSheet start={start} onClose={() => setOpen(false)} />}
    </>
  );
}

function BuyForm({ item, onSent }) {
  const { policy, deviceCode } = useStore();
  const [phone, setPhone] = useState('');
  const [ref, setRef] = useState('');
  const [church, setChurch] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const m = policy?.momo;
  if (!m) return <p className="text-sm text-stone-500 dark:text-stone-400">To buy this, contact {policy?.dealer || 'your dealer'}.</p>;
  const send = async () => {
    setMsg(null); setBusy(true);
    try { await api('request', { device: deviceCode, itemId: item.id, phone, momoRef: ref, church: church.trim() || undefined }); useStore.getState().setLicState({ storePending: true }); askNotifications(); onSent(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2 rounded-xl bg-amber-400/10 p-3 ring-1 ring-amber-500/40">
      <p className="text-sm">Send <b>{money(item.currency, item.price)}</b> to {m.network ? `${m.network} ` : ''}MoMo <b className="select-all">{m.number}</b>{m.name ? ` (${m.name})` : ''}, then send the transaction ID. It installs by itself on every phone of your church once confirmed.</p>
      <input className="field" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Church number you paid from" aria-label={`Number paid from for ${item.title}`} />
      <input className="field" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="MoMo transaction ID" aria-label={`Transaction ID for ${item.title}`} autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
      <input className="field" value={church} onChange={(e) => setChurch(e.target.value)} placeholder="Church name (optional)" aria-label={`Church for ${item.title}`} />
      <button onClick={send} disabled={busy || !phone.trim() || ref.trim().length < 4} className="btn w-full bg-green-600 text-white">{busy ? 'Sending…' : 'Send request'}</button>
      {msg && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{msg}</p>}
    </div>
  );
}

// Abroad (or without a MoMo number): pay by card; the item installs by itself once the payment goes through.
function CardBuy({ item, onPaid }) {
  const { deviceCode, policy } = useStore();
  const abroad = policy?.region === 'INTL';
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const pay = async () => {
    setMsg(null); setBusy(true);
    try {
      const r = await api('buy', { device: deviceCode, itemId: item.id, phone, email: email.trim() || undefined });
      await openCheckout(r.url);
      setMsg({ text: 'Finish paying in the browser, then come back. It installs by itself.' });
      for (let i = 0; i < 300; i++) {
        await new Promise((w) => setTimeout(w, 3000));
        const st = await api('buy-status', { ref: r.ref }).catch(() => null);
        if (st?.status === 'paid') { onPaid(); return; }
        if (st?.status === 'failed') { setMsg({ text: st.error ? `The payment did not go through (${st.error}).` : 'The payment did not go through.', bad: true }); return; }
      }
    } catch (e) { setMsg({ text: e.message, bad: true }); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2 rounded-xl bg-paper-100 p-3 dark:bg-night-800">
      <input className="field" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder={abroad ? 'Church phone with country code, e.g. +44…' : 'Church phone number'} aria-label={`Phone for ${item.title}`} />
      {abroad && <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail for the card receipt" aria-label={`E-mail for ${item.title}`} />}
      <button onClick={pay} disabled={busy || !phone.trim()} className="btn w-full bg-green-600 text-sm text-white">{busy ? 'Waiting for the payment…' : `Pay ${money(item.currency, item.price)} by card`}</button>
      <Agree />
      {msg && <p role={msg.bad ? 'alert' : 'status'} className={`text-sm ${msg.bad ? 'text-red-600 dark:text-red-400' : 'text-stone-600 dark:text-stone-300'}`}>{msg.text}</p>}
    </div>
  );
}

function LinkPhone({ onDone }) {
  const deviceCode = useStore((s) => s.deviceCode);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [msg, setMsg] = useState(null);
  const start = async () => { setMsg(null); try { await api('restore-start', { phone, purpose: 'store' }); setSent(true); } catch (e) { setMsg({ text: e.message, bad: true }); } };
  const finish = async () => { setMsg(null); try { await api('store-link', { device: deviceCode, phone, code }); setMsg({ text: 'Done. Your church’s items are installing.' }); onDone(); } catch (e) { setMsg({ text: e.message, bad: true }); } };
  return (
    <details className="rounded-xl bg-paper-100 p-3 dark:bg-night-800">
      <summary className="cursor-pointer text-sm font-semibold"><Smartphone size={14} className="inline" /> Bought on another phone of your church?</summary>
      <div className="mt-2 space-y-2">
        <p className="text-xs text-stone-500 dark:text-stone-400">Type the church number used to pay. We send it an SMS code; this phone then gets everything the church bought.</p>
        <input className="field" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Church number" aria-label="Church number for the store" />
        {!sent ? <button onClick={start} disabled={!phone.trim()} className="btn-soft w-full">Send me a code</button> : (
          <div className="flex gap-2">
            <input className="field" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="6-digit code" aria-label="Store SMS code" />
            <button onClick={finish} disabled={code.trim().length < 6} className="btn-soft shrink-0">Confirm</button>
          </div>
        )}
        {msg && <p role={msg.bad ? 'alert' : 'status'} className={`text-sm ${msg.bad ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>{msg.text}</p>}
      </div>
    </details>
  );
}

export default function StoreSheet({ onClose, start = 'bible' }) {
  const st = useStore();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [kind, setKind] = useState(start);
  const [buying, setBuying] = useState('');
  const [working, setWorking] = useState('');
  const [note, setNote] = useState(null);
  const refresh = useCallback(() => syncStore().then((r) => { setData(r); setError(''); }).catch((e) => setError(e.message)), []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (!data?.pending.length) return undefined; const t = setInterval(refresh, 15000); return () => clearInterval(t); }, [data, refresh]);
  const have = installedIds(st);
  const get = async (it) => {
    setNote(null); setWorking(it.id);
    try { await install(it); setNote({ text: it.kind === 'bible' ? `${it.abbr || it.title} is ready: choose it in the Bible version list.` : it.kind === 'hymnal' ? `${it.title} is ready in Songs → Hymns.` : `${it.title} is in Media and in Screen → Text background.` }); await loadStore().then(setData); }
    catch (e) { setNote({ text: e.message, bad: true }); } finally { setWorking(''); }
  };
  // iPhone (App Store rules): free items, what the church owns, and items sold through the App Store.
  const STORE = IS_IOS ? 'apple' : st.play ? 'google' : '';
  const pid = (i) => (STORE === 'apple' ? i.apple_product : i.google_product);
  const items = data?.items.filter((i) => i.kind === kind && (!STORE || i.price === 0 || data.owned.includes(i.id) || pid(i))) || [];
  const [prices, setPrices] = useState({});
  useEffect(() => {
    const ids = (data?.items || []).filter((i) => pid(i) && !data.owned.includes(i.id)).map(pid);
    if (STORE && ids.length) (STORE === 'apple' ? Screen.iapProducts({ ids }) : Screen.playProducts({ ids })).then((r) => setPrices(Object.fromEntries(r.products.map((p) => [p.id, p.price])))).catch(() => {});
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const appleBuy = async (it) => {
    setNote(null); setWorking(it.id);
    try {
      if (STORE === 'apple') { const { jws } = await Screen.iapBuy({ id: it.apple_product }); await api('apple', { device: st.deviceCode, jws }); }
      else { const p = await Screen.playBuy({ id: it.google_product, account: st.deviceCode.replace(/-/g, '') }); await api('google', { device: st.deviceCode, productId: p.productId, token: p.token }); }
      await install(it); setNote({ text: `${it.title} is yours.` }); await loadStore().then(setData); }
    catch (e) { if (!/cancel/i.test(e?.message || '')) setNote({ text: e.message, bad: true }); } finally { setWorking(''); }
  };
  const appleRestore = async () => {
    setNote(null); setWorking('restore');
    try {
      if (STORE === 'apple') { const { transactions } = await Screen.iapRestore(); for (const jws of transactions) await api('apple', { device: st.deviceCode, jws }).catch(() => {}); }
      else { const { purchases } = await Screen.playRestore(); for (const p of purchases) await api('google', { device: st.deviceCode, productId: p.productId, token: p.token }).catch(() => {}); }
      await refresh(); setNote({ text: 'Purchases restored.' });
    }
    catch (e) { setNote({ text: e.message, bad: true }); } finally { setWorking(''); }
  };
  return (
    <Sheet title="Store" onClose={onClose}>
      <div className="space-y-3">
        <Seg label="Store section" value={kind} onChange={setKind} options={[['bible', 'Bibles'], ['hymnal', 'Hymns'], ['background', 'Backgrounds']]} />
        {error && <p className="text-sm text-red-600 dark:text-red-400">{/internet/i.test(error) ? 'Connect to the internet to open the store.' : error}</p>}
        {!data && !error && <Empty>Opening the store…</Empty>}
        {data && !items.length && <Empty>Nothing here yet.</Empty>}
        {note && <p role={note.bad ? 'alert' : 'status'} className={`text-sm ${note.bad ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>{note.text}</p>}
        <div className={kind === 'background' ? 'grid grid-cols-2 gap-2' : 'space-y-2'}>
          {items.map((it) => {
            const installed = have.has(it.id), owned = it.price === 0 || data.owned.includes(it.id), waiting = data.pending.includes(it.id);
            const declined = data.declined.find((x) => x.id === it.id);
            return (
              <div key={it.id} className={`card space-y-2 p-3 ${kind === 'background' ? '' : ''}`} aria-label={it.title}>
                {it.thumb && <img src={it.thumb} alt="" className="aspect-video w-full rounded-lg object-cover" />}
                <div className="flex items-start gap-2">
                  {it.kind === 'bible' ? <BookOpen size={18} className="mt-0.5 shrink-0 text-gold-500" /> : it.kind === 'hymnal' ? <Music size={18} className="mt-0.5 shrink-0 text-gold-500" /> : <ImageIcon size={16} className="mt-0.5 shrink-0 text-gold-500" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold">{it.title}{it.abbr ? <span className="text-stone-500"> · {it.abbr}</span> : null}</div>
                    {it.lang && <div className="text-xs text-stone-500">{it.lang}</div>}
                    {it.description && <div className="text-xs text-stone-500 dark:text-stone-400">{it.description}</div>}
                    {it.copyright && <div className="text-[10px] text-stone-400">{it.copyright}</div>}
                  </div>
                  <span className="shrink-0 text-sm font-extrabold">{it.price === 0 ? <span className="text-green-600">Free</span> : money(it.currency, it.price)}</span>
                </div>
                {installed ? <div className="flex items-center gap-1 text-sm font-semibold text-green-700 dark:text-green-400"><Check size={16} /> Installed</div>
                  : owned ? <button onClick={() => get(it)} disabled={working === it.id} className="btn-gold w-full text-sm"><Download size={16} /> {working === it.id ? 'Downloading…' : `Get${it.file_size ? ` (${mb(it.file_size)})` : ''}`}</button>
                  : waiting ? <div className="flex items-center gap-1 text-sm font-semibold text-amber-700 dark:text-amber-400"><Clock size={16} /> Waiting for confirmation…</div>
                  : STORE ? (prices[pid(it)] ? <button onClick={() => appleBuy(it)} disabled={working === it.id} className="btn w-full bg-green-600 text-sm text-white">{working === it.id ? 'Buying…' : `Buy ${prices[pid(it)]}`}</button> : <p className="text-xs text-stone-500">Not available here yet.</p>)
                  : buying === it.id ? (st.policy?.momo ? <BuyForm item={it} onSent={() => { setBuying(''); refresh(); }} /> : <CardBuy item={it} onPaid={() => { setBuying(''); refresh(); }} />)
                  : (
                    <>
                      {declined && <p className="text-xs text-red-600 dark:text-red-400">Not approved{declined.reason ? `: ${declined.reason}` : ''}.</p>}
                      <button onClick={() => setBuying(it.id)} className="btn w-full bg-green-600 text-sm text-white">Buy {money(it.currency, it.price)}</button>
                    </>
                  )}
              </div>
            );
          })}
        </div>
        {data && STORE && <button onClick={appleRestore} disabled={working === 'restore'} className="btn-soft w-full text-sm">{working === 'restore' ? 'Restoring…' : 'Restore purchases'}</button>}
        {data && <LinkPhone onDone={refresh} />}
      </div>
    </Sheet>
  );
}
