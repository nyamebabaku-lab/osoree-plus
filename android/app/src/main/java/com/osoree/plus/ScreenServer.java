package com.osoree.plus;

import android.content.res.AssetManager;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * A very small web server on the phone. The phone's own projector screen (a Presentation) and any
 * laptop, smart TV or TV box on the same Wi-Fi or hotspot load the output page from it, follow the
 * operator through /events, and get fonts and the church's pictures and videos from it.
 * Other devices are only let in while Wi-Fi screens are switched on.
 */
public class ScreenServer {
    private static final String FILE_PREFIX = "/_capacitor_file_";

    private final AssetManager assets;
    private final File mediaDir;
    private final ServerSocket socket;
    private final CopyOnWriteArrayList<Socket> clients = new CopyOnWriteArrayList<>();
    private final ExecutorService workers = Executors.newCachedThreadPool();
    private final ExecutorService sender = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService beat = Executors.newSingleThreadScheduledExecutor();
    private volatile String state;
    private volatile boolean running = true;
    private volatile boolean lan = false;

    // Wi-Fi camera (WebRTC) introductions. Each screen posts an offer; the camera phone collects offers
    // and posts back an answer. Only these short texts pass through here; the video goes directly.
    private static final class Pending { final String sdp; final long at = System.currentTimeMillis(); boolean taken; Pending(String s) { sdp = s; } }
    private final Map<String, Pending> offers = new ConcurrentHashMap<>();
    private final Map<String, Pending> answers = new ConcurrentHashMap<>();
    private volatile long cameraSeen = 0;

    /** A camera phone has asked for screens in the last few seconds. */
    public boolean cameraOnline() { return System.currentTimeMillis() - cameraSeen < 5000; }

    public ScreenServer(AssetManager assets, File mediaDir, String state) throws IOException {
        this.assets = assets;
        this.mediaDir = mediaDir;
        this.state = state;
        ServerSocket s = null;
        for (int port : new int[] { 8080, 8081, 8082, 8888, 0 }) {
            try { s = new ServerSocket(port); break; } catch (IOException e) { /* port in use: try the next one */ }
        }
        if (s == null) throw new IOException("No free port");
        socket = s;
        workers.execute(this::acceptLoop);
        // A comment line every few seconds keeps connections open and finds screens that have gone away
        // (a closed screen is only noticed on the second write to it).
        beat.scheduleWithFixedDelay(() -> push(":\n\n"), 4, 4, TimeUnit.SECONDS);
    }

    public int port() { return socket.getLocalPort(); }
    public boolean lanEnabled() { return lan; }

    /** Screens on other devices (the phone's own projector screen is not counted). */
    public int remoteCount() {
        int n = 0;
        for (Socket c : clients) if (!c.getInetAddress().isLoopbackAddress()) n++;
        return n;
    }

    public void setLan(boolean on) {
        lan = on;
        if (!on) for (Socket c : clients) if (!c.getInetAddress().isLoopbackAddress()) { clients.remove(c); close(c); }
    }

    public void broadcast(String json) {
        state = json;
        push("data: " + json + "\n\n");
    }

    public void stop() {
        running = false;
        try { socket.close(); } catch (IOException e) { /* already closed */ }
        for (Socket c : clients) close(c);
        clients.clear();
        beat.shutdownNow();
        sender.shutdownNow();
        workers.shutdownNow();
    }

    private void push(String text) {
        if (!running) return;
        final byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        sender.execute(() -> {
            for (Socket c : clients) {
                try {
                    OutputStream out = c.getOutputStream();
                    out.write(bytes);
                    out.flush();
                } catch (IOException e) {
                    clients.remove(c);
                    close(c);
                }
            }
        });
    }

    private void acceptLoop() {
        while (running) {
            try {
                final Socket c = socket.accept();
                if (!lan && !c.getInetAddress().isLoopbackAddress()) { close(c); continue; }
                workers.execute(() -> handle(c));
            } catch (IOException e) {
                if (!running) return;
            }
        }
    }

    private void handle(Socket c) {
        try {
            c.setSoTimeout(8000);
            BufferedReader in = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.ISO_8859_1));
            String first = in.readLine();
            if (first == null) { close(c); return; }
            String range = null, line;
            int length = 0;
            while ((line = in.readLine()) != null && !line.isEmpty()) {
                String low = line.toLowerCase(Locale.ROOT);
                if (low.startsWith("range:")) range = line.substring(6).trim();
                else if (low.startsWith("content-length:")) { try { length = Integer.parseInt(line.substring(15).trim()); } catch (NumberFormatException e) { length = 0; } }
            }
            String[] parts = first.split(" ");
            String method = parts[0];
            boolean head = method.equals("HEAD");
            String path = parts.length > 1 ? parts[1] : "/";
            String query = "";
            int q = path.indexOf('?');
            if (q >= 0) { query = path.substring(q + 1); path = path.substring(0, q); }
            path = URLDecoder.decode(path, "UTF-8");
            OutputStream out = c.getOutputStream();

            if (path.startsWith("/rtc/")) {
                String body = "";
                if (length > 0 && length < 256 * 1024) {
                    char[] buf = new char[length];
                    int got = 0;
                    while (got < length) { int n = in.read(buf, got, length - got); if (n < 0) break; got += n; }
                    body = new String(new String(buf, 0, got).getBytes(StandardCharsets.ISO_8859_1), StandardCharsets.UTF_8);
                }
                rtc(out, method, path, param(query, "id"), body);
                close(c);
                return;
            }

            if (path.equals("/events")) {
                c.setSoTimeout(0);
                c.setKeepAlive(true);
                out.write(("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n"
                        + "retry: 2000\n\ndata: " + state + "\n\n").getBytes(StandardCharsets.UTF_8));
                out.flush();
                clients.add(c);
                return; // stays open; push() writes to it from now on
            }
            if (path.equals("/state")) {
                respond(out, head, "200 OK", "application/json; charset=utf-8", state.getBytes(StandardCharsets.UTF_8));
            } else if (path.startsWith(FILE_PREFIX + "/")) {
                sendFile(out, head, new File(path.substring(FILE_PREFIX.length())), range);
            } else {
                sendAsset(out, head, path.equals("/") || path.equals("/index.html") ? "/display.html" : path);
            }
            close(c);
        } catch (IOException | IllegalArgumentException e) {
            close(c);
        }
    }

    private void rtc(OutputStream out, String method, String path, String id, String body) throws IOException {
        long now = System.currentTimeMillis();
        for (Iterator<Map.Entry<String, Pending>> it = offers.entrySet().iterator(); it.hasNext(); ) if (now - it.next().getValue().at > 60000) it.remove();
        for (Iterator<Map.Entry<String, Pending>> it = answers.entrySet().iterator(); it.hasNext(); ) if (now - it.next().getValue().at > 60000) it.remove();
        String text = "";
        int status = 200;
        if (method.equals("OPTIONS")) { status = 204; }
        else if (path.equals("/rtc/offer") && method.equals("POST") && id.length() > 0 && body.length() > 0) { offers.put(id, new Pending(body)); }
        else if (path.equals("/rtc/answer") && method.equals("POST") && id.length() > 0 && body.length() > 0) { answers.put(id, new Pending(body)); offers.remove(id); }
        else if (path.equals("/rtc/answer")) { Pending p = answers.remove(id); if (p == null) status = 204; else text = p.sdp; }
        else if (path.equals("/rtc/offers")) {
            // The camera phone asks every second: hand over the offers it has not seen yet.
            cameraSeen = now;
            StringBuilder sb = new StringBuilder("[");
            for (Map.Entry<String, Pending> e : offers.entrySet()) {
                if (e.getValue().taken) continue;
                e.getValue().taken = true;
                if (sb.length() > 1) sb.append(',');
                sb.append("{\"id\":").append(json(e.getKey())).append(",\"sdp\":").append(json(e.getValue().sdp)).append('}');
            }
            text = sb.append(']').toString();
        }
        else if (path.equals("/rtc/status")) { text = "{\"camera\":" + cameraOnline() + "}"; }
        else status = 404;
        byte[] b = text.getBytes(StandardCharsets.UTF_8);
        // The camera phone's app page comes from another origin, so these replies allow any origin.
        out.write(("HTTP/1.1 " + (status == 200 ? "200 OK" : status == 204 ? "204 No Content" : "404 Not Found") + "\r\n"
                + "Content-Type: " + (text.startsWith("[") || text.startsWith("{") ? "application/json" : "text/plain") + "; charset=utf-8\r\n"
                + "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\n"
                + "Access-Control-Allow-Private-Network: true\r\n"
                + "Content-Length: " + b.length + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        out.write(b);
        out.flush();
    }

    private static String param(String query, String name) {
        for (String kv : query.split("&")) {
            int eq = kv.indexOf('=');
            if (eq > 0 && kv.substring(0, eq).equals(name)) {
                try { return URLDecoder.decode(kv.substring(eq + 1), "UTF-8"); } catch (Exception e) { return ""; }
            }
        }
        return "";
    }

    private static String json(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char ch : s.toCharArray()) {
            if (ch == '"' || ch == '\\') b.append('\\').append(ch);
            else if (ch == '\n') b.append("\\n");
            else if (ch == '\r') b.append("\\r");
            else if (ch < 0x20) b.append(String.format("\\u%04x", (int) ch));
            else b.append(ch);
        }
        return b.append('"').toString();
    }

    /** Files from the web build (display page, fonts). */
    private void sendAsset(OutputStream out, boolean head, String path) throws IOException {
        if (!path.matches("/[A-Za-z0-9._/-]+") || path.contains("..")) { notFound(out, head); return; }
        byte[] body;
        try (InputStream in = assets.open("public" + path)) {
            body = readAll(in);
        } catch (IOException e) {
            notFound(out, head);
            return;
        }
        respond(out, head, "200 OK", typeOf(path), body);
    }

    /** The church's pictures and videos, with byte ranges so videos can start quickly and seek. */
    private void sendFile(OutputStream out, boolean head, File f, String range) throws IOException {
        File file = f.getCanonicalFile();
        if (!file.getPath().startsWith(mediaDir.getCanonicalPath() + File.separator) || !file.isFile()) { notFound(out, head); return; }
        long size = file.length(), start = 0, end = size - 1;
        boolean partial = false;
        if (range != null && range.startsWith("bytes=") && size > 0) {
            String r = range.substring(6).split(",")[0].trim();
            int dash = r.indexOf('-');
            try {
                if (dash == 0) { start = Math.max(0, size - Long.parseLong(r.substring(1))); }
                else {
                    start = Long.parseLong(r.substring(0, dash));
                    if (dash < r.length() - 1) end = Math.min(end, Long.parseLong(r.substring(dash + 1)));
                }
                partial = true;
            } catch (NumberFormatException e) { start = 0; end = size - 1; }
            if (start > end || start >= size) {
                out.write(("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */" + size + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                out.flush();
                return;
            }
        }
        long length = end - start + 1;
        StringBuilder h = new StringBuilder();
        h.append("HTTP/1.1 ").append(partial ? "206 Partial Content" : "200 OK").append("\r\n")
         .append("Content-Type: ").append(typeOf(file.getName())).append("\r\n")
         .append("Content-Length: ").append(length).append("\r\n")
         .append("Accept-Ranges: bytes\r\n");
        if (partial) h.append("Content-Range: bytes ").append(start).append('-').append(end).append('/').append(size).append("\r\n");
        h.append("Cache-Control: no-cache\r\nConnection: close\r\n\r\n");
        out.write(h.toString().getBytes(StandardCharsets.UTF_8));
        if (!head) {
            try (FileInputStream in = new FileInputStream(file)) {
                long skipped = 0;
                while (skipped < start) { long n = in.skip(start - skipped); if (n <= 0) break; skipped += n; }
                byte[] buf = new byte[64 * 1024];
                long left = length;
                while (left > 0) {
                    int n = in.read(buf, 0, (int) Math.min(buf.length, left));
                    if (n < 0) break;
                    out.write(buf, 0, n);
                    left -= n;
                }
            }
        }
        out.flush();
    }

    static String typeOf(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        if (n.endsWith(".html")) return "text/html; charset=utf-8";
        if (n.endsWith(".css")) return "text/css; charset=utf-8";
        if (n.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (n.endsWith(".json")) return "application/json; charset=utf-8";
        if (n.endsWith(".woff2")) return "font/woff2";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".gif")) return "image/gif";
        if (n.endsWith(".webp")) return "image/webp";
        if (n.endsWith(".mp4") || n.endsWith(".m4v")) return "video/mp4";
        if (n.endsWith(".webm")) return "video/webm";
        if (n.endsWith(".mov")) return "video/quicktime";
        return "application/octet-stream";
    }

    private static byte[] readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
        byte[] chunk = new byte[16 * 1024];
        int n;
        while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
        return buf.toByteArray();
    }

    private static void notFound(OutputStream out, boolean head) throws IOException {
        respond(out, head, "404 Not Found", "text/plain; charset=utf-8", "Not found".getBytes(StandardCharsets.UTF_8));
    }

    private static void respond(OutputStream out, boolean head, String status, String type, byte[] body) throws IOException {
        out.write(("HTTP/1.1 " + status + "\r\nContent-Type: " + type + "\r\nContent-Length: " + body.length + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        if (!head) out.write(body);
        out.flush();
    }

    private static void close(Socket c) {
        try { c.close(); } catch (IOException e) { /* nothing to do */ }
    }
}
