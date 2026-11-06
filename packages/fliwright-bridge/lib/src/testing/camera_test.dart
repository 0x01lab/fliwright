import 'dart:async';
import 'dart:math';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';

import '../extensions/app_instance.dart';

/// Loads an app-readable PNG/JPEG fixture registered by the test entrypoint.
typedef FliwrightCameraFixtureLoader = FutureOr<Uint8List> Function();

/// A camera result supplied by the app's test adapter, separate from hardware UI.
sealed class FliwrightCameraTestResult {
  const FliwrightCameraTestResult();
  Map<String, Object?> get summary;
}

final class FliwrightCameraImageResult extends FliwrightCameraTestResult {
  FliwrightCameraImageResult._(this.fixtureId, this.mimeType, Uint8List bytes)
      : _bytes = Uint8List.fromList(bytes);

  final String fixtureId;
  final String mimeType;
  final Uint8List _bytes;
  Uint8List get bytes => Uint8List.fromList(_bytes);

  @override
  Map<String, Object?> get summary => {'kind': 'image', 'fixtureId': fixtureId};
}

final class FliwrightCameraCancelledResult extends FliwrightCameraTestResult {
  const FliwrightCameraCancelledResult();

  @override
  Map<String, Object?> get summary => {'kind': 'cancel'};
}

final class FliwrightCameraErrorResult extends FliwrightCameraTestResult {
  const FliwrightCameraErrorResult({required this.code, required this.message});

  final String code;
  final String message;

  @override
  Map<String, Object?> get summary => {'kind': 'error', 'code': code};
}

class _CameraAttempt {
  _CameraAttempt(this.generation);
  final String generation;
  final List<FliwrightCameraTestResult> pending = [];
  final List<Map<String, Object?>> consumed = [];
  int enqueued = 0;
  bool loading = false;
}

/// Opt-in app-owned camera test seam. Register only in a test entrypoint and
/// inject [capture] into that entrypoint's camera service. Nothing auto-registers
/// this capability or replaces a production camera plugin.
///
/// `reset({results?})` starts an attempt; `enqueueResult({generation, result})`
/// adds a single result. `getStatus({generation?})` reports consumption without
/// image bytes. Fixture IDs resolve inside the app, never as host file paths.
class FliwrightCameraTestCapability extends FliwrightAppCapability {
  FliwrightCameraTestCapability({
    required Map<String, FliwrightCameraFixtureLoader> fixtures,
  })  : _fixtures = Map.unmodifiable(fixtures),
        super(name: 'cameraTest', description: 'App-owned camera test seam') {
    if (kReleaseMode) {
      throw UnsupportedError(
          'Camera test capability is unavailable in release.');
    }
    if (_fixtures.keys.any((id) => !_reference.hasMatch(id))) {
      throw ArgumentError('Camera fixture IDs must be portable references.');
    }
    registerMethod('reset', _reset);
    registerMethod('enqueueResult', _enqueueResult);
    registerMethod('getStatus', _getStatus);
  }

  static final _reference = RegExp(r'^[A-Za-z0-9][A-Za-z0-9._-]*$');
  static const _maxResults = 32;
  static const _maxImageBytes = 10 * 1024 * 1024;
  final Map<String, FliwrightCameraFixtureLoader> _fixtures;
  final String _instance = List.generate(
      4, (_) => Random.secure().nextInt(1 << 32).toRadixString(16)).join('-');
  int _counter = 0;
  _CameraAttempt? _attempt;

  /// Capture this token when the app begins a camera request. Old tokens are
  /// rejected after reset, including delayed callbacks from a previous attempt.
  String get generation => _current.generation;

  _CameraAttempt get _current =>
      _attempt ??
      (throw StateError('Reset cameraTest before requesting a camera result.'));

  Future<Object?> _reset(Object? input) async {
    final object = _object(input ?? {}, {'results', 'generation'});
    if (object.containsKey('generation')) {
      _requireGeneration(object['generation']);
    }
    final results = object['results'] ?? <Object?>[];
    if (results is! List || results.length > _maxResults) {
      throw ArgumentError(
          'Camera reset results must contain at most 32 entries.');
    }
    // Validate the complete declaration before dropping an existing queue.
    for (final result in results) {
      _validateResult(result);
    }
    final discarded = _attempt?.pending.length ?? 0;
    final state = _CameraAttempt('$_instance-${++_counter}');
    _attempt = state;
    await _append(state, results);
    return {..._status(state), 'discarded': discarded};
  }

  Future<Object?> _enqueueResult(Object? input) async {
    final object = _object(input, {'generation', 'result'});
    final state = _requireGeneration(object['generation']);
    _validateResult(object['result']);
    await _append(state, [object['result']]);
    return _status(state);
  }

  Object? _getStatus(Object? input) {
    final object = _object(input ?? {}, {'generation'});
    final state = object.containsKey('generation')
        ? _requireGeneration(object['generation'])
        : _current;
    return _status(state);
  }

  /// Consume one queued result, atomically, for the caller's current attempt.
  /// Empty queues fail rather than falling back to a real camera invocation.
  Future<FliwrightCameraTestResult> capture(
      {required String generation}) async {
    final state = _requireGeneration(generation);
    if (state.loading || state.pending.isEmpty) {
      throw StateError('Camera test result queue is loading or empty.');
    }
    final result = state.pending.removeAt(0);
    state.consumed.add(result.summary);
    return result;
  }

  _CameraAttempt _requireGeneration(Object? generation) {
    if (generation is! String || generation.isEmpty) {
      throw ArgumentError('Camera test writes require an explicit generation.');
    }
    final state = _current;
    if (generation != state.generation) {
      throw StateError('Camera test generation belongs to a previous attempt.');
    }
    return state;
  }

  Future<void> _append(_CameraAttempt state, List<Object?> declarations) async {
    if (state.loading)
      throw StateError('Camera test result preparation is busy.');
    if (state.enqueued + declarations.length > _maxResults) {
      throw StateError('A camera test attempt may enqueue at most 32 results.');
    }
    state.loading = true;
    try {
      final results = <FliwrightCameraTestResult>[];
      for (final declaration in declarations) {
        if (!identical(state, _attempt)) {
          throw StateError('Camera test preparation completed after reset.');
        }
        final result = _validateResult(declaration);
        switch (result['kind']) {
          case 'image':
            results.add(await _loadFixture(result['fixtureId']! as String));
          case 'cancel':
            results.add(const FliwrightCameraCancelledResult());
          case 'error':
            results.add(FliwrightCameraErrorResult(
              code: result['code']! as String,
              message: (result['message'] ?? result['code'])! as String,
            ));
        }
      }
      if (!identical(state, _attempt)) {
        throw StateError('Camera test preparation completed after reset.');
      }
      state.pending.addAll(results);
      state.enqueued += results.length;
    } finally {
      state.loading = false;
    }
  }

  Map<String, Object?> _validateResult(Object? input) {
    if (input is! Map) throw ArgumentError('Camera result must be an object.');
    switch (input['kind']) {
      case 'image':
        final object = _object(input, {'kind', 'fixtureId'});
        final id = object['fixtureId'];
        if (id is! String || !_reference.hasMatch(id)) {
          throw ArgumentError('Camera fixtureId must be a portable reference.');
        }
        if (!_fixtures.containsKey(id)) {
          throw FormatException('Camera fixture is not registered: $id');
        }
        return object;
      case 'cancel':
        return _object(input, {'kind'});
      case 'error':
        final object = _object(input, {'kind', 'code', 'message'});
        final code = object['code'], message = object['message'];
        if (code is! String ||
            !_reference.hasMatch(code) ||
            code.length > 128 ||
            (message != null &&
                (message is! String || message.length > 1024))) {
          throw ArgumentError(
              'Camera error requires a bounded code and message.');
        }
        return object;
      default:
        throw ArgumentError(
            'Camera result kind must be image, cancel or error.');
    }
  }

  Future<FliwrightCameraImageResult> _loadFixture(String id) async {
    try {
      final loaded = await Future<Uint8List>.sync(_fixtures[id]!)
          .timeout(const Duration(seconds: 5));
      if (loaded.isEmpty || loaded.length > _maxImageBytes) {
        throw const FormatException('Invalid camera fixture size.');
      }
      final bytes = Uint8List.fromList(loaded);
      final isPng = bytes.length >= 8 &&
          listEquals(bytes.sublist(0, 8), [137, 80, 78, 71, 13, 10, 26, 10]);
      final isJpeg = bytes.length >= 3 &&
          bytes[0] == 255 &&
          bytes[1] == 216 &&
          bytes[2] == 255;
      if (!isPng && !isJpeg) {
        throw const FormatException('Camera fixture must be PNG or JPEG.');
      }
      final codec = await ui.instantiateImageCodec(bytes);
      try {
        final frame = await codec.getNextFrame();
        try {
          if (frame.image.width * frame.image.height > 16000000) {
            throw const FormatException(
                'Camera fixture exceeds 16 megapixels.');
          }
        } finally {
          frame.image.dispose();
        }
      } finally {
        codec.dispose();
      }
      return FliwrightCameraImageResult._(
          id, isPng ? 'image/png' : 'image/jpeg', bytes);
    } catch (_) {
      throw FormatException(
          'Camera fixture could not be loaded or decoded: $id');
    }
  }

  Map<String, Object?> _status(_CameraAttempt state) => {
        'schemaVersion': 1,
        'surface': 'app-test-seam',
        'generation': state.generation,
        'pending': state.pending.length,
        'consumed': state.consumed.length,
        'enqueued': state.enqueued,
        'loading': state.loading,
        'consumedResults':
            state.consumed.map((result) => Map.of(result)).toList(),
      };

  Map<String, Object?> _object(Object? input, Set<String> keys) {
    if (input is! Map ||
        input.keys.any((key) => key is! String || !keys.contains(key))) {
      throw ArgumentError('Unexpected camera test fields.');
    }
    return Map<String, Object?>.from(input);
  }
}
