import 'package:flutter/material.dart';

/// Small deterministic surface used by recording and run-artifact acceptance
/// tests. It intentionally keeps each scenario behind a stable key so a test
/// can exercise navigation, input, repeated labels, scrolling, and failures
/// without depending on the production form demo.
class RecordingFixtureApp extends StatelessWidget {
  const RecordingFixtureApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Fliwright Recording Fixture',
      theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true),
      home: const RecordingFixtureHomePage(),
    );
  }
}

class RecordingFixtureHomePage extends StatefulWidget {
  const RecordingFixtureHomePage({super.key});

  @override
  State<RecordingFixtureHomePage> createState() =>
      _RecordingFixtureHomePageState();
}

class _RecordingFixtureHomePageState extends State<RecordingFixtureHomePage> {
  int _count = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Recording fixture')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Count: $_count', key: const Key('counter_value')),
          const SizedBox(height: 8),
          FilledButton(
            key: const Key('counter_increment'),
            onPressed: () => setState(() => _count++),
            onLongPress: () => setState(() => _count += 10),
            child: const Text('Increment'),
          ),
          const SizedBox(height: 8),
          FilledButton(
            key: const Key('open_destroy_form'),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                  builder: (_) => const DestroyingFormPage()),
            ),
            child: const Text('Open form'),
          ),
          const SizedBox(height: 8),
          FilledButton(
            key: const Key('open_repeated_text'),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => const RepeatedTextPage()),
            ),
            child: const Text('Repeated text'),
          ),
          const SizedBox(height: 8),
          FilledButton(
            key: const Key('open_scroll_list'),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => const ScrollListPage()),
            ),
            child: const Text('Scroll list'),
          ),
          const SizedBox(height: 16),
          const TextField(
            key: Key('ime_input'),
            decoration: InputDecoration(
              labelText: 'IME input',
              hintText: 'Type and commit text',
            ),
            textInputAction: TextInputAction.done,
          ),
          const SizedBox(height: 8),
          const FailureProbe(),
        ],
      ),
    );
  }
}

class DestroyingFormPage extends StatefulWidget {
  const DestroyingFormPage({super.key});

  @override
  State<DestroyingFormPage> createState() => _DestroyingFormPageState();
}

class _DestroyingFormPageState extends State<DestroyingFormPage> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    final value = _controller.text;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute<void>(
        builder: (_) => SubmittedPage(value: value),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Destroying form')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            TextField(
              key: const Key('destroy_form_input'),
              controller: _controller,
              decoration: const InputDecoration(labelText: 'Form value'),
            ),
            const SizedBox(height: 12),
            FilledButton(
              key: const Key('destroy_form_submit'),
              onPressed: _submit,
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
  }
}

class SubmittedPage extends StatelessWidget {
  const SubmittedPage({required this.value, super.key});

  final String value;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Submitted')),
      body: Center(child: Text('Saved: $value', key: const Key('saved_value'))),
    );
  }
}

class RepeatedTextPage extends StatefulWidget {
  const RepeatedTextPage({super.key});

  @override
  State<RepeatedTextPage> createState() => _RepeatedTextPageState();
}

class _RepeatedTextPageState extends State<RepeatedTextPage> {
  String _saved = 'none';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Repeated text')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          FilledButton(
            key: const Key('primary_save'),
            onPressed: () => setState(() => _saved = 'primary'),
            child: const Text('Save'),
          ),
          const SizedBox(height: 12),
          OutlinedButton(
            key: const Key('secondary_save'),
            onPressed: () => setState(() => _saved = 'secondary'),
            child: const Text('Save'),
          ),
          Text('Saved: $_saved', key: const Key('repeated_saved_value')),
        ],
      ),
    );
  }
}

class ScrollListPage extends StatelessWidget {
  const ScrollListPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scroll list')),
      body: ListView.builder(
        key: const Key('fixture_scroll_list'),
        itemCount: 100,
        itemBuilder: (context, index) => ListTile(
          key: Key('scroll_item_$index'),
          title: Text('Item $index'),
        ),
      ),
    );
  }
}

class FailureProbe extends StatefulWidget {
  const FailureProbe({super.key});

  @override
  State<FailureProbe> createState() => _FailureProbeState();
}

class _FailureProbeState extends State<FailureProbe> {
  static const failOnAction = bool.fromEnvironment('FLIWRIGHT_FIXTURE_FAIL');
  String? _message;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        FilledButton(
          key: const Key('failure_probe_action'),
          onPressed: () => setState(() {
            _message =
                failOnAction ? 'Configured failure' : 'Configured success';
          }),
          child: const Text('Run failure probe'),
        ),
        if (_message != null)
          Text(_message!, key: const Key('failure_probe_result')),
      ],
    );
  }
}
