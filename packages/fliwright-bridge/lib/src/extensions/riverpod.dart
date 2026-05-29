import '../bridge.dart';

class RiverpodExtension {
  static dynamic providerContainer;

  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.riverpod.list', _listProviders);
    registry.register('ext.fliwright.riverpod.read', _readProvider);
    registry.register('ext.fliwright.riverpod.override', _overrideProvider);
    registry.register('ext.fliwright.riverpod.watch', _watchProvider);
    registry.register('ext.fliwright.riverpod.unwatch', _unwatchProvider);
  }

  static final Map<String, dynamic> _activeSubscriptions = {};

  static Future<Map<String, dynamic>> _listProviders(Map<String, String> params) async {
    final container = _getContainer();
    if (container == null) {
      return {'error': 'ProviderContainer not found. Ensure ProviderScope is active.'};
    }
    return {'providers': <Map<String, dynamic>>[], 'containerReady': true};
  }

  static Future<Map<String, dynamic>> _readProvider(Map<String, String> params) async {
    final container = _getContainer();
    final providerName = params['provider'];
    if (providerName == null) return {'error': 'Missing parameter: provider'};
    if (container == null) return {'error': 'ProviderContainer not found'};
    return {'provider': providerName, 'value': null, 'found': false};
  }

  static Future<Map<String, dynamic>> _overrideProvider(Map<String, String> params) async {
    final container = _getContainer();
    final providerName = params['provider'];
    final valueJson = params['value'];
    if (providerName == null || valueJson == null) return {'error': 'Missing parameters: provider and value are required'};
    if (container == null) return {'error': 'ProviderContainer not found'};
    return {'provider': providerName, 'overridden': false, 'message': 'Provider override will be implemented with provider registry'};
  }

  static Future<Map<String, dynamic>> _watchProvider(Map<String, String> params) async {
    final container = _getContainer();
    final providerName = params['provider'];
    if (providerName == null) return {'error': 'Missing parameter: provider'};
    if (container == null) return {'error': 'ProviderContainer not found'};
    _activeSubscriptions[providerName] = true;
    return {'watching': true, 'provider': providerName};
  }

  static Future<Map<String, dynamic>> _unwatchProvider(Map<String, String> params) async {
    final providerName = params['provider'];
    if (providerName == null) return {'error': 'Missing parameter: provider'};
    _activeSubscriptions.remove(providerName);
    return {'watching': false, 'provider': providerName};
  }

  static dynamic _getContainer() => providerContainer;
}
