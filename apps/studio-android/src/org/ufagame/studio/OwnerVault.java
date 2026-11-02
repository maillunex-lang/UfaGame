package org.ufagame.studio;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Owner credentials stay in no-backup storage encrypted with Android Keystore. */
final class OwnerVault {
  private static final String ALIAS="ufagame.studio.owner.v1";
  private final File file;
  OwnerVault(Context context) { file=new File(context.getNoBackupFilesDir(),"owner.v1"); }
  private SecretKey key(boolean create) throws Exception {
    KeyStore store=KeyStore.getInstance("AndroidKeyStore"); store.load(null);
    if(store.containsAlias(ALIAS)) return (SecretKey)store.getKey(ALIAS,null);
    if(!create) throw new IllegalStateException("Key missing");
    KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
    generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setRandomizedEncryptionRequired(true).setKeySize(256).build());
    return generator.generateKey();
  }
  boolean hasSaved() { return file.isFile(); }
  JSONObject load() throws Exception {
    if(!hasSaved()||file.length()>8192) throw new IllegalStateException("Credentials unavailable");
    ByteArrayOutputStream bytes=new ByteArrayOutputStream();
    try(FileInputStream in=new FileInputStream(file)){byte[] buf=new byte[512];int n;while((n=in.read(buf))!=-1)bytes.write(buf,0,n);}
    JSONObject envelope=new JSONObject(bytes.toString("UTF-8"));
    if(envelope.getInt("version")!=1)throw new IllegalStateException("Invalid version");
    Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.DECRYPT_MODE,key(false),new GCMParameterSpec(128,Base64.decode(envelope.getString("iv"),Base64.NO_WRAP)));
    cipher.updateAAD(ALIAS.getBytes(StandardCharsets.UTF_8));
    return new JSONObject(new String(cipher.doFinal(Base64.decode(envelope.getString("data"),Base64.NO_WRAP)),StandardCharsets.UTF_8));
  }
  void save(String login,String password) throws Exception {
    JSONObject value=new JSONObject().put("login",login).put("password",password);
    Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key(true));
    cipher.updateAAD(ALIAS.getBytes(StandardCharsets.UTF_8));
    JSONObject envelope=new JSONObject().put("version",1)
      .put("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP))
      .put("data",Base64.encodeToString(cipher.doFinal(value.toString().getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP));
    File temp=new File(file.getPath()+".part");
    try {try(FileOutputStream out=new FileOutputStream(temp)){out.write(envelope.toString().getBytes(StandardCharsets.UTF_8));out.getFD().sync();}
      if(!temp.renameTo(file))throw new IllegalStateException("Cannot save");
    } finally {if(temp.exists())temp.delete();}
  }
  void forget() throws Exception {
    if(file.exists()&&!file.delete())throw new IllegalStateException("Cannot delete");
    KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);if(store.containsAlias(ALIAS))store.deleteEntry(ALIAS);
  }
}
