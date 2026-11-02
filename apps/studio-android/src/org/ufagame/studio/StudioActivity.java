package org.ufagame.studio;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Preliminary S09 phone-check shell. No native JS bridge or file permissions. */
public final class StudioActivity extends Activity {
  private static final String STUDIO_URL = "https://tts-ufa.ru/game/studio/";
  private WebView web;
  private TextView message;
  private Button retry;
  private void failed() {
    web.setVisibility(View.GONE);
    message.setText("Не удалось открыть Studio. Проверь интернет и дождись настройки тестового сервера.");
    message.setVisibility(View.VISIBLE);
    retry.setVisibility(View.VISIBLE);
  }
  private void openStudio() {
    message.setText("Открываем Studio…");
    message.setVisibility(View.VISIBLE);
    retry.setVisibility(View.GONE);
    web.setVisibility(View.GONE);
    web.loadUrl(STUDIO_URL);
  }
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    LinearLayout layout = new LinearLayout(this);
    layout.setOrientation(LinearLayout.VERTICAL);
    message = new TextView(this);
    message.setPadding(24, 24, 24, 24);
    message.setTextSize(18);
    retry = new Button(this);
    retry.setText("Повторить");
    retry.setOnClickListener(v -> openStudio());
    web = new WebView(this);
    web.getSettings().setJavaScriptEnabled(true);
    web.getSettings().setDomStorageEnabled(true);
    web.getSettings().setAllowFileAccess(false);
    web.getSettings().setAllowContentAccess(false);
    web.getSettings().setGeolocationEnabled(false);
    web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    web.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        return !OriginPolicy.allows(request.getUrl().toString());
      }
      @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
        return !OriginPolicy.allows(url);
      }
      @Override public void onPageFinished(WebView view, String url) {
        if (OriginPolicy.allows(url) && retry.getVisibility() != View.VISIBLE) {
          message.setVisibility(View.GONE);
          view.setVisibility(View.VISIBLE);
        }
      }
      @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request.isForMainFrame()) failed();
      }
      @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
        if (request.isForMainFrame() && response.getStatusCode() >= 400) failed();
      }
    });
    layout.addView(message);
    layout.addView(retry);
    layout.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
    setContentView(layout);
    openStudio();
  }
  @Override public void onBackPressed() {
    if (web.canGoBack()) web.goBack(); else super.onBackPressed();
  }
  @Override protected void onDestroy() { web.destroy(); super.onDestroy(); }
}
