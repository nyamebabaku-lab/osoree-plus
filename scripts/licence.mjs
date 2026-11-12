#!/usr/bin/env node
// Ɔsɔreɛ Plus licences, signed with the private key kept in ../osoree-plus-signing (never in this repository).
//
//   node scripts/licence.mjs init                         create the key pair (once) and write src/lib/licence-key.js
//   node scripts/licence.mjs issue OSR-XXXX-XXXX-XXXX     Pro for that device, for ever
//        [--years 1 | --until 2027-12-31] [--church "Grace Chapel"] [--phone 0240000000] [--note "paid MoMo 12/11"]
//   node scripts/licence.mjs show <licence>               read a licence
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
ed.hashes.sha512 = sha512;

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const keyFile = path.resolve(root, '../osoree-plus-signing/licence-private.key');
const pubFile = path.join(root, 'src/lib/licence-key.js');
const b64u = (b) => Buffer.from(b).toString('base64url');
const [cmd, ...args] = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };

if (cmd === 'init') {
  if (fs.existsSync(keyFile)) { console.error(`A key already exists in ${keyFile}; not replacing it (old licences would stop working).`); process.exit(1); }
  const priv = ed.utils.randomSecretKey();
  const pub = ed.getPublicKey(priv);
  fs.writeFileSync(keyFile, b64u(priv) + '\n', { mode: 0o600 });
  fs.writeFileSync(pubFile, `// Public half of the licence signing key (scripts/licence.mjs). Safe to publish.\nexport const LICENCE_PUBLIC_KEY = '${b64u(pub)}';\n`);
  console.log('Licence key created.\n  private (keep safe, back it up):', keyFile, '\n  public (in the app):', pubFile);
} else if (cmd === 'issue') {
  const device = (args[0] || '').toUpperCase();
  if (!/^OSR(-[0-9A-Z]{4}){3}$/.test(device)) { console.error('Give the device code shown in the app, like OSR-7K2M-9QXP-4D8A.'); process.exit(1); }
  const priv = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64url');
  const years = parseFloat(opt('years', '0'));
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1, d: device, p: 'pro', i: now,
    e: opt('until') ? Math.floor(new Date(opt('until') + 'T23:59:59Z').getTime() / 1000) : years > 0 ? now + Math.round(years * 365.25 * 86400) : 0,
    n: crypto.randomBytes(6).toString('base64url'), c: opt('church', ''), ph: opt('phone', ''), note: opt('note', ''),
  };
  for (const k of ['c', 'ph', 'note']) if (!payload[k]) delete payload[k];
  const body = b64u(Buffer.from(JSON.stringify(payload)));
  const sig = ed.sign(Buffer.from(body), priv);
  console.log(`OSP1.${body}.${b64u(sig)}`);
} else if (cmd === 'show') {
  const [, body] = (args[0] || '').split('.');
  console.log(JSON.parse(Buffer.from(body || '', 'base64url').toString()));
} else {
  console.log('Usage: node scripts/licence.mjs init | issue <device code> [--years N] [--church NAME] | show <licence>');
}
