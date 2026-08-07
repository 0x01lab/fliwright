import 'package:flutter/widgets.dart';

import '../bridge.dart';
import '../soft_keyboard.dart';

class ContextExtension {
  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.context', _context);
  }

  static Future<Map<String, dynamic>> _context(
    Map<String, String> params,
  ) async {
    return {
      'route': await _route(),
      'focused': _focused(),
      'keyboard': SoftKeyboard.current().toJson(),
      'diagnostics': {
        'transientCallbacks': WidgetsBinding.instance.transientCallbackCount,
        'schedulerPhase': WidgetsBinding.instance.schedulerPhase.name,
        'hasScheduledFrame': WidgetsBinding.instance.hasScheduledFrame,
      },
      'capabilities': {
        'timelineContext': true,
        'captureFrame': true,
        'query': true,
        'assertionDiagnostics': true,
        'normalizedActionErrors': true,
        'normalizedMockCalls': true,
        'normalizedProviderState': true,
        'keyboardState': true,
        'keyboardDismiss': true,
      },
    };
  }

  static Future<Map<String, dynamic>> _route() async {
    try {
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.currentRoute',
        {},
      );
      return {
        'location': result['fullUri'] ?? result['path'],
        'name': result['name'],
      };
    } catch (_) {
      return {'location': null, 'name': null};
    }
  }

  static Map<String, dynamic>? _focused() {
    final focus = FocusManager.instance.primaryFocus;
    final context = focus?.context;
    if (context == null) return null;
    final widget = context.widget;
    return {
      'type': widget.runtimeType.toString(),
      if (widget.key != null) 'key': widget.key.toString(),
    };
  }
}
