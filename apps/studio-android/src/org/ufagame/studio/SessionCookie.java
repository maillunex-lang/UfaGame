package org.ufagame.studio;

import java.util.Locale;

/** Validate the single owner cookie returned by the fixed HTTPS login endpoint. */
public final class SessionCookie {
  private SessionCookie() {}
  public static boolean valid(String value) {
    if(value==null || value.indexOf('\n')>=0 || value.indexOf('\r')>=0)return false;
    String[] parts=value.split(";",-1);
    if(parts.length<4||!parts[0].trim().matches("__Secure-ufagame-owner=[A-Za-z0-9_-]{43}"))return false;
    boolean secure=false,httpOnly=false,path=false,domain=false;
    for(int i=1;i<parts.length;i++) {
      String attr=parts[i].trim().toLowerCase(Locale.ROOT);
      if(attr.equals("secure"))secure=true;
      else if(attr.equals("httponly"))httpOnly=true;
      else if(attr.startsWith("path=")) {
        if(path||!attr.equals("path=/game/server/admin/v1"))return false;
        path=true;
      }
      else if(attr.startsWith("domain="))domain=true;
    }
    return secure&&httpOnly&&path&&!domain;
  }
}
