package org.ufagame.studio;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.text.InputType;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.Toast;
import org.json.JSONObject;
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
  private static final int PICK_ZIP=4101;
  private WebView web;
  private ValueCallback<Uri[]> upload;
  private OwnerVault vault;
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
    vault = new OwnerVault(this);
    Button savedLogin = new Button(this);
    savedLogin.setText("Войти с сохранением пароля");
    savedLogin.setOnClickListener(v -> showOwnerLogin());
    web = new WebView(this);
    web.getSettings().setJavaScriptEnabled(true);
    web.getSettings().setDomStorageEnabled(true);
    web.getSettings().setAllowFileAccess(false);
    web.getSettings().setAllowContentAccess(false);
    web.getSettings().setGeolocationEnabled(false);
    web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    web.setWebChromeClient(new WebChromeClient() {
      @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
        if(!OriginPolicy.allows(view.getUrl())) { callback.onReceiveValue(null); return true; }
        if(upload!=null) upload.onReceiveValue(null);
        upload=callback;
        Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/zip");
        try { startActivityForResult(intent,PICK_ZIP); }
        catch(ActivityNotFoundException error) { upload=null; callback.onReceiveValue(null); Toast.makeText(StudioActivity.this,"Нет приложения для выбора файла",Toast.LENGTH_LONG).show(); }
        return true;
      }
    });
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
    layout.addView(savedLogin);
    layout.addView(message);
    layout.addView(retry);
    layout.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
    setContentView(layout);
    openStudio();
  }
  private void showOwnerLogin() {
    LinearLayout form=new LinearLayout(this);form.setOrientation(LinearLayout.VERTICAL);form.setPadding(32,8,32,8);
    EditText username=new EditText(this);username.setHint("Логин");username.setSingleLine(true);
    EditText password=new EditText(this);password.setHint("Пароль");password.setSingleLine(true);
    password.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);
    CheckBox remember=new CheckBox(this);remember.setText("Сохранить пароль на этом устройстве");
    if(vault.hasSaved()) {
      try {JSONObject saved=vault.load();username.setText(saved.getString("login"));password.setText(saved.getString("password"));remember.setChecked(true);}
      catch(Exception error) {Toast.makeText(this,"Не удалось открыть сохранённые данные. Введи пароль заново.",Toast.LENGTH_LONG).show();}
    }
    form.addView(username);form.addView(password);form.addView(remember);
    AlertDialog dialog=new AlertDialog.Builder(this).setTitle("Вход владельца").setView(form)
      .setNegativeButton("Отмена",(d,w)->password.setText(""))
      .setNeutralButton("Удалить сохранённый пароль",(d,w)->{
        try {vault.forget();password.setText("");Toast.makeText(this,"Сохранённые данные удалены",Toast.LENGTH_SHORT).show();}
        catch(Exception error){Toast.makeText(this,"Не удалось удалить сохранённые данные",Toast.LENGTH_LONG).show();}
      }).setPositiveButton("Войти",null).create();
    dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
      final String name=username.getText().toString(), secret=password.getText().toString();
      if(name.isEmpty()||secret.isEmpty()){password.setError("Введи логин и пароль");return;}
      final boolean save=remember.isChecked();dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
      new Thread(() -> {
        try {
          String cookie=OwnerLogin.login(name,secret);
          boolean storageOk=true;
          try {if(save)vault.save(name,secret);else vault.forget();}catch(Exception error){storageOk=false;}
          final boolean stored=storageOk;
          runOnUiThread(() -> {
            if(isFinishing()||isDestroyed())return;
            CookieManager cookies=CookieManager.getInstance();
            cookies.setCookie(OwnerLogin.SESSION_URL,cookie,success -> {
              if(!Boolean.TRUE.equals(success)){dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);Toast.makeText(this,"Не удалось сохранить сессию",Toast.LENGTH_LONG).show();return;}
              cookies.flush();password.setText("");dialog.dismiss();
              if(!stored)Toast.makeText(this,"Вход выполнен, но изменить сохранённый пароль не удалось",Toast.LENGTH_LONG).show();
              openStudio();
            });
          });
        } catch(Exception error) {runOnUiThread(() -> {
          if(isFinishing()||isDestroyed())return;
          dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
          Toast.makeText(this,"Не удалось войти. Проверь данные и подключение.",Toast.LENGTH_LONG).show();
        });}
      }).start();
    }));
    dialog.show();
  }
  @Override protected void onActivityResult(int requestCode,int resultCode,Intent data) {
    super.onActivityResult(requestCode,resultCode,data);
    if(requestCode!=PICK_ZIP||upload==null)return;
    ValueCallback<Uri[]> callback=upload;upload=null;
    Uri uri=data==null?null:data.getData();
    callback.onReceiveValue(resultCode==RESULT_OK&&uri!=null&&"content".equals(uri.getScheme())&&OriginPolicy.allows(web.getUrl())?new Uri[]{uri}:null);
  }
  @Override public void onBackPressed() {
    if (web.canGoBack()) web.goBack(); else super.onBackPressed();
  }
  @Override protected void onDestroy() { if(upload!=null){upload.onReceiveValue(null);upload=null;} web.destroy(); super.onDestroy(); }
}
