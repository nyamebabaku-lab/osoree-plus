package com.osoree.plus;

import android.app.Presentation;
import android.content.Context;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Display;
import android.view.ViewGroup;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * The clean output on a projector or TV connected by cable or wireless display.
 * It loads the output page from the phone's own screen server, so it shows exactly what Wi-Fi screens show,
 * including fonts, pictures and videos. If the server could not start, it falls back to the bundled page.
 */
public class ScreenPresentation extends Presentation {
    private final String url;
    private WebView web;
    private boolean ready = false;
    private String state;

    public ScreenPresentation(Context context, Display display, String url, String state) {
        super(context, display);
        this.url = url;
        this.state = state;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(getContext());
        web.setBackgroundColor(Color.BLACK);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setMediaPlaybackRequiresUserGesture(false); // videos start when the operator says so
        // Live video: the output page may use the phone's camera (the app asks the operator for permission first).
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                for (String r : request.getResources()) {
                    if (!PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) { request.deny(); return; }
                }
                request.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE });
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String loaded) {
                ready = true;
                if (url == null) render(state);
            }
        });
        setContentView(web, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.loadUrl(url != null ? url : "file:///android_asset/public/display.html?screen");
    }

    /** Only needed without the server. Main thread only. The state is JSON, which is also a valid JavaScript value. */
    public void render(String json) {
        state = json;
        if (url == null && ready && web != null && json != null) web.evaluateJavascript("window.osoreeRender(" + json + ")", null);
    }

    @Override
    public void onStop() {
        if (web != null) { web.loadUrl("about:blank"); web.destroy(); web = null; }
        super.onStop();
    }
}
