import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() {
  setUp(() async {
    await FliwrightBridge.reset();
    await FliwrightBridge.initForDioMock();
  });

  tearDown(() async {
    await FliwrightBridge.reset();
  });

  testWidgets('query returns normalized matches by key and text', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Material(
          child: Column(
            children: [
              TextField(
                key: const Key('emailField'),
                decoration: const InputDecoration(labelText: 'Email'),
              ),
              ElevatedButton(onPressed: () {}, child: const Text('Next')),
            ],
          ),
        ),
      ),
    );

    final keyResult =
        await FliwrightBridge.registry.invoke('ext.fliwright.query', {
      'query': jsonEncode({'key': 'emailField'}),
      'visible': 'any',
      'limit': '1',
    });
    final keyMatches =
        (keyResult['matches'] as List<dynamic>).cast<Map<dynamic, dynamic>>();
    expect(keyMatches.single['key'], contains('emailField'));
    expect(keyMatches.single['label'], isNotEmpty);

    final textResult =
        await FliwrightBridge.registry.invoke('ext.fliwright.query', {
      'query': jsonEncode({'text': 'Next'}),
      'visible': 'any',
      'limit': '1',
    });
    final textMatches =
        (textResult['matches'] as List<dynamic>).cast<Map<dynamic, dynamic>>();
    expect(textMatches.single['text'], 'Next');
    expect(textMatches.single['enabled'], isTrue);
  });

  testWidgets('query resolves a live snapshot ref', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: Material(child: Text('Next'))),
    );

    final snapshot =
        await FliwrightBridge.registry.invoke('ext.fliwright.snap', {});
    final refs = snapshot['refs'] as List<dynamic>;
    final ref = (refs.first as Map<dynamic, dynamic>)['ref'] as String;
    final result =
        await FliwrightBridge.registry.invoke('ext.fliwright.query', {
      'query': jsonEncode({'ref': ref}),
    });

    expect(result['success'], isTrue);
    expect((result['matches'] as List<dynamic>).single['ref'], ref);
  });

  testWidgets('query filters refs that are not hit testable', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Material(
          child: IgnorePointer(child: Text('Blocked')),
        ),
      ),
    );

    final snapshot =
        await FliwrightBridge.registry.invoke('ext.fliwright.snap', {});
    String? ref;
    for (final candidate in snapshot['refs'] as List<dynamic>) {
      final candidateRef =
          (candidate as Map<dynamic, dynamic>)['ref'] as String;
      final candidateResult =
          await FliwrightBridge.registry.invoke('ext.fliwright.query', {
        'query': jsonEncode({'ref': candidateRef}),
      });
      final matches = candidateResult['matches'] as List<dynamic>;
      if (candidateResult['success'] == true &&
          matches.isNotEmpty &&
          (matches.single as Map<dynamic, dynamic>)['hitTestable'] == false) {
        ref = candidateRef;
        break;
      }
    }
    expect(ref, isNotNull);
    final result = await FliwrightBridge.registry.invoke(
      'ext.fliwright.query',
      {
        'query': jsonEncode({'ref': ref!}),
        'visible': 'hitTestable',
      },
    );

    expect(result['success'], isTrue);
    expect(result['matches'], isEmpty);
    expect(result['count'], 0);
  });
}
