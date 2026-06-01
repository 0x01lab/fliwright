import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:form_demo/main.dart' as app;

void main() async {
  await FliwrightBridge.init();
  app.main();
}
