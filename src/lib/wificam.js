// "Use this phone as a camera": sends this device's camera to the main phone's screens over Wi-Fi (WebRTC).
// The main phone's screen server only passes the introductions; the video goes directly, with no internet.

// "192.168.1.5:8080", "http://192.168.1.5:8080/" or "192.168.1.5" → "http://192.168.1.5:8080"
export function normaliseAddress(text) {
  const t = String(text || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!t) return '';
  return 'http://' + (/:\d+$/.test(t) ? t : t + ':8080');
}

const iceDone = (pc) => new Promise((resolve) => {
  if (pc.iceGatheringState === 'complete') { resolve(); return; }
  const t = setTimeout(resolve, 2500);
  pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); } });
});

// onStatus({ state: 'starting' | 'waiting' | 'sending' | 'unreachable' | 'error', screens, message })
// `stream` may be given (the phone app's own camera, already open); otherwise the camera is opened here.
export async function startWifiCamera({ address, facing, onStatus, onStream, stream: given }) {
  const base = normaliseAddress(address);
  if (!base) throw new Error('Type the address shown on the main phone.');
  const stream = given || await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false });
  onStream?.(stream);
  const peers = new Map();
  let stopped = false, timer = null, misses = 0;

  const report = () => {
    const screens = [...peers.values()].filter((pc) => pc.connectionState === 'connected').length;
    onStatus?.({ state: misses > 2 ? 'unreachable' : screens ? 'sending' : 'waiting', screens });
  };

  const answer = async ({ id, sdp }) => {
    const pc = new RTCPeerConnection({ iceServers: [] });
    peers.set(id, pc);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) { peers.delete(id); pc.close(); }
      report();
    };
    await pc.setRemoteDescription({ type: 'offer', sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await iceDone(pc);
    // A steady picture over church Wi-Fi: about 2.5 Mbit/s per screen.
    pc.getSenders().forEach((s) => {
      const p = s.getParameters();
      p.encodings = p.encodings?.length ? p.encodings : [{}];
      p.encodings[0].maxBitrate = 2_500_000;
      s.setParameters(p).catch(() => {});
    });
    await fetch(`${base}/rtc/answer?id=${encodeURIComponent(id)}`, { method: 'POST', body: pc.localDescription.sdp });
  };

  const poll = async () => {
    if (stopped) return;
    try {
      const r = await fetch(`${base}/rtc/offers`, { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      misses = 0;
      for (const offer of await r.json()) answer(offer).catch(() => peers.delete(offer.id));
    } catch {
      misses++;
    }
    report();
    timer = setTimeout(poll, 1000);
  };
  onStatus?.({ state: 'starting', screens: 0 });
  poll();

  return () => {
    stopped = true;
    clearTimeout(timer);
    peers.forEach((pc) => pc.close());
    peers.clear();
    if (!given) stream.getTracks().forEach((t) => t.stop());
  };
}
