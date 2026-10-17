import 'package:flutter/widgets.dart';

class SelectorBudgetExceeded implements Exception {
  @override
  String toString() => 'Recording target capture budget exceeded.';
}

/// Counts traversal work across every candidate and nested query in one capture.
class SelectorEvaluationBudget {
  SelectorEvaluationBudget(
      {this.maxVisits = 60000,
      this.maxDuration = const Duration(milliseconds: 12)})
      : _clock = Stopwatch()..start();
  final int maxVisits;
  final Duration maxDuration;
  final Stopwatch _clock;
  int _visits = 0;

  void visit() {
    if (++_visits > maxVisits) throw SelectorBudgetExceeded();
    checkTime();
  }

  void checkTime() {
    if (_clock.elapsed >= maxDuration) throw SelectorBudgetExceeded();
  }
}

/// Tree combinators shared by inspect and recording, with the same leaf matcher.
class SelectorTreeEvaluator {
  SelectorTreeEvaluator(
      {required bool Function(Element, ParsedSelectorAst) matchesLeaf,
      required bool Function(Element, Map<String, dynamic>) passesFilter,
      this.budget})
      : _matchesLeaf = matchesLeaf,
        _passesFilter = passesFilter;
  final bool Function(Element, ParsedSelectorAst) _matchesLeaf;
  final bool Function(Element, Map<String, dynamic>) _passesFilter;
  final SelectorEvaluationBudget? budget;

  bool matches(Element element, ParsedSelectorAst selector) {
    budget?.visit();
    switch (selector.kind) {
      case 'descendant':
      case 'ancestor':
      case 'and':
      case 'or':
      case 'nth':
      case 'last':
      case 'filter':
      case 'containing':
      case 'fallback':
        return evaluate(element, selector).contains(element);
      default:
        return _matchesLeaf(element, selector);
    }
  }

  List<Element> evaluate(
    Element root,
    ParsedSelectorAst selector,
  ) {
    budget?.visit();
    final kind = selector.kind;
    switch (kind) {
      case 'descendant':
        final parents = evaluate(root, selector.child('of'));
        final matching = selector.child('matching');
        final result = <Element>[];
        for (final parent in parents) {
          _walkTreeCollect(parent, (element) {
            if (element == parent && selector.boolValue('matchRoot') != true) {
              return false;
            }
            return matches(element, matching);
          }, result);
        }
        return _dedupeElements(result);
      case 'ancestor':
        final children = evaluate(root, selector.child('of'));
        final matching = selector.child('matching');
        final result = <Element>[];
        for (final child in children) {
          child.visitAncestorElements((ancestor) {
            budget?.visit();
            if (matches(ancestor, matching)) result.add(ancestor);
            return true;
          });
        }
        return _dedupeElements(result);
      case 'and':
        return _allElements(root)
            .where(
              (element) => selector
                  .children('selectors')
                  .every((child) => matches(element, child)),
            )
            .toList();
      case 'or':
        return _dedupeElements(
          selector
              .children('selectors')
              .expand((child) => evaluate(root, child))
              .toList(),
        );
      case 'nth':
        final candidates = evaluate(root, selector.child('selector'));
        final index = selector.intValue('index') ?? -1;
        if (index < 0 || index >= candidates.length) return <Element>[];
        return <Element>[candidates[index]];
      case 'last':
        final candidates = evaluate(root, selector.child('selector'));
        if (candidates.isEmpty) return <Element>[];
        return <Element>[candidates.last];
      case 'filter':
        final candidates = evaluate(root, selector.child('selector'));
        final filter = selector.value['filter'];
        if (filter is! Map<String, dynamic>) return candidates;
        return candidates
            .where((element) => _passesFilter(element, filter))
            .toList();
      case 'containing':
        final parents = evaluate(root, selector.child('parent'));
        final descAst = selector.child('descendant');
        final result = <Element>[];
        for (final parent in parents) {
          bool hasMatch = false;
          _walkTreeCollect(parent, (element) {
            if (identical(element, parent)) return false;
            if (matches(element, descAst)) {
              hasMatch = true;
              return false;
            }
            return true;
          }, []);
          if (hasMatch) result.add(parent);
        }
        return _dedupeElements(result);
      case 'fallback':
        final primary = evaluate(root, selector.child('primary'));
        if (primary.isNotEmpty) return primary;
        return evaluate(root, selector.child('fallback'));
      default:
        final result = <Element>[];
        _walkTreeCollect(
          root,
          (element) => matches(element, selector),
          result,
        );
        return result;
    }
  }

  List<Element> _allElements(Element root) {
    final result = <Element>[];
    _walkTreeCollect(root, (_) => true, result);
    return result;
  }

  void _walkTreeCollect(
    Element root,
    bool Function(Element) predicate,
    List<Element> result,
  ) {
    budget?.visit();
    if (predicate(root)) result.add(root);
    root.debugVisitOnstageChildren((Element child) {
      _walkTreeCollect(child, predicate, result);
    });
  }

  List<Element> _dedupeElements(List<Element> elements) {
    final seen = <int>{};
    final result = <Element>[];
    for (final element in elements) {
      if (seen.add(element.hashCode)) result.add(element);
    }
    return result;
  }
}

class ParsedSelectorAst {
  final Map<String, dynamic> value;

  ParsedSelectorAst(this.value);

  String get kind => value['kind'] as String? ?? '';

  String? stringValue(String key) {
    final raw = value[key];
    return raw is String && raw.isNotEmpty ? raw : null;
  }

  bool? boolValue(String key) {
    final raw = value[key];
    return raw is bool ? raw : null;
  }

  int? intValue(String key) {
    final raw = value[key];
    if (raw is int) return raw;
    if (raw is num) return raw.toInt();
    return null;
  }

  ParsedSelectorAst child(String key) {
    final raw = value[key];
    if (raw is! Map<String, dynamic>) {
      throw ArgumentError('Selector child "$key" must be an object');
    }
    return ParsedSelectorAst(raw);
  }

  List<ParsedSelectorAst> children(String key) {
    final raw = value[key];
    if (raw is! List) {
      throw ArgumentError('Selector children "$key" must be a list');
    }
    return raw
        .whereType<Map<String, dynamic>>()
        .map(ParsedSelectorAst.new)
        .toList();
  }
}
