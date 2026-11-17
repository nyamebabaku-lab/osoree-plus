// Apple in-app purchases: signature checks (with a stand-in certificate chain) and licences from transactions.
import * as x509 from '@peculiar/x509';
import { webcrypto } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { appleVerifier, APPLE_ROOT_G3 } from '../supabase/functions/osoree/apple.js';
import { ALPHABET, handle } from '../supabase/functions/osoree/core.js';
x509.cryptoProvider.set(webcrypto);
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, x); };
const alg = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };
const keys = () => webcrypto.subtle.generateKey(alg, true, ['sign', 'verify']);
const ext = (oid) => new x509.Extension(oid, false, new Uint8Array([5, 0]));
const day = 86400000, from = new Date(Date.now() - day), to = new Date(Date.now() + 365 * day);
async function chain({ leafOid = true } = {}) {
  const rk = await keys(), mk = await keys(), lk = await keys();
  const root = await x509.X509CertificateGenerator.createSelfSigned({ serialNumber: '01', name: 'CN=Test Root', notBefore: from, notAfter: to, keys: rk, signingAlgorithm: alg });
  const mid = await x509.X509CertificateGenerator.create({ serialNumber: '02', subject: 'CN=Test WWDR', issuer: root.subject, notBefore: from, notAfter: to, publicKey: mk.publicKey, signingKey: rk.privateKey, signingAlgorithm: alg, extensions: [ext('1.2.840.113635.100.6.2.1')] });
  const leaf = await x509.X509CertificateGenerator.create({ serialNumber: '03', subject: 'CN=Test Leaf', issuer: mid.subject, notBefore: from, notAfter: to, publicKey: lk.publicKey, signingKey: mk.privateKey, signingAlgorithm: alg, extensions: leafOid ? [ext('1.2.840.113635.100.6.11.1')] : [] });
  const b64 = (c) => Buffer.from(c.rawData).toString('base64');
  return { root: b64(root), x5c: [b64(leaf), b64(mid), b64(root)], key: lk.privateKey };
}
const b64u = (s) => Buffer.from(s).toString('base64url');
async function sign(c, payload) {
  const head = b64u(JSON.stringify({ alg: 'ES256', x5c: c.x5c })), body = b64u(JSON.stringify(payload));
  const sig = await webcrypto.subtle.sign(alg, c.key, new TextEncoder().encode(head + '.' + body));
  return `${head}.${body}.${Buffer.from(sig).toString('base64url')}`;
}
const c = await chain();
const verify = appleVerifier(x509, { roots: [c.root, APPLE_ROOT_G3] });
const tx = { bundleId: 'com.osoree.plus', productId: 'com.osoree.plus.pro', transactionId: '2000000123', originalTransactionId: '2000000123', purchaseDate: Date.now(), price: 4990, currency: 'USD', environment: 'Sandbox' };
const good = await sign(c, tx);
ok('genuine transaction accepted', (await verify(good)).productId === 'com.osoree.plus.pro');
const [h, , s] = good.split('.');
await verify(`${h}.${b64u(JSON.stringify({ ...tx, productId: 'com.osoree.plus.pro.year' }))}.${s}`).then(() => ok('changed transaction refused', false), (e) => ok('changed transaction refused', /signature/.test(e.message), e.message));
const other = await chain();
await appleVerifier(x509)(await sign(other, tx)).then(() => ok('other certificate chain refused', false), (e) => ok('other certificate chain refused', /Not signed by Apple/.test(e.message), e.message));
const noOid = await chain({ leafOid: false });
await appleVerifier(x509, { roots: [noOid.root] })(await sign(noOid, tx)).then(() => ok('certificate without the App Store mark refused', false), (e) => ok('certificate without the App Store mark refused', /App Store certificate/.test(e.message)));
await verify('junk').then(() => ok('junk refused', false), () => ok('junk refused', true));
ok('the real Apple Root CA G3 is built in', Buffer.from(APPLE_ROOT_G3, 'base64').includes(Buffer.from('Apple Root CA - G3')));

// licences from App Store purchases
const pg = new PGlite();
for (const f of fs.readdirSync('supabase/migrations').sort()) await pg.exec(fs.readFileSync(`supabase/migrations/${f}`, 'utf8'));
const d = { query: async (t, p = []) => (await pg.query(t, p)).rows, now: () => new Date(), sign: async (x) => `OSP1.${Buffer.from(JSON.stringify(x)).toString('base64url')}.sig`, env: () => '', fetch: async () => ({ ok: true, json: async () => ({}) }),
  random: (n) => Array.from(crypto.randomBytes(n), (x) => ALPHABET[x % 32]).join(''), sha256: async (t) => crypto.createHash('sha256').update(t).digest('hex'), apple: verify };
const call = async (r, b) => { try { return await handle(d, r, b); } catch (e) { return { error: e.message, status: e.status }; } };
const lic = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url'));
const P1 = 'OSR-AAAA-BBBB-CCCC', P2 = 'OSR-DDDD-EEEE-FFFF';
const r1 = await call('apple', { device: P1, jws: good });
ok('purchase gives a Pro licence for the iPhone', r1.licence && lic(r1.licence).d === P1 && lic(r1.licence).e === 0, JSON.stringify(r1).slice(0, 80));
ok('same purchase again: same licence', (await call('apple', { device: P1, jws: good })).licence === r1.licence);
const r2 = await call('apple', { device: P2, jws: good });
ok('Restore purchases on a new iPhone moves the licence', lic(r2.licence).d === P2 && (await d.query("select status from licences where device_code = $1", [P1]))[0].status === 'moved');
ok('one payment recorded, from Apple', (await d.query("select count(*)::int n from payments where provider = 'apple'"))[0].n === 1);
ok('refunded purchase refused', (await call('apple', { device: P1, jws: await sign(c, { ...tx, transactionId: '9', originalTransactionId: '9', revocationDate: Date.now() }) })).error?.includes('refunded'));
ok('another app\'s purchase refused', (await call('apple', { device: P1, jws: await sign(c, { ...tx, bundleId: 'com.other.app', originalTransactionId: '8' }) })).error?.includes('another app'));
const yr = await call('apple', { device: P1, jws: await sign(c, { ...tx, productId: 'com.osoree.plus.pro.year', transactionId: '7', originalTransactionId: '7', purchaseDate: Date.now() - 100 * 86400000 }) });
const yl = lic(yr.licence);
ok('one year counts from the App Store purchase date', Math.abs(yl.e - Math.floor((Date.now() - 100 * 86400000 + 365 * 86400000) / 1000)) < 86400 * 2, JSON.stringify(yl));
ok('an ended one-year purchase cannot be restored', (await call('apple', { device: P2, jws: await sign(c, { ...tx, productId: 'com.osoree.plus.pro.year', transactionId: '6', originalTransactionId: '6', purchaseDate: Date.now() - 400 * 86400000 }) })).error?.includes('ended'));
console.log(`${pass} passed ${fail} failed`);
process.exit(fail ? 1 : 0);
