import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:fliwright_bridge_riverpod/fliwright_bridge_riverpod.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:riverpod_demo/main.dart' as app;

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final container = ProviderContainer(
    observers: const [FliwrightRiverpodObserver()],
  );
  RiverpodExtension.setProviderContainer(container);
  FliwrightAppInstance.registerCapability(
    FliwrightAuthCapability(
      getStatus: (_) {
        final user = container.read(app.userProvider);
        return {
          'isAuthenticated': user != null,
          if (user != null) 'userId': user['id'],
        };
      },
      seedLoggedIn: (input) {
        final values = input is Map ? input : const <Object?, Object?>{};
        final userId = values['userId']?.toString() ?? 'demo-member';
        final preset = values['preset']?.toString() ?? 'member';
        container.read(app.userProvider.notifier).state = {
          'id': userId,
          'name': preset,
        };
        return {'isAuthenticated': true, 'userId': userId};
      },
      clearSession: (_) {
        container.read(app.userProvider.notifier).state = null;
        return {'isAuthenticated': false};
      },
    ),
  );
  await FliwrightBridge.init();
  await FliwrightTestBootstrap.awaitScenario();
  runApp(UncontrolledProviderScope(
    container: container,
    child: const app.MyApp(),
  ));
}
