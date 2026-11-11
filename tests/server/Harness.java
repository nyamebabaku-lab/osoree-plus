import android.content.res.AssetManager;
import com.osoree.plus.ScreenServer;
import java.io.*;
// Runs the phone's ScreenServer on this computer. stdin: "lan on", "lan off", "count", "stop", or a JSON state to broadcast.
public class Harness {
  public static void main(String[] a) throws Exception {
    ScreenServer s = new ScreenServer(new AssetManager(new File(a[0])), new File(a[1]), "{\"kind\":\"idle\"}");
    System.out.println("PORT " + s.port()); System.out.flush();
    BufferedReader in = new BufferedReader(new InputStreamReader(System.in, "UTF-8"));
    String line;
    while ((line = in.readLine()) != null) {
      if (line.equals("count")) System.out.println("CLIENTS " + s.remoteCount());
      else if (line.equals("lan on")) { s.setLan(true); System.out.println("OK"); }
      else if (line.equals("lan off")) { s.setLan(false); System.out.println("OK"); }
      else if (line.equals("stop")) break;
      else s.broadcast(line);
      System.out.flush();
    }
    s.stop(); System.exit(0);
  }
}
