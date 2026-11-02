package org.ufagame.studio;

import java.net.URI;
import java.net.URISyntaxException;

/** Allow only the configured Studio HTTPS origin and its route namespace. */
public final class OriginPolicy {
  private OriginPolicy() {}
  public static boolean allows(String value) {
    try {
      URI uri = new URI(value);
      if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null ||
          !"tts-ufa.ru".equalsIgnoreCase(uri.getHost()) || uri.getUserInfo() != null ||
          (uri.getPort() != -1 && uri.getPort() != 443)) return false;
      String path = uri.getRawPath();
      if (path == null || path.indexOf('%') >= 0 || path.indexOf('\\') >= 0) return false;
      for (String part : path.split("/")) if (part.equals(".") || part.equals("..")) return false;
      return path.equals("/game/studio") || path.startsWith("/game/studio/");
    } catch (URISyntaxException | IllegalArgumentException error) { return false; }
  }
}
