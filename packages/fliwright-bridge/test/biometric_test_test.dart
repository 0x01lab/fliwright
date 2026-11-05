import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late FliwrightBiometricTestCapability biometric;

  setUp(() {
    FliwrightAppInstance.reset();
    biometric = FliwrightBiometricTestCapability();
  });

  Future<String> reset([String? generation]) async {
    final status = await biometric.invoke('reset', {
      if (generation != null) 'generation': generation,
    }) as Map<String, Object?>;
    return status['generation']! as String;
  }

  test('only the app can register a challenge and its actual callback result',
      () async {
    expect(biometric.methodNames, ['reset', 'getStatus']);
    final generation = await reset();
    biometric.beginChallenge(generation: generation, challengeId: 'sign-in');
    expect(await biometric.invoke('getStatus', {'generation': generation}),
        containsPair('pendingChallenges', ['sign-in']));
    biometric.completeChallenge(
        generation: generation,
        challengeId: 'sign-in',
        result: FliwrightBiometricTestResult.match);
    expect(await biometric.invoke('getStatus', {'generation': generation}),
        containsPair('results', {'sign-in': 'match'}));
    for (final method in ['beginChallenge', 'completeChallenge']) {
      await expectLater(
          biometric.invoke(method, {
            'generation': generation,
            'challengeId': 'forged',
            'result': 'match'
          }),
          throwsStateError);
    }
  });

  test('fences late app callbacks and teardown after a new attempt', () async {
    final old = await reset();
    biometric.beginChallenge(generation: old, challengeId: 'login');
    final current = await reset(old);
    expect(
        () => biometric.completeChallenge(
            generation: old,
            challengeId: 'login',
            result: FliwrightBiometricTestResult.match),
        throwsStateError);
    await expectLater(
        biometric.invoke('reset', {'generation': old}), throwsStateError);
    expect(await biometric.invoke('getStatus', {'generation': current}),
        containsPair('pendingChallenges', isEmpty));
  });

  test('records repeated non-match callbacks without completing the challenge',
      () async {
    final generation = await reset();
    biometric.beginChallenge(generation: generation, challengeId: 'login');
    for (var i = 1; i <= 3; i++) {
      biometric.recordRejection(generation: generation, challengeId: 'login');
      final status =
          await biometric.invoke('getStatus', {'generation': generation})
              as Map<String, Object?>;
      expect(status['rejections'], {'login': i});
      expect(status['pendingChallenges'], ['login']);
      expect(status['results'], isEmpty);
    }
    biometric.completeChallenge(
        generation: generation,
        challengeId: 'login',
        result: FliwrightBiometricTestResult.lockout);
    expect(await biometric.invoke('getStatus', {'generation': generation}),
        containsPair('results', {'login': 'lockout'}));
    expect(
        () => biometric.recordRejection(
            generation: generation, challengeId: 'login'),
        throwsStateError);
    await expectLater(
        biometric.invoke('recordRejection',
            {'generation': generation, 'challengeId': 'forged'}),
        throwsStateError);
  });

  test(
      'rejects duplicate IDs, orphan callbacks, nonportable IDs and bounded overflow',
      () async {
    final generation = await reset();
    expect(
        () => biometric.completeChallenge(
            generation: generation,
            challengeId: 'missing',
            result: FliwrightBiometricTestResult.reject),
        throwsStateError);
    expect(
        () => biometric.beginChallenge(
            generation: generation, challengeId: '/path'),
        throwsArgumentError);
    biometric.beginChallenge(generation: generation, challengeId: 'login');
    expect(
        () => biometric.beginChallenge(
            generation: generation, challengeId: 'login'),
        throwsStateError);
    biometric.completeChallenge(
        generation: generation,
        challengeId: 'login',
        result: FliwrightBiometricTestResult.cancel);
    expect(
        () => biometric.beginChallenge(
            generation: generation, challengeId: 'login'),
        throwsStateError);
    for (var i = 1; i < 16; i++) {
      biometric.beginChallenge(
          generation: generation, challengeId: 'prompt-$i');
      biometric.completeChallenge(
          generation: generation,
          challengeId: 'prompt-$i',
          result: FliwrightBiometricTestResult.error);
    }
    expect(
        () => biometric.beginChallenge(
            generation: generation, challengeId: 'overflow'),
        throwsStateError);
    await expectLater(
        biometric
            .invoke('getStatus', {'generation': generation, 'ready': true}),
        throwsArgumentError);
  });
}
