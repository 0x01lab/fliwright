import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:flutter/material.dart';

/// Consumer demo for app-owned fixed camera results. The test entrypoint owns
/// the camera implementation; this screen only reacts to its returned result.
class CameraFixtureApp extends StatelessWidget {
  const CameraFixtureApp({
    super.key,
    required this.capture,
    required this.upload,
  });

  final Future<FliwrightCameraTestResult> Function() capture;
  final Future<void> Function(FliwrightCameraImageResult) upload;

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Camera test fixture',
    home: _CameraPage(capture: capture, upload: upload),
  );
}

class _CameraPage extends StatefulWidget {
  const _CameraPage({required this.capture, required this.upload});
  final Future<FliwrightCameraTestResult> Function() capture;
  final Future<void> Function(FliwrightCameraImageResult) upload;

  @override
  State<_CameraPage> createState() => _CameraPageState();
}

class _CameraPageState extends State<_CameraPage> {
  FliwrightCameraImageResult? selected;
  String message = 'Ready';
  bool busy = false;

  Future<void> capture() async {
    setState(() {
      busy = true;
    });
    try {
      final result = await widget.capture();
      if (!mounted) return;
      setState(() {
        switch (result) {
          case FliwrightCameraImageResult():
            selected = result;
            message = 'Preview ready';
          case FliwrightCameraCancelledResult():
            message = 'Capture cancelled';
          case FliwrightCameraErrorResult():
            message = result.message;
        }
      });
    } catch (_) {
      if (mounted)
        setState(() {
          message = 'Camera request failed';
        });
    } finally {
      if (mounted)
        setState(() {
          busy = false;
        });
    }
  }

  Future<void> upload() async {
    final image = selected;
    if (image == null) return;
    setState(() {
      busy = true;
    });
    try {
      await widget.upload(image);
      if (mounted)
        setState(() {
          message = 'Uploaded: ${image.fixtureId}';
        });
    } catch (_) {
      if (mounted)
        setState(() {
          message = 'Upload failed';
        });
    } finally {
      if (mounted)
        setState(() {
          busy = false;
        });
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Camera fixture')),
    body: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (selected case final image?) ...[
            Image.memory(
              image.bytes,
              key: const Key('camera_preview'),
              width: 160,
              height: 160,
            ),
            Text(
              'Selected: ${image.fixtureId}',
              key: const Key('camera_selected'),
            ),
          ] else
            const Text('No image selected', key: Key('camera_selected')),
          Text(message, key: const Key('camera_status')),
          const SizedBox(height: 16),
          ElevatedButton(
            key: const Key('camera_capture'),
            onPressed: busy ? null : capture,
            child: const Text('Capture / Retake'),
          ),
          ElevatedButton(
            key: const Key('camera_upload'),
            onPressed: busy || selected == null ? null : upload,
            child: const Text('Upload'),
          ),
        ],
      ),
    ),
  );
}
