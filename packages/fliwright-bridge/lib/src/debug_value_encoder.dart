class DebugValueEncoder {
  const DebugValueEncoder({
    this.maxDepth = 6,
    this.maxItems = 80,
  });

  final int maxDepth;
  final int maxItems;

  Object? encode(Object? value) => _encode(value, depth: 0, key: null);

  Object? _encode(Object? value, {required int depth, required String? key}) {
    if (_isSensitiveKey(key)) {
      return {'\$redacted': true};
    }
    if (value == null || value is bool || value is num || value is String) {
      return value;
    }
    if (value is DateTime) return value.toIso8601String();
    if (value is Duration) return value.toString();
    if (value is Uri) return value.toString();
    if (value is Enum) return value.name;
    if (depth >= maxDepth) return _truncated(value);

    if (value is Map) {
      return _encodeMap(value, depth);
    }
    if (value is Iterable) {
      return _encodeIterable(value, depth);
    }

    final encodedJson = _tryToJson(value);
    if (encodedJson != _missingToJson) {
      return {
        '\$type': value.runtimeType.toString(),
        '\$encodedBy': 'toJson',
        'value': _encode(encodedJson, depth: depth + 1, key: null),
      };
    }

    return {
      '\$type': value.runtimeType.toString(),
      '\$display': _safeDisplay(value),
      '\$inspectable': false,
      '\$reason': 'No JSON-compatible structure or toJson() method found.',
    };
  }

  Object _encodeMap(Map<Object?, Object?> value, int depth) {
    final result = <String, Object?>{};
    var index = 0;
    for (final entry in value.entries) {
      if (index >= maxItems) {
        result['\$truncatedItems'] = value.length - maxItems;
        break;
      }
      final key = entry.key.toString();
      result[key] = _encode(entry.value, depth: depth + 1, key: key);
      index += 1;
    }
    return result;
  }

  Object _encodeIterable(Iterable<Object?> value, int depth) {
    final result = <Object?>[];
    var index = 0;
    for (final item in value) {
      if (index >= maxItems) {
        result.add({'\$truncatedItems': true});
        break;
      }
      result.add(_encode(item, depth: depth + 1, key: null));
      index += 1;
    }
    return result;
  }

  Object _truncated(Object value) {
    return {
      '\$type': value.runtimeType.toString(),
      '\$display': _safeDisplay(value),
      '\$truncated': true,
    };
  }

  Object? _tryToJson(Object value) {
    try {
      final dynamic dynamicValue = value;
      return dynamicValue.toJson();
    } catch (_) {
      return _missingToJson;
    }
  }

  String _safeDisplay(Object value) {
    try {
      return value.toString();
    } catch (_) {
      return 'Instance of ${value.runtimeType}';
    }
  }

  bool _isSensitiveKey(String? key) {
    if (key == null) return false;
    final normalized = key.toLowerCase();
    return normalized.contains('token') ||
        normalized.contains('password') ||
        normalized.contains('secret') ||
        normalized.contains('authorization') ||
        normalized.contains('cookie') ||
        normalized.contains('privatekey') ||
        normalized.contains('private_key');
  }
}

const Object _missingToJson = Object();
