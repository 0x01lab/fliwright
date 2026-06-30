import 'package:flutter/widgets.dart';

enum FliwrightFormControlType {
  textInput,
  checkbox,
  radio,
  select,
}

class FliwrightFormOption {
  const FliwrightFormOption({
    required this.label,
    this.value,
    this.semanticIdentifier,
    this.selected,
    this.enabled = true,
  });

  final String label;
  final Object? value;
  final String? semanticIdentifier;
  final bool? selected;
  final bool enabled;
}

class FliwrightFormControl extends StatelessWidget {
  const FliwrightFormControl({
    super.key,
    required this.name,
    required this.controlType,
    required this.child,
    this.value,
    this.label,
    this.semanticIdentifier,
    this.options = const <FliwrightFormOption>[],
    this.enabled = true,
  });

  final String name;
  final FliwrightFormControlType controlType;
  final Widget child;
  final Object? value;
  final String? label;
  final String? semanticIdentifier;
  final List<FliwrightFormOption> options;
  final bool enabled;

  @override
  Widget build(BuildContext context) => child;
}
