import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:fliwright_design_qa/fliwright_design_qa.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Design QA owns its optional Fliwright bridge extension', () {
    final registry = ExtensionRegistry();
    final extension = FliwrightDesignQaExtension.registerDefault(registry);
    addTearDown(extension.close);

    expect(extension, isA<DesignQaController>());
    expect(
      registry.registeredMethods,
      containsAll(FliwrightDesignQaExtension.registeredMethods),
    );
  });
}
