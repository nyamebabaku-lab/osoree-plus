// Browser tests for the operator app and the screen page. Run with tests/run-e2e.sh
import { chromium } from '/home/BrandsME/projects/efiewura/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const fx = (f) => path.join(here, 'fixtures', f);
const out = (f) => path.join(here, 'out', f);
const base = 'http://127.0.0.1:4871/';

const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1148/chrome-linux/chrome', args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, serviceWorkers: 'block', acceptDownloads: true });
// No licence server in these tests: the phone is offline as far as the server is concerned.
await ctx.route('https://inoxsalemgwgrzftamxs.supabase.co/**', (r) => r.abort('internetdisconnected'));
const page = await ctx.newPage();
const errs = [];
const watch = (p, tag) => {
  p.on('pageerror', (e) => errs.push(tag + ': ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !(m.location()?.url || '').includes('supabase.co') && !/ERR_INTERNET_DISCONNECTED/.test(m.text()) && errs.push(tag + ': ' + m.text()));
  p.on('response', (r) => { if (r.status() >= 400) errs.push(tag + ' ' + r.status() + ' ' + r.url()); });
};
watch(page, 'op');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'PASS' : 'FAIL', name, extra); };
const live = () => page.evaluate(() => JSON.parse(localStorage.getItem('osoree-live')));
const shot = async (p, f) => { await p.bringToFront(); await p.waitForTimeout(450); await p.screenshot({ path: out(f) }); };
const tab = (name) => page.locator('nav button', { hasText: name }).click();
const pickVersion = async (text) => page.getByLabel('Bible version').selectOption(await page.getByLabel('Bible version').locator('option', { hasText: text }).first().getAttribute('value'));

await page.goto(base); await page.waitForSelector('text=Old Testament');
// Test media made in the browser: a picture and a short video.
const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 640; c.height = 360; const g = c.getContext('2d'); g.fillStyle = '#1d4ed8'; g.fillRect(0, 0, 640, 360); g.fillStyle = '#fff'; g.font = 'bold 60px sans-serif'; g.fillText('CHURCH LOGO', 90, 200); return c.toDataURL('image/png').split(',')[1]; });
fs.writeFileSync(out('logo.png'), Buffer.from(png, 'base64'));
const webm = await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d');
  const rec = new MediaRecorder(c.captureStream(25), { mimeType: 'video/webm' }); const parts = []; rec.ondataavailable = (e) => parts.push(e.data);
  rec.start(); let i = 0; await new Promise((r) => { const t = setInterval(() => { g.fillStyle = `hsl(${i * 12},70%,40%)`; g.fillRect(0, 0, 320, 180); if (++i > 50) { clearInterval(t); r(); } }, 40); });
  rec.stop(); await new Promise((r) => (rec.onstop = r));
  const buf = await new Blob(parts).arrayBuffer(); let s = ''; new Uint8Array(buf).forEach((x) => (s += String.fromCharCode(x))); return btoa(s);
});
fs.writeFileSync(out('clip.webm'), Buffer.from(webm, 'base64'));

const screen = await ctx.newPage(); watch(screen, 'screen'); await screen.setViewportSize({ width: 1280, height: 720 }); await screen.goto(base + 'display.html');
const inp = page.getByLabel('Verse or words');
let s;

// ---------- Bible basics ----------
await inp.fill('jn 3 16'); await inp.press('Enter'); s = await live();
ok('verse live', s.kind === 'verse' && s.groups[0].ref === 'John 3:16');
await screen.waitForFunction(() => document.querySelector('.text')?.textContent.startsWith('For God so loved') && document.getElementById('wrap').style.opacity === '1'); ok('screen shows verse', true);
await page.getByLabel('Next', { exact: true }).click(); s = await live(); ok('next', s.groups[0].ref === 'John 3:17');
await page.getByLabel('Previous', { exact: true }).click(); s = await live(); ok('previous', s.groups[0].ref === 'John 3:16');
await page.getByRole('button', { name: 'Black' }).click(); s = await live(); ok('black', s.kind === 'black');
await page.getByRole('button', { name: 'Black' }).click(); await page.getByRole('button', { name: 'Clear' }).click(); s = await live(); ok('clear → idle', s.kind === 'idle');
await page.getByRole('button', { name: 'Clear' }).click(); s = await live(); ok('clear off', s.kind === 'verse');
await inp.fill('jude 3'); await inp.press('Enter'); s = await live(); ok('one-chapter book', s.groups[0].ref === 'Jude 1:3');
await inp.fill('jn 3 16-18'); await inp.press('Enter'); s = await live(); ok('typed range', s.groups[0].ref === 'John 3:16-18' && s.groups[0].cols[0].verses.length === 3);
await page.getByLabel('Next', { exact: true }).click(); s = await live(); ok('next keeps block size', s.groups[0].ref === 'John 3:19-21');
await inp.fill('jn 3 99'); ok('bad verse message', await page.getByText('John 3 has 36 verses').isVisible());

// ---------- combined references + compare ----------
await inp.fill('jn 3 16; rom 5 8'); await inp.press('Enter'); s = await live();
ok('combined refs', s.groups.length === 2 && s.groups[1].ref === 'Romans 5:8');
await inp.fill('rom 5 8; 6 23'); await inp.press('Enter'); s = await live(); ok('same-book shorthand', s.groups[1]?.ref === 'Romans 6:23');
await page.getByLabel('Compare with another version').selectOption('bsb'); await page.waitForFunction(() => JSON.parse(localStorage.getItem('osoree-live')).groups?.[0]?.cols?.length === 2, null, { timeout: 8000 }).catch(() => {}); s = await live();
ok('combined + compare', s.groups.every((g) => g.cols.length === 2 && g.cols[1].abbr === 'BSB'));
await page.getByLabel('Compare with another version').selectOption('');
await inp.fill('ps 23'); await inp.press('Enter'); await page.waitForSelector('text=Chapter 23');
await page.getByRole('button', { name: 'Clear' }).click(); await page.getByRole('button', { name: /^Combine/ }).click();
await page.getByRole('button', { name: /^1\s*A Psalm of David/ }).click(); await page.getByRole('button', { name: /^4\s*Yea/ }).click(); s = await live();
ok('combine by tapping', s.groups.length === 2 && s.groups[1].ref === 'Psalms 23:4');
await page.getByRole('button', { name: /^Combine/ }).click();
await inp.fill('charity never faileth'); await page.waitForSelector('text=1 Corinthians 13:8'); ok('word search', true);
await inp.fill('');

// ---------- Strong's ----------
await page.getByLabel('Bible version').selectOption('kjvs');
await inp.fill('jn 3 16'); await inp.press('Enter'); s = await live();
ok("Strong's version shows plain text", s.groups[0].cols[0].abbr === 'KJV+' && s.groups[0].cols[0].verses[0].t.startsWith('For God so loved') && !s.groups[0].cols[0].verses[0].t.includes('|'));
await page.locator('[role=button]', { hasText: /^16\s*For God/ }).getByRole('button', { name: 'loved', exact: true }).click();
await page.waitForSelector('text=ἀγαπάω'); ok("tap word shows Greek", await page.getByText('agapáō').isVisible());
await shot(page, 'strongs-sheet.png');
await page.getByRole('button', { name: 'Other verses' }).click(); await page.waitForSelector('text=verses with G25'); ok('other verses with the word', true);
await page.getByRole('button', { name: 'Show on screen' }).click(); s = await live();
ok("Strong's entry live", s.kind === 'strongs' && s.entry.num === 'G25' && s.word === 'loved' && s.ref === 'John 3:16');
await screen.waitForFunction(() => document.querySelector('.lemma')?.textContent === 'ἀγαπάω'); await shot(screen, 'strongs-screen.png');
await inp.fill('gen 1 1'); await inp.press('Enter'); await page.getByRole('button', { name: 'beginning', exact: true }).first().click();
await page.waitForSelector('text=rêʼshîyth'); ok('Hebrew word', await page.getByText('Hebrew · H7225').isVisible()); await page.getByLabel('Close').click();
await page.getByRole('button', { name: "Strong's on" }).click(); ok("Strong's can be turned off", await page.getByRole('button', { name: 'beginning', exact: true }).count() === 0);
await page.getByRole('button', { name: "Strong's off" }).click();
await page.getByLabel('Bible version').selectOption('kjv');

// ---------- Bibles from XML: several at once, own book names, NT-only ----------
await tab('Screen');
await page.setInputFiles('input[type=file][accept^=".xml"]', fx('bibles.zip'));
await page.waitForSelector('text=/Added GA-TEST/'); ok('zip with two XML Bibles (junk skipped)', await page.getByText('Added GA-TEST, Test Twi Bible.').isVisible());
await page.setInputFiles('input[type=file][accept^=".xml"]', [fx('LATIN1-TEST.xml'), fx('DAMAGED-TEST.xml'), fx('EMPTYBOOK-TEST.xml')]);
await page.waitForSelector('text=/this file is damaged/');
ok('empty book reported', await page.getByText('Empty Book Test Bible: Daniel has no text in this file.', { exact: false }).isVisible());
ok('damaged file: rest imported, missing chapters named', await page.getByText(/Damaged Test Bible: this file is damaged, so some text is missing \(Ezekiel 5–22\)/).isVisible());
await pickVersion('Latin One Test Bible');
await tab('Bible'); await inp.fill('jn 3 16'); await inp.press('Enter'); s = await live();
ok('older text encoding read correctly', s.groups[0].cols[0].verses[0].t === 'Café fiancé 3:16', s.groups[0].cols[0].verses[0].t);
await pickVersion('Damaged Test Bible');
await inp.fill('ezek 4 19'); await inp.press('Enter'); s = await live(); ok('verses before the damage kept', s.groups[0].cols[0].verses[0].t === 'Ezekiel 4:19 text');
await inp.fill('ezek 23 1'); await inp.press('Enter'); s = await live(); ok('verses after the damage kept', s.groups[0].cols[0].verses[0].t === 'Ezekiel 23:1 text');
await inp.fill('ezek 10 1'); ok('lost chapter explained', await page.getByText('Ezekiel 10 is not in this version').isVisible());
await tab('Screen');
await page.getByLabel('Bible version').selectOption({ label: 'TWI-TEST · Test Twi Bible' });
await tab('Bible');
await inp.fill('yohane 3 16'); await page.waitForSelector('text=SHOW'); await inp.press('Enter'); s = await live();
ok('type the Bible’s own book name', s.groups[0].ref === 'Yohane 3:16' && s.groups[0].cols[0].verses[0].t.includes('Ɔdɔ'), s.groups[0].ref);
await inp.fill('romafoɔ 1 1'); await inp.press('Enter'); s = await live(); ok('book name with ɔ', s.groups[0].ref === 'Romafoɔ 1:1', s.groups[0].ref);
await inp.fill('jn 3 16'); await inp.press('Enter'); s = await live(); ok('English names still work', s.groups[0].ref === 'Yohane 3:16');
await page.getByLabel('Compare with another version').selectOption('kjv'); await page.waitForTimeout(300); s = await live();
ok('compare uses each version’s names', s.groups[0].cols[0].ref === 'Yohane 3:16' && s.groups[0].cols[1].ref === 'John 3:16');
await shot(screen, 'twi-compare.png');
await page.getByLabel('Compare with another version').selectOption('');
await page.getByLabel('Bible version').selectOption({ label: 'GA-TEST · GA-TEST' });
await inp.fill('jn 3 16'); await inp.press('Enter'); s = await live();
ok('New Testament-only file maps to the right books', s.groups[0].ref === 'Yohane 3:16' && s.groups[0].cols[0].verses[0].t === 'Ga Yohane 3:16', JSON.stringify(s.groups[0].cols[0].verses[0]));
await inp.fill('gen 1 1'); ok('missing Old Testament explained', await page.getByText('Genesis is not in this version').isVisible());
await page.getByLabel('Bible version').selectOption('kjv');

// ---------- songs ----------
await tab('Songs'); await page.getByText('Amazing Grace').click();
await page.getByRole('button', { name: /^Verse 1 Amazing grace/ }).click(); s = await live();
ok('song slide live', s.kind === 'song' && s.lines[0].startsWith('Amazing grace'));
await page.keyboard.press('ArrowRight'); s = await live(); ok('arrow key next slide', s.lines[0].startsWith("'Twas grace"));
await page.getByLabel('Add song to plan').click(); await page.getByLabel('All songs').click();
await page.setInputFiles('input[type=file][accept^=".txt"]', fx('Yesu Ne Me Hwɛfoɔ.txt')); await page.waitForSelector('text=Added 1 song');
await page.getByText('Yesu Ne Me Hwɛfoɔ').first().click(); await page.getByRole('button', { name: /^Verse 1 Ɔdɔ/ }).click(); s = await live(); ok('Twi song live', s.lines[0] === 'Ɔdɔ a ɛwɔ wo mu');

// ---------- media + PDF ----------
await tab('Media');
await page.setInputFiles('input[type=file][accept^="image"]', [out('logo.png'), out('clip.webm'), fx('slides.pdf')]);
await page.waitForSelector('text=Added 3 files', { timeout: 30000 }); ok('picture, video and PDF added', true);
await page.getByText('slides', { exact: true }).click();
ok('PDF has 3 pages', await page.getByLabel('Page 3').isVisible());
await page.getByLabel('Page 1').click(); s = await live(); ok('PDF page live', s.kind === 'media' && s.media.kind === 'image' && s.media.src.endsWith('-p1'));
await screen.waitForFunction(() => document.querySelector('#media img')?.naturalWidth > 1000).then(() => ok('PDF page on screen (sharp)', true), () => ok('PDF page on screen (sharp)', false));
await shot(screen, 'pdf-page.png');
await page.getByRole('button', { name: 'Add to plan' }).click(); await page.getByLabel('Close').click();
await page.getByLabel('Next', { exact: true }).click(); s = await live(); ok('PDF next page', s.media.src.endsWith('-p2'));
await page.getByLabel('Next', { exact: true }).click(); await page.getByLabel('Next', { exact: true }).isDisabled().then((d) => ok('stops at last page', d));
ok('live title shows page', await page.getByText('slides · page 3 of 3').isVisible());
await page.getByText('logo', { exact: true }).click(); await page.getByRole('button', { name: 'Show on screen' }).click();
await screen.waitForFunction(() => document.querySelector('#media img')?.naturalWidth === 640); ok('picture on screen', true);
await page.getByText('clip', { exact: true }).click(); await page.getByRole('button', { name: 'Show on screen' }).click();
await screen.waitForFunction(() => { const v = document.querySelector('#media video'); return v && v.currentTime > 0.2; }, null, { timeout: 8000 }).then(() => ok('video plays', true), () => ok('video plays', false));
await page.getByRole('button', { name: 'Pause' }).click(); await screen.waitForTimeout(300); ok('pause', await screen.evaluate(() => document.querySelector('#media video').paused));

// ---------- PowerPoint, Word, Excel, CSV ----------
await page.setInputFiles('input[type=file][accept^="image"]', [fx('worship.pptx'), fx('notes.docx'), fx('accounts.xlsx'), fx('rota.csv')]);
await page.waitForSelector('text=Added 4 files', { timeout: 90000 }).then(() => ok('PowerPoint, Word, Excel and CSV added', true), async () => ok('PowerPoint, Word, Excel and CSV added', false, await page.locator('main').innerText().then((t) => t.slice(0, 300))));
const docs = await page.evaluate(() => JSON.parse(localStorage.getItem('osoree-plus')).state.media.filter((m) => m.format).map((m) => `${m.name}:${m.format}:${m.pages.length}`));
ok('slides 3, Word 2 pages, Excel 3 pages (hidden sheet skipped), CSV 1', ['worship:pptx:3', 'notes:docx:2', 'accounts:xlsx:3', 'rota:csv:1'].every((x) => docs.includes(x)), docs.join(' '));
await page.locator('button', { hasText: 'worship' }).last().click();
await page.getByLabel('Page 1').click(); s = await live(); ok('PowerPoint slide live', s.kind === 'media' && s.media.kind === 'image');
await screen.waitForFunction(() => document.querySelector('#media img')?.naturalWidth >= 1900).then(() => ok('slide is full HD', true), () => ok('slide is full HD', false));
const px = await screen.evaluate(() => { const i = document.querySelector('#media img'); const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; const g = c.getContext('2d'); g.drawImage(i, 0, 0); const d = g.getImageData(40, 40, 1, 1).data; return [d[0], d[1], d[2]]; });
ok('slide background colour kept', Math.abs(px[0] - 0x0b) < 20 && Math.abs(px[1] - 0x1f) < 20 && Math.abs(px[2] - 0x3a) < 20, px.join(','));
await shot(screen, 'pptx-slide.png');
await page.getByLabel('Close').click();
// adjustable view on a Word page
await page.locator('button', { hasText: 'notes' }).last().click(); await page.getByLabel('Page 1').click(); await page.getByLabel('Close').click();
const tf = () => screen.evaluate(() => document.querySelector('#media img')?.style.transform || '');
await page.getByLabel('Zoom in').click(); await screen.waitForTimeout(300);
ok('zoom in', (await tf()).includes('scale(1.25)'), await tf());
await page.getByRole('button', { name: 'Fit width' }).click(); await screen.waitForTimeout(300); s = await live();
const docImg = await screen.evaluate(() => { const i = document.querySelector('#media img'); return i.naturalWidth / i.naturalHeight; });
ok('fit width fills the screen width from the top', Math.abs(s.view.zoom - (16 / 9) / docImg) < 0.05 && Math.abs(s.view.y - (s.view.zoom - 1) * 50) < 0.5, JSON.stringify(s.view));
await shot(screen, 'docx-fit-width.png');
await page.getByLabel('Next', { exact: true }).click(); s = await live();
ok('next page keeps the zoom, from the top', s.media.src.endsWith('-p2') && s.view.zoom > 1.5 && Math.abs(s.view.y - (s.view.zoom - 1) * 50) < 0.5, JSON.stringify(s.view));
const pv = page.getByLabel('Drag to move, pinch to zoom'); const bb = await pv.boundingBox();
await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down(); await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2 - 60, { steps: 5 }); await page.mouse.up(); s = await live();
ok('drag on the preview moves the page', s.view.y < (s.view.zoom - 1) * 50 - 5, JSON.stringify(s.view));
await page.getByRole('button', { name: 'Fit page' }).click(); s = await live(); ok('fit page', s.view.zoom === 1 && s.view.x === 0 && s.view.y === 0);
await page.locator('button', { hasText: 'accounts' }).last().click(); await page.getByLabel('Page 1').click(); await page.getByLabel('Close').click();
await shot(screen, 'xlsx-page.png');
await page.setInputFiles('input[type=file][accept^="image"]', fx('old.ppt'));
await page.waitForSelector('text=/older file type/').then(() => ok('old .ppt explained', true), () => ok('old .ppt explained', false));

// ---------- background blend + idle ----------
await page.getByText('logo', { exact: true }).click(); await page.getByRole('button', { name: 'Use as idle screen' }).click(); await page.getByRole('button', { name: 'Behind verses & songs' }).click(); await page.getByLabel('Close').click();
await tab('Screen');
await page.getByRole('group', { name: 'Background' }).getByLabel('#3a0d12').click();
await page.getByLabel('Blend picture into background colour').fill('0.7'); s = await live(); ok('blend value sent', Math.abs(s.style.blend - 0.7) < 0.01 && s.style.bg === '#3a0d12');
await tab('Bible'); await inp.fill('ps 23 1'); await inp.press('Enter'); await screen.waitForTimeout(600);
const blend = await screen.evaluate(() => { const d = getComputedStyle(document.getElementById('dim')); return { bg: d.backgroundColor, op: +d.opacity }; });
ok('picture blends into the chosen colour', blend.bg === 'rgb(58, 13, 18)' && Math.abs(blend.op - 0.7) < 0.01, JSON.stringify(blend));
await shot(screen, 'blend.png');
await page.getByRole('button', { name: 'Clear' }).click(); s = await live(); ok('idle picture', s.kind === 'idle' && s.idle?.kind === 'image');

// ---------- look ----------
await tab('Screen'); await page.getByRole('button', { name: 'Montserrat' }).click(); await page.getByRole('button', { name: 'Justify' }).click(); s = await live();
ok('font + justify', s.style.font.includes('Montserrat') && s.style.align === 'justify');
await page.getByRole('button', { name: 'Reset' }).click();

// ---------- backup / restore ----------
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Back up' }).click()]);
const backupPath = out('backup.json'); await dl.saveAs(backupPath);
const bk = JSON.parse(fs.readFileSync(backupPath, 'utf8')); ok('backup has Bibles and songs', bk.bibles.length === 5 && bk.songs.some((x) => x.title === 'Yesu Ne Me Hwɛfoɔ'), `${bk.bibles.length} bibles, ${bk.songs.length} songs`);
const fresh = await b.newContext({ viewport: { width: 400, height: 860 }, serviceWorkers: 'block' }); await fresh.route('https://inoxsalemgwgrzftamxs.supabase.co/**', (r) => r.abort('internetdisconnected')); const p2 = await fresh.newPage(); watch(p2, 'fresh');
await p2.goto(base); await p2.waitForSelector('nav'); await p2.locator('nav button', { hasText: 'Screen' }).click();
await p2.setInputFiles('input[type=file][accept^=".json"]', backupPath); await p2.waitForSelector('text=/Restored 5 Bibles/');
ok('restore on another device', await p2.getByLabel('Bible version').locator('option', { hasText: 'Test Twi Bible' }).count() === 1);
await p2.locator('nav button', { hasText: 'Songs' }).click(); ok('restored songs', await p2.getByText('Yesu Ne Me Hwɛfoɔ').first().isVisible());
await p2.setInputFiles('input[type=file][accept^=".json"]', fx('slides.pdf')).catch(() => {});
await fresh.close();

// ---------- live video + lower thirds ----------
await tab('Live');
await page.getByRole('button', { name: 'Turn on live video' }).click(); await page.waitForTimeout(500); s = await live();
ok('live video on', !!s.cam && s.cam.source === 'device');
ok('camera listed', await page.getByLabel('Camera').locator('option').count() >= 2);
await screen.waitForFunction(() => { const v = document.querySelector('#cam video'); return v && v.videoWidth > 0 && getComputedStyle(document.getElementById('cam')).opacity === '1'; }, null, { timeout: 8000 })
  .then(() => ok('camera fills the screen', true), () => ok('camera fills the screen', false));
await tab('Bible'); await inp.fill('jn 3 16; rom 5 8'); await inp.press('Enter'); await screen.waitForTimeout(700);
const lt1 = await screen.evaluate(() => ({ on: document.getElementById('lt').className.includes('on'), text: document.querySelector('#lttext .lmain')?.textContent, label: document.querySelector('#lttext .lref')?.textContent, h: document.getElementById('ltbox').offsetHeight, stage: getComputedStyle(document.getElementById('wrap')).opacity }));
ok('verses as lower third', lt1.on && lt1.text.startsWith('For God so loved') && lt1.label.includes('John 3:16') && lt1.label.includes('Romans 5:8') && lt1.stage === '0', JSON.stringify(lt1).slice(0, 160));
ok('lower third stays in the bottom third', lt1.h <= 720 * 0.33, String(lt1.h));
await shot(screen, 'live-verse.png');
await tab('Songs'); await page.getByText('Amazing Grace').first().click(); await page.getByRole('button', { name: /^Verse 1 Amazing grace/ }).click(); await screen.waitForTimeout(500);
ok('song as lower third', (await screen.locator('#lttext .lmain').textContent()).startsWith('Amazing grace! How sweet the sound / That saved'));
await tab('Live');
await page.getByRole('button', { name: 'Add', exact: true }).click(); await page.getByLabel('Name', { exact: true }).fill('Rev. Kwame Mensah'); await page.getByLabel('Title', { exact: true }).fill('Senior Pastor'); await page.getByRole('button', { name: 'Save' }).click();
const ntBox = () => screen.evaluate(() => { const r = document.getElementById('ntbox').getBoundingClientRect(); const l = document.getElementById('ltbox').getBoundingClientRect(); return { on: document.getElementById('nt').className === 'on', name: document.getElementById('ntname').textContent, left: Math.round(r.left), right: Math.round(innerWidth - r.right), bottom: Math.round(innerHeight - r.bottom), top: Math.round(r.top), w: Math.round(r.width), font: parseFloat(document.getElementById('nt').style.fontSize), ltTop: Math.round(l.top) }; });
await page.getByRole('button', { name: /^Rev. Kwame Mensah Senior/ }).click(); s = await live();
ok('name tag lies over what is showing', s.kind === 'song' && s.nametag?.name === 'Rev. Kwame Mensah' && s.nametag.title === 'Senior Pastor', s.kind);
await screen.waitForTimeout(500); let nb = await ntBox();
ok('name tag small at the bottom left', nb.on && nb.name === 'Rev. Kwame Mensah' && nb.left < 1280 * 0.05 && nb.w < 1280 * 0.5, JSON.stringify(nb));
ok('name tag stays above the song bar', nb.bottom > 720 - nb.ltTop, JSON.stringify(nb));
ok('song bar still showing with the tag', (await screen.locator('#lttext .lmain').textContent()).startsWith('Amazing grace'));
await page.getByLabel('Announcement text').fill('Welcome to all visitors · Bible study on Wednesday at 6pm');
await page.getByRole('group', { name: 'Ticker' }).getByRole('button', { name: 'On' }).click(); await screen.waitForTimeout(400);
ok('ticker runs', await screen.evaluate(() => document.getElementById('ticker').className === 'on' && document.getElementById('tickertext').textContent.startsWith('Welcome') && document.getElementById('lt').className.includes('with-ticker')));
await page.getByLabel('Bar see-through').fill('0.5'); await screen.waitForTimeout(300);
ok('bar see-through', (await screen.evaluate(() => document.getElementById('ltbg').style.background)).includes('0.5'));
nb = await ntBox(); ok('name tag stays above the ticker', nb.bottom > 720 * 0.062, JSON.stringify(nb));
await shot(screen, 'live-name.png');
// name tag position and size
const ntSec = page.locator('section', { hasText: 'Name tag position' });
await ntSec.getByLabel('From the side', { exact: true }).fill('20'); await screen.waitForTimeout(300); nb = await ntBox();
ok('name tag moves from the side', Math.abs(nb.left - 256) < 4, String(nb.left));
await page.getByRole('group', { name: 'Name tag position' }).getByRole('button', { name: 'Right' }).click(); await screen.waitForTimeout(300); nb = await ntBox();
ok('name tag on the right', Math.abs(nb.right - 256) < 4, String(nb.right));
await page.getByRole('group', { name: 'Name tag position' }).getByRole('button', { name: 'Centre' }).click(); await screen.waitForTimeout(300); nb = await ntBox();
ok('name tag centred', Math.abs(nb.left - nb.right) < 4, JSON.stringify(nb));
await ntSec.getByLabel('Size', { exact: true }).fill('0.07'); await screen.waitForTimeout(300); nb = await ntBox();
ok('name tag size', Math.abs(nb.font - 0.07 * 720) < 1, String(nb.font));
await ntSec.getByRole('button', { name: 'Reset' }).click(); await screen.waitForTimeout(300);
await page.getByRole('button', { name: /^Rev. Kwame Mensah Senior/ }).click(); await screen.waitForTimeout(400);
ok('tap again hides the name tag', !(await ntBox()).on && !(await live()).nametag);
await page.getByRole('button', { name: /^Rev. Kwame Mensah Senior/ }).click();
// church logo watermark
await page.getByRole('group', { name: 'Watermark picture' }).getByLabel('logo').click();
await screen.waitForFunction(() => getComputedStyle(document.getElementById('wm')).opacity !== '0' && document.querySelector('#wm img').naturalWidth > 0).then(() => ok('watermark shows on screens by default', true), () => ok('watermark shows on screens by default', false));
ok('watermark in the phone preview', await page.frameLocator('iframe').locator('#wm').evaluate((e) => getComputedStyle(e).opacity !== '0'));
await page.getByRole('group', { name: 'Watermark corner' }).getByRole('button', { name: '↘' }).click();
const wmSec = page.locator('section', { hasText: 'Church logo watermark' });
await wmSec.getByLabel('Size', { exact: true }).fill('0.2'); await wmSec.getByLabel('From the side', { exact: true }).fill('10'); await wmSec.getByLabel('From the bottom', { exact: true }).fill('5');
await screen.waitForTimeout(400);
const wmBox = await screen.evaluate(() => { const r = document.getElementById('wm').getBoundingClientRect(); return { right: Math.round(innerWidth - r.right), bottom: Math.round(innerHeight - r.bottom), w: Math.round(r.width) }; });
ok('watermark size and position follow the sliders', Math.abs(wmBox.w - 256) < 3 && Math.abs(wmBox.right - 128) < 3 && Math.abs(wmBox.bottom - (36 + 45)) < 4, JSON.stringify(wmBox));
await shot(screen, 'live-watermark.png');
await page.getByRole('group', { name: 'Watermark shows on' }).getByRole('button', { name: 'Stream only' }).click();
await screen.waitForFunction(() => getComputedStyle(document.getElementById('wm')).opacity === '0', null, { timeout: 3000 }).then(() => ok('watermark can be kept to the stream only', true), () => ok('watermark can be kept to the stream only', false));
// picture-in-picture box over the live video
await tab('Media'); await page.getByText('clip', { exact: true }).click(); await page.getByRole('button', { name: 'In a box' }).click(); s = await live();
ok('video in a box over the live picture', !!s.pip && s.pip.kind === 'video' && !!s.cam && s.kind !== 'media', s.kind);
await screen.waitForFunction(() => { const v = document.querySelector('#pip video'); return v && v.currentTime > 0.2 && getComputedStyle(document.getElementById('pip')).opacity === '1'; }, null, { timeout: 8000 }).then(() => ok('box video plays', true), () => ok('box video plays', false));
ok('verse/song bar still showing with the box', (await screen.evaluate(() => document.getElementById('lt').className)).includes('on'));
ok('bars and tags stay above the box', await screen.evaluate(() => ['lt', 'ticker', 'nt'].every((id) => +getComputedStyle(document.getElementById(id)).zIndex > +getComputedStyle(document.getElementById('pip')).zIndex)));
await tab('Live');
const pipSec = page.locator('section', { hasText: 'Picture-in-picture box' });
await pipSec.getByLabel('Size', { exact: true }).fill('40'); await pipSec.getByLabel('Across', { exact: true }).fill('10'); await pipSec.getByLabel('Down', { exact: true }).fill('20');
await pipSec.getByLabel('Strength', { exact: true }).fill('0.5'); await pipSec.getByLabel('Volume', { exact: true }).fill('0.3');
await screen.waitForTimeout(500);
const pb = await screen.evaluate(() => { const r = document.getElementById('pip').getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), op: getComputedStyle(document.getElementById('pip')).opacity, vol: document.querySelector('#pip video').volume }; });
ok('box size, position, strength and volume follow the sliders', Math.abs(pb.w - 512) < 3 && Math.abs(pb.left - 128) < 3 && Math.abs(pb.top - 144) < 3 && pb.op === '0.5' && Math.abs(pb.vol - 0.3) < 0.01, JSON.stringify(pb));
await pipSec.getByRole('button', { name: '↘' }).click(); await screen.waitForTimeout(400);
const pb2 = await screen.evaluate(() => { const r = document.getElementById('pip').getBoundingClientRect(); return { right: Math.round(innerWidth - r.right), top: Math.round(r.top) }; });
ok('corner preset', pb2.right < 1280 * 0.35 && pb2.top > 720 * 0.4, JSON.stringify(pb2));
await page.getByLabel('Pause box video').click(); await screen.waitForTimeout(300);
ok('pause the box video', await screen.evaluate(() => document.querySelector('#pip video').paused));
await shot(screen, 'pip-video.png');
// a document page in the box, with its own page turning
await tab('Media'); await page.getByText('slides', { exact: true }).click(); await page.getByRole('button', { name: 'Show in a box over the screen' }).click();
await screen.waitForFunction(() => document.querySelector('#pip img')?.naturalWidth > 0).then(() => ok('PDF page in the box', true), () => ok('PDF page in the box', false));
await page.getByLabel('Box next page').click(); s = await live(); ok('box page turning', s.pip.src.endsWith('-p2'));
ok('box on the OBS overlay too', await (async () => { const o = await ctx.newPage(); await o.goto(base + 'display.html?overlay'); await o.waitForTimeout(800); const v = await o.evaluate(() => getComputedStyle(document.getElementById('pip')).opacity !== '0'); await o.close(); return v; })());
await page.getByLabel('Hide the box').click(); await screen.waitForTimeout(400);
ok('hide the box', await screen.evaluate(() => getComputedStyle(document.getElementById('pip')).opacity === '0') && !(await live()).pip);
await tab('Live');

// overlay for OBS
const ov = await ctx.newPage(); watch(ov, 'overlay'); await ov.setViewportSize({ width: 1280, height: 720 }); await ov.goto(base + 'display.html?overlay'); await ov.waitForTimeout(800);
const ovs = await ov.evaluate(() => ({ cls: document.documentElement.className, bg: getComputedStyle(document.body).backgroundColor, cam: getComputedStyle(document.getElementById('cam')).display, lt: document.getElementById('lt').className, hint: document.getElementById('hint').hidden, cursor: document.body.className }));
ok('watermark on the streaming overlay', await ov.evaluate(() => getComputedStyle(document.getElementById('wm')).opacity !== '0'));
ok('overlay is see-through with lower third only', ovs.cls === 'overlay' && ovs.bg === 'rgba(0, 0, 0, 0)' && ovs.cam === 'none' && ovs.lt.includes('on') && ovs.hint, JSON.stringify(ovs));
await ov.screenshot({ path: out('overlay.png'), omitBackground: true }); await ov.close();
// normal screen + black
await page.getByRole('button', { name: 'Black' }).click(); await screen.waitForTimeout(400);
ok('black stops the camera', await screen.evaluate(() => !document.querySelector('#cam video').srcObject && document.getElementById('ticker').className === ''));
await page.getByRole('button', { name: 'Black' }).click();
await page.getByRole('button', { name: 'Turn off live video' }).click(); await page.getByRole('group', { name: 'Ticker' }).getByRole('button', { name: 'Off' }).click(); await screen.waitForTimeout(500);
ok('back to full screen text', await screen.evaluate(() => getComputedStyle(document.getElementById('cam')).opacity === '0' && document.getElementById('lt').className === '' && document.getElementById('wrap').style.opacity === '1'));
// the name tag also works without live video, over a full-screen verse
await tab('Bible'); await inp.fill('ps 23 1'); await inp.press('Enter'); await screen.waitForTimeout(400);
nb = await ntBox(); ok('name tag over a full-screen verse', nb.on && (await screen.locator('#wrap .text').first().textContent()).includes('shepherd'), JSON.stringify(nb));
await shot(screen, 'name-over-verse.png');
await page.getByLabel('Hide the name tag').click(); await screen.waitForTimeout(300); ok('hide the tag from the live panel', !(await ntBox()).on);
await tab('Live'); await shot(page, 'op-live.png');

// ---------- plan + persistence ----------
await tab('Plan'); ok('plan holds song and PDF', await page.getByText('Amazing Grace').first().isVisible() && await page.getByText('PDF · 3 pages').isVisible());
await page.getByText('PDF · 3 pages').click(); s = await live(); ok('plan PDF starts at page 1', s.media?.src.endsWith('-p1'));
await page.reload(); await page.waitForSelector('nav'); await page.waitForTimeout(800); s = await live(); ok('state after reload', s.kind === 'media');
await tab('Bible'); await shot(page, 'op-bible.png');
await tab('Screen'); await shot(page, 'op-screen.png');
ok('no page errors', errs.length === 0, errs.join(' | ').slice(0, 500));
console.log(pass, 'passed', fail, 'failed'); await b.close();
process.exit(fail ? 1 : 0);
