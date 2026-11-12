// The Super Admin app (dist/admin) against the real server rules on PGlite; Supabase sign-in is mocked.
import { chromium } from '/home/BrandsME/projects/efiewura/node_modules/playwright-core/index.mjs';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { ALPHABET, handle } from '../supabase/functions/osoree/core.js';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SB = 'https://inoxsalemgwgrzftamxs.supabase.co';
const pg = new PGlite();
for (const f of fs.readdirSync(path.join(root, 'supabase/migrations')).sort()) await pg.exec(fs.readFileSync(path.join(root, 'supabase/migrations', f), 'utf8'));
const d = {
  query: async (t, p = []) => (await pg.query(t, p)).rows,
  now: () => new Date(),
  sign: async (payload) => `OSP1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`,
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  env: (k) => ({ SUPER_ADMIN_EMAIL: 'boss@example.com', FN_URL: SB + '/functions/v1/osoree' })[k] || '',
  random: (n) => Array.from(crypto.randomBytes(n), (x) => ALPHABET[x % 32]).join(''),
  sha256: async (t) => crypto.createHash('sha256').update(t).digest('hex'),
};
const users = { 'boss@example.com': { id: '00000000-0000-0000-0000-00000000000b', email: 'boss@example.com', pw: 'goodpass1', email_confirmed_at: null }, 'other@example.com': { id: '00000000-0000-0000-0000-00000000000c', email: 'other@example.com', pw: 'goodpass1', email_confirmed_at: '2026-11-12T10:00:00Z' } };
const tokens = new Map();
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, x); };
const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1148/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 400, height: 860 } });
const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
const session = (u) => { const t = 'tok-' + crypto.randomUUID(); tokens.set(t, u); return { access_token: t, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r-' + t, user: { id: u.id, email: u.email, aud: 'authenticated', email_confirmed_at: u.email_confirmed_at } }; };
await ctx.route(`${SB}/**`, async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  const url = new URL(req.url());
  const body = req.postDataJSON() || {};
  if (url.pathname === '/auth/v1/signup') {
    if (!users[body.email]) users[body.email] = { id: crypto.randomUUID(), email: body.email, pw: body.password, email_confirmed_at: null };
    return json(route, 200, { id: users[body.email].id, email: body.email, aud: 'authenticated', confirmation_sent_at: new Date().toISOString() });
  }
  if (url.pathname === '/auth/v1/token') {
    const u = users[body.email];
    if (!u || u.pw !== body.password) return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' });
    if (!u.email_confirmed_at) return json(route, 400, { error: 'invalid_grant', error_description: 'Email not confirmed', code: 'email_not_confirmed', msg: 'Email not confirmed' });
    return json(route, 200, session(u));
  }
  if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  const m = /\/functions\/v1\/osoree\/(.+)$/.exec(url.pathname);
  if (m) {
    const user = tokens.get((req.headers().authorization || '').replace('Bearer ', ''));
    try { return json(route, 200, await handle(d, m[1], body, { user })); } catch (e) { return json(route, e.status || 500, { error: e.message }); }
  }
  return json(route, 404, {});
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://127.0.0.1:4871/admin/');
await page.waitForSelector('text=For the Super Admin only.');
ok('sign-in page', true);
ok('admin title', (await page.title()) === 'Ɔsɔreɛ Admin');

const fill = async (email, pw) => { await page.getByLabel('E-mail').fill(email); await page.getByLabel('Password').fill(pw); };
await fill('boss@example.com', 'short');
await page.getByRole('button', { name: 'First time? Create account' }).click();
ok('short password refused', await page.getByText('at least 8 characters').isVisible());
await fill('boss@example.com', 'goodpass1');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForSelector('text=Confirm your e-mail first');
ok('unconfirmed e-mail explained', true);
users['boss@example.com'].email_confirmed_at = '2026-11-12T10:05:00Z';
await fill('boss@example.com', 'wrongpass');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForSelector('text=Wrong e-mail or password.');
ok('wrong password explained', true);
await fill('boss@example.com', 'goodpass1');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForSelector('nav >> text=Licences');
ok('Super Admin signed in, home shown', (await d.query('select email from admins'))[0]?.email === 'boss@example.com');
await page.waitForSelector('text=Test mode is on');
ok('test mode banner', true);
ok('overview numbers', await page.locator('.card', { hasText: 'Devices' }).innerText().then((t) => /0/.test(t)));

// Licences: give one, find it, move it, revoke it
await page.locator('nav button', { hasText: 'Licences' }).click();
await page.getByLabel('Device code').fill('osr-abcd-efgh-jkmn');
await page.getByLabel('Church').fill('Grace Chapel');
await page.getByRole('button', { name: 'One year' }).click();
await page.getByRole('button', { name: 'Make licence' }).click();
await page.waitForSelector('text=Send this code to the church');
const tok = await page.locator('code', { hasText: 'OSP1.' }).innerText();
ok('licence made for the device', JSON.parse(Buffer.from(tok.split('.')[1], 'base64url')).d === 'OSR-ABCD-EFGH-JKMN');
await page.waitForSelector('.card >> text=Grace Chapel');
ok('licence listed, one year', await page.locator('.card', { hasText: 'Grace Chapel' }).last().innerText().then((t) => /Pro, 1 year/.test(t) && /ACTIVE/.test(t)));
await page.getByLabel('Search licences').fill('nothing-like-this');
await page.getByRole('button', { name: 'Search', exact: true }).click();
await page.waitForSelector('text=No licences found.');
ok('search with no match', true);
await page.getByLabel('Search licences').fill('grace');
await page.getByRole('button', { name: 'Search', exact: true }).click();
await page.waitForSelector('.card >> text=OSR-ABCD-EFGH-JKMN');
ok('search by church', true);
await page.getByRole('button', { name: 'Move', exact: true }).first().click();
await page.getByLabel('New device code').fill('OSR-2345-6789-ABCD');
await page.getByRole('button', { name: 'Move', exact: true }).last().click();
await page.waitForSelector('text=Moved.');
await page.getByLabel('Search licences').fill('');
await page.getByRole('button', { name: 'Search', exact: true }).click();
await page.waitForSelector('.card >> text=OSR-2345-6789-ABCD');
const rows = await d.query('select device_code, status from licences order by created_at');
ok('licence moved to the new phone', rows.some((r) => r.device_code === 'OSR-2345-6789-ABCD' && r.status === 'active') && !rows.some((r) => r.device_code === 'OSR-ABCD-EFGH-JKMN' && r.status === 'active'), JSON.stringify(rows));
page.once('dialog', (dl) => dl.accept());
await page.locator('.card', { hasText: 'OSR-2345-6789-ABCD' }).getByRole('button', { name: 'Revoke' }).click();
await page.waitForSelector('text=Revoked.');
ok('licence revoked', (await d.query("select count(*)::int n from licences where status = 'active'"))[0].n === 0);

// Codes
await page.locator('nav button', { hasText: 'Codes' }).click();
await page.getByLabel('Code start').fill('Methodist');
await page.getByLabel('Devices per code').fill('25');
await page.getByLabel('How many codes').fill('3');
await page.getByRole('button', { name: 'Make codes' }).click();
await page.waitForSelector('pre');
const codes = (await page.locator('pre').innerText()).split('\n');
ok('3 bulk codes made', codes.length === 3 && codes.every((c) => /^METHODIST-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(c)), codes.join(' '));
ok('codes listed with 25 devices each', await page.locator('text=25/25 left').count() === 3);

// Settings
await page.locator('nav button', { hasText: 'Settings' }).click();
await page.getByLabel('Price Pro').fill('400');
await page.getByLabel('Trial days').fill('14');
await page.getByLabel(/PDF/).uncheck();
await page.getByLabel('Help line').fill('WhatsApp 024 111 2222');
await page.getByRole('button', { name: 'Hubtel' }).click();
await page.getByRole('button', { name: 'Off (real money)' }).click();
ok('real-money warning names the keys', await page.getByText('HUBTEL_API_ID').isVisible());
await page.getByRole('button', { name: 'Save settings' }).click();
await page.waitForSelector('text=Saved.');
const s = (await d.query('select data from settings'))[0].data;
ok('settings saved on the server', s.prices.pro === 400 && s.trialDays === 14 && !s.pro.includes('docs') && s.dealer === 'WhatsApp 024 111 2222' && s.provider === 'hubtel' && s.testMode === false, JSON.stringify(s));
await page.getByLabel('SMS sender').fill('Bad-Sender!');
await page.getByRole('button', { name: 'Save settings' }).click();
await page.waitForSelector('text=SMS sender: 3 to 11');
ok('bad sender ID explained', true);

// MoMo settings and Pro requests
await page.getByLabel('MoMo number').fill('024 123 4567');
await page.getByLabel('MoMo name').fill('Brands Media');
await page.getByRole('button', { name: 'MTN' }).click();
await page.getByLabel('SMS sender').fill('OsoreePlus');
await page.getByRole('button', { name: 'Hide' }).click();
await page.getByRole('button', { name: 'Save settings' }).click();
await page.waitForSelector('text=Saved.');
const s2 = (await d.query('select data from settings'))[0].data;
ok('MoMo details saved, online pay hidden', s2.momoNumber === '0241234567' && s2.momoName === 'Brands Media' && s2.momoNetwork === 'MTN' && s2.onlinePay === false, JSON.stringify(s2));
await page.reload(); await page.waitForSelector('nav >> text=Requests');
await page.locator('nav button', { hasText: 'Settings' }).click();
ok('settings show what was saved after reopening', (await page.getByLabel('MoMo number').inputValue()) === '0241234567' && (await page.getByLabel('Price Pro').inputValue()) === '400');
const r1 = await handle(d, 'request', { device: 'OSR-ABCD-EFGH-JKMN', product: 'pro', phone: '0201112222', momoRef: '58123456789', church: 'Bethel Chapel' });
await handle(d, 'request', { device: 'OSR-2345-6789-ABCD', product: 'year', phone: '0559998888', momoRef: 'WRONG1', church: 'Faith Temple' });
await page.locator('nav button', { hasText: 'Home' }).click();
await page.waitForSelector('text=2 Pro requests are waiting');
ok('home shows waiting requests', true);
ok('badge on the Requests tab', (await page.locator('nav button', { hasText: 'Requests' }).innerText()).includes('2'));
await page.getByText('2 Pro requests are waiting').click();
await page.waitForSelector('text=58123456789');
ok('request shows the MoMo transaction and amount', await page.locator('.card', { hasText: 'Bethel Chapel' }).innerText().then((t) => t.includes('GH₵400') && t.includes('0201112222')));
await page.locator('.card', { hasText: 'Bethel Chapel' }).getByRole('button', { name: 'Approve' }).click();
await page.waitForSelector('text=Approved.');
const st1 = await handle(d, 'request-status', { device: 'OSR-ABCD-EFGH-JKMN' });
ok('approved: the phone receives its licence', st1.status === 'approved' && st1.licence?.startsWith('OSP1.'));
page.once('dialog', (dl) => dl.accept('MoMo payment not found'));
await page.locator('.card', { hasText: 'Faith Temple' }).getByRole('button', { name: 'Decline' }).click();
await page.waitForSelector('text=Declined.');
ok('declined with a reason', (await handle(d, 'request-status', { device: 'OSR-2345-6789-ABCD' })).reason === 'MoMo payment not found');
await page.waitForSelector('text=No requests waiting.');
ok('nothing left waiting', !(await page.locator('nav button', { hasText: 'Requests' }).innerText()).match(/\d/));
await page.getByRole('button', { name: 'Approved' }).click();
await page.waitForSelector('.card >> text=Bethel Chapel');
ok('approved list', true);
await page.locator('nav button', { hasText: 'Home' }).click();
await page.waitForSelector('.card >> text=Revenue');
ok('MoMo sales in the revenue', await page.locator('.card', { hasText: 'Revenue' }).first().innerText().then((t) => t.includes('400')));

// stays signed in; theme switch; sign out
await page.reload();
await page.waitForSelector('nav >> text=Licences');
ok('stays signed in after reopening', true);
await page.getByLabel('Switch theme').click();
ok('light theme', !(await page.evaluate(() => document.documentElement.classList.contains('dark'))));
await page.screenshot({ path: 'tests/out/admin-home.png' });
await page.getByLabel('Sign out').click();
await page.waitForSelector('text=For the Super Admin only.');
ok('signed out', true);

// someone else signing in is turned away
await fill('other@example.com', 'goodpass1');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForSelector('text=This account is not the Super Admin.');
ok('other accounts refused', !(await page.locator('nav').count()));
ok('no page errors', !errs.length, errs.join(' | '));
await b.close();
console.log(`${pass} passed ${fail} failed`);
process.exit(fail ? 1 : 0);
