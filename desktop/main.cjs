// Ɔsɔreɛ Plus for Windows: the same app as the phone/web version, plus a projector window that opens
// full screen on the second screen (projector or TV) by itself.
const { app, BrowserWindow, screen, shell, session, ipcMain, Menu } = require('electron');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execSync } = require('child_process');

// This computer's ID (Windows MachineGuid): the licence stays with the computer, also after reinstalling.
let deviceId = '';
function computerId() {
  if (deviceId) return deviceId;
  let raw = '';
  try { raw = (execSync('reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid', { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).match(/MachineGuid\s+REG_SZ\s+(\S+)/) || [])[1] || ''; } catch { /* not Windows */ }
  if (!raw) raw = `${os.hostname()}|${os.userInfo().username}|${os.cpus()[0]?.model || ''}`;
  deviceId = crypto.createHash('sha256').update('osoree-desktop:' + raw).digest('hex').slice(0, 32);
  return deviceId;
}
ipcMain.on('osoree-device-id', (e) => { e.returnValue = computerId(); });

const page = (name) => path.join(__dirname, 'app', name);
let main = null, projector = null;

function projectorOptions() {
  const all = screen.getAllDisplays(), primary = screen.getPrimaryDisplay();
  const other = all.find((d) => d.id !== primary.id);
  const base = { backgroundColor: '#000000', autoHideMenuBar: true, title: 'Ɔsɔreɛ Plus screen', icon: path.join(__dirname, 'app', 'icon.png'), webPreferences: { contextIsolation: true, autoplayPolicy: 'no-user-gesture-required' } };
  // A projector or TV is connected: fill it. Otherwise a normal window the operator can drag to it.
  return other
    ? { ...base, x: other.bounds.x, y: other.bounds.y, width: other.bounds.width, height: other.bounds.height, frame: false, fullscreen: true }
    : { ...base, width: 960, height: 540 };
}

function createMain() {
  main = new BrowserWindow({
    width: 1280, height: 860, minWidth: 380, minHeight: 600, backgroundColor: '#0e0f13', title: 'Ɔsɔreɛ Plus', autoHideMenuBar: true,
    icon: path.join(__dirname, 'app', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, autoplayPolicy: 'no-user-gesture-required' },
  });
  main.webContents.setWindowOpenHandler(({ url }) => {
    if (/display\.html/.test(url)) {
      if (projector && !projector.isDestroyed()) { projector.focus(); return { action: 'deny' }; }
      return { action: 'allow', overrideBrowserWindowOptions: projectorOptions() };
    }
    if (/^https?:/.test(url)) shell.openExternal(url); // payments, help links: the normal browser
    return { action: 'deny' };
  });
  main.webContents.on('did-create-window', (w) => { projector = w; w.setMenuBarVisibility(false); w.on('closed', () => { projector = null; }); });
  main.loadFile(page('index.html'));
  main.on('closed', () => { main = null; if (projector && !projector.isDestroyed()) projector.close(); app.quit(); });
}

// A projector plugged in or out while the app is open: move the screen window to it.
function followDisplays() {
  if (!projector || projector.isDestroyed()) return;
  const o = projectorOptions();
  projector.setFullScreen(false);
  projector.setBounds({ x: o.x ?? projector.getBounds().x, y: o.y ?? projector.getBounds().y, width: o.width, height: o.height });
  if (o.fullscreen) projector.setFullScreen(true);
}

// Build check (OSOREE_SMOKE=<folder>): open the app and the projector, show a verse, save pictures, quit.
function smokeTest(dir) {
  const fs = require('fs');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  main.webContents.once('did-finish-load', async () => {
    const log = [];
    try {
      await wait(4000);
      log.push('device ' + await main.webContents.executeJavaScript("import('./assets/' + [...document.scripts].map(s=>s.src).find(s=>/index-/.test(s)).split('/assets/')[1]).then(() => window.osoreeDesktop.deviceId)"));
      await main.webContents.executeJavaScript("window.open('./display.html', 'osoree-screen'); 0");
      await wait(1500);
      log.push('projector ' + !!projector);
      await main.webContents.executeJavaScript("(async () => { const i = document.querySelector('[aria-label=\"Verse or words\"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'jn 3 16'); i.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 300)); [...document.querySelectorAll('button')].find((b) => /SHOW/.test(b.textContent))?.click(); })()");
      await wait(2500);
      fs.writeFileSync(path.join(dir, 'desktop-main.png'), (await main.webContents.capturePage()).toPNG());
      if (projector) { log.push('projector text ' + await projector.webContents.executeJavaScript("document.querySelector('.text')?.textContent.slice(0, 40) || ''")); fs.writeFileSync(path.join(dir, 'desktop-screen.png'), (await projector.webContents.capturePage()).toPNG()); }
    } catch (e) { log.push('error ' + e.message); }
    fs.writeFileSync(path.join(dir, 'desktop-smoke.txt'), log.join('\n'));
    app.exit(0);
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (main) { if (main.isMinimized()) main.restore(); main.focus(); } });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    // Camera and microphone for live video and voice search; nothing else.
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['media', 'fullscreen', 'clipboard-sanitized-write'].includes(perm)));
    createMain();
    if (process.env.OSOREE_SMOKE) smokeTest(process.env.OSOREE_SMOKE);
    screen.on('display-added', followDisplays);
    screen.on('display-removed', followDisplays);
  });
  app.on('window-all-closed', () => app.quit());
}
