package org.ufagame.security;

import org.godotengine.godot.Godot;
import org.godotengine.godot.plugin.GodotPlugin;
import org.godotengine.godot.plugin.UsedByGodot;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.io.File;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

public final class CredentialsPlugin extends GodotPlugin {
  private static final String ALIAS="ufagame.credentials.v1";
  public CredentialsPlugin(Godot godot) { super(godot); }
  @Override public String getPluginName() { return "UfaCredentials"; }
  private File path() { return new File(getContext().getNoBackupFilesDir(), "credentials.v1"); }
  private SecretKey key(boolean create) throws Exception {
    KeyStore store=KeyStore.getInstance("AndroidKeyStore"); store.load(null);
    if(store.containsAlias(ALIAS)) return (SecretKey)store.getKey(ALIAS,null);
    if(!create) throw new IllegalStateException("Missing key");
    KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
    generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setRandomizedEncryptionRequired(true).setKeySize(256).build());
    return generator.generateKey();
  }
  @UsedByGodot public synchronized boolean save_credentials(String json) {return write(path(),json);}
  private boolean write(File file,String json) {
    try {
      if(json.length()>16384) return false;
      new JSONObject(json);
      Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key(true));cipher.updateAAD(file.getName().getBytes("UTF-8"));
      byte[] encrypted=cipher.doFinal(json.getBytes("UTF-8"));
      JSONObject envelope=new JSONObject().put("version",1).put("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)).put("data",Base64.encodeToString(encrypted,Base64.NO_WRAP));
      File temp=new File(file.getPath()+".part");
      try(java.io.FileOutputStream out=new java.io.FileOutputStream(temp)) {out.write(envelope.toString().getBytes("UTF-8"));out.getFD().sync();}
      if(!temp.renameTo(file)) {temp.delete();return false;}
      return true;
    } catch(Exception error) {return false;}
  }
  @UsedByGodot public synchronized String load_credentials() {return read(path());}
  private String read(File file) {
    if(!file.exists()) return "";
    try {
      if(file.length()>32768) throw new IllegalStateException();
      java.io.ByteArrayOutputStream buffer=new java.io.ByteArrayOutputStream();
      try(java.io.FileInputStream in=new java.io.FileInputStream(file)) {byte[] part=new byte[1024];int n;while((n=in.read(part))!=-1)buffer.write(part,0,n);}
      JSONObject envelope=new JSONObject(buffer.toString("UTF-8"));if(envelope.getInt("version")!=1)throw new IllegalStateException();
      Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.DECRYPT_MODE,key(false),new GCMParameterSpec(128,Base64.decode(envelope.getString("iv"),Base64.NO_WRAP)));
      cipher.updateAAD(file.getName().getBytes("UTF-8"));
      String json=new String(cipher.doFinal(Base64.decode(envelope.getString("data"),Base64.NO_WRAP)),"UTF-8");new JSONObject(json);return json;
    } catch(Exception error) {return "{\"error\":\"CREDENTIALS_UNAVAILABLE\"}";}
  }
  @UsedByGodot public synchronized String storage_probe() {
    File file=new File(getContext().getNoBackupFilesDir(),"keystore-probe.v1");
    try {
      if(!file.exists()) return write(file,new JSONObject().put("probe",random_secret()).toString())?"stored":"error";
      return new JSONObject(read(file)).getString("probe").length()==43?"reused":"error";
    } catch(Exception error) {return "error";}
  }
  @UsedByGodot public String random_secret() {byte[] bytes=new byte[32];new SecureRandom().nextBytes(bytes);return Base64.encodeToString(bytes,Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING);}
  @UsedByGodot public String request_id() {return UUID.randomUUID().toString();}
}
