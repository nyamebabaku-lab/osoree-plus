package android.content.res;
import java.io.*;
// Test stand-in for Android's AssetManager: serves "assets" from a folder.
public class AssetManager {
  private final File root;
  public AssetManager(File root) { this.root = root; }
  public InputStream open(String name) throws IOException { return new FileInputStream(new File(root, name)); }
}
