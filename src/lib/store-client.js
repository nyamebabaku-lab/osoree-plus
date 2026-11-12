// The Ɔsɔreɛ store: Bibles and backgrounds the Super Admin uploads. Free and approved items install by themselves.
import { gunzipSync } from 'fflate';
import { useStore } from '../store.js';
import { api } from './server.js';
import { getDeviceCode } from './licence.js';
import { saveImported } from './bible.js';
import { tx } from './db.js';
import { IS_NATIVE, Screen } from './output.js';

export const installedIds = (st) => new Set([...st.imported.filter((b) => b.store).map((b) => b.store), ...st.media.filter((m) => m.store).map((m) => m.store)]);

export async function loadStore() {
  const device = useStore.getState().deviceCode || await getDeviceCode();
  const r = await api('store', { device });
  useStore.getState().setLicState({ storePending: r.pending.length > 0 });
  return r;
}

const busy = new Set();
export async function install(item) {
  if (busy.has(item.id)) return;
  busy.add(item.id);
  try {
    const device = useStore.getState().deviceCode || await getDeviceCode();
    const { url } = await api('store-download', { device, itemId: item.id });
    const st = useStore.getState();
    if (item.kind === 'bible') {
      const res = await fetch(url);
      if (!res.ok) throw new Error('The download did not finish. Try again.');
      let bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
      const bible = JSON.parse(new TextDecoder().decode(bytes));
      bible.id = 'imp-store-' + item.id.toLowerCase();
      bible.abbr = item.abbr || bible.abbr;
      await saveImported(bible);
      if (!st.imported.some((b) => b.id === bible.id)) st.addImported({ id: bible.id, abbr: bible.abbr, name: item.title, store: item.id });
    } else {
      const video = /video/.test(item.file_type || '');
      const id = 's' + item.id.toLowerCase();
      let entry;
      if (IS_NATIVE) {
        const { path, size } = await Screen.downloadMedia({ url, id, ext: video ? 'mp4' : /png/.test(item.file_type) ? 'png' : 'jpg' });
        entry = { src: '/_capacitor_file_' + path, path, size };
      } else {
        const res = await fetch(url);
        if (!res.ok) throw new Error('The download did not finish. Try again.');
        const blob = await res.blob();
        await tx('media', 'readwrite', (s) => s.put({ id, blob, name: item.title, type: blob.type || item.file_type }));
        entry = { src: 'idb:' + id, size: blob.size };
      }
      if (!useStore.getState().media.some((m) => m.store === item.id)) st.addMedia([{ id, name: item.title, kind: video ? 'video' : 'image', fit: 'cover', store: item.id, loop: video, ...entry }]);
    }
  } finally { busy.delete(item.id); }
}

/** Installs every owned item that is not on this phone yet (after approval, on another church phone, after reinstalling). */
export async function syncStore() {
  const r = await loadStore();
  const have = installedIds(useStore.getState());
  for (const it of r.items) if (!have.has(it.id) && r.owned.includes(it.id)) await install(it).catch(() => {});
  return r;
}
