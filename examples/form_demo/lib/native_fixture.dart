import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

const _channel = MethodChannel('dev.fliwright/native_fixture');

/// Read the Android host's real checks without requesting or changing permission.
/// Rationale=false does not distinguish a fresh prompt from permanent denial.
Future<Map<String, Object?>> readNativeFixturePermissions() async {
  final result =
      await _channel.invokeMapMethod<String, Object?>('readPermissions');
  if (result == null ||
      result.length != 2 ||
      !['camera', 'microphone'].every((name) {
        final state = result[name];
        return state is Map &&
            state.length == 2 &&
            state['granted'] is bool &&
            state['rationale'] is bool;
      })) {
    throw PlatformException(code: 'invalid_fixture_permission_state');
  }
  return result;
}

/// Mobile host fixture. Decisions come from native UI and the OS permission API.
class NativeFixtureApp extends StatelessWidget {
  const NativeFixtureApp(
      {super.key, this.includeCamera = false, this.includeTextInput = false});

  final bool includeCamera;
  final bool includeTextInput;

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Fliwright native fixture',
        home: _NativeFixturePage(
            includeCamera: includeCamera, includeTextInput: includeTextInput),
      );
}

class _NativeFixturePage extends StatefulWidget {
  const _NativeFixturePage(
      {required this.includeCamera, required this.includeTextInput});

  final bool includeCamera;
  final bool includeTextInput;

  @override
  State<_NativeFixturePage> createState() => _NativeFixturePageState();
}

class _NativeFixturePageState extends State<_NativeFixturePage> {
  String message = 'Ready';
  String inputValue = '';
  bool busy = false;

  Future<void> requestInput() async {
    setState(() {
      busy = true;
      message = 'Waiting for native result';
    });
    try {
      final result =
          await _channel.invokeMapMethod<String, Object?>('textInput');
      final confirmed = result?['status'] == 'confirmed' &&
          result?.length == 2 &&
          result?['text'] is String;
      final cancelled = result?['status'] == 'cancelled' && result?.length == 1;
      if (!confirmed && !cancelled) {
        throw PlatformException(code: 'invalid_fixture_input');
      }
      if (mounted) {
        setState(() {
          message = 'Input: ${result!['status']}';
          if (confirmed) inputValue = result['text'] as String;
        });
      }
    } on PlatformException {
      if (mounted) setState(() => message = 'Native request failed');
    } on MissingPluginException {
      if (mounted) setState(() => message = 'Native fixture unavailable');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> request(String method) async {
    setState(() {
      busy = true;
      message = 'Waiting for native result';
    });
    try {
      final result = await _channel.invokeMethod<String>(method);
      final valid = method == 'microphone' || method == 'camera'
          ? const ['granted', 'denied']
          : const ['confirmed', 'cancelled'];
      if (!valid.contains(result)) {
        throw PlatformException(code: 'invalid_fixture_result');
      }
      if (mounted) {
        setState(() {
          final prefix = method == 'camera'
              ? 'Camera'
              : method == 'microphone'
                  ? 'Microphone'
                  : 'Native';
          message = '$prefix: $result';
        });
      }
    } on PlatformException {
      if (mounted) setState(() => message = 'Native request failed');
    } on MissingPluginException {
      if (mounted) setState(() => message = 'Native fixture unavailable');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Native integration fixture')),
        body: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(message, key: const Key('native_status')),
              if (widget.includeTextInput) ...[
                Text(inputValue, key: const Key('native_input_value')),
                ElevatedButton(
                  key: const Key('native_input'),
                  onPressed: busy ? null : requestInput,
                  child: const Text('Open native text input'),
                ),
              ],
              ElevatedButton(
                key: const Key('native_confirm'),
                onPressed: busy ? null : () => request('confirm'),
                child: const Text('Open native confirmation'),
              ),
              ElevatedButton(
                key: const Key('native_microphone'),
                onPressed: busy ? null : () => request('microphone'),
                child: const Text('Request microphone'),
              ),
              if (widget.includeCamera)
                ElevatedButton(
                  key: const Key('native_camera'),
                  onPressed: busy ? null : () => request('camera'),
                  child: const Text('Request camera'),
                ),
            ],
          ),
        ),
      );
}
