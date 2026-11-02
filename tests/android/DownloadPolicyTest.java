import org.ufagame.studio.DownloadPolicy;
public final class DownloadPolicyTest {
  public static void main(String[] args) {
    String good="https://tts-ufa.ru/game/server/admin/v1/drafts/11111111-1111-4111-8111-111111111111/export";
    if(!DownloadPolicy.allows(good))throw new AssertionError("Expected allowed");
    for(String bad:new String[]{null,good.replace("https:","http:"),good.replace("tts-ufa.ru","evil.test"),good.replace("tts-ufa.ru","tts-ufa.ru.evil.test"),good.replace("tts-ufa.ru","user@tts-ufa.ru"),good.replace("tts-ufa.ru","tts-ufa.ru:8055"),good+"?redirect=x",good+"#x",good.replace("/export","/%65xport"),good.replace("/export","/other")})
      if(DownloadPolicy.allows(bad))throw new AssertionError("Expected rejected: "+bad);
    System.out.println("Download policy: allowed endpoint, 10 unsafe URLs rejected");
  }
}
