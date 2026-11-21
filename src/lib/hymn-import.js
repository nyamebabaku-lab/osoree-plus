// Hymn books from other programs: OpenLyrics (.xml), OpenSong (XML, often without an extension) and
// ProPresenter 6 (.pro6), one file per hymn or many in a zip. Each hymn becomes plain lyrics in the
// app's song format (a label line such as "Verse 1" or "Chorus", then the lines, a blank line between slides),
// already in singing order, so songSlides() shows it like any other song.
import { unzipSync } from 'fflate';
import { decodeXml } from './bible.js';
import { LABEL } from './songs.js';

const SKIP = /(^|\/)(__MACOSX|\.)/;
const byName = (root, name) => [...root.getElementsByTagName('*')].filter((e) => e.localName === name);
const first = (root, name) => byName(root, name)[0] || null;
const clean = (s) => String(s || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();

const WORD = { v: 'Verse', c: 'Chorus', r: 'Chorus', b: 'Bridge', p: 'Pre-chorus', e: 'Ending', i: 'Intro', o: 'Outro', t: 'Tag' };
/** "v1" / "V2" / "c" / "C1" / "b" → "Verse 1" / "Verse 2" / "Chorus" / "Chorus 1" / "Bridge". Unknown names give "". */
export function labelFor(name) {
  const m = String(name || '').trim().match(/^([a-z])\s*(\d*)[a-z]?$/i);
  if (m) { const w = WORD[m[1].toLowerCase()]; return w ? `${w}${m[2] ? ' ' + m[2] : ''}` : ''; }
  const t = String(name || '').trim();
  return LABEL.test(t) ? t : '';
}
// One slide of lyrics: its label line (only if the app recognises it, so it never shows on screen) and its lines.
const block = (label, text) => { const body = clean(text); return body ? (label ? `${label}\n` : '') + body : ''; };
const numberFrom = (fileName) => fileName.split('/').pop().match(/^\s*(\d{1,4})(?=[\s._-])/)?.[1] || '';

// ------------------------------------------------------------------------------------------- OpenLyrics
function textOf(node) {
  let s = '';
  for (const c of node.childNodes) {
    if (c.nodeType === 3) s += c.nodeValue.replace(/\s*\n\s*/g, ' ');
    else if (c.nodeType === 1) {
      if (c.localName === 'br') s += '\n';
      else if (c.localName !== 'comment') s += textOf(c);
    }
  }
  return s;
}
function parseOpenLyrics(doc, fileName) {
  const song = doc.documentElement;
  const title = clean(first(song, 'title')?.textContent);
  const authors = byName(song, 'author').map((a) => clean(a.textContent)).filter(Boolean);
  const book = first(song, 'songbook');
  const verses = byName(song, 'verse').filter((v) => v.parentNode?.localName === 'lyrics');
  const lang = verses.find((v) => v.getAttribute('lang'))?.getAttribute('lang') || '';
  const byKey = new Map();
  for (const v of verses) {
    if (lang && v.getAttribute('lang') && v.getAttribute('lang') !== lang) continue; // first language only
    const name = (v.getAttribute('name') || '').toLowerCase();
    const text = byName(v, 'lines').map(textOf).join('\n');
    if (!byKey.has(name)) byKey.set(name, text);
  }
  const order = clean(first(song, 'verseOrder')?.textContent).toLowerCase().split(/\s+/).filter((k) => byKey.has(k));
  const keys = order.length ? order : [...byKey.keys()];
  const lyrics = keys.map((k) => block(labelFor(k), byKey.get(k))).filter(Boolean).join('\n\n');
  return { n: book?.getAttribute('entry') || numberFrom(fileName), title, author: authors.join(', '), lyrics, book: book?.getAttribute('name') || '' };
}

// ---------------------------------------------------------------------------------------------- OpenSong
function parseOpenSong(doc, fileName) {
  const song = doc.documentElement;
  const get = (n) => clean(first(song, n)?.textContent);
  const parts = new Map(); // "V1" → lines
  let key = 'V';
  const add = (k, line) => { if (!parts.has(k)) parts.set(k, []); parts.get(k).push(line); };
  for (const raw of (first(song, 'lyrics')?.textContent || '').replace(/\r/g, '').split('\n')) {
    const head = raw.match(/^\s*\[([^\]]+)\]/);
    if (head) { key = head[1].trim().toUpperCase(); continue; }
    if (/^[.;]/.test(raw)) continue; // chord and comment lines
    const multi = raw.match(/^(\d)(.*)$/); // "1Amazing grace…" under [V] is verse 1, "2…" verse 2
    const text = (multi ? multi[2] : raw).replace(/_/g, '').replace(/\|\|/g, '\n\n').replace(/\|/g, '\n').trim();
    if (!text) { if (parts.has(key)) add(key, ''); continue; }
    add(multi ? key.replace(/\d+$/, '') + multi[1] : key, text);
  }
  const order = get('presentation').toUpperCase().split(/[\s,]+/).filter((k) => parts.has(k));
  const keys = order.length ? order : [...parts.keys()];
  const lyrics = keys.map((k) => block(labelFor(k), parts.get(k).join('\n').replace(/\n{3,}/g, '\n\n'))).filter(Boolean).join('\n\n');
  return { n: get('hymn_number') || numberFrom(fileName), title: get('title'), author: get('author'), lyrics, book: '' };
}

// ----------------------------------------------------------------------------------------- ProPresenter 6
/** Plain text from RTF: paragraphs become lines; hidden groups, fonts and colours are dropped. */
export function rtfToText(rtf) {
  let out = '', depth = 0, skipAt = -1, uc = 1, skipChars = 0;
  for (let i = 0; i < rtf.length; i++) {
    const ch = rtf[i];
    if (ch === '{') { depth++; if (rtf.startsWith('{\\*', i) && skipAt < 0) skipAt = depth; continue; }
    if (ch === '}') { if (depth === skipAt) skipAt = -1; depth--; continue; }
    if (ch === '\\') {
      const m = rtf.slice(i + 1).match(/^([a-z]+)(-?\d+)? ?|^'([0-9a-f]{2})|^([\\{}])|^([^a-z])/i);
      if (!m) continue;
      i += m[0].length;
      if (skipAt >= 0) continue;
      const [, word, num, hex, lit] = m;
      if (lit) out += lit;
      else if (hex) { if (skipChars > 0) skipChars--; else out += String.fromCharCode(parseInt(hex, 16)); }
      else if (word === 'par' || word === 'line') out += '\n';
      else if (word === 'tab') out += ' ';
      else if (word === 'uc') uc = Number(num) || 1;
      else if (word === 'u') { out += String.fromCharCode((Number(num) + 65536) % 65536); skipChars = uc; }
      else if (['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'expandedcolortbl'].includes(word)) skipAt = depth;
      continue;
    }
    if (skipAt >= 0 || ch === '\r' || ch === '\n') continue;
    if (skipChars > 0) { skipChars--; continue; }
    out += ch;
  }
  return out;
}
const b64text = (s) => { try { return new TextDecoder().decode(Uint8Array.from(atob(String(s).trim()), (c) => c.charCodeAt(0))); } catch { return ''; } };
function parsePro6(doc, fileName) {
  const root = doc.documentElement;
  const slides = [];
  for (const group of byName(root, 'RVSlideGrouping')) {
    const label = labelFor(group.getAttribute('name'));
    for (const slide of byName(group, 'RVDisplaySlide')) {
      const texts = byName(slide, 'RVTextElement').map((t) => {
        const plain = byName(t, 'NSString').find((s) => s.getAttribute('rvXMLIvarName') === 'PlainText');
        if (plain) return b64text(plain.textContent);
        const rtf = byName(t, 'NSString').find((s) => s.getAttribute('rvXMLIvarName') === 'RTFData')?.textContent || t.getAttribute('RTFData');
        return rtf ? rtfToText(b64text(rtf)) : '';
      });
      const b = block(label, texts.join('\n'));
      if (b) slides.push(b);
    }
  }
  const name = fileName.split('/').pop().replace(/\.pro6$/i, '').replace(/^\s*\d{1,4}[\s._-]+/, '');
  return { n: numberFrom(fileName), title: clean(root.getAttribute('CCLISongTitle')) || name, author: clean(root.getAttribute('CCLIAuthor')), lyrics: slides.join('\n\n'), book: '' };
}

// ---------------------------------------------------------------- Zefania XML used as a whole hymn book
// <XMLBIBLE><BIBLEBOOK><CHAPTER cnumber="12"> is hymn 12; each <VERS> is a stanza; <CAPTION>s hold the Bible
// reference and the writers. A chorus starts inside a stanza with "Nnyeso:" (Twi), "Chorus:" or "Refrain:";
// later stanzas often give only its first words and "n.a." / "…", so the full chorus is repeated instead.
// Twi "Nnyeso(ɔ)" is often garbled in converted files ("Nnyesyesyeso:yeso:o:", "noNnyeso:"), so any run of its letters counts.
const TWI_MARK = /Nn*y[eɛysoɔ]*s[eɛysoɔ:]*/g;
const CHORUS = /^\s*(?:Nny[eɛysoɔ]*s[eɛysoɔ:]*|(?:chorus|refrain|ref)\s*:)/i;
const CHORUS_ANY = /(?:chorus|refrain)\s*:/gi;
const ABBR = /\s*(n\.\s?a\.?|etc\.?|\.\.\.|…)\s*$/i;
function stanzaAndChorus(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const at = lines.findIndex((l) => CHORUS.test(l));
  if (at < 0) return { stanza: text, chorus: '' };
  const chorus = lines.slice(at).join('\n').replace(TWI_MARK, ' ').replace(CHORUS_ANY, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
  return { stanza: lines.slice(0, at).join('\n'), chorus };
}
function parseZefaniaHymns(doc) {
  const root = doc.documentElement;
  const info = first(root, 'INFORMATION') || root;
  const books = byName(root, 'BIBLEBOOK');
  const about = [root.getAttribute('biblename'), first(info, 'title')?.textContent, first(info, 'subject')?.textContent, books[0]?.getAttribute('bname')].join(' ');
  // A real Bible (many books, nothing about hymns) belongs in Bible → Import, not here.
  if (books.length > 3 && !/hymn|song|ndwom|nnwom|dwom|chant|psalter/i.test(about)) return { bible: true, hymns: [] };
  const hymns = [];
  for (const ch of byName(root, 'CHAPTER')) {
    const kids = [...ch.children];
    const caps = kids.filter((e) => e.localName === 'CAPTION').map((e) => clean(e.textContent).replace(/^[!\s]+/, '')).filter(Boolean);
    // A stanza that holds "3. …" lines (merged in the source) is split there into separate stanzas.
    const parts = kids.filter((e) => e.localName === 'VERS')
      .flatMap((v) => v.textContent.replace(/\r/g, '').split(/\n(?=\s*\d{1,2}\.\s)/).map((t, i) => (i ? t.replace(/^\s*\d{1,2}\.\s*/, '') : t)))
      .map(stanzaAndChorus);
    const choruses = parts.map((p) => p.chorus).filter(Boolean);
    const full = choruses.filter((c) => !ABBR.test(c)).sort((a, b) => b.length - a.length)[0]
      || choruses.map((c) => c.replace(ABBR, '')).sort((a, b) => b.length - a.length)[0] || '';
    // "O, yiw, wo ho hia me. n.a" (no chorus mark): the shortened start of the chorus, or of a refrain
    // printed in full in the first stanza. It is replaced by the full lines.
    const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, '').replace(/\s+/g, ' ').trim();
    const firstLines = clean(parts[0]?.stanza || '').split('\n');
    parts.forEach((p, i) => {
      const lines = clean(p.stanza).split('\n');
      const at = lines.findIndex((l) => ABBR.test(l));
      if (at < 0) return;
      const start = norm(lines[at].replace(ABBR, ''));
      const head = lines.slice(0, at).join('\n');
      if (start && full && norm(full).startsWith(start)) { p.stanza = head; p.chorus ||= full; return; }
      const k = i > 0 && start ? firstLines.findIndex((l) => norm(l).startsWith(start)) : -1;
      p.stanza = k >= 0 ? [head, ...firstLines.slice(k)].join('\n') : [...lines.slice(0, at), lines[at].replace(ABBR, ''), ...lines.slice(at + 1)].join('\n');
    });
    const out = [];
    parts.forEach((p, i) => {
      const st = block(`Verse ${i + 1}`, p.stanza);
      if (st) out.push(st);
      if (p.chorus && full) out.push(block('Chorus', full));
    });
    if (!out.length) continue;
    const firstLine = clean(parts[0]?.stanza || '').split('\n')[0].replace(/[,;:.!]+$/, '');
    hymns.push({ n: ch.getAttribute('cnumber') || '', title: firstLine || `Hymn ${hymns.length + 1}`, author: caps.join(' · '), lyrics: out.join('\n\n') });
  }
  return { book: clean(first(info, 'title')?.textContent) || clean(root.getAttribute('biblename')) || books[0]?.getAttribute('bname') || '', lang: clean(first(info, 'language')?.textContent), hymns };
}

function parseXml(bytes) {
  const text = decodeXml(bytes).replace(/^\uFEFF/, '');
  if (!/^\s*</.test(text)) return null;
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  return doc.getElementsByTagName('parsererror').length ? null : doc;
}

/** One hymn from one file, or null when the file is not a hymn this app understands. */
export function parseHymnFile(fileName, bytes, doc = parseXml(bytes)) {
  if (!doc) return null;
  const root = doc.documentElement.localName;
  const h = root === 'song' && first(doc.documentElement, 'lyrics')?.getElementsByTagName('*').length ? parseOpenLyrics(doc, fileName)
    : root === 'song' ? parseOpenSong(doc, fileName)
      : root === 'RVPresentationDocument' ? parsePro6(doc, fileName) : null;
  if (!h || !h.lyrics) return null;
  if (!h.title) h.title = h.lyrics.split('\n').find((l) => l && !LABEL.test(l)) || 'Untitled hymn';
  return h;
}

/** Hymn book from picked files ({ name, bytes }): single hymn files and/or zips of them. */
export function hymnalFromFiles(files, title = '') {
  const hymns = [], skipped = [];
  let book = '';
  let lang = '', bible = false;
  const take = (name, bytes) => {
    if (SKIP.test(name) || !/(\.(xml|pro6|osl|song)|^[^.]+)$/i.test(name.split('/').pop())) return;
    const doc = parseXml(bytes);
    if (doc?.documentElement.localName === 'XMLBIBLE') { // a whole hymn book in one Zefania file
      const z = parseZefaniaHymns(doc);
      if (z.bible) { bible = true; skipped.push(`${name.split('/').pop()} (a Bible: add it in Bible → Import)`); return; }
      book ||= z.book; lang ||= z.lang;
      z.hymns.forEach((h) => hymns.push({ ...h, n: String(h.n).trim() }));
      return;
    }
    const h = parseHymnFile(name, bytes, doc);
    if (!h) { skipped.push(name.split('/').pop()); return; }
    book ||= h.book;
    hymns.push({ n: String(h.n || '').trim(), title: h.title, author: h.author, lyrics: h.lyrics });
  };
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const all = unzipSync(f.bytes, { filter: (e) => !SKIP.test(e.name) && !e.name.endsWith('/') });
      Object.keys(all).sort().forEach((k) => take(k, all[k]));
      title ||= f.name.replace(/\.zip$/i, '').replace(/[_-]+/g, ' ').trim();
    } else if (/\.pro$/i.test(f.name)) skipped.push(`${f.name} (ProPresenter 7: export as ProPresenter 6 or OpenLyrics)`);
    else take(f.name, f.bytes);
  }
  return { hymnal: tidyHymnal({ title: title || book || 'My hymns', lang, hymns }), skipped, bible };
}

/** Numbers sorted 1, 2, 10; hymns without a number after them by title; every hymn gets a unique key k. */
export function tidyHymnal(h) {
  const num = (x) => (/^\d+/.test(x.n) ? parseInt(x.n, 10) : Infinity);
  const hymns = [...h.hymns].filter((x) => x.lyrics).sort((a, b) => num(a) - num(b) || a.n.localeCompare(b.n) || a.title.localeCompare(b.title));
  const used = new Set();
  hymns.forEach((x, i) => { let k = x.n && !used.has(x.n) ? x.n : `_${i + 1}`; while (used.has(k)) k += '_'; used.add(k); x.k = k; });
  return { format: 'osoree-hymnal', v: 1, title: h.title, abbr: h.abbr || '', lang: h.lang || '', copyright: h.copyright || '', hymns };
}
