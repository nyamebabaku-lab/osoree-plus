// Ɔsɔreɛ Plus Pro: device codes, licences (checked offline) and the free trial.
// A licence is "OSP1.<payload>.<signature>", signed with the private key kept by the Super Admin
// (scripts/licence.mjs); the app only holds the public key, so it can check licences but never make them.
import * as ed from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { LICENCE_PUBLIC_KEY } from './licence-key.js';
import { IS_NATIVE, Screen } from './output.js';

ed.hashes.sha512 = sha512;

// What each Pro feature is called on screen. The Super Admin decides which are Pro (default below).
export const FEATURES = {
  stream: 'Live streaming (YouTube, Facebook…)',
  live: 'Live video, lower thirds, name tags, ticker and picture-in-picture',
  wifi: 'Wi-Fi screens and the Wi-Fi camera',
  docs: 'PDF, PowerPoint, Word and Excel',
  watermark: 'Logo watermark',
  backup: 'Backup and restore',
};
export const DEFAULT_POLICY = { trialDays: 30, pro: Object.keys(FEATURES) };

const DAY = 86400;
const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/1/I/O, easy to read out over the phone

// "OSR-7K2M-9QXP-4D8A": the same on this phone for as long as the phone is not factory-reset.
let deviceCodeCache = null;
export async function getDeviceCode() {
  if (deviceCodeCache) return deviceCodeCache;
  let raw = '';
  if (IS_NATIVE) raw = (await Screen.getDeviceId().catch(() => ({ id: '' }))).id;
  if (!raw) {
    try { raw = localStorage.getItem('osoree-device-id') || ''; } catch { /* storage blocked */ }
    if (!raw) { raw = 'web-' + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(''); try { localStorage.setItem('osoree-device-id', raw); } catch { /* ignore */ } }
  }
  const h = sha256(new TextEncoder().encode('osoree-plus:' + raw));
  let code = '';
  for (let i = 0; i < 12; i++) code += ALPHABET[h[i] % 32];
  deviceCodeCache = `OSR-${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
  return deviceCodeCache;
}

/** Checks a licence. Returns { ok: true, payload } or { ok: false, reason }. now is in seconds. */
export function checkLicence(token, deviceCode, now) {
  const t = String(token || '').trim().replace(/\s+/g, '');
  const parts = t.split('.');
  if (parts.length !== 3 || parts[0] !== 'OSP1') return { ok: false, reason: 'That is not an Ɔsɔreɛ Plus licence. Paste the whole code you were sent.' };
  let payload;
  try {
    if (!ed.verify(b64u(parts[2]), new TextEncoder().encode(parts[1]), b64u(LICENCE_PUBLIC_KEY))) return { ok: false, reason: 'This licence is not genuine (it was changed or not made by Ɔsɔreɛ Plus).' };
    payload = JSON.parse(new TextDecoder().decode(b64u(parts[1])));
  } catch {
    return { ok: false, reason: 'This licence could not be read. Paste the whole code you were sent.' };
  }
  if (payload.d !== deviceCode) return { ok: false, reason: `This licence is for another device (${payload.d}). This device is ${deviceCode}.` };
  if (payload.e && now > payload.e) return { ok: false, reason: `This licence ended on ${new Date(payload.e * 1000).toLocaleDateString()}. Renew it to keep Pro.`, payload, expired: true };
  return { ok: true, payload };
}

/**
 * Where this device stands: { state: 'pro' | 'trial' | 'free', daysLeft, expires, church, problem }.
 * The phone's clock can be wound back to stretch the trial, so time never goes below the latest time seen.
 */
export function licenceStatus({ licence, trialStart, lastSeen }, deviceCode, policy = DEFAULT_POLICY, nowMs = Date.now()) {
  const now = Math.max(Math.floor(nowMs / 1000), lastSeen || 0);
  let problem = '';
  if (licence) {
    const r = checkLicence(licence, deviceCode, now);
    if (r.ok) return { state: 'pro', expires: r.payload.e || 0, church: r.payload.c || '', daysLeft: r.payload.e ? Math.ceil((r.payload.e - now) / DAY) : null, pro: policy.pro };
    problem = r.reason;
  }
  const end = (trialStart || now) + policy.trialDays * DAY;
  if (now < end) return { state: 'trial', daysLeft: Math.ceil((end - now) / DAY), problem, pro: policy.pro };
  return { state: 'free', daysLeft: 0, problem, pro: policy.pro };
}

// The Super Admin's choice of Pro features travels with the status (from the server, or the default).
export const isUnlocked = (status, feature) => !(status.pro || DEFAULT_POLICY.pro).includes(feature) || status.state === 'pro' || status.state === 'trial';

/** The licence's own id ("n"), so the server can say if it was revoked or moved to another phone. */
export function licenceId(token) {
  try { return JSON.parse(new TextDecoder().decode(b64u(String(token).split('.')[1]))).n || ''; } catch { return ''; }
}
