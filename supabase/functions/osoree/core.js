// Ɔsɔreɛ Plus licence server: the rules, free of any one runtime so they run in the Supabase Edge Function
// (index.ts) and in the tests on a computer (tests/server-licences.mjs).
//
// deps = {
//   query(sql, params) -> rows        Postgres
//   now() -> Date
//   sign(payload) -> 'OSP1....'        signs a licence with the private key
//   fetch                              to call Paystack, Hubtel and the SMS service
//   env(name) -> string                secrets: PAYSTACK_SECRET_KEY, HUBTEL_*, MNOTIFY_KEY, WEBHOOK_SECRET, FN_URL
//   random(n) -> string                n random characters from the code alphabet
//   sha256(text) -> hex
// }

export const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const DEVICE = /^OSR(-[2-9A-HJ-NP-Z]{4}){3}$/;
const PRODUCTS = { pro: 'Ɔsɔreɛ Plus Pro (this device, no end date)', year: 'Ɔsɔreɛ Plus Pro for one year (this device)' };
const YEAR_MS = 365.25 * 864e5;

export class Fail extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const need = (cond, msg, status) => { if (!cond) throw new Fail(msg, status); };
const phoneOf = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 9 ? '0' + d.slice(-9) : ''; };

export async function settings(d) {
  const [row] = await d.query('select data from settings where id = 1');
  let data = row?.data || {};
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = {}; } } // saved double-encoded by an older version
  return data;
}

// What the app may know: prices, which features are Pro, trial length, who to call.
const publicConfig = (s) => ({ trialDays: s.trialDays, pro: s.pro, currency: s.currency, prices: s.prices, provider: s.testMode ? 'test' : s.provider, dealer: s.dealer || '', products: PRODUCTS,
  onlinePay: s.onlinePay !== false, momo: s.momoNumber ? { number: s.momoNumber, name: s.momoName || '', network: s.momoNetwork || '' } : null });

async function issue(d, { device, product, church, phone, source, sourceRef }) {
  need(PRODUCTS[product], 'Unknown product.');
  const now = d.now();
  const id = 'L' + d.random(10);
  const expires = product === 'year' ? new Date(now.getTime() + YEAR_MS) : null;
  const payload = { v: 1, d: device, p: 'pro', i: Math.floor(now / 1000), e: expires ? Math.floor(expires / 1000) : 0, n: id };
  if (church) payload.c = church;
  if (phone) payload.ph = phone;
  const token = await d.sign(payload);
  await d.query('insert into licences (id, device_code, product, expires_at, church, phone, source, source_ref, token) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id, device, product, expires, church || null, phone || null, source, sourceRef || null, token]);
  return { id, token, expires };
}

async function activeLicence(d, device) {
  const [l] = await d.query("select * from licences where device_code = $1 and status = 'active' and (expires_at is null or expires_at > $2) order by expires_at desc nulls first, created_at desc limit 1", [device, d.now()]);
  return l || null;
}

// ------------------------------------------------------------------------------------------------- app

/** The app says hello when it has internet: the server remembers when this device first appeared (the trial). */
async function hello(d, { device, platform, version, licenceIds = [] }) {
  need(DEVICE.test(device || ''), 'Bad device code.');
  const rows = await d.query(`insert into devices (code, platform, version) values ($1, $2, $3)
    on conflict (code) do update set last_seen = now(), platform = excluded.platform, version = excluded.version returning first_seen`, [device, platform || null, version || null]);
  const s = await settings(d);
  const l = await activeLicence(d, device);
  // Licences on this phone that were revoked or moved elsewhere are no longer valid.
  const ids = (Array.isArray(licenceIds) ? licenceIds : []).filter((x) => typeof x === 'string').slice(0, 10);
  const dead = ids.length ? (await d.query("select id from licences where id = any($1) and status <> 'active'", [ids])).map((r) => r.id) : [];
  return { trialStart: Math.floor(new Date(rows[0].first_seen) / 1000), licence: l?.token || null, revoked: dead, config: publicConfig(s) };
}

/** Starts a payment and returns where to pay (Paystack or Hubtel checkout page; a test page in test mode). */
async function buy(d, { device, product, phone, email, church }) {
  need(DEVICE.test(device || ''), 'Bad device code.');
  need(PRODUCTS[product], 'Choose Pro or Pro for one year.');
  const ph = phoneOf(phone);
  need(ph, 'Enter the phone number to link to this purchase (for restoring it later).');
  const s = await settings(d);
  const amount = Number(s.prices?.[product]);
  need(amount > 0, 'This product is not on sale yet.');
  const provider = s.testMode ? 'test' : s.provider;
  const id = 'P' + d.random(12);
  await d.query('insert into payments (id, device_code, product, amount, currency, phone, email, church, provider) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id, device, product, amount, s.currency || 'GHS', ph, email || null, church || null, provider]);
  const fn = d.env('FN_URL');
  const done = `${fn}/done?ref=${id}`;
  let url;
  if (provider === 'test') {
    url = `${fn}/test-pay?ref=${id}`;
  } else if (provider === 'paystack') {
    const r = await d.fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST', headers: { Authorization: `Bearer ${d.env('PAYSTACK_SECRET_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email || `${ph}@osoree.app`, amount: Math.round(amount * 100), currency: s.currency || 'GHS', reference: id, channels: ['mobile_money', 'card'], callback_url: done, metadata: { device, product } }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.status) { await fail(d, id, j.message || 'Paystack refused'); throw new Fail(j.message || 'Paystack could not start the payment.', 502); }
    url = j.data.authorization_url;
  } else if (provider === 'hubtel') {
    const r = await d.fetch('https://payproxyapi.hubtel.com/items/initiate', {
      method: 'POST', headers: { Authorization: `Basic ${btoa(`${d.env('HUBTEL_API_ID')}:${d.env('HUBTEL_API_KEY')}`)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ totalAmount: amount, description: PRODUCTS[product], callbackUrl: `${fn}/webhook?p=hubtel&k=${d.env('WEBHOOK_SECRET')}`, returnUrl: done, cancellationUrl: done, merchantAccountNumber: d.env('HUBTEL_POS_SALES_ID'), clientReference: id }),
    });
    const j = await r.json().catch(() => ({}));
    const checkout = j.data?.checkoutUrl || j.Data?.CheckoutUrl;
    if (!r.ok || !checkout) { await fail(d, id, j.message || j.Message || 'Hubtel refused'); throw new Fail(j.message || j.Message || 'Hubtel could not start the payment.', 502); }
    url = checkout;
  } else throw new Fail('No payment provider is set up.', 503);
  return { ref: id, url, amount, currency: s.currency || 'GHS' };
}

async function fail(d, id, error) { await d.query("update payments set status = 'failed', error = $2 where id = $1 and status = 'pending'", [id, String(error).slice(0, 300)]); }

/** Marks a payment paid (once) and issues its licence. Returns the licence token. */
async function settle(d, id, providerRef) {
  const claimed = await d.query("update payments set status = 'paid', paid_at = now(), provider_ref = $2 where id = $1 and status = 'pending' returning *", [id, providerRef || null]);
  if (!claimed.length) {
    const [p] = await d.query('select p.status, l.token from payments p left join licences l on l.id = p.licence_id where p.id = $1', [id]);
    return p?.token || null; // already settled (webhook and app both asked)
  }
  const p = claimed[0];
  const lic = await issue(d, { device: p.device_code, product: p.product, church: p.church, phone: p.phone, source: 'payment', sourceRef: p.id });
  await d.query('update payments set licence_id = $2 where id = $1', [id, lic.id]);
  return lic.token;
}

/** Asks the provider whether a pending payment went through (used by the app while it waits). */
async function verify(d, p) {
  if (p.provider === 'paystack') {
    const r = await d.fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(p.id)}`, { headers: { Authorization: `Bearer ${d.env('PAYSTACK_SECRET_KEY')}` } });
    const j = await r.json().catch(() => ({}));
    const t = j.data || {};
    if (t.status === 'success' && Math.round(t.amount) === Math.round(Number(p.amount) * 100) && t.currency === p.currency) return settle(d, p.id, String(t.id));
    if (t.status === 'failed' || t.status === 'abandoned') await fail(d, p.id, t.gateway_response || t.status);
  } else if (p.provider === 'hubtel') {
    const r = await d.fetch(`https://api-txnstatus.hubtel.com/transactions/${d.env('HUBTEL_POS_SALES_ID')}/status?clientReference=${encodeURIComponent(p.id)}`, { headers: { Authorization: `Basic ${btoa(`${d.env('HUBTEL_API_ID')}:${d.env('HUBTEL_API_KEY')}`)}` } });
    const j = await r.json().catch(() => ({}));
    const st = String(j.data?.status || j.Data?.Status || '').toLowerCase();
    const amt = Number(j.data?.amount ?? j.Data?.Amount ?? 0);
    if (st === 'paid' && Math.abs(amt - Number(p.amount)) < 0.01) return settle(d, p.id, j.data?.transactionId || null);
    if (st === 'failed') await fail(d, p.id, 'Hubtel: failed');
  }
  return null;
}

async function buyStatus(d, { ref }) {
  const [p] = await d.query('select p.*, l.token from payments p left join licences l on l.id = p.licence_id where p.id = $1', [String(ref || '')]);
  need(p, 'Payment not found.', 404);
  if (p.status === 'pending') {
    const token = await verify(d, p);
    if (token) return { status: 'paid', licence: token };
    const [again] = await d.query('select status, error from payments where id = $1', [p.id]);
    return { status: again.status, error: again.error || undefined };
  }
  return { status: p.status, licence: p.token || undefined, error: p.error || undefined };
}

/** Provider calls. Paystack signs its webhooks; Hubtel's are re-checked with Hubtel before anything is accepted. */
async function webhook(d, { p, k, raw, signature, hmac }) {
  if (p === 'paystack') {
    need(signature && (await hmac(raw)) === signature, 'bad signature', 401);
    const ev = JSON.parse(raw);
    if (ev.event === 'charge.success') {
      const [pay] = await d.query("select * from payments where id = $1 and status = 'pending'", [ev.data?.reference]);
      if (pay && Math.round(ev.data.amount) === Math.round(Number(pay.amount) * 100) && ev.data.currency === pay.currency) await settle(d, pay.id, String(ev.data.id));
    }
    return { ok: true };
  }
  if (p === 'hubtel') {
    need(k && k === d.env('WEBHOOK_SECRET'), 'forbidden', 403);
    const ev = JSON.parse(raw || '{}');
    const ref = (ev.Data || ev.data || {}).ClientReference || (ev.Data || ev.data || {}).clientReference;
    const [pay] = await d.query("select * from payments where id = $1 and status = 'pending'", [ref]);
    if (pay) await verify(d, pay);
    return { ok: true };
  }
  throw new Fail('unknown provider');
}

/** Test mode only: the "payment page" simply marks the payment paid. */
async function testPay(d, { ref }) {
  const s = await settings(d);
  need(s.testMode, 'Test payments are switched off.', 403);
  const [p] = await d.query("select * from payments where id = $1 and provider = 'test'", [ref]);
  need(p, 'Payment not found.', 404);
  await settle(d, p.id, 'test');
  return { ok: true };
}

/** An activation code (bulk deals, denominations, gifts): one licence per use, for this device. */
async function redeem(d, { device, code }) {
  need(DEVICE.test(device || ''), 'Bad device code.');
  const c = String(code || '').trim().toUpperCase().replace(/\s+/g, '');
  need(c.length >= 6, 'Type the activation code.');
  const already = await d.query("select token from licences where device_code = $1 and source = 'code' and source_ref = $2 and status = 'active'", [device, c]);
  if (already.length) return { licence: already[0].token };
  const taken = await d.query('update activation_codes set uses_left = uses_left - 1 where code = $1 and uses_left > 0 and (expires_at is null or expires_at > $2) returning *', [c, d.now()]);
  if (!taken.length) {
    const [x] = await d.query('select uses_left, expires_at from activation_codes where code = $1', [c]);
    throw new Fail(!x ? 'This activation code is not valid.' : x.uses_left <= 0 ? 'This activation code has already been used on all its devices.' : 'This activation code has expired.');
  }
  const lic = await issue(d, { device, product: taken[0].product, church: taken[0].church, source: 'code', sourceRef: c });
  return { licence: lic.token };
}

/** Restore step 1: an SMS code to the phone number given when paying. */
async function restoreStart(d, { phone }) {
  const ph = phoneOf(phone);
  need(ph, 'Enter the phone number used when paying.');
  const has = await d.query("select 1 from licences where phone = $1 and status = 'active' limit 1", [ph]);
  need(has.length, 'No Pro purchase was found for this phone number. Check the number, or contact your dealer.', 404);
  const key = d.env('MNOTIFY_KEY');
  need(key, 'Restoring by SMS is not set up yet. Contact your dealer to move your licence.', 503);
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await d.query('insert into restore_codes (phone, code_hash, attempts, expires_at) values ($1, $2, 0, $3) on conflict (phone) do update set code_hash = excluded.code_hash, attempts = 0, expires_at = excluded.expires_at',
    [ph, await d.sha256(ph + ':' + code), new Date(d.now().getTime() + 10 * 6e4)]);
  const s = await settings(d);
  const r = await d.fetch(`https://api.mnotify.com/api/sms/quick?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: [ph], sender: s.smsSender || 'Osoree', message: `Your Ɔsɔreɛ Plus restore code is ${code}. It expires in 10 minutes.`, is_schedule: false, schedule_date: '' }),
  });
  // mNotify answers 200 even when it refuses (no credit, sender ID not approved): read its status.
  const j = await r.json().catch(() => ({}));
  const sentOk = r.ok && (!j.status || j.status === 'success') && (!j.code || String(j.code) === '2000');
  await d.query('insert into sms_log (phone, ok, reply) values ($1, $2, $3)', [ph, sentOk, `${r.status || ''} ${JSON.stringify(j).slice(0, 500)}`]).catch(() => {});
  if (!sentOk) {
    await d.query('delete from restore_codes where phone = $1', [ph]);
    throw new Fail('The SMS could not be sent. Try again later, or contact your dealer.', 502);
  }
  return { sent: true };
}

/** Restore step 2: the code moves the newest active licence on that phone number to this device. */
async function restoreFinish(d, { phone, code, device }) {
  need(DEVICE.test(device || ''), 'Bad device code.');
  const ph = phoneOf(phone);
  const [rc] = await d.query('select * from restore_codes where phone = $1', [ph]);
  need(rc && new Date(rc.expires_at) > d.now(), 'The code has expired. Ask for a new one.');
  need(rc.attempts < 5, 'Too many wrong codes. Ask for a new one.');
  if ((await d.sha256(ph + ':' + String(code || '').trim())) !== rc.code_hash) {
    await d.query('update restore_codes set attempts = attempts + 1 where phone = $1', [ph]);
    throw new Fail('That code is not right.');
  }
  await d.query('delete from restore_codes where phone = $1', [ph]);
  return move(d, { phone: ph, device, selfService: true });
}

async function move(d, { id, phone, device, selfService }) {
  const [l] = id
    ? await d.query("select * from licences where id = $1 and status = 'active'", [id])
    : await d.query("select * from licences where phone = $1 and status = 'active' and (expires_at is null or expires_at > $2) order by created_at desc limit 1", [phone, d.now()]);
  need(l, 'No active licence to move.', 404);
  if (l.device_code === device) return { licence: l.token };
  if (selfService) {
    const s = await settings(d);
    const [m] = await d.query("select count(*)::int n from licences where phone = $1 and source = 'restore' and created_at > $2", [l.phone, new Date(d.now().getTime() - YEAR_MS)]);
    need(m.n < (s.movesPerYear ?? 2), 'This licence has been moved too many times this year. Contact your dealer.', 429);
  }
  await d.query("update licences set status = 'moved' where id = $1", [l.id]);
  // The new licence keeps the same end date.
  const now = d.now();
  const nid = 'L' + d.random(10);
  const payload = { v: 1, d: device, p: 'pro', i: Math.floor(now / 1000), e: l.expires_at ? Math.floor(new Date(l.expires_at) / 1000) : 0, n: nid };
  if (l.church) payload.c = l.church;
  if (l.phone) payload.ph = l.phone;
  const token = await d.sign(payload);
  await d.query('insert into licences (id, device_code, product, expires_at, church, phone, source, source_ref, token) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [nid, device, l.product, l.expires_at, l.church, l.phone, selfService ? 'restore' : 'admin', l.id, token]);
  return { licence: token, moved: l.device_code };
}

// ----------------------------------------------------------------------------------------------- admin

async function isAdmin(d, user) { return !!user && (await d.query('select 1 from admins where user_id = $1', [user.id])).length > 0; }

const ADMIN = {
  // The first sign-in with the Super Admin e-mail (a server secret) becomes the Super Admin.
  async claim(d, _b, user) {
    need(user, 'Sign in first.', 401);
    const [{ n }] = await d.query('select count(*)::int n from admins');
    if (n > 0) { need(await isAdmin(d, user), 'This account is not the Super Admin.', 403); return { ok: true }; }
    need(String(user.email || '').toLowerCase() === d.env('SUPER_ADMIN_EMAIL').toLowerCase(), 'Only the Super Admin e-mail can set up this server.', 403);
    need(user.email_confirmed_at, 'Confirm this e-mail address first: tap the link in the e-mail.', 403);
    await d.query('insert into admins (user_id, email) values ($1, $2)', [user.id, user.email]);
    return { ok: true, first: true };
  },
  async settings(d) { return settings(d); },
  async saveSettings(d, b) {
    const cur = await settings(d);
    const next = { ...cur };
    if (b.trialDays != null) { need(Number.isInteger(b.trialDays) && b.trialDays >= 0 && b.trialDays <= 365, 'Trial: 0 to 365 days.'); next.trialDays = b.trialDays; }
    if (b.pro) { need(Array.isArray(b.pro) && b.pro.every((f) => ['stream', 'live', 'wifi', 'docs', 'watermark', 'backup'].includes(f)), 'Unknown feature.'); next.pro = b.pro; }
    if (b.prices) { for (const [k, v] of Object.entries(b.prices)) need(PRODUCTS[k] && Number(v) >= 0 && Number(v) < 100000, 'Bad price.'); next.prices = { ...cur.prices, ...Object.fromEntries(Object.entries(b.prices).map(([k, v]) => [k, Number(v)])) }; }
    if (b.provider) { need(['paystack', 'hubtel'].includes(b.provider), 'Provider: paystack or hubtel.'); next.provider = b.provider; }
    if (b.testMode != null) next.testMode = !!b.testMode;
    if (b.movesPerYear != null) { need(Number.isInteger(b.movesPerYear) && b.movesPerYear >= 0 && b.movesPerYear <= 12, 'Moves: 0 to 12 a year.'); next.movesPerYear = b.movesPerYear; }
    if (b.smsSender != null) { need(/^[A-Za-z0-9 ]{3,11}$/.test(b.smsSender), 'SMS sender: 3 to 11 letters or digits.'); next.smsSender = b.smsSender; }
    if (b.dealer != null) next.dealer = String(b.dealer).slice(0, 120);
    if (b.momoNumber != null) { const n = String(b.momoNumber).trim(); need(!n || phoneOf(n), 'MoMo number: a Ghana phone number, e.g. 024 123 4567.'); next.momoNumber = n ? phoneOf(n) : ''; }
    if (b.momoName != null) next.momoName = String(b.momoName).trim().slice(0, 60);
    if (b.momoNetwork != null) { need(['', 'MTN', 'Telecel', 'AirtelTigo'].includes(b.momoNetwork), 'Network: MTN, Telecel or AirtelTigo.'); next.momoNetwork = b.momoNetwork; }
    if (b.onlinePay != null) next.onlinePay = !!b.onlinePay;
    await d.query('update settings set data = $1::text::jsonb, updated_at = now() where id = 1', [JSON.stringify(next)]);
    return next;
  },
  async overview(d) {
    const [x] = await d.query(`select
      (select count(*)::int from devices) devices,
      (select count(*)::int from devices where last_seen > now() - interval '30 days') active30,
      (select count(*)::int from licences where status = 'active' and (expires_at is null or expires_at > now())) licences,
      (select coalesce(sum(amount), 0)::float from payments where status = 'paid' and provider <> 'test') revenue,
      (select coalesce(sum(amount), 0)::float from payments where status = 'paid' and provider <> 'test' and paid_at > date_trunc('month', now())) revenue_month,
      (select count(*)::int from payments where status = 'paid' and provider = 'test') test_sales,
      (select count(*)::int from licence_requests where status = 'pending') pending_requests,
      (select coalesce(sum(amount), 0)::float from licence_requests where status = 'approved') momo_revenue,
      (select coalesce(sum(amount), 0)::float from licence_requests where status = 'approved' and decided_at > date_trunc('month', now())) momo_revenue_month`);
    return x;
  },
  async payments(d, b) { return d.query('select * from payments order by created_at desc limit $1', [Math.min(500, b.limit || 100)]); },
  async licences(d, b) {
    const q = String(b.q || '').trim();
    return q ? d.query("select * from licences where device_code ilike $1 or phone ilike $1 or church ilike $1 or id = $2 order by created_at desc limit 200", [`%${q}%`, q])
      : d.query('select * from licences order by created_at desc limit 200');
  },
  async devices(d) { return d.query('select * from devices order by last_seen desc limit 300'); },
  async issue(d, b) {
    need(DEVICE.test(b.device || ''), 'Bad device code.');
    const lic = await issue(d, { device: b.device, product: b.product || 'pro', church: b.church, phone: phoneOf(b.phone) || null, source: 'admin', sourceRef: b.note || null });
    return { licence: lic.token, id: lic.id };
  },
  async revoke(d, b) { await d.query("update licences set status = 'revoked' where id = $1", [b.id]); return { ok: true }; },
  async move(d, b) { need(DEVICE.test(b.device || ''), 'Bad device code.'); return move(d, { id: b.id, device: b.device }); },
  async createCodes(d, b) {
    need(PRODUCTS[b.product], 'Choose a product.');
    const count = Math.min(200, Math.max(1, b.count || 1)), uses = Math.min(1000, Math.max(1, b.uses || 1));
    const prefix = String(b.prefix || 'OSP').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'OSP';
    const out = [];
    for (let i = 0; i < count; i++) {
      const code = `${prefix}-${d.random(4)}-${d.random(4)}`;
      await d.query('insert into activation_codes (code, product, uses_total, uses_left, church, note, expires_at) values ($1,$2,$3,$3,$4,$5,$6)', [code, b.product, uses, b.church || null, b.note || null, b.expires ? new Date(b.expires) : null]);
      out.push(code);
    }
    return { codes: out };
  },
  async codes(d) { return d.query('select * from activation_codes order by created_at desc limit 300'); },
  async requests(d, b) {
    const st = ['pending', 'approved', 'declined'].includes(b.status) ? b.status : null;
    const rows = st ? await d.query('select * from licence_requests where status = $1 order by created_at desc limit 200', [st])
      : await d.query("select * from licence_requests where status <> 'replaced' order by created_at desc limit 200");
    return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
  },
  async approveRequest(d, b) {
    const [r] = await d.query('select * from licence_requests where id = $1', [b.id]);
    need(r, 'Request not found.', 404);
    need(r.status === 'pending', `This request is already ${r.status}.`);
    const lic = await issue(d, { device: r.device_code, product: r.product, church: r.church, phone: r.phone, source: 'request', sourceRef: r.id });
    await d.query("update licence_requests set status = 'approved', licence_id = $2, decided_at = now() where id = $1", [r.id, lic.id]);
    return { ok: true, licence: lic.token, id: lic.id };
  },
  async declineRequest(d, b) {
    const [r] = await d.query('select status from licence_requests where id = $1', [b.id]);
    need(r, 'Request not found.', 404);
    need(r.status === 'pending', `This request is already ${r.status}.`);
    await d.query("update licence_requests set status = 'declined', reason = $2, decided_at = now() where id = $1", [b.id, String(b.reason || '').trim().slice(0, 200) || null]);
    return { ok: true };
  },
  async smsLog(d) { return d.query('select phone, ok, reply, created_at from sms_log order by id desc limit 50'); },
  async recent(d) {
    return {
      payments: await d.query("select id, device_code, product, amount, currency, phone, church, provider, status, created_at, paid_at from payments order by created_at desc limit 20"),
      smsProblems: await d.query('select phone, reply, created_at from sms_log where not ok order by id desc limit 5'),
    };
  },
};

// ----------------------------------------------------------------------------------------------- licence requests

/** A church that paid by Mobile Money asks for Pro; the Super Admin approves it in the admin app. */
async function request(d, { device, product, phone, church, momoRef, note }) {
  need(DEVICE.test(device || ''), 'Bad device code.');
  need(PRODUCTS[product], 'Choose Pro or Pro for one year.');
  const ph = phoneOf(phone);
  need(ph, 'Enter the phone number you paid from.');
  const ref = String(momoRef || '').trim();
  need(ref.length >= 4 && ref.length <= 40, 'Enter the MoMo transaction ID from the payment message.');
  const s = await settings(d);
  const amount = Number(s.prices?.[product]);
  need(amount > 0, 'This product is not on sale yet.');
  const recent = await d.query("select count(*)::int n from licence_requests where device_code = $1 and created_at > now() - interval '1 day'", [device]);
  need(recent[0].n < 10, 'Too many requests today. Call the help line.', 429);
  await d.query("update licence_requests set status = 'replaced', decided_at = now() where device_code = $1 and status = 'pending'", [device]);
  const id = 'R' + d.random(10);
  await d.query('insert into licence_requests (id, device_code, product, amount, currency, phone, church, momo_ref, note) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id, device, product, amount, s.currency || 'GHS', ph, String(church || '').trim().slice(0, 80) || null, ref, String(note || '').trim().slice(0, 200) || null]);
  return { id, status: 'pending' };
}

/** The newest request from this device, and its licence once approved. */
async function requestStatus(d, { device }) {
  need(DEVICE.test(device || ''), 'Bad device code.');
  const [r] = await d.query('select id, product, amount, currency, momo_ref, status, reason, created_at from licence_requests where device_code = $1 order by created_at desc limit 1', [device]);
  if (!r) return { status: 'none' };
  const l = r.status === 'approved' ? await activeLicence(d, device) : null;
  return { ...r, amount: Number(r.amount), licence: l?.token || null };
}

/** One entry point: route, body, the signed-in user (admin routes) and the raw request bits (webhooks). */
export async function handle(d, route, body = {}, extra = {}) {
  switch (route) {
    case 'config': return publicConfig(await settings(d));
    case 'hello': return hello(d, body);
    case 'buy': return buy(d, body);
    case 'buy-status': return buyStatus(d, body);
    case 'redeem': return redeem(d, body);
    case 'restore-start': return restoreStart(d, body);
    case 'restore-finish': return restoreFinish(d, body);
    case 'webhook': return webhook(d, extra);
    case 'test-pay': return testPay(d, body);
    case 'request': return request(d, body);
    case 'request-status': return requestStatus(d, body);
    default: {
      const m = /^admin\/(\w+)$/.exec(route);
      if (m && ADMIN[m[1]]) {
        if (m[1] !== 'claim') need(await isAdmin(d, extra.user), 'Super Admin only.', 403);
        return ADMIN[m[1]](d, body, extra.user);
      }
      throw new Fail('Not found.', 404);
    }
  }
}
