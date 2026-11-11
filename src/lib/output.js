// Sends what should be on screen to every output: the preview and any screen window on this device,
// and, in the phone app, the cable / cast display and the Wi-Fi screens (same message everywhere).
import { Capacitor, registerPlugin } from '@capacitor/core';

export const IS_NATIVE = Capacitor.isNativePlatform();
export const Screen = IS_NATIVE ? registerPlugin('Screen') : null;

const KEY = 'osoree-live';
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('osoree-output') : null;

export function send(state) {
  const json = JSON.stringify(state);
  try { localStorage.setItem(KEY, json); } catch { /* storage full or blocked: the channel still works */ }
  channel?.postMessage(state);
  Screen?.send({ state: json }).catch(() => {});
}

export function openScreenWindow() {
  return window.open('./display.html', 'osoree-screen', 'popup,width=960,height=540');
}

// Saves a text file where the user chooses (phone app: system "save as"; browser: a download).
export async function saveTextFile(name, text) {
  if (Screen) {
    // Small pieces over the bridge, then "Save as" copies the finished file (see ScreenPlugin.writeTemp).
    const PIECE = 256 * 1024;
    for (let i = 0; i < text.length || i === 0; i += PIECE) await Screen.writeTemp({ data: text.slice(i, i + PIECE), append: i > 0 });
    await Screen.saveFile({ name });
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
