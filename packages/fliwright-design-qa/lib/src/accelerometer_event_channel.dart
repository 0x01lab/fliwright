import 'package:flutter/services.dart';

import 'shake_detector.dart';

class DesignQaAccelerometerEventChannel {
  const DesignQaAccelerometerEventChannel({
    this.channelName = 'fliwright_design_qa/accelerometer',
  });

  final String channelName;

  Stream<DesignQaAccelerationSample> get samples {
    return EventChannel(
      channelName,
    ).receiveBroadcastStream().map(designQaAccelerationSampleFromEvent);
  }
}

DesignQaAccelerationSample designQaAccelerationSampleFromEvent(Object? event) {
  if (event is Map) {
    return DesignQaAccelerationSample(
      x: _readDouble(event, const ['x', 'accelerationX']),
      y: _readDouble(event, const ['y', 'accelerationY']),
      z: _readDouble(event, const ['z', 'accelerationZ']),
      at: _readTimestamp(event),
    );
  }

  if (event is List && event.length >= 3) {
    return DesignQaAccelerationSample(
      x: _asDouble(event[0], 'x'),
      y: _asDouble(event[1], 'y'),
      z: _asDouble(event[2], 'z'),
      at: event.length >= 4 ? _timestampFromValue(event[3]) : DateTime.now(),
    );
  }

  throw FormatException(
    'Design QA accelerometer event must be a map or list.',
    event,
  );
}

double _readDouble(Map<dynamic, dynamic> map, List<String> keys) {
  for (final key in keys) {
    if (map.containsKey(key)) {
      return _asDouble(map[key], key);
    }
  }
  throw FormatException('Missing accelerometer value: ${keys.first}', map);
}

double _asDouble(Object? value, String key) {
  if (value is num) {
    return value.toDouble();
  }
  if (value is String) {
    final parsed = double.tryParse(value);
    if (parsed != null) {
      return parsed;
    }
  }
  throw FormatException('Invalid accelerometer value: $key', value);
}

DateTime _readTimestamp(Map<dynamic, dynamic> map) {
  for (final key in const ['timestampMs', 'timestampMillis', 'timeMs']) {
    if (map.containsKey(key)) {
      return _timestampFromValue(map[key]);
    }
  }
  for (final key in const ['timestamp', 'at']) {
    if (map.containsKey(key)) {
      return _timestampFromValue(map[key]);
    }
  }
  return DateTime.now();
}

DateTime _timestampFromValue(Object? value) {
  if (value is DateTime) {
    return value;
  }
  if (value is int) {
    return DateTime.fromMillisecondsSinceEpoch(
      value < 1000000000000 ? value * 1000 : value,
      isUtc: true,
    );
  }
  if (value is num) {
    return DateTime.fromMillisecondsSinceEpoch(
      value < 1000000000000 ? (value * 1000).round() : value.round(),
      isUtc: true,
    );
  }
  if (value is String) {
    final parsed = DateTime.tryParse(value);
    if (parsed != null) {
      return parsed;
    }
    final numeric = num.tryParse(value);
    if (numeric != null) {
      return _timestampFromValue(numeric);
    }
  }
  throw FormatException('Invalid accelerometer timestamp.', value);
}
