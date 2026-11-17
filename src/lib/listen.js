// Scripture listener: spots Bible references in what the preacher says (speech → text), for the operator to confirm.
// Strict on purpose: a book only counts as its full name (or a common spoken form) followed by a number, and the
// chapter and verse must exist in the Bible, so "John said…" or "the 3 people" never pop up.
import { NAMES, refLabel } from './books.js';

const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ORD = { first: '1', second: '2', third: '3', '1st': '1', '2nd': '2', '3rd': '3', one: '1', two: '2', three: '3', i: '1', ii: '2', iii: '3' };

// Full names, squashed ("1corinthians"), plus how people say them.
const SPOKEN = { psalm: 18, psalms: 18, songofsongs: 21, songofsolomon: 21, canticles: 21, revelations: 65, revelation: 65, ecclesiastes: 20, lamentations: 24, philemon: 56, acts: 43, actsoftheapostles: 43, theacts: 43 };
const BOOKS = new Map();
NAMES.forEach((n, i) => BOOKS.set(n.toLowerCase().replace(/[^a-z0-9]/g, ''), i));
Object.entries(SPOKEN).forEach(([k, i]) => BOOKS.set(k, i));
const MAXWORDS = 4; // "acts of the apostles"
const isNum = (t) => typeof t === 'number';

/** Speech → tokens: words, numbers, and the markers "chapter", "verse", "-" (to/through). */
export function tokens(text) {
  const words = String(text || '').toLowerCase().replace(/(\d)\s*:\s*(\d)/g, '$1 verse $2').replace(/(\d)\s*[-–]\s*(\d)/g, '$1 to $2').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const out = [];
  let cur = null;
  const flush = () => { if (cur != null) { out.push(cur); cur = null; } };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/^\d+$/.test(w)) { flush(); out.push(+w); continue; }
    if (UNITS.includes(w)) {
      const u = UNITS.indexOf(w);
      if (cur != null && (cur % 100 === 0 ? cur > 0 : cur % 10 === 0 && cur % 100 >= 20 && u < 10)) cur += u; else { flush(); cur = u; }
    } else if (TENS[w]) {
      if (cur != null && cur % 100 === 0 && cur > 0) cur += TENS[w]; else { flush(); cur = TENS[w]; }
    } else if (w === 'hundred') cur = (cur || 1) * 100;
    else if (w === 'and' && cur != null && cur % 100 === 0 && cur > 0) { /* one hundred and nineteen */ }
    else if (w === 'chapter' || w === 'chapters') { flush(); out.push('chapter'); }
    else if (w === 'verse' || w === 'verses' || w === 'vs' || w === 'v') { flush(); out.push('verse'); }
    else if ((w === 'to' || w === 'through' || w === 'till' || w === 'until') && (cur != null || isNum(out[out.length - 1]))) { flush(); out.push('-'); }
    else { flush(); out.push(w); }
  }
  flush();
  return out;
}


/**
 * References in a piece of speech. context = { b, c } of what is on screen (for "verse 18" alone).
 * Returns [{ b, c, v, v2 }] zero-based, checked against `bible` (books[b][c][v]).
 */
export function findRefs(text, bible, context) {
  const t = tokens(text);
  const out = [];
  const exists = (b, c, v) => !!bible?.books?.[b]?.[c] && (v == null || !!bible.books[b][c][v]);
  // after a book: [chapter] C [verse|:] [V [- V2]]
  const numbers = (j) => {
    if (t[j] === 'chapter') j++;
    if (!isNum(t[j])) return null;
    const c = t[j++];
    let v = null, v2 = null;
    if (t[j] === 'verse') j++;
    if (isNum(t[j])) { v = t[j++]; if (t[j] === '-' && isNum(t[j + 1])) { v2 = t[j + 1]; j += 2; } }
    return { c, v, v2, end: j };
  };
  for (let i = 0; i < t.length; i++) {
    // book: optional ordinal + up to four words
    let found = null;
    for (let len = MAXWORDS; len >= 1 && !found; len--) {
      for (const lead of [1, 0]) {
        const ord = lead ? ORD[String(t[i])] : '';
        if (lead && !ord) continue;
        const words = t.slice(i + lead, i + lead + len);
        if (words.length < len || words.some((x) => typeof x !== 'string' || x === 'chapter' || x === 'verse' || x === '-')) continue;
        let key = words.join('');
        if (key.startsWith('the') && !BOOKS.has(key) && key !== 'theacts') key = key.slice(3); // "the psalms", "the book of"
        if (key.startsWith('bookof')) key = key.slice(6);
        if (key.startsWith('gospelof') || key.startsWith('gospelaccordingto')) key = key.replace(/^gospel(according)?(to|of)/, '');
        const b = BOOKS.get((ord || '') + key);
        if (b == null) continue;
        let n = numbers(i + lead + len);
        if (!n) continue;
        // One-chapter books (Obadiah, Philemon, 2 John, 3 John, Jude): "Jude 3" is verse 3.
        if (bible?.books?.[b]?.length === 1 && n.v == null && n.c > 1) n = { ...n, v: n.c, c: 1 };
        found = { b, ...n };
      }
    }
    if (found) {
      const { b, c, v, v2, end } = found;
      if (exists(b, c - 1, v == null ? null : v - 1)) out.push({ b, c: c - 1, v: v == null ? null : v - 1, v2: v2 != null && v2 > v && exists(b, c - 1, v2 - 1) ? v2 - 1 : null });
      i = end - 1;
      continue;
    }
    // "verse 18", "verses 18 to 20": the chapter on screen
    if (t[i] === 'verse' && isNum(t[i + 1]) && context && context.c != null) {
      const v = t[i + 1], v2 = t[i + 2] === '-' && isNum(t[i + 3]) ? t[i + 3] : null;
      if (exists(context.b, context.c, v - 1)) out.push({ b: context.b, c: context.c, v: v - 1, v2: v2 && v2 > v && exists(context.b, context.c, v2 - 1) ? v2 - 1 : null });
      i += v2 ? 3 : 1;
    }
  }
  return out;
}

export const refKey = (r) => `${r.b}.${r.c}.${r.v}.${r.v2}`;
export const refName = (r, names) => refLabel(r.b, r.c, r.v, r.v2 != null ? r.v2 - r.v + 1 : 1, names);
