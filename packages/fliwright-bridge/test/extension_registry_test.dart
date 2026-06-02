import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:fliwright_bridge/src/extensions/inspect.dart';
import 'package:fliwright_bridge/src/extensions/type_extension.dart';

void main() {
  group('ExtensionRegistry', () {
    late ExtensionRegistry registry;

    setUp(() {
      registry = ExtensionRegistry();
    });

    test('registers and invokes a handler', () async {
      registry.register('ext.test.ping', (params) async {
        return {'echo': params['message'] ?? 'none'};
      });
      expect(registry.isRegistered('ext.test.ping'), isTrue);
      final result =
          await registry.invoke('ext.test.ping', {'message': 'hello'});
      expect(result, equals({'echo': 'hello'}));
    });

    test('throws when registering non-ext method', () {
      expect(() => registry.register('bad.method', (_) async => {}),
          throwsA(isA<ArgumentError>()));
    });

    test('throws when registering duplicate method', () {
      registry.register('ext.test.dup', (_) async => {});
      expect(() => registry.register('ext.test.dup', (_) async => {}),
          throwsA(isA<StateError>()));
    });

    test('throws when invoking unregistered method', () {
      expect(() => registry.invoke('ext.test.missing', {}),
          throwsA(isA<StateError>()));
    });

    test('lists registered methods', () {
      registry.register('ext.test.a', (_) async => {});
      registry.register('ext.test.b', (_) async => {});
      expect(registry.registeredMethods,
          containsAll(['ext.test.a', 'ext.test.b']));
    });
  });

  group('FliwrightBridge', () {
    setUp(() async {
      await FliwrightBridge.reset();
    });

    test('init registers core extensions', () async {
      await FliwrightBridge.init();
      final methods = FliwrightBridge.registry.registeredMethods;
      expect(methods, contains('ext.fliwright.ping'));
      expect(methods, contains('ext.fliwright.handshake'));
    });
  });

  group('RiverpodExtension', () {
    setUp(() async {
      await FliwrightBridge.reset();
    });

    test('registers riverpod extensions on init', () async {
      await FliwrightBridge.init();
      final methods = FliwrightBridge.registry.registeredMethods;
      expect(methods, contains('ext.fliwright.riverpod.list'));
      expect(methods, contains('ext.fliwright.riverpod.read'));
      expect(methods, contains('ext.fliwright.riverpod.override'));
      expect(methods, contains('ext.fliwright.riverpod.watch'));
      expect(methods, contains('ext.fliwright.riverpod.unwatch'));
    });

    test('read returns error when provider name is missing', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry
          .invoke('ext.fliwright.riverpod.read', {});
      expect(result, contains('error'));
    });

    test('watch returns error when provider name is missing', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry
          .invoke('ext.fliwright.riverpod.watch', {});
      expect(result, contains('error'));
    });
  });

  group('GestureExtension', () {
    setUp(() async {
      await FliwrightBridge.reset();
    });

    test('registers click extension on init', () async {
      await FliwrightBridge.init();
      final methods = FliwrightBridge.registry.registeredMethods;
      expect(methods, contains('ext.fliwright.click'));
    });

    test('click returns error when x or y is missing', () async {
      await FliwrightBridge.init();
      final result =
          await FliwrightBridge.registry.invoke('ext.fliwright.click', {});
      expect(result, contains('error'));
    });

    test('registers gesture extension', () async {
      await FliwrightBridge.init();
      final methods = FliwrightBridge.registry.registeredMethods;
      expect(methods, contains('ext.fliwright.gesture'));
    });

    test('gesture returns error when gesture type is missing', () async {
      await FliwrightBridge.init();
      final result =
          await FliwrightBridge.registry.invoke('ext.fliwright.gesture', {
        'selector': 'text=Hello',
      });
      expect(result, contains('error'));
      expect(result['error'], contains('gesture'));
    });

    test('gesture returns error for unknown gesture type', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      await FliwrightBridge.init();
      // Override inspect to return a widget so the gesture type check is reached
      FliwrightBridge.registry.reset();
      FliwrightBridge.registry.register('ext.fliwright.inspect',
          (params) async {
        return {
          'widgets': [
            {
              'id': '1',
              'type': 'Text',
              'rect': {'x': 0, 'y': 0, 'width': 100, 'height': 50},
              'properties': {},
            },
          ],
        };
      });
      GestureExtension.register(FliwrightBridge.registry);

      final result =
          await FliwrightBridge.registry.invoke('ext.fliwright.gesture', {
        'gesture': 'swipe',
        'selector': 'text=Hello',
      });
      expect(result, contains('error'));
      expect(result['error'], contains('Unknown gesture type'));
    });

    test('gesture returns error when selector is missing', () async {
      await FliwrightBridge.init();
      final result =
          await FliwrightBridge.registry.invoke('ext.fliwright.gesture', {
        'gesture': 'longPress',
      });
      expect(result, contains('error'));
      expect(result['error'], contains('selector'));
    });
  });

  group('InspectExtension', () {
    setUp(() async {
      await FliwrightBridge.reset();
    });

    test('registers inspect extension on init', () async {
      await FliwrightBridge.init();
      final methods = FliwrightBridge.registry.registeredMethods;
      expect(methods, contains('ext.fliwright.inspect'));
    });

    test('inspect supports ancestorSelector for composite matching', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.inspect',
        {'selector': 'byType=Text', 'ancestorSelector': 'byType=LoginForm'},
      );
      // Should return without error even though no LoginForm exists in the
      // test tree — the point is that ancestorSelector is accepted and
      // processed without throwing.
      expect(result, contains('widgets'));
    });

    testWidgets('inspect supports id selector', (tester) async {
      InspectExtension.register(FliwrightBridge.registry);
      await tester.pumpWidget(
        const Directionality(
          textDirection: TextDirection.ltr,
          child: Text('Login'),
        ),
      );

      final textResult = await FliwrightBridge.registry.invoke(
        'ext.fliwright.inspect',
        {'selector': 'text=Login'},
      );
      final widgets = textResult['widgets'] as List;
      expect(widgets, isNotEmpty);
      final id = widgets.first['id'] as String;

      final idResult = await FliwrightBridge.registry.invoke(
        'ext.fliwright.inspect',
        {'selector': 'id=$id'},
      );
      final idWidgets = idResult['widgets'] as List;
      expect(idWidgets, hasLength(1));
      expect(idWidgets.first['id'], id);
      expect(idWidgets.first['text'], 'Login');
    });
  });

  group('ScrollExtension', () {
    setUp(() async {
      await FliwrightBridge.reset();
    });

    test('registers scrollIntoView extension on init', () async {
      await FliwrightBridge.init();
      final methods = FliwrightBridge.registry.registeredMethods;
      expect(methods, contains('ext.fliwright.scrollIntoView'));
    });

    test('scrollIntoView returns error when selector is missing', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.scrollIntoView',
        {},
      );
      expect(result, contains('error'));
      expect(result['success'], isFalse);
    });

    test('scrollIntoView returns error when no widget found', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.scrollIntoView',
        {'selector': 'text=NonExistent'},
      );
      expect(result, contains('error'));
      expect(result['success'], isFalse);
    });
  });

  group('TypeExtension', () {
    setUp(() async {
      await FliwrightBridge.reset();
    });

    test('registers type extension on init', () async {
      await FliwrightBridge.init();
      final methods = FliwrightBridge.registry.registeredMethods;
      expect(methods, contains('ext.fliwright.type'));
    });

    test('type returns error when selector is missing', () async {
      await FliwrightBridge.init();
      final result =
          await FliwrightBridge.registry.invoke('ext.fliwright.type', {});
      expect(result, contains('error'));
      expect(result['error'], contains('selector'));
    });

    test('type returns error when text is missing', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.type',
        {'selector': 'text=Hello'},
      );
      expect(result, contains('error'));
      expect(result['error'], contains('text'));
    });

    test('type returns error when no widget found', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.type',
        {'selector': 'text=NonExistent', 'text': 'hello'},
      );
      expect(result, contains('error'));
      expect(result['success'], isFalse);
    });

    testWidgets('type fills a TextField when selector matches label text',
        (tester) async {
      final controller = TextEditingController();
      addTearDown(controller.dispose);

      InspectExtension.register(FliwrightBridge.registry);
      FliwrightBridge.registry.register('ext.fliwright.click', (_) async {
        return {'success': true};
      });
      TypeExtension.register(FliwrightBridge.registry);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Center(
              child: SizedBox(
                width: 320,
                child: TextField(
                  controller: controller,
                  decoration: const InputDecoration(
                    labelText: 'Username / Email',
                  ),
                ),
              ),
            ),
          ),
        ),
      );

      final result = await tester.runAsync(() {
        return FliwrightBridge.registry.invoke(
          'ext.fliwright.type',
          {
            'selector': 'text=Username / Email',
            'text': 'user@example.com',
            'replaceAll': 'true',
          },
        );
      });

      expect(result, isNotNull);
      final typeResult = result!;
      expect(typeResult['success'], isTrue);
      expect(controller.text, 'user@example.com');
    });

    testWidgets('type fills custom editable text by ancestor name',
        (tester) async {
      final controller = TextEditingController();
      final focusNode = FocusNode(debugLabel: 'jobPosition');
      addTearDown(controller.dispose);
      addTearDown(focusNode.dispose);

      InspectExtension.register(FliwrightBridge.registry);
      FliwrightBridge.registry.register('ext.fliwright.click', (_) async {
        focusNode.requestFocus();
        await tester.pump();
        return {'success': true};
      });
      TypeExtension.register(FliwrightBridge.registry);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: _NamedField<String>(
              name: 'jobPosition',
              child: Center(
                child: SizedBox(
                  width: 320,
                  height: 48,
                  child: EditableText(
                    controller: controller,
                    focusNode: focusNode,
                    style: const TextStyle(color: Colors.black),
                    cursorColor: Colors.black,
                    backgroundCursorColor: Colors.transparent,
                  ),
                ),
              ),
            ),
          ),
        ),
      );

      final result = await tester.runAsync(() {
        return FliwrightBridge.registry.invoke(
          'ext.fliwright.type',
          {
            'selector': 'name=jobPosition',
            'text': 'Delectatio carpo vivo benevolentia solus.',
            'replaceAll': 'true',
          },
        );
      });

      expect(result, isNotNull);
      final typeResult = result!;
      expect(typeResult['success'], isTrue);
      expect(
        controller.text,
        'Delectatio carpo vivo benevolentia solus.',
      );
      expect(typeResult['debug']['targetType'], 'EditableText');
    });
  });
}

class _NamedField<T> extends StatefulWidget {
  const _NamedField({
    required this.name,
    required this.child,
  });

  final String name;
  final Widget child;

  @override
  State<_NamedField<T>> createState() => _NamedFieldState<T>();
}

class _NamedFieldState<T> extends State<_NamedField<T>> {
  @override
  Widget build(BuildContext context) => widget.child;
}
