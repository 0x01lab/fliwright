import 'dart:math';

import 'package:flutter/foundation.dart';

import '../extensions/app_instance.dart';

/// App-reported result of a real biometric prompt callback.
enum FliwrightBiometricTestResult { match, reject, cancel, lockout, error }

class _BiometricAttempt {
  _BiometricAttempt(this.generation);
  final String generation;
  final Set<String> pending = <String>{};
  final Map<String, String> results = <String, String>{};
  final Map<String, int> rejections = <String, int>{};
}

/// Opt-in observer for biometric challenges in an app test entrypoint.
///
/// Call [beginChallenge] immediately before showing the platform prompt and
/// [completeChallenge] from its actual callback. This capability never starts
/// the prompt or changes authentication state.
class FliwrightBiometricTestCapability extends FliwrightAppCapability {
  FliwrightBiometricTestCapability()
      : super(
            name: 'biometricTest',
            description: 'App-owned biometric challenge observer') {
    if (kReleaseMode) {
      throw UnsupportedError(
          'Biometric test capability is unavailable in release.');
    }
    registerMethod('reset', _reset);
    registerMethod('getStatus', _getStatus);
  }

  static final _reference = RegExp(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$');
  static const _maxChallenges = 16;
  final String _instance = List.generate(
      4, (_) => Random.secure().nextInt(1 << 32).toRadixString(16)).join('-');
  var _counter = 0;
  _BiometricAttempt? _attempt;

  String get generation => _current.generation;
  _BiometricAttempt get _current =>
      _attempt ??
      (throw StateError('Reset biometricTest before observing challenges.'));

  Object? _reset(Object? input) {
    final object = _object(input ?? {}, {'generation'});
    if (object.containsKey('generation'))
      _requireGeneration(object['generation']);
    final state = _BiometricAttempt('$_instance-${++_counter}');
    _attempt = state;
    return _status(state);
  }

  /// Record the current app request immediately before presenting its OS prompt.
  /// Capture [generation] before asynchronous work so old callbacks stay fenced.
  void beginChallenge(
      {required String generation, required String challengeId}) {
    final state = _requireGeneration(generation);
    _challengeId(challengeId);
    if (state.pending.length + state.results.length >= _maxChallenges ||
        state.pending.contains(challengeId) ||
        state.results.containsKey(challengeId)) {
      throw StateError(
          'Biometric challenge is duplicated or the attempt limit was reached.');
    }
    state.pending.add(challengeId);
  }

  /// Record the actual app authentication callback; this does not set auth state.
  void completeChallenge(
      {required String generation,
      required String challengeId,
      required FliwrightBiometricTestResult result}) {
    final state = _requireGeneration(generation);
    _challengeId(challengeId);
    if (!state.pending.remove(challengeId))
      throw StateError('Biometric challenge is not pending.');
    state.results[challengeId] = result.name;
  }

  /// Record a platform non-match callback while authentication remains pending.
  /// This is distinct from completing or cancelling the authentication request.
  void recordRejection(
      {required String generation, required String challengeId}) {
    final state = _requireGeneration(generation);
    _challengeId(challengeId);
    if (!state.pending.contains(challengeId))
      throw StateError('Biometric challenge is not pending.');
    final sequence = state.rejections[challengeId] ?? 0;
    if (sequence >= 32)
      throw StateError('Biometric rejection limit was reached.');
    state.rejections[challengeId] = sequence + 1;
  }

  Object? _getStatus(Object? input) {
    final object = _object(input ?? {}, {'generation'});
    final state = object.containsKey('generation')
        ? _requireGeneration(object['generation'])
        : _current;
    return _status(state);
  }

  _BiometricAttempt _requireGeneration(Object? value) {
    if (value is! String || value.isEmpty)
      throw ArgumentError('Biometric writes require an explicit generation.');
    final state = _current;
    if (value != state.generation)
      throw StateError(
          'Biometric test generation belongs to a previous attempt.');
    return state;
  }

  Map<String, Object?> _status(_BiometricAttempt state) => {
        'schemaVersion': 1,
        'surface': 'app-test-seam',
        'generation': state.generation,
        'pendingChallenges': state.pending.toList(),
        'results': Map<String, String>.from(state.results),
        'rejections': Map<String, int>.from(state.rejections),
      };

  String _challengeId(Object? value) {
    if (value is! String || !_reference.hasMatch(value)) {
      throw ArgumentError(
          'Biometric challenge IDs must be portable references.');
    }
    return value;
  }

  Map<String, Object?> _object(Object? value, Set<String> keys) {
    if (value is! Map)
      throw ArgumentError('Biometric test input must be an object.');
    final result = <String, Object?>{};
    for (final entry in value.entries) {
      if (entry.key is! String || !keys.contains(entry.key))
        throw ArgumentError('Unexpected biometric test input field.');
      result[entry.key as String] = entry.value;
    }
    return result;
  }
}
