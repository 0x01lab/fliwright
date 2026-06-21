import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:fliwright_bridge/src/extensions/inspect.dart';
import 'package:fliwright_bridge/src/extensions/type_extension.dart';

void main() {
  setUp(() async {
    await FliwrightBridge.reset();
    RefRegistry.resetForTesting();
  });

  tearDown(() async {
    await FliwrightBridge.reset();
  });

  test('init registers snap extension', () async {
    await FliwrightBridge.initForDioMock();

    expect(
      FliwrightBridge.registry.registeredMethods,
      contains('ext.fliwright.snap'),
    );
  });

  testWidgets('snap returns agent-readable refs', (tester) async {
    final registry = ExtensionRegistry();
    SnapExtension.register(registry);
    await tester.pumpWidget(_snapFixture());

    final result = await registry.invoke('ext.fliwright.snap', {});

    expect(result['groupId'], isA<String>());
    expect(result['snapshot'], contains('[ref=e'));

    final refs = result['refs'] as List<dynamic>;
    final submit = refs.cast<Map<String, dynamic>>().firstWhere(
      (entry) => entry['label'] == 'Submit' && entry['role'] == 'button',
    );

    expect(submit['ref'], startsWith('e'));
    expect(submit['rect'], isA<Map>());
    expect(submit['textField'], isFalse);

    final registryEntry = RefRegistry.lookupEntry(submit['ref'] as String);
    expect(registryEntry, isNotNull);
    expect(registryEntry!.label, 'Submit');
    expect(registryEntry.role, 'button');
  });

  testWidgets('snap can omit rects from response', (tester) async {
    final registry = ExtensionRegistry();
    SnapExtension.register(registry);
    await tester.pumpWidget(_snapFixture());

    final result = await registry.invoke('ext.fliwright.snap', {
      'includeRects': 'false',
    });

    final refs = (result['refs'] as List<dynamic>).cast<Map<String, dynamic>>();
    expect(refs, isNotEmpty);
    expect(refs.first, isNot(contains('rect')));
  });

  testWidgets('action can tap a snapshot ref', (tester) async {
    final clicks = <Map<String, String>>[];
    FliwrightBridge.registry.reset();
    SnapExtension.register(FliwrightBridge.registry);
    InspectExtension.register(FliwrightBridge.registry);
    FliwrightBridge.registry.register('ext.fliwright.click', (params) async {
      clicks.add(params);
      return {'success': true};
    });
    await tester.pumpWidget(_snapFixture());

    final snap = await FliwrightBridge.registry.invoke(
      'ext.fliwright.snap',
      {},
    );
    final snappedRef =
        (snap['refs'] as List<dynamic>).first as Map<String, dynamic>;
    final ref = snappedRef['ref'] as String;
    final rect = snappedRef['rect'] as Map<String, dynamic>;
    final expectedX = (rect['x'] as num) + (rect['width'] as num) / 2;
    final expectedY = (rect['y'] as num) + (rect['height'] as num) / 2;

    final result = await FliwrightBridge.registry.invoke(
      'ext.fliwright.action',
      {'action': 'tap', 'ref': ref},
    );

    expect(result['success'], isTrue);
    expect(clicks, hasLength(1));
    expect(double.parse(clicks.first['x']!), closeTo(expectedX, 0.1));
    expect(double.parse(clicks.first['y']!), closeTo(expectedY, 0.1));
  });

  testWidgets('action uses precomputed target rect without resolving selector', (
    tester,
  ) async {
    final types = <Map<String, String>>[];
    FliwrightBridge.registry.reset();
    InspectExtension.register(FliwrightBridge.registry);
    FliwrightBridge.registry.register('ext.fliwright.type', (params) async {
      types.add(params);
      return {'success': true};
    });
    await tester.pumpWidget(_snapFixture());

    final result = await FliwrightBridge.registry.invoke(
      'ext.fliwright.action',
      {
        'action': 'fill',
        'selector': '{"match":{"text":"does-not-exist"}}',
        'targetId': 'precomputed-email',
        'targetRect': '{"x":20,"y":40,"width":300,"height":48}',
        'text': 'exact@example.com',
      },
    );

    expect(result['success'], isTrue);
    expect(types, hasLength(1));
    expect(types.single['targetId'], 'precomputed-email');
    expect(types.single['targetRect'], '{"x":20,"y":40,"width":300,"height":48}');
    expect(types.single['replaceAll'], 'true');
  });

  testWidgets('extended actions can target snapshot refs', (tester) async {
    final clicks = <Map<String, String>>[];
    final hovers = <Map<String, String>>[];
    final types = <Map<String, String>>[];
    final gestures = <Map<String, String>>[];
    FliwrightBridge.registry.reset();
    SnapExtension.register(FliwrightBridge.registry);
    InspectExtension.register(FliwrightBridge.registry);
    FliwrightBridge.registry.register('ext.fliwright.click', (params) async {
      clicks.add(params);
      return {'success': true};
    });
    FliwrightBridge.registry.register('ext.fliwright.hover', (params) async {
      hovers.add(params);
      return {'success': true};
    });
    FliwrightBridge.registry.register('ext.fliwright.type', (params) async {
      types.add(params);
      return {'success': true};
    });
    FliwrightBridge.registry.register('ext.fliwright.gesture', (params) async {
      gestures.add(params);
      return {'success': true};
    });
    await tester.pumpWidget(_snapFixture());

    final snap = await FliwrightBridge.registry.invoke(
      'ext.fliwright.snap',
      {},
    );
    final ref =
        ((snap['refs'] as List<dynamic>).first as Map<String, dynamic>)['ref']
            as String;

    await FliwrightBridge.registry.invoke('ext.fliwright.action', {
      'action': 'doubleClick',
      'ref': ref,
    });
    await FliwrightBridge.registry.invoke('ext.fliwright.action', {
      'action': 'rightClick',
      'ref': ref,
    });
    await FliwrightBridge.registry.invoke('ext.fliwright.action', {
      'action': 'hover',
      'ref': ref,
    });
    await FliwrightBridge.registry.invoke('ext.fliwright.action', {
      'action': 'clear',
      'ref': ref,
    });
    await FliwrightBridge.registry.invoke('ext.fliwright.action', {
      'action': 'semanticDrag',
      'ref': ref,
      'direction': 'down',
    });
    await FliwrightBridge.registry.invoke('ext.fliwright.action', {
      'action': 'slideTo',
      'ref': ref,
      'targetX': '240',
    });

    expect(clicks, hasLength(3));
    expect(clicks.last['button'], 'right');
    expect(hovers, hasLength(1));
    expect(types, hasLength(1));
    expect(types.single['text'], '');
    expect(types.single['replaceAll'], 'true');
    expect(gestures.map((entry) => entry['gesture']), [
      'semanticDrag',
      'slideTo',
    ]);
  });

  testWidgets('q refs resolve against the live widget tree for actions', (
    tester,
  ) async {
    final clicks = <Map<String, String>>[];
    FliwrightBridge.registry.reset();
    InspectExtension.register(FliwrightBridge.registry);
    FliwrightBridge.registry.register('ext.fliwright.click', (params) async {
      clicks.add(params);
      return {'success': true};
    });
    await tester.pumpWidget(_snapFixture());

    final ref = RefRegistry.registerQuery(
      const QueryRef(text: 'Submit', role: 'button'),
    );
    final result = await FliwrightBridge.registry.invoke(
      'ext.fliwright.action',
      {'action': 'tap', 'ref': ref},
    );

    expect(result['success'], isTrue);
    expect(clicks, hasLength(1));
  });

  testWidgets('pressKey can edit a ref-backed text field', (tester) async {
    final controller = TextEditingController(text: 'alice');
    FliwrightBridge.registry.reset();
    SnapExtension.register(FliwrightBridge.registry);
    InspectExtension.register(FliwrightBridge.registry);
    TypeExtension.register(FliwrightBridge.registry);
    FliwrightBridge.registry.register('ext.fliwright.click', (_) async {
      return {'success': true};
    });
    await tester.pumpWidget(
      MaterialApp(
        home: Semantics(
          textField: true,
          label: 'Email',
          child: Material(child: TextField(controller: controller)),
        ),
      ),
    );

    final snap = await FliwrightBridge.registry.invoke(
      'ext.fliwright.snap',
      {},
    );
    final ref =
        ((snap['refs'] as List<dynamic>).firstWhere(
                  (entry) =>
                      (entry as Map<String, dynamic>)['role'] == 'textbox',
                )
                as Map<String, dynamic>)['ref']
            as String;

    final result = await FliwrightBridge.registry.invoke(
      'ext.fliwright.action',
      {
        'action': 'pressKey',
        'ref': ref,
        'key': 'Backspace',
        'checkStable': 'false',
      },
    );

    expect(result['success'], isTrue);
    expect(controller.text, 'alic');
  });

  testWidgets('setCheckbox only taps when the requested state differs', (
    tester,
  ) async {
    final clicks = <Map<String, String>>[];
    FliwrightBridge.registry.reset();
    SnapExtension.register(FliwrightBridge.registry);
    InspectExtension.register(FliwrightBridge.registry);
    FliwrightBridge.registry.register('ext.fliwright.click', (params) async {
      clicks.add(params);
      return {'success': true};
    });
    await tester.pumpWidget(
      MaterialApp(
        home: Material(
          child: Semantics(
            label: 'Accept',
            child: Checkbox(value: false, onChanged: (_) {}),
          ),
        ),
      ),
    );

    final snap = await FliwrightBridge.registry.invoke(
      'ext.fliwright.snap',
      {},
    );
    final ref =
        ((snap['refs'] as List<dynamic>).first as Map<String, dynamic>)['ref']
            as String;

    await FliwrightBridge.registry.invoke('ext.fliwright.action', {
      'action': 'setCheckbox',
      'ref': ref,
      'checked': 'false',
      'checkStable': 'false',
    });
    await FliwrightBridge.registry.invoke('ext.fliwright.action', {
      'action': 'setCheckbox',
      'ref': ref,
      'checked': 'true',
      'checkStable': 'false',
    });

    expect(clicks, hasLength(1));
  });

  testWidgets('selectOption invokes a ref-backed dropdown callback', (
    tester,
  ) async {
    String? selected;
    FliwrightBridge.registry.reset();
    InspectExtension.register(FliwrightBridge.registry);
    await tester.pumpWidget(
      MaterialApp(
        home: Material(
          child: DropdownButton<String>(
            value: 'US',
            items: const [
              DropdownMenuItem(value: 'US', child: Text('United States')),
              DropdownMenuItem(value: 'CN', child: Text('China')),
            ],
            onChanged: (value) {
              selected = value;
            },
          ),
        ),
      ),
    );

    final element = tester.element(find.byType(DropdownButton<String>));
    final renderObject = element.renderObject as RenderBox;
    final rect = renderObject.localToGlobal(Offset.zero) & renderObject.size;
    final ref = RefRegistry.registerEntry(
      rect: rect,
      element: element,
      groupId: 'test',
      isTextField: false,
      role: 'button',
      label: 'Country',
    );

    final result = await FliwrightBridge.registry.invoke(
      'ext.fliwright.action',
      {
        'action': 'selectOption',
        'ref': ref,
        'value': 'CN',
        'checkStable': 'false',
      },
    );

    expect(result['success'], isTrue);
    expect(selected, 'CN');
  });
}

Widget _snapFixture() {
  return Directionality(
    textDirection: TextDirection.ltr,
    child: Semantics(
      button: true,
      label: 'Submit',
      child: const SizedBox(width: 100, height: 40),
    ),
  );
}
