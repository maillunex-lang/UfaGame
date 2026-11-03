package org.ufagame.studio;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import android.os.Build;
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
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Studio shell. No native JS bridge or broad file permissions. */
public final class StudioActivity extends Activity {
  private static final String STUDIO_URL = "https://tts-ufa.ru/game/studio/";
  private static final int PICK_ZIP=4101, SAVE_ZIP=4102;
  private static final long MAX_DOWNLOAD=32L*1024*1024;
  private WebView web;
  private ValueCallback<Uri[]> upload;
  private OwnerVault vault;
  private File pendingDownload;
  private boolean downloading;
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
    layout.setBackgroundColor(android.graphics.Color.rgb(242, 245, 240));
    getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
    if (Build.VERSION.SDK_INT >= 30) {
      getWindow().setDecorFitsSystemWindows(false);
      layout.setOnApplyWindowInsetsListener((view, insets) -> {
        android.graphics.Insets bars = insets.getInsets(
          WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
        android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
        view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
        return WindowInsets.CONSUMED;
      });
    }
    message = new TextView(this);
    message.setPadding(24, 24, 24, 24);
    message.setTextSize(18);
    retry = new Button(this);
    retry.setText("Повторить");
    retry.setOnClickListener(v -> openStudio());
    vault = new OwnerVault(this);
    if(state!=null) {
      String saved=state.getString("pending_export");
      if(saved!=null&&saved.matches("studio-export-[0-9]+\\.zip")) {
        File candidate=new File(getCacheDir(),saved);
        if(candidate.isFile())pendingDownload=candidate;
      }
    }
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
    web.setDownloadListener((url,userAgent,contentDisposition,mimeType,contentLength) -> {
      if(!DownloadPolicy.allows(url)||!(OriginPolicy.allows(web.getUrl())||DownloadPolicy.allows(web.getUrl()))) {
        Toast.makeText(this,"Загрузка с этого адреса запрещена",Toast.LENGTH_LONG).show();return;
      }
      startDownload(url);
    });
    web.setWebChromeClient(new WebChromeClient() {
      @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
        if(!OriginPolicy.allows(view.getUrl())) { callback.onReceiveValue(null); return true; }
        String[] allowed=PickerPolicy.allowed(params.getAcceptTypes());
        if(allowed.length==0){callback.onReceiveValue(null);Toast.makeText(StudioActivity.this,"Этот тип файла не поддерживается",Toast.LENGTH_LONG).show();return true;}
        if(upload!=null) upload.onReceiveValue(null);
        upload=callback;
        Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        if(allowed.length==1)intent.setType(allowed[0]);
        else {intent.setType("*/*");intent.putExtra(Intent.EXTRA_MIME_TYPES,allowed);}
        try { startActivityForResult(intent,PICK_ZIP); }
        catch(ActivityNotFoundException error) { upload=null; callback.onReceiveValue(null); Toast.makeText(StudioActivity.this,"Нет приложения для выбора файла",Toast.LENGTH_LONG).show(); }
        return true;
      }
    });
    web.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        return !OriginPolicy.allows(request.getUrl().toString()) && !DownloadPolicy.allows(request.getUrl().toString());
      }
      @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
        return !OriginPolicy.allows(url) && !DownloadPolicy.allows(url);
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
    if (Build.VERSION.SDK_INT >= 30) {
      WindowInsetsController controller = getWindow().getInsetsController();
      if (controller != null) {
        int lightBars = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS |
          WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
        controller.setSystemBarsAppearance(lightBars, lightBars);
      }
      layout.requestApplyInsets();
    }
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
  private void startDownload(String url) {
    if(downloading||pendingDownload!=null){Toast.makeText(this,"Дождись окончания загрузки",Toast.LENGTH_SHORT).show();return;}
    downloading=true;
    final String cookies=CookieManager.getInstance().getCookie(url);
    new Thread(() -> {
      File temp=null;
      try {
        HttpsURLConnection conn=(HttpsURLConnection)new URL(url).openConnection();
        try {
          conn.setInstanceFollowRedirects(false);conn.setConnectTimeout(10000);conn.setReadTimeout(15000);
          if(cookies!=null)conn.setRequestProperty("Cookie",cookies);
          if(conn.getResponseCode()!=200)throw new IllegalStateException("Download failed");
          String type=conn.getContentType();
          if(type==null||!(type.toLowerCase(java.util.Locale.ROOT).startsWith("application/zip")||type.toLowerCase(java.util.Locale.ROOT).startsWith("application/octet-stream")))throw new IllegalStateException("Invalid type");
          long length=conn.getContentLengthLong();if(length>MAX_DOWNLOAD)throw new IllegalStateException("File too large");
          temp=File.createTempFile("studio-export-", ".zip",getCacheDir());
          try(InputStream in=conn.getInputStream();FileOutputStream out=new FileOutputStream(temp)) {
            byte[] buf=new byte[16384];int n;long count=0,started=System.nanoTime();
            while((n=in.read(buf))!=-1){count+=n;if(count>MAX_DOWNLOAD||System.nanoTime()-started>120_000_000_000L)throw new IllegalStateException("Download limit");out.write(buf,0,n);}
            if(length>=0&&count!=length)throw new IllegalStateException("Incomplete download");out.getFD().sync();
          }
          try(InputStream in=new FileInputStream(temp)) {
            int a=in.read(),b=in.read(),c=in.read(),d=in.read();
            if(a!=0x50||b!=0x4b||!((c==3&&d==4)||(c==5&&d==6)))throw new IllegalStateException("Invalid ZIP");
          }
        } finally {conn.disconnect();}
        final File ready=temp;temp=null;
        runOnUiThread(() -> {
          downloading=false;
          if(isFinishing()||isDestroyed()){ready.delete();return;}
          pendingDownload=ready;
          Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);
          intent.setType("application/zip");intent.putExtra(Intent.EXTRA_TITLE,"UfaGame-export.zip");
          try{startActivityForResult(intent,SAVE_ZIP);}
          catch(ActivityNotFoundException error){pendingDownload=null;ready.delete();Toast.makeText(this,"Нет приложения для сохранения файла",Toast.LENGTH_LONG).show();}
        });
      } catch(Exception error) {
        if(temp!=null)temp.delete();
        runOnUiThread(() -> {downloading=false;if(!isFinishing()&&!isDestroyed())Toast.makeText(this,"Не удалось загрузить файл",Toast.LENGTH_LONG).show();});
      }
    }).start();
  }
  private void saveDownloaded(Uri uri) {
    final File ready=pendingDownload;pendingDownload=null;
    if(ready==null)return;
    if(uri==null||!"content".equals(uri.getScheme())){ready.delete();return;}
    new Thread(() -> {
      boolean success=false;
      try(InputStream in=new FileInputStream(ready);OutputStream out=getContentResolver().openOutputStream(uri,"w")) {
        if(out==null)throw new IllegalStateException("No output");
        byte[] buf=new byte[16384];int n;while((n=in.read(buf))!=-1)out.write(buf,0,n);out.flush();success=true;
      } catch(Exception error) { /* Keep user-selected destination; do not delete existing files. */ }
      finally {ready.delete();}
      final boolean done=success;
      runOnUiThread(() -> {if(!isFinishing()&&!isDestroyed())Toast.makeText(this,done?"Файл сохранён":"Не удалось полностью сохранить файл",Toast.LENGTH_LONG).show();});
    }).start();
  }
  @Override protected void onActivityResult(int requestCode,int resultCode,Intent data) {
    super.onActivityResult(requestCode,resultCode,data);
    if(requestCode==SAVE_ZIP){saveDownloaded(resultCode==RESULT_OK&&data!=null?data.getData():null);return;}
    if(requestCode!=PICK_ZIP||upload==null)return;
    ValueCallback<Uri[]> callback=upload;upload=null;
    Uri uri=data==null?null:data.getData();
    callback.onReceiveValue(resultCode==RESULT_OK&&uri!=null&&"content".equals(uri.getScheme())&&OriginPolicy.allows(web.getUrl())?new Uri[]{uri}:null);
  }
  @Override public void onBackPressed() {
    if (web.canGoBack()) web.goBack(); else super.onBackPressed();
  }
  @Override protected void onSaveInstanceState(Bundle out) {
    if(pendingDownload!=null)out.putString("pending_export",pendingDownload.getName());
    super.onSaveInstanceState(out);
  }
  @Override protected void onDestroy() { if(upload!=null){upload.onReceiveValue(null);upload=null;} if(pendingDownload!=null&&!isChangingConfigurations()){pendingDownload.delete();pendingDownload=null;} web.destroy(); super.onDestroy(); }
}
