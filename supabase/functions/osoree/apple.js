// Apple in-app purchases: the app sends the signed transaction (JWS) StoreKit gave it; we check it was signed by
// Apple (certificate chain up to Apple Root CA - G3) before giving a licence. Pure WebCrypto + @peculiar/x509,
// injected so the same code runs in Deno (the server) and Node (the tests).
export const APPLE_ROOT_G3 = 'MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM6BgD56KyKA==';
const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export function appleVerifier(x509, { roots = [APPLE_ROOT_G3], now = () => new Date() } = {}) {
  const rootBytes = roots.map(b64);
  return async function verify(jws) {
    const parts = String(jws || '').split('.');
    if (parts.length !== 3) throw new Error('Not an App Store transaction.');
    const header = JSON.parse(new TextDecoder().decode(b64u(parts[0])));
    if (header.alg !== 'ES256' || !Array.isArray(header.x5c) || header.x5c.length !== 3) throw new Error('Not an App Store transaction.');
    const [leafRaw, midRaw, rootRaw] = header.x5c.map(b64);
    if (!rootBytes.some((r) => same(r, rootRaw))) throw new Error('Not signed by Apple.');
    const leaf = new x509.X509Certificate(leafRaw), mid = new x509.X509Certificate(midRaw), root = new x509.X509Certificate(rootRaw);
    const t = now();
    for (const c of [leaf, mid]) if (t < c.notBefore || t > c.notAfter) throw new Error('Apple certificate out of date.');
    if (!(await mid.verify({ publicKey: root.publicKey, signatureOnly: true }))) throw new Error('Not signed by Apple.');
    if (!(await leaf.verify({ publicKey: mid.publicKey, signatureOnly: true }))) throw new Error('Not signed by Apple.');
    if (!mid.getExtension('1.2.840.113635.100.6.2.1') || !leaf.getExtension('1.2.840.113635.100.6.11.1')) throw new Error('Not an App Store certificate.');
    const key = await crypto.subtle.importKey('spki', leaf.publicKey.rawData, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64u(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    if (!ok) throw new Error('Transaction signature is wrong.');
    return JSON.parse(new TextDecoder().decode(b64u(parts[1])));
  };
}
