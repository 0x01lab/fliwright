import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:fliwright_bridge/src/extensions/inspect.dart';

void main() {
  testWidgets('resolve matches Flutter text, key, type, and subtype finders', (
    tester,
  ) async {
    final registry = ExtensionRegistry();
    InspectExtension.register(registry);
    await tester.pumpWidget(_finderFixture());

    final text = await _resolve(registry, {
      'match': {'text': 'Save settings'},
    });
    expect(_matches(text), isNotEmpty);

    final contains = await _resolve(registry, {
      'match': {'textContains': 'settings'},
    });
    expect(_matches(contains), isNotEmpty);

    final regex = await _resolve(registry, {
      'match': {'textRegex': '^Save settings\$'},
    });
    expect(_matches(regex), isNotEmpty);

    final key = await _resolve(registry, {
      'match': {'key': 'settings_card'},
    });
    expect(_matches(key), hasLength(1));

    final type = await _resolve(registry, {
      'match': {'type': 'ElevatedButton'},
    });
    expect(_matches(type), hasLength(1));

    final subtype = await _resolve(registry, {
      'match': {'subtype': 'StatelessWidget'},
    });
    expect(_matches(subtype), isNotEmpty);
  });

  testWidgets('resolve matches semantics, icons, and tooltips', (tester) async {
    final registry = ExtensionRegistry();
    InspectExtension.register(registry);
    await tester.pumpWidget(_finderFixture());

    final semantics = await _resolve(registry, {
      'match': {
        'semanticIdentifier': 'settings.save',
        'semanticsLabel': 'Save settings',
        'semanticsHint': 'Writes changes',
        'role': 'button',
      },
    });
    expect(_matches(semantics), hasLength(1));
    expect(_matches(semantics).single['type'], 'Semantics');

    final icon = await _resolve(registry, {
      'match': {
        'type': 'Icon',
        'iconCodePoint': Icons.save.codePoint,
        'iconFontFamily': Icons.save.fontFamily,
      },
    });
    expect(_matches(icon), hasLength(1));

    final tooltip = await _resolve(registry, {
      'match': {'tooltip': 'Delete settings'},
    });
    expect(_matches(tooltip), isNotEmpty);
  });

  testWidgets('resolve composes descendant, ancestor, and position finders', (
    tester,
  ) async {
    final registry = ExtensionRegistry();
    InspectExtension.register(registry);
    await tester.pumpWidget(_finderFixture());

    final descendant = await _resolve(registry, {
      'match': {'text': 'Save settings'},
      'within': {
        'match': {'key': 'settings_card'},
      },
    });
    expect(_matches(descendant), isNotEmpty);

    final ancestor = await _resolve(registry, {
      'match': {'key': 'settings_card'},
      'containing': {
        'match': {'text': 'Save settings'},
      },
    });
    expect(_matches(ancestor), hasLength(1));

    final second = await _resolve(registry, {
      'match': {'type': '_FinderItem'},
      'position': {'nth': 1},
    });
    expect(_matches(second), hasLength(1));
    expect(_matches(second).single['key'], contains('second_item'));
  });
}

Future<Map<String, dynamic>> _resolve(
  ExtensionRegistry registry,
  Map<String, dynamic> selector,
) async {
  return registry.invoke('ext.fliwright.resolve', {
    'selector': jsonEncode(selector),
    'strict': 'false',
    'visible': 'any',
  });
}

List<Map<String, dynamic>> _matches(Map<String, dynamic> result) {
  return (result['matches'] as List<dynamic>)
      .map((match) => Map<String, dynamic>.from(match as Map))
      .toList();
}

Widget _finderFixture() {
  return MaterialApp(
    home: Scaffold(
      body: Column(
        children: [
          Container(
            key: const ValueKey('settings_card'),
            child: Semantics(
              identifier: 'settings.save',
              label: 'Save settings',
              hint: 'Writes changes',
              button: true,
              child: const Text('Save settings'),
            ),
          ),
          ElevatedButton(
            onPressed: () {},
            child: const Text('Apply'),
          ),
          const Row(
            children: [
              Icon(Icons.save),
              Icon(Icons.delete),
            ],
          ),
          const Tooltip(
            message: 'Delete settings',
            child: Icon(Icons.delete_outline),
          ),
          const _FinderItem(
            key: ValueKey('first_item'),
            label: 'First item',
          ),
          const _FinderItem(
            key: ValueKey('second_item'),
            label: 'Second item',
          ),
        ],
      ),
    ),
  );
}

class _FinderItem extends StatelessWidget {
  const _FinderItem({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Text(label);
  }
}
