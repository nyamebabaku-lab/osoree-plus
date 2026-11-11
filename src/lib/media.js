// Pictures and videos to project. In the browser the files live in IndexedDB;
// in the phone app they are copied into the app's own storage by the Screen plugin.
import { useEffect, useState } from 'react';
import { tx } from './db.js';
import { IS_NATIVE, Screen } from './output.js';

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const kindOf = (type, name) => (/^video\//.test(type) || /\.(mp4|m4v|webm|mov)$/i.test(name) ? 'video' : 'image');

// Browser: files chosen with <input type="file">. Returns the new library entries.
export async function addMediaFiles(files, onProgress) {
  const out = [];
  for (const f of files) {
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) { out.push(await addPdfFile(f, (n, t) => onProgress?.(`${f.name}: page ${n} of ${t}`))); continue; }
    if (!/^(image|video)\//.test(f.type) && !/\.(mp4|m4v|webm|mov|jpe?g|png|gif|webp)$/i.test(f.name)) continue;
    const id = newId();
    await tx('media', 'readwrite', (s) => s.put({ id, blob: f, name: f.name, type: f.type }));
    out.push({ id, name: f.name.replace(/\.[^.]+$/, ''), kind: kindOf(f.type, f.name), src: 'idb:' + id, size: f.size, fit: 'contain' });
  }
  return out;
}

// Browser: a PDF becomes one picture per page (rendered with PDF.js, kept in IndexedDB).
export const MAX_PDF_PAGES = 300;
export async function addPdfFile(file, onProgress) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const id = newId();
  const total = Math.min(doc.numPages, MAX_PDF_PAGES);
  const pages = [];
  let size = 0;
  for (let n = 1; n <= total; n++) {
    onProgress?.(n, total);
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1920 / base.width, 1080 / base.height) * 1.5; // sharp on a 1080p screen
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
    const pid = `${id}-p${n}`;
    await tx('media', 'readwrite', (s) => s.put({ id: pid, blob, name: `${file.name} ${n}`, type: 'image/jpeg' }));
    pages.push('idb:' + pid);
    size += blob.size;
    page.cleanup();
  }
  await doc.destroy();
  return { id, name: file.name.replace(/\.pdf$/i, ''), kind: 'pdf', pages, src: pages[0], size, fit: 'contain', more: doc.numPages > total ? doc.numPages : 0 };
}

// Phone app: the system file picker; the plugin copies the files and returns where they are.
export async function pickNativeMedia() {
  const { items } = await Screen.pickMedia();
  return items.map((x) => (x.pages
    ? { id: x.id, name: x.name.replace(/\.[^.]+$/, ''), kind: 'pdf', pages: x.pages.map((p) => '/_capacitor_file_' + p), src: '/_capacitor_file_' + x.pages[0], path: x.path, size: x.size, fit: 'contain', more: x.more || 0 }
    : { id: x.id, name: x.name.replace(/\.[^.]+$/, ''), kind: kindOf(x.type, x.name), src: '/_capacitor_file_' + x.path, path: x.path, size: x.size, fit: 'contain' }));
}

export async function removeMediaFile(item) {
  if (item.path) await Screen?.deleteMedia({ path: item.path }).catch(() => {});
  else if (item.kind === 'pdf') await tx('media', 'readwrite', (s) => item.pages.forEach((p) => s.delete(p.slice(4)))).catch(() => {});
  else await tx('media', 'readwrite', (s) => s.delete(item.id)).catch(() => {});
}

export const canPickMedia = () => IS_NATIVE || typeof indexedDB !== 'undefined';

// A URL the operator's own screen can show: blobs come out of IndexedDB, app files are served by Capacitor.
const urls = new Map();
export function useMediaUrl(src) {
  const [url, setUrl] = useState(() => (src && !src.startsWith('idb:') ? src : urls.get(src) || ''));
  useEffect(() => {
    if (!src) { setUrl(''); return undefined; }
    if (!src.startsWith('idb:')) { setUrl(src); return undefined; }
    if (urls.has(src)) { setUrl(urls.get(src)); return undefined; }
    let on = true;
    tx('media', 'readonly', (s) => s.get(src.slice(4))).then((row) => {
      if (!row) return;
      if (!urls.has(src)) urls.set(src, URL.createObjectURL(row.blob));
      if (on) setUrl(urls.get(src));
    }).catch(() => {});
    return () => { on = false; };
  }, [src]);
  return url;
}

export const formatSize = (n) => (n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');
