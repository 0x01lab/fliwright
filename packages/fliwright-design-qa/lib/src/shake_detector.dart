import 'dart:math' as math;

class DesignQaAccelerationSample {
  const DesignQaAccelerationSample({
    required this.x,
    required this.y,
    required this.z,
    required this.at,
  });

  final double x;
  final double y;
  final double z;
  final DateTime at;

  double get magnitude => math.sqrt(x * x + y * y + z * z);
}

class DesignQaShakeDetector {
  DesignQaShakeDetector({
    this.thresholdGravity = 2.2,
    this.debounce = const Duration(milliseconds: 1800),
    DateTime? Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final double thresholdGravity;
  final Duration debounce;
  final DateTime? Function() _clock;
  DateTime? _lastShakeAt;

  bool addSample(DesignQaAccelerationSample sample) {
    final normalizedForce = sample.magnitude / 9.80665;
    if (normalizedForce < thresholdGravity) {
      return false;
    }

    final now = _clock() ?? sample.at;
    final lastShakeAt = _lastShakeAt;
    if (lastShakeAt != null && now.difference(lastShakeAt) < debounce) {
      return false;
    }

    _lastShakeAt = now;
    return true;
  }

  void reset() {
    _lastShakeAt = null;
  }
}
