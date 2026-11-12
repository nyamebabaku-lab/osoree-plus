package com.osoree.plus.stream;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.Looper;
import android.view.Surface;

import com.osoree.plus.ScreenPresentation;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Live streaming from the phone. The stream picture is the projector page (camera, lower thirds, ticker, slides,
 * logo) drawn on a private virtual screen whose surface feeds the phone's hardware H.264 encoder. Sound comes
 * from the chosen input (mixer through USB/cable, or the phone's microphone) through the AAC encoder.
 * Each platform gets its own RtmpPublisher. Everything stops when stop() is called.
 */
public class StreamEngine {
    public static final class Target {
        public final String name, url, key;
        public Target(String name, String url, String key) { this.name = name; this.url = url; this.key = key; }
    }

    private static final int SAMPLE_RATE = 44100;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<RtmpPublisher> publishers = new ArrayList<>();
    private volatile boolean running = false;
    private MediaCodec video, audio;
    private Surface input;
    private VirtualDisplay virtualDisplay;
    private ScreenPresentation presentation;
    private AudioRecord recorder;
    private Thread videoThread, audioThread;
    private long t0Us, videoShiftUs = Long.MIN_VALUE;
    private volatile byte[] videoConfig, audioConfig;
    private volatile boolean publishersStarted = false;
    public volatile float level = 0f; // sound level 0..1, for the operator's meter
    public volatile String audioInputName = "";
    public volatile String error = "";
    public int width, height;

    public boolean isRunning() { return running; }
    public List<RtmpPublisher> publishers() { return publishers; }

    /** Must be called on the main thread. Throws with a readable message when something cannot start. */
    @SuppressLint("MissingPermission")
    public void start(Activity activity, String pageUrl, int w, int h, int fps, int videoBitrate, int audioDeviceId, boolean stereo, List<Target> targets) throws Exception {
        if (running) throw new IllegalStateException("Already live.");
        width = w; height = h;
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("width", (double) w); meta.put("height", (double) h); meta.put("framerate", (double) fps);
        meta.put("videocodecid", 7.0); meta.put("videodatarate", videoBitrate / 1000.0);
        meta.put("audiocodecid", 10.0); meta.put("audiodatarate", 128.0); meta.put("audiosamplerate", (double) SAMPLE_RATE);
        meta.put("audiosamplesize", 16.0); meta.put("stereo", stereo); meta.put("encoder", "Osoree Plus");
        publishers.clear();
        for (Target t : targets) publishers.add(new RtmpPublisher(t.name, t.url, t.key, meta, null)); // checks each address first
        if (publishers.isEmpty()) throw new IllegalArgumentException("Choose at least one platform.");

        running = true;
        publishersStarted = false;
        videoConfig = null; audioConfig = null; error = ""; videoShiftUs = Long.MIN_VALUE;
        t0Us = System.nanoTime() / 1000;
        try {
            // ---- video: hardware H.264 encoder fed by a private virtual screen showing the stream page
            MediaFormat vf = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, w, h);
            vf.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
            vf.setInteger(MediaFormat.KEY_BIT_RATE, videoBitrate);
            vf.setInteger(MediaFormat.KEY_FRAME_RATE, fps);
            vf.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2); // platforms ask for a key frame every 2 seconds
            vf.setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 1_000_000L / fps); // keep sending frames when the picture is still
            video = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC);
            video.configure(vf, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            input = video.createInputSurface();
            video.start();
            DisplayManager dm = (DisplayManager) activity.getSystemService(Context.DISPLAY_SERVICE);
            virtualDisplay = dm.createVirtualDisplay("osoree-stream", w, h, 160, input, DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY);
            presentation = new ScreenPresentation(activity, virtualDisplay.getDisplay(), pageUrl, null);
            presentation.show();
            videoThread = new Thread(this::drainVideo, "stream-video");
            videoThread.start();

            // ---- sound: the chosen input → AAC
            int channels = stereo ? AudioFormat.CHANNEL_IN_STEREO : AudioFormat.CHANNEL_IN_MONO;
            int min = AudioRecord.getMinBufferSize(SAMPLE_RATE, channels, AudioFormat.ENCODING_PCM_16BIT);
            recorder = new AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE, channels, AudioFormat.ENCODING_PCM_16BIT, Math.max(min * 2, 8192));
            if (recorder.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("The sound input could not be opened.");
            AudioDeviceInfo chosen = pickInput(activity, audioDeviceId);
            if (chosen != null) recorder.setPreferredDevice(chosen);
            audioInputName = chosen != null ? describe(chosen) : "Phone microphone";
            MediaFormat af = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, SAMPLE_RATE, stereo ? 2 : 1);
            af.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
            af.setInteger(MediaFormat.KEY_BIT_RATE, 128_000);
            af.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384);
            audio = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
            audio.configure(af, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            audio.start();
            recorder.startRecording();
            final int bytesPerFrame = (stereo ? 2 : 1) * 2;
            audioThread = new Thread(() -> runAudio(bytesPerFrame), "stream-audio");
            audioThread.start();
        } catch (Exception e) {
            stop();
            throw e;
        }
    }

    public void stop() {
        running = false;
        for (RtmpPublisher p : publishers) p.stop();
        Runnable ui = () -> {
            if (presentation != null) { try { presentation.dismiss(); } catch (Exception e) { /* gone */ } presentation = null; }
            if (virtualDisplay != null) { virtualDisplay.release(); virtualDisplay = null; }
        };
        if (Looper.myLooper() == Looper.getMainLooper()) ui.run(); else main.post(ui);
        join(videoThread); join(audioThread);
        videoThread = null; audioThread = null;
        if (recorder != null) { try { recorder.stop(); } catch (Exception e) { /* not started */ } recorder.release(); recorder = null; }
        if (video != null) { try { video.stop(); } catch (Exception e) { /* not started */ } video.release(); video = null; }
        if (audio != null) { try { audio.stop(); } catch (Exception e) { /* not started */ } audio.release(); audio = null; }
        if (input != null) { input.release(); input = null; }
        level = 0f;
    }

    private static void join(Thread t) { if (t != null) try { t.join(2000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); } }

    /** Platforms need both decoder configurations at the start, so they connect once both are known. */
    private void maybeStartPublishers() {
        if (publishersStarted || videoConfig == null || audioConfig == null) return;
        publishersStarted = true;
        for (RtmpPublisher p : publishers) { p.setVideoConfig(videoConfig); p.setAudioConfig(audioConfig); p.start(); }
    }

    private void drainVideo() {
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        byte[] sps = null, pps = null;
        while (running) {
            int i;
            try { i = video.dequeueOutputBuffer(info, 100_000); } catch (IllegalStateException e) { break; }
            if (i < 0) continue;
            ByteBuffer buf = video.getOutputBuffer(i);
            if (buf != null && info.size > 0) {
                byte[] data = new byte[info.size];
                buf.position(info.offset);
                buf.get(data);
                List<byte[]> nals = Avc.split(data, 0, data.length);
                for (byte[] n : nals) { if (Avc.type(n) == 7) sps = n; if (Avc.type(n) == 8) pps = n; }
                if ((info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) {
                    if (sps != null && pps != null) { videoConfig = Avc.avcC(sps, pps); maybeStartPublishers(); }
                } else {
                    long now = System.nanoTime() / 1000;
                    if (videoShiftUs == Long.MIN_VALUE) videoShiftUs = Math.abs(info.presentationTimeUs - now) > 5_000_000 ? info.presentationTimeUs - now : 0;
                    int ts = (int) Math.max(0, (info.presentationTimeUs - videoShiftUs - t0Us) / 1000);
                    boolean key = (info.flags & MediaCodec.BUFFER_FLAG_KEY_FRAME) != 0;
                    byte[] avcc = Avc.lengthPrefixed(nals);
                    if (avcc.length > 0) for (RtmpPublisher p : publishers) p.sendVideo(ts, avcc, key);
                }
            }
            try { video.releaseOutputBuffer(i, false); } catch (IllegalStateException e) { break; }
        }
    }

    private void runAudio(int bytesPerFrame) {
        byte[] pcm = new byte[4096];
        long frames = 0;
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        while (running) {
            int n = recorder.read(pcm, 0, pcm.length);
            if (n <= 0) continue;
            // sound level for the operator (peak of this block)
            int peak = 0;
            for (int k = 0; k + 1 < n; k += 2) { int s = Math.abs((short) ((pcm[k] & 0xff) | (pcm[k + 1] << 8))); if (s > peak) peak = s; }
            level = Math.max(peak / 32768f, level * 0.85f);
            try {
                int in = audio.dequeueInputBuffer(10_000);
                if (in >= 0) {
                    ByteBuffer b = audio.getInputBuffer(in);
                    b.clear();
                    int len = Math.min(n, b.remaining());
                    b.put(pcm, 0, len);
                    long pts = t0Us + frames * 1_000_000L / SAMPLE_RATE;
                    frames += len / bytesPerFrame;
                    audio.queueInputBuffer(in, 0, len, pts, 0);
                }
                int out;
                while ((out = audio.dequeueOutputBuffer(info, 0)) != MediaCodec.INFO_TRY_AGAIN_LATER) {
                    if (out == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        ByteBuffer csd = audio.getOutputFormat().getByteBuffer("csd-0");
                        if (csd != null) { byte[] asc = new byte[csd.remaining()]; csd.get(asc); audioConfig = asc; maybeStartPublishers(); }
                        continue;
                    }
                    if (out < 0) continue;
                    ByteBuffer ob = audio.getOutputBuffer(out);
                    if (ob != null && info.size > 0 && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                        byte[] aac = new byte[info.size];
                        ob.position(info.offset);
                        ob.get(aac);
                        int ts = (int) Math.max(0, (info.presentationTimeUs - t0Us) / 1000);
                        for (RtmpPublisher p : publishers) p.sendAudio(ts, aac);
                    }
                    audio.releaseOutputBuffer(out, false);
                }
            } catch (IllegalStateException e) {
                break;
            }
        }
    }

    // ---------------------------------------------------------------------------------------- sound inputs

    /** -1 = automatic: a mixer or headset if one is plugged in, otherwise the phone's microphone. 0 = phone microphone. */
    private static AudioDeviceInfo pickInput(Context ctx, int id) {
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        AudioDeviceInfo builtIn = null, external = null;
        for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_INPUTS)) {
            if (id > 0 && d.getId() == id) return d;
            if (d.getType() == AudioDeviceInfo.TYPE_BUILTIN_MIC && builtIn == null) builtIn = d;
            if (isExternal(d) && external == null) external = d;
        }
        if (id == 0) return builtIn;
        return external != null ? external : builtIn;
    }

    static boolean isExternal(AudioDeviceInfo d) {
        int t = d.getType();
        return t == AudioDeviceInfo.TYPE_USB_DEVICE || t == AudioDeviceInfo.TYPE_USB_HEADSET || t == AudioDeviceInfo.TYPE_WIRED_HEADSET
            || t == AudioDeviceInfo.TYPE_LINE_ANALOG || t == AudioDeviceInfo.TYPE_LINE_DIGITAL || t == AudioDeviceInfo.TYPE_USB_ACCESSORY;
    }

    public static String describe(AudioDeviceInfo d) {
        String kind;
        switch (d.getType()) {
            case AudioDeviceInfo.TYPE_BUILTIN_MIC: kind = "Phone microphone"; break;
            case AudioDeviceInfo.TYPE_USB_DEVICE: case AudioDeviceInfo.TYPE_USB_ACCESSORY: kind = "USB sound input"; break;
            case AudioDeviceInfo.TYPE_USB_HEADSET: kind = "USB headset"; break;
            case AudioDeviceInfo.TYPE_WIRED_HEADSET: kind = "Cable (headset socket)"; break;
            case AudioDeviceInfo.TYPE_LINE_ANALOG: case AudioDeviceInfo.TYPE_LINE_DIGITAL: kind = "Line input"; break;
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO: kind = "Bluetooth"; break;
            default: kind = "Sound input";
        }
        CharSequence p = d.getProductName();
        return p != null && p.length() > 0 && d.getType() != AudioDeviceInfo.TYPE_BUILTIN_MIC ? kind + " (" + p + ")" : kind;
    }
}
