import org.ufagame.studio.SessionCookie;
public final class SessionCookieTest {
  public static void main(String[] args) {
    String token="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
    String valid="__Secure-ufagame-owner="+token+"; Path=/game/server/admin/v1; HttpOnly; Secure; SameSite=Strict";
    if(!SessionCookie.valid(valid))throw new AssertionError("Valid cookie rejected");
    for(String invalid:new String[]{null,valid.replace("; Secure", ""),valid.replace("; HttpOnly", ""),valid.replace("/admin/v1", "/"),valid+"; Path=/",valid+"; Domain=tts-ufa.ru",valid+"\r\nX: bad",valid.replace(token,"short")})
      if(SessionCookie.valid(invalid))throw new AssertionError("Invalid cookie accepted");
    System.out.println("Session cookie: valid accepted, 8 unsafe variants rejected");
  }
}
