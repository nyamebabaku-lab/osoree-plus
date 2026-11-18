// Updates and blocking in the church app, driven by what the server answers at check-in.
import { readFileSync } from 'node:fs';
import { chromium } from '/home/BrandsME/projects/efiewura/node_modules/playwright-core/index.mjs';
const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1148/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, serviceWorkers: 'block' });
let answer = { block: null, update: null };
const seen = [];
await ctx.route('https://inoxsalemgwgrzftamxs.supabase.co/**', async (route) => {
  const r = new URL(route.request().url()).pathname.split('/').pop();
  if (r === 'hello') {
    seen.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ trialStart: Math.floor(Date.now() / 1000), licence: null, revoked: [], config: { trialDays: 30, pro: [], prices: { pro: 350 }, currency: 'GHS', provider: 'test', dealer: '0505400054' }, ...answer }) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], owned: [], pending: [], declined: [], phones: [] }) });
});
// pretend to be the Windows app (updates are offered to installed apps, not the website)
await ctx.addInitScript(() => { window.osoreeDesktop = { deviceId: 'abc123', platform: 'windows', info: { model: 'Intel Core i5', os: 'Windows 10.0.22631' }, installUpdate: async (u) => { window.__installed = u; return true; }, onUpdateProgress: () => {} }; });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, x); };
await page.goto('http://127.0.0.1:4871/'); await page.waitForSelector('nav'); await page.waitForTimeout(800);
const h = seen[0];
ok('check-in sends platform, model, system and area', h?.platform === 'windows' && h.model === 'Intel Core i5' && h.os.startsWith('Windows') && 'timezone' in h, JSON.stringify(h).slice(0, 200));
ok('no banner when up to date', !(await page.getByLabel('Update available').count()));
await page.locator('nav button', { hasText: 'Screen' }).click();
ok('Settings show this version', await page.getByText('App version and updates').isVisible());
await page.getByRole('button', { name: 'Check for updates' }).click();
await page.waitForSelector('text=You have the newest version.');
ok('check: newest version', true);
// an optional update is published
answer = { block: null, update: { version: '9.9.0', required: false, notes: 'New: Twi book names', url: 'https://example.org/OsoreePlus-Setup.exe' } };
await page.getByRole('button', { name: 'Check for updates' }).click();
await page.waitForSelector('[aria-label="Update available"]');
ok('"A new version is available" banner', await page.getByLabel('Update available').innerText().then((t) => t.includes('A new version is available') && t.includes('9.9.0')));
ok('Settings show the new version and notes', await page.getByText('Version 9.9.0 is available.').isVisible() && await page.getByText('New: Twi book names').first().isVisible());
const stNow = await page.evaluate(() => JSON.parse(localStorage.getItem('osoree-plus')).state);
ok('church told once about 9.9.0, notes kept for after the update', stNow.updateNotified === '9.9.0' && stNow.whatsNew?.notes === 'New: Twi book names');
await page.getByLabel('Update available').getByRole('button', { name: 'Download' }).click();
await page.waitForTimeout(300);
ok('Download installs it (Windows: by itself)', (await page.evaluate(() => window.__installed)) === 'https://example.org/OsoreePlus-Setup.exe');
await page.getByLabel('Update available').getByRole('button', { name: 'Later' }).click();
ok('banner can be put off', !(await page.getByLabel('Update available').count()));
await page.getByLabel('Update automatically').check();
ok('automatic updates can be switched on', (await page.evaluate(() => JSON.parse(localStorage.getItem('osoree-plus')).state.autoUpdate)) === true);
// required update
answer = { block: null, update: { version: '9.9.1', required: true, notes: 'Important fix', url: 'https://example.org/OsoreePlus-Setup.exe' } };
await page.getByRole('button', { name: 'Check for updates' }).click();
await page.waitForSelector('[aria-label="Update required"]');
ok('required update covers the app', await page.getByLabel('Update required').innerText().then((t) => t.includes('9.9.1') && t.includes('Important fix')));
// blocked
answer = { block: { reason: 'Licence misuse', help: '0505400054' }, update: null };
await page.evaluate(() => window.osoreeCheckNow());
await page.waitForSelector('[aria-label="Device blocked"]');
ok('blocked: lock screen with reason and help line', await page.getByLabel('Device blocked').innerText().then((t) => t.includes('Licence misuse') && t.includes('0505400054')));
ok('blocked: the screens go black', (await page.evaluate(() => JSON.parse(localStorage.getItem('osoree-live')))).kind === 'black');
await page.reload(); await page.waitForTimeout(500);
ok('still locked after restarting (even offline)', await page.getByLabel('Device blocked').isVisible());
// trial over and blocked: update, get Pro, contact for help
await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
answer = { block: { reason: 'Your free trial has ended. Get Pro to keep using Ɔsɔreɛ Plus.', kind: 'trial', help: '0505400054', email: 'help@brands.example', whatsapp: '0505400054' }, update: { version: '9.9.2', required: false, notes: '', url: 'https://example.org/OsoreePlus-Setup.exe' } };
await page.getByRole('button', { name: 'Check again' }).click();
await page.waitForSelector('text=Your free trial has ended');
const lock = page.getByLabel('Device blocked');
ok('trial over: Get Pro, Update and help buttons', await lock.getByRole('button', { name: /Get Ɔsɔreɛ Plus Pro/ }).isVisible() && await lock.getByRole('button', { name: 'Update to version 9.9.2' }).isVisible() && await lock.getByRole('button', { name: 'WhatsApp' }).isVisible() && await lock.getByRole('button', { name: 'E-mail' }).isVisible());
await lock.getByRole('button', { name: 'WhatsApp' }).click();
const wa = (await page.evaluate(() => window.__opened))[0] || '';
ok('WhatsApp opens a chat with the admin number (Ghana code added) and the device code', wa.startsWith('https://wa.me/233505400054?text=') && decodeURIComponent(wa).includes('OSR-'), wa.slice(0, 120));
await lock.getByRole('button', { name: 'Update to version 9.9.2' }).click(); await page.waitForTimeout(300);
ok('Update downloads the new version from the admin release', (await page.evaluate(() => window.__installed)) === 'https://example.org/OsoreePlus-Setup.exe');
await lock.getByRole('button', { name: /Get Ɔsɔreɛ Plus Pro/ }).click();
await page.waitForSelector('text=Pro includes');
ok('Get Pro opens the Pro sheet over the lock screen', true);
await page.getByLabel('Close').click();
await page.screenshot({ path: 'tests/out/trial-blocked.png' });
answer = { block: null, update: null };
await page.getByRole('button', { name: 'Check again' }).click();
await page.waitForSelector('nav');
ok('unblocked: the app works again', true);
// after updating: "What's new" once
await page.evaluate((v) => { const d = JSON.parse(localStorage.getItem('osoree-plus')); d.state.whatsNew = { version: v, notes: 'Scripture listener is faster' }; localStorage.setItem('osoree-plus', JSON.stringify(d)); }, JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version);
await page.reload(); await page.waitForSelector('nav');
await page.waitForSelector('[aria-label="What\'s new"]', { timeout: 5000 }).then(() => ok('"What\'s new" shown after updating', true), () => ok('"What\'s new" shown after updating', false));
await page.getByLabel("Close what's new").click();
ok('…and closes for good', !(await page.getByLabel("What's new").count()));
await page.screenshot({ path: 'tests/out/updates.png' });
ok('no page errors', !errs.length, errs.join(' | '));
await b.close();
console.log(`${pass} passed ${fail} failed`);
process.exit(fail ? 1 : 0);
