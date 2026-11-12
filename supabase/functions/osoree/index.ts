// Ɔsɔreɛ Plus licence server (Supabase Edge Function "osoree"). The rules live in core.js.
//   POST /osoree/<route>  JSON body  ->  JSON   (routes: config, hello, buy, buy-status, redeem, restore-start,
//                                                restore-finish, admin/*)
//   POST /osoree/webhook?p=paystack|hubtel      payment provider callbacks
//   GET  /osoree/done, /osoree/test-pay?ref=    small pages shown in the phone's browser after paying
import postgres from 'npm:postgres@3.4.5';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import * as ed from 'npm:@noble/ed25519@3.2.0';
import { sha512 } from 'npm:@noble/hashes@2.4.0/sha2.js';
import { ALPHABET, Fail, handle } from './core.js';

ed.hashes.sha512 = sha512;
const env = (k: string) => Deno.env.get(k) || '';
const sql = postgres(env('SUPABASE_DB_URL'), { prepare: false, max: 3 });
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const text = (t: string) => new Response(t + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
// Private store files: one-time signed addresses (service key stays on the server).
const storage = {
  async signDownload(path: string) {
    const r = await fetch(`${env('SUPABASE_URL')}/storage/v1/object/sign/store/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.message || 'Storage error');
    return `${env('SUPABASE_URL')}/storage/v1${j.signedURL}`;
  },
  async signUpload(path: string) {
    const r = await fetch(`${env('SUPABASE_URL')}/storage/v1/object/upload/sign/store/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' }, body: '{}' });
    const j = await r.json(); if (!r.ok) throw new Error(j.message || 'Storage error');
    return { url: `${env('SUPABASE_URL')}/storage/v1${j.url}` };
  },
};
const deps = {
  storage,
  query: (text: string, params: unknown[] = []) => sql.unsafe(text, params as never[]),
  now: () => new Date(),
  async sign(payload: unknown) {
    const body = b64u(new TextEncoder().encode(JSON.stringify(payload)));
    const sig = await ed.signAsync(new TextEncoder().encode(body), fromB64u(env('LICENCE_PRIVATE_KEY')));
    return `OSP1.${body}.${b64u(sig)}`;
  },
  fetch: (u: string, o?: RequestInit) => fetch(u, o),
  env: (k: string) => (k === 'FN_URL' ? `${env('SUPABASE_URL')}/functions/v1/osoree` : env(k)),
  random: (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => ALPHABET[x % 32]).join(''),
  sha256: async (t: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))),
};

async function signedInUser(req: Request) {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data } = await sb.auth.getUser();
  return data.user || null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = new URL(req.url);
  const route = url.pathname.replace(/^.*?\/osoree\/?/, '').replace(/\/$/, '');
  try {
    if (route === 'done') return text('Thank you.\n\nGo back to Ɔsɔreɛ Plus now. Pro switches on by itself in a few seconds.');
    // Supabase shows functions' web pages as plain text, so this page is written as text.
    if (route === 'about' || route === '') return new Response(`Ɔsɔreɛ Plus
Church projection app for Ghana: Bible verses, songs, pictures and videos from a phone to any screen, with or without internet.

SMS one-time codes (OTP)
When a church moves its Ɔsɔreɛ Plus Pro licence to a new phone, we send a one-time code by SMS (sender ID OsoreePlus) to the phone number given when the licence was bought. The code is typed into the app to confirm the move. It is valid for 10 minutes and works only once. We never ask for the code by phone call.
`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    if (route === 'confirmed') return text('E-mail confirmed.\n\nGo back to Ɔsɔreɛ Admin and sign in with your e-mail and password.');
    if (route === 'test-pay') {
      // Test mode only (the server refuses otherwise): opening the link counts as paying.
      await handle(deps, 'test-pay', { ref: url.searchParams.get('ref') });
      return text('Paid (test mode: no money was taken).\n\nGo back to Ɔsɔreɛ Plus now: Pro switches on by itself.');
    }
    if (route === 'webhook') {
      const raw = await req.text();
      const hmac = async (text: string) => {
        const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env('PAYSTACK_SECRET_KEY')), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
        return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
      };
      return json(await handle(deps, 'webhook', {}, { p: url.searchParams.get('p'), k: url.searchParams.get('k'), raw, signature: req.headers.get('x-paystack-signature'), hmac }));
    }
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const user = route.startsWith('admin/') ? await signedInUser(req) : null;
    return json(await handle(deps, route, body, { user }));
  } catch (e) {
    const status = e instanceof Fail ? e.status : 500;
    if (status === 500) console.error(e);
    return json({ error: status === 500 ? 'Something went wrong on the server.' : (e as Error).message }, status);
  }
});
