import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:form_demo/native_fixture.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('dev.fliwright/native_fixture');

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  testWidgets('waits for native confirmation and displays its actual outcome',
      (tester) async {
    final pending = Completer<String>();
    final methods = <String>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      methods.add(call.method);
      return pending.future;
    });
    await tester.pumpWidget(const NativeFixtureApp());
    await tester.tap(find.byKey(const Key('native_confirm')));
    await tester.pump();
    expect(find.text('Waiting for native result'), findsOneWidget);
    final button = tester.widget<ElevatedButton>(
      find.byKey(const Key('native_confirm')),
    );
    expect(button.onPressed, isNull);
    expect(methods, ['confirm']);
    pending.complete('cancelled');
    await tester.pumpAndSettle();
    expect(find.text('Native: cancelled'), findsOneWidget);
  });

  testWidgets('shows microphone decisions returned by the platform',
      (tester) async {
    var result = 'denied';
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      expect(call.method, 'microphone');
      return result;
    });
    await tester.pumpWidget(const NativeFixtureApp());
    await tester.tap(find.byKey(const Key('native_microphone')));
    await tester.pumpAndSettle();
    expect(find.text('Microphone: denied'), findsOneWidget);
    result = 'granted';
    await tester.tap(find.byKey(const Key('native_microphone')));
    await tester.pumpAndSettle();
    expect(find.text('Microphone: granted'), findsOneWidget);
  });

  testWidgets('returns the actual native input value, including an empty value',
      (tester) async {
    Object? reply = {'status': 'confirmed', 'text': 'Native replacement'};
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      expect(call.method, 'textInput');
      return reply;
    });
    await tester.pumpWidget(const NativeFixtureApp(includeTextInput: true));
    await tester.tap(find.byKey(const Key('native_input')));
    await tester.pumpAndSettle();
    expect(find.text('Input: confirmed'), findsOneWidget);
    expect(
        tester.widget<Text>(find.byKey(const Key('native_input_value'))).data,
        'Native replacement');
    reply = {'status': 'confirmed', 'text': ''};
    await tester.tap(find.byKey(const Key('native_input')));
    await tester.pumpAndSettle();
    expect(
        tester.widget<Text>(find.byKey(const Key('native_input_value'))).data,
        '');
  });

  testWidgets('separates cancelled input from invalid native input replies',
      (tester) async {
    Object? reply = {'status': 'cancelled'};
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (_) async => reply);
    await tester.pumpWidget(const NativeFixtureApp(includeTextInput: true));
    await tester.tap(find.byKey(const Key('native_input')));
    await tester.pumpAndSettle();
    expect(find.text('Input: cancelled'), findsOneWidget);
    for (final invalid in [
      null,
      {'status': 'confirmed'},
      {'status': 'confirmed', 'text': 42}
    ]) {
      reply = invalid;
      await tester.tap(find.byKey(const Key('native_input')));
      await tester.pumpAndSettle();
      expect(find.text('Native request failed'), findsOneWidget);
    }
  });

  testWidgets('reports missing native integration without inventing a decision',
      (tester) async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (_) async {
      throw MissingPluginException();
    });
    await tester.pumpWidget(const NativeFixtureApp());
    await tester.tap(find.byKey(const Key('native_confirm')));
    await tester.pumpAndSettle();
    expect(find.text('Native fixture unavailable'), findsOneWidget);
  });

  testWidgets('does not treat an invalid platform reply as a decision',
      (tester) async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (_) async => null);
    await tester.pumpWidget(const NativeFixtureApp());
    await tester.tap(find.byKey(const Key('native_confirm')));
    await tester.pumpAndSettle();
    expect(find.text('Native request failed'), findsOneWidget);
  });

  testWidgets('requests the camera only when the host enables that fixture',
      (tester) async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      expect(call.method, 'camera');
      return 'granted';
    });
    await tester.pumpWidget(const NativeFixtureApp());
    expect(find.byKey(const Key('native_camera')), findsNothing);
    await tester.pumpWidget(const NativeFixtureApp(includeCamera: true));
    await tester.tap(find.byKey(const Key('native_camera')));
    await tester.pumpAndSettle();
    expect(find.text('Camera: granted'), findsOneWidget);
  });

  test(
      'independently reads Android permission decisions without making a request',
      () async {
    final methods = <String>[];
    final state = {
      'camera': {'granted': true, 'rationale': false},
      'microphone': {'granted': false, 'rationale': true},
    };
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      methods.add(call.method);
      return state;
    });
    expect(await readNativeFixturePermissions(), state);
    expect(methods, ['readPermissions']);
  });

  test('rejects incomplete or malformed Android permission observations',
      () async {
    Object? reply;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (_) async => reply);
    for (final invalid in [
      null,
      {
        'camera': {'granted': true, 'rationale': false}
      },
      {
        'camera': {'granted': 'true', 'rationale': false},
        'microphone': {'granted': false, 'rationale': false},
      },
    ]) {
      reply = invalid;
      await expectLater(
          readNativeFixturePermissions(), throwsA(isA<PlatformException>()));
    }
  });
}
