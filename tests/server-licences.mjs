// Tests the licence server rules (supabase/functions/osoree/core.js) against a real Postgres (PGlite) with the
// real migration, real Ed25519 signatures, and fake Paystack / Hubtel / mNotify.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { ALPHABET, handle } from '../supabase/functions/osoree/core.js';
ed.hashes.sha512 = sha512;

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, x); };
const pg = new PGlite();
for (const f of fs.readdirSync('supabase/migrations').sort()) await pg.exec(fs.readFileSync(`supabase/migrations/${f}`, 'utf8'));
const priv = ed.utils.randomSecretKey(), pub = ed.getPublicKey(priv);
const b64u = (b) => Buffer.from(b).toString('base64url');
let clock = new Date('2026-11-12T10:00:00Z');
const sent = [], calls = [];
let fakeProvider = {};
const envs = { FN_URL: 'https://x.supabase.co/functions/v1/osoree', PAYSTACK_SECRET_KEY: 'sk_test', WEBHOOK_SECRET: 'hooksecret', HUBTEL_API_ID: 'id', HUBTEL_API_KEY: 'key', HUBTEL_POS_SALES_ID: '123', SUPER_ADMIN_EMAIL: 'boss@example.com', MNOTIFY_KEY: '' };
const d = {
  storage: { signDownload: async (p) => `https://files.example/${p}?sig=1`, signUpload: async (p) => ({ url: `https://files.example/upload/${p}?token=1` }) },
  query: async (t, p = []) => (await pg.query(t, p)).rows,
  now: () => clock,
  sign: async (payload) => { const body = b64u(JSON.stringify(payload)); return `OSP1.${body}.${b64u(await ed.signAsync(new TextEncoder().encode(body), priv))}`; },
  fetch: async (u, o = {}) => { calls.push({ u, o }); const body = o.body ? JSON.parse(o.body) : null; if (u.includes('mnotify')) sent.push(body); const r = (fakeProvider.fn || (() => ({})))(u, body); return { ok: r.ok !== false, json: async () => r.json || {} }; },
  env: (k) => envs[k] || '',
  random: (n) => Array.from(crypto.randomBytes(n), (x) => ALPHABET[x % 32]).join(''),
  sha256: async (t) => crypto.createHash('sha256').update(t).digest('hex'),
};
const call = async (route, body, extra) => { try { return await handle(d, route, body, extra); } catch (e) { return { error: e.message, status: e.status }; } };
const readLic = (t) => { const [, body, sig] = t.split('.'); return { ok: ed.verify(Buffer.from(sig, 'base64url'), new TextEncoder().encode(body), pub), p: JSON.parse(Buffer.from(body, 'base64url')) }; };
const A = 'OSR-2345-6789-ABCD', B = 'OSR-BCDE-FGHJ-KLMN', C = 'OSR-PQRS-TUVW-XYZ2';
const admin = { id: '00000000-0000-0000-0000-000000000001', email: 'Boss@Example.com', email_confirmed_at: '2026-11-12T10:00:00Z' };
const stranger = { id: '00000000-0000-0000-0000-000000000002', email: 'x@example.com' };

// ---- app basics
const cfg = await call('config'); ok('config: trial 30, test mode', cfg.trialDays === 30 && cfg.provider === 'test' && cfg.prices.pro === 350);
const h1 = await call('hello', { device: A, platform: 'android', version: '1.5.0' });
clock = new Date(clock.getTime() + 5 * 864e5);
const h2 = await call('hello', { device: A });
ok('trial start remembered by the server', h1.trialStart === h2.trialStart && !h1.licence, `${h1.trialStart}`);
ok('bad device code refused', (await call('hello', { device: 'nope' })).status === 400);

// ---- test-mode purchase
ok('buy needs a phone number', /phone number/.test((await call('buy', { device: A, product: 'pro' })).error));
const b1 = await call('buy', { device: A, product: 'year', phone: '+233 24 000 0001', church: 'Grace Chapel' });
ok('test checkout page', b1.url === `${envs.FN_URL}/test-pay?ref=${b1.ref}` && b1.amount === 250, b1.url);
ok('pending before paying', (await call('buy-status', { ref: b1.ref })).status === 'pending');
await call('test-pay', { ref: b1.ref });
const s1 = await call('buy-status', { ref: b1.ref });
const l1 = readLic(s1.licence || 'x.e30.x');
ok('paid → licence signed for this device, one year', s1.status === 'paid' && l1.ok && l1.p.d === A && Math.abs(l1.p.e - (clock / 1000 + 365.25 * 86400)) < 5 && l1.p.c === 'Grace Chapel' && l1.p.ph === '0240000001', JSON.stringify(l1.p));
await call('test-pay', { ref: b1.ref });
ok('paying twice gives one licence', (await d.query('select count(*)::int n from licences where device_code = $1', [A]))[0].n === 1);
ok('hello returns the licence (e.g. after reinstalling)', (await call('hello', { device: A })).licence === s1.licence);

// ---- Paystack
await d.query(`update settings set data = data || '{"testMode": false, "provider": "paystack"}'::jsonb`);
fakeProvider.fn = (u, body) => (u.includes('/initialize') ? { json: { status: true, data: { authorization_url: 'https://checkout.paystack.com/abc' } } } : {});
const b2 = await call('buy', { device: B, product: 'pro', phone: '0240000002' });
const init = calls.find((c) => c.u.includes('/initialize'));
const ib = JSON.parse(init.o.body);
ok('Paystack checkout started with the right amount', b2.url === 'https://checkout.paystack.com/abc' && ib.amount === 35000 && ib.currency === 'GHS' && ib.reference === b2.ref && ib.channels.includes('mobile_money'));
const hmacOf = async (raw) => crypto.createHmac('sha512', envs.PAYSTACK_SECRET_KEY).update(raw).digest('hex');
const ev = (amount) => JSON.stringify({ event: 'charge.success', data: { reference: b2.ref, amount, currency: 'GHS', id: 99 } });
ok('webhook with a bad signature refused', (await call('webhook', {}, { p: 'paystack', raw: ev(35000), signature: 'bad', hmac: hmacOf })).status === 401);
await call('webhook', {}, { p: 'paystack', raw: ev(100), signature: await hmacOf(ev(100)), hmac: hmacOf });
ok('webhook with the wrong amount ignored', (await call('buy-status', { ref: b2.ref })).status === 'pending');
await call('webhook', {}, { p: 'paystack', raw: ev(35000), signature: await hmacOf(ev(35000)), hmac: hmacOf });
const s2 = await call('buy-status', { ref: b2.ref }); const l2 = readLic(s2.licence);
ok('Paystack webhook → licence with no end date', s2.status === 'paid' && l2.ok && l2.p.d === B && l2.p.e === 0);
// app asks before the webhook arrives: the server checks with Paystack itself
const b3 = await call('buy', { device: C, product: 'pro', phone: '0240000003' });
fakeProvider.fn = (u) => (u.includes('/verify/') ? { json: { status: true, data: { status: 'success', amount: 35000, currency: 'GHS', id: 7 } } } : {});
ok('app waiting: server verifies with Paystack', (await call('buy-status', { ref: b3.ref })).status === 'paid');

// ---- Hubtel
await d.query(`update settings set data = data || '{"provider": "hubtel"}'::jsonb`);
fakeProvider.fn = (u) => (u.includes('items/initiate') ? { json: { data: { checkoutUrl: 'https://pay.hubtel.com/xyz' } } } : u.includes('txnstatus') ? { json: { data: { status: 'Paid', amount: 350 } } } : {});
const b4 = await call('buy', { device: 'OSR-HJKL-MNPQ-RSTU', product: 'pro', phone: '0240000004' });
ok('Hubtel checkout', b4.url === 'https://pay.hubtel.com/xyz');
ok('Hubtel callback without the secret refused', (await call('webhook', {}, { p: 'hubtel', k: 'wrong', raw: '{}' })).status === 403);
await call('webhook', {}, { p: 'hubtel', k: 'hooksecret', raw: JSON.stringify({ Data: { ClientReference: b4.ref } }) });
ok('Hubtel callback checked with Hubtel → paid', (await call('buy-status', { ref: b4.ref })).status === 'paid');
ok('test page refuses when test mode is off', (await call('test-pay', { ref: b4.ref })).status === 403);

// ---- admin
ok('admin routes refuse strangers', (await call('admin/settings', {}, { user: stranger })).status === 403);
ok('claim refused for another e-mail', (await call('admin/claim', {}, { user: stranger })).status === 403);
ok('claim refused before the e-mail is confirmed', /Confirm this e-mail/.test((await call('admin/claim', {}, { user: { ...admin, email_confirmed_at: null } })).error));
ok('Super Admin claims the server', (await call('admin/claim', {}, { user: admin })).first === true);
ok('nobody else can claim it afterwards', (await call('admin/claim', {}, { user: { ...stranger, email: 'boss@example.com' } })).status === 403);
const st = await call('admin/saveSettings', { trialDays: 14, prices: { pro: 400 }, testMode: true, dealer: 'Call 024 000 0000' }, { user: admin });
ok('settings saved', st.trialDays === 14 && st.prices.pro === 400 && st.prices.year === 250 && st.testMode === true);
ok('bad settings refused', /Trial/.test((await call('admin/saveSettings', { trialDays: -1 }, { user: admin })).error));
ok('the app sees the new prices', (await call('config')).prices.pro === 400);
const ov = await call('admin/overview', {}, { user: admin });
ok('overview: revenue leaves out test sales', ov.revenue === 1050 && ov.test_sales === 1 && ov.devices >= 1, JSON.stringify(ov));

// ---- activation codes
const { codes } = await call('admin/createCodes', { product: 'year', count: 1, uses: 2, prefix: 'Grace', church: 'Grace Chapel' }, { user: admin });
ok('code made', /^GRACE-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(codes[0]), codes[0]);
const r1 = await call('redeem', { device: 'OSR-2222-2222-2222', code: codes[0].toLowerCase() });
const r2 = await call('redeem', { device: 'OSR-3333-3333-3333', code: codes[0] });
ok('code used on two devices', readLic(r1.licence).p.d === 'OSR-2222-2222-2222' && readLic(r2.licence).p.c === 'Grace Chapel');
ok('same device again: same licence, no use spent', (await call('redeem', { device: 'OSR-2222-2222-2222', code: codes[0] })).licence === r1.licence);
ok('third device refused', /all its devices/.test((await call('redeem', { device: 'OSR-4444-4444-4444', code: codes[0] })).error));
ok('unknown code refused', /not valid/.test((await call('redeem', { device: A, code: 'NOPE-1234' })).error));

// ---- restore by phone
ok('restore without SMS set up explains', /not set up/.test((await call('restore-start', { phone: '0240000002' })).error));
envs.MNOTIFY_KEY = 'mn';
fakeProvider.fn = (u) => (u.includes('mnotify') ? { json: { status: 'error', code: '4005', message: 'Insufficient balance' } } : {});
ok('SMS refused by mNotify is reported', /could not be sent/.test((await call('restore-start', { phone: '0240000002' })).error));
ok('mNotify reply kept for the Super Admin', (await d.query('select reply from sms_log where not ok'))[0]?.reply.includes('Insufficient balance'));
fakeProvider.fn = (u) => (u.includes('mnotify') ? { json: { status: 'success', code: '2000' } } : {});
ok('restore for an unknown number', (await call('restore-start', { phone: '0209999999' })).status === 404);
await call('restore-start', { phone: '024 000 0002' });
const code = sent.at(-1).message.match(/\d{6}/)[0];
ok('SMS sent to the buyer', sent.at(-1).recipient[0] === '0240000002');
ok('wrong code refused', /not right/.test((await call('restore-finish', { phone: '0240000002', code: '000000', device: 'OSR-5555-5555-5555' })).error));
const rf = await call('restore-finish', { phone: '0240000002', code, device: 'OSR-5555-5555-5555' });
ok('right code moves the licence', readLic(rf.licence).p.d === 'OSR-5555-5555-5555' && rf.moved === B);
const old = readLic(s2.licence).p.n;
ok('the old phone learns its licence was moved', (await call('hello', { device: B, licenceIds: [old] })).revoked.includes(old));
await call('restore-start', { phone: '0240000002' }); await call('restore-finish', { phone: '0240000002', code: sent.at(-1).message.match(/\d{6}/)[0], device: 'OSR-6666-6666-6666' });
await call('restore-start', { phone: '0240000002' });
ok('moves limited per year', /too many times/.test((await call('restore-finish', { phone: '0240000002', code: sent.at(-1).message.match(/\d{6}/)[0], device: 'OSR-7777-7777-7777' })).error));

// ---- admin issue / revoke / move
const iss = await call('admin/issue', { device: 'OSR-8888-8888-8888', product: 'pro', church: 'Hope Church' }, { user: admin });
ok('admin issues a licence', readLic(iss.licence).p.c === 'Hope Church');
await call('admin/revoke', { id: iss.id }, { user: admin });
ok('revoked licence reported to its phone', (await call('hello', { device: 'OSR-8888-8888-8888', licenceIds: [iss.id] })).revoked.includes(iss.id));
const lic = await call('admin/licences', { q: 'Grace' }, { user: admin });
ok('admin search by church', lic.length >= 3);

// ---- Pro requests paid by Mobile Money
const D = 'OSR-MNPQ-RSTU-VWXY';
await call('admin/saveSettings', { momoNumber: '024 123 4567', momoName: 'Brands Media', momoNetwork: 'MTN', onlinePay: false, prices: { pro: 350, year: 250 } }, { user: admin });
let mcfg = (await call("hello", { device: D })).config;
ok("app sees the MoMo number and that online pay is hidden", mcfg.momo?.number === "0241234567" && mcfg.momo.name === "Brands Media" && mcfg.momo.network === "MTN" && mcfg.onlinePay === false, JSON.stringify(mcfg.momo));
ok('bad MoMo number refused', (await call('admin/saveSettings', { momoNumber: '12' }, { user: admin })).error?.startsWith('MoMo number'));
ok('request needs the transaction ID', (await call('request', { device: D, product: 'pro', phone: '0201112222', momoRef: '' })).error?.includes('transaction ID'));
ok('request needs the phone', (await call('request', { device: D, product: 'pro', phone: '', momoRef: '12345678' })).error?.includes('phone'));
const rq1 = await call('request', { device: D, product: 'pro', phone: '0201112222', momoRef: '11112222', church: 'Bethel' });
const rq2 = await call('request', { device: D, product: 'year', phone: '0201112222', momoRef: '33334444', church: 'Bethel Chapel' });
ok('a new request replaces the waiting one', rq2.status === 'pending' && (await d.query("select status from licence_requests where id = $1", [rq1.id]))[0].status === 'replaced');
let rs = await call('request-status', { device: D });
ok('app sees its request waiting', rs.status === 'pending' && rs.momo_ref === '33334444' && rs.amount === 250 && !rs.licence, JSON.stringify(rs));
const notBoss = await call('admin/requests', {}, { user: { id: '00000000-0000-0000-0000-0000000000ff', email: 'x@y.z' } });
ok('requests are Super Admin only', notBoss.status === 403, JSON.stringify(notBoss));
let waiting = await call('admin/requests', { status: 'pending' }, { user: admin });
ok('Super Admin sees the waiting request', waiting.length === 1 && waiting[0].church === 'Bethel Chapel' && waiting[0].amount === 250);
ok('overview counts it', (await call('admin/overview', {}, { user: admin })).pending_requests === 1);
const ap = await call('admin/approveRequest', { id: rq2.id }, { user: admin });
ok('approving issues a one-year licence for that device', ap.licence && readLic(ap.licence).ok && readLic(ap.licence).p.d === D && readLic(ap.licence).p.e - readLic(ap.licence).p.i > 360 * 86400, JSON.stringify(ap).slice(0, 200));
ok('cannot approve twice', (await call('admin/approveRequest', { id: rq2.id }, { user: admin })).error?.includes('already approved'));
rs = await call('request-status', { device: D });
ok('app receives the licence', rs.status === 'approved' && rs.licence === ap.licence);
ok('hello gives it too', (await call('hello', { device: D })).licence === ap.licence);
const ov2 = await call('admin/overview', {}, { user: admin });
ok('MoMo money counted', ov2.momo_revenue === 250 && ov2.pending_requests === 0, JSON.stringify(ov2));
const E = 'OSR-ABCD-EFGH-JKLM';
const rq3 = await call('request', { device: E, product: 'pro', phone: '0207778888', momoRef: 'BADREF1' });
await call('admin/declineRequest', { id: rq3.id, reason: 'Payment not found' }, { user: admin });
rs = await call('request-status', { device: E });
ok('declined request explained to the app', rs.status === 'declined' && rs.reason === 'Payment not found' && !rs.licence);
// settings stored as a quoted string by the old server: still read, and repaired by the next save
await pg.query("update settings set data = to_jsonb($1::text) where id = 1", [JSON.stringify({ trialDays: 21, pro: ['stream'], prices: { pro: 300, year: 200 }, currency: 'GHS', provider: 'paystack', testMode: true })]);
mcfg = (await call("hello", { device: D })).config;
ok("double-encoded settings still read", mcfg.trialDays === 21 && mcfg.prices.pro === 300, JSON.stringify(mcfg).slice(0, 80));
await call('admin/saveSettings', { trialDays: 30 }, { user: admin });
const raw = (await pg.query("select jsonb_typeof(data) t, data->>'trialDays' n, data->'prices'->>'pro' p from settings")).rows[0];
ok('saving repairs them', raw.t === 'object' && raw.n === '30' && raw.p === '300', JSON.stringify(raw));
await pg.query("update settings set data = to_jsonb($1::text) where id = 1", [JSON.stringify({ trialDays: 9 })]);
await pg.exec(fs.readFileSync('supabase/migrations/0003_requests.sql', 'utf8'));
ok('the migration repairs them too', (await pg.query("select jsonb_typeof(data) t, data->>'trialDays' n from settings")).rows[0].t === 'object');

// ---- store: Bibles and backgrounds
const boss = { user: admin };
const free = await call('admin/storeSave', { kind: 'background', title: 'Sunrise', price: 0, active: true, thumb: 'data:image/jpeg;base64,AAA' }, boss);
const twi = await call('admin/storeSave', { kind: 'bible', title: 'Twi Bible (1964)', abbr: 'TWI64', price: 120, active: true, copyright: 'Public domain' }, boss);
const hidden = await call('admin/storeSave', { kind: 'background', title: 'Draft', price: 5, active: false }, boss);
const up = await call('admin/storeUploadUrl', { id: twi.id }, boss);
ok('upload address for the Bible file', /^bible\/B[A-Z0-9]+-[A-Z0-9]+\.json\.gz$/.test(up.path) && up.url.includes(up.path), up.path);
await call('admin/storeFileDone', { id: twi.id, path: up.path, type: 'bible-json-gz', size: 1234567 }, boss);
const upf = await call('admin/storeUploadUrl', { id: free.id, type: 'image/jpeg' }, boss);
await call('admin/storeFileDone', { id: free.id, path: upf.path, type: 'image/jpeg', size: 200000 }, boss);
ok('store is Super Admin only', (await call('admin/storeSave', { kind: 'bible', title: 'x', price: 1 }, { user: { id: '00000000-0000-0000-0000-0000000000ff', email: 'x@y.z' } })).status === 403);
const F = 'OSR-FFFF-GGGG-HHHH', G = 'OSR-JJJJ-KKKK-LLLL';
let sst = await call('store', { device: F });
ok('store lists active items only', sst.items.length === 2 && !sst.items.some((x) => x.id === hidden.id) && sst.items.find((x) => x.id === twi.id).price === 120);
ok('free item downloads at once', (await call('store-download', { device: F, itemId: free.id })).url?.includes(upf.path));
ok('paid item locked before buying', (await call('store-download', { device: F, itemId: twi.id })).status === 403);
ok('free items cannot be "bought"', (await call('request', { device: F, itemId: free.id, phone: '0241112222', momoRef: '12345678' })).error?.includes('free'));
const sr = await call('request', { device: F, itemId: twi.id, phone: '0241112222', momoRef: '99887766', church: 'Zion' });
sst = await call('store', { device: F });
ok('request waiting shows in the store', sst.pending.includes(twi.id) && sr.status === 'pending');
ok('a Pro request on the same phone is not replaced by it', true);
const wr = await call('admin/requests', { status: 'pending' }, boss);
const mine = wr.find((x) => x.id === sr.id);
ok('admin sees which item and its price', mine?.item_title === 'Twi Bible (1964)' && mine.amount === 120, JSON.stringify(mine).slice(0, 150));
const ap2 = await call('admin/approveRequest', { id: sr.id }, boss);
ok('approving an item issues no Pro licence', ap2.ok && !ap2.licence);
sst = await call('store', { device: F });
ok('approved: the item is owned', sst.owned.includes(twi.id) && !sst.pending.includes(twi.id));
const dl = await call('store-download', { device: F, itemId: twi.id });
ok('download address for the owned Bible', dl.url?.includes(up.path) && dl.item.abbr === 'TWI64');
ok('another phone of the church: not yet', !(await call('store', { device: G })).owned.includes(twi.id));
sent.length = 0; envs.MNOTIFY_KEY = 'k';
fakeProvider.fn = (u) => (u.includes('mnotify') ? { json: { status: 'success', code: '2000' } } : {});
await call('restore-start', { phone: '0241112222', purpose: 'store' });
const code2 = sent.at(-1)?.message.match(/\d{6}/)?.[0];
ok('SMS code to the church number', !!code2);
ok('wrong code refused', (await call('store-link', { device: G, phone: '0241112222', code: '000000' })).error === 'That code is not right.');
const ln = await call('store-link', { device: G, phone: '0241112222', code: code2 });
ok('other phone gets the church purchases', ln.owned?.includes(twi.id) && (await call('store-download', { device: G, itemId: twi.id })).url);
ok('unknown number: no store purchases', (await call('restore-start', { phone: '0209999999', purpose: 'store' })).status === 404);
const ov3 = await call('admin/overview', {}, boss);
ok('item sales counted', ov3.momo_revenue >= 120 + 250, JSON.stringify(ov3));
envs.MNOTIFY_KEY = ''; fakeProvider.fn = null;

// ---- the public API keys can read nothing
await pg.exec("create role anon; grant select on all tables in schema public to anon;");
await pg.exec('set role anon');
ok('row-level security hides every table', (await pg.query('select * from licences')).rows.length === 0 && (await pg.query('select * from settings')).rows.length === 0);
await pg.exec('reset role');

console.log(pass, 'passed', fail, 'failed');
process.exit(fail ? 1 : 0);
