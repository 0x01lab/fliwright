import '../bridge.dart';

class CaptureFrameExtension {
  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.captureFrame', _captureFrame);
  }

  static Future<Map<String, dynamic>> _captureFrame(
    Map<String, String> params,
  ) async {
    final includeScreenshot = (params['screenshot'] ?? 'true') != 'false';
    final includeSnapshot = (params['snapshot'] ?? 'true') != 'false';
    final includeDiagnostics = (params['diagnostics'] ?? 'true') != 'false';
    final context = await _invokeOrEmpty('ext.fliwright.context', {});
    final result = <String, dynamic>{
      'success': true,
      'frameId': 'frame-${DateTime.now().microsecondsSinceEpoch}',
      'capturedAt': DateTime.now().toIso8601String(),
      if (context['route'] != null) 'route': context['route'],
    };

    if (includeScreenshot) {
      final screenshot = await _invokeOrEmpty('ext.fliwright.screenshot', {
        'pixelRatio': params['pixelRatio'] ?? '1.0',
      });
      if (screenshot['success'] == true && screenshot['screenshot'] != null) {
        result['screenshot'] = {
          'format': screenshot['format'] ?? 'png',
          'base64': screenshot['screenshot'],
          if (screenshot['width'] != null) 'width': screenshot['width'],
          if (screenshot['height'] != null) 'height': screenshot['height'],
        };
      } else {
        result['screenshotError'] = screenshot['error'] ?? 'screenshot failed';
      }
    }

    if (includeSnapshot) {
      result['snap'] = await _invokeOrEmpty('ext.fliwright.snap', {
        'includeRects': params['includeRects'] ?? 'true',
        'includeProperties': params['includeProperties'] ?? 'false',
      });
    }

    if (includeDiagnostics) {
      final diagnostics = Map<String, dynamic>.from(
        context['diagnostics'] as Map? ?? const <String, dynamic>{},
      );
      if (context['focused'] != null) {
        diagnostics['focused'] = context['focused'];
      }
      result['diagnostics'] = diagnostics;
    }

    return result;
  }

  static Future<Map<String, dynamic>> _invokeOrEmpty(
    String method,
    Map<String, String> params,
  ) async {
    try {
      return await FliwrightBridge.registry.invoke(method, params);
    } catch (error) {
      return {'success': false, 'error': error.toString()};
    }
  }
}
