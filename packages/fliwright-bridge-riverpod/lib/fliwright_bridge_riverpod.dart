library fliwright_bridge_riverpod;

import 'dart:async';

import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class FliwrightRiverpodObserver extends ProviderObserver {
  const FliwrightRiverpodObserver();

  @override
  void didAddProvider(
    ProviderBase<Object?> provider,
    Object? value,
    ProviderContainer container,
  ) {
    RiverpodExtension.recordProviderAdded(
      key: _providerKey(provider),
      displayName: _providerName(provider),
      providerType: provider.runtimeType.toString(),
      value: value,
    );
  }

  @override
  void didUpdateProvider(
    ProviderBase<Object?> provider,
    Object? previousValue,
    Object? newValue,
    ProviderContainer container,
  ) {
    RiverpodExtension.recordProviderUpdated(
      key: _providerKey(provider),
      displayName: _providerName(provider),
      providerType: provider.runtimeType.toString(),
      previousValue: previousValue,
      value: newValue,
    );
  }

  @override
  void didDisposeProvider(
    ProviderBase<Object?> provider,
    ProviderContainer container,
  ) {
    RiverpodExtension.recordProviderDisposed(_providerKey(provider));
  }

  @override
  void providerDidFail(
    ProviderBase<Object?> provider,
    Object error,
    StackTrace stackTrace,
    ProviderContainer container,
  ) {
    RiverpodExtension.recordProviderError(
      key: _providerKey(provider),
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

String _providerKey(ProviderBase<Object?> provider) {
  return _providerName(provider) ?? provider.toString();
}

String? _providerName(ProviderBase<Object?> provider) {
  final name = provider.name;
  return name == null || name.isEmpty ? null : name;
}
