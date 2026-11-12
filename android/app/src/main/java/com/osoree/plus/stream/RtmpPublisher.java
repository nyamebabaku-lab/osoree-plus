package com.osoree.plus.stream;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.DataInputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.LinkedBlockingDeque;
import java.util.concurrent.TimeUnit;

import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * Sends one live stream (H.264 video + AAC audio) to one platform over RTMP or RTMPS
 * (YouTube, Facebook, Instagram, TikTok, Twitch or any custom server).
 * Plain Java, no Android classes, so it can be tested on a computer.
 * If the connection drops it keeps reconnecting until stopped, starting again at the next key frame.
 */
public class RtmpPublisher {
    public interface Listener { void onState(RtmpPublisher p); }

    private static final int CS_CONTROL = 2, CS_COMMAND = 3, CS_AUDIO = 4, CS_VIDEO = 6, CS_STREAM = 8;
    private static final int OUT_CHUNK = 4096;
    private static final long MAX_QUEUED_BYTES = 6_000_000; // ~15 s at 3 Mbit/s: beyond this, drop video until a key frame

    public final String name;
    private final String scheme, host, app, key, tcUrl;
    private final int port;
    private final Listener listener;
    private final Map<String, Object> metadata;

    private final LinkedBlockingDeque<Packet> queue = new LinkedBlockingDeque<>();
    private volatile long queuedBytes = 0;
    private volatile boolean running = false;
    private volatile byte[] videoConfig, audioConfig;
    private Thread worker;

    // what the operator sees
    public volatile String state = "idle"; // idle | connecting | live | retrying | stopped
    public volatile String message = "";
    public volatile long bytesSent = 0, startedAt = 0, droppedFrames = 0;

    // connection state (worker thread only, plus the reader)
    private Socket socket;
    private DataInputStream in;
    private OutputStream out;
    private final Object writeLock = new Object();
    private int inChunk = 128, streamId = 1;
    private long bytesRead = 0, lastAck = 0, windowAck = 2_500_000;
    private boolean needKeyFrame = true;
    private final Map<Integer, ChunkIn> chunks = new HashMap<>();

    private static final class Packet {
        final int type, ts; final byte[] data; final boolean key;
        Packet(int type, int ts, byte[] data, boolean key) { this.type = type; this.ts = ts; this.data = data; this.key = key; }
    }

    private static final class ChunkIn { int ts, len, type, msid, got; boolean ext; byte[] buf; }

    private static final class Message {
        final int type, msid; final byte[] payload;
        Message(int type, int msid, byte[] payload) { this.type = type; this.msid = msid; this.payload = payload; }
    }

    /**
     * serverUrl: e.g. "rtmps://live-api-s.facebook.com:443/rtmp/" or "rtmp://a.rtmp.youtube.com/live2".
     * streamKey may be empty when the server URL already ends with the key.
     */
    public RtmpPublisher(String name, String serverUrl, String streamKey, Map<String, Object> metadata, Listener listener) {
        this.name = name;
        this.listener = listener;
        this.metadata = metadata;
        String url = serverUrl.trim();
        String k = streamKey == null ? "" : streamKey.trim();
        if (k.isEmpty()) { // the key is the last part of the URL
            int cut = url.replaceAll("/+$", "").lastIndexOf('/');
            k = url.replaceAll("/+$", "").substring(cut + 1);
            url = url.substring(0, cut);
        }
        URI u = URI.create(url.replaceAll("/+$", ""));
        scheme = u.getScheme() == null ? "rtmp" : u.getScheme().toLowerCase();
        if (!scheme.equals("rtmp") && !scheme.equals("rtmps")) throw new IllegalArgumentException("The server address must start with rtmp:// or rtmps://");
        host = u.getHost();
        if (host == null) throw new IllegalArgumentException("The server address is not complete.");
        port = u.getPort() > 0 ? u.getPort() : scheme.equals("rtmps") ? 443 : 1935;
        app = u.getPath() == null ? "" : u.getPath().replaceAll("^/+", "");
        key = k;
        tcUrl = scheme + "://" + host + ":" + port + "/" + app;
        if (key.isEmpty()) throw new IllegalArgumentException("The stream key is missing.");
    }

    // ---------------------------------------------------------------------------------------- control

    public synchronized void start() {
        if (running) return;
        running = true;
        startedAt = System.currentTimeMillis();
        worker = new Thread(this::run, "rtmp-" + name);
        worker.start();
    }

    public synchronized void stop() {
        running = false;
        setState("stopped", "");
        closeSocket();
        if (worker != null) worker.interrupt();
        queue.clear();
        queuedBytes = 0;
    }

    public void setVideoConfig(byte[] avcC) { videoConfig = avcC; }
    public void setAudioConfig(byte[] asc) { audioConfig = asc; }

    /** One encoded picture: length-prefixed NAL units (see Avc.lengthPrefixed). ts in milliseconds. */
    public void sendVideo(int ts, byte[] avcc, boolean keyFrame) {
        if (!"live".equals(state)) return;
        if (queuedBytes > MAX_QUEUED_BYTES && !keyFrame) { droppedFrames++; return; } // internet too slow: skip to the next key frame
        byte[] tag = new byte[5 + avcc.length];
        tag[0] = (byte) (keyFrame ? 0x17 : 0x27); tag[1] = 1; // AVC NALU, composition time 0
        System.arraycopy(avcc, 0, tag, 5, avcc.length);
        offer(new Packet(9, ts, tag, keyFrame));
    }

    /** One AAC frame (raw, no ADTS header). ts in milliseconds. */
    public void sendAudio(int ts, byte[] aac) {
        if (!"live".equals(state)) return;
        byte[] tag = new byte[2 + aac.length];
        tag[0] = (byte) 0xAF; tag[1] = 1; // AAC, 44 kHz, 16-bit, stereo flags; raw frame
        System.arraycopy(aac, 0, tag, 2, aac.length);
        offer(new Packet(8, ts, tag, false));
    }

    private void offer(Packet p) {
        queuedBytes += p.data.length;
        queue.offer(p);
    }

    public long uptimeMs() { return "live".equals(state) ? System.currentTimeMillis() - startedAt : 0; }

    private void setState(String s, String msg) {
        state = s; message = msg == null ? "" : msg;
        if (listener != null) listener.onState(this);
    }

    // ---------------------------------------------------------------------------------------- worker

    private void run() {
        int attempt = 0;
        while (running) {
            try {
                setState(attempt == 0 ? "connecting" : "retrying", attempt == 0 ? "" : message);
                open();
                attempt = 0;
                startedAt = System.currentTimeMillis();
                needKeyFrame = true;
                queue.clear(); queuedBytes = 0;
                setState("live", "");
                pump();
            } catch (InterruptedException e) {
                break;
            } catch (IOException | RuntimeException e) {
                closeSocket();
                if (!running) break;
                attempt++;
                String why = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                if (e instanceof FatalException) { setState("stopped", why); running = false; break; }
                setState("retrying", why);
                try { Thread.sleep(Math.min(10_000, 2000L * attempt)); } catch (InterruptedException ie) { break; }
            }
        }
        closeSocket();
    }

    /** A problem that retrying will not fix (wrong stream key, refused by the platform). */
    private static final class FatalException extends IOException { FatalException(String m) { super(m); } }

    private void pump() throws IOException, InterruptedException {
        Thread reader = new Thread(() -> { try { while (running) handle(readMessage()); } catch (IOException e) { closeSocket(); } }, "rtmp-read-" + name);
        reader.setDaemon(true);
        reader.start();
        while (running) {
            Packet p = queue.poll(500, TimeUnit.MILLISECONDS);
            if (socket == null || socket.isClosed()) throw new IOException("The connection was closed.");
            if (p == null) continue;
            queuedBytes -= p.data.length;
            if (p.type == 9) {
                if (needKeyFrame && !p.key) { droppedFrames++; continue; }
                needKeyFrame = false;
            }
            writeMessage(p.type == 9 ? CS_VIDEO : CS_AUDIO, p.type, streamId, p.ts, p.data);
        }
    }

    // ---------------------------------------------------------------------------------------- connecting

    private void open() throws IOException {
        closeSocket();
        Socket s;
        Socket plain = new Socket();
        plain.connect(new InetSocketAddress(host, port), 10_000);
        if (scheme.equals("rtmps")) { // TLS over the connected socket (the host name is sent for the certificate check)
            SSLSocket ssl = (SSLSocket) ((SSLSocketFactory) SSLSocketFactory.getDefault()).createSocket(plain, host, port, true);
            ssl.startHandshake();
            s = ssl;
        } else s = plain;
        s.setTcpNoDelay(true);
        s.setSoTimeout(15_000);
        socket = s;
        in = new DataInputStream(new BufferedInputStream(s.getInputStream(), 64 * 1024));
        out = new BufferedOutputStream(s.getOutputStream(), 64 * 1024);
        chunks.clear(); inChunk = 128; bytesRead = 0; lastAck = 0;

        handshake();
        writeMessage(CS_CONTROL, 1, 0, 0, int32(OUT_CHUNK)); // Set Chunk Size

        Map<String, Object> props = new java.util.LinkedHashMap<>();
        props.put("app", app);
        props.put("type", "nonprivate");
        props.put("flashVer", "FMLE/3.0 (compatible; FMSc/1.0)");
        props.put("swfUrl", tcUrl);
        props.put("tcUrl", tcUrl);
        command(0, "connect", 1, props);
        expectResult(1, "connect");

        command(0, "releaseStream", 2, null, key);
        command(0, "FCPublish", 3, null, key);
        command(0, "createStream", 4, (Object) null);
        List<Object> created = expectResult(4, "createStream");
        if (created.size() > 3 && created.get(3) instanceof Double) streamId = ((Double) created.get(3)).intValue();

        writeMessage(CS_STREAM, 20, streamId, 0, Amf0.encode("publish", 5.0, null, key, "live"));
        flush();
        waitForPublishStart();

        Amf0.Ecma meta = new Amf0.Ecma();
        meta.putAll(metadata);
        writeMessage(CS_STREAM, 18, streamId, 0, Amf0.encode("@setDataFrame", "onMetaData", meta));
        if (videoConfig != null) {
            byte[] tag = new byte[5 + videoConfig.length];
            tag[0] = 0x17; tag[1] = 0; // AVC sequence header
            System.arraycopy(videoConfig, 0, tag, 5, videoConfig.length);
            writeMessage(CS_VIDEO, 9, streamId, 0, tag);
        }
        if (audioConfig != null) {
            byte[] tag = new byte[2 + audioConfig.length];
            tag[0] = (byte) 0xAF; tag[1] = 0; // AAC sequence header
            System.arraycopy(audioConfig, 0, tag, 2, audioConfig.length);
            writeMessage(CS_AUDIO, 8, streamId, 0, tag);
        }
        flush();
        socket.setSoTimeout(0);
    }

    private void handshake() throws IOException {
        byte[] c1 = new byte[1536];
        new SecureRandom().nextBytes(c1);
        for (int i = 0; i < 8; i++) c1[i] = 0; // time and zero fields
        synchronized (writeLock) { out.write(3); out.write(c1); out.flush(); }
        if (in.readUnsignedByte() != 3) throw new IOException("The server did not answer as an RTMP server.");
        byte[] s1 = new byte[1536];
        in.readFully(s1);
        synchronized (writeLock) { out.write(s1); out.flush(); } // C2 echoes S1
        in.readFully(new byte[1536]); // S2
        bytesRead += 1 + 1536 * 2;
    }

    private void command(int msid, String name, int tid, Object... args) throws IOException {
        Object[] all = new Object[2 + args.length];
        all[0] = name; all[1] = (double) tid;
        System.arraycopy(args, 0, all, 2, args.length);
        writeMessage(CS_COMMAND, 20, msid, 0, Amf0.encode(all));
        flush();
    }

    private List<Object> expectResult(int tid, String what) throws IOException {
        while (true) {
            Message m = readMessage();
            if (handle(m)) continue;
            if (m.type != 20) continue;
            List<Object> v = Amf0.decode(m.payload);
            if (v.size() < 2 || !(v.get(1) instanceof Double) || ((Double) v.get(1)).intValue() != tid) continue;
            if ("_result".equals(v.get(0))) return v;
            if ("_error".equals(v.get(0))) throw new FatalException("The platform refused the " + what + ": " + describe(v));
        }
    }

    private void waitForPublishStart() throws IOException {
        long until = System.currentTimeMillis() + 10_000;
        while (System.currentTimeMillis() < until) {
            Message m = readMessage();
            if (handle(m) || m.type != 20) continue;
            List<Object> v = Amf0.decode(m.payload);
            if (!"onStatus".equals(v.isEmpty() ? null : v.get(0))) continue;
            String code = statusCode(v);
            if (code.equals("NetStream.Publish.Start")) return;
            if (code.contains("BadName") || code.contains("Failed") || code.contains("Rejected") || code.contains("Error")) {
                throw new FatalException("The stream key was not accepted (" + code + "). Check the key and the server address.");
            }
        }
        // Some servers never confirm: carry on.
    }

    private static String statusCode(List<Object> v) {
        for (Object o : v) if (o instanceof Map) { Object c = ((Map<?, ?>) o).get("code"); if (c != null) return c.toString(); }
        return "";
    }

    private static String describe(List<Object> v) {
        for (Object o : v) if (o instanceof Map) { Object d = ((Map<?, ?>) o).get("description"); if (d != null) return d.toString(); Object c = ((Map<?, ?>) o).get("code"); if (c != null) return c.toString(); }
        return "no reason given";
    }

    // ---------------------------------------------------------------------------------------- incoming

    /** Protocol housekeeping. Returns true when the message needed nothing else. */
    private boolean handle(Message m) throws IOException {
        switch (m.type) {
            case 1: inChunk = int32(m.payload, 0) & 0x7fffffff; return true;
            case 5: windowAck = int32(m.payload, 0) & 0xffffffffL; return true;
            case 6: case 3: return true;
            case 4: { // user control: answer pings so the platform keeps the stream
                int event = ((m.payload[0] & 0xff) << 8) | (m.payload[1] & 0xff);
                if (event == 6 && m.payload.length >= 6) {
                    byte[] pong = new byte[6];
                    pong[1] = 7;
                    System.arraycopy(m.payload, 2, pong, 2, 4);
                    writeMessage(CS_CONTROL, 4, 0, 0, pong);
                    flush();
                }
                return true;
            }
            case 20: {
                List<Object> v = Amf0.decode(m.payload);
                if (!v.isEmpty() && "onStatus".equals(v.get(0))) {
                    String code = statusCode(v);
                    if (code.contains("Unpublish") || code.contains("Failed") || code.contains("Error")) throw new IOException("The platform ended the stream (" + code + ").");
                }
                return false;
            }
            default: return false;
        }
    }

    private Message readMessage() throws IOException {
        while (true) {
            int b0 = readByte();
            int fmt = b0 >>> 6, csid = b0 & 0x3f;
            if (csid == 0) csid = 64 + readByte();
            else if (csid == 1) csid = 64 + readByte() + readByte() * 256;
            ChunkIn c = chunks.get(csid);
            if (c == null) { c = new ChunkIn(); chunks.put(csid, c); }
            if (fmt <= 2) {
                int t = readInt(3);
                if (fmt <= 1) { c.len = readInt(3); c.type = readByte(); }
                if (fmt == 0) { c.msid = Integer.reverseBytes(readInt(4)); }
                c.ext = t == 0xffffff;
                if (c.ext) t = readInt(4);
                c.ts = fmt == 0 ? t : c.ts + t;
            } else if (c.ext) readInt(4);
            if (c.buf == null || c.got == 0) { c.buf = new byte[c.len]; c.got = 0; }
            int n = Math.min(inChunk, c.len - c.got);
            in.readFully(c.buf, c.got, n);
            bytesRead += n;
            c.got += n;
            acknowledge();
            if (c.got >= c.len) {
                Message m = new Message(c.type, c.msid, c.buf);
                c.buf = null; c.got = 0;
                return m;
            }
        }
    }

    private void acknowledge() throws IOException {
        if (bytesRead - lastAck >= windowAck / 2) {
            lastAck = bytesRead;
            writeMessage(CS_CONTROL, 3, 0, 0, int32((int) bytesRead));
            flush();
        }
    }

    private int readByte() throws IOException {
        int b = in.read();
        if (b < 0) throw new EOFException("The platform closed the connection.");
        bytesRead++;
        return b;
    }

    private int readInt(int n) throws IOException {
        int v = 0;
        for (int i = 0; i < n; i++) v = (v << 8) | readByte();
        return v;
    }

    // ---------------------------------------------------------------------------------------- outgoing

    private void writeMessage(int csid, int type, int msid, int ts, byte[] payload) throws IOException {
        synchronized (writeLock) {
            if (out == null) throw new IOException("Not connected.");
            boolean ext = ts >= 0xffffff;
            out.write(csid & 0x3f); // fmt 0
            write24(ext ? 0xffffff : ts);
            write24(payload.length);
            out.write(type);
            out.write(msid); out.write(msid >>> 8); out.write(msid >>> 16); out.write(msid >>> 24); // little-endian
            if (ext) out.write(int32(ts));
            for (int off = 0; off < payload.length; off += OUT_CHUNK) {
                if (off > 0) { out.write(0xC0 | (csid & 0x3f)); if (ext) out.write(int32(ts)); } // fmt 3 continuation
                int n = Math.min(OUT_CHUNK, payload.length - off);
                out.write(payload, off, n);
            }
            bytesSent += payload.length;
            if (type == 8 || type == 9) out.flush();
        }
    }

    private void flush() throws IOException { synchronized (writeLock) { if (out != null) out.flush(); } }

    private void write24(int v) throws IOException { out.write(v >>> 16); out.write(v >>> 8); out.write(v); }

    private static byte[] int32(int v) { return new byte[] { (byte) (v >>> 24), (byte) (v >>> 16), (byte) (v >>> 8), (byte) v }; }

    private static int int32(byte[] b, int o) { return ((b[o] & 0xff) << 24) | ((b[o + 1] & 0xff) << 16) | ((b[o + 2] & 0xff) << 8) | (b[o + 3] & 0xff); }

    private void closeSocket() {
        Socket s = socket;
        socket = null;
        if (s != null) try { s.close(); } catch (IOException e) { /* already closed */ }
        synchronized (writeLock) { out = null; }
    }

}
