package dev.fliwright.form_demo;

import android.Manifest;
import android.app.AlertDialog;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import io.flutter.embedding.android.FlutterActivity;
import io.flutter.embedding.engine.FlutterEngine;
import io.flutter.plugin.common.MethodChannel;
import java.util.HashMap;
import java.util.Map;

/** Source overlay for a disposable debug host. All decisions come from Android. */
public final class MainActivity extends FlutterActivity {
  private static final int CAMERA_REQUEST = 7410;
  private static final int MICROPHONE_REQUEST = 7411;
  private MethodChannel channel;
  private MethodChannel.Result pending;
  private AlertDialog dialog;

  @Override
  public void configureFlutterEngine(FlutterEngine engine) {
    super.configureFlutterEngine(engine);
    if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) == 0) return;
    channel = new MethodChannel(engine.getDartExecutor().getBinaryMessenger(), "dev.fliwright/native_fixture");
    channel.setMethodCallHandler((call, result) -> {
      if (call.method.equals("readPermissions")) {
        Map<String, Object> state = new HashMap<>();
        state.put("camera", permissionState(Manifest.permission.CAMERA));
        state.put("microphone", permissionState(Manifest.permission.RECORD_AUDIO));
        result.success(state);
        return;
      }
      if (!call.method.equals("confirm") && !call.method.equals("camera") && !call.method.equals("microphone")) {
        result.notImplemented();
        return;
      }
      if (pending != null || isFinishing() || isDestroyed()) {
        result.error("not_ready", "The fixture already has a pending request or is closing.", null);
        return;
      }
      pending = result;
      try {
        if (call.method.equals("confirm")) {
          dialog = new AlertDialog.Builder(this)
              .setTitle("Native confirmation")
              .setMessage("Choose a real Android action.")
              .setPositiveButton("Confirm native", (view, which) -> complete("confirmed"))
              .setNegativeButton("Cancel native", (view, which) -> complete("cancelled"))
              .setOnCancelListener(view -> complete("cancelled"))
              .create();
          dialog.show();
        } else {
          boolean camera = call.method.equals("camera");
          String permission = camera ? Manifest.permission.CAMERA : Manifest.permission.RECORD_AUDIO;
          if (checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) complete("granted");
          else requestPermissions(new String[] {permission}, camera ? CAMERA_REQUEST : MICROPHONE_REQUEST);
        }
      } catch (RuntimeException error) {
        fail("native_request_failed", "Android could not start the fixture request.");
      }
    });
  }

  private Map<String, Object> permissionState(String permission) {
    Map<String, Object> state = new HashMap<>();
    state.put("granted", checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED);
    // false does not distinguish never requested from permanently denied.
    state.put("rationale", shouldShowRequestPermissionRationale(permission));
    return state;
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    if (requestCode != CAMERA_REQUEST && requestCode != MICROPHONE_REQUEST) return;
    String expected = requestCode == CAMERA_REQUEST ? Manifest.permission.CAMERA : Manifest.permission.RECORD_AUDIO;
    if (permissions.length != 1 || !expected.equals(permissions[0]) || grantResults.length != 1) {
      fail("permission_cancelled", "Android did not return a complete permission decision.");
      return;
    }
    complete(checkSelfPermission(expected) == PackageManager.PERMISSION_GRANTED ? "granted" : "denied");
  }

  private void complete(String value) {
    MethodChannel.Result result = pending;
    pending = null;
    if (result != null) result.success(value);
  }

  private void fail(String code, String message) {
    MethodChannel.Result result = pending;
    pending = null;
    if (result != null) result.error(code, message, null);
  }

  @Override
  protected void onDestroy() {
    if (channel != null) channel.setMethodCallHandler(null);
    fail("fixture_closed", "The fixture activity closed before its result was observed.");
    if (dialog != null) dialog.dismiss();
    super.onDestroy();
  }
}
