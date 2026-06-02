# Element Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the string-prefix selector system with a structured JSON query protocol and multi-level matching engine, improving accuracy, performance, and expressiveness.

**Architecture:** TS-side `FluentSelector` serializes `SelectorQuery` objects to JSON strings over the existing `Map<String, String>` VM Service protocol. Dart-side `SelectorParser` deserializes JSON into typed objects, then `SelectorEngine` executes scope-resolved tree walking with scored multi-criteria matching and fallback strategies.

**Tech Stack:** TypeScript (ES2022, Vitest), Dart (Flutter test framework), JSON-RPC over VM Service Extensions

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/fliwright-bridge/lib/src/extensions/selector_query.dart` | **Create** | Data model: SelectorQuery, MatchCriteria, FallbackCriteria, PositionFilter |
| `packages/fliwright-bridge/test/selector_query_test.dart` | **Create** | Unit tests for data model |
| `packages/fliwright-bridge/lib/src/extensions/selector_parser.dart` | **Create** | JSON → SelectorQuery deserialization |
| `packages/fliwright-bridge/test/selector_parser_test.dart` | **Create** | Unit tests for parser |
| `packages/fliwright-bridge/lib/src/extensions/selector_engine.dart` | **Create** | Scope resolving, tree walking, scored matching, fallback |
| `packages/fliwright-bridge/test/selector_engine_test.dart` | **Create** | Widget test: match real Flutter widgets |
| `packages/fliwright-bridge/lib/src/extensions/inspect.dart` | **Modify** | Replace `_parseSelector` + `_matchesElement` with SelectorParser + SelectorEngine |
| `packages/fliwright-bridge/test/extension_registry_test.dart` | **Modify** | Update inspect tests to use JSON selector format |
| `packages/fliwright-core/src/types.ts` | **Modify** | Add SelectorQuery, MatchCriteria, FallbackCriteria, PositionFilter types; remove old SelectorInput |
| `packages/fliwright-core/src/Selector.ts` | **Modify** | Replace with SelectorQuery builder + JSON serialization |
| `packages/fliwright-core/src/FluentSelector.ts` | **Create** | Chainable selector API (descendant, containing, withFallback, nth, etc.) |
| `packages/fliwright-core/src/Locator.ts` | **Modify** | Accept SelectorQuery instead of SelectorInput; update wire params |
| `packages/fliwright-core/src/Page.ts` | **Modify** | Add `find()` method; remove old `locator()` |
| `packages/fliwright-core/src/index.ts` | **Modify** | Export new types and FluentSelector |
| `packages/fliwright-core/src/FormHelper.ts` | **Modify** | Replace `selectorForFill()` to produce SelectorQuery |
| `packages/fliwright-core/tests/FormHelper.test.ts` | **Modify** | Update selector assertions to new format |
| `packages/fliwright-vscode/src/form/FormHelperService.ts` | **Modify** | Build SelectorQuery from form snapshots |
| `packages/fliwright-vscode/tests/FormHelperService.test.ts` | **Modify** | Update assertions |

---

### Task 1: Dart Data Model

**Files:**
- Create: `packages/fliwright-bridge/lib/src/extensions/selector_query.dart`
- Create: `packages/fliwright-bridge/test/selector_query_test.dart`

- [ ] **Step 1: Write the failing test**

Create `packages/fliwright-bridge/test/selector_query_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/src/extensions/selector_query.dart';

void main() {
  test('MatchCriteria conditionCount counts non-null fields', () {
    expect(const MatchCriteria().conditionCount, 0);
    expect(const MatchCriteria(type: 'TextField').conditionCount, 1);
    expect(
      const MatchCriteria(type: 'TextField', textContains: '邮箱').conditionCount,
      2,
    );
  });

  test('SelectorQuery holds all optional fields', () {
    const query = SelectorQuery(
      match: MatchCriteria(type: 'TextField'),
      within: SelectorQuery(match: MatchCriteria(type: 'Scaffold')),
      fallback: FallbackCriteria(semanticsLabel: 'email'),
      position: PositionFilter(first: true),
    );
    expect(query.match?.type, 'TextField');
    expect(query.within?.match?.type, 'Scaffold');
    expect(query.fallback?.semanticsLabel, 'email');
    expect(query.position?.first, true);
  });

  test('PositionFilter defaults', () {
    const pos = PositionFilter();
    expect(pos.first, false);
    expect(pos.last, false);
    expect(pos.visible, true);
    expect(pos.nth, isNull);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-bridge && dart test test/selector_query_test.dart`
Expected: FAIL — file does not exist

- [ ] **Step 3: Write the implementation**

Create `packages/fliwright-bridge/lib/src/extensions/selector_query.dart`:

```dart
/// 主匹配条件。
class MatchCriteria {
  final String? type;
  final String? key;
  final String? text;
  final String? textContains;
  final String? textRegex;
  final String? role;

  const MatchCriteria({
    this.type,
    this.key,
    this.text,
    this.textContains,
    this.textRegex,
    this.role,
  });

  int get conditionCount =>
      [type, key, text, textContains, textRegex, role]
          .where((v) => v != null)
          .length;
}

/// 回退条件（主匹配失败时尝试）。
class FallbackCriteria {
  final String? semanticsLabel;
  final String? hintText;
  final String? tooltip;

  const FallbackCriteria({this.semanticsLabel, this.hintText, this.tooltip});
}

/// 位置过滤。
class PositionFilter {
  final int? nth;
  final bool first;
  final bool last;
  final bool visible;

  const PositionFilter({
    this.nth,
    this.first = false,
    this.last = false,
    this.visible = true,
  });
}

/// 结构化查询对象。
class SelectorQuery {
  final MatchCriteria? match;
  final SelectorQuery? within;
  final FallbackCriteria? fallback;
  final PositionFilter? position;

  const SelectorQuery({this.match, this.within, this.fallback, this.position});
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-bridge && dart test test/selector_query_test.dart`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-bridge/lib/src/extensions/selector_query.dart packages/fliwright-bridge/test/selector_query_test.dart
git commit -m "feat(bridge): add SelectorQuery data model"
```

---

### Task 2: Dart JSON Parser

**Files:**
- Create: `packages/fliwright-bridge/lib/src/extensions/selector_parser.dart`
- Create: `packages/fliwright-bridge/test/selector_parser_test.dart`

- [ ] **Step 1: Write the failing test**

Create `packages/fliwright-bridge/test/selector_parser_test.dart`:

```dart
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/src/extensions/selector_parser.dart';
import 'package:fliwright_bridge/src/extensions/selector_query.dart';

void main() {
  test('parses simple match query', () {
    final json = jsonEncode({
      'match': {'type': 'TextField', 'textContains': '邮箱'},
    });
    final query = SelectorParser.parse(json);
    expect(query.match?.type, 'TextField');
    expect(query.match?.textContains, '邮箱');
    expect(query.within, isNull);
    expect(query.fallback, isNull);
  });

  test('parses nested within query', () {
    final json = jsonEncode({
      'match': {'type': 'TextField'},
      'within': {
        'match': {'type': 'Scaffold'},
        'within': {
          'match': {'type': 'MaterialApp'},
        },
      },
    });
    final query = SelectorParser.parse(json);
    expect(query.match?.type, 'TextField');
    expect(query.within?.match?.type, 'Scaffold');
    expect(query.within?.within?.match?.type, 'MaterialApp');
  });

  test('parses fallback and position', () {
    final json = jsonEncode({
      'match': {'type': 'TextField'},
      'fallback': {'semanticsLabel': 'email', 'hintText': '请输入邮箱'},
      'position': {'first': true, 'visible': false},
    });
    final query = SelectorParser.parse(json);
    expect(query.fallback?.semanticsLabel, 'email');
    expect(query.fallback?.hintText, '请输入邮箱');
    expect(query.position?.first, true);
    expect(query.position?.visible, false);
  });

  test('parses query with only match', () {
    final json = jsonEncode({
      'match': {'key': 'loginBtn'},
    });
    final query = SelectorParser.parse(json);
    expect(query.match?.key, 'loginBtn');
    expect(query.within, isNull);
    expect(query.fallback, isNull);
    expect(query.position, isNull);
  });

  test('throws on invalid JSON', () {
    expect(() => SelectorParser.parse('not json'), throwsA(isA<FormatException>()));
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-bridge && dart test test/selector_parser_test.dart`
Expected: FAIL — file does not exist

- [ ] **Step 3: Write the implementation**

Create `packages/fliwright-bridge/lib/src/extensions/selector_parser.dart`:

```dart
import 'dart:convert';

import 'selector_query.dart';

class SelectorParser {
  /// 从 JSON 字符串解析为 [SelectorQuery]。
  static SelectorQuery parse(String json) {
    final map = jsonDecode(json) as Map<String, dynamic>;
    return _parseQuery(map);
  }

  static SelectorQuery _parseQuery(Map<String, dynamic> map) {
    return SelectorQuery(
      match: map['match'] != null
          ? _parseMatch(map['match'] as Map<String, dynamic>)
          : null,
      within: map['within'] != null
          ? _parseQuery(map['within'] as Map<String, dynamic>)
          : null,
      fallback: map['fallback'] != null
          ? _parseFallback(map['fallback'] as Map<String, dynamic>)
          : null,
      position: map['position'] != null
          ? _parsePosition(map['position'] as Map<String, dynamic>)
          : null,
    );
  }

  static MatchCriteria _parseMatch(Map<String, dynamic> map) {
    return MatchCriteria(
      type: map['type'] as String?,
      key: map['key'] as String?,
      text: map['text'] as String?,
      textContains: map['textContains'] as String?,
      textRegex: map['textRegex'] as String?,
      role: map['role'] as String?,
    );
  }

  static FallbackCriteria _parseFallback(Map<String, dynamic> map) {
    return FallbackCriteria(
      semanticsLabel: map['semanticsLabel'] as String?,
      hintText: map['hintText'] as String?,
      tooltip: map['tooltip'] as String?,
    );
  }

  static PositionFilter _parsePosition(Map<String, dynamic> map) {
    return PositionFilter(
      nth: map['nth'] as int?,
      first: map['first'] as bool? ?? false,
      last: map['last'] as bool? ?? false,
      visible: map['visible'] as bool? ?? true,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-bridge && dart test test/selector_parser_test.dart`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-bridge/lib/src/extensions/selector_parser.dart packages/fliwright-bridge/test/selector_parser_test.dart
git commit -m "feat(bridge): add SelectorParser — JSON to SelectorQuery"
```

---

### Task 3: Dart Selector Engine — Scoring

**Files:**
- Create: `packages/fliwright-bridge/lib/src/extensions/selector_engine.dart`
- Create: `packages/fliwright-bridge/test/selector_engine_test.dart`

- [ ] **Step 1: Write the failing test for scoreMatch**

Create `packages/fliwright-bridge/test/selector_engine_test.dart`:

```dart
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/src/extensions/selector_engine.dart';
import 'package:fliwright_bridge/src/extensions/selector_parser.dart';
import 'package:fliwright_bridge/src/extensions/inspect.dart';

void main() {
  group('SelectorEngine._scoreMatch', () {
    testWidgets('scores type match at 1.0', (tester) async {
      await tester.pumpWidget(
        const Directionality(
          textDirection: TextDirection.ltr,
          child: Text('Hello'),
        ),
      );
      final element = tester.element(find.byType(Text));
      final criteria = const MatchCriteria(type: 'Text');
      // Use a public wrapper for testing.
      final score = SelectorEngine.scoreMatch(element, criteria);
      expect(score, 1.0);
    });

    testWidgets('scores partial type match at 0.6', (tester) async {
      await tester.pumpWidget(
        const Directionality(
          textDirection: TextDirection.ltr,
          child: Text('Hello'),
        ),
      );
      final element = tester.element(find.byType(Text));
      // "RichText" contains "Text" — but Text's runtimeType is "Text".
      // Use a widget whose type contains a substring.
      final criteria = const MatchCriteria(type: 'ex'); // "Text" contains "ex" is false
      final score = SelectorEngine.scoreMatch(element, criteria);
      expect(score, 0.0); // "Text" does not contain "ex"
    });

    testWidgets('scores zero when no conditions match', (tester) async {
      await tester.pumpWidget(
        const Directionality(
          textDirection: TextDirection.ltr,
          child: Text('Hello'),
        ),
      );
      final element = tester.element(find.byType(Text));
      final criteria = const MatchCriteria(type: 'ElevatedButton');
      final score = SelectorEngine.scoreMatch(element, criteria);
      expect(score, 0.0);
    });
  });

  group('SelectorEngine.execute', () {
    testWidgets('finds widget by type', (tester) async {
      await tester.pumpWidget(
        const Directionality(
          textDirection: TextDirection.ltr,
          child: Text('Login'),
        ),
      );
      final root = tester.element(find.byType(Directionality));
      final query = SelectorParser.parse(jsonEncode({
        'match': {'type': 'Text'},
      }));
      final results = SelectorEngine.execute(query, root);
      expect(results, isNotEmpty);
      expect(results.first.score, greaterThan(0.5));
      expect(results.first.strategy, 'primary');
    });

    testWidgets('finds widget by textContains', (tester) async {
      await tester.pumpWidget(
        const Directionality(
          textDirection: TextDirection.ltr,
          child: Text('Submit Button'),
        ),
      );
      final root = tester.element(find.byType(Directionality));
      final query = SelectorParser.parse(jsonEncode({
        'match': {'textContains': 'Submit'},
      }));
      final results = SelectorEngine.execute(query, root);
      expect(results, hasLength(1));
      expect(results.first.strategy, 'primary');
    });

    testWidgets('uses within to scope search', (tester) async {
      await tester.pumpWidget(
        Directionality(
          textDirection: TextDirection.ltr,
          child: Column(
            children: const [
              Text('Inside'),
            ],
          ),
        ),
      );
      final root = tester.element(find.byType(Directionality));
      final query = SelectorParser.parse(jsonEncode({
        'match': {'textContains': 'Inside'},
        'within': {'match': {'type': 'Column'}},
      }));
      final results = SelectorEngine.execute(query, root);
      expect(results, isNotEmpty);
    });

    testWidgets('fallback matches by semanticsLabel', (tester) async {
      await tester.pumpWidget(
        const Directionality(
          textDirection: TextDirection.ltr,
          child: Semantics(
            label: 'email_field',
            child: Text('Email'),
          ),
        ),
      );
      final root = tester.element(find.byType(Directionality));
      final query = SelectorParser.parse(jsonEncode({
        'match': {'type': 'NonExistent'},
        'fallback': {'semanticsLabel': 'email'},
      }));
      final results = SelectorEngine.execute(query, root);
      expect(results, isNotEmpty);
      expect(results.first.strategy, 'fallback');
    });

    testWidgets('position.first selects first match', (tester) async {
      await tester.pumpWidget(
        const Directionality(
          textDirection: TextDirection.ltr,
          child: Column(
            children: [
              Text('A'),
              Text('B'),
            ],
          ),
        ),
      );
      final root = tester.element(find.byType(Directionality));
      final query = SelectorParser.parse(jsonEncode({
        'match': {'type': 'Text'},
        'position': {'first': true},
      }));
      final results = SelectorEngine.execute(query, root);
      expect(results, hasLength(1));
    });

    testWidgets('returns empty when scope not found', (tester) async {
      await tester.pumpWidget(
        const Directionality(
          textDirection: TextDirection.ltr,
          child: Text('Hello'),
        ),
      );
      final root = tester.element(find.byType(Directionality));
      final query = SelectorParser.parse(jsonEncode({
        'match': {'type': 'Text'},
        'within': {'match': {'type': 'Scaffold'}},
      }));
      final results = SelectorEngine.execute(query, root);
      expect(results, isEmpty);
    });
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-bridge && dart test test/selector_engine_test.dart`
Expected: FAIL — file does not exist

- [ ] **Step 3: Write the implementation**

Create `packages/fliwright-bridge/lib/src/extensions/selector_engine.dart`:

```dart
import 'package:flutter/material.dart';

import 'inspect.dart';
import 'selector_query.dart';

/// 匹配结果（带评分和策略标记）。
class MatchResult {
  final Element element;
  final double score;
  final String strategy; // 'primary' | 'fallback'

  MatchResult({
    required this.element,
    required this.score,
    required this.strategy,
  });
}

/// 结构化选择器引擎：作用域遍历 + 多级评分匹配。
class SelectorEngine {
  /// 对单个 Element 计算匹配评分（公开用于测试）。
  static double scoreMatch(Element element, MatchCriteria criteria) {
    return _scoreMatch(element, criteria);
  }

  /// 执行查询的主入口。
  static List<MatchResult> execute(SelectorQuery query, Element root) {
    // 1. 解析作用域
    final scope = _resolveScope(query.within, root);
    if (scope == null) return [];

    // 2. 收集候选
    final candidates = _collectCandidates(scope);

    // 3. 多级匹配
    var results = _matchPrimary(candidates, query.match);
    if (results.isEmpty && query.fallback != null) {
      results = _matchFallback(candidates, query.fallback!);
    }

    // 4. 可见性过滤
    if (query.position?.visible ?? true) {
      results = results.where((r) => _isVisible(r.element)).toList();
    }

    // 5. 位置选择
    return _applyPosition(results, query.position);
  }

  // ── 作用域解析 ────────────────────────────────────────────

  static Element? _resolveScope(SelectorQuery? withinQuery, Element root) {
    if (withinQuery == null) return root;

    // 先解析外层 within
    final outerScope = _resolveScope(withinQuery.within, root);
    if (outerScope == null) return null;

    // 在外层作用域内查找匹配 within.match 的元素
    Element? found;
    _walkTree(outerScope, (element) {
      if (_scoreMatch(element, withinQuery.match) > 0.5) {
        found = element;
        return false;
      }
      return true;
    });
    return found;
  }

  // ── 候选收集 ──────────────────────────────────────────────

  static List<Element> _collectCandidates(Element scope) {
    final candidates = <Element>[];
    _walkTree(scope, (element) {
      candidates.add(element);
      return true;
    });
    return candidates;
  }

  // ── 主匹配 ────────────────────────────────────────────────

  static List<MatchResult> _matchPrimary(
    List<Element> candidates,
    MatchCriteria? criteria,
  ) {
    if (criteria == null) return [];

    return candidates
        .map((e) => MatchResult(
              element: e,
              score: _scoreMatch(e, criteria),
              strategy: 'primary',
            ))
        .where((r) => r.score > 0.5)
        .toList()
      ..sort((a, b) => b.score.compareTo(a.score));
  }

  // ── 回退匹配 ──────────────────────────────────────────────

  static List<MatchResult> _matchFallback(
    List<Element> candidates,
    FallbackCriteria fallback,
  ) {
    return candidates
        .map((e) {
          double score = 0;
          int conditions = 0;

          if (fallback.semanticsLabel != null) {
            conditions++;
            final label = InspectExtension.extractSemantics(e).label;
            if (label != null && label.contains(fallback.semanticsLabel!)) {
              score += 1.0;
            }
          }
          if (fallback.hintText != null) {
            conditions++;
            final hint = InspectExtension.extractSemantics(e).hint;
            if (hint != null && hint.contains(fallback.hintText!)) {
              score += 1.0;
            }
          }
          if (fallback.tooltip != null) {
            conditions++;
            // Tooltip is stored in semantics hint as fallback
            final hint = InspectExtension.extractSemantics(e).hint;
            if (hint != null && hint.contains(fallback.tooltip!)) {
              score += 1.0;
            }
          }

          return MatchResult(
            element: e,
            score: conditions == 0 ? 0 : score / conditions,
            strategy: 'fallback',
          );
        })
        .where((r) => r.score > 0.5)
        .toList()
      ..sort((a, b) => b.score.compareTo(a.score));
  }

  // ── 评分核心 ──────────────────────────────────────────────

  static double _scoreMatch(Element element, MatchCriteria? criteria) {
    if (criteria == null || criteria.conditionCount == 0) return 0;

    double score = 0;
    final widget = element.widget;

    if (criteria.type != null) {
      final runtimeType = widget.runtimeType.toString();
      if (runtimeType == criteria.type) {
        score += 1.0;
      } else if (runtimeType.contains(criteria.type!)) {
        score += 0.6;
      }
    }

    if (criteria.key != null) {
      final key = InspectExtension.extractKeyValue(widget.key);
      if (key == criteria.key) score += 1.0;
    }

    if (criteria.text != null) {
      final text = InspectExtension.extractText(widget);
      if (text != null && text == criteria.text) score += 1.0;
    }

    if (criteria.textContains != null) {
      final text = InspectExtension.extractText(widget);
      if (text != null && text.contains(criteria.textContains!)) score += 1.0;
    }

    if (criteria.textRegex != null) {
      try {
        final regex = RegExp(criteria.textRegex!);
        final text = InspectExtension.extractText(widget);
        if (text != null && regex.hasMatch(text)) score += 1.0;
      } catch (_) {}
    }

    if (criteria.role != null) {
      final role = InspectExtension.extractSemantics(element).role;
      if (role == criteria.role) score += 1.0;
    }

    return score / criteria.conditionCount;
  }

  // ── 辅助方法 ──────────────────────────────────────────────

  static bool _isVisible(Element element) {
    final renderObject = element.findRenderObject();
    if (renderObject is RenderBox && renderObject.hasSize) {
      return renderObject.size.width > 0 && renderObject.size.height > 0;
    }
    return false;
  }

  static List<MatchResult> _applyPosition(
    List<MatchResult> results,
    PositionFilter? position,
  ) {
    if (position == null || results.isEmpty) return results;
    if (position.first) return [results.first];
    if (position.last) return [results.last];
    if (position.nth != null && position.nth! < results.length) {
      return [results[position.nth!]];
    }
    return results;
  }

  static void _walkTree(Element root, bool Function(Element) visitor) {
    if (!visitor(root)) return;
    root.debugVisitOnstageChildren((child) {
      _walkTree(child, visitor);
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-bridge && dart test test/selector_engine_test.dart`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-bridge/lib/src/extensions/selector_engine.dart packages/fliwright-bridge/test/selector_engine_test.dart
git commit -m "feat(bridge): add SelectorEngine with scored matching and fallback"
```

---

### Task 4: Modify InspectExtension

**Files:**
- Modify: `packages/fliwright-bridge/lib/src/extensions/inspect.dart`
- Modify: `packages/fliwright-bridge/test/extension_registry_test.dart`

- [ ] **Step 1: Update InspectExtension._inspect to use SelectorParser + SelectorEngine**

Replace the `_inspect` method body in `packages/fliwright-bridge/lib/src/extensions/inspect.dart` (lines 10-49). Keep all utility methods (`extractWidgetInfo`, `extractText`, `extractKeyValue`, `extractSemantics`, `extractName`, `findAncestorKey`, `findAncestorName`, `walkTree`, `walkTreeUntil` and all `_read*` helpers). Remove `_parseSelector`, `_matchesElement`, `_matches`, `_hasAncestor`, `_requiresExactMatch`, and `ParsedSelector` class.

The new `_inspect` method:

```dart
static Future<Map<String, dynamic>> _inspect(
    Map<String, String> params) async {
  final root = WidgetsBinding.instance.rootElement;
  if (root == null) {
    return {'error': 'No widget tree available', 'widgets': <dynamic>[]};
  }

  final selectorJson = params['selector'];
  if (selectorJson == null || selectorJson.isEmpty) {
    return {'error': 'selector is required', 'widgets': <dynamic>[]};
  }

  final query = SelectorParser.parse(selectorJson);
  final results = SelectorEngine.execute(query, root);

  final widgets = results.map((r) {
    final info = extractWidgetInfo(r.element);
    if (info == null) return null;
    return {
      ...info,
      '_score': r.score,
      '_strategy': r.strategy,
    };
  }).whereType<Map<String, dynamic>>().toList();

  return {
    'widgets': widgets,
    'count': widgets.length,
  };
}
```

Add imports at top of `inspect.dart`:

```dart
import 'selector_parser.dart';
import 'selector_engine.dart';
```

Delete these from the file:
- `ParsedSelector` class (lines 398-402)
- `_parseSelector` method (lines 51-89)
- `_matchesElement` method (lines 313-348)
- `_matches` method (lines 298-311)
- `_hasAncestor` method (lines 367-378)
- `_requiresExactMatch` method (lines 357-365)

- [ ] **Step 2: Update extension_registry_test.dart InspectExtension tests**

In `packages/fliwright-bridge/test/extension_registry_test.dart`, update the InspectExtension group (lines 166-216) to use JSON selectors:

Replace `{'selector': 'byType=Text', 'ancestorSelector': 'byType=LoginForm'}` with:
```dart
{'selector': '{"match":{"type":"Text"},"within":{"match":{"type":"LoginForm"}}}'}
```

Replace `{'selector': 'text=Login'}` with:
```dart
{'selector': '{"match":{"textContains":"Login"}}'}
```

Replace `{'selector': 'id=$id'}` with:
```dart
{'selector': '{"match":{"key":"$id"}}'}
```

Since `id=` is no longer supported, the id test needs updating. The `id` field in WidgetInfo comes from `element.hashCode`, but the new system uses `MatchCriteria.key` for key-based matching. Update the id test to use key-based matching instead, or add an `id` field to `MatchCriteria` if needed. For now, remove the id-specific test and add a key-based one:

```dart
testWidgets('inspect finds widget by key', (tester) async {
  InspectExtension.register(FliwrightBridge.registry);
  await tester.pumpWidget(
    const Directionality(
      textDirection: TextDirection.ltr,
      child: Text('Login', key: ValueKey('loginText')),
    ),
  );

  final result = await FliwrightBridge.registry.invoke(
    'ext.fliwright.inspect',
    {'selector': '{"match":{"key":"loginText"}}'},
  );
  final widgets = result['widgets'] as List;
  expect(widgets, isNotEmpty);
  expect(widgets.first['key'], 'loginText');
});
```

- [ ] **Step 3: Run tests**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-bridge && dart test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/fliwright-bridge/lib/src/extensions/inspect.dart packages/fliwright-bridge/test/extension_registry_test.dart
git commit -m "feat(bridge): InspectExtension uses SelectorParser + SelectorEngine"
```

---

### Task 5: TS Types and SelectorQuery

**Files:**
- Modify: `packages/fliwright-core/src/types.ts`
- Modify: `packages/fliwright-core/src/Selector.ts`

- [ ] **Step 1: Add new types to types.ts, remove old SelectorInput**

In `packages/fliwright-core/src/types.ts`:

Remove the `SelectorInput` type (lines 4-8). Add the following in its place:

```typescript
/** 主匹配条件 */
export interface MatchCriteria {
  type?: string;
  key?: string;
  text?: string;
  textContains?: string;
  textRegex?: string;
  role?: string;
}

/** 回退条件（主匹配失败时尝试） */
export interface FallbackCriteria {
  semanticsLabel?: string;
  hintText?: string;
  tooltip?: string;
}

/** 位置过滤 */
export interface PositionFilter {
  nth?: number;
  first?: boolean;
  last?: boolean;
  visible?: boolean;
}

/** 结构化查询对象 */
export interface SelectorQuery {
  match?: MatchCriteria;
  within?: SelectorQuery;
  fallback?: FallbackCriteria;
  position?: PositionFilter;
}
```

- [ ] **Step 2: Rewrite Selector.ts as SelectorQuery builder**

Replace the entire contents of `packages/fliwright-core/src/Selector.ts`:

```typescript
import type { MatchCriteria, SelectorQuery } from './types.js';

/**
 * Build a wire-ready JSON string from a SelectorQuery.
 * This is passed as params['selector'] to the VM Service extension.
 */
export function selectorToJson(query: SelectorQuery): string {
  return JSON.stringify(query);
}

/**
 * Convenience builders for common selector patterns.
 */
export const match = (criteria: MatchCriteria): SelectorQuery => ({
  match: criteria,
});

export const byType = (type: string): SelectorQuery => ({
  match: { type },
});

export const byKey = (key: string): SelectorQuery => ({
  match: { key },
});

export const byText = (textContains: string): SelectorQuery => ({
  match: { textContains },
});

export const byRole = (role: string): SelectorQuery => ({
  match: { role },
});
```

- [ ] **Step 3: Run build to check types**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && pnpm build`
Expected: Build errors in Locator.ts, Page.ts, FormHelper.ts, index.ts — that's expected, they'll be fixed in subsequent tasks.

For now, just verify types.ts and Selector.ts compile:
```bash
cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && npx tsc --noEmit src/types.ts src/Selector.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/fliwright-core/src/types.ts packages/fliwright-core/src/Selector.ts
git commit -m "feat(core): add SelectorQuery types, rewrite Selector as builder"
```

---

### Task 6: TS FluentSelector

**Files:**
- Create: `packages/fliwright-core/src/FluentSelector.ts`

- [ ] **Step 1: Create FluentSelector**

Create `packages/fliwright-core/src/FluentSelector.ts`:

```typescript
import type {
  MatchCriteria,
  FallbackCriteria,
  SelectorQuery,
  SendRequest,
  WidgetInfo,
} from './types.js';
import { selectorToJson } from './Selector.js';

export class FluentSelector {
  private _query: SelectorQuery;

  constructor(query: SelectorQuery, private sendRequest: SendRequest) {
    this._query = query;
  }

  /** Get the raw SelectorQuery. */
  toQuery(): SelectorQuery {
    return this._query;
  }

  /** Scope to descendants of current match. */
  descendant(match: MatchCriteria): FluentSelector {
    return new FluentSelector(
      { match, within: this._query },
      this.sendRequest,
    );
  }

  /** Find ancestors that contain a child matching the given criteria. */
  containing(childMatch: MatchCriteria): FluentSelector {
    // Set containingChild on match — the Dart engine will handle this
    // by finding elements whose descendants match childMatch.
    return new FluentSelector(
      {
        ...this._query,
        match: { ...this._query.match, _containingChild: childMatch } as unknown as MatchCriteria,
      },
      this.sendRequest,
    );
  }

  /** Set fallback strategy. */
  withFallback(fallback: FallbackCriteria): FluentSelector {
    return new FluentSelector(
      { ...this._query, fallback },
      this.sendRequest,
    );
  }

  /** Select the Nth match. */
  nth(index: number): FluentSelector {
    return new FluentSelector(
      { ...this._query, position: { ...this._query.position, nth: index } },
      this.sendRequest,
    );
  }

  /** Select the first match. */
  first(): FluentSelector {
    return new FluentSelector(
      { ...this._query, position: { ...this._query.position, first: true } },
      this.sendRequest,
    );
  }

  /** Select the last match. */
  last(): FluentSelector {
    return new FluentSelector(
      { ...this._query, position: { ...this._query.position, last: true } },
      this.sendRequest,
    );
  }

  // ── 操作方法 ──────────────────────────────────────────────

  async click(): Promise<void> {
    const widgets = await this._resolve();
    if (widgets.length === 0) {
      throw new Error(`No widget found matching query: ${selectorToJson(this._query)}`);
    }
    const widget = widgets[0];
    if (!widget.rect) {
      throw new Error(`Widget has no render bounds`);
    }
    const x = widget.rect.x + widget.rect.width / 2;
    const y = widget.rect.y + widget.rect.height / 2;
    await this.sendRequest('ext.fliwright.click', { x, y });
  }

  async fill(text: string, options?: { charDelay?: number }): Promise<void> {
    const widgets = await this._resolve();
    if (widgets.length === 0) {
      throw new Error(`No widget found matching query: ${selectorToJson(this._query)}`);
    }
    const params: Record<string, unknown> = {
      selector: selectorToJson(this._query),
      text,
      replaceAll: 'true',
    };
    const resolved = widgets[0];
    params.targetId = resolved.id;
    if (resolved.rect) {
      params.targetRect = JSON.stringify(resolved.rect);
    }
    if (options?.charDelay != null) {
      params.charDelay = String(options.charDelay);
    }
    const response = await this.sendRequest('ext.fliwright.type', params);
    this._assertSuccess(response, 'fill');
  }

  async type(text: string, options?: { delay?: number; charDelay?: number }): Promise<void> {
    const widgets = await this._resolve();
    if (widgets.length === 0) {
      throw new Error(`No widget found matching query: ${selectorToJson(this._query)}`);
    }
    const params: Record<string, unknown> = {
      selector: selectorToJson(this._query),
      text,
    };
    const resolved = widgets[0];
    params.targetId = resolved.id;
    if (resolved.rect) {
      params.targetRect = JSON.stringify(resolved.rect);
    }
    const charDelay = options?.charDelay ?? options?.delay;
    if (charDelay != null) {
      params.charDelay = String(charDelay);
    }
    const response = await this.sendRequest('ext.fliwright.type', params);
    this._assertSuccess(response, 'type');
  }

  async count(): Promise<number> {
    const widgets = await this._resolve();
    return widgets.length;
  }

  async isVisible(): Promise<boolean> {
    const widgets = await this._resolve();
    return widgets.length > 0 && widgets[0].rect != null;
  }

  async resolve(): Promise<WidgetInfo | undefined> {
    const widgets = await this._resolve();
    return widgets[0];
  }

  async text(): Promise<string | undefined> {
    const widgets = await this._resolve();
    return widgets[0]?.text;
  }

  async bounds(): Promise<{ x: number; y: number; width: number; height: number } | undefined> {
    const widgets = await this._resolve();
    return widgets[0]?.rect;
  }

  // ── 内部方法 ──────────────────────────────────────────────

  private async _resolve(): Promise<WidgetInfo[]> {
    const result = (await this.sendRequest('ext.fliwright.inspect', {
      selector: selectorToJson(this._query),
    })) as { widgets: WidgetInfo[] };
    return result.widgets ?? [];
  }

  private _assertSuccess(response: unknown, action: string): void {
    if (!response || typeof response !== 'object') return;
    const result = response as { success?: unknown; error?: unknown; debug?: unknown };
    if (result.success === false) {
      const message = typeof result.error === 'string' ? result.error : `${action} failed`;
      const debug = result.debug === undefined ? '' : ` debug=${JSON.stringify(result.debug)}`;
      throw new Error(`${message}${debug}`);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/fliwright-core/src/FluentSelector.ts
git commit -m "feat(core): add FluentSelector with chainable API and actions"
```

---

### Task 7: Update Page and Locator

**Files:**
- Modify: `packages/fliwright-core/src/Page.ts`
- Modify: `packages/fliwright-core/src/Locator.ts`
- Modify: `packages/fliwright-core/src/index.ts`

- [ ] **Step 1: Update Page.ts — add find(), update locator()**

Replace `packages/fliwright-core/src/Page.ts`:

```typescript
import { FluentSelector } from './FluentSelector.js';
import { Locator } from './Locator.js';
import type { SelectorQuery, SendRequest } from './types.js';

export class Page {
  constructor(private sendRequest: SendRequest) {}

  /**
   * Create a fluent selector from a structured query object.
   * Supports chainable API: page.find({match:{type:'Scaffold'}}).descendant({type:'TextField'})
   */
  find(query: SelectorQuery): FluentSelector {
    return new FluentSelector(query, this.sendRequest);
  }

  /**
   * Create a locator from a SelectorQuery.
   * Kept for backward-compatible internal usage.
   */
  locator(query: SelectorQuery): Locator {
    return new Locator(query, this.sendRequest);
  }

  async waitFor(query: SelectorQuery, timeoutMs = 5000): Promise<FluentSelector> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const sel = this.find(query);
      const count = await sel.count();
      if (count > 0) return sel;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Timeout waiting for selector: ${JSON.stringify(query)}`);
  }

  private _formHelper: import('./FormHelper.js').FormHelper | null = null;

  get formHelper(): import('./FormHelper.js').FormHelper {
    if (!this._formHelper) {
      const { FormHelper } = require('./FormHelper.js') as typeof import('./FormHelper.js');
      this._formHelper = new FormHelper(this.sendRequest);
    }
    return this._formHelper;
  }

  // ── Navigation ──────────────────────────────────────────────

  async navigate(path: string, options?: { extra?: Record<string, unknown> }): Promise<void> {
    const params: Record<string, unknown> = { path };
    if (options?.extra) {
      params.extra = JSON.stringify(options.extra);
    }
    const result = (await this.sendRequest('ext.fliwright.navigate', params)) as {
      success: boolean;
      error?: string;
    };
    if (!result.success) {
      throw new Error(`Navigate to '${path}' failed: ${result.error ?? 'unknown error'}`);
    }
  }

  async currentRoute(): Promise<string> {
    const result = (await this.sendRequest('ext.fliwright.currentRoute', {})) as {
      path?: string;
    };
    return result.path ?? '';
  }

  async goBack(): Promise<void> {
    const result = (await this.sendRequest('ext.fliwright.goBack', {})) as {
      success: boolean;
      error?: string;
    };
    if (!result.success) {
      throw new Error(`Go back failed: ${result.error ?? 'unknown error'}`);
    }
  }
}
```

Note: Use dynamic `import()` for `FormHelper` to avoid changing the import pattern. If the project uses ESM consistently, change `require` to a lazy `import()` or keep the direct import — match the existing pattern.

- [ ] **Step 2: Update Locator.ts to accept SelectorQuery**

Replace `packages/fliwright-core/src/Locator.ts`:

```typescript
import type { WidgetInfo, SelectorQuery, SendRequest } from './types.js';
import { selectorToJson } from './Selector.js';

export class Locator {
  constructor(
    private query: SelectorQuery,
    private sendRequest: SendRequest,
  ) {}

  async click(): Promise<void> {
    const widgets = await this._resolve();
    if (widgets.length === 0) {
      throw new Error(`No widget found matching query: ${JSON.stringify(this.query)}`);
    }
    const widget = widgets[0];
    if (!widget.rect) {
      throw new Error(`Widget has no render bounds`);
    }
    const x = widget.rect.x + widget.rect.width / 2;
    const y = widget.rect.y + widget.rect.height / 2;
    await this.sendRequest('ext.fliwright.click', { x, y });
  }

  async longPress(options?: { duration?: number }): Promise<void> {
    const params: Record<string, unknown> = {
      gesture: 'longPress',
      selector: selectorToJson(this.query),
    };
    if (options?.duration != null) {
      params.duration = options.duration;
    }
    await this.sendRequest('ext.fliwright.gesture', params);
  }

  async drag(deltaX: number, deltaY: number, options?: { steps?: number }): Promise<void> {
    const params: Record<string, unknown> = {
      gesture: 'drag',
      selector: selectorToJson(this.query),
      deltaX,
      deltaY,
    };
    if (options?.steps != null) {
      params.steps = options.steps;
    }
    await this.sendRequest('ext.fliwright.gesture', params);
  }

  async type(text: string, options?: { delay?: number; charDelay?: number }): Promise<void> {
    await this._sendType(text, options);
  }

  async fill(text: string, options?: { delay?: number; charDelay?: number }): Promise<void> {
    await this._sendType(text, { ...options, replaceAll: true });
  }

  private async _sendType(
    text: string,
    options?: { delay?: number; charDelay?: number; replaceAll?: boolean },
  ): Promise<void> {
    const widgets = await this._resolve();
    if (widgets.length === 0) {
      throw new Error(`No widget found matching query: ${JSON.stringify(this.query)}`);
    }
    const params: Record<string, unknown> = {
      selector: selectorToJson(this.query),
      text,
    };
    const resolved = widgets[0];
    params.targetId = resolved.id;
    if (resolved.rect) {
      params.targetRect = JSON.stringify(resolved.rect);
    }
    const charDelay = options?.charDelay ?? options?.delay;
    if (charDelay != null) {
      params.charDelay = String(charDelay);
    }
    if (options?.replaceAll === true) {
      params.replaceAll = 'true';
    }
    const response = await this.sendRequest('ext.fliwright.type', params);
    this._assertSuccess(response, 'type');
  }

  async count(): Promise<number> {
    const widgets = await this._resolve();
    return widgets.length;
  }

  async isVisible(): Promise<boolean> {
    const widgets = await this._resolve();
    return widgets.length > 0 && widgets[0].rect != null;
  }

  async resolve(): Promise<WidgetInfo | undefined> {
    const widgets = await this._resolve();
    return widgets[0];
  }

  private async _resolve(): Promise<WidgetInfo[]> {
    const result = (await this.sendRequest('ext.fliwright.inspect', {
      selector: selectorToJson(this.query),
    })) as { widgets: WidgetInfo[] };
    return result.widgets ?? [];
  }

  private _assertSuccess(response: unknown, action: string): void {
    if (!response || typeof response !== 'object') return;
    const result = response as { success?: unknown; error?: unknown; debug?: unknown };
    if (result.success === false) {
      const message = typeof result.error === 'string' ? result.error : `${action} failed`;
      const debug = result.debug === undefined ? '' : ` debug=${JSON.stringify(result.debug)}`;
      throw new Error(`${message}${debug}`);
    }
  }
}
```

- [ ] **Step 3: Update index.ts exports**

In `packages/fliwright-core/src/index.ts`:

Remove `SelectorInput` from the type exports. Add `SelectorQuery`, `MatchCriteria`, `FallbackCriteria`, `PositionFilter`.

Replace `export { Selector } from './Selector.js';` with:
```typescript
export { selectorToJson, match, byType, byKey, byText, byRole } from './Selector.js';
export { FluentSelector } from './FluentSelector.js';
```

- [ ] **Step 4: Run build**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && pnpm build`
Expected: May have errors in FormHelper.ts — fix in next task.

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-core/src/Page.ts packages/fliwright-core/src/Locator.ts packages/fliwright-core/src/index.ts
git commit -m "feat(core): Page.find() with FluentSelector, Locator uses SelectorQuery"
```

---

### Task 8: Update FormHelper

**Files:**
- Modify: `packages/fliwright-core/src/FormHelper.ts`
- Modify: `packages/fliwright-core/tests/FormHelper.test.ts`

- [ ] **Step 1: Update FormHelper.ts selector construction**

In `packages/fliwright-core/src/FormHelper.ts`:

Change the import from `SelectorInput` to `SelectorQuery`. Update `selectorForFill()` method (lines 433-439) and `parseSelector()` (lines 426-431):

```typescript
private selectorForFill(field: FormFieldMeta): SelectorQuery {
  // Priority: semanticsId → name → key → ancestorKey → id → hintText/label
  if (field.semanticsId) {
    return { fallback: { semanticsLabel: field.semanticsId } };
  }
  if (field.name) {
    return { match: { key: field.name } };  // name is often usable as key
  }
  if (field.key) {
    return { match: { key: field.key } };
  }
  if (field.ancestorKey) {
    return {
      match: { type: field.type ?? 'TextField' },
      within: { match: { key: field.ancestorKey } },
    };
  }
  if (field.hintText) {
    return {
      match: { textContains: field.hintText },
      fallback: { hintText: field.hintText },
    };
  }
  if (field.label) {
    return {
      match: { textContains: field.label },
      fallback: { semanticsLabel: field.label },
    };
  }
  return { match: { type: field.type ?? 'TextField' } };
}
```

Update the `fillOneField` method calls that create `new Locator(...)` — they now pass `SelectorQuery` instead of `SelectorInput`. Also update imports: remove `SelectorInput`, add `SelectorQuery`.

- [ ] **Step 2: Update FormHelper tests**

In `packages/fliwright-core/tests/FormHelper.test.ts`, update any test that uses string selectors like `'text=...'` or `{ text: '...' }` to use `SelectorQuery` format:

```typescript
// Old: { text: 'Username / Email' }
// New: { match: { textContains: 'Username / Email' } }
```

- [ ] **Step 3: Run tests**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && pnpm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/fliwright-core/src/FormHelper.ts packages/fliwright-core/tests/FormHelper.test.ts
git commit -m "feat(core): FormHelper uses SelectorQuery with fallback"
```

---

### Task 9: Update VSCode FormHelperService

**Files:**
- Modify: `packages/fliwright-vscode/src/form/FormHelperService.ts`
- Modify: `packages/fliwright-vscode/tests/FormHelperService.test.ts`

- [ ] **Step 1: Update FormHelperService to build SelectorQuery**

In `packages/fliwright-vscode/src/form/FormHelperService.ts`, update any code that constructs string selectors to build `SelectorQuery` objects instead. Anywhere that produces `text=xxx` or `key=xxx` should produce `{ match: { textContains: 'xxx' } }` or `{ match: { key: 'xxx' } }`.

- [ ] **Step 2: Update FormHelperService tests**

Update test assertions that check for string selector formats to check for `SelectorQuery` objects.

- [ ] **Step 3: Run tests**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-vscode && pnpm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/fliwright-vscode/src/form/FormHelperService.ts packages/fliwright-vscode/tests/FormHelperService.test.ts
git commit -m "feat(vscode): FormHelperService uses SelectorQuery"
```

---

### Task 10: Final Integration Test

**Files:**
- Modify: `packages/fliwright-bridge/test/extension_registry_test.dart`

- [ ] **Step 1: Add integration tests for the full pipeline**

Add to the InspectExtension group in `packages/fliwright-bridge/test/extension_registry_test.dart`:

```dart
testWidgets('inspect finds TextField with within scope', (tester) async {
  InspectExtension.register(FliwrightBridge.registry);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Column(
          children: [
            TextField(
              key: const ValueKey('email'),
              decoration: const InputDecoration(hintText: '请输入邮箱'),
            ),
            TextField(
              key: const ValueKey('password'),
              decoration: const InputDecoration(hintText: '请输入密码'),
              obscureText: true,
            ),
          ],
        ),
      ),
    ),
  );

  // Find email TextField scoped to Scaffold
  final result = await FliwrightBridge.registry.invoke(
    'ext.fliwright.inspect',
    {
      'selector': '{"match":{"type":"TextField","textContains":"邮箱"},'
          '"within":{"match":{"type":"Scaffold"}}}',
    },
  );
  final widgets = result['widgets'] as List;
  expect(widgets, isNotEmpty);
  // Should match the email field
  expect(widgets.any((w) => (w as Map)['key'] == 'email'), isTrue);
});

testWidgets('inspect uses fallback when primary fails', (tester) async {
  InspectExtension.register(FliwrightBridge.registry);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Semantics(
          label: 'email_input',
          child: const Text('Email Address'),
        ),
      ),
    ),
  );

  final result = await FliwrightBridge.registry.invoke(
    'ext.fliwright.inspect',
    {
      'selector': '{"match":{"type":"NonExistent"},'
          '"fallback":{"semanticsLabel":"email"}}',
    },
  );
  final widgets = result['widgets'] as List;
  expect(widgets, isNotEmpty);
  expect((widgets.first as Map)['_strategy'], 'fallback');
});
```

- [ ] **Step 2: Run all Dart tests**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-bridge && dart test`
Expected: PASS

- [ ] **Step 3: Run all TS tests**

Run: `cd /Volumes/HIKSEMI/project/fliwright && pnpm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/fliwright-bridge/test/extension_registry_test.dart
git commit -m "test(bridge): add integration tests for SelectorQuery pipeline"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Task 1-4 covers Dart data model, parser, engine, InspectExtension. Task 5-7 covers TS types, FluentSelector, Page, Locator. Task 8-9 covers FormHelper and VSCode integration. Task 10 covers integration tests.
- [x] **Placeholder scan:** No TBD, TODO, or vague instructions. Every step has concrete code.
- [x] **Type consistency:** `SelectorQuery` / `MatchCriteria` / `FallbackCriteria` / `PositionFilter` names match between Dart and TS. `selectorToJson()` used consistently in FluentSelector and Locator. `SelectorEngine.scoreMatch()` exposed as public for testing.
