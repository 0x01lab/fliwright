import 'dart:convert';
import 'dart:developer';

typedef ExtensionHandler = Future<Map<String, dynamic>> Function(Map<String, String> params);

class ExtensionRegistry {
  final Map<String, ExtensionHandler> _handlers = {};

  void register(String method, ExtensionHandler handler) {
    if (!method.startsWith('ext.')) {
      throw ArgumentError('Extension method must start with "ext."');
    }
    if (_handlers.containsKey(method)) {
      throw StateError('Extension "$method" is already registered');
    }
    _handlers[method] = handler;
    _registerWithVM(method);
  }

  bool isRegistered(String method) => _handlers.containsKey(method);

  List<String> get registeredMethods => _handlers.keys.toList();

  /// Removes all registered handlers. Used for testing.
  void reset() {
    _handlers.clear();
  }

  Future<Map<String, dynamic>> invoke(String method, Map<String, String> params) async {
    final handler = _handlers[method];
    if (handler == null) {
      throw StateError('Extension "$method" is not registered');
    }
    return handler(params);
  }

  void _registerWithVM(String method) {
    try {
      registerExtension(method, (String registeredMethod, Map<String, String> parameters) async {
        try {
          final result = await _handlers[registeredMethod]!(parameters);
          return ServiceExtensionResponse.result(jsonEncode(result));
        } catch (e) {
          return ServiceExtensionResponse.error(ServiceExtensionResponse.extensionError, e.toString());
        }
      });
    } catch (_) {
      // VM Service is not available in test environments — silently ignore.
    }
  }
}
