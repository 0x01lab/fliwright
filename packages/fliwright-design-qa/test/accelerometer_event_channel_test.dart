import 'package:fliwright_design_qa/fliwright_design_qa.dart';
import 'package:test/test.dart';

void main() {
  test('maps native accelerometer map events', () {
    final sample = designQaAccelerationSampleFromEvent({
      'x': 1,
      'y': '2.5',
      'z': 3.25,
      'timestampMs': 1784160000123,
    });

    expect(sample.x, 1);
    expect(sample.y, 2.5);
    expect(sample.z, 3.25);
    expect(sample.at.toUtc().toIso8601String(), '2026-07-16T00:00:00.123Z');
  });

  test('maps native accelerometer list events', () {
    final sample = designQaAccelerationSampleFromEvent([
      4,
      5,
      6,
      '2026-07-16T00:00:00Z',
    ]);

    expect(sample.x, 4);
    expect(sample.y, 5);
    expect(sample.z, 6);
    expect(sample.at.toUtc().toIso8601String(), '2026-07-16T00:00:00.000Z');
  });

  test('rejects unsupported accelerometer event shapes', () {
    expect(
      () => designQaAccelerationSampleFromEvent('not-an-event'),
      throwsFormatException,
    );
  });
}
