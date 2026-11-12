import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { MAX_REFS, slideKey } from './lib/slides.js';
import { STARTER_SONGS } from './lib/songs.js';

export const DEFAULT_STYLE = {
  bg: '#000000', fg: '#ffffff', accent: '#e2b232', align: 'center', font: 'serif', size: 'M',
  showRef: true, upper: false, shadow: true, bgId: '', blend: 0.45,
};
export const MAX_SPAN = 8;
// The bar used for text in live-video mode and on the streaming overlay.
export const DEFAULT_LT = { bg: '#0b1f3a', opacity: 0.8, fg: '#ffffff', accent: '#e2b232', size: 'M', align: 'left', font: 'sans' };
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const sameRef = (x, y) => x.b === y.b && x.c === y.c && x.v === y.v && (x.n || 1) === (y.n || 1);

export const useStore = create(persist((set, get) => ({
  versionId: 'kjv',
  compareId: '', // a second version shown beside the first; '' = off
  themeMode: 'dark', // dark | light | system
  style: DEFAULT_STYLE,
  imported: [], // [{ id, abbr, name }] — the texts themselves are in IndexedDB
  span: 1, // how many verses go on screen together
  combine: false, // tapping a verse adds it to what is showing instead of replacing it
  strongsOn: true, // in a Strong's Bible, words can be tapped for their Hebrew / Greek
  songs: STARTER_SONGS,
  songLines: 0, // 0 = a whole verse/chorus per slide, otherwise at most this many lines
  media: [], // [{ id, name, kind: image|video, src, path?, size, fit: contain|cover }]
  idleId: '', // picture or video shown when the screen is cleared
  plan: [], // slides with an id
  history: [], // verse slides recently shown
  live: null, // the slide on screen (see lib/slides.js)
  mode: 'clear', // show | clear | black
  video: { playing: true, seq: 0, loop: false, muted: false },
  // Live video: a camera fills the screen and text moves to a lower third.
  cam: { on: false, source: 'device', deviceId: '', facing: 'environment', mirror: false },
  lt: DEFAULT_LT,
  people: [], // names for the lower third: [{ id, name, title }]
  ticker: { on: false, text: '', speed: 1 },
  watermark: { id: '', corner: 'tr', x: 3, y: 4, size: 0.1, opacity: 0.85, where: 'all' }, // church logo; x/y = % from the edges
  nameOn: '', // the person whose name tag is showing (on top of whatever is on screen)
  nameTag: { align: 'left', x: 3, y: 4, size: 0.045 }, // x = % from the side, y = % from the bottom, size = share of screen height
  // Live streaming from the phone: up to 3 platforms at once.
  streamCfg: {
    targets: [
      { id: 't1', platform: 'youtube', url: 'rtmps://a.rtmps.youtube.com/live2', key: '', on: true },
      { id: 't2', platform: 'facebook', url: 'rtmps://live-api-s.facebook.com:443/rtmp/', key: '', on: false },
      { id: 't3', platform: 'custom', url: '', key: '', on: false },
    ],
    quality: '720p', shape: 'landscape', audioInput: -1,
  },
  onAir: false, // a live stream is running (not saved)
  camAddress: '', // camera mode: the main phone's address
  camStatus: null, // this phone's camera while live video is on: { state, screens } or { error }

  setVersion: (versionId) => set({ versionId, compareId: get().compareId === versionId ? '' : get().compareId }),
  setCompare: (compareId) => set({ compareId }),
  setThemeMode: (themeMode) => set({ themeMode }),
  setStyle: (patch) => set({ style: { ...get().style, ...patch } }),
  setCombine: (combine) => set({ combine }),
  setStrongsOn: (strongsOn) => set({ strongsOn }),
  setSongLines: (songLines) => set({ songLines }),
  setIdle: (idleId) => set({ idleId }),

  goLive: (slide) => {
    // A name is a tag laid over whatever is showing: tapping it shows or hides the tag.
    if (slide.type === 'name') { get().toggleName(slide.personId); return; }
    const { live, mode, combine, history, video } = get();
    let next = slide;
    if (combine && slide.type === 'verse' && live?.type === 'verse' && mode === 'show') {
      const refs = [...live.refs.filter((r) => !slide.refs.some((x) => sameRef(x, r))), ...slide.refs].slice(-MAX_REFS);
      next = { type: 'verse', refs };
    }
    const newMedia = next.type === 'media' && (live?.type !== 'media' || live.mediaId !== next.mediaId);
    set({
      live: next,
      mode: 'show',
      video: newMedia ? { ...video, playing: true, seq: video.seq + 1 } : video,
      history: next.type === 'verse' ? [next, ...history.filter((h) => slideKey(h) !== slideKey(next))].slice(0, 30) : history,
    });
  },
  // Show verse v (and the n - 1 after it); n left out uses the "verses together" setting.
  showVerse: (b, c, v, n) => get().goLive({ type: 'verse', refs: [{ b, c, v, n: n || get().span }] }),
  setSpan: (n) => {
    const span = Math.max(1, Math.min(MAX_SPAN, n));
    const { live } = get();
    set({ span, live: live?.type === 'verse' && live.refs.length === 1 ? { type: 'verse', refs: [{ ...live.refs[0], n: span }] } : live });
  },
  removeRef: (i) => {
    const { live } = get();
    if (live?.type !== 'verse' || live.refs.length < 2) return;
    set({ live: { type: 'verse', refs: live.refs.filter((_, k) => k !== i) } });
  },
  setMode: (mode) => set({ mode }),
  setCam: (patch) => set({ cam: { ...get().cam, ...patch } }),
  setLt: (patch) => set({ lt: { ...get().lt, ...patch } }),
  setCamAddress: (camAddress) => set({ camAddress }),
  setCamStatus: (camStatus) => set({ camStatus }),
  setTicker: (patch) => set({ ticker: { ...get().ticker, ...patch } }),
  setWatermark: (patch) => set({ watermark: { ...get().watermark, ...patch } }),
  setNameTag: (patch) => set({ nameTag: { ...get().nameTag, ...patch } }),
  toggleName: (id) => set({ nameOn: get().nameOn === id ? '' : id }),
  setStreamCfg: (patch) => set({ streamCfg: { ...get().streamCfg, ...patch } }),
  setStreamTarget: (id, patch) => set({ streamCfg: { ...get().streamCfg, targets: get().streamCfg.targets.map((t) => (t.id === id ? { ...t, ...patch } : t)) } }),
  setOnAir: (onAir) => set({ onAir }),
  savePerson: (p) => {
    const people = get().people;
    set({ people: people.some((x) => x.id === p.id) ? people.map((x) => (x.id === p.id ? p : x)) : [...people, { ...p, id: p.id || newId() }] });
  },
  deletePerson: (id) => {
    const { live } = get();
    set({ people: get().people.filter((x) => x.id !== id), plan: get().plan.filter((x) => x.personId !== id), live: live?.personId === id ? null : live, nameOn: get().nameOn === id ? '' : get().nameOn });
  },
  setVideo: (patch) => set({ video: { ...get().video, ...patch } }),
  restartVideo: () => set({ video: { ...get().video, playing: true, seq: get().video.seq + 1 } }),

  addPlan: (slide) => { if (!get().plan.some((x) => slideKey(x) === slideKey(slide))) set({ plan: [...get().plan, { ...slide, id: newId() }] }); },
  removePlan: (id) => set({ plan: get().plan.filter((x) => x.id !== id) }),
  movePlan: (id, dir) => {
    const plan = [...get().plan];
    const i = plan.findIndex((x) => x.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= plan.length) return;
    [plan[i], plan[j]] = [plan[j], plan[i]];
    set({ plan });
  },
  clearPlan: () => set({ plan: [] }),
  clearHistory: () => set({ history: [] }),

  saveSong: (song) => {
    const songs = get().songs;
    set({ songs: songs.some((s) => s.id === song.id) ? songs.map((s) => (s.id === song.id ? song : s)) : [song, ...songs] });
  },
  addSongs: (list) => set({ songs: [...list, ...get().songs] }),
  deleteSong: (id) => {
    const { live } = get();
    set({ songs: get().songs.filter((s) => s.id !== id), plan: get().plan.filter((p) => p.songId !== id), live: live?.songId === id ? null : live });
  },

  addMedia: (items) => set({ media: [...items, ...get().media] }),
  updateMedia: (id, patch) => set({ media: get().media.map((m) => (m.id === id ? { ...m, ...patch } : m)) }),
  removeMedia: (id) => {
    const { live, style, idleId } = get();
    set({
      media: get().media.filter((m) => m.id !== id),
      plan: get().plan.filter((p) => p.mediaId !== id),
      live: live?.mediaId === id ? null : live,
      idleId: idleId === id ? '' : idleId,
      watermark: get().watermark.id === id ? { ...get().watermark, id: '' } : get().watermark,
      style: style.bgId === id ? { ...style, bgId: '' } : style,
    });
  },

  addImported: (meta) => set({ imported: [...get().imported, meta] }),
  removeImported: (id) => set({
    imported: get().imported.filter((x) => x.id !== id),
    versionId: get().versionId === id ? 'kjv' : get().versionId,
    compareId: get().compareId === id ? '' : get().compareId,
  }),
}), {
  name: 'osoree-plus',
  version: 4,
  // Version 1 kept single verses as { b, c, v, n }; version 2 darkened pictures with "dim" instead of blending.
  migrate: (old, from) => {
    // Version 3: the watermark showed on the stream only, with fixed margins; names replaced the screen.
    if (from === 3) return { ...old, watermark: { ...old.watermark, x: 3, y: 4, where: 'all' }, live: old.live?.type === 'name' ? null : old.live };
    if (from === 2) return { ...old, style: { ...DEFAULT_STYLE, ...old.style, blend: old.style?.dim ?? DEFAULT_STYLE.blend } };
    const toSlide = (x) => ({ type: 'verse', refs: [{ b: x.b, c: x.c, v: x.v, n: x.n || 1 }] });
    return {
      ...old,
      plan: (old.plan || []).map((x) => ({ ...toSlide(x), id: x.id })),
      history: (old.history || []).map(toSlide),
      live: old.pos ? toSlide(old.pos) : null,
      mode: 'clear',
      style: { ...DEFAULT_STYLE, ...(old.style || {}) },
    };
  },
  partialize: ({ video, camStatus, onAir, nameOn, ...rest }) => rest, // eslint-disable-line no-unused-vars
}));

// Is verse v of chapter c of book b part of what is showing?
export const isLiveVerse = (s, b, c, v) => s.mode === 'show' && s.live?.type === 'verse' && s.live.refs.some((r) => r.b === b && r.c === c && v >= r.v && v < r.v + (r.n || 1));
