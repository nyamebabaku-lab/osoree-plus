// Tests for android/.../ScreenServer.java (run with tests/run-server.sh).
import { chromium } from '/home/BrandsME/projects/efiewura/node_modules/playwright-core/index.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const [java, dir, LAN] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
const MEDIA = path.resolve(dir, 'media');
fs.copyFileSync(path.join(here, 'out', 'clip.webm'), path.join(MEDIA, 'abc.webm'));
fs.copyFileSync(path.join(here, 'out', 'logo.png'), path.join(MEDIA, 'logo.png'));

const p = spawn(java, ['-cp', path.join(dir, 'classes'), 'Harness', path.join(dir, 'assets'), MEDIA]);
p.stderr.on('data', (d) => console.log('JAVA', String(d)));
const port = await new Promise((res) => p.stdout.once('data', (d) => res(+String(d).match(/PORT (\d+)/)[1])));
const ask = (cmd) => new Promise((res) => { p.stdout.once('data', (d) => res(String(d).trim())); p.stdin.write(cmd + '\n'); });
const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, x); };
const u = (pth, host = '127.0.0.1') => `http://${host}:${port}${pth}`;
const style = { bg: '#000', fg: '#fff', font: "'Poppins', 'Noto Sans', sans-serif", align: 'center', size: 'L', showRef: true };

// ---- serving, ranges and Wi-Fi gating ----
ok('other devices blocked while Wi-Fi screens are off', await fetch(u('/', LAN)).then(() => false, () => true));
ok('the phone itself always allowed', (await fetch(u('/'))).status === 200);
await ask('lan on');
ok('other devices allowed when on', (await fetch(u('/', LAN))).status === 200);
ok('fonts served', (await fetch(u('/fonts/fonts.css'))).headers.get('content-type').startsWith('text/css'));
ok('files outside media blocked', (await fetch(u('/_capacitor_file_/etc/passwd'))).status === 404);
const full = await fetch(u('/_capacitor_file_' + MEDIA + '/abc.webm')); const size = +full.headers.get('content-length');
const part = await fetch(u('/_capacitor_file_' + MEDIA + '/abc.webm'), { headers: { Range: 'bytes=100-199' } });
ok('video byte ranges', part.status === 206 && part.headers.get('content-range') === `bytes 100-199/${size}`);

const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1148/chrome-linux/chrome', args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const errs = [];
const page = async (url, w = 1280, h = 720) => { const pg = await b.newPage({ viewport: { width: w, height: h } }); pg.on('pageerror', (e) => errs.push(e.message)); await pg.goto(url); return pg; };
const scr = await page(u('/', LAN)); await scr.waitForTimeout(500);
ok('Wi-Fi screen counted', (await ask('count')) === 'CLIENTS 1');
send({ kind: 'song', title: 'Yesu Ne Me Hwɛfoɔ', lines: ['Ɔdɔ a ɛwɔ wo mu', 'Ɛyɛ me de'], style });
await scr.waitForFunction(() => document.querySelector('.text')?.textContent.includes('Ɔdɔ')); ok('screen follows the phone', true);
send({ kind: 'media', media: { src: '/_capacitor_file_' + MEDIA + '/abc.webm', kind: 'video', fit: 'cover' }, video: { playing: true, seq: 1, loop: true, muted: false }, style });
await scr.waitForFunction(() => document.querySelector('#media video')?.currentTime > 0.3, null, { timeout: 10000 }).then(() => ok('video streams over Wi-Fi', true), () => ok('video streams over Wi-Fi', false));

// ---- the phone app's preview: this page inside a frame of the app (another origin), as on the phone ----
const host = await page('http://127.0.0.1:4872/', 400, 860);
await host.evaluate((src) => { document.body.innerHTML = `<iframe id="pv" src="${src}" allow="camera; autoplay" style="width:640px;height:360px;border:0"></iframe>`; }, u('/?preview'));
const pv = host.frameLocator('#pv');
send({ kind: 'verse', groups: [{ ref: 'Psalms 23:1', cols: [{ abbr: 'KJV', ref: 'Psalms 23:1', verses: [{ n: 1, t: 'The LORD is my shepherd' }] }] }], style });
await pv.locator('.text').filter({ hasText: 'The LORD is my shepherd' }).waitFor({ timeout: 8000 }).then(() => ok('preview inside the app follows the phone', true), () => ok('preview inside the app follows the phone', false));
send({ kind: 'song', title: 'Amazing Grace', lines: ['Amazing grace! How sweet the sound'], style });
await pv.locator('.text').filter({ hasText: 'Amazing grace' }).waitFor({ timeout: 8000 }).then(() => ok('preview updates on every change', true), () => ok('preview updates on every change', false));
ok('preview shows no reconnect pill or full-screen hint', await pv.locator('#lost').isHidden() && await pv.locator('#hint').isHidden());

// ---- "This phone" camera: preview and projector without any network ----
const phoneCam = { kind: 'verse', groups: [{ ref: 'John 3:16', cols: [{ abbr: 'KJV', ref: 'John 3:16', verses: [{ n: 16, t: 'For God so loved the world' }] }] }], style, cam: { source: 'phone', facing: 'environment' }, lt: { bg: '#0b1f3a', opacity: 0.8, fg: '#fff', accent: '#e2b232', size: 'M', align: 'left', font: 'sans-serif' } };
const app = await b.newContext({ viewport: { width: 400, height: 860 } });
const appPage = await app.newPage(); appPage.on('pageerror', (e) => errs.push(e.message));
const rtcCalls = []; app.on('request', (r) => { if (r.url().includes('/rtc/')) rtcCalls.push(r.url()); });
await appPage.goto('http://127.0.0.1:4872/');
await appPage.evaluate(async () => {
  window.osoreeCamStream = await navigator.mediaDevices.getUserMedia({ video: true }); // what the app does when live video is on
  document.body.innerHTML = '<iframe id="pv" src="./display.html?preview&server=http://127.0.0.1:1" style="width:640px;height:360px;border:0"></iframe>';
});
await appPage.waitForTimeout(800);
await app.setOffline(true); // no Wi-Fi, no data
await appPage.evaluate((st) => new BroadcastChannel('osoree-output').postMessage(JSON.parse(st)), JSON.stringify(phoneCam));
await appPage.frameLocator('#pv').locator('#cam video').evaluate((v) => new Promise((r, j) => { const t = Date.now(); (function w() { if (v.videoWidth > 0 && v.srcObject === window.parent.osoreeCamStream) r(); else if (Date.now() - t > 8000) j(); else setTimeout(w, 200); })(); }))
  .then(() => ok('phone camera in the preview with no network', true), () => ok('phone camera in the preview with no network', false));
ok('preview lower third with no network', (await appPage.frameLocator('#pv').locator('#lttext .lmain').textContent()) === 'For God so loved the world');
await app.setOffline(false);
const proj = await app.newPage(); await proj.goto(u('/?screen'));
send(phoneCam);
await proj.waitForFunction(() => document.querySelector('#cam video')?.videoWidth > 0, null, { timeout: 8000 }).then(() => ok('projector opens the phone camera itself', true), () => ok('projector opens the phone camera itself', false));
ok('preview and projector used no network for the camera', rtcCalls.length === 0, rtcCalls.slice(0, 2).join(' '));
const wifiScr = await app.newPage(); await wifiScr.goto(u('/', LAN)); await wifiScr.waitForTimeout(1500);
ok('Wi-Fi screens ask for the phone camera over Wi-Fi', rtcCalls.some((x) => x.includes('/rtc/offer')));
await app.close();

// ---- Wi-Fi camera ----
const lt = { bg: '#0b1f3a', opacity: 0.8, fg: '#fff', accent: '#e2b232', size: 'M', align: 'left', font: 'sans-serif' };
send({ kind: 'verse', groups: [{ ref: 'John 3:16', cols: [{ abbr: 'KJV', ref: 'John 3:16', verses: [{ n: 16, t: 'For God so loved the world' }] }] }], style, cam: { source: 'remote' }, lt });
await scr.waitForFunction(() => document.getElementById('camnote').textContent.includes('Waiting for the camera phone')); ok('screen waits for the camera phone', true);
const cam = await page('http://127.0.0.1:4872/', 400, 860);
await cam.locator('nav button', { hasText: 'Live' }).click(); await cam.getByRole('button', { name: 'Open camera mode' }).click();
await cam.getByLabel('Main phone address').fill(`${LAN}:${port}`); await cam.getByRole('button', { name: 'Start sending' }).click();
await scr.waitForFunction(() => { const v = document.querySelector('#cam video'); return v && v.videoWidth > 0 && !document.getElementById('camnote').textContent; }, null, { timeout: 20000 })
  .then(() => ok('camera phone picture reaches the screen', true), () => ok('camera phone picture reaches the screen', false));
ok('lower third over the Wi-Fi camera', (await scr.locator('#lttext .lmain').textContent()) === 'For God so loved the world');
await cam.waitForSelector('text=Sending to 2 screens', { timeout: 8000 }).then(() => ok('camera phone shows 2 screens (screen + preview)', true), () => ok('camera phone shows 2 screens (screen + preview)', false));
ok('main phone sees the camera phone', (await (await fetch(u('/rtc/status'))).json()).camera === true);
await scr.screenshot({ path: path.join(here, 'out', 'wifi-camera.png') });
await cam.screenshot({ path: path.join(here, 'out', 'camera-mode.png') });
await pv.locator('#cam video').evaluate((v) => new Promise((r, j) => { const t = Date.now(); (function w() { if (v.videoWidth > 0) r(); else if (Date.now() - t > 20000) j(); else setTimeout(w, 200); })(); }))
  .then(() => ok('camera shows in the phone preview too', true), () => ok('camera shows in the phone preview too', false));
// the phone app's preview (same origin as the app, told where the server is) also gets the camera
const appPv = await page(`http://127.0.0.1:4872/display.html?preview&server=${encodeURIComponent(u(''))}`);
await appPv.evaluate((st) => { localStorage.setItem('osoree-live', st); new BroadcastChannel('osoree-output').postMessage(JSON.parse(st)); },
  JSON.stringify({ kind: 'verse', groups: [{ ref: 'John 3:16', cols: [{ abbr: 'KJV', ref: 'John 3:16', verses: [{ n: 16, t: 'For God so loved the world' }] }] }], style, cam: { source: 'remote' }, lt }));
await appPv.reload();
await appPv.waitForFunction(() => document.querySelector('#cam video')?.videoWidth > 0, null, { timeout: 20000 }).then(() => ok('app preview gets the camera through the server address', true), () => ok('app preview gets the camera through the server address', false));
ok('app preview shows the lower third', (await appPv.locator('#lttext .lmain').textContent()) === 'For God so loved the world');
await appPv.close();
const scr2 = await page(u('/?screen'));
await scr2.waitForFunction(() => document.querySelector('#cam video')?.videoWidth > 0, null, { timeout: 20000 }).then(() => ok('second screen also gets the camera', true), () => ok('second screen also gets the camera', false));
await cam.waitForSelector('text=Sending to 3 screens', { timeout: 8000 }).then(() => ok('camera phone shows 3 screens (incl. preview)', true), () => ok('camera phone shows 3 screens (incl. preview)', false));
// camera phone stops, then starts again: screens reconnect by themselves
await cam.getByRole('button', { name: 'Stop sending' }).click();
await scr.waitForFunction(() => document.getElementById('camnote').textContent.includes('Waiting'), null, { timeout: 15000 }).then(() => ok('screen notices the camera stopped', true), () => ok('screen notices the camera stopped', false));
await cam.getByRole('button', { name: 'Start sending' }).click();
await scr.waitForFunction(() => document.querySelector('#cam video')?.videoWidth > 0 && !document.getElementById('camnote').textContent, null, { timeout: 45000 }).then(() => ok('reconnects when the camera starts again', true), () => ok('reconnects when the camera starts again', false));
// Wi-Fi off: the camera phone can no longer reach the main phone
await ask('lan off'); await cam.waitForSelector('text=Cannot reach the main phone', { timeout: 10000 }).then(() => ok('camera phone told when it cannot reach', true), () => ok('camera phone told when it cannot reach', false));
ok('no page errors', errs.length === 0, errs.join(' | '));
p.stdin.write('stop\n'); await b.close();
console.log(pass, 'passed', fail, 'failed'); process.exit(fail ? 1 : 0);
