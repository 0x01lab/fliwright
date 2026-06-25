import 'dart:convert';

import '../extension_registry.dart';
import 'diagnostics.dart';

/// Handler that clears app-level key/value storage and optionally seeds it.
///
/// The host app injects this so the bridge stays free of a hard dependency on
/// any one storage package (SharedPreferences, Hive, secure_storage, …). The
/// handler receives the decoded [seed] map (possibly empty) and should:
///   1. clear the keys it owns, then
///   2. write the [seed] entries, then
///   3. return the number of keys it cleared.
///
/// Returning `null` signals "I cleared nothing / nothing to do".
typedef FliwrightStorageResetHandler = Future<Map<String, dynamic>?>
    Function(Map<String, Object?> seed);

/// VM Service extension `ext.fliwright.storage.reset`.
///
/// Closes determinism Gap C: gives the TDD BaselineManager a fast, in-process
/// way to reset app storage to a known seed before each rerun.
///
/// This extension is **optional and degrades gracefully when absent**. The host
/// app registers a [FliwrightStorageResetHandler] via [setHandler] (typically at
/// the same time it calls `FliwrightBridge.init`). Until then [reset] reports
/// `{'success': false, 'code': 'unsupported'}` and the TDD adapter surfaces the
/// `'storage'` category in `ResetReport.unsupported` — never throwing.
class StorageResetExtension {
  static FliwrightStorageResetHandler? _handler;

  /// Register the host app's storage-reset handler.
  ///
  /// Pass `null` to clear a previously registered handler (used in tests and by
  /// [reset]).
  static void setHandler(FliwrightStorageResetHandler? handler) {
    _handler = handler;
  }

  /// Whether a handler is currently registered.
  static bool get hasHandler => _handler != null;

  /// Test-only: clear all static state.
  static void reset() {
    _handler = null;
  }

  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.storage.reset', _reset);
  }

  /// Params:
  ///   - seed (optional): JSON object written into storage after the clear.
  ///     Default `{}`.
  ///
  /// Returns a normalized success/failure map. `success:false` + `code:
  /// 'unsupported'` is reported when no host handler is registered.
  static Future<Map<String, dynamic>> _reset(
    Map<String, String> params,
  ) async {
    final handler = _handler;
    if (handler == null) {
      return normalizedFailure(
        code: 'unsupported',
        message:
            'ext.fliwright.storage.reset is registered but the host app did '
            'not provide a storage-reset handler',
        action: 'storage.reset',
        recoveryHints: _storageRecoveryHints(),
      );
    }

    Map<String, Object?> seed;
    try {
      seed = _decodeSeed(params['seed']);
    } catch (error) {
      return normalizedFailure(
        code: 'storage_reset_failed',
        message: 'invalid seed: $error',
        action: 'storage.reset',
        target: {'category': 'storage'},
        recoveryHints: _storageRecoveryHints(),
      );
    }

    try {
      final result = await handler(seed);
      final clearedKeys =
          (result?['clearedKeys'] as num?)?.toInt() ??
          (result?['cleared'] as num?)?.toInt() ??
          0;
      final seededKeys =
          (result?['seededKeys'] as num?)?.toInt() ??
          (result?['seeded'] as num?)?.toInt() ??
          seed.length;
      return normalizedSuccess(
        action: 'storage.reset',
        target: {'category': 'storage'},
        extra: {
          'clearedKeys': clearedKeys,
          'seededKeys': seededKeys,
          if (result != null) ..._jsonSafeMap(result),
        },
      );
    } catch (error) {
      return normalizedFailure(
        code: 'storage_reset_failed',
        message: 'storage-reset handler raised: $error',
        action: 'storage.reset',
        target: {'category': 'storage'},
        recoveryHints: _storageRecoveryHints(),
      );
    }
  }

  static Map<String, Object?> _decodeSeed(String? raw) {
    if (raw == null || raw.isEmpty) return const <String, Object?>{};
    final decoded = jsonDecode(raw);
    if (decoded is Map) {
      return decoded.map(
        (key, value) => MapEntry(key.toString(), value as Object?),
      );
    }
    throw FormatException(
      'storage.reset "seed" must be a JSON object, got: $raw',
    );
  }

  static Map<String, dynamic> _jsonSafeMap(Map<String, dynamic> source) {
    return source.map((key, value) {
      if (value == null ||
          value is String ||
          value is num ||
          value is bool) {
        return MapEntry(key, value);
      }
      if (value is Iterable) {
        return MapEntry(key, value.map(_jsonSafeScalar).toList());
      }
      return MapEntry(key, value.toString());
    });
  }

  static Object? _jsonSafeScalar(Object? value) {
    if (value == null || value is String || value is num || value is bool) {
      return value;
    }
    return value.toString();
  }
}

List<Map<String, String>> _storageRecoveryHints() => const [
  {
    'kind': 'configure',
    'description':
        'Register a storage-reset handler via StorageResetExtension.setHandler '
        'in the host app (next to FliwrightBridge.init).',
  },
  {
    'kind': 'observe',
    'description':
        'Without the handler, the storage category is unsupported; the TDD '
        'loop continues with partial determinism.',
  },
];
