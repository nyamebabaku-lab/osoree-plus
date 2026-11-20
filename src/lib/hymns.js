// Hymn books on this device. They are big (hundreds of hymns), so they live in IndexedDB (the 'bibles' store,
// ids "hymnal-…"), with only a short list in the app's settings. Every hymn shows as a song with the id
// "h:<book id>:<hymn key>", so the plan, Next / Previous, Wi-Fi screens and streaming work as for songs.
import { tx } from './db.js';

const books = new Map(); // book id → { id, title, hymns: [{ k, n, title, author, lyrics }] }
const dbId = (id) => 'hymnal-' + id;

export const hymnSongId = (bookId, k) => `h:${bookId}:${k}`;
export const isHymn = (songId) => String(songId || '').startsWith('h:');
export const getBook = (id) => books.get(id) || null;

/** A song by id: the church's own songs, or a hymn from a loaded hymn book (title "123 Amazing Grace"). */
export function findSong(songs, id) {
  if (!isHymn(id)) return songs.find((x) => x.id === id) || null;
  const [, bookId, ...rest] = id.split(':');
  const k = rest.join(':');
  const h = books.get(bookId)?.hymns.find((x) => x.k === k);
  return h ? { id, title: h.n ? `${h.n} ${h.title}` : h.title, author: h.author, lyrics: h.lyrics, hymn: true } : null;
}

export async function saveHymnal(id, hymnal) {
  const book = { ...hymnal, id };
  await tx('bibles', 'readwrite', (s) => s.put({ ...book, id: dbId(id) }));
  books.set(id, book);
  return book;
}
export async function deleteHymnal(id) {
  await tx('bibles', 'readwrite', (s) => s.delete(dbId(id)));
  books.delete(id);
}
/** Loads the books listed in the settings that are not in memory yet. Returns true when something was loaded. */
export async function loadHymnals(ids) {
  let changed = false;
  for (const id of ids) {
    if (books.has(id)) continue;
    const b = await tx('bibles', 'readonly', (s) => s.get(dbId(id))).catch(() => null);
    if (b) { books.set(id, { ...b, id }); changed = true; }
  }
  return changed;
}

/** Hymns matching a number ("456") or words in the title / first lines. */
export function searchBook(book, q) {
  if (!book) return [];
  const t = q.trim().toLowerCase();
  if (!t) return book.hymns;
  if (/^\d+[a-z]?$/.test(t)) {
    const exact = book.hymns.filter((h) => h.n.toLowerCase() === t);
    return exact.length ? exact : book.hymns.filter((h) => h.n.startsWith(t));
  }
  return book.hymns.filter((h) => h.title.toLowerCase().includes(t) || h.lyrics.toLowerCase().includes(t));
}
