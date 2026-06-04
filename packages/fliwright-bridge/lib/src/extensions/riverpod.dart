import 'dart:async';
import 'dart:convert';
import 'dart:developer';

import '../bridge.dart';

typedef RiverpodWriteHandler = FutureOr<Object?> Function(Object? value);
typedef RiverpodValueSerializer = Object? Function(Object? value);

class ObservedRiverpodProvider {
  ObservedRiverpodProvider({
    required this.key,
    required this.displayName,
    required this.providerType,
    this.currentValue,
    this.previousValue,
    DateTime? addedAt,
    DateTime? updatedAt,
    this.disposedAt,
    this.disposed = false,
    this.error,
    this.overridable = false,
  })  : addedAt = addedAt ?? DateTime.now(),
        updatedAt = updatedAt ?? DateTime.now();

  final String key;
  String displayName;
  String providerType;
  Object? currentValue;
  Object? previousValue;
  String? valueType;
  final DateTime addedAt;
  DateTime updatedAt;
  DateTime? disposedAt;
  bool disposed;
  Object? error;
  bool overridable;

  Map<String, dynamic> toJson({bool watching = false}) => {
        'key': key,
        'name': displayName,
        'type': providerType,
        'value': _jsonSafe(currentValue),
        'previousValue': _jsonSafe(previousValue),
        'valueType': valueType,
        'readable': !disposed,
        'overridable': overridable,
        'watching': watching,
        'disposed': disposed,
        'addedAt': addedAt.toIso8601String(),
        'updatedAt': updatedAt.toIso8601String(),
        if (disposedAt != null) 'disposedAt': disposedAt!.toIso8601String(),
        if (error != null) 'error': error.toString(),
      };
}

class RiverpodExtension {
  static Object? _providerContainer;
  static bool _observerInstalled = false;
  static final Map<String, ObservedRiverpodProvider> _providers =
      <String, ObservedRiverpodProvider>{};
  static final Map<String, RiverpodWriteHandler> _writeHandlers =
      <String, RiverpodWriteHandler>{};
  static final Map<String, RiverpodValueSerializer> _serializers =
      <String, RiverpodValueSerializer>{};
  static final Set<String> _activeSubscriptions = {};

  /// Set the ProviderContainer for Riverpod state access.
  /// Must be called after ProviderScope is initialized.
  static void setProviderContainer(Object container) {
    _providerContainer = container;
  }

  static void clearProviderContainer() {
    _providerContainer = null;
  }

  static void markObserverInstalled() {
    _observerInstalled = true;
  }

  static void recordProviderAdded({
    required String key,
    String? displayName,
    String? providerType,
    Object? value,
  }) {
    markObserverInstalled();
    final now = DateTime.now();
    final serializedValue = _serializeValue(key, value);
    final provider = _providers[key] ??
        ObservedRiverpodProvider(
          key: key,
          displayName: displayName ?? key,
          providerType: providerType ?? 'unknown',
          addedAt: now,
          updatedAt: now,
        );
    provider
      ..displayName = displayName ?? provider.displayName
      ..providerType = providerType ?? provider.providerType
      ..previousValue = provider.currentValue
      ..currentValue = serializedValue
      ..valueType = _valueType(value)
      ..updatedAt = now
      ..disposed = false
      ..disposedAt = null
      ..error = value == null ? provider.error : null;
    _providers[key] = provider;
  }

  static void recordProviderUpdated({
    required String key,
    String? displayName,
    String? providerType,
    Object? previousValue,
    Object? value,
  }) {
    markObserverInstalled();
    final now = DateTime.now();
    final serializedPreviousValue = _serializeValue(key, previousValue);
    final serializedValue = _serializeValue(key, value);
    final provider = _providers[key] ??
        ObservedRiverpodProvider(
          key: key,
          displayName: displayName ?? key,
          providerType: providerType ?? 'unknown',
          addedAt: now,
          updatedAt: now,
        );
    provider
      ..displayName = displayName ?? provider.displayName
      ..providerType = providerType ?? provider.providerType
      ..previousValue = serializedPreviousValue ?? provider.currentValue
      ..currentValue = serializedValue
      ..valueType = _valueType(value)
      ..updatedAt = now
      ..disposed = false
      ..disposedAt = null
      ..error = value == null ? provider.error : null;
    _providers[key] = provider;

    if (_activeSubscriptions.contains(key)) {
      postEvent('riverpod.stateChanged', {
        'providerKey': key,
        'oldValue': _jsonSafe(provider.previousValue),
        'newValue': _jsonSafe(provider.currentValue),
      });
    }
  }

  static void recordProviderDisposed(String key) {
    final provider = _providers[key];
    if (provider == null) return;
    provider
      ..disposed = true
      ..disposedAt = DateTime.now()
      ..updatedAt = DateTime.now();
  }

  static void recordProviderError({
    required String key,
    Object? error,
  }) {
    markObserverInstalled();
    final now = DateTime.now();
    final provider = _providers[key] ??
        ObservedRiverpodProvider(
          key: key,
          displayName: key,
          providerType: 'unknown',
          addedAt: now,
          updatedAt: now,
        );
    provider
      ..error = error
      ..updatedAt = now;
    _providers[key] = provider;
  }

  static void registerWritableProvider(
    String key,
    RiverpodWriteHandler write, {
    String? displayName,
    String? providerType,
  }) {
    _writeHandlers[key] = write;
    final provider = _providers[key] ??
        ObservedRiverpodProvider(
          key: key,
          displayName: displayName ?? key,
          providerType: providerType ?? 'unknown',
        );
    provider
      ..displayName = displayName ?? provider.displayName
      ..providerType = providerType ?? provider.providerType
      ..overridable = true;
    _providers[key] = provider;
  }

  static void registerProviderSerializer(
    String key,
    RiverpodValueSerializer serializer,
  ) {
    _serializers[key] = serializer;
    final provider = _providers[key];
    if (provider != null) {
      provider
        ..currentValue = _serializeValue(key, provider.currentValue)
        ..previousValue = _serializeValue(key, provider.previousValue)
        ..valueType = _valueType(provider.currentValue)
        ..updatedAt = DateTime.now();
    }
  }

  static void reset() {
    _providerContainer = null;
    _observerInstalled = false;
    _providers.clear();
    _writeHandlers.clear();
    _serializers.clear();
    _activeSubscriptions.clear();
  }

  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.riverpod.status', _status);
    registry.register('ext.fliwright.riverpod.list', _listProviders);
    registry.register('ext.fliwright.riverpod.read', _readProvider);
    registry.register('ext.fliwright.riverpod.override', _overrideProvider);
    registry.register('ext.fliwright.riverpod.watch', _watchProvider);
    registry.register('ext.fliwright.riverpod.unwatch', _unwatchProvider);
  }

  static Future<Map<String, dynamic>> _status(
      Map<String, String> params) async {
    return {
      'observerInstalled': _observerInstalled,
      'containerReady': _getContainer() != null,
      'providerCount': _providers.length,
      'watching': _activeSubscriptions.toList(),
    };
  }

  static Future<Map<String, dynamic>> _listProviders(
      Map<String, String> params) async {
    final container = _getContainer();
    if (container == null && !_observerInstalled) {
      return {
        'providers': <Map<String, dynamic>>[],
        'containerReady': false,
        'observerInstalled': false,
      };
    }
    return {
      'providers': _providers.values
          .map((provider) => provider.toJson(
                watching: _activeSubscriptions.contains(provider.key),
              ))
          .toList(),
      'containerReady': container != null,
      'observerInstalled': _observerInstalled,
    };
  }

  static Future<Map<String, dynamic>> _readProvider(
      Map<String, String> params) async {
    final providerName = params['provider'];
    if (providerName == null) return {'error': 'Missing parameter: provider'};
    final provider = _providers[providerName];
    if (provider == null || provider.disposed) {
      return {'provider': providerName, 'value': null, 'found': false};
    }
    if (provider.error != null) {
      return {
        'provider': providerName,
        'value': _jsonSafe(provider.currentValue),
        'found': true,
        'error': provider.error.toString(),
      };
    }
    return {
      'provider': providerName,
      'value': _jsonSafe(provider.currentValue),
      'found': true,
      'overridable': provider.overridable,
    };
  }

  static Future<Map<String, dynamic>> _overrideProvider(
      Map<String, String> params) async {
    final providerName = params['provider'];
    final valueJson = params['value'];
    if (providerName == null || valueJson == null)
      return {'error': 'Missing parameters: provider and value are required'};
    final write = _writeHandlers[providerName];
    if (write == null) {
      return {
        'provider': providerName,
        'overridden': false,
        'message': 'Provider is not registered as overridable.',
      };
    }
    final decoded = jsonDecode(valueJson);
    final writtenValue = await write(decoded);
    recordProviderUpdated(
      key: providerName,
      previousValue: _providers[providerName]?.currentValue,
      value: writtenValue ?? decoded,
    );
    return {
      'provider': providerName,
      'overridden': true,
      'value': _jsonSafe(_providers[providerName]?.currentValue),
    };
  }

  static Future<Map<String, dynamic>> _watchProvider(
      Map<String, String> params) async {
    final providerName = params['provider'];
    if (providerName == null) return {'error': 'Missing parameter: provider'};
    if (!_observerInstalled && _getContainer() == null) {
      return {'error': 'ProviderObserver not installed'};
    }
    _activeSubscriptions.add(providerName);
    return {'watching': true, 'provider': providerName};
  }

  static Future<Map<String, dynamic>> _unwatchProvider(
      Map<String, String> params) async {
    final providerName = params['provider'];
    if (providerName == null) return {'error': 'Missing parameter: provider'};
    _activeSubscriptions.remove(providerName);
    return {'watching': false, 'provider': providerName};
  }

  static Object? _getContainer() => _providerContainer;
}

Object? _jsonSafe(Object? value) {
  if (value == null || value is bool || value is num || value is String) {
    return value;
  }
  if (value is DateTime) return value.toIso8601String();
  if (value is Iterable) return value.map(_jsonSafe).toList();
  if (value is Map) {
    return value
        .map((key, child) => MapEntry(key.toString(), _jsonSafe(child)));
  }
  return value.toString();
}

Object? _serializeValue(String key, Object? value) {
  final serializer = RiverpodExtension._serializers[key];
  if (serializer == null) return value;
  try {
    return serializer(value);
  } catch (error) {
    return {
      'serializerError': error.toString(),
      'rawValue': value.toString(),
    };
  }
}

String _valueType(Object? value) =>
    value == null ? 'Null' : value.runtimeType.toString();
