package org.ufagame.studio;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONObject;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;

public final class StudioActivity extends Activity {
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    WebView view = new WebView(this);
    view.getSettings().setJavaScriptEnabled(false);
    view.getSettings().setAllowFileAccess(false);
    view.getSettings().setAllowContentAccess(false);
    view.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView web, String url) { return true; }
    });
    String result;
    try (InputStream in = getAssets().open("contracts/capabilities.json")) {
      ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buffer = new byte[1024]; int n;
      while ((n=in.read(buffer))!=-1) out.write(buffer,0,n);
      JSONObject registry = new JSONObject(out.toString("UTF-8"));
      if (registry.getInt("api_version") != 1) throw new IllegalArgumentException();
      result = "Общий контракт v1 загружен. Возможностей: " + registry.getJSONArray("capabilities").length();
    } catch (Exception error) { result = "Ошибка встроенного контракта. Переустанови проверенную сборку."; }
    view.loadDataWithBaseURL("https://studio.ufagame.invalid/", "<meta name='viewport' content='width=device-width,initial-scale=1'><body style='font:18px sans-serif;padding:24px'><h1>Game Studio</h1><p>Техническая сборка S04</p><p>"+result+"</p><p>Редактор еще не реализован.</p></body>", "text/html", "UTF-8", null);
    setContentView(view);
  }
}
