// Super Admin sign-in (Supabase Auth, e-mail + password) and calls to the licence server's admin routes.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from './config.js';
import { SERVER } from '../lib/server.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'osoree-admin-auth' } });

export async function admin(route, body = {}) {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Signed out. Sign in again.');
  let r;
  try {
    r = await fetch(`${SERVER}/admin/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  } catch {
    throw new Error('No internet connection.');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'The server did not answer.');
  return j;
}
