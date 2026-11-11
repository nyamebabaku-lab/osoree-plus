// Imports every XML Bible in bibles-import/ through the app (Screen → Add Bibles) and checks each one.
// Usage: tests/check-bibles.sh   (the Bible files themselves are never committed)
import { chromium } from '/home/BrandsME/projects/efiewura/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2];
const files = process.argv.slice(2).flatMap((d) => fs.readdirSync(d, { recursive: true }).filter((f) => /\.(xml|zip)$/i.test(f)).map((f) => path.join(d, f)));
const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1148/chrome-linux/chrome' });
const page = await b.newPage({ viewport: { width: 400, height: 860 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://127.0.0.1:4871/'); await page.waitForSelector('nav');
await page.locator('nav button', { hasText: 'Screen' }).click();
await page.setInputFiles('input[type=file][accept^=".xml"]', files);
await page.waitForFunction(() => /Added|could not/.test(document.body.innerText) && !/Reading /.test(document.body.innerText), null, { timeout: 120000 });
console.log('App message:', await page.locator('text=/^Added/').first().innerText().catch(() => '(none)'));
const damaged = await page.evaluate(async () => { const db = await new Promise((r) => { const q = indexedDB.open('osoree-plus', 2); q.onsuccess = () => r(q.result); }); return new Promise((r) => { const q = db.transaction('bibles').objectStore('bibles').getAll(); q.onsuccess = () => r(q.result.filter((b) => b.damaged).map((b) => `${b.abbr}: ${b.damaged.join(', ')}`)); }); });
console.log('Damaged parts:', damaged.length ? damaged : 'none');
const report = await page.evaluate(async () => {
  const kjv = await (await fetch('./bibles/kjv.json')).json();
  const db = await new Promise((r) => { const q = indexedDB.open('osoree-plus', 2); q.onsuccess = () => r(q.result); });
  const all = await new Promise((r) => { const q = db.transaction('bibles').objectStore('bibles').getAll(); q.onsuccess = () => r(q.result); });
  const NAMES = ['Genesis', 'John', 'Psalms', 'Revelation'];
  return all.map((bb) => {
    let verses = 0, empty = 0, missingBooks = [], chapterDiff = [], verseDiff = 0, odd = 0, oddSample = '';
    kjv.books.forEach((kb, i) => {
      const mb = bb.books[i] || [];
      if (!mb.length) { missingBooks.push(i + 1); return; }
      if (mb.length !== kb.length) chapterDiff.push(`${i + 1}: ${mb.length}/${kb.length}`);
      kb.forEach((kc, c) => { const mc = mb[c] || []; verseDiff += Math.abs(mc.length - kc.length); });
      mb.forEach((ch) => ch.forEach((t) => {
        verses++; if (!t) empty++;
        if (/Ã.|â€|�|�/.test(t)) { odd++; if (!oddSample) oddSample = t.slice(0, 80); }
      }));
    });
    const v = (b, c, n) => (bb.books[b]?.[c]?.[n] || '(missing)').slice(0, 70);
    return { id: bb.id, abbr: bb.abbr, name: bb.name, verses, empty, missingBooks, chapterDiff, verseDiff, odd, oddSample,
      john316: v(42, 2, 15), ps23: v(18, 22, 0), rev2221: v(65, 21, 20), bookNames: bb.bookNames ? bb.bookNames.filter((n, i) => n !== ['Genesis', 'Exodus'][i]).slice(0, 3) : null };
  });
});
for (const r of report.sort((a, b) => a.abbr.localeCompare(b.abbr))) {
  console.log(`\n${r.abbr} · ${r.name}`);
  console.log(`  verses ${r.verses}, empty ${r.empty}, verse-count differences vs KJV ${r.verseDiff}${r.missingBooks.length ? `, MISSING books ${r.missingBooks.join(',')}` : ''}${r.chapterDiff.length ? `, chapter differences ${r.chapterDiff.join('; ')}` : ''}`);
  console.log(`  garbled characters: ${r.odd}${r.oddSample ? ` e.g. "${r.oddSample}"` : ''}`);
  console.log(`  John 3:16  ${r.john316}`);
  console.log(`  Psalm 23:1 ${r.ps23}`);
  console.log(`  Rev 22:21  ${r.rev2221}`);
}
// Use one on screen: a version list entry, a verse live
await page.getByLabel('Bible version').selectOption({ label: 'NIV · New International Version' });
await page.locator('nav button', { hasText: 'Bible' }).click();
await page.getByLabel('Verse or words').fill('jn 3 16'); await page.getByLabel('Verse or words').press('Enter');
const live = await page.evaluate(() => JSON.parse(localStorage.getItem('osoree-live')));
console.log('\nOn screen:', live.groups?.[0]?.ref, '·', live.groups?.[0]?.cols?.[0]?.abbr, '·', live.groups?.[0]?.cols?.[0]?.verses?.[0]?.t.slice(0, 60));
console.log('Version list:', (await page.getByLabel('Bible version').locator('option').allInnerTexts()).join(' | '));
console.log('Page errors:', errs.length ? errs : 'none');
await b.close();
