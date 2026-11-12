// A "slide" is anything the operator can put on screen:
//   { type: 'verse', refs: [{ b, c, v, n }] }   one or more passages (combined references)
//   { type: 'song', songId, idx }               one slide of a song
//   { type: 'media', mediaId }                  a picture or video
//   { type: 'pdf', mediaId, page }              one page of a PDF
//   { type: 'strongs', entry, word, ref }       a Strong's word study (entry from lib/strongs.js lookup)
//   { type: 'name', personId }                  only in the plan: shows/hides that person's name tag (see store.toggleName)
import { NAMES, refLabel } from './books.js';
import { blockSize, step as stepVerse, verseText } from './bible.js';
import { songSlides } from './songs.js';
import { fontStack } from './fonts.js';

export const MAX_REFS = 4;
export function slideKey(s) {
  if (s.type === 'verse') return JSON.stringify(['v', s.refs.map((r) => [r.b, r.c, r.v, r.n || 1])]);
  if (s.type === 'song') return JSON.stringify(['s', s.songId, s.idx || 0]);
  if (s.type === 'pdf') return JSON.stringify(['p', s.mediaId, s.page || 0]);
  if (s.type === 'strongs') return JSON.stringify(['g', s.entry.num, s.ref || '']);
  if (s.type === 'name') return JSON.stringify(['n', s.personId]);
  return JSON.stringify(['m', s.mediaId]);
}

export function refsLabel(bible, refs) {
  return refs.map((r) => refLabel(r.b, r.c, r.v, bible ? blockSize(bible, r) : r.n || 1, bible?.bookNames)).join('; ');
}

export function slideTitle(s, { bible, songs, media, people = [] }) {
  if (!s) return '';
  if (s.type === 'verse') return refsLabel(bible, s.refs);
  if (s.type === 'song') {
    const song = songs.find((x) => x.id === s.songId);
    return song ? song.title : 'Song removed';
  }
  if (s.type === 'strongs') return `${s.entry.num} ${s.entry.lemma}${s.word ? ` · “${s.word}”` : ''}`;
  if (s.type === 'name') return people.find((p) => p.id === s.personId)?.name || 'Name removed';
  const m = media.find((x) => x.id === s.mediaId);
  if (!m) return 'Media removed';
  return s.type === 'pdf' ? `${m.name} · page ${(s.page || 0) + 1} of ${m.pages.length}` : m.name;
}

// Next / previous inside the same item. Returns null at the ends or where it means nothing.
export function stepSlide(s, dir, { bible, songs, songLines, span, media = [] }) {
  if (!s) return null;
  if (s.type === 'verse') {
    if (s.refs.length !== 1) return null;
    const p = stepVerse(bible, s.refs[0], dir, s.refs[0].n || span);
    return p && { type: 'verse', refs: [p] };
  }
  if (s.type === 'song') {
    const song = songs.find((x) => x.id === s.songId);
    const n = song ? songSlides(song.lyrics, songLines).length : 0;
    const idx = (s.idx || 0) + dir;
    return idx >= 0 && idx < n ? { ...s, idx } : null;
  }
  if (s.type === 'pdf') {
    const m = media.find((x) => x.id === s.mediaId);
    const page = (s.page || 0) + dir;
    return m && page >= 0 && page < m.pages.length ? { ...s, page } : null;
  }
  return null;
}

const mediaRef = (m) => m && m.kind !== 'pdf' && { src: m.src, kind: m.kind, fit: m.fit || 'contain' };

// The message every screen draws (public/display.html).
export function screenState(st, { bible, compare, songs, media }) {
  const { live, mode, style, video, view, idleId, songLines, cam, lt, ticker, watermark, people = [], nameOn, nameTag, pip, pipLook } = st;
  const look = {
    bg: style.bg, fg: style.fg, accent: style.accent, align: style.align, upper: style.upper, showRef: style.showRef,
    font: fontStack(style.font), size: style.size, blend: style.blend, shadow: style.shadow,
    bgMedia: mediaRef(media.find((m) => m.id === style.bgId)),
  };
  // Shared by every message: the camera, the lower-third look and the scrolling ticker.
  const extra = {
    // 'phone': the preview takes the app's own camera, the projector opens it directly (no network needed),
    // and Wi-Fi screens receive it over Wi-Fi.
    cam: cam?.on ? { source: cam.source, deviceId: cam.deviceId, facing: cam.facing, mirror: cam.mirror } : null,
    lt: lt && { ...lt, font: fontStack(lt.font) },
    ticker: ticker?.on && ticker.text.trim() ? { text: ticker.text.trim(), speed: ticker.speed } : null,
    watermark: (() => { const m = watermark?.id && media.find((x) => x.id === watermark.id && x.kind === 'image'); return m ? { src: m.src, corner: watermark.corner, x: watermark.x ?? 3, y: watermark.y ?? 4, size: watermark.size, opacity: watermark.opacity, all: watermark.where === 'all' } : null; })(),
    // Picture-in-picture box over whatever is showing.
    pip: (() => {
      const m = pip?.mediaId && media.find((x) => x.id === pip.mediaId);
      if (!m) return null;
      const src = m.kind === 'pdf' ? m.pages[Math.min(pip.page || 0, m.pages.length - 1)] : m.src;
      return { src, kind: m.kind === 'video' ? 'video' : 'image', ...pipLook, playing: pip.playing, seq: pip.seq };
    })(),
    // The name tag lies over whatever is showing.
    nametag: (() => { const p = nameOn && people.find((x) => x.id === nameOn); return p ? { name: p.name, title: p.title || '', ...(nameTag || {}) } : null; })(),
  };
  const msg = (m) => ({ ...m, ...extra });
  if (mode === 'black') return { kind: 'black', style: look };
  const idle = msg({ kind: 'idle', idle: mediaRef(media.find((m) => m.id === idleId)), style: look });
  if (mode !== 'show' || !live) return idle;

  if (live.type === 'verse') {
    const bibles = compare && compare !== bible ? [bible, compare] : [bible];
    const groups = live.refs.map((r) => {
      const n = blockSize(bible, r);
      return {
        ref: refLabel(r.b, r.c, r.v, n, bible.bookNames),
        cols: bibles.map((bb) => ({ abbr: bb.abbr, ref: refLabel(r.b, r.c, r.v, n, bb.bookNames), verses: Array.from({ length: n }, (_, i) => ({ n: r.v + i + 1, t: verseText(bb, r.b, r.c, r.v + i) })) })),
      };
    });
    return msg({ kind: 'verse', groups, style: look });
  }
  if (live.type === 'song') {
    const song = songs.find((x) => x.id === live.songId);
    const slide = song && songSlides(song.lyrics, songLines)[live.idx || 0];
    if (!slide) return idle;
    return msg({ kind: 'song', title: song.title, lines: slide.lines, style: look });
  }
  if (live.type === 'strongs') return msg({ kind: 'strongs', entry: live.entry, word: live.word || '', ref: live.ref || '', style: look });
  if (live.type === 'name') return idle; // (older saved state; names are tags now)
  const m = media.find((x) => x.id === live.mediaId);
  if (!m) return idle;
  if (live.type === 'pdf') {
    const src = m.pages[live.page || 0];
    return src ? msg({ kind: 'media', media: { src, kind: 'image', fit: m.fit || 'contain' }, video, view, style: look }) : idle;
  }
  return msg({ kind: 'media', media: mediaRef(m), video, view, style: look });
}

export const bookName = (b) => NAMES[b];
