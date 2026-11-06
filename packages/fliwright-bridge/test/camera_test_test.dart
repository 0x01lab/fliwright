import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Uint8List image;
  late FliwrightCameraTestCapability camera;

  setUpAll(() async {
    final recorder = ui.PictureRecorder();
    ui.Canvas(recorder).drawColor(const ui.Color(0xff0099aa), ui.BlendMode.src);
    final picture = recorder.endRecording();
    final frame = await picture.toImage(2, 2);
    image = (await frame.toByteData(format: ui.ImageByteFormat.png))!
        .buffer
        .asUint8List();
    frame.dispose();
    picture.dispose();
  });

  setUp(() {
    FliwrightAppInstance.reset();
    camera = FliwrightCameraTestCapability(fixtures: {'portrait': () => image});
  });

  Future<String> reset([List<Map<String, Object?>> results = const []]) async {
    final response = await camera.invoke('reset', {'results': results})
        as Map<String, Object?>;
    return response['generation']! as String;
  }

  test('registers only when the app test entrypoint opts in', () async {
    await FliwrightBridge.initForDioMock();
    var info =
        await FliwrightBridge.registry.invoke('ext.fliwright.app.info', {});
    expect(info['capabilities'], isNot(contains('cameraTest')));
    FliwrightAppInstance.registerCapability(camera);
    final result = await FliwrightBridge.registry.invoke(
      'ext.fliwright.app.invoke',
      {'capability': 'cameraTest', 'method': 'reset', 'input': jsonEncode({})},
    );
    expect(result['success'], isTrue);
    expect(result['result'], containsPair('surface', 'app-test-seam'));
    await FliwrightBridge.reset();
  });

  test('consumes image, cancel and error exactly once in declared order',
      () async {
    final generation = await reset([
      {'kind': 'image', 'fixtureId': 'portrait'},
      {'kind': 'cancel'},
      {'kind': 'error', 'code': 'camera_unavailable', 'message': 'Try again'},
    ]);
    final photo = await camera.capture(generation: generation);
    expect(photo, isA<FliwrightCameraImageResult>());
    expect((photo as FliwrightCameraImageResult).bytes, image);
    expect(photo.fixtureId, 'portrait');
    expect(await camera.capture(generation: generation),
        isA<FliwrightCameraCancelledResult>());
    final failure = await camera.capture(generation: generation)
        as FliwrightCameraErrorResult;
    expect(failure.code, 'camera_unavailable');
    expect(failure.message, 'Try again');
    await expectLater(camera.capture(generation: generation), throwsStateError);
    final status = await camera.invoke('getStatus', {'generation': generation})
        as Map<String, Object?>;
    expect(status, containsPair('pending', 0));
    expect(status, containsPair('consumed', 3));
    expect(jsonEncode(status), isNot(contains(base64Encode(image))));
  });

  test('resets pending data and fences old attempts and late camera calls',
      () async {
    final old = await reset([
      {'kind': 'cancel'}
    ]);
    final current = await reset();
    expect(current, isNot(old));
    for (final method in ['enqueueResult', 'getStatus', 'reset']) {
      await expectLater(
        camera.invoke(method, {
          'generation': old,
          if (method == 'enqueueResult') 'result': {'kind': 'cancel'},
        }),
        throwsStateError,
      );
    }
    await expectLater(camera.capture(generation: old), throwsStateError);
    await expectLater(camera.capture(generation: current), throwsStateError);
    await camera.invoke('enqueueResult', {
      'generation': current,
      'result': {'kind': 'cancel'},
    });
    expect(await camera.capture(generation: current),
        isA<FliwrightCameraCancelledResult>());
  });

  test(
      'rejects missing fixtures, malformed bytes and host paths before queueing',
      () async {
    camera = FliwrightCameraTestCapability(fixtures: {
      'broken': () => Uint8List.fromList([0, 1, 2]),
      'invalid-png': () =>
          Uint8List.fromList([137, 80, 78, 71, 13, 10, 26, 10, 0]),
    });
    final generation = await reset();
    for (final fixture in [
      'missing',
      '/host/photo.png',
      'broken',
      'invalid-png'
    ]) {
      await expectLater(
          camera.invoke('enqueueResult', {
            'generation': generation,
            'result': {'kind': 'image', 'fixtureId': fixture},
          }),
          throwsA(predicate(
              (Object error) => error.toString().contains('fixture'))));
    }
    expect(await camera.invoke('getStatus', {'generation': generation}),
        containsPair('pending', 0));
  });

  testWidgets('bounds fixture loading and leaves no pending result on timeout',
      (tester) async {
    camera = FliwrightCameraTestCapability(fixtures: {
      'slow': () => Completer<Uint8List>().future,
    });
    final generation = await reset();
    final checked = expectLater(
        camera.invoke('enqueueResult', {
          'generation': generation,
          'result': {'kind': 'image', 'fixtureId': 'slow'},
        }),
        throwsFormatException);
    await tester.pump(const Duration(seconds: 6));
    await checked;
    expect(await camera.invoke('getStatus', {'generation': generation}),
        allOf(containsPair('pending', 0), containsPair('loading', false)));
  });

  test('does not queue a fixture loader completing after reset', () async {
    final pending = Completer<Uint8List>();
    camera =
        FliwrightCameraTestCapability(fixtures: {'slow': () => pending.future});
    final generation = await reset();
    final adding = camera.invoke('enqueueResult', {
      'generation': generation,
      'result': {'kind': 'image', 'fixtureId': 'slow'},
    });
    final checked = expectLater(adding, throwsStateError);
    final next = await reset();
    pending.complete(image);
    await checked;
    expect(await camera.invoke('getStatus', {'generation': next}),
        containsPair('pending', 0));
  });

  test('requires strict bounded inputs and an explicit generation for writes',
      () async {
    final generation = await reset();
    for (final input in [
      {
        'result': {'kind': 'cancel'}
      },
      {
        'generation': generation,
        'result': {'kind': 'cancel', 'extra': true}
      },
      {
        'generation': generation,
        'result': {'kind': 'error', 'code': ''}
      },
      {
        'generation': generation,
        'result': {'kind': 'image', 'path': '/host/p.png'}
      },
    ]) {
      await expectLater(
          camera.invoke('enqueueResult', input), throwsArgumentError);
    }
    await expectLater(
      camera.invoke('reset', {
        'results': List.filled(33, {'kind': 'cancel'})
      }),
      throwsArgumentError,
    );
    for (var i = 0; i < 32; i++) {
      await camera.invoke('enqueueResult', {
        'generation': generation,
        'result': {'kind': 'cancel'},
      });
      await camera.capture(generation: generation);
    }
    await expectLater(
        camera.invoke('enqueueResult', {
          'generation': generation,
          'result': {'kind': 'cancel'},
        }),
        throwsStateError);
  });
}
