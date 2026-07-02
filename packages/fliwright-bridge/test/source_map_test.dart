import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() {
  setUp(() async {
    await FliwrightBridge.reset();
  });

  tearDown(() async {
    await FliwrightBridge.reset();
  });

  test('init registers source map extension', () async {
    await FliwrightBridge.initForDioMock();

    expect(
      FliwrightBridge.registry.registeredMethods,
      contains('ext.fliwright.sourceMap'),
    );
  });

  testWidgets('source map returns visible nodes and candidate files',
      (tester) async {
    final registry = ExtensionRegistry();
    SourceMapExtension.register(registry);
    await tester.pumpWidget(
      const MaterialApp(
        home: _SourceMapFixture(),
      ),
    );

    final result = await registry.invoke('ext.fliwright.sourceMap', {
      'includeFramework': 'false',
      'limit': '20',
    });

    expect(result['success'], isTrue);
    expect(result['widgetCreationTracked'], isA<bool>());
    expect(result['route'], isA<Map>());
    expect(result['candidateFiles'], isA<List>());

    final nodes =
        (result['nodes'] as List<dynamic>).cast<Map<dynamic, dynamic>>();
    expect(nodes, isNotEmpty);

    final button = nodes.firstWhere(
      (node) => node['text'] == 'Submit' || node['label'] == 'Submit',
    );
    expect(button['type'], isA<String>());
    expect(button['rect'], isA<Map>());
    expect(button['source'], isA<Map>());
  });
}

class _SourceMapFixture extends StatelessWidget {
  const _SourceMapFixture();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ElevatedButton(
          onPressed: () {},
          child: const Text('Submit'),
        ),
      ),
    );
  }
}
