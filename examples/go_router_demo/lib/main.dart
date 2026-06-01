import 'package:flutter/material.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

import 'router.dart';

void main() async {
  // Inject the GoRouter instance so the bridge can navigate programmatically.
  await FliwrightBridge.init(router: appRouter);
  runApp(const GoRouterDemoApp());
}

class GoRouterDemoApp extends StatelessWidget {
  const GoRouterDemoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Fliwright GoRouter Demo',
      theme: ThemeData(
        colorSchemeSeed: Colors.indigo,
        useMaterial3: true,
      ),
      routerConfig: appRouter,
    );
  }
}
