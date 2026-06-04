library fliwright_bridge_riverpod;

import 'dart:async';

import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final class FliwrightRiverpodObserver extends ProviderObserver {
  const FliwrightRiverpodObserver();

  @override
  void didAddProvider(
    ProviderObserverContext context,
    Object? value,
  ) {
    RiverpodExtension.recordProviderAdded(
      key: _providerKey(context),
      displayName: _providerName(context),
      providerType: context.provider.runtimeType.toString(),
      value: _debugValue(value),
      valueType: value.runtimeType.toString(),
    );
  }

  @override
  void didUpdateProvider(
    ProviderObserverContext context,
    Object? previousValue,
    Object? newValue,
  ) {
    RiverpodExtension.recordProviderUpdated(
      key: _providerKey(context),
      displayName: _providerName(context),
      providerType: context.provider.runtimeType.toString(),
      previousValue: _debugValue(previousValue),
      value: _debugValue(newValue),
      valueType: newValue.runtimeType.toString(),
    );
  }

  @override
  void didDisposeProvider(ProviderObserverContext context) {
    RiverpodExtension.recordProviderDisposed(_providerKey(context));
  }

  @override
  void providerDidFail(
    ProviderObserverContext context,
    Object error,
    StackTrace stackTrace,
  ) {
    RiverpodExtension.recordProviderError(
      key: _providerKey(context),
      error: error,
    );
  }
}

void registerFliwrightWritableProvider(
  String key,
  FutureOr<Object?> Function(Object? value) write, {
  String? displayName,
  String? providerType,
}) {
  RiverpodExtension.registerWritableProvider(
    key,
    write,
    displayName: displayName,
    providerType: providerType,
  );
}

void registerFliwrightProviderSerializer(
  String key,
  Object? Function(Object? value) serialize,
) {
  RiverpodExtension.registerProviderSerializer(key, serialize);
}

Object? _debugValue(Object? value) {
  if (value is AsyncValue) {
    return _debugAsyncValue(value);
  }
  return value;
}

Map<String, Object?> _debugAsyncValue(AsyncValue<Object?> value) {
  return {
    '\$kind': value.runtimeType.toString(),
    '\$type': value.runtimeType.toString(),
    '\$encodedBy': 'riverpod.AsyncValue',
    'isLoading': value.isLoading,
    'isRefreshing': value.isRefreshing,
    'isReloading': value.isReloading,
    'hasValue': value.hasValue,
    'hasError': value.hasError,
    'retrying': value.retrying,
    if (value.progress != null) 'progress': value.progress,
    if (value.hasValue)
      'value': const DebugValueEncoder().encode(_asyncValue(value)),
    if (value.hasError) 'error': value.error.toString(),
    if (value.stackTrace != null) 'stackTrace': value.stackTrace.toString(),
  };
}

Object? _asyncValue(AsyncValue<Object?> value) {
  try {
    return value.requireValue;
  } catch (_) {
    return value.value;
  }
}

String _providerKey(ProviderObserverContext context) {
  return _providerName(context) ?? context.provider.toString();
}

String? _providerName(ProviderObserverContext context) {
  final name = context.provider.name;
  return name == null || name.isEmpty ? null : name;
}
