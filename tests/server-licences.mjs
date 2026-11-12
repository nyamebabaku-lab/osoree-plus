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
await pg.exec(fs.readFileSync('supabase/migrations/0001_osoree.sql', 'utf8'));
const priv = ed.utils.randomSecretKey(), pub = ed.getPublicKey(priv);
const b64u = (b) => Buffer.from(b).toString('base64url');
let clock = new Date('2026-11-12T10:00:00Z');
const sent = [], calls = [];
let fakeProvider = {};
const envs = { FN_URL: 'https://x.supabase.co/functions/v1/osoree', PAYSTACK_SECRET_KEY: 'sk_test', WEBHOOK_SECRET: 'hooksecret', HUBTEL_API_ID: 'id', HUBTEL_API_KEY: 'key', HUBTEL_POS_SALES_ID: '123', SUPER_ADMIN_EMAIL: 'boss@example.com', MNOTIFY_KEY: '' };
const d = {
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
const admin = { id: '00000000-0000-0000-0000-000000000001', email: 'Boss@Example.com' };
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

// ---- the public API keys can read nothing
await pg.exec("create role anon; grant select on all tables in schema public to anon;");
await pg.exec('set role anon');
ok('row-level security hides every table', (await pg.query('select * from licences')).rows.length === 0 && (await pg.query('select * from settings')).rows.length === 0);
await pg.exec('reset role');

console.log(pass, 'passed', fail, 'failed');
process.exit(fail ? 1 : 0);
