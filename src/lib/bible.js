// Loading, importing and searching Bible texts. Everything stays on the device.
import { tx as idb } from './db.js';
import { NAMES as NAMES_FOR_REPORT } from './books.js';
export const BUILTIN = [
  { id: 'kjv', abbr: 'KJV', name: 'King James Version' },
  { id: 'kjvs', abbr: 'KJV+', name: "KJV with Strong's numbers" },
  { id: 'bsb', abbr: 'BSB', name: 'Berean Standard Bible' },
  { id: 'web', abbr: 'WEB', name: 'World English Bible' },
  { id: 'asv', abbr: 'ASV', name: 'American Standard Version' },
  { id: 'bbe', abbr: 'BBE', name: 'Bible in Basic English' },
  { id: 'ylt', abbr: 'YLT', name: "Young's Literal Translation" },
];

// Imported Bibles live in IndexedDB (too large for localStorage).
const tx = (mode, fn) => idb('bibles', mode, fn);

const cache = new Map();

// Strong's Bibles carry tagged words, "[beginning|H7225]"; screens and search use the plain text.
export const stripTags = (t) => t.replace(/\[([^|\]]*)\|[^\]]*\]/g, '$1');
function prepare(bible) {
  if (!bible.strongs || bible.tagged) return bible;
  return { ...bible, tagged: bible.books, books: bible.books.map((b) => b.map((c) => c.map(stripTags))) };
}
export function loadBible(id) {
  if (!cache.has(id)) {
    let p = id.startsWith('imp-')
      ? tx('readonly', (s) => s.get(id)).then((b) => b || Promise.reject(new Error('missing')))
      : fetch(`./bibles/${id}.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error('missing'))));
    p = p.then(prepare);
    cache.set(id, p.catch((e) => { cache.delete(id); throw e; }));
  }
  return cache.get(id);
}

export async function saveImported(bible) { await tx('readwrite', (s) => s.put(bible)); cache.delete(bible.id); }
export async function deleteImported(id) { await tx('readwrite', (s) => s.delete(id)); cache.delete(id); }

// Bible files are usually UTF-8, but older ones say otherwise in their first line (e.g. ISO-8859-1).
export function decodeXml(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 200));
  const enc = (head.match(/encoding=["']([\w-]+)["']/i)?.[1] || 'utf-8').toLowerCase();
  try { return new TextDecoder(enc).decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}

// "New King James Version®. Copyright © 1982 by Thomas Nelson" → "New King James Version"
function tidyName(n) {
  return String(n).replace(/\s*(\.|,|-)?\s*(copyright|©|\(c\)).*$/i, '').replace(/[®™]/g, '').replace(/^(the\s+)?holy\s+bible\s*[,:-]\s*/i, '').replace(/\s+/g, ' ').trim();
}

const KNOWN = [
  [/new international reader/i, 'NIrV'], [/new international/i, 'NIV'], [/new king james/i, 'NKJV'], [/king james/i, 'KJV'],
  [/new american standard/i, 'NASB'], [/american standard/i, 'ASV'], [/new living/i, 'NLT'], [/english standard/i, 'ESV'],
  [/amplified/i, 'AMP'], [/the message|^message$/i, 'MSG'], [/christian standard/i, 'CSB'], [/new revised standard/i, 'NRSV'],
  [/revised standard/i, 'RSV'], [/good news/i, 'GNT'], [/new century/i, 'NCV'], [/contemporary english/i, 'CEV'],
];
// A short name for the version list and the screen: "New International Version" → "NIV".
function abbreviate(name, base) {
  const known = KNOWN.find(([re]) => re.test(name));
  if (known) return known[1];
  const inBrackets = name.match(/\(([A-Z0-9]{2,8})\)/);
  if (inBrackets) return inBrackets[1];
  const b = base.replace(/[_-]?\d{4}$/, '');
  if (b.length <= 8 && !/\s/.test(b)) return b.toUpperCase();
  const initials = name.split(/\s+/).filter((w) => /^[A-ZƆƐ]/.test(w)).map((w) => w[0]).join('');
  return (initials.length >= 2 ? initials : b.replace(/[^A-Za-z0-9]/g, '').slice(0, 6)).toUpperCase();
}

// Reads the common XML Bible layouts: Zefania (BIBLEBOOK/CHAPTER/VERS), OpenSong (b/c/v) and book/chapter/verse.
// Some files lost their "é" when they were made ("fianc�s"): put it back inside words.
// Also add the space some files lack between sentences ("A PSALM OF DAVID.The LORD").
const repair = (t) => t.replace(/(\p{L})\uFFFD/gu, '$1é').replace(/(\p{Ll}{2}|\p{Lu}{2})([.!?;:])(\p{Lu}\p{Ll})/gu, '$1$2 $3');

// Damaged files (for example with blocks of empty bytes from an interrupted download) cannot be read as XML.
// This reads every verse that is still whole and skips the damaged parts, so the rest of the Bible can be used.
function lenientParse(text) {
  const books = Array.from({ length: 66 }, () => []);
  const src = text.replace(/\u0000+/g, '\u0000');
  const re = /<(biblebook|book|b|chapter|c)\b([^>]*)>|<(vers|verse|v)\b([^>]*)>([\s\S]*?)<\/\3\s*>|\u0000/gi;
  const attr = (a, ...names) => { for (const n of names) { const m = a.match(new RegExp(`\\b${n}\\s*=\\s*["']([^"']*)["']`, 'i')); if (m) return m[1]; } return ''; };
  let bi = -1, ci = -1, order = 0, broken = false, count = 0;
  const bookNames = Array(66).fill('');
  for (let m; (m = re.exec(src));) {
    if (m[0] === '\u0000') { broken = true; continue; } // lost text: wait for the next chapter or book
    if (m[1]) {
      const tag = m[1].toLowerCase();
      if (tag === 'biblebook' || tag === 'book' || tag === 'b') {
        bi = (parseInt(attr(m[2], 'bnumber', 'number', 'id'), 10) || ++order) - 1;
        const name = attr(m[2], 'bname', 'n', 'name');
        if (bi >= 0 && bi < 66 && name && !/^\d+$/.test(name)) bookNames[bi] = name;
        ci = -1;
      } else {
        ci = (parseInt(attr(m[2], 'cnumber', 'number', 'n'), 10) || ci + 2) - 1;
      }
      broken = false;
      continue;
    }
    // A verse that runs into damage (or past a chapter tag) is lost, and so is everything up to the next chapter.
    if (m[5].includes('\u0000') || /<(chapter|c|biblebook|book|b)\b/i.test(m[5])) { broken = true; continue; }
    if (broken || bi < 0 || bi > 65 || ci < 0) continue;
    const vi = (parseInt(attr(m[4], 'vnumber', 'number', 'n'), 10) || 0) - 1;
    if (vi < 0) continue;
    const b = books[bi];
    while (b.length <= ci) b.push([]);
    while (b[ci].length <= vi) b[ci].push('');
    b[ci][vi] = m[5].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    count++;
  }
  return { books, count, bookNames };
}

export function parseXmlBible(rawText, fileName) {
  const text = repair(rawText);
  const doc = new DOMParser().parseFromString(text.replace(/\u0000+/g, ''), 'application/xml');
  if (text.includes('\u0000') || doc.getElementsByTagName('parsererror').length) return parseDamaged(text, fileName, doc);
  const root = doc.documentElement;
  const books = Array.from({ length: 66 }, () => []);
  let count = 0;
  const num = (el, ...attrs) => { for (const a of attrs) { const x = parseInt(el.getAttribute(a), 10); if (x > 0) return x; } return 0; };
  const kids = (el, ...tags) => Array.from(el.children).filter((k) => tags.includes(k.tagName.toLowerCase()));
  const bookEls = Array.from(root.getElementsByTagName('*')).filter((e) => ['biblebook', 'book', 'b'].includes(e.tagName.toLowerCase()) && kids(e, 'chapter', 'c').length);
  const bookNames = Array(66).fill('');
  // Files without book numbers rely on order; a 27-book file is a New Testament on its own.
  const numbered = bookEls.some((be) => num(be, 'bnumber', 'number', 'id'));
  const offset = !numbered && bookEls.length === 27 ? 39 : 0;
  bookEls.forEach((be, order) => {
    const bi = (num(be, 'bnumber', 'number', 'id') || order + 1 + offset) - 1;
    if (bi > 65) return;
    const bname = (be.getAttribute('bname') || be.getAttribute('n') || be.getAttribute('name') || '').trim();
    if (bname && !/^\d+$/.test(bname)) bookNames[bi] = bname;
    kids(be, 'chapter', 'c').forEach((ce, co) => {
      const ci = (num(ce, 'cnumber', 'number', 'n') || co + 1) - 1;
      kids(ce, 'vers', 'verse', 'v').forEach((ve, vo) => {
        const vi = (num(ve, 'vnumber', 'number', 'n') || vo + 1) - 1;
        const b = books[bi];
        while (b.length <= ci) b.push([]);
        while (b[ci].length <= vi) b[ci].push('');
        b[ci][vi] = ve.textContent.replace(/\s+/g, ' ').trim();
        count++;
      });
    });
  });
  if (count < 100) throw new Error('No Bible verses were found in this file.');
  const base = fileName.replace(/\.[^.]+$/, '');
  const raw = root.getAttribute('biblename') || root.getAttribute('name') || root.getAttribute('title') || root.getAttribute('translation')
    || doc.querySelector('INFORMATION > title, information > title')?.textContent || base;
  const name = tidyName(raw) || base;
  // Files exported from bible.com carry the version's own short code in their link: ".../GEN.1.AKNA" → "AKNA".
  const linkCode = (root.getAttribute('link') || root.getAttribute('site') || '').match(/\/[A-Z0-9]+\.\d+\.([A-Z0-9-]{2,10})\s*$/)?.[1];
  const abbr = linkCode || abbreviate(name, base);
  // Books the file lists but with no verses at all (a failed export), so the operator is told at import.
  const listed = new Set(bookEls.map((be, order) => (num(be, 'bnumber', 'number', 'id') || order + 1 + offset) - 1));
  const emptyBooks = [...listed].filter((bi) => bi >= 0 && bi < 66 && !books[bi].some((c) => c.some(Boolean))).sort((x, y) => x - y).map((bi) => NAMES_FOR_REPORT[bi]);
  const id = 'imp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  return { id, abbr, name, books, verses: count, bookNames: bookNames.some(Boolean) ? bookNames : null, emptyBooks: emptyBooks.length ? emptyBooks : undefined };
}

function parseDamaged(text, fileName, doc) {
  const { books, count, bookNames } = lenientParse(text);
  if (count < 100) throw new Error('This file is not a readable XML Bible.');
  const base = fileName.replace(/\.[^.]+$/, '');
  const head = text.slice(0, 3000);
  const raw = head.match(/\b(?:biblename|translation|name)\s*=\s*"([^"]+)"/i)?.[1] || head.match(/<title>([^<]+)<\/title>/i)?.[1] || base;
  const name = tidyName(raw) || base;
  // Chapters with no verses left, listed for the operator ("Ezekiel 3–22").
  const missing = [];
  books.forEach((b, bi) => {
    let from = null;
    b.forEach((ch, ci) => {
      const gone = !ch.some(Boolean);
      if (gone && from == null) from = ci;
      if ((!gone || ci === b.length - 1) && from != null) { const to = gone ? ci : ci - 1; missing.push(`${NAMES_FOR_REPORT[bi]} ${from + 1}${to > from ? '–' + (to + 1) : ''}`); from = null; }
    });
  });
  const id = 'imp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  void doc;
  return { id, abbr: abbreviate(name, base), name, books, verses: count, bookNames: bookNames.some(Boolean) ? bookNames : null, damaged: missing.length ? missing : ['a few verses'] };
}

export const verseText = (bible, b, c, v) => bible?.books[b]?.[c]?.[v] || '';

// How many verses of a block really exist in this chapter.
export const blockSize = (bible, { b, c, v, n = 1 }) => Math.max(1, Math.min(n, (bible.books[b]?.[c]?.length || 1) - v));

// The next or previous block of n verses, crossing chapters and books.
export function step(bible, pos, dir, n = 1) {
  const books = bible.books;
  let { b, c, v } = pos;
  const len = books[b]?.[c]?.length || 0;
  if (dir > 0 && v + blockSize(bible, pos) < len) return { b, c, v: v + blockSize(bible, pos), n };
  if (dir < 0 && v > 0) return { b, c, v: Math.max(0, v - n), n };
  c += dir;
  if (c < 0 || c >= books[b].length) {
    b += dir;
    while (b >= 0 && b < 66 && !books[b].length) b += dir;
    if (b < 0 || b > 65) return null;
    c = dir > 0 ? 0 : books[b].length - 1;
  }
  return { b, c, v: dir > 0 ? 0 : Math.max(0, books[b][c].length - n), n };
}

const flat = new WeakMap();
// Every word must appear in the verse; "quoted words" must appear together.
export function search(bible, query, limit = 150) {
  const q = query.toLowerCase().trim();
  if (q.length < 2) return [];
  const terms = [];
  q.replace(/"([^"]+)"|(\S+)/g, (_, phrase, word) => { terms.push((phrase || word).replace(/"/g, '')); });
  const needles = terms.filter(Boolean);
  if (!needles.length) return [];
  if (!flat.has(bible)) {
    const rows = [];
    bible.books.forEach((book, b) => book.forEach((ch, c) => ch.forEach((t, v) => { if (t) rows.push([b, c, v, t.toLowerCase()]); })));
    flat.set(bible, rows);
  }
  const out = [];
  for (const r of flat.get(bible)) {
    if (needles.every((n) => r[3].includes(n))) { out.push({ b: r[0], c: r[1], v: r[2] }); if (out.length >= limit) break; }
  }
  return out;
}

// Backup of everything a church has added that is not built in: imported Bibles and songs.
export async function backupData(imported, songs) {
  const bibles = [];
  for (const meta of imported) {
    const b = await loadBible(meta.id).catch(() => null);
    if (b) bibles.push({ id: b.id, abbr: b.abbr, name: b.name, books: b.books, verses: b.verses, bookNames: b.bookNames || null });
  }
  return JSON.stringify({ app: 'osoree-plus', kind: 'backup', version: 1, saved: new Date().toISOString(), bibles, songs });
}

export function readBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That is not an Ɔsɔreɛ Plus backup file.'); }
  if (data?.app !== 'osoree-plus' || data.kind !== 'backup') throw new Error('That is not an Ɔsɔreɛ Plus backup file.');
  return { bibles: Array.isArray(data.bibles) ? data.bibles : [], songs: Array.isArray(data.songs) ? data.songs : [] };
}
