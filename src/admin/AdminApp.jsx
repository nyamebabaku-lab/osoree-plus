import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Home, Inbox, KeyRound, LogOut, Moon, RefreshCw, Settings, Share2, ShoppingBag, Sun, Ticket, Upload, X } from 'lucide-react';
import { gzipSync, unzipSync } from 'fflate';
import { decodeXml, parseXmlBible } from '../lib/bible.js';
import { admin, sb } from './api.js';
import { FEATURES } from '../lib/licence.js';
import { Empty, Seg } from '../ui.jsx';

const money = (n, cur = 'GHS') => `${cur === 'GHS' ? 'GH₵' : cur + ' '}${Number(n || 0).toLocaleString()}`;
const when = (t) => (t ? new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
const day = (t) => (t ? new Date(t).toLocaleDateString([], { dateStyle: 'medium' }) : 'no end');
const PRODUCT = { pro: 'Pro (no end)', year: 'Pro, 1 year' };

function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    fn().then((data) => setState({ data, error: '', loading: false })).catch((e) => setState({ data: null, error: e.message, loading: false }));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);
  return { ...state, reload: load };
}

function CopyButton({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ text }); return; } catch { /* closed */ } }
    await navigator.clipboard?.writeText(text).catch(() => {});
    setDone(true); setTimeout(() => setDone(false), 1500);
  };
  return <button onClick={share} className="btn-soft min-h-9 px-3 text-sm">{done ? <Check size={14} /> : navigator.share ? <Share2 size={14} /> : <Copy size={14} />} {done ? 'Copied' : label}</button>;
}

const Msg = ({ m }) => (m ? <p role={m.bad ? 'alert' : 'status'} className={`text-sm ${m.bad ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>{m.text}</p> : null);

// ------------------------------------------------------------------------------------------- sign in
function SignIn({ onIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn) => { setBusy(true); setMsg(null); try { await fn(); } catch (e) { setMsg({ text: e.message, bad: true }); } finally { setBusy(false); } };
  const signIn = () => run(async () => {
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(/confirm/i.test(error.message) ? 'Confirm your e-mail first: tap the link in the e-mail from Supabase, then sign in.' : /invalid/i.test(error.message) ? 'Wrong e-mail or password.' : error.message);
    onIn();
  });
  const create = () => run(async () => {
    if (password.length < 8) throw new Error('Choose a password of at least 8 characters.');
    const { error } = await sb.auth.signUp({ email: email.trim(), password });
    if (error) throw new Error(error.message);
    setMsg({ text: 'Account made. Open the e-mail from Supabase and tap the confirmation link, then come back and sign in.' });
  });
  const forgot = () => run(async () => {
    if (!email.trim()) throw new Error('Type your e-mail first.');
    const { error } = await sb.auth.resetPasswordForEmail(email.trim());
    if (error) throw new Error(error.message);
    setMsg({ text: 'If that e-mail has an account, a reset link is on its way.' });
  });
  return (
    <div className="mx-auto max-w-sm space-y-4 p-6 pt-16">
      <h1 className="text-2xl font-bold">Ɔsɔreɛ <span className="text-gold-500">Plus</span> <span className="text-green-600">Admin</span></h1>
      <p className="text-sm text-stone-500 dark:text-stone-400">For the Super Admin only.</p>
      <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" aria-label="E-mail" autoCapitalize="none" autoComplete="username" />
      <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" aria-label="Password" autoComplete="current-password" onKeyDown={(e) => e.key === 'Enter' && signIn()} />
      <button onClick={signIn} disabled={busy || !email || !password} className="btn w-full bg-green-600 text-white hover:bg-green-700">Sign in</button>
      <div className="flex justify-between text-sm">
        <button onClick={create} disabled={busy || !email || !password} className="font-semibold text-gold-600 dark:text-gold-400">First time? Create account</button>
        <button onClick={forgot} disabled={busy} className="text-stone-500">Forgot password</button>
      </div>
      <Msg m={msg} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------- home
function HomeTab({ go, onCount }) {
  const o = useLoad(() => admin('overview'), []);
  useEffect(() => { if (o.data) onCount(o.data.pending_requests || 0); }, [o.data, onCount]);
  const r = useLoad(() => admin('recent'), []);
  const s = useLoad(() => admin('settings'), []);
  const x = o.data;
  return (
    <div className="space-y-4">
      {s.data?.testMode && <p className="rounded-xl bg-amber-500/15 p-3 text-sm font-semibold text-amber-800 dark:text-amber-300">Test mode is on: payments are simulated and no money is taken. Switch it off in Settings when your payment keys are saved.</p>}
      {o.error && <p className="text-sm text-red-600">{o.error}</p>}
      {x?.pending_requests > 0 && <button onClick={() => go('requests')} className="w-full rounded-xl bg-green-600 p-3 text-left text-sm font-bold text-white">{x.pending_requests} Pro {x.pending_requests === 1 ? 'request is' : 'requests are'} waiting for you. Tap to check the MoMo payment and approve.</button>}
      <div className="grid grid-cols-2 gap-2">
        {[['Revenue', x && money(x.revenue + (x.momo_revenue || 0))], ['This month', x && money(x.revenue_month + (x.momo_revenue_month || 0))], ['Active Pro', x?.licences], ['Devices', x?.devices], ['Used in 30 days', x?.active30], ['Test sales', x?.test_sales]].map(([k, v]) => (
          <div key={k} className="card p-3"><div className="label">{k}</div><div className="mt-1 text-xl font-extrabold">{v ?? '…'}</div></div>
        ))}
      </div>
      <section className="card space-y-2 p-4">
        <div className="flex items-center justify-between"><div className="label">Recent payments</div><button onClick={() => { o.reload(); r.reload(); }} aria-label="Refresh" className="icon-btn"><RefreshCw size={16} /></button></div>
        {!r.data?.payments?.length ? <Empty>No payments yet.</Empty> : r.data.payments.map((p) => (
          <div key={p.id} className="flex items-center gap-2 border-b border-paper-200 py-2 text-sm last:border-0 dark:border-night-700">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${p.status === 'paid' ? 'bg-green-600' : p.status === 'failed' ? 'bg-red-600' : 'bg-amber-500'}`}>{p.status.toUpperCase()}</span>
            <span className="min-w-0 flex-1 truncate"><b>{money(p.amount, p.currency)}</b> · {PRODUCT[p.product]} · {p.church || p.phone}{p.provider === 'test' ? ' · test' : ''}</span>
            <span className="shrink-0 text-xs text-stone-500">{when(p.created_at)}</span>
          </div>
        ))}
      </section>
      {r.data?.smsProblems?.length > 0 && (
        <section className="card space-y-2 p-4">
          <div className="label text-red-600">SMS problems</div>
          {r.data.smsProblems.map((m, i) => <p key={i} className="text-xs"><b>{m.phone}</b> · {when(m.created_at)}<br /><span className="text-stone-500">{m.reply}</span></p>)}
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------- licences
function IssueForm({ onDone }) {
  const [f, setF] = useState({ device: '', product: 'pro', church: '', phone: '' });
  const [out, setOut] = useState(null);
  const [msg, setMsg] = useState(null);
  const go = async () => {
    setMsg(null);
    try { const r = await admin('issue', { ...f, device: f.device.trim().toUpperCase() }); setOut(r.licence); onDone(); } catch (e) { setMsg({ text: e.message, bad: true }); }
  };
  return (
    <section className="card space-y-2 p-4">
      <div className="label">Give a licence</div>
      <input className="field font-mono uppercase" value={f.device} onChange={(e) => setF({ ...f, device: e.target.value })} placeholder="Device code OSR-XXXX-XXXX-XXXX" aria-label="Device code" />
      <Seg label="Licence kind" value={f.product} onChange={(product) => setF({ ...f, product })} options={[['pro', 'No end date'], ['year', 'One year']]} />
      <input className="field" value={f.church} onChange={(e) => setF({ ...f, church: e.target.value })} placeholder="Church name (optional)" aria-label="Church" />
      <input className="field" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" placeholder="Phone, for restoring later (optional)" aria-label="Phone" />
      <button onClick={go} disabled={!/^OSR(-[0-9A-Z]{4}){3}$/i.test(f.device.trim())} className="btn w-full bg-green-600 text-white">Make licence</button>
      <Msg m={msg} />
      {out && (
        <div className="space-y-2 rounded-xl bg-green-600/10 p-3">
          <p className="text-sm font-semibold">Send this code to the church (it works only on that device):</p>
          <code className="block break-all rounded-lg bg-white p-2 text-[11px] dark:bg-night-900">{out}</code>
          <CopyButton text={out} label="Share" />
        </div>
      )}
    </section>
  );
}

function LicencesTab() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const list = useLoad(() => admin('licences', { q: search }), [search]);
  const [moving, setMoving] = useState(null);
  const [dest, setDest] = useState('');
  const [msg, setMsg] = useState(null);
  const act = async (fn, okText) => { setMsg(null); try { const r = await fn(); setMsg({ text: okText(r) }); list.reload(); } catch (e) { setMsg({ text: e.message, bad: true }); } };
  return (
    <div className="space-y-4">
      <IssueForm onDone={list.reload} />
      <form onSubmit={(e) => { e.preventDefault(); setSearch(q); }} className="flex gap-2">
        <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search church, phone or device" aria-label="Search licences" />
        <button className="btn-soft shrink-0">Search</button>
      </form>
      <Msg m={msg} />
      {list.error && <p className="text-sm text-red-600">{list.error}</p>}
      {list.data && !list.data.length && <Empty>No licences found.</Empty>}
      {list.data?.map((l) => (
        <div key={l.id} className="card space-y-1.5 p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${l.status === 'active' ? 'bg-green-600' : 'bg-stone-500'}`}>{l.status.toUpperCase()}</span>
            <b className="min-w-0 flex-1 truncate">{l.church || l.phone || 'No name'}</b>
            <span className="text-xs text-stone-500">{PRODUCT[l.product]}</span>
          </div>
          <div className="font-mono text-xs">{l.device_code}</div>
          <div className="text-xs text-stone-500">Ends: {day(l.expires_at)} · from {l.source}{l.phone ? ` · ${l.phone}` : ''} · {when(l.created_at)}</div>
          {l.status === 'active' && (
            <div className="flex flex-wrap gap-2 pt-1">
              <CopyButton text={l.token} label="Share code" />
              <button onClick={() => { setMoving(l.id); setDest(''); }} className="btn-soft min-h-9 px-3 text-sm">Move</button>
              <button onClick={() => window.confirm('Revoke this licence? The device loses Pro when it next goes online.') && act(() => admin('revoke', { id: l.id }), () => 'Revoked.')} className="btn-soft min-h-9 px-3 text-sm text-red-600">Revoke</button>
            </div>
          )}
          {moving === l.id && (
            <div className="flex gap-2 pt-1">
              <input className="field min-h-10 font-mono text-sm uppercase" value={dest} onChange={(e) => setDest(e.target.value)} placeholder="New device code" aria-label="New device code" />
              <button onClick={() => act(() => admin('move', { id: l.id, device: dest.trim().toUpperCase() }), () => 'Moved. Share the new code from the list.').then(() => setMoving(null))} className="btn-soft shrink-0">Move</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------------------------------- requests
const REQ = { pending: ['WAITING', 'bg-amber-500'], approved: ['APPROVED', 'bg-green-600'], declined: ['DECLINED', 'bg-stone-500'] };
function RequestsTab({ onChange }) {
  const [filter, setFilter] = useState('pending');
  const list = useLoad(() => admin('requests', { status: filter === 'all' ? undefined : filter }), [filter]);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState('');
  const act = async (id, fn, ok) => { setMsg(null); setBusy(id); try { await fn(); setMsg({ text: ok }); list.reload(); onChange(); } catch (e) { setMsg({ text: e.message, bad: true }); } finally { setBusy(''); } };
  return (
    <div className="space-y-3">
      <p className="text-xs text-stone-500 dark:text-stone-400">Churches pay your MoMo number, then send the transaction ID from the app. Check the payment in your MoMo messages, then approve: the church's phone switches to Pro by itself.</p>
      <div className="flex items-center justify-between gap-2">
        <Seg label="Show requests" value={filter} onChange={setFilter} options={[['pending', 'Waiting'], ['approved', 'Approved'], ['declined', 'Declined'], ['all', 'All']]} />
        <button onClick={list.reload} aria-label="Refresh requests" className="icon-btn"><RefreshCw size={16} /></button>
      </div>
      <Msg m={msg} />
      {list.error && <p className="text-sm text-red-600">{list.error}</p>}
      {list.data && !list.data.length && <Empty>{filter === 'pending' ? 'No requests waiting.' : 'No requests.'}</Empty>}
      {list.data?.map((r) => (
        <div key={r.id} className="card space-y-1.5 p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${(REQ[r.status] || REQ.declined)[1]}`}>{(REQ[r.status] || REQ.declined)[0]}</span>
            <b className="min-w-0 flex-1 truncate">{r.church || r.phone}</b>
            <b>{money(r.amount, r.currency)}</b>
          </div>
          <div>MoMo transaction: <b className="select-all font-mono">{r.momo_ref}</b> · from <b>{r.phone}</b></div>
          <div className="text-xs text-stone-500">{r.item_id ? `${r.item_kind === 'bible' ? 'Bible' : 'Background'}: ${r.item_title}` : PRODUCT[r.product]} · {r.device_code} · {when(r.created_at)}{r.reason ? ` · ${r.reason}` : ''}</div>
          {r.status === 'pending' && (
            <div className="flex gap-2 pt-1">
              <button disabled={busy === r.id} onClick={() => act(r.id, () => admin('approveRequest', { id: r.id }), `Approved. ${r.church || r.phone} gets Pro the next time the app is online.`)} className="btn flex-1 bg-green-600 text-white"><Check size={16} /> Approve</button>
              <button disabled={busy === r.id} onClick={() => { const reason = window.prompt('Why are you declining? (the church sees this)', 'Payment not found'); if (reason !== null) act(r.id, () => admin('declineRequest', { id: r.id, reason }), 'Declined.'); }} className="btn-soft flex-1 text-red-600"><X size={16} /> Decline</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------------------------------- store
// A Bible file (XML, or a zip with one XML) becomes the app's own Bible file, gzipped.
async function bibleFile(file) {
  let bytes = new Uint8Array(await file.arrayBuffer()), name = file.name;
  if (/\.zip$/i.test(name)) {
    const all = unzipSync(bytes, { filter: (e) => /\.xml$/i.test(e.name) && !/(^|\/)(__MACOSX|\.)/.test(e.name) });
    const first = Object.keys(all).sort()[0];
    if (!first) throw new Error('No XML Bible inside this zip.');
    bytes = all[first]; name = first.split('/').pop();
  }
  const bible = parseXmlBible(decodeXml(bytes), name);
  const verses = bible.books.reduce((n, b) => n + (b || []).reduce((m, c) => m + ((c || []).filter(Boolean).length), 0), 0);
  if (verses < 100) throw new Error('This file has almost no verses. Check it is a Bible XML file.');
  return { blob: new Blob([gzipSync(new TextEncoder().encode(JSON.stringify(bible)), { level: 9 })]), type: 'bible-json-gz', abbr: bible.abbr, title: bible.name, verses };
}
// A small picture for the store list, from a picture or the first second of a video.
function thumbOf(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const draw = (el, w, h) => { const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d'); const k = Math.max(320 / w, 180 / h); g.drawImage(el, (320 - w * k) / 2, (180 - h * k) / 2, w * k, h * k); URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.7)); };
    if (/^video\//.test(file.type)) { const v = document.createElement('video'); v.muted = true; v.src = url; v.onloadeddata = () => { v.currentTime = Math.min(1, v.duration / 2 || 0); }; v.onseeked = () => draw(v, v.videoWidth, v.videoHeight); v.onerror = () => resolve(null); }
    else { const i = new window.Image(); i.onload = () => draw(i, i.naturalWidth, i.naturalHeight); i.onerror = () => resolve(null); i.src = url; }
  });
}
const BLANK = { kind: 'bible', title: '', abbr: '', lang: '', description: '', copyright: '', price: 0, active: true };
function StoreTab() {
  const list = useLoad(() => admin('storeItems'), []);
  const [f, setF] = useState(BLANK);
  const [file, setFile] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState('');
  const save = async () => {
    setMsg(null);
    try {
      if (!f.id && !file) throw new Error(`Choose the ${f.kind === 'bible' ? 'Bible XML (or zip)' : 'picture or MP4 video'} first.`);
      let up = null, thumb;
      if (file) {
        setBusy('Reading the file…');
        if (f.kind === 'bible') up = await bibleFile(file);
        else {
          if (!/^(image\/(jpeg|png)|video\/mp4)$/.test(file.type)) throw new Error('Backgrounds: JPG, PNG or MP4.');
          if (file.size > 45e6) throw new Error('Keep background files under 45 MB.');
          up = { blob: file, type: file.type }; thumb = await thumbOf(file);
        }
      }
      setBusy('Saving…');
      const meta = { ...f, title: f.title || up?.title || '', abbr: f.abbr || up?.abbr || '', price: Number(f.price) || 0, thumb };
      const { id } = await admin('storeSave', meta);
      if (up) {
        setBusy('Uploading…');
        const u = await admin('storeUploadUrl', { id, type: up.type });
        const r = await fetch(u.url, { method: 'PUT', headers: { 'Content-Type': f.kind === 'bible' ? 'application/gzip' : up.type }, body: up.blob });
        if (!r.ok) throw new Error('The upload failed. Check the internet and try again.');
        await admin('storeFileDone', { id, path: u.path, type: up.type, size: up.blob.size });
      }
      setMsg({ text: `Saved${up?.verses ? ` (${up.verses.toLocaleString()} verses)` : ''}. ${meta.active ? 'Churches see it in the store now.' : 'Hidden until you tick "Show in the store".'}` });
      setF(BLANK); setFile(null); list.reload();
    } catch (e) { setMsg({ text: e.message, bad: true }); } finally { setBusy(''); }
  };
  return (
    <div className="space-y-4">
      <section className="card space-y-2 p-4">
        <div className="label">{f.id ? 'Edit item' : 'Add to the store'}</div>
        {!f.id && <Seg label="Item kind" value={f.kind} onChange={(kind) => { setF({ ...f, kind }); setFile(null); }} options={[['bible', 'Bible'], ['background', 'Background']]} />}
        <label className="block text-xs font-semibold">{f.kind === 'bible' ? 'Bible file (XML, or zip with one XML)' : 'Picture (JPG/PNG) or MP4 video'}{f.id ? ' — only to replace it' : ''}
          <input type="file" className="mt-1 block w-full text-sm" accept={f.kind === 'bible' ? '.xml,.zip' : 'image/jpeg,image/png,video/mp4'} onChange={(e) => setFile(e.target.files[0] || null)} aria-label="Store file" /></label>
        <input className="field" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={f.kind === 'bible' ? 'Title, e.g. Twi Bible (1964) — or leave empty to use the file’s' : 'Title, e.g. Golden cross'} aria-label="Item title" />
        {f.kind === 'bible' && <div className="grid grid-cols-2 gap-2">
          <input className="field" value={f.abbr} onChange={(e) => setF({ ...f, abbr: e.target.value })} placeholder="Short name, e.g. TWI" aria-label="Short name" />
          <input className="field" value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value })} placeholder="Language" aria-label="Language" />
        </div>}
        <input className="field" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Description (optional)" aria-label="Description" />
        {f.kind === 'bible' && <input className="field" value={f.copyright} onChange={(e) => setF({ ...f, copyright: e.target.value })} placeholder="Copyright / licence, e.g. Public domain, or © Bible Society of Ghana, used with permission" aria-label="Copyright" />}
        <label className="block text-xs font-semibold">Price in GH₵ (0 = free, per church)<input className="field mt-1" type="number" min="0" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} aria-label="Item price" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="h-4 w-4 accent-green-600" aria-label="Show in the store" />Show in the store</label>
        {f.kind === 'bible' && <p className="text-xs text-amber-700 dark:text-amber-400">Only upload Bibles you are allowed to share or sell (public domain, or with the publisher’s written permission).</p>}
        <div className="flex gap-2">
          <button onClick={save} disabled={!!busy} className="btn flex-1 bg-green-600 text-white"><Upload size={16} /> {busy || (f.id ? 'Save changes' : 'Upload')}</button>
          {f.id && <button onClick={() => { setF(BLANK); setFile(null); }} className="btn-soft">Cancel</button>}
        </div>
        <Msg m={msg} />
      </section>
      <section className="space-y-2">
        <div className="label">In the store</div>
        {list.data && !list.data.length && <Empty>Nothing yet.</Empty>}
        {list.data?.map((it) => (
          <div key={it.id} className="card flex items-center gap-3 p-3 text-sm">
            {it.thumb ? <img src={it.thumb} alt="" className="h-10 w-16 rounded object-cover" /> : <span className="grid h-10 w-16 place-items-center rounded bg-gold-500/15 text-xs font-bold">{it.abbr || 'BIBLE'}</span>}
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold">{it.title}</div>
              <div className="text-xs text-stone-500">{it.price ? money(it.price, it.currency) : 'Free'} · {it.active ? 'showing' : 'hidden'}{it.file_path ? '' : ' · no file yet!'}</div>
            </div>
            <button onClick={() => { setF({ ...BLANK, ...it, abbr: it.abbr || '', lang: it.lang || '', description: it.description || '', copyright: it.copyright || '' }); setFile(null); window.scrollTo(0, 0); }} className="btn-soft min-h-9 px-3 text-sm">Edit</button>
          </div>
        ))}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------------------------------- codes
function CodesTab() {
  const [f, setF] = useState({ prefix: '', product: 'pro', uses: 1, count: 1, church: '', note: '', expires: '' });
  const [made, setMade] = useState(null);
  const [msg, setMsg] = useState(null);
  const list = useLoad(() => admin('codes'), []);
  const go = async () => {
    setMsg(null);
    try { const r = await admin('createCodes', { ...f, uses: Number(f.uses), count: Number(f.count), expires: f.expires || undefined }); setMade(r.codes); list.reload(); } catch (e) { setMsg({ text: e.message, bad: true }); }
  };
  return (
    <div className="space-y-4">
      <section className="card space-y-2 p-4">
        <div className="label">Make activation codes</div>
        <p className="text-xs text-stone-500 dark:text-stone-400">For bulk deals: each code gives Pro to as many devices as you choose. Churches type it in the Pro sheet.</p>
        <input className="field uppercase" maxLength={12} value={f.prefix} onChange={(e) => setF({ ...f, prefix: e.target.value })} placeholder="Start of the code, e.g. METHODIST" aria-label="Code start" />
        <Seg label="Code kind" value={f.product} onChange={(product) => setF({ ...f, product })} options={[['pro', 'No end date'], ['year', 'One year']]} />
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs font-semibold">Devices per code<input className="field mt-1" type="number" min="1" max="1000" value={f.uses} onChange={(e) => setF({ ...f, uses: e.target.value })} aria-label="Devices per code" /></label>
          <label className="text-xs font-semibold">How many codes<input className="field mt-1" type="number" min="1" max="200" value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} aria-label="How many codes" /></label>
        </div>
        <input className="field" value={f.church} onChange={(e) => setF({ ...f, church: e.target.value })} placeholder="Church / denomination (optional)" aria-label="Code church" />
        <label className="block text-xs font-semibold">Use before (optional)<input className="field mt-1" type="date" value={f.expires} onChange={(e) => setF({ ...f, expires: e.target.value })} aria-label="Use before" /></label>
        <input className="field" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Note, e.g. paid by bank 12/11 (optional)" aria-label="Code note" />
        <button onClick={go} className="btn w-full bg-green-600 text-white"><Ticket size={16} /> Make codes</button>
        <Msg m={msg} />
        {made && <div className="space-y-2 rounded-xl bg-green-600/10 p-3"><pre className="whitespace-pre-wrap font-mono text-sm">{made.join('\n')}</pre><CopyButton text={made.join('\n')} label="Share codes" /></div>}
      </section>
      <section className="card space-y-1 p-4">
        <div className="label mb-1">Codes</div>
        {list.data && !list.data.length && <Empty>No codes yet.</Empty>}
        {list.data?.map((c) => (
          <div key={c.code} className="flex items-center gap-2 border-b border-paper-200 py-1.5 text-sm last:border-0 dark:border-night-700">
            <code className="min-w-0 flex-1 truncate font-bold">{c.code}</code>
            <span className="shrink-0 text-xs text-stone-500">{c.uses_left}/{c.uses_total} left · {PRODUCT[c.product]}{c.church ? ` · ${c.church}` : ''}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------------------------------- settings
function SettingsTab() {
  const s = useLoad(() => admin('settings'), []);
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState(null);
  const withDefaults = (d) => ({ trialDays: 30, pro: [], prices: { pro: 0, year: 0 }, provider: 'paystack', testMode: true, movesPerYear: 2, smsSender: '', dealer: '', momoNumber: '', momoName: '', momoNetwork: '', onlinePay: true, ...d, prices: { pro: 0, year: 0, ...(d?.prices || {}) }, pro: Array.isArray(d?.pro) ? d.pro : [] });
  useEffect(() => { if (s.data) setF(withDefaults(s.data)); }, [s.data]);
  if (!f) return s.error ? <p className="text-sm text-red-600">{s.error}</p> : <Empty>Loading…</Empty>;
  const save = async () => {
    setMsg(null);
    try {
      const next = await admin('saveSettings', { trialDays: Number(f.trialDays), pro: f.pro, prices: { pro: Number(f.prices.pro), year: Number(f.prices.year) }, provider: f.provider, testMode: f.testMode, movesPerYear: Number(f.movesPerYear), smsSender: f.smsSender, dealer: f.dealer, momoNumber: f.momoNumber, momoName: f.momoName, momoNetwork: f.momoNetwork, onlinePay: f.onlinePay });
      setF(withDefaults(next)); setMsg({ text: 'Saved. Phones pick up the changes the next time they go online.' });
    } catch (e) { setMsg({ text: e.message, bad: true }); }
  };
  const toggle = (k) => setF({ ...f, pro: f.pro.includes(k) ? f.pro.filter((x) => x !== k) : [...f.pro, k] });
  return (
    <div className="space-y-4">
      <section className="card space-y-3 p-4">
        <div className="label">Prices (GH₵)</div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs font-semibold">Pro, no end date<input className="field mt-1" type="number" min="0" value={f.prices.pro} onChange={(e) => setF({ ...f, prices: { ...f.prices, pro: e.target.value } })} aria-label="Price Pro" /></label>
          <label className="text-xs font-semibold">Pro, one year<input className="field mt-1" type="number" min="0" value={f.prices.year} onChange={(e) => setF({ ...f, prices: { ...f.prices, year: e.target.value } })} aria-label="Price one year" /></label>
        </div>
        <p className="text-xs text-stone-500 dark:text-stone-400">Set a price to 0 to stop selling that option.</p>
      </section>
      <section className="card space-y-3 p-4">
        <div className="label">Free trial and Pro</div>
        <label className="block text-xs font-semibold">Trial days (0 = no trial)<input className="field mt-1" type="number" min="0" max="365" value={f.trialDays} onChange={(e) => setF({ ...f, trialDays: e.target.value })} aria-label="Trial days" /></label>
        <div className="text-xs font-semibold">Features that need Pro after the trial</div>
        {Object.entries(FEATURES).map(([k, name]) => (
          <label key={k} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={f.pro.includes(k)} onChange={() => toggle(k)} className="mt-0.5 h-4 w-4 accent-green-600" />{name}</label>
        ))}
      </section>
      <section className="card space-y-3 p-4">
        <div className="label">Pay by Mobile Money (Pro requests)</div>
        <p className="text-xs text-stone-500 dark:text-stone-400">Churches see this number in the app, pay you, and send the transaction ID. You approve each request in Requests. Leave the number empty to switch this off.</p>
        <label className="block text-xs font-semibold">Your MoMo number<input className="field mt-1" inputMode="tel" value={f.momoNumber} onChange={(e) => setF({ ...f, momoNumber: e.target.value })} placeholder="e.g. 024 123 4567" aria-label="MoMo number" /></label>
        <label className="block text-xs font-semibold">Name on the MoMo account<input className="field mt-1" value={f.momoName} onChange={(e) => setF({ ...f, momoName: e.target.value })} aria-label="MoMo name" /></label>
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold">Network</span><Seg label="MoMo network" value={f.momoNetwork} onChange={(momoNetwork) => setF({ ...f, momoNetwork })} options={[['MTN', 'MTN'], ['Telecel', 'Telecel'], ['AirtelTigo', 'AirtelTigo']]} /></div>
      </section>
      <section className="card space-y-3 p-4">
        <div className="label">Online payments (Paystack / Hubtel)</div>
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold">Show in the app</span><Seg label="Online payments" value={f.onlinePay} onChange={(onlinePay) => setF({ ...f, onlinePay })} options={[[true, 'Show'], [false, 'Hide']]} /></div>
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold">Provider</span><Seg label="Payment provider" value={f.provider} onChange={(provider) => setF({ ...f, provider })} options={[['paystack', 'Paystack'], ['hubtel', 'Hubtel']]} /></div>
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold">Test mode</span><Seg label="Test mode" value={f.testMode} onChange={(testMode) => setF({ ...f, testMode })} options={[[true, 'On (no money)'], [false, 'Off (real money)']]} /></div>
        {!f.testMode && <p className="text-xs text-amber-700 dark:text-amber-400">Real payments need the provider's keys saved on the server ({f.provider === 'paystack' ? 'PAYSTACK_SECRET_KEY' : 'HUBTEL_API_ID, HUBTEL_API_KEY, HUBTEL_POS_SALES_ID'}). If they are missing, buying shows an error.</p>}
      </section>
      <section className="card space-y-3 p-4">
        <div className="label">Restoring and help</div>
        <label className="block text-xs font-semibold">Self-service moves per year<input className="field mt-1" type="number" min="0" max="12" value={f.movesPerYear} onChange={(e) => setF({ ...f, movesPerYear: e.target.value })} aria-label="Moves per year" /></label>
        <label className="block text-xs font-semibold">SMS sender ID (registered with mNotify)<input className="field mt-1" value={f.smsSender} onChange={(e) => setF({ ...f, smsSender: e.target.value })} aria-label="SMS sender" /></label>
        <label className="block text-xs font-semibold">Help line shown in the app<input className="field mt-1" value={f.dealer} onChange={(e) => setF({ ...f, dealer: e.target.value })} placeholder="e.g. WhatsApp 024 000 0000" aria-label="Help line" /></label>
      </section>
      <button onClick={save} className="btn w-full bg-green-600 text-white">Save settings</button>
      <Msg m={msg} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------- shell
const TABS = [['home', 'Home', Home], ['requests', 'Requests', Inbox], ['store', 'Store', ShoppingBag], ['licences', 'Licences', KeyRound], ['codes', 'Codes', Ticket], ['settings', 'Settings', Settings]];

export default function AdminApp() {
  const [session, setSession] = useState(undefined);
  const [claim, setClaim] = useState({ ok: false, error: '' });
  const [tab, setTab] = useState('home');
  const [waiting, setWaiting] = useState(0);
  const countWaiting = useCallback(() => admin('overview').then((o) => setWaiting(o.pending_requests || 0)).catch(() => {}), []);
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('osoree-admin-theme') !== 'light'; } catch { return true; } });
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); try { localStorage.setItem('osoree-admin-theme', dark ? 'dark' : 'light'); } catch { /* ignore */ } }, [dark]);
  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session) return;
    admin('claim').then(() => { setClaim({ ok: true, error: '' }); countWaiting(); }).catch((e) => setClaim({ ok: false, error: e.message }));
  }, [session, countWaiting]);
  useEffect(() => {
    if (!claim.ok) return undefined;
    const t = setInterval(countWaiting, 60000);
    return () => clearInterval(t);
  }, [claim.ok, countWaiting]);
  if (session === undefined) return <Empty>Opening…</Empty>;
  if (!session) return <SignIn onIn={() => {}} />;
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <header className="flex items-center gap-2 px-4 pb-2 pt-[max(.75rem,env(safe-area-inset-top))]">
        <h1 className="mr-auto text-lg font-bold">Ɔsɔreɛ <span className="text-gold-500">Plus</span> <span className="text-green-600">Admin</span></h1>
        <button onClick={() => setDark(!dark)} aria-label="Switch theme" className="icon-btn">{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
        <button onClick={() => sb.auth.signOut()} aria-label="Sign out" className="icon-btn"><LogOut size={18} /></button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {!claim.ok ? (claim.error ? <p className="rounded-xl bg-red-600/10 p-3 text-sm text-red-700 dark:text-red-400">{claim.error}</p> : <Empty>Checking your account…</Empty>) : (
          <>
            {tab === 'home' && <HomeTab go={setTab} onCount={setWaiting} />}
            {tab === 'requests' && <RequestsTab onChange={countWaiting} />}
            {tab === 'store' && <StoreTab />}
            {tab === 'licences' && <LicencesTab />}
            {tab === 'codes' && <CodesTab />}
            {tab === 'settings' && <SettingsTab />}
          </>
        )}
      </main>
      {claim.ok && (
        <nav className="grid grid-cols-6 border-t border-paper-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-night-700 dark:bg-night-900">
          {TABS.map(([id, label, Icon]) => (
            <button key={id} onClick={() => setTab(id)} className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${tab === id ? 'text-green-600' : 'text-stone-500 dark:text-stone-400'}`}><span className="relative"><Icon size={20} />{id === 'requests' && waiting > 0 && <span className="absolute -right-2.5 -top-1.5 min-w-4 rounded-full bg-red-600 px-1 text-[10px] leading-4 text-white">{waiting}</span>}</span>{label}</button>
          ))}
        </nav>
      )}
    </div>
  );
}
