import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() {
  group('FormExtractExtension', () {
    setUp(() async {
      await FliwrightBridge.reset();
    });

    test('registers ext.fliwright.extractForm on init', () async {
      await FliwrightBridge.initForDioMock();
      expect(
        FliwrightBridge.registry.registeredMethods,
        contains('ext.fliwright.extractForm'),
      );
    });

    test('returns fields array and count', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      await FliwrightBridge.initForDioMock();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.extractForm',
        {},
      );
      expect(result, contains('fields'));
      expect(result['fields'], isA<List>());
      expect(result, contains('count'));
    });

    test('returns empty fields when no EditableText in tree', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.extractForm',
        {},
      );
      expect(result['count'], equals(0));
      expect((result['fields'] as List).length, equals(0));
    });

    testWidgets('extracts stable metadata from ancestors and semantics',
        (tester) async {
      await FliwrightBridge.initForDioMock();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Semantics(
              identifier: 'login.email',
              label: 'Email address',
              child: Container(
                key: const ValueKey('emailContainer'),
                child: const TextField(
                  decoration: InputDecoration(
                    labelText: 'Username / Email',
                    hintText: 'Email',
                  ),
                ),
              ),
            ),
          ),
        ),
      );

      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.extractForm',
        {},
      );
      final fields = result['fields'] as List;
      expect(fields, hasLength(1));
      expect(fields.first, containsPair('ancestorKey', 'emailContainer'));
      expect(fields.first, containsPair('semanticsId', 'login.email'));
      expect(fields.first, containsPair('semanticsLabel', 'Email address'));
      expect(fields.first, containsPair('selector', 'semanticsId=login.email'));
    });

    testWidgets('extracts named select controls with options', (tester) async {
      await FliwrightBridge.initForDioMock();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: _NamedField<String>(
              name: 'employmentStatus',
              child: _OptionControl<String>(
                options: const ['Employed', 'Retired'],
                labelBuilder: (option) => option,
                optionSemanticsIdentifierBuilder: (option) =>
                    'field.option.$option',
              ),
            ),
          ),
        ),
      );

      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.extractForm',
        {},
      );
      final fields = result['fields'] as List;
      expect(fields, hasLength(1));
      expect(fields.first, containsPair('name', 'employmentStatus'));
      expect(fields.first, containsPair('controlType', 'select'));
      expect(fields.first['options'], hasLength(2));
      expect(fields.first['options'].first, containsPair('label', 'Employed'));
      expect(
        fields.first['options'].first,
        containsPair('semanticsId', 'field.option.Employed'),
      );
    });

    testWidgets('extracts yes no named controls as radio fields',
        (tester) async {
      await FliwrightBridge.initForDioMock();
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: _NamedField<bool>(
              name: 'usPerson',
              child: Column(children: [Text('Yes'), Text('No')]),
            ),
          ),
        ),
      );

      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.extractForm',
        {},
      );
      final fields = result['fields'] as List;
      expect(fields, hasLength(1));
      expect(fields.first, containsPair('name', 'usPerson'));
      expect(fields.first, containsPair('controlType', 'radio'));
      expect(fields.first['options'], hasLength(2));
    });
  });
}

class _NamedField<T> extends StatefulWidget {
  const _NamedField({
    required this.name,
    required this.child,
    this.value,
  });

  final String name;
  final Widget child;
  final T? value;

  @override
  State<_NamedField<T>> createState() => _NamedFieldState<T>();
}

class _NamedFieldState<T> extends State<_NamedField<T>> {
  T? get value => widget.value;

  @override
  Widget build(BuildContext context) => widget.child;
}

class _OptionControl<T> extends StatelessWidget {
  const _OptionControl({
    required this.options,
    this.labelBuilder,
    this.optionSemanticsIdentifierBuilder,
    this.labels = const {},
  });

  final List<T> options;
  final String Function(T option)? labelBuilder;
  final String Function(T option)? optionSemanticsIdentifierBuilder;
  final Map<T, String> labels;

  @override
  Widget build(BuildContext context) {
    String labelFor(T option) =>
        labelBuilder?.call(option) ?? labels[option] ?? option.toString();

    return Column(
      children: [
        for (final option in options) Text(labelFor(option)),
      ],
    );
  }
}
