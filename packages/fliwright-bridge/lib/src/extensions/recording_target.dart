import 'package:flutter/material.dart';
import '../selector_tree_evaluator.dart';
import 'inspect.dart';

/// Freezes target identity and selector evidence synchronously in its original tree.
class RecordingTargetCapture {
  RecordingTargetCapture(
      {this.maxNodes = 4000,
      this.maxVisits = 60000,
      this.maxDuration = const Duration(milliseconds: 12)});

  final int maxNodes;
  final int maxVisits;
  final Duration maxDuration;
  final Expando<String> _identities = Expando<String>();
  int _nextIdentity = 0;

  String identity(Element element) =>
      _identities[element] ??= 'target-${++_nextIdentity}';

  Map<String, dynamic> freeze(Element? target,
      {required Element root, String? route}) {
    final targetId =
        target == null ? 'unresolved-${++_nextIdentity}' : identity(target);
    final unresolved = <String, dynamic>{
      'targetId': targetId,
      'status': 'unresolved',
      'candidates': <dynamic>[],
      'route': route,
    };
    if (target == null || !target.mounted) {
      return {
        ...unresolved,
        'issue': 'No mounted target in the original hit-test path.'
      };
    }
    final budget = SelectorEvaluationBudget(
        maxVisits: maxVisits, maxDuration: maxDuration);
    try {
      var nodes = 0;
      InspectExtension.walkTreeUntil(root, (_) {
        budget.visit();
        if (++nodes > maxNodes) throw SelectorBudgetExceeded();
        return true;
      });
      final type = target.widget.runtimeType.toString();
      final candidates = <Map<String, dynamic>>[];
      var uniqueStableCandidate = false;
      void add(Map<String, dynamic> query, String stability) {
        if (uniqueStableCandidate || candidates.length >= 16) return;
        final matches =
            InspectExtension.evaluateQuery(root, query, budget: budget);
        candidates.add({
          'query': query,
          'stability': stability,
          'matchCount': matches.length,
          'matchesTarget': matches.any((element) => identical(element, target)),
        });
        uniqueStableCandidate = stability != 'positional' &&
            matches.length == 1 &&
            identical(matches.single, target);
      }

      final key = InspectExtension.extractKeyValue(target.widget.key);
      if (key != null && key.isNotEmpty)
        add({
          'match': {'key': key}
        }, 'key');
      final ownSemantics = uniqueStableCandidate
          ? const ExtractedSemantics()
          : InspectExtension.extractOwnSemantics(target);
      if (ownSemantics.identifier != null) {
        add({
          'match': {'semanticIdentifier': ownSemantics.identifier}
        }, 'semantics');
      }
      if (!uniqueStableCandidate) {
        // A keyed list item often owns an unkeyed interactive descendant.
        // Prove this narrow scope before probing dynamic tooltip/label fallbacks.
        var keyedAncestors = 0;
        target.visitAncestorElements((ancestor) {
          budget.visit();
          final ancestorKey =
              InspectExtension.extractKeyValue(ancestor.widget.key);
          if (ancestorKey != null &&
              ancestorKey.isNotEmpty &&
              !ancestorKey.startsWith('_')) {
            keyedAncestors++;
            add({
              'match': {'type': type},
              'within': {
                'match': {'key': ancestorKey}
              },
            }, 'ancestor');
          }
          return !uniqueStableCandidate &&
              keyedAncestors < 3 &&
              ancestor.widget is! Scaffold &&
              ancestor.widget is! WidgetsApp;
        });
      }
      if (uniqueStableCandidate) {
        budget.checkTime();
        // Uniqueness is already proven in this tree. Stop before walking
        // ancestors or probing fallback properties for weaker candidates.
        final info = InspectExtension.extractWidgetInfo(target,
            includeAncestorKey: false,
            includeName: false,
            includeSemantics: false)!;
        if (target.widget is EditableText) info.remove('text');
        return {
          ...info,
          'targetId': targetId,
          'status': 'resolved',
          'candidates': candidates,
          'route': route
        };
      }
      var containsEditable = false;
      if (!uniqueStableCandidate) {
        InspectExtension.walkTreeUntil(target, (element) {
          budget.visit();
          containsEditable = element.widget is EditableText;
          return !containsEditable;
        });
      }
      // Editable values belong to input events, never to a selector or metadata.
      final info = InspectExtension.extractWidgetInfo(target,
          // Recording candidates use keys/semantics/labels, never dynamic name
          // fallback. Probing each ancestor can consume the dispatch budget.
          includeName: false,
          includeDescendantText: !containsEditable && !uniqueStableCandidate,
          includeSemantics: !containsEditable && !uniqueStableCandidate,
          includeTooltip: true,
          includeKeyedAncestors: true)!;
      if (containsEditable || target.widget is EditableText)
        info.remove('text');
      budget.checkTime();
      final label = ownSemantics.label;
      if (label != null && label.isNotEmpty) {
        add({
          'match': {'type': type, 'semanticsLabel': label}
        }, 'label');
      }
      final tooltip = info['tooltip'];
      if (tooltip is String && tooltip.isNotEmpty) {
        add({
          'match': {'type': type, 'tooltip': tooltip}
        }, 'label');
      }
      final text = info['descendantText'];
      Map<String, dynamic> labeled = {
        'match': {'type': type}
      };
      if (text is String && text.trim().isNotEmpty) {
        labeled = {
          ...labeled,
          'containing': {
            'match': {'text': text.trim()}
          }
        };
        add(labeled, 'label');
      } else if (target.widget is Text) {
        final ownText = (target.widget as Text).data;
        if (ownText != null && ownText.isNotEmpty) {
          labeled = {
            'match': {'type': type, 'text': ownText}
          };
          add(labeled, 'label');
        }
      }
      for (final ancestor in (info['keyedAncestors'] as List? ?? [])) {
        final scope = {
          'match': {'key': ancestor['key']}
        };
        if (key != null)
          add({
            'match': {'key': key},
            'within': scope
          }, 'ancestor');
        add({...labeled, 'within': scope}, 'ancestor');
      }
      if (!uniqueStableCandidate) {
        final matchingType = InspectExtension.evaluateQuery(
            root,
            {
              'match': {'type': type}
            },
            budget: budget);
        final index = matchingType.indexOf(target);
        if (index >= 0)
          add({
            'match': {'type': type},
            'position': {'nth': index}
          }, 'positional');
      }
      final path = <Map<String, dynamic>>[];
      target.visitAncestorElements((ancestor) {
        budget.visit();
        if (path.length >= 16) return false;
        final key = InspectExtension.extractKeyValue(ancestor.widget.key);
        path.add({
          'type': ancestor.widget.runtimeType.toString(),
          if (key != null) 'key': key
        });
        return true;
      });
      budget.checkTime();
      return {
        ...info,
        'targetId': targetId,
        'status': 'resolved',
        'candidates': candidates,
        'ancestorPath': path,
        'route': route
      };
    } on SelectorBudgetExceeded {
      return {
        ...unresolved,
        'issue': 'Recording target capture budget exceeded.'
      };
    }
  }
}
