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
/**
 * Ghana or abroad. The internet address (ipinfo.io) and, on Android, the SIM card must both say Ghana for Ghana
 * prices; without an address lookup the phone's own SIM/region/time zone decide.
 */
export function regionOf({ ipCountry, sim, timezone }) {
  const up = (x) => String(x || '').toUpperCase();
  if (ipCountry) return up(ipCountry) === 'GH' && (!sim || up(sim) === 'GH') ? 'GH' : 'INTL';
  // No address lookup: the SIM card, then the time zone. (Not the language setting: many phones in Ghana use "English (US)".)
  if (sim) return up(sim) === 'GH' ? 'GH' : 'INTL';
  if (timezone) return timezone === 'Africa/Accra' ? 'GH' : 'INTL';
  return 'GH'; // nothing known (older app versions): Ghana, the home market
}
async function regionFor(d, extra, b) {
  let ipCountry = '';
  try { if (d.geo && extra?.ip) ipCountry = (await d.geo(extra.ip)) || ''; } catch { /* lookup down: phone decides */ }
  return { region: regionOf({ ipCountry, sim: b.sim, country: b.country, timezone: b.timezone }), ipCountry };
}
const support = (s) => ({ help: s.dealer || '', email: s.supportEmail || '', whatsapp: s.supportWhatsapp || '' });
const publicConfig = (s, region = 'GH') => (region !== 'GH' ? {
  // Abroad: US dollars and card only (never the Ghana prices, never MoMo).
  support: support(s), trialDays: s.trialDays, pro: s.pro, region, currency: 'USD', prices: s.pricesUSD || { pro: 0, year: 0 },
  provider: s.testMode ? 'test' : 'paystack', dealer: s.dealer || '', products: PRODUCTS, onlinePay: true, momo: null,
} : { region: 'GH', support: support(s), trialDays: s.trialDays, pro: s.pro, currency: s.currency, prices: s.prices, provider: s.testMode ? 'test' : s.provider, dealer: s.dealer || '', products: PRODUCTS,
  onlinePay: s.onlinePay !== false, momo: s.momoNumber ? { number: s.momoNumber, name: s.momoName || '', network: s.momoNetwork || '' } : null });

async function issue(d, { device, product, church, phone, source, sourceRef, until }) {
  need(PRODUCTS[product], 'Unknown product.');
  const now = d.now();
  const id = 'L' + d.random(10);
  const expires = product === 'year' ? (until || new Date(now.getTime() + YEAR_MS)) : null;
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
const clip = (x, n) => (x == null ? null : String(x).slice(0, n));
const vnum = (v) => String(v || '0').split('.').map((x) => parseInt(x, 10) || 0).reduce((a, x) => a * 1000 + x, 0);
/** The newest release for this platform, if it is newer than what the device runs. */
async function updateFor(d, platform, version) {
  const p = platform === 'web' ? null : platform;
  if (!p) return null;
  const rows = await d.query('select version, required, notes, url, created_at from releases where platform = $1 order by created_at desc limit 20', [p]);
  const newer = rows.filter((r) => vnum(r.version) > vnum(version));
  if (!newer.length) return null;
  const latest = newer.reduce((a, r) => (vnum(r.version) > vnum(a.version) ? r : a));
  return { version: latest.version, required: newer.some((r) => r.required), notes: latest.notes || '', url: latest.url || '' };
}

async function hello(d, { device, platform, version, licenceIds = [], model, os, country, timezone, features, sim }, extra = {}) {
  need(DEVICE.test(device || ''), 'Bad device code.');
  const rows = await d.query(`insert into devices (code, platform, version, model, os, country, timezone) values ($1, $2, $3, $4, $5, $6, $7)
    on conflict (code) do update set last_seen = now(), platform = excluded.platform, version = excluded.version,
      model = coalesce(excluded.model, devices.model), os = coalesce(excluded.os, devices.os),
      country = coalesce(excluded.country, devices.country), timezone = coalesce(excluded.timezone, devices.timezone)
    returning first_seen, blocked, block_reason, block_kind`,
    [device, clip(platform, 20), clip(version, 20), clip(model, 80), clip(os, 60), clip(country, 8), clip(timezone, 60)]);
  // Feature use since the last check-in: { listen: 2, stream: 1 } is added to the device's totals.
  if (features && typeof features === 'object') {
    const clean = Object.fromEntries(Object.entries(features).filter(([k, v]) => /^[a-z]{2,20}$/.test(k) && Number.isInteger(v) && v > 0 && v < 10000).slice(0, 20));
    if (Object.keys(clean).length) {
      await d.query(`update devices set features = (select coalesce(jsonb_object_agg(k, to_jsonb(coalesce((features->>k)::int, 0) + coalesce((($2::text)::jsonb->>k)::int, 0))), '{}'::jsonb)
        from (select jsonb_object_keys(features) k union select jsonb_object_keys(($2::text)::jsonb)) keys) where code = $1`, [device, JSON.stringify(clean)]);
    }
  }
  const s = await settings(d);
  const { region, ipCountry } = await regionFor(d, extra, { sim, country, timezone });
  await d.query('update devices set ip_country = coalesce($2, ip_country), sim_country = coalesce($3, sim_country) where code = $1', [device, ipCountry || null, clip(sim, 4) || null]);
  let blocked = rows[0].blocked;
  let l = await activeLicence(d, device);
  // Blocked because the trial ended, and now the device has Pro: it unblocks by itself.
  if (blocked && rows[0].block_kind === 'trial' && l) { await d.query('update devices set blocked = false, block_reason = null, block_kind = null, blocked_at = null where code = $1', [device]); blocked = false; }
  const block = blocked ? { reason: rows[0].block_reason || '', kind: rows[0].block_kind || 'admin', ...support(s) } : null;
  if (block) l = null;
  // Licences on this phone that were revoked or moved elsewhere are no longer valid.
  const ids = (Array.isArray(licenceIds) ? licenceIds : []).filter((x) => typeof x === 'string').slice(0, 10);
  const dead = ids.length ? (await d.query("select id from licences where id = any($1) and status <> 'active'", [ids])).map((r) => r.id) : [];
  return { trialStart: Math.floor(new Date(rows[0].first_seen) / 1000), licence: l?.token || null, revoked: dead, config: publicConfig(s, region), block, update: await updateFor(d, platform, version) };
}

/** Starts a payment and returns where to pay (Paystack or Hubtel checkout page; a test page in test mode). */
async function buy(d, { device, product, phone, email, church, itemId, sim, country, timezone }, extra = {}) {
  need(DEVICE.test(device || ''), 'Bad device code.');
  const s = await settings(d);
  const { region } = await regionFor(d, extra, { sim, country, timezone });
  let item = null;
  if (itemId) {
    [item] = await d.query('select * from store_items where id = $1 and active', [itemId]);
    need(item, 'This item is no longer in the store.', 404);
    product = 'item';
  } else need(PRODUCTS[product], 'Choose Pro or Pro for one year.');
  const ph = phoneOf(phone) || (region !== 'GH' ? String(phone || '').replace(/[^\d+]/g, '').slice(0, 20) : '');
  need(ph, 'Enter the phone number to link to this purchase (for restoring it later).');
  // The price: GH₵ in Ghana, US$ everywhere else (as set by the Super Admin).
  const list = region === 'GH' ? Number(item ? item.price : s.prices?.[product]) : Number(item ? item.price_usd : s.pricesUSD?.[product]);
  const listCur = region === 'GH' ? (s.currency || 'GHS') : 'USD';
  need(list > 0, region === 'GH' ? 'This product is not on sale yet.' : 'This product is not on sale in your country yet.');
  const provider = s.testMode ? 'test' : region === 'GH' ? s.provider : 'paystack';
  // Card in US$ when Paystack has US$ switched on; otherwise the US$ price is charged in GH₵ at the admin's rate.
  const usdDirect = region !== 'GH' && s.paystackUSD;
  const rate = Number(s.usdRate) || 0;
  need(region === 'GH' || usdDirect || rate > 0 || provider === 'test', 'Card payments from your country are not set up yet. Contact us for help.', 503);
  const amount = region === 'GH' || usdDirect || provider === 'test' ? list : Math.round(list * rate * 100) / 100;
  const currency = region === 'GH' ? listCur : usdDirect || provider === 'test' ? 'USD' : 'GHS';
  const id = 'P' + d.random(12);
  await d.query('insert into payments (id, device_code, product, amount, currency, phone, email, church, provider, list_amount, list_currency, region, item_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
    [id, device, product, amount, currency, ph, email || null, church || null, provider, list, listCur, region, item?.id || null]);
  const fn = d.env('FN_URL');
  const done = `${fn}/done?ref=${id}`;
  let url;
  if (provider === 'test') {
    url = `${fn}/test-pay?ref=${id}`;
  } else if (provider === 'paystack') {
    const r = await d.fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST', headers: { Authorization: `Bearer ${d.env('PAYSTACK_SECRET_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email || `${String(ph).replace(/\D/g, '')}@osoree.app`, amount: Math.round(amount * 100), currency, reference: id, channels: region === 'GH' ? ['mobile_money', 'card'] : ['card'], callback_url: done, metadata: { device, product, item: item?.id || '', region, list: `${list} ${listCur}` } }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.status) { await fail(d, id, j.message || 'Paystack refused'); throw new Fail(j.message || 'Paystack could not start the payment.', 502); }
    url = j.data.authorization_url;
  } else if (provider === 'hubtel') {
    const r = await d.fetch('https://payproxyapi.hubtel.com/items/initiate', {
      method: 'POST', headers: { Authorization: `Basic ${btoa(`${d.env('HUBTEL_API_ID')}:${d.env('HUBTEL_API_KEY')}`)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ totalAmount: amount, description: item ? item.title : PRODUCTS[product], callbackUrl: `${fn}/webhook?p=hubtel&k=${d.env('WEBHOOK_SECRET')}`, returnUrl: done, cancellationUrl: done, merchantAccountNumber: d.env('HUBTEL_POS_SALES_ID'), clientReference: id }),
    });
    const j = await r.json().catch(() => ({}));
    const checkout = j.data?.checkoutUrl || j.Data?.CheckoutUrl;
    if (!r.ok || !checkout) { await fail(d, id, j.message || j.Message || 'Hubtel refused'); throw new Fail(j.message || j.Message || 'Hubtel could not start the payment.', 502); }
    url = checkout;
  } else throw new Fail('No payment provider is set up.', 503);
  return { ref: id, url, amount: list, currency: listCur };
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
  if (p.item_id) {
    // a store item: owned by the church's number, like an approved MoMo request
    await d.query("insert into licence_requests (id, device_code, product, amount, currency, phone, momo_ref, status, decided_at, item_id, note) values ($1,$2,'item',$3,$4,$5,$6,'approved',now(),$7,'card')",
      ['R' + d.random(10), p.device_code, Number(p.list_amount ?? p.amount), p.list_currency || p.currency, p.phone, p.id, p.item_id]);
    await d.query('insert into device_phones (device_code, phone) values ($1, $2) on conflict do nothing', [p.device_code, p.phone]);
    return 'item';
  }
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
    if (token) return { status: 'paid', licence: token === 'item' ? undefined : token, item: p.item_id || undefined };
    const [again] = await d.query('select status, error from payments where id = $1', [p.id]);
    return { status: again.status, error: again.error || undefined };
  }
  return { status: p.status, licence: p.token || undefined, item: p.item_id || undefined, error: p.error || undefined };
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
async function restoreStart(d, { phone, purpose }) {
  const ph = phoneOf(phone);
  need(ph, 'Enter the phone number used when paying.');
  const has = purpose === 'store'
    ? await d.query("select 1 from licence_requests where phone = $1 and status = 'approved' and item_id is not null limit 1", [ph])
    : await d.query("select 1 from licences where phone = $1 and status = 'active' limit 1", [ph]);
  need(has.length, purpose === 'store' ? 'No store purchases were found for this phone number.' : 'No Pro purchase was found for this phone number. Check the number, or contact your dealer.', 404);
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
    if (b.pro) { need(Array.isArray(b.pro) && b.pro.every((f) => ['stream', 'live', 'wifi', 'docs', 'watermark', 'backup', 'listen', 'strongs', 'hymns'].includes(f)), 'Unknown feature.'); next.pro = b.pro; }
    if (b.prices) { for (const [k, v] of Object.entries(b.prices)) need(PRODUCTS[k] && Number(v) >= 0 && Number(v) < 100000, 'Bad price.'); next.prices = { ...cur.prices, ...Object.fromEntries(Object.entries(b.prices).map(([k, v]) => [k, Number(v)])) }; }
    if (b.pricesUSD) { for (const [k, v] of Object.entries(b.pricesUSD)) need(PRODUCTS[k] && Number(v) >= 0 && Number(v) < 10000, 'Bad US$ price.'); next.pricesUSD = { ...(cur.pricesUSD || {}), ...Object.fromEntries(Object.entries(b.pricesUSD).map(([k, v]) => [k, Number(v)])) }; }
    if (b.paystackUSD != null) next.paystackUSD = !!b.paystackUSD;
    if (b.usdRate != null) { need(Number(b.usdRate) >= 0 && Number(b.usdRate) < 1000, 'Bad exchange rate.'); next.usdRate = Number(b.usdRate); }
    if (b.provider) { need(['paystack', 'hubtel'].includes(b.provider), 'Provider: paystack or hubtel.'); next.provider = b.provider; }
    if (b.testMode != null) next.testMode = !!b.testMode;
    if (b.movesPerYear != null) { need(Number.isInteger(b.movesPerYear) && b.movesPerYear >= 0 && b.movesPerYear <= 12, 'Moves: 0 to 12 a year.'); next.movesPerYear = b.movesPerYear; }
    if (b.smsSender != null) { need(/^[A-Za-z0-9 ]{3,11}$/.test(b.smsSender), 'SMS sender: 3 to 11 letters or digits.'); next.smsSender = b.smsSender; }
    if (b.dealer != null) next.dealer = String(b.dealer).slice(0, 120);
    if (b.supportEmail != null) { const e = String(b.supportEmail).trim(); need(!e || /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e), 'Support e-mail looks wrong.'); next.supportEmail = e; }
    if (b.supportWhatsapp != null) { const w = String(b.supportWhatsapp).replace(/[^\d+]/g, ''); need(!w || w.replace('+', '').length >= 9, 'WhatsApp number looks wrong.'); next.supportWhatsapp = w; }
    if (b.momoNumber != null) { const n = String(b.momoNumber).trim(); need(!n || phoneOf(n), 'MoMo number: a Ghana phone number, e.g. 024 123 4567.'); next.momoNumber = n ? phoneOf(n) : ''; }
    if (b.momoName != null) next.momoName = String(b.momoName).trim().slice(0, 60);
    if (b.momoNetwork != null) { need(['', 'MTN', 'Telecel', 'AirtelTigo'].includes(b.momoNetwork), 'Network: MTN, Telecel or AirtelTigo.'); next.momoNetwork = b.momoNetwork; }
    if (b.onlinePay != null) next.onlinePay = !!b.onlinePay;
    await d.query('update settings set data = $1::text::jsonb, updated_at = now() where id = 1', [JSON.stringify(next)]);
    return next;
  },
  async overview(d) {
    // Keeping only what the privacy policy promises: SMS log 12 months, used-up codes, devices gone for 2 years.
    await d.query("delete from sms_log where created_at < now() - interval '12 months'");
    await d.query('delete from restore_codes where expires_at < now()');
    await d.query("delete from devices where last_seen < now() - interval '2 years' and not exists (select 1 from licences l where l.device_code = devices.code and l.status = 'active')");
    const [x] = await d.query(`select
      (select count(*)::int from devices) devices,
      (select count(*)::int from devices where last_seen > now() - interval '30 days') active30,
      (select count(*)::int from licences where status = 'active' and (expires_at is null or expires_at > now())) licences,
      (select coalesce(sum(amount), 0)::float from payments where status = 'paid' and provider <> 'test' and coalesce(list_currency, currency) = 'GHS') revenue,
      (select coalesce(sum(coalesce(list_amount, amount)), 0)::float from payments where status = 'paid' and provider <> 'test' and coalesce(list_currency, currency) = 'USD') revenue_usd,
      (select coalesce(sum(amount), 0)::float from payments where status = 'paid' and provider <> 'test' and coalesce(list_currency, currency) = 'GHS' and paid_at > date_trunc('month', now())) revenue_month,
      (select count(*)::int from payments where status = 'paid' and provider = 'test') test_sales,
      (select count(*)::int from licence_requests where status = 'pending') pending_requests,
      (select count(*)::int from devices dv where not dv.blocked and dv.last_seen > now() - interval '60 days' and dv.first_seen < now() - make_interval(days => $1::int)
         and not exists (select 1 from licences l where l.device_code = dv.code and l.status = 'active' and (l.expires_at is null or l.expires_at > now()))) trials_ended,
      (select coalesce(sum(amount), 0)::float from licence_requests where status = 'approved' and currency = 'GHS' and coalesce(note, '') <> 'card') momo_revenue,
      (select coalesce(sum(amount), 0)::float from licence_requests where status = 'approved' and currency = 'GHS' and coalesce(note, '') <> 'card' and decided_at > date_trunc('month', now())) momo_revenue_month`, [Number((await settings(d)).trialDays ?? 30)]);
    return x;
  },
  async payments(d, b) { return d.query('select * from payments order by created_at desc limit $1', [Math.min(500, b.limit || 100)]); },
  async licences(d, b) {
    const q = String(b.q || '').trim();
    return q ? d.query("select * from licences where device_code ilike $1 or phone ilike $1 or church ilike $1 or id = $2 order by created_at desc limit 200", [`%${q}%`, q])
      : d.query('select * from licences order by created_at desc limit 200');
  },
  async devices(d, b) {
    const q = String(b?.q || '').trim();
    const s = await settings(d);
    const filter = b?.filter === 'blocked' ? 'and dv.blocked' : b?.filter === 'pro' ? 'and l.id is not null' : b?.filter === 'active' ? "and dv.last_seen > now() - interval '30 days'"
      : b?.filter === 'trialover' ? `and l.id is null and not dv.blocked and dv.first_seen < now() - interval '${Math.max(0, Number(s.trialDays ?? 30) | 0)} days'` : '';
    return d.query(`select dv.*, l.product licence_product, l.expires_at licence_expires, l.church, l.phone,
        (select string_agg(distinct p.phone, ', ') from device_phones p where p.device_code = dv.code) linked_phones
      from devices dv left join lateral (select * from licences x where x.device_code = dv.code and x.status = 'active' and (x.expires_at is null or x.expires_at > now()) order by x.created_at desc limit 1) l on true
      where ($1 = '' or dv.code ilike $2 or dv.model ilike $2 or l.church ilike $2 or l.phone ilike $2 or dv.version = $1) ${filter}
      order by dv.last_seen desc limit 300`, [q, `%${q}%`]);
  },
  async blockDevice(d, b) {
    need(DEVICE.test(b.device || ''), 'Bad device code.');
    const r = await d.query("update devices set blocked = true, block_reason = $2, block_kind = 'admin', blocked_at = now() where code = $1 returning code", [b.device, clip(b.reason || '', 200)]);
    need(r.length, 'Device not found.', 404);
    return { ok: true };
  },
  async unblockDevice(d, b) { await d.query('update devices set blocked = false, block_reason = null, block_kind = null, blocked_at = null where code = $1', [b.device]); return { ok: true }; },
  /** Every device whose free trial ended without Pro (seen in the last 60 days): blocked, and told to get Pro. */
  async blockEndedTrials(d, b) {
    const s = await settings(d);
    const reason = clip(b?.reason || 'Your free trial has ended. Get Pro to keep using Ɔsɔreɛ Plus.', 200);
    const r = await d.query(`update devices dv set blocked = true, block_kind = 'trial', block_reason = $2, blocked_at = now()
      where not dv.blocked and dv.first_seen < now() - make_interval(days => $1::int) and dv.last_seen > now() - interval '60 days'
        and not exists (select 1 from licences l where l.device_code = dv.code and l.status = 'active' and (l.expires_at is null or l.expires_at > now()))
      returning dv.code`, [Number(s.trialDays ?? 30), reason]);
    return { blocked: r.length };
  },
  async releases(d) { return d.query('select * from releases order by created_at desc limit 50'); },
  async publishRelease(d, b) {
    need(['android', 'windows', 'ios'].includes(b.platform), 'Platform: android, windows or ios.');
    need(/^\d+\.\d+\.\d+$/.test(b.version || ''), 'Version like 1.9.0.');
    need(b.platform === 'ios' || /^https:\/\//.test(b.url || ''), 'Give the https:// download link.');
    await d.query('insert into releases (platform, version, required, notes, url) values ($1,$2,$3,$4,$5)', [b.platform, b.version, !!b.required, clip(b.notes || '', 500), b.platform === 'ios' ? null : b.url]);
    const [{ n }] = await d.query('select count(*)::int n from devices where platform = $1 and last_seen > now() - interval \'60 days\'', [b.platform === 'ios' ? 'ios' : b.platform]);
    return { ok: true, devices: n };
  },
  async deleteRelease(d, b) { await d.query('delete from releases where id = $1', [b.id]); return { ok: true }; },
  /** Removes everything made in test mode: the pretend payments and the licences they gave. */
  async clearTestPayments(d) {
    const pays = await d.query("select id from payments where provider = 'test'");
    const ids = pays.map((p) => p.id);
    const lic = ids.length ? await d.query("delete from licences where source = 'payment' and source_ref = any($1) returning id", [ids]) : [];
    await d.query("delete from payments where provider = 'test'");
    return { payments: ids.length, licences: lic.length };
  },
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
    const q = 'select r.*, i.title item_title, i.kind item_kind from licence_requests r left join store_items i on i.id = r.item_id';
    const rows = st ? await d.query(`${q} where r.status = $1 order by r.created_at desc limit 200`, [st])
      : await d.query(`${q} where r.status <> 'replaced' order by r.created_at desc limit 200`);
    return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
  },
  async approveRequest(d, b) {
    const [r] = await d.query('select * from licence_requests where id = $1', [b.id]);
    need(r, 'Request not found.', 404);
    need(r.status === 'pending', `This request is already ${r.status}.`);
    if (r.item_id) {
      await d.query("update licence_requests set status = 'approved', decided_at = now() where id = $1", [r.id]);
      return { ok: true };
    }
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
  async storeItems(d) { return (await d.query('select * from store_items order by kind, sort, created_at desc')).map((i) => ({ ...i, price: Number(i.price), price_usd: Number(i.price_usd || 0), file_size: Number(i.file_size || 0) })); },
  async storeSave(d, b) {
    need(['bible', 'background', 'hymnal'].includes(b.kind), 'Kind: bible, background or hymnal.');
    need(String(b.title || '').trim(), 'Give the item a title.');
    need(Number(b.price) >= 0 && Number(b.price) < 100000, 'Bad price.');
    const id = b.id || ({ bible: 'B', hymnal: 'H' }[b.kind] || 'G') + d.random(9);
    const f = { title: String(b.title).trim().slice(0, 80), abbr: b.abbr ? String(b.abbr).trim().slice(0, 16) : null, lang: b.lang ? String(b.lang).slice(0, 40) : null,
      description: b.description ? String(b.description).slice(0, 300) : null, copyright: b.copyright ? String(b.copyright).slice(0, 300) : null, price: Number(b.price) || 0, priceUsd: Number(b.price_usd) || 0,
      thumb: b.thumb && String(b.thumb).startsWith('data:image/') && b.thumb.length < 200000 ? b.thumb : null, active: !!b.active, sort: Number(b.sort) || 0,
      apple: b.apple_product ? String(b.apple_product).trim().slice(0, 100) : null, google: b.google_product ? String(b.google_product).trim().slice(0, 100) : null };
    await d.query(`insert into store_items (id, kind, title, abbr, lang, description, copyright, price, thumb, active, sort, apple_product, google_product, price_usd) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      on conflict (id) do update set title = $3, abbr = $4, lang = $5, description = $6, copyright = $7, price = $8, thumb = coalesce($9, store_items.thumb), active = $10, sort = $11, apple_product = $12, google_product = $13, price_usd = $14`,
      [id, b.kind, f.title, f.abbr, f.lang, f.description, f.copyright, f.price, f.thumb, f.active, f.sort, f.apple, f.google, f.priceUsd]);
    return { id };
  },
  /** Where the admin app uploads the item's file (a one-time signed address in the private bucket). */
  async storeUploadUrl(d, b) {
    const [item] = await d.query('select id, kind from store_items where id = $1', [b.id]);
    need(item, 'Save the item first.', 404);
    const ext = item.kind === 'bible' || item.kind === 'hymnal' ? 'json.gz' : /^video\//.test(b.type) ? 'mp4' : /png/.test(b.type) ? 'png' : 'jpg';
    const path = `${item.kind}/${item.id}-${d.random(6)}.${ext}`;
    return { path, ...(await d.storage.signUpload(path)) };
  },
  async storeFileDone(d, b) {
    need(b.path && /^(bible|background|hymnal)\/[A-Z0-9]+-[A-Z0-9]+\.(json\.gz|mp4|png|jpg)$/.test(b.path), 'Bad file.');
    await d.query('update store_items set file_path = $2, file_type = $3, file_size = $4 where id = $1', [b.id, b.path, String(b.type || '').slice(0, 40), Number(b.size) || 0]);
    return { ok: true };
  },
  async storeDelete(d, b) { await d.query('update store_items set active = false where id = $1', [b.id]); return { ok: true }; },
  async smsLog(d) { return d.query('select phone, ok, reply, created_at from sms_log order by id desc limit 50'); },
  async recent(d) {
    return {
      payments: await d.query("select id, device_code, product, amount, currency, list_amount, list_currency, region, phone, church, provider, status, created_at, paid_at from payments order by created_at desc limit 20"),
      smsProblems: await d.query('select phone, reply, created_at from sms_log where not ok order by id desc limit 5'),
    };
  },
};

// ----------------------------------------------------------------------------------------------- licence requests

/** A church that paid by Mobile Money asks for Pro; the Super Admin approves it in the admin app. */
async function request(d, { device, product, phone, church, momoRef, note, itemId, sim, country, timezone }, extra = {}) {
  need(DEVICE.test(device || ''), 'Bad device code.');
  need((await regionFor(d, extra, { sim, country, timezone })).region === 'GH', 'Mobile Money is for churches in Ghana. Please pay by card.', 403);
  let item = null;
  if (itemId) {
    [item] = await d.query('select * from store_items where id = $1 and active', [itemId]);
    need(item, 'This item is no longer in the store.', 404);
    need(Number(item.price) > 0, 'This item is free: just download it.');
    product = 'item';
  } else need(PRODUCTS[product], 'Choose Pro or Pro for one year.');
  const ph = phoneOf(phone);
  need(ph, 'Enter the phone number you paid from.');
  const ref = String(momoRef || '').trim();
  need(ref.length >= 4 && ref.length <= 40, 'Enter the MoMo transaction ID from the payment message.');
  const s = await settings(d);
  const amount = item ? Number(item.price) : Number(s.prices?.[product]);
  need(amount > 0, 'This product is not on sale yet.');
  const recent = await d.query("select count(*)::int n from licence_requests where device_code = $1 and created_at > now() - interval '1 day'", [device]);
  need(recent[0].n < 20, 'Too many requests today. Call the help line.', 429);
  await d.query("update licence_requests set status = 'replaced', decided_at = now() where device_code = $1 and status = 'pending' and coalesce(item_id, '') = $2", [device, itemId || '']);
  const id = 'R' + d.random(10);
  await d.query('insert into licence_requests (id, device_code, product, amount, currency, phone, church, momo_ref, note, item_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [id, device, product, amount, s.currency || 'GHS', ph, String(church || '').trim().slice(0, 80) || null, ref, String(note || '').trim().slice(0, 200) || null, itemId || null]);
  await d.query('insert into device_phones (device_code, phone) values ($1, $2) on conflict do nothing', [device, ph]);
  return { id, status: 'pending' };
}

/** The newest request from this device, and its licence once approved. */
async function requestStatus(d, { device }) {
  need(DEVICE.test(device || ''), 'Bad device code.');
  const [r] = await d.query('select id, product, amount, currency, momo_ref, status, reason, created_at from licence_requests where device_code = $1 and item_id is null order by created_at desc limit 1', [device]);
  if (!r) return { status: 'none' };
  const l = r.status === 'approved' ? await activeLicence(d, device) : null;
  return { ...r, amount: Number(r.amount), licence: l?.token || null };
}

// ----------------------------------------------------------------------------------------------- store

const ITEM_COLS = 'id, kind, title, abbr, lang, description, copyright, price, currency, file_type, file_size, thumb, sort, apple_product, google_product';
/** Items this device may download: free ones, and paid ones approved for any phone number linked to it. */
async function owned(d, device) {
  const rows = await d.query(`select distinct r.item_id from licence_requests r join device_phones p on p.phone = r.phone
    where p.device_code = $1 and r.status = 'approved' and r.item_id is not null`, [device]);
  return rows.map((r) => r.item_id);
}
async function store(d, { device, sim, country, timezone }, extra = {}) {
  need(DEVICE.test(device || ''), 'Bad device code.');
  const { region } = await regionFor(d, extra, { sim, country, timezone });
  const mine = await owned(d, device);
  // Abroad: US$ prices; paid items without a US$ price are not sold there (unless the church already owns them).
  const items = (await d.query(`select ${ITEM_COLS}, price_usd from store_items where active order by kind, sort, title`)).flatMap((i) => {
    const paid = Number(i.price) > 0, usd = Number(i.price_usd) || 0;
    if (region !== 'GH' && paid && !usd && !mine.includes(i.id)) return []; // not sold abroad
    const price = region === 'GH' ? Number(i.price) : paid ? (usd || null) : 0;
    return [{ ...i, price, currency: region === 'GH' ? (i.currency || 'GHS') : 'USD', price_usd: undefined, file_size: Number(i.file_size || 0) }];
  });
  const pending = (await d.query("select item_id from licence_requests where device_code = $1 and status = 'pending' and item_id is not null", [device])).map((r) => r.item_id);
  const declined = await d.query("select distinct on (item_id) item_id, status, reason from licence_requests where device_code = $1 and item_id is not null order by item_id, created_at desc", [device]);
  const phones = (await d.query('select phone from device_phones where device_code = $1', [device])).map((r) => r.phone);
  return { region, items, owned: mine, pending, declined: declined.filter((x) => x.status === 'declined').map((x) => ({ id: x.item_id, reason: x.reason })), phones };
}
async function storeDownload(d, { device, itemId }) {
  need(DEVICE.test(device || ''), 'Bad device code.');
  const [item] = await d.query('select * from store_items where id = $1 and active', [itemId]);
  need(item && item.file_path, 'This item is not in the store.', 404);
  need(Number(item.price) === 0 || (await owned(d, device)).includes(item.id), 'Buy this item first.', 403);
  return { url: await d.storage.signDownload(item.file_path), item: { id: item.id, kind: item.kind, title: item.title, abbr: item.abbr, file_type: item.file_type, copyright: item.copyright } };
}
/** A store item paid through Apple or Google: recorded like an approved request, owned by the buyer's account. */
async function storePurchase(d, { device, item, buyer, provider, amount, currency }) {
  const [had] = await d.query("select id from licence_requests where phone = $1 and item_id = $2 and status = 'approved'", [buyer, item.id]);
  if (!had) {
    await d.query("insert into licence_requests (id, device_code, product, amount, currency, phone, momo_ref, status, decided_at, item_id, note) values ($1,$2,'item',$3,$4,$5,$6,'approved',now(),$7,$8)",
      ['R' + d.random(10), device, amount, currency, buyer, buyer.split(':')[1].slice(0, 40), item.id, provider]);
  }
  await d.query('insert into device_phones (device_code, phone) values ($1, $2) on conflict do nothing', [device, buyer]);
  return { item: item.id, owned: await owned(d, device) };
}

/** Another phone of the same church: confirm the number by SMS code, then it gets the church's purchases. */
async function storeLink(d, { phone, code, device }) {
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
  await d.query('insert into device_phones (device_code, phone) values ($1, $2) on conflict do nothing', [device, ph]);
  return { owned: await owned(d, device) };
}

// ----------------------------------------------------------------------------------------------- Apple in-app purchase

export const APPLE_PRODUCTS = { 'com.osoree.plus.pro': 'pro', 'com.osoree.plus.pro.year': 'year' };
export const APPLE_BUNDLE = 'com.osoree.plus';
/** iPhone: a StoreKit transaction (signed by Apple) becomes an Ɔsɔreɛ licence for this device. */
async function apple(d, { device, jws }) {
  need(DEVICE.test(device || ''), 'Bad device code.');
  need(d.apple, 'Apple purchases are not set up.', 503);
  let t;
  try { t = await d.apple(jws); } catch (e) { throw new Fail(`The App Store purchase could not be checked (${e.message}).`, 400); }
  need(t.bundleId === APPLE_BUNDLE, 'This purchase is for another app.');
  need(!t.revocationDate, 'Apple refunded this purchase.', 403);
  // A store item (Bible or background) bought in the App Store: owned by this Apple ID, on every iPhone that restores it.
  const [item] = APPLE_PRODUCTS[t.productId] ? [] : await d.query('select * from store_items where apple_product = $1', [t.productId]);
  if (item) return storePurchase(d, { device, item, buyer: 'apple:' + String(t.originalTransactionId || t.transactionId), provider: 'apple', amount: Number(t.price || 0) / 1000, currency: t.currency || 'USD' });
  const product = APPLE_PRODUCTS[t.productId];
  need(product, 'Unknown App Store product.');
  need(!t.revocationDate, 'Apple refunded this purchase.', 403);
  const ref = 'A' + String(t.originalTransactionId || t.transactionId);
  const [paid] = await d.query('select * from payments where id = $1', [ref]);
  if (!paid) {
    await d.query("insert into payments (id, device_code, product, amount, currency, phone, provider, status, paid_at) values ($1,$2,$3,$4,$5,$6,'apple','paid',now())",
      [ref, device, product, Number(t.price || 0) / 1000, t.currency || 'USD', '']);
  }
  // The same purchase on a new iPhone (Restore purchases): the licence moves with it.
  const [l] = await d.query("select * from licences where source = 'apple' and source_ref = $1 and status = 'active' order by created_at desc limit 1", [ref]);
  if (l && l.device_code === device) return { licence: l.token };
  if (l) await d.query("update licences set status = 'moved' where id = $1", [l.id]);
  // one year counts from Apple's purchase date (restoring later does not start a new year)
  const until = product === 'year' ? new Date(Number(t.purchaseDate || t.originalPurchaseDate || d.now().getTime()) + YEAR_MS) : null;
  need(!until || until > d.now(), 'This one-year purchase has ended. Buy Pro again to continue.', 403);
  const lic = await issue(d, { device, product, source: 'apple', sourceRef: ref, until });
  return { licence: lic.token };
}

// ----------------------------------------------------------------------------------------------- Google Play billing

export const GOOGLE_PRODUCTS = { pro: 'pro', pro_year: 'year' };
/** Play Store installs: Google confirms the purchase token; we acknowledge it and give the licence or the item. */
async function google(d, { device, productId, token }) {
  need(DEVICE.test(device || ''), 'Bad device code.');
  need(d.google, 'Google Play purchases are not set up yet.', 503);
  need(typeof token === 'string' && token.length > 10 && typeof productId === 'string', 'Bad purchase.');
  let p;
  try { p = await d.google.verify(productId, token); } catch (e) { throw new Fail(`Google Play could not confirm the purchase (${e.message}).`, 400); }
  need(p.purchaseState === 0, p.purchaseState === 2 ? 'The payment is still pending.' : 'This purchase was cancelled or refunded.', 403);
  if (p.acknowledgementState !== 1) await d.google.acknowledge(productId, token).catch(() => {}); // unacknowledged purchases are refunded after 3 days
  const ref = 'G' + String(p.orderId || token.slice(0, 40));
  const [item] = GOOGLE_PRODUCTS[productId] ? [] : await d.query('select * from store_items where google_product = $1', [productId]);
  if (item) return storePurchase(d, { device, item, buyer: 'google:' + (p.obfuscatedExternalAccountId || ref), provider: 'google', amount: Number(item.price), currency: item.currency || 'GHS' });
  const product = GOOGLE_PRODUCTS[productId];
  need(product, 'Unknown Google Play product.');
  const [paid] = await d.query('select * from payments where id = $1', [ref]);
  if (!paid) await d.query("insert into payments (id, device_code, product, amount, currency, phone, provider, status, paid_at) values ($1,$2,$3,0,'',$4,'google','paid',now())", [ref, device, product, '']);
  const [l] = await d.query("select * from licences where source = 'google' and source_ref = $1 and status = 'active' order by created_at desc limit 1", [ref]);
  if (l && l.device_code === device) return { licence: l.token };
  if (l) await d.query("update licences set status = 'moved' where id = $1", [l.id]);
  const until = product === 'year' ? new Date(Number(p.purchaseTimeMillis || d.now().getTime()) + YEAR_MS) : null;
  need(!until || until > d.now(), 'This one-year purchase has ended. Buy Pro again to continue.', 403);
  const lic = await issue(d, { device, product, source: 'google', sourceRef: ref, until });
  return { licence: lic.token };
}

/** One entry point: route, body, the signed-in user (admin routes) and the raw request bits (webhooks). */
export async function handle(d, route, body = {}, extra = {}) {
  switch (route) {
    case 'config': return publicConfig(await settings(d), (await regionFor(d, extra, body)).region);
    case 'hello': return hello(d, body, extra);
    case 'buy': return buy(d, body, extra);
    case 'buy-status': return buyStatus(d, body);
    case 'redeem': return redeem(d, body);
    case 'restore-start': return restoreStart(d, body);
    case 'restore-finish': return restoreFinish(d, body);
    case 'webhook': return webhook(d, extra);
    case 'test-pay': return testPay(d, body);
    case 'request': return request(d, body, extra);
    case 'request-status': return requestStatus(d, body);
    case 'apple': return apple(d, body);
    case 'google': return google(d, body);
    case 'store': return store(d, body, extra);
    case 'store-download': return storeDownload(d, body);
    case 'store-link': return storeLink(d, body);
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
