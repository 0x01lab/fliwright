import 'dart:async';
import 'dart:convert';

import '../extension_registry.dart';

typedef FliwrightAppSnapshotProvider =
    FutureOr<Map<String, Object?>> Function();
typedef FliwrightCapabilityMethod = FutureOr<Object?> Function(Object? input);

class FliwrightAppCapability {
  FliwrightAppCapability({
    required this.name,
    this.description,
    Map<String, FliwrightCapabilityMethod>? methods,
  }) : _methods = Map<String, FliwrightCapabilityMethod>.from(methods ?? {});

  final String name;
  final String? description;
  final Map<String, FliwrightCapabilityMethod> _methods;

  List<String> get methodNames => _methods.keys.toList();

  void registerMethod(String method, FliwrightCapabilityMethod handler) {
    if (method.trim().isEmpty) {
      throw ArgumentError('Capability method name must not be empty');
    }
    if (_methods.containsKey(method)) {
      throw StateError(
        'Method "$method" is already registered on capability "$name"',
      );
    }
    _methods[method] = handler;
  }

  Future<Object?> invoke(String method, Object? input) async {
    final handler = _methods[method];
    if (handler == null) {
      throw StateError(
        'Method "$method" is not registered on capability "$name"',
      );
    }
    return await handler(input);
  }

  Map<String, Object?> toJson() => {
    'name': name,
    if (description != null) 'description': description,
    'methods': methodNames,
  };
}

class FliwrightAppInstance {
  static String _id = 'app';
  static String? _name;
  static String? _environment;
  static FliwrightAppSnapshotProvider? _snapshotProvider;
  static final Map<String, FliwrightAppCapability> _capabilities =
      <String, FliwrightAppCapability>{};

  static void configure({
    String? id,
    String? name,
    String? environment,
    FliwrightAppSnapshotProvider? snapshot,
  }) {
    if (id != null) _id = id;
    if (name != null) _name = name;
    if (environment != null) _environment = environment;
    if (snapshot != null) _snapshotProvider = snapshot;
  }

  static void registerCapability(FliwrightAppCapability capability) {
    if (capability.name.trim().isEmpty) {
      throw ArgumentError('Capability name must not be empty');
    }
    if (_capabilities.containsKey(capability.name)) {
      throw StateError('Capability "${capability.name}" is already registered');
    }
    _capabilities[capability.name] = capability;
  }

  static void reset() {
    _id = 'app';
    _name = null;
    _environment = null;
    _snapshotProvider = null;
    _capabilities.clear();
  }

  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.app.info', _info);
    registry.register('ext.fliwright.app.snapshot', _snapshot);
    registry.register('ext.fliwright.app.capabilities', _capabilitiesList);
    registry.register('ext.fliwright.app.invoke', _invoke);
  }

  static Future<Map<String, dynamic>> _info(Map<String, String> params) async {
    return {
      'id': _id,
      if (_name != null) 'name': _name,
      if (_environment != null) 'environment': _environment,
      'capabilities': _capabilities.keys.toList(),
    };
  }

  static Future<Map<String, dynamic>> _snapshot(
    Map<String, String> params,
  ) async {
    final snapshot = await _snapshotProvider?.call();
    return {
      'id': _id,
      if (_name != null) 'name': _name,
      if (_environment != null) 'environment': _environment,
      'capabilities': _capabilities.keys.toList(),
      'snapshot': _jsonSafe(snapshot ?? <String, Object?>{}),
    };
  }

  static Future<Map<String, dynamic>> _capabilitiesList(
    Map<String, String> params,
  ) async {
    return {
      'capabilities': _capabilities.values
          .map((capability) => capability.toJson())
          .toList(),
    };
  }

  static Future<Map<String, dynamic>> _invoke(
    Map<String, String> params,
  ) async {
    final capabilityName = params['capability'];
    final method = params['method'];
    if (capabilityName == null || capabilityName.isEmpty) {
      return {'success': false, 'error': 'Missing parameter: capability'};
    }
    if (method == null || method.isEmpty) {
      return {'success': false, 'error': 'Missing parameter: method'};
    }

    final capability = _capabilities[capabilityName];
    if (capability == null) {
      return {
        'success': false,
        'error': 'Capability "$capabilityName" is not registered',
      };
    }

    try {
      final input = _decodeInput(params['input']);
      final result = await capability.invoke(method, input);
      return {'success': true, 'result': _jsonSafe(result)};
    } catch (error) {
      return {'success': false, 'error': error.toString()};
    }
  }

  static Object? _decodeInput(String? raw) {
    if (raw == null || raw.isEmpty) return null;
    return jsonDecode(raw);
  }

  static Object? _jsonSafe(Object? value) {
    if (value == null || value is String || value is num || value is bool) {
      return value;
    }
    if (value is DateTime) return value.toIso8601String();
    if (value is Iterable) {
      return value.map((entry) => _jsonSafe(entry)).toList();
    }
    if (value is Map) {
      return value.map(
        (key, entry) => MapEntry(key.toString(), _jsonSafe(entry)),
      );
    }
    return value.toString();
  }
}
