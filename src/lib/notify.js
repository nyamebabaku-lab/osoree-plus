// Getting the operator's attention: a soft vibration (and, if wanted, a quiet tone) while the app is open,
// and phone notifications when it is in the background.
import { IS_NATIVE, Screen } from './output.js';
import { useStore } from '../store.js';

let audio = null;
function softTone() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(880, t); o.frequency.setValueAtTime(1175, t + 0.12);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.32);
  } catch { /* no sound here */ }
}

export function buzz({ sound } = {}) {
  if (IS_NATIVE) { Screen.buzz({ sound: !!sound }).catch(() => {}); return; }
  try { navigator.vibrate?.([60, 90, 60]); } catch { /* not supported */ }
  if (sound) softTone();
}

/** Asks once for permission to show notifications (Android 13+, browsers). */
export async function askNotifications() {
  const st = useStore.getState();
  if (st.notifAsked) return;
  st.setLicState({ notifAsked: true });
  try {
    if (IS_NATIVE) await Screen.requestNotifications();
    else if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
  } catch { /* refused or not supported */ }
}

let nextId = 100;
export function notify(title, body, { channel = 'updates', onlyHidden = false } = {}) {
  if (onlyHidden && !document.hidden) return;
  try {
    if (IS_NATIVE) { Screen.notify({ title, body, channel, id: channel === 'scripture' ? 7 : nextId++ }).catch(() => {}); return; }
    if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, tag: channel === 'scripture' ? 'osoree-scripture' : undefined, icon: './icon.svg' });
  } catch { /* not supported */ }
}
