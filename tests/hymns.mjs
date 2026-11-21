// Hymn books: importing OpenLyrics / OpenSong / ProPresenter 6 files (single and zipped), finding a hymn by
// number, projecting it, Next, the plan, after a reload, removing a book, the Pro lock, and the store kind on the server.
import { chromium } from '/home/BrandsME/projects/efiewura/node_modules/playwright-core/index.mjs';
import { PGlite } from '@electric-sql/pglite';
import { zipSync, strToU8 } from 'fflate';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { ALPHABET, handle } from '../supabase/functions/osoree/core.js';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, x); };

// ---- fixtures
const dir = path.join(root, 'tests/out/hymn-files'); fs.mkdirSync(dir, { recursive: true });
const openlyrics = `<?xml version="1.0" encoding="UTF-8"?>
<song xmlns="http://openlyrics.info/namespace/2009/song" version="0.9">
  <properties><titles><title>Amazing Grace</title></titles><authors><author>John Newton</author></authors>
    <verseOrder>v1 c v2 c</verseOrder><songbooks><songbook name="Test Hymnal" entry="1"/></songbooks></properties>
  <lyrics>
    <verse name="v1" lang="en"><lines>Amazing grace, how sweet the sound<br/>That saved a wretch like me</lines></verse>
    <verse name="v1" lang="tw"><lines>Twi line one<br/>Twi line two</lines></verse>
    <verse name="c" lang="en"><lines>Praise <chord name="G"/>the Lord<br/>Praise Him evermore</lines></verse>
    <verse name="v2" lang="en"><lines>'Twas grace that taught<br/>My heart to fear</lines></verse>
  </lyrics>
</song>`;
const opensong = `<?xml version="1.0" encoding="UTF-8"?>
<song><title>Rock of Ages</title><author>Augustus Toplady</author><hymn_number>2</hymn_number><presentation>V1 C V2</presentation>
<lyrics>[V]
.G       C
1Rock of ages, cleft for me,
1Let me hide myself in Thee;
2Not the labours of my hands
2Can fulfil Thy law's demands;
[C]
; a comment
 Rock of ages, cleft for me|Let me hide myself in Thee</lyrics></song>`;
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const rtf = String.raw`{\rtf1\ansi{\fonttbl\f0 Arial;}{\colortbl;\red255\green255\blue255;}\f0\fs80 Holy, holy, holy\par Lord God Almighty\u8217?s praise}`;
const pro6 = `<?xml version="1.0" encoding="utf-8"?>
<RVPresentationDocument CCLISongTitle="Holy, Holy, Holy" CCLIAuthor="Reginald Heber">
 <array rvXMLIvarName="groups">
  <RVSlideGrouping name="Verse 1"><array rvXMLIvarName="slides"><RVDisplaySlide><array rvXMLIvarName="displayElements">
   <RVTextElement><NSString rvXMLIvarName="PlainText">${b64('Holy, holy, holy\nEarly in the morning')}</NSString></RVTextElement>
  </array></RVDisplaySlide></array></RVSlideGrouping>
  <RVSlideGrouping name="Verse 2"><array rvXMLIvarName="slides"><RVDisplaySlide><array rvXMLIvarName="displayElements">
   <RVTextElement><NSString rvXMLIvarName="RTFData">${b64(rtf)}</NSString></RVTextElement>
  </array></RVDisplaySlide></array></RVSlideGrouping>
 </array>
</RVPresentationDocument>`;
const files = { '001 Amazing Grace.xml': openlyrics, 'Rock of Ages': opensong, '3 Holy Holy Holy.pro6': pro6 };
for (const [n, t] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), t);
fs.writeFileSync(path.join(dir, 'Golden Bells.zip'), zipSync(Object.fromEntries([...Object.entries(files).map(([n, t]) => ['hymns/' + n, strToU8(t)]), ['__MACOSX/._x', strToU8('junk')], ['readme.txt', strToU8('not a hymn')], ['hymns/notes.xml', strToU8('<notes>not a hymn</notes>')]])));

// ---- the app
const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1148/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, serviceWorkers: 'block' });
await ctx.route('https://inoxsalemgwgrzftamxs.supabase.co/**', (r) => r.abort('internetdisconnected'));
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
page.on('dialog', (d) => d.accept());
const tab = (name) => page.locator('nav button', { hasText: name }).click();
const live = () => page.evaluate(() => JSON.parse(localStorage.getItem('osoree-live')));
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('osoree-plus')).state);
await page.goto('http://127.0.0.1:4871/'); await page.waitForSelector('nav');
await tab('Songs');
await page.getByRole('button', { name: 'Hymns', exact: true }).click();
ok('Hymns view opens empty', await page.getByText('No hymn books yet').isVisible());
await page.getByLabel('Hymn files').setInputFiles(Object.keys(files).map((n) => path.join(dir, n)));
await page.waitForSelector('text=/Added "Test Hymnal": 3 hymns/');
ok('three formats imported into one book named from the songbook', true);
const rows = await page.locator('button:has(span.tabular-nums)').allInnerTexts();
ok('hymns listed by number', rows.length === 3 && /^1\s/.test(rows[0]) && /^2\s/.test(rows[1]) && /^3\s/.test(rows[2]), JSON.stringify(rows));
await page.getByLabel('Find a hymn').fill('2');
ok('number search finds hymn 2 only', (await page.locator('button:has(span.tabular-nums)').count()) === 1 && (await page.locator('button:has(span.tabular-nums)').innerText()).includes('Rock of Ages'));
await page.getByLabel('Find a hymn').fill('');
await page.locator('button:has(span.tabular-nums)', { hasText: 'Amazing Grace' }).click();
const labels = await page.locator('.sm\\:grid-cols-2 button div:first-child').allInnerTexts();
ok('OpenLyrics: verse order v1 c v2 c, first language only', JSON.stringify(labels.map((l) => l.toLowerCase())) === JSON.stringify(['verse 1', 'chorus', 'verse 2', 'chorus']), JSON.stringify(labels));
ok('OpenLyrics: other language left out', !(await page.getByText('Twi line one').count()));
await page.locator('.sm\\:grid-cols-2 button').first().click(); await page.waitForTimeout(300);
let s = await live();
ok('hymn projects with its number', s.kind === 'song' && s.title === '1 Amazing Grace' && s.lines[0] === 'Amazing grace, how sweet the sound', JSON.stringify(s).slice(0, 140));
await page.getByRole('button', { name: 'Next' }).click(); await page.waitForTimeout(300);
s = await live(); ok('Next goes to the chorus (chord marks removed)', s.lines?.[0] === 'Praise the Lord', JSON.stringify(s?.lines));
await page.getByLabel('Add song to plan').click();
await page.getByLabel('All hymns').click();
await page.locator('button:has(span.tabular-nums)', { hasText: 'Rock of Ages' }).click();
const rock = await page.locator('.sm\\:grid-cols-2 button').allInnerTexts();
ok('OpenSong: numbered lines split into verses, chords and comments dropped, | is a new line', rock.length === 3 && rock[0].includes('Rock of ages, cleft for me') && rock[1].includes('Let me hide myself in Thee') && rock[2].includes('Not the labours') && !rock.join().includes('a comment') && !rock.join().includes('.G'), JSON.stringify(rock));
await page.getByLabel('All hymns').click();
await page.locator('button:has(span.tabular-nums)', { hasText: 'Holy' }).click();
const holy = await page.locator('.sm\\:grid-cols-2 button').allInnerTexts();
ok('ProPresenter 6: plain text and RTF slides', holy.length === 2 && holy[0].includes('Early in the morning') && holy[1].includes('Lord God Almighty’s praise') && !holy[1].includes('Arial'), JSON.stringify(holy));
await tab('Plan');
ok('hymn in the plan by number and title', await page.getByText('1 Amazing Grace').first().isVisible());

// after a reload the book comes back from storage and the screen still shows the hymn
await page.reload(); await page.waitForSelector('nav'); await page.waitForTimeout(800);
s = await live(); ok('after reload the projected hymn is still there', s.kind === 'song' && s.title === '1 Amazing Grace', JSON.stringify(s).slice(0, 100));
ok('hymn book kept as a short list (texts in IndexedDB)', (await state()).hymnals.length === 1 && !JSON.stringify(await state()).includes('Praise Him evermore'));

// a zip becomes a second book named after the zip
await tab('Songs');
await page.getByLabel('Hymn files').setInputFiles(path.join(dir, 'Golden Bells.zip'));
await page.waitForSelector('text=/Added "Golden Bells": 3 hymns. 1 file was not hymns/');
ok('zip imported, junk files ignored', (await page.getByLabel('Hymn book').locator('option').count()) === 2);
await page.getByLabel('Remove this hymn book').click(); await page.waitForTimeout(300);
ok('hymn book removed', (await page.getByLabel('Hymn book').locator('option').count()) === 1);
ok('first book still projecting', (await live()).title === '1 Amazing Grace');

// a whole hymn book in one Zefania XML file (CHAPTER = hymn, VERS = stanza, "Nnyeso:" = chorus, "n.a." = and so on)
const zef = `\uFEFF<?xml version="1.0" encoding="utf-8"?>
<XMLBIBLE biblename="Test Twi Hymns" type="x-bible"><INFORMATION><title>Test Twi Hymns</title><subject>Hymns</subject><language>TWI</language></INFORMATION>
<BIBLEBOOK bnumber="1" bname="Test Twi Hymns">
<CHAPTER cnumber="1"><CAPTION vref="1">Dw. 23</CAPTION><CAPTION vref="1">! ! ! O.A.B., 1964</CAPTION>
<VERS vnumber="1">Monkamfo Nyankopɔn
mo anom ne koma mu.
Nnyesyesyeso:yeso:o: Ayeyi nka no
daa daa nyinaa.</VERS>
<VERS vnumber="2">Yɛn nkwamafo ne no,
ahohia mu gyefo;
Nnyeso: Ayeyi n.a.Nnyeso:</VERS></CHAPTER>
<CHAPTER cnumber="2"><VERS vnumber="1">Mɛto dwom mama Onyame
Nneɛma nneɛma sen akɔ,
na wɔnne me Nyame dɔ.
3. Ne Bakoro a ɔdɔ no
Nneɛma nneɛma n.a.</VERS></CHAPTER>
</BIBLEBOOK></XMLBIBLE>`;
fs.writeFileSync(path.join(dir, 'TEST_PHB.xml'), zef);
await page.getByLabel('Hymn files').setInputFiles(path.join(dir, 'TEST_PHB.xml'));
await page.waitForSelector('text=/Added "Test Twi Hymns": 2 hymns/');
ok('Zefania hymn book imported (one file, many hymns)', true);
await page.getByLabel('Find a hymn').fill('1');
await page.locator('button:has(span.tabular-nums)', { hasText: 'Monkamfo' }).click();
const zh = await page.locator('.sm\\:grid-cols-2 button').allInnerTexts();
ok('Zefania: full chorus after every stanza, garbled marks and "n.a." gone', zh.length === 4 && zh[1].includes('Ayeyi nka no') && zh[3].includes('daa daa nyinaa') && !/Nny|n\.a/.test(zh.join()), JSON.stringify(zh));
ok('Zefania: credits shown under the title', await page.getByText('Dw. 23 · O.A.B., 1964').isVisible());
await page.getByLabel('All hymns').click();
await page.getByLabel('Find a hymn').fill('2');
await page.locator('button:has(span.tabular-nums)', { hasText: 'Mɛto dwom' }).click();
const z2 = await page.locator('.sm\\:grid-cols-2 button').allInnerTexts();
ok('Zefania: "3." splits a merged stanza; "n.a." refrain filled from the first stanza', z2.length === 2 && z2[1].includes('na wɔnne me Nyame dɔ') && !z2[1].includes('n.a'), JSON.stringify(z2));
await page.getByLabel('All hymns').click();

// trial over: hymns need Pro
await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('osoree-plus')); d.state.trialStart = Math.floor(Date.now() / 1000) - 400 * 86400; localStorage.setItem('osoree-plus', JSON.stringify(d)); });
await page.reload(); await page.waitForSelector('text=FREE · GET PRO'); await page.waitForTimeout(500);
s = await live(); ok('trial over: hymn taken off the screen', s.kind !== 'song', s.kind);
await tab('Songs');
ok('trial over: Hymns locked with Get Pro', await page.getByText('Hymn books are part of Pro').isVisible());
await page.getByLabel('Songs or hymns').getByRole('button', { name: 'Songs' }).click();
ok('own songs still free', await page.getByText('Amazing Grace').first().isVisible());
await page.screenshot({ path: 'tests/out/hymns.png' });
ok('no page errors', !errs.length, errs.join(' | '));
await b.close();

// ---- the store on the server: a hymn book item
const pg = new PGlite();
for (const f of fs.readdirSync(path.join(root, 'supabase/migrations')).sort()) await pg.exec(fs.readFileSync(path.join(root, 'supabase/migrations', f), 'utf8'));
const d = {
  query: async (t, p = []) => (await pg.query(t, p)).rows, now: () => new Date(), env: (k) => ({ SUPER_ADMIN_EMAIL: 'boss@example.com' })[k] || '',
  random: (n) => Array.from(crypto.randomBytes(n), (x) => ALPHABET[x % 32]).join(''),
  storage: { signDownload: async (p) => `https://files.example/get/${p}`, signUpload: async (p) => ({ url: `https://files.example/put/${p}` }) },
};
const boss = { id: '00000000-0000-0000-0000-00000000000b', email: 'boss@example.com', email_confirmed_at: '2026-11-12T10:00:00Z' };
await handle(d, 'admin/claim', {}, { user: boss });
const { id } = await handle(d, 'admin/storeSave', { kind: 'hymnal', title: 'Golden Bells', price: 50, price_usd: 4, active: true, copyright: 'Public domain' }, { user: boss });
ok('server: hymn book item saved', /^H[A-Z0-9]{9}$/.test(id), id);
const up = await handle(d, 'admin/storeUploadUrl', { id, type: 'hymnal-json-gz' }, { user: boss });
ok('server: hymn book uploads as json.gz', /^hymnal\/H[A-Z0-9]+-[A-Z0-9]+\.json\.gz$/.test(up.path), up.path);
await handle(d, 'admin/storeFileDone', { id, path: up.path, type: 'hymnal-json-gz', size: 1234 }, { user: boss });
const cfg = await handle(d, 'config', {});
ok('server: hymns is a Pro feature', cfg.pro.includes('hymns'), JSON.stringify(cfg.pro));
console.log(`${pass} passed ${fail} failed`);
process.exit(fail ? 1 : 0);
