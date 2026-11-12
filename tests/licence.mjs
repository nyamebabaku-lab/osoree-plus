// Pro licensing: trial, locking after the trial, licences (run by tests/run-e2e.sh after the main tests).
import { chromium } from '/home/BrandsME/projects/efiewura/node_modules/playwright-core/index.mjs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..');
const issue = (...a) => execFileSync('node', ['scripts/licence.mjs', 'issue', ...a], { cwd: root }).toString().trim();
const base = 'http://127.0.0.1:4871/';
const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1148/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, x); };
const tab = (name) => page.locator('nav button', { hasText: name }).click();
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('osoree-plus')).state);
const setState = (patch) => page.evaluate((p) => { const d = JSON.parse(localStorage.getItem('osoree-plus')); Object.assign(d.state, p); localStorage.setItem('osoree-plus', JSON.stringify(d)); }, patch);
const live = () => page.evaluate(() => JSON.parse(localStorage.getItem('osoree-live')));
const now = () => Math.floor(Date.now() / 1000);

await page.goto(base); await page.waitForSelector('nav');
await page.waitForSelector('text=/TRIAL · 30 DAYS/'); ok('new device starts a 30-day trial', true);
await tab('Screen'); const code = await page.locator('code', { hasText: /^OSR-/ }).first().innerText();
ok('device code shown', /^OSR(-[2-9A-HJ-NP-Z]{4}){3}$/.test(code), code);
await tab('Live'); await page.getByRole('button', { name: /Turn on live video/ }).click(); await page.waitForTimeout(300);
ok('Pro features work during the trial', !!(await live()).cam);
await page.getByRole('button', { name: /Turn off live video/ }).click();

// the trial runs out
await setState({ trialStart: now() - 31 * 86400 }); await page.reload(); await page.waitForSelector('nav');
await page.waitForSelector('text=FREE · GET PRO'); ok('after 30 days: Free', true);
await tab('Live'); ok('locked features are marked PRO', await page.getByText('PRO', { exact: true }).first().isVisible());
await page.getByRole('button', { name: /Turn on live video/ }).click();
await page.waitForSelector('role=dialog[name="Ɔsɔreɛ Plus Pro"]'); ok('tapping a Pro feature opens the Pro sheet', await page.getByText(/needs Pro: the 30-day trial has ended/).isVisible());
ok('nothing switched on', !(await live()).cam);
await page.getByLabel('Close').click();
await page.getByRole('button', { name: /Turn on live video/ }).click(); await page.getByLabel('Close').click();
// a camera left on from the trial is no longer shown
await setState({ cam: { ...(await state()).cam, on: true }, ticker: { on: true, text: 'Hello', speed: 1 } }); await page.reload(); await page.waitForSelector('nav'); await page.waitForTimeout(500);
let s = await live(); ok('screens drop Pro extras after the trial', !s.cam && !s.ticker, JSON.stringify({ cam: s.cam, ticker: s.ticker }));
await tab('Bible'); await page.getByLabel('Verse or words').fill('jn 3 16'); await page.getByLabel('Verse or words').press('Enter'); s = await live();
ok('free features still work', s.kind === 'verse' && s.groups[0].ref === 'John 3:16');
await tab('Screen'); await page.getByRole('button', { name: /Back up/ }).click(); ok('backup is Pro', await page.locator('role=dialog').isVisible()); await page.getByLabel('Close').click();

// licences
const tryLicence = async (text) => {
  await tab('Screen'); await page.getByRole('button', { name: 'Get Pro or enter a licence' }).click();
  await page.getByLabel('Licence code').fill(text); await page.getByRole('button', { name: 'Activate Pro' }).click(); await page.waitForTimeout(300);
  const err = await page.locator('[role=alert]').innerText().catch(() => '');
  if (await page.locator('role=dialog').isVisible()) await page.getByLabel('Close').click();
  return err;
};
ok('licence for another device refused', /another device/.test(await tryLicence(issue('OSR-2222-3333-4444'))));
const good = issue(code, '--church', 'Grace Chapel');
const [h, body, sig] = good.split('.'); const forged = JSON.parse(Buffer.from(body, 'base64url')); forged.d = code; forged.c = 'Forged'; forged.e = 0;
ok('changed licence refused', /not genuine/.test(await tryLicence(`${h}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`)));
ok('expired licence refused', /ended on/.test(await tryLicence(issue(code, '--until', '2020-01-01'))));
ok('rubbish refused', /not an Ɔsɔreɛ Plus licence/.test(await tryLicence('hello')));
ok('valid licence accepted', (await tryLicence(good)) === '');
await page.waitForSelector('h1 >> text=Pro');
const badge = await page.locator('h1 [aria-label="Pro"]').evaluate((e) => ({ w: getComputedStyle(e).fontWeight, c: getComputedStyle(e).color }));
const [r, g, bl] = badge.c.match(/\d+/g).map(Number);
ok('“Pro” in bold green', +badge.w >= 700 && g > 120 && g > r * 2 && g > bl * 1.4, JSON.stringify(badge));
ok('Pro section names the church', await page.getByText(/Pro is active for Grace Chapel, with no end date/).isVisible());
await page.waitForTimeout(400); ok('Pro features unlocked by the licence (camera left on now shows)', !!(await live()).cam);
await page.reload(); await page.waitForSelector('nav'); await page.waitForSelector('h1 >> text=Pro'); ok('Pro kept after restarting', true);

// a one-year licence shows its end date
const yearly = issue(code, '--years', '1');
await setState({ licence: yearly }); await page.reload(); await page.waitForSelector('nav'); await tab('Screen');
ok('yearly licence shows days left', await page.getByText(/Pro is active, until .* \((36[45]|366) days\)/).isVisible());

// winding the clock back does not stretch the trial
const fresh = await b.newContext({ viewport: { width: 400, height: 860 }, serviceWorkers: 'block' }); const p2 = await fresh.newPage();
await p2.goto(base); await p2.waitForSelector('nav');
await p2.evaluate((t) => { const d = JSON.parse(localStorage.getItem('osoree-plus')); d.state.trialStart = t - 20 * 86400; d.state.lastSeen = t + 15 * 86400; localStorage.setItem('osoree-plus', JSON.stringify(d)); }, now());
await p2.reload(); await p2.waitForSelector('nav');
ok('clock wound back: trial still ends', await p2.getByText('FREE · GET PRO').isVisible());
await fresh.close();

ok('no page errors', errs.length === 0, errs.join(' | '));
console.log(pass, 'passed', fail, 'failed'); await b.close();
process.exit(fail ? 1 : 0);
