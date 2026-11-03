package org.ufagame.studio;

import java.util.LinkedHashSet;
import java.util.Locale;

/** Limit WebView file selection to supported PNG/WAV resources and ZIP packages. */
public final class PickerPolicy {
 private PickerPolicy() {}
 public static String[] allowed(String[] values){
  LinkedHashSet<String> result=new LinkedHashSet<>();
  if(values!=null)for(String raw:values){
   if(raw==null)continue;
   for(String part:raw.split(",")){
    String value=part.trim().toLowerCase(Locale.ROOT);
    if(value.equals("image/png")||value.equals(".png"))result.add("image/png");
    if(value.equals("audio/wav")||value.equals("audio/x-wav")||value.equals("audio/wave")||value.equals(".wav"))result.add("audio/wav");
    if(value.equals("application/zip")||value.equals("application/x-zip-compressed")||value.equals(".zip"))result.add("application/zip");
   }
  }
  return result.toArray(new String[0]);
 }
}
