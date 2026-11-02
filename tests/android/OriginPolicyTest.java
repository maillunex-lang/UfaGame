import org.ufagame.studio.OriginPolicy;
public final class OriginPolicyTest {
  public static void main(String[] args) {
    String[] allowed={"https://tts-ufa.ru/game/studio", "https://tts-ufa.ru/game/studio/drafts?tab=1", "https://TTS-UFA.RU:443/game/studio/"};
    String[] rejected={"http://tts-ufa.ru/game/studio", "https://evil.test/game/studio", "https://tts-ufa.ru.evil.test/game/studio", "https://tts-ufa.ru:8055/game/studio", "https://user@tts-ufa.ru/game/studio", "https://tts-ufa.ru/game/studioevil", "https://tts-ufa.ru/game/studio/../portal", "https://tts-ufa.ru/game/studio/%2e%2e/portal", "javascript:alert(1)", "file:///game/studio"};
    for(String u:allowed) if(!OriginPolicy.allows(u)) throw new AssertionError("Expected allowed: "+u);
    for(String u:rejected) if(OriginPolicy.allows(u)) throw new AssertionError("Expected rejected: "+u);
    System.out.println("Origin policy: 3 allowed, 10 rejected");
  }
}
