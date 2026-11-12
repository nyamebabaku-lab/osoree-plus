// The app talking to the licence server: the browser's requests to the server are answered by the real server
// rules (supabase/functions/osoree/core.js) on a real Postgres (PGlite). Run by tests/run-e2e.sh.
import { chromium } from '/home/BrandsME/projects/efiewura/node_modules/playwright-core/index.mjs';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { ALPHABET, handle } from '../supabase/functions/osoree/core.js';
ed.hashes.sha512 = sha512;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SERVER = 'https://inoxsalemgwgrzftamxs.supabase.co/functions/v1/osoree';

// the server, signing with the real licence key (the app only trusts that key)
const priv = Buffer.from(fs.readFileSync(path.resolve(root, '../osoree-plus-signing/licence-private.key'), 'utf8').trim(), 'base64url');
const pg = new PGlite();
await pg.exec(fs.readFileSync(path.join(root, 'supabase/migrations/0001_osoree.sql'), 'utf8'));
const sms = [];
const envs = { FN_URL: SERVER, MNOTIFY_KEY: 'k', SUPER_ADMIN_EMAIL: 'boss@example.com' };
const d = {
  query: async (t, p = []) => (await pg.query(t, p)).rows,
  now: () => new Date(),
  sign: async (payload) => { const body = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `OSP1.${body}.${Buffer.from(await ed.signAsync(new TextEncoder().encode(body), priv)).toString('base64url')}`; },
  fetch: async (u, o = {}) => { if (u.includes('mnotify')) sms.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}) }; },
  env: (k) => envs[k] || '',
  random: (n) => Array.from(crypto.randomBytes(n), (x) => ALPHABET[x % 32]).join(''),
  sha256: async (t) => crypto.createHash('sha256').update(t).digest('hex'),
};
const boss = { id: '00000000-0000-0000-0000-00000000000b', email: 'boss@example.com' };
await handle(d, 'admin/claim', {}, { user: boss });
const admin = (route, body) => handle(d, `admin/${route}`, body, { user: boss });

let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, x); };
const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1148/chrome-linux/chrome' });
const errs = [];
async function phone() {
  const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, serviceWorkers: 'block' });
  await ctx.route(`${SERVER}/**`, async (route) => {
    const r = new URL(route.request().url()).pathname.replace(/^.*\/osoree\//, '');
    try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await handle(d, r, route.request().postDataJSON() || {})) }); }
    catch (e) { await route.fulfill({ status: e.status || 500, contentType: 'application/json', body: JSON.stringify({ error: e.message }) }); }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://127.0.0.1:4871/'); await page.waitForSelector('nav');
  await page.locator('nav button', { hasText: 'Screen' }).click();
  const code = await page.locator('code', { hasText: /^OSR-/ }).first().innerText();
  return { ctx, page, code };
}
const state = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('osoree-plus')).state);
const openPro = async (page) => { await page.locator('nav button', { hasText: 'Screen' }).click(); await page.getByRole('button', { name: 'Get Pro or enter a licence' }).click(); };

// 1. a phone that reinstalled the app: the server's earlier first-seen date wins, so the trial is over
await admin('saveSettings', { trialDays: 30, prices: { pro: 350, year: 250 }, testMode: true, dealer: 'Call your dealer: 024 000 0000' });
let p1 = await phone();
await pg.query("update devices set first_seen = now() - interval '45 days' where code = $1", [p1.code]);
await p1.page.reload(); await p1.page.waitForSelector('nav'); await p1.page.waitForSelector('text=FREE · GET PRO', { timeout: 10000 }).then(() => ok('reinstalled: the server remembers the trial start', true), () => ok('reinstalled: the server remembers the trial start', false));

// 2. the Super Admin's choices reach the app: documents made free, prices shown
await admin('saveSettings', { pro: ['stream', 'live', 'wifi', 'watermark', 'backup'], prices: { pro: 400 } });
await p1.page.reload(); await p1.page.waitForSelector('nav'); await p1.page.waitForTimeout(800);
ok('Pro features follow the server settings', !(await state(p1.page)).policy.pro.includes('docs'));
await openPro(p1.page);
ok('prices from the server', await p1.page.getByRole('radio', { name: /Pro for this device.*GH₵400/ }).isVisible() && await p1.page.getByRole('radio', { name: /Pro for one year.*GH₵250/ }).isVisible());
ok('dealer contact shown', await p1.page.getByText('Call your dealer: 024 000 0000').isVisible());

// 3. buy Pro for one year (test mode): the browser opens the checkout, the app switches to Pro by itself
await p1.page.getByRole('radio', { name: /Pro for one year/ }).click();
await p1.page.getByLabel('Phone number', { exact: true }).fill('024 111 2222'); await p1.page.getByLabel('Church name').fill('Grace Chapel');
const [checkout] = await Promise.all([p1.ctx.waitForEvent('page'), p1.page.getByRole('button', { name: /Pay GH₵250 with MoMo or card/ }).click()]);
ok('checkout opens in the browser', checkout.url().startsWith(`${SERVER}/test-pay?ref=`), checkout.url());
const ref = new URL(checkout.url()).searchParams.get('ref'); await checkout.close();
ok('app waits for the payment', (await state(p1.page)).pendingPay === ref);
await handle(d, 'test-pay', { ref }); // the church taps "Pay" on the checkout page
await p1.page.waitForSelector('h1 [aria-label="Pro"]', { timeout: 10000 }).then(() => ok('paid: Pro switches on by itself', true), () => ok('paid: Pro switches on by itself', false));
ok('Pro for Grace Chapel, one year', await p1.page.getByText(/Pro is active for Grace Chapel, until/).isVisible());

// 4. an activation code on a second phone
const { codes } = await admin('createCodes', { product: 'pro', count: 1, uses: 5, prefix: 'METHODIST', church: 'Methodist District' });
const p2 = await phone(); await openPro(p2.page);
await p2.page.getByLabel('Activation code').fill(codes[0].toLowerCase()); await p2.page.getByRole('button', { name: 'Use' }).click();
await p2.page.waitForSelector('h1 [aria-label="Pro"]', { timeout: 10000 }).then(() => ok('activation code gives Pro', true), () => ok('activation code gives Pro', false));
await openPro(p2.page).catch(() => {}); // Pro section only
const p2b = await phone(); await openPro(p2b.page);
await p2b.page.getByLabel('Activation code').fill('NOPE-NOPE-NOPE'); await p2b.page.getByRole('button', { name: 'Use' }).click();
await p2b.page.waitForSelector('[role=alert]'); ok('wrong code explained', /not valid/.test(await p2b.page.locator('[role=alert]').innerText()));

// 5. a new phone restores the Grace Chapel purchase by SMS code; the first phone stops being Pro
const p3 = await phone(); await openPro(p3.page);
await p3.page.getByLabel('Restore phone number').fill('0241112222'); await p3.page.getByRole('button', { name: 'Send code' }).click();
await p3.page.waitForSelector('text=We sent a 6-digit code by SMS.');
await p3.page.getByLabel('SMS code').fill(sms.at(-1).message.match(/\d{6}/)[0]); await p3.page.getByRole('dialog').getByRole('button', { name: 'Restore', exact: true }).click();
await p3.page.waitForSelector('h1 [aria-label="Pro"]', { timeout: 10000 }).then(() => ok('restored on the new phone', true), () => ok('restored on the new phone', false));
await p1.page.reload(); await p1.page.waitForSelector('nav');
await p1.page.waitForSelector('text=FREE · GET PRO', { timeout: 10000 }).then(() => ok('old phone loses Pro once online', true), () => ok('old phone loses Pro once online', false));

// 6. revoked by the Super Admin
const [lic] = await d.query("select id from licences where device_code = $1 and status = 'active'", [p2.code]);
await admin('revoke', { id: lic.id });
await p2.page.reload(); await p2.page.waitForSelector('nav');
await p2.page.waitForSelector('text=/TRIAL · 30 DAYS/', { timeout: 10000 }).then(async () => ok('revoked licence removed (back to its trial)', !(await state(p2.page)).licence), () => ok('revoked licence removed (back to its trial)', false));

// 7. a reinstalled phone gets its licence back from the server
await p3.page.evaluate(() => { const s = JSON.parse(localStorage.getItem('osoree-plus')); s.state.licence = ''; localStorage.setItem('osoree-plus', JSON.stringify(s)); });
await p3.page.reload(); await p3.page.waitForSelector('nav');
await p3.page.waitForSelector('h1 [aria-label="Pro"]', { timeout: 10000 }).then(() => ok('licence comes back after reinstalling', true), () => ok('licence comes back after reinstalling', false));

ok('no page errors', errs.length === 0, errs.join(' | '));
console.log(pass, 'passed', fail, 'failed'); await b.close();
process.exit(fail ? 1 : 0);
