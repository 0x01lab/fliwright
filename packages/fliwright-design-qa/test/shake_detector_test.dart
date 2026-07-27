import 'package:fliwright_design_qa/fliwright_design_qa.dart';
import 'package:test/test.dart';

void main() {
  test('uses a practical 2.2 g default threshold', () {
    final detector = DesignQaShakeDetector();

    expect(detector.thresholdGravity, 2.2);
  });

  test('triggers only above the force threshold', () {
    var now = DateTime.utc(2026, 7, 16);
    final detector = DesignQaShakeDetector(clock: () => now);

    expect(
      detector.addSample(
        DesignQaAccelerationSample(x: 0, y: 0, z: 9.8, at: now),
      ),
      isFalse,
    );

    expect(
      detector.addSample(
        DesignQaAccelerationSample(x: 30, y: 0, z: 0, at: now),
      ),
      isTrue,
    );
  });

  test('debounces repeated shake samples', () {
    var now = DateTime.utc(2026, 7, 16);
    final detector = DesignQaShakeDetector(clock: () => now);
    final sample = DesignQaAccelerationSample(x: 30, y: 0, z: 0, at: now);

    expect(detector.addSample(sample), isTrue);
    now = now.add(const Duration(milliseconds: 500));
    expect(detector.addSample(sample), isFalse);
    now = now.add(const Duration(seconds: 2));
    expect(detector.addSample(sample), isTrue);
  });
}
