import java.util.Arrays;
import org.ufagame.studio.PickerPolicy;
public final class PickerPolicyTest {
 public static void main(String[] args){
  if(!Arrays.equals(PickerPolicy.allowed(new String[]{".png,image/png"}),new String[]{"image/png"}))throw new AssertionError();
  if(!Arrays.equals(PickerPolicy.allowed(new String[]{"application/zip,.PNG"}),new String[]{"application/zip","image/png"}))throw new AssertionError();
  if(!Arrays.equals(PickerPolicy.allowed(new String[]{"image/png,.png,audio/wav,audio/x-wav,.wav"}),new String[]{"image/png","audio/wav"}))throw new AssertionError();
  if(PickerPolicy.allowed(new String[]{"audio/*","audio/mpeg",".mp3"}).length!=0)throw new AssertionError();
  if(PickerPolicy.allowed(new String[]{"*/*","image/svg+xml","text/html"}).length!=0||PickerPolicy.allowed(null).length!=0)throw new AssertionError();
  System.out.println("Picker policy: PNG/WAV/ZIP accepted, arbitrary file types rejected");
 }
}
