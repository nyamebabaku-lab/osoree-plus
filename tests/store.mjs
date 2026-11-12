// The store end to end: the Super Admin uploads a Bible and a background; a church gets the free one, buys the
// Bible by MoMo, the admin approves, it installs by itself; another phone of the church gets it by SMS code.
import { chromium } from '/home/BrandsME/projects/efiewura/node_modules/playwright-core/index.mjs';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { ALPHABET, handle } from '../supabase/functions/osoree/core.js';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SB = 'https://inoxsalemgwgrzftamxs.supabase.co', FN = SB + '/functions/v1/osoree', FILES = 'https://files.example';
const pg = new PGlite();
for (const f of fs.readdirSync(path.join(root, 'supabase/migrations')).sort()) await pg.exec(fs.readFileSync(path.join(root, 'supabase/migrations', f), 'utf8'));
const blobs = new Map(), sms = [];
const d = {
  query: async (t, p = []) => (await pg.query(t, p)).rows, now: () => new Date(),
  sign: async (x) => `OSP1.${Buffer.from(JSON.stringify(x)).toString('base64url')}.sig`,
  fetch: async (u, o = {}) => { if (u.includes('mnotify')) sms.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ status: 'success', code: '2000' }) }; },
  env: (k) => ({ SUPER_ADMIN_EMAIL: 'boss@example.com', FN_URL: FN, MNOTIFY_KEY: 'k' })[k] || '',
  random: (n) => Array.from(crypto.randomBytes(n), (x) => ALPHABET[x % 32]).join(''), sha256: async (t) => crypto.createHash('sha256').update(t).digest('hex'),
  storage: { signDownload: async (p) => `${FILES}/get/${p}`, signUpload: async (p) => ({ url: `${FILES}/put/${p}` }) },
};
const boss = { id: '00000000-0000-0000-0000-00000000000b', email: 'boss@example.com', email_confirmed_at: '2026-11-12T10:00:00Z' };
await handle(d, 'admin/claim', {}, { user: boss });
await handle(d, 'admin/saveSettings', { momoNumber: '0241234567', momoName: 'Brands Media', momoNetwork: 'MTN' }, { user: boss });
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, x); };
const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1148/chrome-linux/chrome' });
const errs = [];
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
async function wire(ctx) {
  await ctx.route(`${SB}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors });
    const u = new URL(req.url());
    if (u.pathname === '/auth/v1/token') return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ access_token: 'tok', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: { id: boss.id, email: boss.email, aud: 'authenticated' } }) });
    const m = /\/functions\/v1\/osoree\/(.+)$/.exec(u.pathname);
    const user = req.headers().authorization === 'Bearer tok' ? boss : null;
    try { await route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(await handle(d, m[1], req.postDataJSON() || {}, { user })) }); }
    catch (e) { await route.fulfill({ status: e.status || 500, headers: cors, contentType: 'application/json', body: JSON.stringify({ error: e.message }) }); }
  });
  await ctx.route(`${FILES}/**`, async (route) => {
    const req = route.request(); const u = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors });
    if (u.pathname.startsWith('/put/')) { blobs.set(u.pathname.slice(5), req.postDataBuffer()); return route.fulfill({ status: 200, headers: cors, body: '{}' }); }
    const data = blobs.get(u.pathname.slice(5));
    return data ? route.fulfill({ status: 200, headers: cors, body: data }) : route.fulfill({ status: 404, headers: cors });
  });
}
// ---- the Super Admin uploads
const actx = await b.newContext({ viewport: { width: 420, height: 900 } }); await wire(actx);
const a = await actx.newPage(); a.on('pageerror', (e) => errs.push('admin: ' + e.message));
await a.goto('http://127.0.0.1:4871/admin/');
await a.getByLabel('E-mail').fill('boss@example.com'); await a.getByLabel('Password').fill('goodpass1'); await a.getByRole('button', { name: 'Sign in' }).click();
await a.waitForSelector('nav >> text=Store');
await a.locator('nav button', { hasText: 'Store' }).click();
await a.getByLabel('Store file').setInputFiles(path.join(root, 'tests/fixtures/TWI-TEST.xml'));
await a.getByLabel('Item title').fill('Twi Bible (test)'); await a.getByLabel('Short name').fill('TWI'); await a.getByLabel('Language').fill('Twi (Asante)');
await a.getByLabel('Copyright').fill('Public domain'); await a.getByLabel('Item price').fill('120');
await a.getByRole('button', { name: 'Upload' }).click();
await a.waitForSelector('text=/Saved \\(/', { timeout: 20000 });
const bi = (await d.query("select * from store_items where kind = 'bible'"))[0];
ok('Bible converted, uploaded and listed', bi?.file_type === 'bible-json-gz' && blobs.has(bi.file_path) && bi.price == 120 && bi.active, bi?.file_path);
await a.getByRole('button', { name: 'Background', exact: true }).click();
await a.getByLabel('Store file').setInputFiles(path.join(root, 'tests/out/logo.png'));
await a.getByLabel('Item title').fill('Blue logo backdrop'); await a.getByLabel('Item price').fill('0');
await a.getByRole('button', { name: 'Upload' }).click();
await a.waitForSelector('text=/Saved\\. Churches/', { timeout: 20000 });
const bg = (await d.query("select * from store_items where kind = 'background'"))[0];
ok('free background uploaded with a thumbnail', bg?.thumb?.startsWith('data:image/jpeg') && blobs.has(bg.file_path) && bg.price == 0);
// ---- a church phone
async function phone() {
  const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, serviceWorkers: 'block' }); await wire(ctx);
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push('app: ' + e.message));
  await p.goto('http://127.0.0.1:4871/'); await p.waitForSelector('nav'); await p.waitForTimeout(600);
  await p.locator('nav button', { hasText: 'Screen' }).click();
  await p.getByRole('button', { name: 'Store: Bibles and backgrounds' }).first().click();
  await p.waitForSelector('text=Twi Bible (test)');
  return p;
}
const p1 = await phone();
ok('store shows the Bible with price and licence line', await p1.getByLabel('Twi Bible (test)').innerText().then((t) => t.includes('GH₵120') && t.includes('Public domain') && t.includes('Twi (Asante)')));
await p1.getByRole('button', { name: 'Backgrounds', exact: true }).click();
await p1.getByLabel('Blue logo backdrop').getByRole('button', { name: /^Get/ }).click();
await p1.waitForSelector('text=/is in Media/');
const st1 = () => p1.evaluate(() => JSON.parse(localStorage.getItem('osoree-plus')).state);
ok('free background downloaded into Media', (await st1()).media.some((m) => m.store === bg.id && m.kind === 'image'));
await p1.getByRole('button', { name: 'Bibles', exact: true }).click();
await p1.getByLabel('Twi Bible (test)').getByRole('button', { name: /^Buy GH₵120/ }).click();
ok('MoMo instructions for the item', await p1.getByText(/Send GH₵120 to MTN MoMo 0241234567 \(Brands Media\)/).isVisible());
await p1.getByLabel('Number paid from for Twi Bible (test)').fill('0244556677');
await p1.getByLabel('Transaction ID for Twi Bible (test)').fill('71234567');
await p1.getByLabel('Church for Twi Bible (test)').fill('Calvary');
await p1.getByRole('button', { name: 'Send request' }).click();
await p1.waitForSelector('text=Waiting for confirmation…');
ok('request waiting', true);
// ---- the admin approves
await a.locator('nav button', { hasText: 'Requests' }).click();
await a.waitForSelector('text=71234567');
ok('admin sees the Bible request', await a.locator('.card', { hasText: '71234567' }).innerText().then((t) => t.includes('Bible: Twi Bible (test)') && t.includes('GH₵120')));
await a.locator('.card', { hasText: '71234567' }).getByRole('button', { name: 'Approve' }).click();
await a.waitForSelector('text=Approved.');
// ---- installs by itself on the phone
await p1.waitForSelector('[aria-label="Twi Bible (test)"] >> text=Installed', { timeout: 25000 }).then(() => ok('approved Bible installs by itself', true), () => ok('approved Bible installs by itself', false));
await p1.getByLabel('Close').click();
await p1.locator('nav button', { hasText: 'Bible' }).click();
const ver = p1.getByLabel('Bible version');
await ver.selectOption(await ver.locator('option', { hasText: 'TWI' }).first().getAttribute('value'));
await p1.getByLabel('Verse or words').fill('yohane 3 16'); await p1.waitForSelector('text=SHOW', { timeout: 10000 }).catch(() => {}); await p1.getByLabel('Verse or words').press('Enter'); await p1.waitForTimeout(500);
const live = await p1.evaluate(() => JSON.parse(localStorage.getItem('osoree-live')));
ok('the store Bible projects', live?.groups?.[0]?.ref === 'Yohane 3:16' && live.groups[0].cols[0].verses[0].t.length > 5, JSON.stringify(live).slice(0, 160) + ' ver=' + await ver.inputValue());
// ---- another phone of the same church
const p2 = await phone();
ok('second phone: not yet owned', await p2.getByLabel('Twi Bible (test)').getByRole('button', { name: /^Buy/ }).isVisible());
await p2.getByText('Bought on another phone of your church?').click();
await p2.getByLabel('Church number for the store').fill('024 455 6677');
await p2.getByRole('button', { name: 'Send me a code' }).click();
await p2.waitForSelector('[aria-label="Store SMS code"]');
const code = sms.at(-1).message.match(/\d{6}/)[0];
await p2.getByLabel('Store SMS code').fill(code); await p2.getByRole('button', { name: 'Confirm' }).click();
await p2.waitForSelector('[aria-label="Twi Bible (test)"] >> text=Installed', { timeout: 20000 }).then(() => ok('second phone gets the church Bible', true), () => ok('second phone gets the church Bible', false));
await p1.screenshot({ path: 'tests/out/store-bible.png' });
ok('no page errors', !errs.length, errs.join(' | '));
await b.close();
console.log(`${pass} passed ${fail} failed`);
process.exit(fail ? 1 : 0);
