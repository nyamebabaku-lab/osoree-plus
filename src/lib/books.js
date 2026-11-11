// The 66 books, with the short forms an operator is likely to type.
const B = [
  ['Genesis', 'gen ge gn'], ['Exodus', 'exo ex exod'], ['Leviticus', 'lev le lv'], ['Numbers', 'num nu nm nb'], ['Deuteronomy', 'deut dt de'],
  ['Joshua', 'josh jos jsh'], ['Judges', 'judg jdg jg jdgs'], ['Ruth', 'rth ru'], ['1 Samuel', '1sam 1sa 1s 1sm'], ['2 Samuel', '2sam 2sa 2s 2sm'],
  ['1 Kings', '1kgs 1ki 1k'], ['2 Kings', '2kgs 2ki 2k'], ['1 Chronicles', '1chr 1ch 1chron'], ['2 Chronicles', '2chr 2ch 2chron'], ['Ezra', 'ezr'],
  ['Nehemiah', 'neh ne'], ['Esther', 'est esth es'], ['Job', 'jb'], ['Psalms', 'ps psa psalm pss psm'], ['Proverbs', 'prov pr prv pro'],
  ['Ecclesiastes', 'eccl ecc ec'], ['Song of Solomon', 'song sos so ss songofsongs'], ['Isaiah', 'isa is'], ['Jeremiah', 'jer je jr'], ['Lamentations', 'lam la'],
  ['Ezekiel', 'ezek eze ezk'], ['Daniel', 'dan da dn'], ['Hosea', 'hos ho'], ['Joel', 'jl joe'], ['Amos', 'am amo'],
  ['Obadiah', 'obad ob oba'], ['Jonah', 'jon jnh'], ['Micah', 'mic mc'], ['Nahum', 'nah na'], ['Habakkuk', 'hab hb'],
  ['Zephaniah', 'zeph zep zp'], ['Haggai', 'hag hg'], ['Zechariah', 'zech zec zc'], ['Malachi', 'mal ml'], ['Matthew', 'matt mt mat'],
  ['Mark', 'mk mrk mr'], ['Luke', 'lk luk'], ['John', 'jn jhn joh'], ['Acts', 'ac act'], ['Romans', 'rom ro rm'],
  ['1 Corinthians', '1cor 1co'], ['2 Corinthians', '2cor 2co'], ['Galatians', 'gal ga'], ['Ephesians', 'eph ephes'], ['Philippians', 'phil php pp'],
  ['Colossians', 'col'], ['1 Thessalonians', '1thess 1th 1thes'], ['2 Thessalonians', '2thess 2th 2thes'], ['1 Timothy', '1tim 1ti 1tm'], ['2 Timothy', '2tim 2ti 2tm'],
  ['Titus', 'tit ti'], ['Philemon', 'phlm phm philem'], ['Hebrews', 'heb'], ['James', 'jas jm jam'], ['1 Peter', '1pet 1pe 1pt 1p'],
  ['2 Peter', '2pet 2pe 2pt 2p'], ['1 John', '1jn 1jhn 1jo 1j'], ['2 John', '2jn 2jhn 2jo 2j'], ['3 John', '3jn 3jhn 3jo 3j'], ['Jude', 'jd'],
  ['Revelation', 'rev re rv revelations'],
];

export const NAMES = B.map((x) => x[0]);
const KEYS = NAMES.map((n) => n.toLowerCase().replace(/\s+/g, ''));
const ALIASES = B.map((x) => x[1].split(' '));

// refLabel(42, 2, 15) → "John 3:16"; with n = 3 → "John 3:16-18".
export const refLabel = (b, c, v, n = 1, names) => `${bookLabel(b, names)} ${c + 1}${v == null ? '' : ':' + (v + 1) + (n > 1 ? '-' + (v + n) : '')}`;

const squash = (n) => n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');

// A version's own book names (e.g. a Twi Bible) can be typed too: setExtraBookNames(['Genesis', 'Exodus', ...]).
let EXTRA = [];
export function setExtraBookNames(names) { EXTRA = (names || []).map((n) => (n ? squash(n) : '')); }

// The name a version uses for a book on screen.
export const bookLabel = (b, names) => (names && names[b]) || NAMES[b];

function findBook(key) {
  let i = KEYS.indexOf(key);
  if (i < 0 && EXTRA.length) i = EXTRA.indexOf(key);
  if (i < 0) i = ALIASES.findIndex((a) => a.includes(key));
  if (i < 0) i = KEYS.findIndex((k) => k.startsWith(key));
  if (i < 0) i = ALIASES.findIndex((a) => a.some((x) => x.startsWith(key)));
  if (i < 0 && EXTRA.length) i = EXTRA.findIndex((k) => k && k.startsWith(key));
  return i;
}

const ORD = { first: '1', second: '2', third: '3', '1st': '1', '2nd': '2', '3rd': '3', i: '1', ii: '2', iii: '3' };

// "jn 3 16", "John 3:16", "1 cor 13.4-7", "ps 23" → { b, c, v, v2 } (zero-based; c and v may be null).
export function parseRef(input) {
  const s = String(input || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[–—]/g, '-').trim();
  const m = s.match(/^(?:([1-3])\s*|(first|second|third|1st|2nd|3rd|i{1,3})\s+)?([a-zɔɛŋ][a-zɔɛŋ' ]*?)\.?\s*(?:(\d+)(?:\s*[:.,\s]\s*(\d+)(?:\s*-\s*(\d+))?)?)?$/);
  if (!m) return null;
  const num = m[1] || ORD[m[2]] || '';
  const b = findBook(num + m[3].replace(/[\s']+/g, ''));
  if (b < 0) return null;
  const n = (x) => (x ? parseInt(x, 10) - 1 : null);
  return { b, c: n(m[4]), v: n(m[5]), v2: n(m[6]) };
}

// Several references at once: "jn 3 16; rom 5 8", "ps 23 1, 1 cor 13 4-7", "rom 5 8; 6 23" (same book).
export function parseRefs(input) {
  const parts = String(input || '').split(/;|,(?=\s*(?:[1-3]\s*)?[a-zɔɛ])/i).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return null;
  const out = [];
  for (const p of parts) {
    let r = parseRef(p);
    if (!r && out.length && /^\d/.test(p)) r = parseRef(NAMES[out[out.length - 1].b] + ' ' + p);
    if (!r) return null;
    out.push(r);
  }
  return out;
}

const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

// Spoken words → something parseRef understands: "john chapter three verse sixteen" → "john 3 16".
export function spokenToRef(text) {
  const words = String(text || '').toLowerCase().replace(/[^a-z0-9 :-]/g, ' ').split(/\s+/).filter(Boolean);
  const out = [];
  let cur = null;
  const flush = () => { if (cur != null) { out.push(String(cur)); cur = null; } };
  words.forEach((w, i) => {
    if (UNITS.includes(w)) {
      const u = UNITS.indexOf(w);
      if (cur != null && (cur % 100 === 0 ? cur > 0 : cur % 10 === 0 && cur % 100 >= 20 && u < 10)) cur += u; else { flush(); cur = u; }
    } else if (TENS[w]) {
      if (cur != null && cur % 100 === 0 && cur > 0) cur += TENS[w]; else { flush(); cur = TENS[w]; }
    } else if (w === 'hundred') cur = (cur || 1) * 100;
    else if (w === 'and' && cur != null && cur % 100 === 0) { /* "one hundred and nineteen" */ }
    else if (w === 'chapter' || w === 'verse' || w === 'verses' || w === 'vs' || w === 'colon' || w === 'column') flush();
    else if (/^(st|nd|rd|th)$/.test(w)) { /* "1 st" */ }
    else if ((w === 'to' || w === 'through') && cur != null && i < words.length - 1) { flush(); out.push('-'); }
    else { flush(); out.push(w); }
  });
  flush();
  return out.join(' ').replace(/ - /g, '-');
}
