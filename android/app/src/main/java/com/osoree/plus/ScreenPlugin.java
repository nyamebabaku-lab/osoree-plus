package com.osoree.plus;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;
import android.hardware.display.DisplayManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.speech.RecognizerIntent;
import android.view.Display;
import android.view.WindowManager;
import android.webkit.MimeTypeMap;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Sends what the operator chooses to the outputs a phone can reach without internet:
 * a projector or TV on a cable or wireless display, and browsers on the same Wi-Fi or hotspot.
 * Also keeps the church's pictures and videos in the app's own storage.
 */
@CapacitorPlugin(name = "Screen", permissions = { @Permission(strings = { android.Manifest.permission.CAMERA }, alias = "camera") })
public class ScreenPlugin extends Plugin implements DisplayManager.DisplayListener {
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private DisplayManager displays;
    private ScreenPresentation presentation;
    private ScreenServer server;
    private File mediaDir;
    private volatile String state = "{\"kind\":\"idle\"}";

    @Override
    public void load() {
        mediaDir = new File(getContext().getFilesDir(), "media");
        mediaDir.mkdirs();
        try {
            server = new ScreenServer(getContext().getAssets(), mediaDir, state);
        } catch (Exception e) {
            server = null; // the projector falls back to the bundled page; Wi-Fi screens are unavailable
        }
        displays = (DisplayManager) getContext().getSystemService(Context.DISPLAY_SERVICE);
        displays.registerDisplayListener(this, main);
        main.post(() -> {
            // The operator's phone must not go to sleep in the middle of a service.
            getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            syncPresentation();
        });
    }

    @PluginMethod
    public void send(PluginCall call) {
        final String s = call.getString("state");
        if (s != null) {
            state = s;
            ScreenServer sv = server;
            if (sv != null) sv.broadcast(s);
            main.post(() -> { if (presentation != null) presentation.render(s); });
        }
        call.resolve();
    }

    /** Voice search: Android's own speech recogniser (works offline when the phone has the offline speech pack). */
    @PluginMethod
    public void listen(PluginCall call) {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_PROMPT, call.getString("prompt", "Say a verse, e.g. John 3 16"));
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
        i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        String lang = call.getString("lang", "");
        if (!lang.isEmpty()) i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
        try {
            startActivityForResult(call, i, "heard");
        } catch (android.content.ActivityNotFoundException e) {
            call.reject("This phone has no speech recogniser. Install or enable Google voice typing.");
        }
    }

    @ActivityCallback
    private void heard(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        java.util.ArrayList<String> said = data != null ? data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS) : null;
        if (result.getResultCode() != Activity.RESULT_OK || said == null || said.isEmpty()) { call.reject("cancelled"); return; }
        JSObject r = new JSObject();
        JSArray list = new JSArray();
        for (String t : said) list.put(t);
        r.put("results", list);
        call.resolve(r);
    }

    /** Live video with the phone's own camera: ask once for camera permission. */
    @PluginMethod
    public void requestCamera(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) { JSObject r = new JSObject(); r.put("granted", true); call.resolve(r); return; }
        requestPermissionForAlias("camera", call, "cameraAnswered");
    }

    @PermissionCallback
    private void cameraAnswered(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", getPermissionState("camera") == PermissionState.GRANTED);
        call.resolve(r);
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void startServer(PluginCall call) {
        if (server == null) { call.reject("The Wi-Fi screen could not be started on this phone."); return; }
        server.setLan(true);
        call.resolve(statusObject());
    }

    @PluginMethod
    public void stopServer(PluginCall call) {
        if (server != null) server.setLan(false);
        call.resolve(statusObject());
    }

    @PluginMethod
    public void openCastSettings(PluginCall call) {
        for (String action : new String[] { "android.settings.CAST_SETTINGS", Settings.ACTION_WIRELESS_SETTINGS, Settings.ACTION_SETTINGS }) {
            try {
                Intent i = new Intent(action);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                call.resolve();
                return;
            } catch (Exception e) { /* this phone has no such settings page: try the next */ }
        }
        call.reject("Cast settings are not available on this phone.");
    }

    /** Opens the system picker for pictures and videos; the chosen files are copied into the app. */
    @PluginMethod
    public void pickMedia(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "image/*", "video/*", "application/pdf" });
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(call, i, "mediaPicked");
    }

    @ActivityCallback
    private void mediaPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null) { call.reject("cancelled"); return; }
        final List<Uri> uris = new ArrayList<>();
        if (data.getClipData() != null) for (int k = 0; k < data.getClipData().getItemCount(); k++) uris.add(data.getClipData().getItemAt(k).getUri());
        else if (data.getData() != null) uris.add(data.getData());
        io.execute(() -> {
            JSArray items = new JSArray();
            ContentResolver cr = getContext().getContentResolver();
            for (Uri uri : uris) {
                try {
                    String type = cr.getType(uri);
                    String name = "file";
                    try (Cursor cur = cr.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                        if (cur != null && cur.moveToFirst() && cur.getString(0) != null) name = cur.getString(0);
                    }
                    if ("application/pdf".equals(type) || name.toLowerCase().endsWith(".pdf")) {
                        JSObject pdf = importPdf(cr, uri, name);
                        if (pdf != null) items.put(pdf);
                        continue;
                    }
                    if (type == null || !(type.startsWith("image/") || type.startsWith("video/"))) continue;
                    String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(type);
                    String id = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
                    File out = new File(mediaDir, id + "." + (ext != null ? ext : (type.startsWith("video/") ? "mp4" : "jpg")));
                    long size = 0;
                    try (InputStream in = cr.openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
                        if (in == null) continue;
                        byte[] buf = new byte[64 * 1024];
                        int n;
                        while ((n = in.read(buf)) > 0) { os.write(buf, 0, n); size += n; }
                    }
                    JSObject o = new JSObject();
                    o.put("id", id);
                    o.put("name", name);
                    o.put("type", type);
                    o.put("path", out.getAbsolutePath());
                    o.put("size", size);
                    items.put(o);
                } catch (Exception e) {
                    // skip a file that cannot be read (for example one still downloading from the cloud)
                }
            }
            JSObject r = new JSObject();
            r.put("items", items);
            call.resolve(r);
        });
    }

    private static final int MAX_PDF_PAGES = 300;

    /** Each page of a PDF becomes a picture sized for a 1080p screen (Android's own PDF renderer, offline). */
    private JSObject importPdf(ContentResolver cr, Uri uri, String name) {
        String id = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        File dir = new File(mediaDir, id);
        dir.mkdirs();
        long size = 0;
        JSArray pages = new JSArray();
        int total = 0;
        try (ParcelFileDescriptor fd = cr.openFileDescriptor(uri, "r")) {
            if (fd == null) return null;
            try (PdfRenderer pdf = new PdfRenderer(fd)) {
                total = pdf.getPageCount();
                for (int n = 0; n < Math.min(total, MAX_PDF_PAGES); n++) {
                    try (PdfRenderer.Page page = pdf.openPage(n)) {
                        float scale = Math.min(2880f / page.getWidth(), 1620f / page.getHeight());
                        int w = Math.max(1, Math.round(page.getWidth() * scale)), h = Math.max(1, Math.round(page.getHeight() * scale));
                        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
                        bmp.eraseColor(Color.WHITE);
                        page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                        File out = new File(dir, "p" + (n + 1) + ".jpg");
                        try (OutputStream os = new FileOutputStream(out)) { bmp.compress(Bitmap.CompressFormat.JPEG, 90, os); }
                        bmp.recycle();
                        size += out.length();
                        pages.put(out.getAbsolutePath());
                    }
                }
            }
        } catch (Exception e) {
            deleteRecursive(dir); // password-protected or damaged PDF
            return null;
        }
        if (pages.length() == 0) { deleteRecursive(dir); return null; }
        JSObject o = new JSObject();
        o.put("id", id);
        o.put("name", name);
        o.put("type", "application/pdf");
        o.put("path", dir.getAbsolutePath());
        o.put("pages", pages);
        o.put("size", size);
        o.put("more", total > MAX_PDF_PAGES ? total : 0);
        return o;
    }

    private static void deleteRecursive(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteRecursive(k);
        f.delete();
    }

    @PluginMethod
    public void deleteMedia(PluginCall call) {
        String path = call.getString("path", "");
        try {
            File f = new File(path).getCanonicalFile();
            if (f.getPath().startsWith(mediaDir.getCanonicalPath() + File.separator)) deleteRecursive(f);
        } catch (Exception e) { /* nothing to delete */ }
        call.resolve();
    }

    /**
     * Backups can be many megabytes (whole Bibles). They are written to a temporary file in pieces first:
     * Android saves a pending call's data while "Save as" is open, and a large payload there crashes the app.
     */
    private File tempBackup() { return new File(getContext().getCacheDir(), "backup.tmp"); }

    @PluginMethod
    public void writeTemp(PluginCall call) {
        final String data = call.getString("data", "");
        final boolean append = Boolean.TRUE.equals(call.getBoolean("append", false));
        io.execute(() -> {
            try (OutputStream os = new FileOutputStream(tempBackup(), append)) {
                os.write(data.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                call.resolve();
            } catch (Exception e) {
                call.reject("The backup could not be prepared (is the phone full?).", e);
            }
        });
    }

    /** "Save as": the user picks where the backup goes (Downloads, Google Drive, a USB stick…). */
    @PluginMethod
    public void saveFile(PluginCall call) {
        if (!tempBackup().isFile()) { call.reject("Nothing to save."); return; }
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("application/json");
        i.putExtra(Intent.EXTRA_TITLE, call.getString("name", "backup.json"));
        startActivityForResult(call, i, "fileSaved");
    }

    @ActivityCallback
    private void fileSaved(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent intent = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || intent == null || intent.getData() == null) { tempBackup().delete(); call.reject("cancelled"); return; }
        final Uri uri = intent.getData();
        io.execute(() -> {
            File tmp = tempBackup();
            try (InputStream in = new java.io.FileInputStream(tmp); OutputStream os = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (os == null) throw new java.io.IOException("Cannot write there");
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                call.resolve();
            } catch (Exception e) {
                call.reject("The file could not be saved there.", e);
            } finally {
                tmp.delete();
            }
        });
    }

    private JSObject statusObject() {
        JSObject o = new JSObject();
        ScreenPresentation p = presentation;
        o.put("display", p != null);
        o.put("displayName", p != null ? p.getDisplay().getName() : "");
        ScreenServer sv = server;
        boolean lan = sv != null && sv.lanEnabled();
        o.put("server", lan);
        o.put("clients", lan ? sv.remoteCount() : 0);
        JSArray urls = new JSArray();
        if (lan) {
            try {
                for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                    if (!ni.isUp() || ni.isLoopback()) continue;
                    for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                        if (a instanceof Inet4Address && a.isSiteLocalAddress()) urls.put("http://" + a.getHostAddress() + ":" + sv.port());
                    }
                }
            } catch (Exception e) { /* no network: the list stays empty */ }
        }
        o.put("urls", urls);
        o.put("camera", sv != null && sv.cameraOnline());
        o.put("port", sv != null ? sv.port() : 0); // the operator's preview loads the live screen from here
        return o;
    }

    /** Show the output on an external display when there is one, and take it down when it goes. Main thread only. */
    private void syncPresentation() {
        Display[] found = displays.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION);
        Display target = found.length > 0 ? found[0] : null;
        if (presentation != null && (target == null || presentation.getDisplay().getDisplayId() != target.getDisplayId())) {
            try { presentation.dismiss(); } catch (Exception e) { /* the display is already gone */ }
            presentation = null;
        }
        if (presentation == null && target != null && getActivity() != null && !getActivity().isFinishing()) {
            try {
                String url = server != null ? "http://127.0.0.1:" + server.port() + "/?screen" : null;
                presentation = new ScreenPresentation(getActivity(), target, url, state);
                presentation.show();
            } catch (Exception e) {
                presentation = null; // the display went away before we could use it
            }
        }
        notifyListeners("status", statusObject());
    }

    @Override public void onDisplayAdded(int displayId) { syncPresentation(); }
    @Override public void onDisplayRemoved(int displayId) { syncPresentation(); }
    @Override public void onDisplayChanged(int displayId) { }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        main.post(this::syncPresentation);
    }

    @Override
    protected void handleOnDestroy() {
        displays.unregisterDisplayListener(this);
        if (presentation != null) { try { presentation.dismiss(); } catch (Exception e) { /* already gone */ } presentation = null; }
        if (server != null) { server.stop(); server = null; }
        io.shutdown();
        super.handleOnDestroy();
    }
}
