import 'dart:developer';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import '../bridge.dart';
import 'inspect.dart';
import 'recording_input.dart';
import 'recording_binding.dart';
import 'recording_target.dart';

class RecordingExtension {
  static bool _recording = false;
  static Stopwatch? _recordingClock;
  static String? _sessionId;
  static int _sequence = 0;
  static final Map<int, Map<String, dynamic>> _targetByPointer =
      <int, Map<String, dynamic>>{};
  static VoidCallback? _focusManagerListener;
  static FocusedTextInputSubscription? _focusedInput;
  static Map<String, dynamic>? _focusedInputTarget;
  static int _nextFocusSessionId = 0;
  static String? _focusSessionId;
  static Element? _focusedEditable;
  static VoidCallback? _refreshInputPrivacy;
  static ModalRoute<dynamic>? _currentRoute;
  static Map<String, dynamic>? _lastStopResponse;
  static RecordingTargetCapture? _targetCapture;
  static void Function(Map<String, dynamic>) _emitEvent = _postToVM;
  static RecordingTargetCapture Function() _createTargetCapture =
      RecordingTargetCapture.new;

  static void register(
    ExtensionRegistry registry, {
    void Function(Map<String, dynamic>)? emitEvent,
    RecordingTargetCapture Function()? createTargetCapture,
  }) {
    _emitEvent = emitEvent ?? _postToVM;
    _createTargetCapture = createTargetCapture ?? RecordingTargetCapture.new;
    registry.register('ext.fliwright.startRecording', _startRecording);
    registry.register('ext.fliwright.stopRecording', _stopRecording);
    registry.register('ext.fliwright.hitTest', _hitTest);
  }

  static Future<Map<String, dynamic>> _startRecording(
      Map<String, String> params) async {
    debugPrint('[fliwright] startRecording called, _recording=$_recording');
    final sessionId = params['sessionId'];
    if (params['protocolVersion'] != '2' ||
        sessionId == null ||
        sessionId.trim().isEmpty) {
      return {
        'success': false,
        'recording': _recording,
        'error':
            'Recording requires protocolVersion 2 and a nonempty sessionId.',
      };
    }
    if (_recording) {
      if (sessionId == _sessionId) return _startResponse(sessionId);
      return {
        'success': false,
        'recording': true,
        'error': 'Another recording session owns the recorder.',
      };
    }
    if (!FliwrightRecordingBinding.isInstalled) {
      return {
        'success': false,
        'error': 'Reliable recording requires FliwrightRecordingBinding. '
            'Initialize it before runApp.',
        'recording': false,
      };
    }
    _recording = true;
    _recordingClock = Stopwatch()..start();
    _sessionId = sessionId;
    _lastStopResponse = null;
    _sequence = 0;
    _targetCapture = _createTargetCapture();
    _targetByPointer.clear();
    FliwrightRecordingBinding.beforePointerDispatch = _beforePointerDispatch;
    FliwrightRecordingBinding.afterFrame = () {
      _refreshInputPrivacy?.call();
      _captureRouteBoundary();
    };
    _captureRouteBoundary();
    _focusManagerListener = _rebindFocusedInput;
    FocusManager.instance.addListener(_focusManagerListener!);
    _rebindFocusedInput();
    return _startResponse(sessionId);
  }

  static Map<String, dynamic> _startResponse(String sessionId) => {
        'success': true,
        'protocolVersion': 2,
        'recording': true,
        'sessionId': sessionId,
      };

  static Future<Map<String, dynamic>> _stopRecording(
      Map<String, String> params) async {
    debugPrint('[fliwright] stopRecording called, _recording=$_recording');
    final sessionId = params['sessionId'];
    if (!_recording &&
        sessionId != null &&
        sessionId == _lastStopResponse?['sessionId']) {
      return Map<String, dynamic>.from(_lastStopResponse!);
    }
    if (!_recording || sessionId == null || sessionId != _sessionId) {
      return {
        'success': false,
        'recording': _recording,
        'error': 'No active recording owned by this sessionId.',
      };
    }
    _endRecording();
    return Map<String, dynamic>.from(_lastStopResponse!);
  }

  static void _endRecording() {
    _focusedInput?.flush();
    _focusedInput?.dispose();
    _focusedInput = null;
    _focusedInputTarget = null;
    _focusSessionId = null;
    if (_focusManagerListener != null) {
      FocusManager.instance.removeListener(_focusManagerListener!);
      _focusManagerListener = null;
    }
    FliwrightRecordingBinding.beforePointerDispatch = null;
    FliwrightRecordingBinding.afterFrame = null;
    _currentRoute = null;
    _focusedEditable = null;
    _refreshInputPrivacy = null;
    final lastSequence = _sequence;
    final sessionId = _sessionId;
    _recording = false;
    _recordingClock?.stop();
    _recordingClock = null;
    _sessionId = null;
    _targetByPointer.clear();
    _targetCapture = null;
    if (sessionId != null)
      _lastStopResponse = {
        'success': true,
        'protocolVersion': 2,
        'recording': false,
        'sessionId': sessionId,
        'lastSequence': lastSequence,
      };
  }

  static Future<void> reset() async {
    _endRecording();
    _lastStopResponse = null;
    _nextFocusSessionId = 0;
    _emitEvent = _postToVM;
    _createTargetCapture = RecordingTargetCapture.new;
  }

  static Future<Map<String, dynamic>> _hitTest(
      Map<String, String> params) async {
    final x = double.tryParse(params['x'] ?? '') ?? 0.0;
    final y = double.tryParse(params['y'] ?? '') ?? 0.0;
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) return {'widget': <String, dynamic>{}};

    final point = Offset(x, y);

    // Score candidates: prefer interactive widgets, penalise pure layout.
    Element? best;
    int bestScore = -1;

    InspectExtension.walkTree(root, (Element element) {
      final renderObject = element.findRenderObject();
      if (renderObject is! RenderBox || !renderObject.hasSize) return;
      final topLeft = renderObject.localToGlobal(Offset.zero);
      final rect = topLeft & renderObject.size;
      if (!rect.contains(point)) return;

      final widget = element.widget;
      // Skip render-level noise.
      if (widget is RichText || widget is Text || widget is RepaintBoundary)
        return;

      final int score = _widgetScore(widget);
      debugPrint(
          '[fliwright] hitTest candidate: ${widget.runtimeType} score=$score');
      // Prefer the most specific (deepest) widget; break ties by score.
      if (score > bestScore || (score == bestScore)) {
        best = element;
        bestScore = score;
      }
    });

    if (best == null) return {'widget': <String, dynamic>{}};
    final widget = best!.widget;
    debugPrint('[fliwright] hitTest selected: ${widget.runtimeType}');
    final info = InspectExtension.extractWidgetInfo(
      best!,
      includeDescendantText: true,
      includeDescendantIcon: true,
      includeTooltip: true,
      includeKeyedAncestors: true,
    );
    return {'widget': info};
  }

  static void _beforePointerDispatch(
      PointerEvent event, HitTestResult? result) {
    if (!_recording) return;
    String phase;
    if (event is PointerDownEvent) {
      // Commit the preceding edit before the next control's callback can run.
      _focusedInput?.flush();
      _capturePointerTargetBeforeDispatch(event, result);
      phase = 'down';
    } else if (event is PointerMoveEvent) {
      phase = 'move';
    } else if (event is PointerUpEvent) {
      phase = 'up';
    } else if (event is PointerCancelEvent) {
      phase = 'cancel';
    } else {
      return;
    }
    final target = _targetByPointer[event.pointer];
    _postRecordingEvent({
      'kind': 'pointer',
      'phase': phase,
      'pointer': event.pointer,
      'x': event.position.dx,
      'y': event.position.dy,
      'viewportWidth': _viewportWidth(),
      'viewportHeight': _viewportHeight(),
      'pixelRatio': WidgetsBinding
          .instance.platformDispatcher.views.first.devicePixelRatio,
    }, targetId: target?['targetId'] as String?, target: target);
    if (event is PointerUpEvent || event is PointerCancelEvent) {
      _targetByPointer.remove(event.pointer);
    }
  }

  static void _capturePointerTargetBeforeDispatch(
    PointerEvent event,
    HitTestResult? hitTestResult,
  ) {
    if (!_recording || event is! PointerDownEvent || hitTestResult == null) {
      return;
    }

    final candidates = <Element>[];
    final seen = <Element>{};
    for (final entry in hitTestResult.path) {
      final target = entry.target;
      if (target is! RenderObject) continue;
      final creator = target.debugCreator;
      if (creator is! DebugCreator) continue;

      Element? element = creator.element;
      var depth = 0;
      if (seen.add(element)) candidates.add(element);
      element.visitAncestorElements((ancestor) {
        if (depth >= 16 || candidates.length >= 64) return false;
        if (seen.add(ancestor)) candidates.add(ancestor);
        depth++;
        return true;
      });
    }

    Element? best;
    var bestScore = -1;
    for (final element in candidates) {
      final widget = element.widget;
      if (widget is RichText || widget is Text || widget is RepaintBoundary) {
        continue;
      }
      final renderObject = element.findRenderObject();
      if (renderObject is! RenderBox || !renderObject.hasSize) continue;
      final rect = renderObject.localToGlobal(Offset.zero) & renderObject.size;
      if (!rect.contains(event.position)) continue;
      final score = _widgetScore(widget);
      if (score >= bestScore) {
        best = element;
        bestScore = score;
      }
    }

    _targetByPointer[event.pointer] = _freezeTarget(best);
  }

  static void _postRecordingEvent(
    Map<String, dynamic> payload, {
    String? targetId,
    Map<String, dynamic>? target,
  }) {
    if (!_recording || _sessionId == null) return;
    final sequence = ++_sequence;
    _emitEvent({
      'version': 2,
      'sessionId': _sessionId,
      'sequence': sequence,
      'elapsedUs': _recordingClock?.elapsedMicroseconds ?? 0,
      'frameId': 'frame-$sequence',
      if (targetId != null) 'targetId': targetId,
      if (target != null) 'target': target,
      'payload': payload,
    });
  }

  static void _postToVM(Map<String, dynamic> event) =>
      postEvent('FliwrightRecording', event);

  static Size _viewportSize() {
    final view = WidgetsBinding.instance.platformDispatcher.views.first;
    return view.physicalSize / view.devicePixelRatio;
  }

  static double _viewportWidth() => _viewportSize().width;

  static double _viewportHeight() => _viewportSize().height;

  static Map<String, dynamic> _freezeTarget(Element? element) {
    final root = WidgetsBinding.instance.rootElement;
    final target = root != null && _targetCapture != null
        ? _targetCapture!.freeze(element,
            root: root,
            route:
                element == null ? null : ModalRoute.of(element)?.settings.name)
        : <String, dynamic>{
            'targetId': 'unresolved',
            'status': 'unresolved',
            'candidates': <dynamic>[],
            'issue': 'No widget tree available for target capture.',
          };
    target['viewport'] = {
      'width': _viewportWidth(),
      'height': _viewportHeight(),
      'pixelRatio': WidgetsBinding
          .instance.platformDispatcher.views.first.devicePixelRatio
    };
    return target;
  }

  /// Higher score = more useful for test selectors.
  static int _widgetScore(Widget widget) {
    // Buttons / interactive controls
    if (widget is ElevatedButton ||
        widget is FilledButton ||
        widget is TextButton ||
        widget is OutlinedButton ||
        widget is IconButton ||
        widget is FloatingActionButton ||
        widget is CupertinoButton) {
      return 100;
    }
    // Input fields
    if (widget is TextField ||
        widget is TextFormField ||
        widget is CupertinoTextField) {
      return 100;
    }
    // Gesture detectors
    if (widget is GestureDetector) return 90;
    if (widget is InkWell) return 90;
    if (widget is InkResponse) return 90;
    // Semantics wrapping an interactive widget
    if (widget is Semantics) return 70;
    // Switch / Checkbox / Slider etc.
    if (widget is Switch ||
        widget is Checkbox ||
        widget is Radio ||
        widget is Slider ||
        widget is CupertinoSwitch ||
        widget is CupertinoSlider) {
      return 100;
    }
    // Chip family
    if (widget is Chip ||
        widget is ActionChip ||
        widget is FilterChip ||
        widget is ChoiceChip) {
      return 90;
    }
    // List / Card / BottomNavigationBar items
    if (widget is ListTile) return 80;
    if (widget is Card) return 60;
    // Scrollable
    if (widget is ScrollView || widget is ListView || widget is GridView) {
      return 40;
    }
    // Layout containers (least useful)
    if (widget is Column ||
        widget is Row ||
        widget is Stack ||
        widget is Container ||
        widget is Padding ||
        widget is Center ||
        widget is Align ||
        widget is Flexible ||
        widget is Expanded ||
        widget is Positioned ||
        widget is SizedBox ||
        widget is ConstrainedBox ||
        widget is Listener) {
      return 10;
    }
    // Default: medium priority
    return 50;
  }

  static void _captureRouteBoundary() {
    if (!_recording) return;
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) return;
    ModalRoute<dynamic>? current;
    var visited = 0;
    InspectExtension.walkTreeUntil(root, (element) {
      if (++visited > 4000) return false;
      // Route scopes also expose programmatic and unnamed navigation changes.
      if (element.widget is FocusScope) {
        final route = ModalRoute.of(element);
        if (route != null && route.isCurrent) current = route;
      }
      return true;
    });
    if (current == null || identical(current, _currentRoute)) return;
    _focusedInput?.flush();
    _currentRoute = current;
    _postRecordingEvent({
      'kind': 'route',
      'route': current?.settings.name ?? '<unnamed>',
    });
  }

  static void _rebindFocusedInput() {
    if (!_recording) return;
    final editable = _findFocusedEditableText();
    final widget = editable?.widget;
    if (widget is EditableText &&
        identical(_focusedInput?.controller, widget.controller) &&
        identical(_focusedEditable, editable)) {
      return;
    }

    _focusedInput?.flush();
    _focusedInput?.dispose();
    if (_focusedInput != null) {
      _postRecordingEvent({
        'kind': 'focus',
        'focused': false,
        'focusSessionId': _focusSessionId,
      },
          targetId: _focusedInputTarget?['targetId'] as String?,
          target: _focusedInputTarget);
    }
    _focusedInput = null;
    _focusedInputTarget = null;
    _focusSessionId = null;
    _focusedEditable = null;
    _refreshInputPrivacy = null;
    if (widget is! EditableText || editable == null) return;

    _focusedEditable = editable;
    _nextFocusSessionId++;
    Element inputTarget = editable;
    editable.visitAncestorElements((ancestor) {
      if (ancestor.widget is TextField ||
          ancestor.widget is TextFormField ||
          ancestor.widget is CupertinoTextField) inputTarget = ancestor;
      return ancestor.widget is! Scaffold && ancestor.widget is! WidgetsApp;
    });
    _focusedInputTarget = _freezeTarget(inputTarget);
    final focusSessionId = 'focus-$_nextFocusSessionId';
    _focusSessionId = focusSessionId;
    final target = _focusedInputTarget;
    _postRecordingEvent({
      'kind': 'focus',
      'focused': true,
      'focusSessionId': focusSessionId,
    }, targetId: target?['targetId'] as String?, target: target);
    var sensitive = widget.obscureText;
    void refreshPrivacy() {
      if (editable.mounted) {
        final current = editable.widget;
        if (current is EditableText)
          sensitive = sensitive || current.obscureText;
      }
    }

    _refreshInputPrivacy = refreshPrivacy;
    _focusedInput = FocusedTextInputSubscription(
      controller: widget.controller,
      onValue: (text) {
        refreshPrivacy();
        // Autofocus may precede the route's first onstage frame. Retry its
        // candidate evidence at the edit, while the original element lives.
        final candidates = _focusedInputTarget?['candidates'] as List? ?? [];
        if (inputTarget.mounted &&
            !candidates.any((candidate) =>
                candidate['matchCount'] == 1 &&
                candidate['matchesTarget'] == true)) {
          _focusedInputTarget = _freezeTarget(inputTarget);
        }
        final target = _focusedInputTarget;
        final mask = sensitive && text.isNotEmpty;
        _postRecordingEvent({
          'kind': 'text',
          'value': mask ? '<masked>' : text,
          if (mask) 'sensitive': true,
          'focusSessionId': focusSessionId,
        }, targetId: target?['targetId'] as String?, target: target);
      },
    );
  }

  static Element? _findFocusedEditableText() {
    final context = FocusManager.instance.primaryFocus?.context;
    if (context is! Element) return null;
    Element? focused;
    bool visit(Element element) {
      final widget = element.widget;
      if (widget is EditableText && widget.focusNode.hasFocus) {
        focused = element;
        return false;
      }
      return true;
    }

    if (visit(context)) context.visitAncestorElements(visit);
    return focused;
  }
}
