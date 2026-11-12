// The Ɔsɔreɛ Plus licence server (Supabase Edge Function "osoree"). Only needed for buying, codes and restoring;
// everything else, including checking licences, works offline.
import { IS_NATIVE, Screen } from './output.js';

export const SERVER = import.meta.env.VITE_LICENCE_SERVER || 'https://inoxsalemgwgrzftamxs.supabase.co/functions/v1/osoree';

export async function api(route, body = {}) {
  let r;
  try {
    r = await fetch(`${SERVER}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('No internet connection. Connect to the internet and try again.');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'The Ɔsɔreɛ Plus server did not answer. Try again in a moment.');
  return j;
}

export function openCheckout(url) {
  if (IS_NATIVE) return Screen.openUrl({ url });
  window.open(url, '_blank', 'noopener');
  return Promise.resolve();
}
