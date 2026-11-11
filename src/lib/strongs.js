// Strong's dictionaries (public/strongs, OpenScriptures CC-BY-SA, from Strong's 1890/1894 public-domain text).
const dicts = {};
const load = (lang) => (dicts[lang] ||= fetch(`./strongs/${lang}.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error('missing')))).catch((e) => { delete dicts[lang]; throw e; }));

// "H7225" → { num, lemma, xlit, pron, def, kjv, origin, lang }
export async function lookup(num) {
  const lang = num[0] === 'H' ? 'hebrew' : 'greek';
  const e = (await load(lang))[num];
  if (!e) return null;
  return { num, lemma: e.l, xlit: e.x, pron: e.p, def: e.d, kjv: e.k, origin: e.o, lang: lang === 'hebrew' ? 'Hebrew' : 'Greek' };
}

// The words of a tagged verse: [{ t: 'In the beginning', n: ['H7225'] }, { t: ' ' }, ...]
export function tokens(tagged) {
  const out = [];
  let last = 0;
  tagged.replace(/\[([^|\]]*)\|([^\]]*)\]/g, (m, word, nums, at) => {
    if (at > last) out.push({ t: tagged.slice(last, at) });
    out.push({ t: word, n: nums.split(',') });
    last = at + m.length;
    return m;
  });
  if (last < tagged.length) out.push({ t: tagged.slice(last) });
  return out;
}

// Every verse that uses a Strong's number (for "where else is this word used?").
export function occurrences(bible, num, limit = 300) {
  const out = [];
  const needle = new RegExp(`\\|(?:[^\\]]*,)?${num}(?:,[^\\]]*)?\\]`);
  bible.tagged.forEach((book, b) => book.forEach((ch, c) => ch.forEach((t, v) => {
    if (out.length < limit && needle.test(t)) out.push({ b, c, v });
  })));
  return out;
}
