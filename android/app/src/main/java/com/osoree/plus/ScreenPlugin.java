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

import com.osoree.plus.stream.RtmpPublisher;
import com.osoree.plus.stream.StreamEngine;

/**
 * Sends what the operator chooses to the outputs a phone can reach without internet:
 * a projector or TV on a cable or wireless display, and browsers on the same Wi-Fi or hotspot.
 * Also keeps the church's pictures and videos in the app's own storage.
 */
@CapacitorPlugin(name = "Screen", permissions = {
    @Permission(strings = { android.Manifest.permission.CAMERA }, alias = "camera"),
    @Permission(strings = { android.Manifest.permission.RECORD_AUDIO }, alias = "microphone"),
    @Permission(strings = { "android.permission.POST_NOTIFICATIONS" }, alias = "notifications")
})
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

    /** Opens a web page in the phone's browser (payment checkout). */
    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.startsWith("https://")) { call.reject("Bad address."); return; }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("No web browser was found on this phone.");
        }
    }

    /** This phone's Android ID: the same after reinstalling the app, new only after a factory reset. Used for licences. */
    @PluginMethod
    public void getDeviceId(PluginCall call) {
        String id = Settings.Secure.getString(getContext().getContentResolver(), Settings.Secure.ANDROID_ID);
        JSObject r = new JSObject();
        r.put("id", id == null ? "" : id);
        String maker = android.os.Build.MANUFACTURER == null ? "" : android.os.Build.MANUFACTURER;
        String model = android.os.Build.MODEL == null ? "" : android.os.Build.MODEL;
        r.put("model", model.toLowerCase().startsWith(maker.toLowerCase()) ? model : (maker.isEmpty() ? model : Character.toUpperCase(maker.charAt(0)) + maker.substring(1) + " " + model));
        r.put("os", "Android " + android.os.Build.VERSION.RELEASE);
        try { // the SIM card's country (no permission needed): one of the checks for Ghana prices
            android.telephony.TelephonyManager tm = (android.telephony.TelephonyManager) getContext().getSystemService(Context.TELEPHONY_SERVICE);
            r.put("sim", tm != null && tm.getSimCountryIso() != null ? tm.getSimCountryIso().toUpperCase() : "");
        } catch (Exception e) { r.put("sim", ""); }
        call.resolve(r);
    }

    /** Updates: download the new APK (progress as "update" events), then open Android's Install screen. */
    @PluginMethod
    public void installUpdate(PluginCall call) {
        final String url = call.getString("url", "");
        if (!url.startsWith("https://")) { call.reject("Bad address."); return; }
        if (android.os.Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent allow = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            allow.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(allow);
            call.reject("Allow Ɔsɔreɛ Plus to install updates (switch it on), then come back and tap Update again.");
            return;
        }
        io.execute(() -> {
            File out = new File(getContext().getCacheDir(), "update.apk");
            try {
                java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                c.setInstanceFollowRedirects(true); c.setConnectTimeout(15000); c.setReadTimeout(30000);
                if (c.getResponseCode() != 200) throw new java.io.IOException("HTTP " + c.getResponseCode());
                long total = c.getContentLengthLong(), got = 0, lastSent = 0;
                try (java.io.InputStream in = c.getInputStream(); OutputStream os = new FileOutputStream(out)) {
                    byte[] buf = new byte[65536]; int n;
                    while ((n = in.read(buf)) > 0) {
                        os.write(buf, 0, n); got += n;
                        if (got - lastSent > 512 * 1024) { lastSent = got; JSObject p = new JSObject(); p.put("received", got); p.put("total", total); notifyListeners("update", p); }
                    }
                }
                Uri apk = androidx.core.content.FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", out);
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(apk, "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                call.resolve();
            } catch (Exception e) {
                out.delete();
                call.reject("The update did not download. Check the internet and try again.", e);
            }
        });
    }

    // ------------------------------------------------------------------ live streaming (YouTube, Facebook…)

    private final StreamEngine stream = new StreamEngine();

    @PluginMethod
    public void requestMicrophone(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) { JSObject r = new JSObject(); r.put("granted", true); call.resolve(r); return; }
        requestPermissionForAlias("microphone", call, "microphoneAnswered");
    }

    // ------------------------------------------------------------------ scripture listener
    // Continuous speech recognition (offline engine when the phone has one). Each result goes to the app as a
    // "speech" event; the app spots Bible references and asks the operator before showing anything.
    private android.speech.SpeechRecognizer recognizer;
    private boolean listening = false;
    private String listenLang = "en-US";
    private int mutedSystem = -1;

    private void quietBeep(boolean quiet) {
        android.media.AudioManager am = (android.media.AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        try {
            if (quiet && mutedSystem < 0) { mutedSystem = am.getStreamVolume(android.media.AudioManager.STREAM_SYSTEM); am.setStreamVolume(android.media.AudioManager.STREAM_SYSTEM, 0, 0); }
            else if (!quiet && mutedSystem >= 0) { am.setStreamVolume(android.media.AudioManager.STREAM_SYSTEM, mutedSystem, 0); mutedSystem = -1; }
        } catch (Exception ignored) { /* do-not-disturb rules: leave the volume alone */ }
    }

    private void listenOnce() {
        if (!listening) return;
        if (recognizer == null) {
            Context ctx = getContext();
            if (android.os.Build.VERSION.SDK_INT >= 31 && android.speech.SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx)) recognizer = android.speech.SpeechRecognizer.createOnDeviceSpeechRecognizer(ctx);
            else recognizer = android.speech.SpeechRecognizer.createSpeechRecognizer(ctx);
            recognizer.setRecognitionListener(new android.speech.RecognitionListener() {
                public void onReadyForSpeech(android.os.Bundle b) { emitListen("listening", null); }
                public void onBeginningOfSpeech() {}
                public void onRmsChanged(float v) {}
                public void onBufferReceived(byte[] b) {}
                public void onEndOfSpeech() {}
                public void onError(int error) {
                    if (!listening) return;
                    if (error == android.speech.SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) { emitListen("error", "Allow the microphone to listen for scriptures."); stopAll(); return; }
                    if (error == 13 /* LANGUAGE_NOT_SUPPORTED */ || error == 12 /* LANGUAGE_UNAVAILABLE */) { emitListen("error", "This phone has no offline English speech pack. Connect to the internet, or add English in Settings → Google → Speech."); }
                    main.postDelayed(ScreenPlugin.this::listenOnce, error == android.speech.SpeechRecognizer.ERROR_RECOGNIZER_BUSY ? 800 : 250);
                }
                public void onResults(android.os.Bundle b) { emitText(b, true); main.postDelayed(ScreenPlugin.this::listenOnce, 100); }
                public void onPartialResults(android.os.Bundle b) { emitText(b, false); }
                public void onEvent(int t, android.os.Bundle b) {}
            });
        }
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, listenLang);
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500);
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2000);
        try { recognizer.startListening(i); } catch (Exception e) { main.postDelayed(this::listenOnce, 1000); }
    }

    private void emitText(android.os.Bundle b, boolean fin) {
        java.util.ArrayList<String> list = b.getStringArrayList(android.speech.SpeechRecognizer.RESULTS_RECOGNITION);
        if (list == null || list.isEmpty()) return;
        JSObject r = new JSObject();
        r.put("text", list.get(0));
        r.put("alternatives", new JSArray(list));
        r.put("final", fin);
        notifyListeners("speech", r);
    }

    private void emitListen(String state, String message) {
        JSObject r = new JSObject();
        r.put("state", state);
        if (message != null) r.put("message", message);
        notifyListeners("listen", r);
    }

    private void stopAll() {
        listening = false;
        if (recognizer != null) { try { recognizer.cancel(); recognizer.destroy(); } catch (Exception ignored) { } recognizer = null; }
        quietBeep(false);
        emitListen("off", null);
    }

    @PluginMethod
    public void startListening(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) { call.reject("Allow the microphone first."); return; }
        if (!android.speech.SpeechRecognizer.isRecognitionAvailable(getContext())) { call.reject("This phone has no speech recognition. Install or update the Google app."); return; }
        listenLang = call.getString("lang", "en-US");
        main.post(() -> { listening = true; quietBeep(true); listenOnce(); call.resolve(); });
    }

    @PluginMethod
    public void stopListening(PluginCall call) { main.post(() -> { stopAll(); call.resolve(); }); }

    /** A soft nudge for the operator: a short vibration and, if wanted, a quiet tone. */
    @PluginMethod
    public void buzz(PluginCall call) {
        try {
            android.os.Vibrator v = (android.os.Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                if (android.os.Build.VERSION.SDK_INT >= 26) v.vibrate(android.os.VibrationEffect.createWaveform(new long[] { 0, 60, 90, 60 }, -1)); else v.vibrate(120);
            }
            if (call.getBoolean("sound", false)) {
                android.media.ToneGenerator tg = new android.media.ToneGenerator(android.media.AudioManager.STREAM_NOTIFICATION, 35);
                tg.startTone(android.media.ToneGenerator.TONE_PROP_BEEP2, 160);
                main.postDelayed(tg::release, 400);
            }
        } catch (Exception ignored) { }
        call.resolve();
    }

    // ------------------------------------------------------------------ Google Play billing
    // Used only when the app came from the Play Store (Google's rules); the APK from our website keeps MoMo.
    private com.android.billingclient.api.BillingClient billing;
    private PluginCall buyCall;

    @PluginMethod
    public void playAvailable(PluginCall call) {
        String installer = null;
        try {
            if (android.os.Build.VERSION.SDK_INT >= 30) installer = getContext().getPackageManager().getInstallSourceInfo(getContext().getPackageName()).getInstallingPackageName();
            else installer = getContext().getPackageManager().getInstallerPackageName(getContext().getPackageName());
        } catch (Exception ignored) { }
        JSObject r = new JSObject();
        r.put("play", "com.android.vending".equals(installer));
        call.resolve(r);
    }

    private void withBilling(PluginCall call, Runnable then) {
        if (billing != null && billing.isReady()) { then.run(); return; }
        billing = com.android.billingclient.api.BillingClient.newBuilder(getContext())
            .enablePendingPurchases(com.android.billingclient.api.PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .setListener((result, purchases) -> {
                PluginCall c = buyCall; buyCall = null;
                if (c == null) return;
                if (result.getResponseCode() == com.android.billingclient.api.BillingClient.BillingResponseCode.USER_CANCELED) { c.reject("cancelled"); return; }
                if (result.getResponseCode() != com.android.billingclient.api.BillingClient.BillingResponseCode.OK || purchases == null || purchases.isEmpty()) { c.reject("The purchase did not finish (" + result.getDebugMessage() + ")."); return; }
                com.android.billingclient.api.Purchase p = purchases.get(0);
                if (p.getPurchaseState() == com.android.billingclient.api.Purchase.PurchaseState.PENDING) { c.reject("The payment is pending. Pro switches on once Google confirms it."); return; }
                c.resolve(purchaseObject(p));
            }).build();
        billing.startConnection(new com.android.billingclient.api.BillingClientStateListener() {
            public void onBillingSetupFinished(com.android.billingclient.api.BillingResult r) {
                if (r.getResponseCode() == com.android.billingclient.api.BillingClient.BillingResponseCode.OK) then.run(); else call.reject("Google Play is not available: " + r.getDebugMessage());
            }
            public void onBillingServiceDisconnected() { billing = null; }
        });
    }

    private JSObject purchaseObject(com.android.billingclient.api.Purchase p) {
        JSObject o = new JSObject();
        o.put("productId", p.getProducts().isEmpty() ? "" : p.getProducts().get(0));
        o.put("token", p.getPurchaseToken());
        o.put("orderId", p.getOrderId());
        return o;
    }

    private java.util.List<com.android.billingclient.api.QueryProductDetailsParams.Product> productList(JSArray ids) throws Exception {
        java.util.List<com.android.billingclient.api.QueryProductDetailsParams.Product> list = new ArrayList<>();
        for (int i = 0; i < ids.length(); i++) list.add(com.android.billingclient.api.QueryProductDetailsParams.Product.newBuilder().setProductId(ids.getString(i)).setProductType(com.android.billingclient.api.BillingClient.ProductType.INAPP).build());
        return list;
    }

    @PluginMethod
    public void playProducts(PluginCall call) {
        JSArray ids = call.getArray("ids", new JSArray());
        withBilling(call, () -> {
            try {
                billing.queryProductDetailsAsync(com.android.billingclient.api.QueryProductDetailsParams.newBuilder().setProductList(productList(ids)).build(), (r, details) -> {
                    JSArray out = new JSArray();
                    for (com.android.billingclient.api.ProductDetails d : details) {
                        JSObject o = new JSObject();
                        o.put("id", d.getProductId()); o.put("title", d.getName());
                        o.put("price", d.getOneTimePurchaseOfferDetails() != null ? d.getOneTimePurchaseOfferDetails().getFormattedPrice() : "");
                        out.put(o);
                    }
                    JSObject res = new JSObject(); res.put("products", out); call.resolve(res);
                });
            } catch (Exception e) { call.reject("Google Play did not answer."); }
        });
    }

    @PluginMethod
    public void playBuy(PluginCall call) {
        String id = call.getString("id", "");
        String account = call.getString("account", "");
        withBilling(call, () -> {
            try {
                JSArray one = new JSArray(); one.put(id);
                billing.queryProductDetailsAsync(com.android.billingclient.api.QueryProductDetailsParams.newBuilder().setProductList(productList(one)).build(), (r, details) -> {
                    if (details.isEmpty()) { call.reject("This product is not in Google Play yet."); return; }
                    com.android.billingclient.api.BillingFlowParams.Builder b = com.android.billingclient.api.BillingFlowParams.newBuilder()
                        .setProductDetailsParamsList(java.util.Collections.singletonList(com.android.billingclient.api.BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(details.get(0)).build()));
                    if (!account.isEmpty()) b.setObfuscatedAccountId(account);
                    buyCall = call;
                    main.post(() -> billing.launchBillingFlow(getActivity(), b.build()));
                });
            } catch (Exception e) { call.reject("Google Play did not answer."); }
        });
    }

    @PluginMethod
    public void playRestore(PluginCall call) {
        withBilling(call, () -> billing.queryPurchasesAsync(
            com.android.billingclient.api.QueryPurchasesParams.newBuilder().setProductType(com.android.billingclient.api.BillingClient.ProductType.INAPP).build(),
            (r, purchases) -> {
                JSArray out = new JSArray();
                for (com.android.billingclient.api.Purchase p : purchases) if (p.getPurchaseState() == com.android.billingclient.api.Purchase.PurchaseState.PURCHASED) out.put(purchaseObject(p));
                JSObject res = new JSObject(); res.put("purchases", out); call.resolve(res);
            }));
    }

    // ------------------------------------------------------------------ notifications
    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (android.os.Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) { JSObject r = new JSObject(); r.put("granted", true); call.resolve(r); return; }
        requestPermissionForAlias("notifications", call, "notificationsAnswered");
    }

    @PermissionCallback
    private void notificationsAnswered(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(r);
    }

    @PluginMethod
    public void notify(PluginCall call) {
        Context ctx = getContext();
        android.app.NotificationManager nm = (android.app.NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        String channel = call.getString("channel", "updates");
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            boolean urgent = "scripture".equals(channel);
            android.app.NotificationChannel ch = new android.app.NotificationChannel(channel, urgent ? "Scriptures heard" : "Pro and store updates",
                urgent ? android.app.NotificationManager.IMPORTANCE_HIGH : android.app.NotificationManager.IMPORTANCE_DEFAULT);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        android.app.PendingIntent pi = android.app.PendingIntent.getActivity(ctx, 0, open, android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_UPDATE_CURRENT);
        androidx.core.app.NotificationCompat.Builder b = new androidx.core.app.NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(ctx.getApplicationInfo().icon)
            .setContentTitle(call.getString("title", "Ɔsɔreɛ Plus"))
            .setContentText(call.getString("body", ""))
            .setStyle(new androidx.core.app.NotificationCompat.BigTextStyle().bigText(call.getString("body", "")))
            .setAutoCancel(true)
            .setContentIntent(pi);
        try { nm.notify(call.getInt("id", 1), b.build()); } catch (SecurityException e) { /* notifications not allowed */ }
        call.resolve();
    }

    @PermissionCallback
    private void microphoneAnswered(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", getPermissionState("microphone") == PermissionState.GRANTED);
        call.resolve(r);
    }

    /** Sound inputs: the phone's microphone and anything plugged in (USB sound card from the mixer, cable). */
    @PluginMethod
    public void audioInputs(PluginCall call) {
        android.media.AudioManager am = (android.media.AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        JSArray list = new JSArray();
        for (android.media.AudioDeviceInfo d : am.getDevices(android.media.AudioManager.GET_DEVICES_INPUTS)) {
            if (d.getType() == android.media.AudioDeviceInfo.TYPE_TELEPHONY || d.getType() == android.media.AudioDeviceInfo.TYPE_FM_TUNER) continue;
            JSObject o = new JSObject();
            o.put("id", d.getId());
            o.put("name", StreamEngine.describe(d));
            list.put(o);
        }
        JSObject r = new JSObject();
        r.put("inputs", list);
        call.resolve(r);
    }

    @PluginMethod
    public void streamStart(PluginCall call) {
        if (server == null) { call.reject("Streaming needs the screen server, which could not start on this phone."); return; }
        if (getPermissionState("microphone") != PermissionState.GRANTED) { call.reject("Allow the microphone first."); return; }
        try {
            java.util.List<StreamEngine.Target> targets = new java.util.ArrayList<>();
            JSArray arr = call.getArray("targets");
            for (int k = 0; arr != null && k < arr.length(); k++) {
                org.json.JSONObject t = arr.getJSONObject(k);
                targets.add(new StreamEngine.Target(t.optString("name", "Stream " + (k + 1)), t.optString("url", ""), t.optString("key", "")));
            }
            int w = call.getInt("width", 1280), h = call.getInt("height", 720);
            String page = "http://127.0.0.1:" + server.port() + "/?stream";
            stream.start(getActivity(), page, w, h, call.getInt("fps", 30), call.getInt("bitrate", 2_500_000), call.getInt("audioInput", -1), Boolean.TRUE.equals(call.getBoolean("stereo", true)), targets);
            call.resolve(streamStatusObject());
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "The stream could not start.");
        }
    }

    @PluginMethod
    public void streamStop(PluginCall call) {
        stream.stop();
        call.resolve(streamStatusObject());
    }

    @PluginMethod
    public void streamStatus(PluginCall call) { call.resolve(streamStatusObject()); }

    private final java.util.Map<String, long[]> lastBytes = new java.util.HashMap<>();

    private JSObject streamStatusObject() {
        JSObject o = new JSObject();
        o.put("running", stream.isRunning());
        o.put("level", stream.level);
        o.put("audioInput", stream.audioInputName);
        JSArray list = new JSArray();
        long now = System.currentTimeMillis();
        for (RtmpPublisher p : stream.publishers()) {
            JSObject t = new JSObject();
            t.put("name", p.name);
            t.put("state", p.state);
            t.put("message", p.message);
            t.put("uptime", p.uptimeMs());
            t.put("dropped", p.droppedFrames);
            long[] prev = lastBytes.get(p.name);
            long kbps = prev != null && now > prev[1] ? (p.bytesSent - prev[0]) * 8 / Math.max(1, now - prev[1]) : 0;
            lastBytes.put(p.name, new long[] { p.bytesSent, now });
            t.put("kbps", kbps);
            list.put(t);
        }
        o.put("targets", list);
        return o;
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
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "image/*", "video/*", "application/pdf",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-powerpoint", "application/msword", "application/vnd.ms-excel",
            "text/csv", "text/comma-separated-values", "text/plain" });
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
                    String lower = name.toLowerCase();
                    if (lower.matches(".*\\.(pptx|docx|xlsx|csv|txt|ppt|doc|xls|pps|odp|odt|ods|rtf)$")) {
                        // Office files are converted to pages by the app itself: hand over a private copy.
                        String id = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
                        File out = new File(mediaDir, id + lower.substring(lower.lastIndexOf('.')));
                        long size = 0;
                        try (InputStream in = cr.openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
                            if (in == null) continue;
                            byte[] buf = new byte[64 * 1024];
                            int n;
                            while ((n = in.read(buf)) > 0) { os.write(buf, 0, n); size += n; }
                        }
                        JSObject o = new JSObject();
                        o.put("id", id); o.put("name", name); o.put("type", type == null ? "" : type);
                        o.put("path", out.getAbsolutePath()); o.put("size", size); o.put("office", true);
                        items.put(o);
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

    /** One converted page (JPEG, base64) of a PowerPoint/Word/Excel file: saved as files/media/<id>/p<n>.jpg. */
    @PluginMethod
    public void saveMediaPage(PluginCall call) {
        final String id = call.getString("id", ""), data = call.getString("data", "");
        final int n = call.getInt("n", 1);
        if (!id.matches("[A-Za-z0-9]+") || data.isEmpty()) { call.reject("Bad page."); return; }
        io.execute(() -> {
            try {
                File dir = new File(mediaDir, id);
                dir.mkdirs();
                File out = new File(dir, "p" + n + ".jpg");
                try (OutputStream os = new FileOutputStream(out)) { os.write(android.util.Base64.decode(data, android.util.Base64.DEFAULT)); }
                JSObject r = new JSObject();
                r.put("path", out.getAbsolutePath());
                call.resolve(r);
            } catch (Exception e) {
                call.reject("The page could not be saved (is the phone full?).", e);
            }
        });
    }

    /** Store backgrounds: download straight to the media folder (big videos never pass through the WebView). */
    @PluginMethod
    public void downloadMedia(PluginCall call) {
        final String url = call.getString("url", ""), id = call.getString("id", ""), ext = call.getString("ext", "jpg");
        if (!url.startsWith("https://") || !id.matches("[A-Za-z0-9]+") || !ext.matches("jpg|png|mp4")) { call.reject("Bad download."); return; }
        io.execute(() -> {
            File out = new File(mediaDir, id + "." + ext);
            try {
                mediaDir.mkdirs();
                java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                c.setConnectTimeout(15000); c.setReadTimeout(30000);
                if (c.getResponseCode() != 200) throw new java.io.IOException("HTTP " + c.getResponseCode());
                try (java.io.InputStream in = c.getInputStream(); OutputStream os = new FileOutputStream(out)) {
                    byte[] buf = new byte[65536]; int n;
                    while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                }
                JSObject r = new JSObject();
                r.put("path", out.getAbsolutePath());
                r.put("size", out.length());
                call.resolve(r);
            } catch (Exception e) {
                out.delete();
                call.reject("The download did not finish. Check the internet and try again.", e);
            }
        });
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
        stopAll();
        stream.stop();
        displays.unregisterDisplayListener(this);
        if (presentation != null) { try { presentation.dismiss(); } catch (Exception e) { /* already gone */ } presentation = null; }
        if (server != null) { server.stop(); server = null; }
        io.shutdown();
        super.handleOnDestroy();
    }
}
