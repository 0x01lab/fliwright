import 'dart:convert';
import 'dart:typed_data';

import 'package:fliwright_design_qa/fliwright_design_qa.dart';
import 'package:test/test.dart';

void main() {
  final device = DesignQaDeviceContext(
    model: 'iPhone test',
    platform: 'ios',
    osVersion: '18.0',
    screenWidth: 390,
    screenHeight: 844,
    appVersionBuild: '1.2.3+4',
    capturedAt: DateTime.utc(2026, 7, 16, 1, 2, 3),
  );

  test('chunks captures using the protocol 16 KiB maximum', () {
    final bytes = Uint8List.fromList(
      List<int>.generate(20000, (index) => index % 256),
    );

    final chunks = designQaChunkBytes(bytes);

    expect(chunks, hasLength(2));
    expect(chunks.first.length, designQaMaxChunkBytes);
    expect(chunks.last.length, 20000 - designQaMaxChunkBytes);
  });

  test('renders capture-start and eof control frames', () {
    final bytes = Uint8List.fromList([1, 2, 3, 4]);
    final capture = DesignQaCapture(pngBytes: bytes, device: device);

    final start = designQaCaptureStartMessage(
      sessionId: 'session-1',
      transferId: 'transfer-1',
      capture: capture,
      chunkBytes: 2,
    );
    final eof = designQaCaptureEofMessage(
      sessionId: 'session-1',
      transferId: 'transfer-1',
      bytes: bytes,
      chunkBytes: 2,
    );

    expect(start['type'], 'capture-start');
    expect(start['totalBytes'], 4);
    expect(start['chunkBytes'], 2);
    expect(start['chunkCount'], 2);
    expect((start['device'] as Map<String, Object?>)['screenWidth'], 390);
    expect(eof['type'], 'capture-eof');
    expect(eof['sha256'], designQaSha256Hex(bytes));

    final encoded = jsonDecode(designQaSerializeControl(start));
    expect(encoded['version'], 2);
  });
}
