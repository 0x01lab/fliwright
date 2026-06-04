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
      value: value,
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
      previousValue: previousValue,
      value: newValue,
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

String _providerKey(ProviderObserverContext context) {
  return _providerName(context) ?? context.provider.toString();
}

String? _providerName(ProviderObserverContext context) {
  final name = context.provider.name;
  return name == null || name.isEmpty ? null : name;
}
