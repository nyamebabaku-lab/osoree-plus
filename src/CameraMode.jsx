import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Video, VideoOff } from 'lucide-react';
import { useStore } from './store.js';
import { startWifiCamera } from './lib/wificam.js';
import { Seg } from './ui.jsx';

const TEXT = {
  starting: 'Connecting to the main phone…',
  waiting: 'Connected. Waiting for a screen to show the camera…',
  unreachable: 'Cannot reach the main phone. Check that both phones are on the same Wi-Fi (or hotspot) and that Wi-Fi screens are on.',
};

// This device becomes a camera for the main phone. Its whole screen shows what it is sending.
export default function CameraMode({ onExit }) {
  const address = useStore((s) => s.camAddress);
  const setAddress = useStore((s) => s.setCamAddress);
  const [facing, setFacing] = useState('environment');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const stopRef = useRef(null);
  const videoRef = useRef(null);

  const stop = () => { stopRef.current?.(); stopRef.current = null; setStatus(null); if (videoRef.current) videoRef.current.srcObject = null; };
  useEffect(() => stop, []);

  const start = async () => {
    setError('');
    try {
      stopRef.current = await startWifiCamera({
        address, facing,
        onStatus: setStatus,
        onStream: (s) => { if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play().catch(() => {}); } },
      });
    } catch (e) {
      setError(e?.name === 'NotAllowedError' ? 'Camera permission is needed.' : e?.message || 'The camera could not start.');
    }
  };
  const on = !!stopRef.current;
  const line = status && (status.state === 'sending' ? `Sending to ${status.screens} ${status.screens === 1 ? 'screen' : 'screens'}` : TEXT[status.state]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <video ref={videoRef} muted playsInline className="absolute inset-0 h-full w-full object-cover opacity-90" />
      <div className="relative flex items-center gap-2 bg-gradient-to-b from-black/80 to-transparent p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button onClick={() => { stop(); onExit(); }} aria-label="Leave camera mode" className="icon-btn text-white"><ArrowLeft size={20} /></button>
        <h1 className="mr-auto font-bold">Camera mode</h1>
        {status?.state === 'sending' && <span className="rounded-md bg-red-600 px-2 py-0.5 text-[11px] font-bold">ON AIR</span>}
      </div>
      <div className="relative mt-auto space-y-3 bg-gradient-to-t from-black/90 to-transparent p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {line && <p className="rounded-xl bg-black/60 px-3 py-2 text-sm font-semibold">{line}</p>}
        {error && <p className="rounded-xl bg-red-900/80 px-3 py-2 text-sm">{error}</p>}
        {!on && (
          <>
            <label className="block text-sm font-semibold">Address shown on the main phone (Live tab)
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="192.168.1.5:8080" inputMode="url" autoCapitalize="none" autoCorrect="off" aria-label="Main phone address" className="field mt-1 text-stone-900" />
            </label>
            <div className="flex items-center justify-between"><span className="text-sm font-semibold">Camera</span><Seg label="Camera" value={facing} onChange={setFacing} options={[['environment', 'Back'], ['user', 'Front']]} /></div>
          </>
        )}
        {on
          ? <button onClick={stop} className="btn w-full bg-white/15 text-white"><VideoOff size={18} /> Stop sending</button>
          : <button onClick={start} disabled={!address.trim()} className="btn-gold w-full"><Video size={18} /> Start sending</button>}
        <p className="text-xs text-white/70">Keep this phone on a stand and plugged in. Both phones need the same Wi-Fi or the main phone’s hotspot; no internet is needed.</p>
      </div>
    </div>
  );
}
