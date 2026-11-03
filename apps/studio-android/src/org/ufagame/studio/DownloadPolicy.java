package org.ufagame.studio;

import java.net.URI;
import java.net.URISyntaxException;

/** Only the authenticated draft ZIP endpoint (optionally ?ids=...) may be downloaded. */
public final class DownloadPolicy {
  private DownloadPolicy() {}
  public static boolean allows(String value) {
    if(value==null)return false;
    try {
      URI uri=new URI(value);
      if(!"https".equalsIgnoreCase(uri.getScheme())||!"tts-ufa.ru".equalsIgnoreCase(uri.getHost())||uri.getUserInfo()!=null||(uri.getPort()!=-1&&uri.getPort()!=443)||uri.getRawFragment()!=null)return false;
      String query=uri.getRawQuery();
      // Optional selection of entity ids (stable ids, comma separated), nothing else.
      if(query!=null&&!query.matches("ids=[a-z][a-z0-9_]{2,79}(,[a-z][a-z0-9_]{2,79}){0,999}"))return false;
      String path=uri.getRawPath();
      return path!=null&&path.matches("/game/server/admin/v1/drafts/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/export");
    } catch(URISyntaxException|IllegalArgumentException error){return false;}
  }
}
