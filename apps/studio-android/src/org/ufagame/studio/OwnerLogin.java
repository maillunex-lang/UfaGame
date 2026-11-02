package org.ufagame.studio;

import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.json.JSONObject;

/** HTTPS login without redirects, custom trust managers, or logging secrets. */
final class OwnerLogin {
  static final String ORIGIN="https://tts-ufa.ru";
  static final String SESSION_URL=ORIGIN+"/game/server/admin/v1/sessions";
  static String login(String username,String password) throws Exception {
    HttpsURLConnection connection=(HttpsURLConnection)new URL(SESSION_URL).openConnection();
    try {
      connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(10000);connection.setReadTimeout(10000);
      connection.setRequestMethod("POST");connection.setDoOutput(true);
      connection.setRequestProperty("Origin",ORIGIN);connection.setRequestProperty("Content-Type","application/json");
      byte[] body=new JSONObject().put("login",username).put("password",password).toString().getBytes(StandardCharsets.UTF_8);
      connection.setFixedLengthStreamingMode(body.length);
      try(java.io.OutputStream output=connection.getOutputStream()){output.write(body);}
      if(connection.getResponseCode()!=200)throw new IllegalStateException("Login failed");
      String cookie=null;
      for(Map.Entry<String,List<String>> entry:connection.getHeaderFields().entrySet()) {
        if(entry.getKey()!=null&&entry.getKey().equalsIgnoreCase("Set-Cookie"))for(String header:entry.getValue()) {
          if(header.startsWith("__Secure-ufagame-owner=")) {if(cookie!=null)throw new IllegalStateException("Ambiguous cookie");cookie=header;}
        }
      }
      if(!SessionCookie.valid(cookie)) throw new IllegalStateException("Invalid session cookie");
      return cookie;
    } finally {connection.disconnect();}
  }
}
