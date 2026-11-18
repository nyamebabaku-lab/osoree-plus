// Writes public/licenses.html: our copyright reservation, the Bible sources, and the licences of the open-source
// code and fonts inside the app (taken from the installed packages, so it stays accurate). Run: node scripts/make-licenses.mjs
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const deps = new Set([...Object.keys(pkg.dependencies), 'scheduler', '@fontsource/montserrat', '@fontsource/poppins', '@fontsource/open-sans', '@fontsource/noto-sans', '@fontsource/oswald', '@fontsource/bebas-neue', '@fontsource/merriweather', '@fontsource/lora', '@fontsource/playfair-display', '@fontsource/roboto-slab', '@fontsource/noto-serif', '@fontsource/dancing-script', 'electron']);
const rows = [];
for (const name of [...deps].sort()) {
  const dir = path.join(root, 'node_modules', name);
  const alt = path.join(root, 'desktop', 'node_modules', name);
  const d = fs.existsSync(dir) ? dir : fs.existsSync(alt) ? alt : null;
  if (!d) continue;
  const p = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8'));
  const lf = fs.readdirSync(d).find((f) => /^(licen[cs]e|copying)(\.md|\.txt)?$/i.test(f));
  const text = lf ? fs.readFileSync(path.join(d, lf), 'utf8').trim() : '';
  const lic = typeof p.license === 'string' ? p.license : p.license?.type || (p.licenses || []).map((x) => x.type).join(', ') || 'see package';
  rows.push({ name, version: p.version, lic, home: p.homepage || (typeof p.repository === 'string' ? p.repository : p.repository?.url || ''), text });
}
const bibles = [
  ['King James Version (KJV)', 'Public domain (outside the United Kingdom).'],
  ['KJV with Strong’s numbers (KJV+)', 'Public domain text; Strong’s dictionary (1890) is public domain.'],
  ['Berean Standard Bible (BSB)', 'Public domain (dedicated by its publishers, 2023).'],
  ['World English Bible (WEB)', 'Public domain.'],
  ['American Standard Version (ASV, 1901)', 'Public domain.'],
  ['Bible in Basic English (BBE)', 'Public domain.'],
  ['Young’s Literal Translation (YLT)', 'Public domain.'],
];
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ɔsɔreɛ Plus Copyright Notices</title>
<meta name="description" content="Copyright reservation for Ɔsɔreɛ Plus and the licences of the Bible texts, open-source software and fonts it includes.">
<style>
  :root { --bg: #ffffff; --fg: #1c1917; --muted: #57534e; --line: #e7e5e4; --gold: #a16207; --card: #fafaf9; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #0e0f13; --fg: #f5f5f4; --muted: #a8a29e; --line: #292524; --gold: #e2b232; --card: #16171d; } }
  :root[data-theme="dark"] { --bg: #0e0f13; --fg: #f5f5f4; --muted: #a8a29e; --line: #292524; --gold: #e2b232; --card: #16171d; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 16px 64px; }
  h1 { font-size: 1.8rem; margin: 0 0 4px; } h1 span { color: var(--gold); }
  h2 { font-size: 1.15rem; margin: 2em 0 .5em; padding-top: .8em; border-top: 1px solid var(--line); }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
  details { border-bottom: 1px solid var(--line); padding: 8px 0; }
  summary { cursor: pointer; font-weight: 600; }
  pre { white-space: pre-wrap; word-break: break-word; font-size: .78rem; background: var(--card); padding: 10px; border-radius: 8px; max-height: 320px; overflow: auto; }
  .muted { color: var(--muted); font-size: .9rem; } a { color: var(--gold); }
  ul { padding-left: 1.2em; }
</style>
</head>
<body>
<main>
  <h1>Ɔsɔreɛ <span>Plus</span> copyright notices</h1>
  <div class="card">
    <p><b>© 2026 Brands Media, Ghana. All rights reserved.</b></p>
    <p>Ɔsɔreɛ Plus, its name, logo, design, source code, documentation and the Ɔsɔreɛ store are protected by copyright and other laws of Ghana and international treaties. No part may be copied, sold, published, modified or distributed without written permission from Brands Media, except as the <a href="terms.html">Terms and Conditions</a> allow. Bibles and backgrounds sold in the store are the property of their copyright owners and are licensed, not sold, for use inside the App only.</p>
  </div>

  <h2>Bible texts built into the App</h2>
  <ul>${bibles.map(([n, l]) => `<li><b>${esc(n)}</b>: ${esc(l)}</li>`).join('')}</ul>
  <p class="muted">Bibles imported by a church remain the responsibility of that church. Bibles in the store show their own copyright line.</p>

  <h2>Open-source software and fonts</h2>
  <p class="muted">The App is built with the following open-source components. Each is used under its licence, reproduced below. Fonts are used under the SIL Open Font License 1.1 (Roboto Slab under the Apache License 2.0).</p>
  ${rows.map((r) => `<details><summary>${esc(r.name)} ${esc(r.version)} — ${esc(r.lic)}</summary>${r.home ? `<p class="muted">${esc(String(r.home).replace(/^git\+/, ''))}</p>` : ''}${r.text ? `<pre>${esc(r.text)}</pre>` : ''}</details>`).join('\n  ')}

  <h2>Other notices</h2>
  <ul>
    <li>Icons: Lucide (ISC licence), included above as lucide-react.</li>
    <li>“YouTube”, “Facebook”, “Instagram”, “TikTok”, “Apple”, “App Store”, “Google Play”, “WhatsApp”, “Paystack” and “Hubtel” are trademarks of their owners. Ɔsɔreɛ Plus is not endorsed by them.</li>
    <li>CCLI is a trademark of Christian Copyright Licensing International.</li>
  </ul>
  <p><a href="privacy.html">Privacy Policy</a> · <a href="terms.html">Terms and Conditions</a> · <a href="mailto:nyamebabaku@gmail.com">nyamebabaku@gmail.com</a></p>
</main>
</body>
</html>
`;
fs.writeFileSync(path.join(root, 'public', 'licenses.html'), html);
console.log(`licenses.html: ${rows.length} components`);
