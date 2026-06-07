import 'package:flutter/widgets.dart';

/// Snapshot-time reference to a live Flutter element.
class RefEntry {
  const RefEntry({
    required this.rect,
    required this.element,
    required this.groupId,
    required this.isTextField,
    this.renderObject,
    this.semanticsId,
    this.role,
    this.label,
    this.enabled,
    this.metadata = const <String, Object?>{},
  });

  final Rect rect;
  final Element element;
  final String groupId;
  final bool isTextField;
  final RenderObject? renderObject;
  final int? semanticsId;
  final String? role;
  final String? label;
  final bool? enabled;
  final Map<String, Object?> metadata;
}

/// Re-resolvable query handle for agent-facing actions.
class QueryRef {
  const QueryRef({
    this.text,
    this.containsText,
    this.key,
    this.semanticsLabel,
    this.role,
    this.type,
  });

  final String? text;
  final String? containsText;
  final String? key;
  final String? semanticsLabel;
  final String? role;
  final String? type;

  bool get hasPredicate =>
      text != null ||
      containsText != null ||
      key != null ||
      semanticsLabel != null ||
      role != null ||
      type != null;
}

/// Stores agent-visible `e<N>` snapshot refs and `q<N>` query refs.
class RefRegistry {
  RefRegistry._();

  static int _entryCounter = 0;
  static int _queryCounter = 0;
  static final Map<String, RefEntry> _entries = <String, RefEntry>{};
  static final Map<int, String> _bySemanticsId = <int, String>{};
  static final Map<String, QueryRef> _queries = <String, QueryRef>{};

  static String registerEntry({
    required Rect rect,
    required Element element,
    required String groupId,
    required bool isTextField,
    RenderObject? renderObject,
    int? semanticsId,
    String? role,
    String? label,
    bool? enabled,
    Map<String, Object?> metadata = const <String, Object?>{},
  }) {
    final existing = semanticsId == null ? null : _bySemanticsId[semanticsId];
    if (existing != null) {
      _entries[existing] = RefEntry(
        rect: rect,
        element: element,
        groupId: groupId,
        isTextField: isTextField,
        renderObject: renderObject,
        semanticsId: semanticsId,
        role: role,
        label: label,
        enabled: enabled,
        metadata: metadata,
      );
      return existing;
    }

    _entryCounter += 1;
    final token = 'e$_entryCounter';
    _entries[token] = RefEntry(
      rect: rect,
      element: element,
      groupId: groupId,
      isTextField: isTextField,
      renderObject: renderObject,
      semanticsId: semanticsId,
      role: role,
      label: label,
      enabled: enabled,
      metadata: metadata,
    );
    if (semanticsId != null) {
      _bySemanticsId[semanticsId] = token;
    }
    return token;
  }

  static String registerQuery(QueryRef query) {
    if (!query.hasPredicate) {
      throw ArgumentError('QueryRef requires at least one predicate');
    }
    _queryCounter += 1;
    final token = 'q$_queryCounter';
    _queries[token] = query;
    return token;
  }

  static RefEntry? lookupEntry(String ref) => _entries[ref];

  static QueryRef? lookupQuery(String ref) => _queries[ref];

  static void disposeGroup(String groupId) {
    final toRemove = <String>[];
    for (final entry in _entries.entries) {
      if (entry.value.groupId == groupId) {
        toRemove.add(entry.key);
      }
    }

    for (final token in toRemove) {
      final removed = _entries.remove(token);
      final semanticsId = removed?.semanticsId;
      if (semanticsId != null && _bySemanticsId[semanticsId] == token) {
        _bySemanticsId.remove(semanticsId);
      }
    }
  }

  static Iterable<String> activeRefs() sync* {
    yield* _entries.keys;
    yield* _queries.keys;
  }

  static List<String> refsForGroup(String groupId) {
    return _entries.entries
        .where((entry) => entry.value.groupId == groupId)
        .map((entry) => entry.key)
        .toList(growable: false);
  }

  static void disposeAll() {
    _entries.clear();
    _queries.clear();
    _bySemanticsId.clear();
    _entryCounter = 0;
    _queryCounter = 0;
  }

  static void resetForTesting() => disposeAll();
}
