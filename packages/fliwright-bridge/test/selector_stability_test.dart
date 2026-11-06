import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:fliwright_bridge/src/extensions/inspect.dart';
import 'package:fliwright_bridge/src/extensions/scroll_extension.dart';

void main() {
  setUp(() {
    FliwrightBridge.registry.reset();
    ScrollExtension.register(FliwrightBridge.registry);
    GestureExtension.register(FliwrightBridge.registry);
  });
  testWidgets(
      'strict text resolves one logical Text and preserves standalone RichText',
      (tester) async {
    final registry = ExtensionRegistry();
    InspectExtension.register(registry);
    var taps = 0;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: ElevatedButton(
                onPressed: () {
                  taps++;
                },
                child: const Text('Save')))));
    final result = await registry.invoke('ext.fliwright.resolve', {
      'selector': jsonEncode({
        'match': {'text': 'Save'}
      }),
      'strict': 'true',
      'visible': 'hitTestable'
    });
    expect(result['count'], 1);
    expect(result['success'], true);
    final action = await registry.invoke('ext.fliwright.action', {
      'action': 'tap',
      'selector': jsonEncode({
        'match': {'text': 'Save'}
      }),
      'checkStable': 'false',
    });
    await tester.pumpAndSettle();
    expect(action['success'], true);
    expect(taps, 1);
  });
  testWidgets('scrollIntoView finds and scrolls an offscreen mounted target',
      (tester) async {
    final registry = ExtensionRegistry();
    InspectExtension.register(registry);
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: SingleChildScrollView(
                child: Column(children: [
      const SizedBox(height: 1200),
      ElevatedButton(
          key: const Key('far'), onPressed: () {}, child: const Text('Far'))
    ])))));
    final any = await registry.invoke('ext.fliwright.resolve', {
      'selector': jsonEncode({
        'match': {'key': 'far'}
      }),
      'strict': 'false',
      'visible': 'any'
    });
    final action = await registry.invoke('ext.fliwright.action', {
      'action': 'scrollIntoView',
      'selector': jsonEncode({
        'match': {'key': 'far'}
      }),
      'strict': 'true',
      'visible': 'hitTestable',
      'duration': '0'
    });
    expect(any['count'], 1);
    expect(action['success'], true);
    expect(
        tester.getRect(find.byKey(const Key('far'))).center.dy, lessThan(600));
  });
  testWidgets('strict tooltip resolves one logical control', (tester) async {
    final registry = ExtensionRegistry();
    InspectExtension.register(registry);
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: IconButton(
                tooltip: 'Save',
                onPressed: () {},
                icon: const Icon(Icons.save)))));
    final result = await registry.invoke('ext.fliwright.resolve', {
      'selector': jsonEncode({
        'match': {'tooltip': 'Save'}
      }),
      'strict': 'true',
      'visible': 'hitTestable'
    });
    expect(result['success'], true);
    expect(result['count'], 1);
  });
  testWidgets('and intersects scoped queries against the same root',
      (tester) async {
    final registry = ExtensionRegistry();
    InspectExtension.register(registry);
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: Container(
                key: const Key('scope'),
                child: ElevatedButton(
                    key: const Key('save'),
                    onPressed: () {},
                    child: const Text('Save'))))));
    final scoped = {
      'match': {'type': 'ElevatedButton'},
      'within': {
        'match': {'key': 'scope'}
      }
    };
    final first = await registry.invoke('ext.fliwright.resolve',
        {'selector': jsonEncode(scoped), 'strict': 'false', 'visible': 'any'});
    final combined = await registry.invoke('ext.fliwright.resolve', {
      'selector': jsonEncode({
        'and': [
          scoped,
          {
            'match': {'key': 'save'}
          }
        ]
      }),
      'strict': 'false',
      'visible': 'any'
    });
    expect(first['count'], 1);
    expect(combined['count'], 1);
    final ast = await registry.invoke('ext.fliwright.resolve', {
      'selector': jsonEncode({
        'kind': 'descendant',
        'of': {'kind': 'key', 'value': 'scope'},
        'matching': {
          'kind': 'match',
          'criteria': {'type': 'ElevatedButton', 'key': 'save'}
        },
      }),
      'strict': 'true'
    });
    expect(ast['success'], true);
    expect(ast['count'], 1);
  });

  testWidgets('text options and semantics match modes survive the wire',
      (tester) async {
    final registry = ExtensionRegistry();
    InspectExtension.register(registry);
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: Column(children: [
      const Text('SAVE\nsettings'),
      Semantics(
          label: 'Save settings', child: const SizedBox(width: 20, height: 20)),
      RichText(text: const TextSpan(text: 'Standalone')),
    ]))));
    Future<Map<String, dynamic>> resolve(Map<String, dynamic> match) =>
        registry.invoke('ext.fliwright.resolve', {
          'selector': jsonEncode({'match': match}),
          'strict': 'false'
        });
    expect(
        (await resolve({
          'textRegex': '^save.settings' + r'$',
          'textCaseSensitive': false,
          'textDotAll': true
        }))['count'],
        1);
    expect(
        (await resolve(
            {'textRegex': '^settings' + r'$', 'textMultiline': true}))['count'],
        1);
    expect(
        (await resolve(
            {'text': 'save\nsettings', 'textCaseSensitive': false}))['count'],
        1);
    expect(
        (await resolve(
            {'semanticsLabel': 'Save', 'semanticsMatch': 'exact'}))['count'],
        0);
    expect(
        (await resolve({
          'semanticsLabel': '^save settings' + r'$',
          'semanticsMatch': 'regex',
          'semanticsCaseSensitive': false
        }))['count'],
        1);
    expect((await resolve({'text': 'Standalone'}))['count'], 1);
  });

  testWidgets('scoped fallback is used only when the primary set is empty',
      (tester) async {
    final registry = ExtensionRegistry();
    InspectExtension.register(registry);
    await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
            body: Column(key: Key('scope'), children: [
      Text('Primary', key: Key('primary')),
      Text('Fallback'),
    ]))));
    final result = await registry.invoke('ext.fliwright.resolve', {
      'selector': jsonEncode({
        'match': {'key': 'primary'},
        'fallback': {'textContains': 'Fallback'},
        'within': {
          'match': {'key': 'scope'}
        },
      }),
      'strict': 'true'
    });
    expect(result['success'], true);
    expect((result['matches'] as List).single['key'], 'primary');
  });

  testWidgets('position visible filters before selecting an index',
      (tester) async {
    final registry = ExtensionRegistry();
    InspectExtension.register(registry);
    await tester.pumpWidget(Directionality(
        textDirection: TextDirection.ltr,
        child: Stack(children: [
          Positioned(
              top: 900,
              left: 0,
              width: 40,
              height: 40,
              child: GestureDetector(
                  key: const Key('hidden'),
                  behavior: HitTestBehavior.opaque,
                  onTap: () {},
                  child: const SizedBox.expand())),
          Positioned(
              top: 0,
              left: 0,
              width: 40,
              height: 40,
              child: GestureDetector(
                  key: const Key('visible'),
                  behavior: HitTestBehavior.opaque,
                  onTap: () {},
                  child: const SizedBox.expand())),
        ])));
    final result = await registry.invoke('ext.fliwright.resolve', {
      'selector': jsonEncode({
        'match': {'type': 'GestureDetector'},
        'position': {'nth': 0, 'visible': true},
      }),
      'strict': 'true'
    });
    expect(result['success'], true);
    expect((result['matches'] as List).single['key'], 'visible');
  });

  testWidgets('or preserves within scope', (tester) async {
    final registry = ExtensionRegistry();
    InspectExtension.register(registry);
    await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
            body: Column(children: [
      SizedBox(
          key: Key('scope'),
          child: SizedBox(key: Key('a'), width: 10, height: 10)),
      SizedBox(key: Key('b'), width: 10, height: 10)
    ]))));
    final result = await registry.invoke('ext.fliwright.resolve', {
      'selector': jsonEncode({
        'or': [
          {
            'match': {'key': 'a'}
          },
          {
            'match': {'key': 'b'}
          }
        ],
        'within': {
          'match': {'key': 'scope'}
        }
      }),
      'strict': 'false',
      'visible': 'any'
    });
    final keys =
        (result['matches'] as List).map((m) => (m as Map)['key']).toList();
    expect(result['count'], 1);
    expect(keys, ['a']);
  });
}
