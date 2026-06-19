import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:fliwright_bridge/src/extensions/inspect.dart';
import 'package:fliwright_bridge/src/extensions/query.dart';

void main() {
  testWidgets('query returns normalized matches by key and text', (
    tester,
  ) async {
    final registry = ExtensionRegistry();
    InspectExtension.register(registry);
    QueryExtension.register(registry);
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

    final keyResult = await registry.invoke('ext.fliwright.query', {
      'query': jsonEncode({'key': 'emailField'}),
      'visible': 'any',
      'limit': '1',
    });
    final keyMatches = (keyResult['matches'] as List<dynamic>)
        .cast<Map<dynamic, dynamic>>();
    expect(keyMatches.single['key'], contains('emailField'));
    expect(keyMatches.single['label'], isNotEmpty);

    final textResult = await registry.invoke('ext.fliwright.query', {
      'query': jsonEncode({'text': 'Next'}),
      'visible': 'any',
      'limit': '1',
    });
    final textMatches = (textResult['matches'] as List<dynamic>)
        .cast<Map<dynamic, dynamic>>();
    expect(textMatches.single['text'], 'Next');
    expect(textMatches.single['enabled'], isTrue);
  });
}
