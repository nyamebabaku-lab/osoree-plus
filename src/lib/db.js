// The on-device database (IndexedDB): imported Bibles and, in the browser, pictures and videos.
// public/display.html opens the same database with the same version and stores.
const NAME = 'osoree-plus';
const VERSION = 2;
let opening = null;

export function db() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const r = indexedDB.open(NAME, VERSION);
      r.onupgradeneeded = () => {
        ['bibles', 'media'].forEach((s) => { if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' }); });
      };
      r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); opening = null; }; resolve(r.result); };
      r.onerror = () => { opening = null; reject(r.error); };
    });
  }
  return opening;
}

export async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage is full.'));
  });
}
