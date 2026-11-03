import org.ufagame.studio.DownloadPolicy;
public final class DownloadPolicyTest {
  public static void main(String[] args) {
    String good="https://tts-ufa.ru/game/server/admin/v1/drafts/11111111-1111-4111-8111-111111111111/export";
    if(!DownloadPolicy.allows(good))throw new AssertionError("Expected allowed");
    if(!DownloadPolicy.allows(good+"?ids=hero_one,ability_one"))throw new AssertionError("Expected selection allowed");
    for(String bad:new String[]{null,good.replace("https:","http:"),good.replace("tts-ufa.ru","evil.test"),good.replace("tts-ufa.ru","tts-ufa.ru.evil.test"),good.replace("tts-ufa.ru","user@tts-ufa.ru"),good.replace("tts-ufa.ru","tts-ufa.ru:8055"),good+"?redirect=x",good+"#x",good+"?ids=Hero",good+"?ids=hero_one&x=1",good+"?ids=hero_one%26x",good+"?ids=",good+"?ids=hero_one,",good.replace("/export","/%65xport"),good.replace("/export","/other")})
      if(DownloadPolicy.allows(bad))throw new AssertionError("Expected rejected: "+bad);
    System.out.println("Download policy: allowed endpoint, selection allowed, 15 unsafe URLs rejected");
  }
}
