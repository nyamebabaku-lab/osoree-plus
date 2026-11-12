import com.osoree.plus.stream.Avc;
import com.osoree.plus.stream.RtmpPublisher;
import java.io.*;
import java.nio.file.*;
import java.util.*;

/**
 * Feeds a test H.264 + AAC stream through RtmpPublisher (the code the phone uses) to a server URL.
 * args: url key h264file adtsfile seconds
 */
public class StreamTest {
    public static void main(String[] a) throws Exception {
        String url = a[0], key = a[1];
        byte[] h264 = Files.readAllBytes(Paths.get(a[2])), adts = Files.readAllBytes(Paths.get(a[3]));
        int seconds = Integer.parseInt(a[4]);
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("width", 1280.0); meta.put("height", 720.0); meta.put("framerate", 30.0); meta.put("videocodecid", 7.0); meta.put("audiocodecid", 10.0);
        meta.put("audiosamplerate", 44100.0); meta.put("audiosamplesize", 16.0); meta.put("stereo", true);
        RtmpPublisher p = new RtmpPublisher("test", url, key, meta, x -> System.out.println("STATE " + x.state + (x.message.isEmpty() ? "" : " " + x.message)));

        // video: split into access units at the access-unit delimiters (NAL type 9)
        List<byte[]> nals = Avc.split(h264, 0, h264.length);
        byte[] sps = null, pps = null;
        List<List<byte[]>> frames = new ArrayList<>();
        List<byte[]> cur = null;
        for (byte[] n : nals) {
            int t = Avc.type(n);
            if (t == 7 && sps == null) sps = n;
            if (t == 8 && pps == null) pps = n;
            if (t == 9) { cur = new ArrayList<>(); frames.add(cur); }
            if (cur != null) cur.add(n);
        }
        p.setVideoConfig(Avc.avcC(sps, pps));
        // audio: ADTS frames → raw AAC + AudioSpecificConfig
        List<byte[]> aac = new ArrayList<>();
        int i = 0, profile = 0, sr = 0, ch = 0;
        while (i + 7 <= adts.length) {
            int len = ((adts[i + 3] & 3) << 11) | ((adts[i + 4] & 0xff) << 3) | ((adts[i + 5] & 0xff) >> 5);
            int hdr = (adts[i + 1] & 1) == 1 ? 7 : 9;
            profile = ((adts[i + 2] & 0xff) >> 6) + 1; sr = ((adts[i + 2] & 0xff) >> 2) & 0xf; ch = ((adts[i + 2] & 1) << 2) | ((adts[i + 3] & 0xff) >> 6);
            aac.add(Arrays.copyOfRange(adts, i + hdr, i + len));
            i += len;
        }
        int asc = (profile << 11) | (sr << 7) | (ch << 3);
        p.setAudioConfig(new byte[] { (byte) (asc >> 8), (byte) asc });

        p.start();
        long t0 = System.currentTimeMillis();
        while (!"live".equals(p.state) && System.currentTimeMillis() - t0 < 15000) Thread.sleep(50);
        if (!"live".equals(p.state)) { System.out.println("NOT LIVE " + p.message); p.stop(); System.exit(2); }
        // send in real time: video 30 fps, audio 1024 samples per frame at 44.1 kHz
        long start = System.currentTimeMillis();
        int vf = 0, af = 0;
        while (System.currentTimeMillis() - start < seconds * 1000L) {
            long now = System.currentTimeMillis() - start;
            while (vf * 1000L / 30 <= now) {
                List<byte[]> f = frames.get(vf % frames.size());
                boolean isKey = f.stream().anyMatch(n -> Avc.type(n) == 5);
                p.sendVideo((int) (vf * 1000L / 30), Avc.lengthPrefixed(f), isKey);
                vf++;
            }
            while (af * 1024L * 1000 / 44100 <= now) { p.sendAudio((int) (af * 1024L * 1000 / 44100), aac.get(af % aac.size())); af++; }
            Thread.sleep(5);
            if (!"live".equals(p.state)) System.out.println("WHILE SENDING: " + p.state + " " + p.message);
        }
        System.out.println("SENT video " + vf + " audio " + af + " bytes " + p.bytesSent + " dropped " + p.droppedFrames + " state " + p.state);
        p.stop();
        System.exit(0);
    }
}
