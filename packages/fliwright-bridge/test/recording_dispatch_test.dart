import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:fliwright_bridge/src/extensions/recording_target.dart';

class _RecordingTestBinding extends AutomatedTestWidgetsFlutterBinding
    implements FliwrightRecordingBinding {
  @override
  void drawFrame() {
    super.drawFrame();
    FliwrightRecordingBinding.afterFrame?.call();
  }

  @override
  void dispatchEvent(PointerEvent event, HitTestResult? result) {
    FliwrightRecordingBinding.beforePointerDispatch?.call(event, result);
    super.dispatchEvent(event, result);
  }
}

void main() {
  _RecordingTestBinding();
  late ExtensionRegistry registry;
  late List<Map<String, dynamic>> events;
  setUp(() async {
    await FliwrightBridge.reset();
    registry = ExtensionRegistry();
    events = [];
    RecordingExtension.register(registry,
        emitEvent: events.add,
        createTargetCapture: () =>
            RecordingTargetCapture(maxDuration: const Duration(seconds: 2)));
  });
  tearDown(FliwrightBridge.reset);
  Future<void> start() async {
    final response = await registry.invoke('ext.fliwright.startRecording',
        {'protocolVersion': '2', 'sessionId': 'dispatch-test'});
    expect(response['recording'], true);
  }

  Future<void> stop() async {
    final response = await registry
        .invoke('ext.fliwright.stopRecording', {'sessionId': 'dispatch-test'});
    expect(response['lastSequence'], events.length);
  }

  for (final tonal in [false, true]) {
    testWidgets(
        'records the keyed FilledButton (tonal=$tonal), not its InkWell',
        (tester) async {
      var clicks = 0;
      final button = tonal
          ? FilledButton.tonal(
              key: const ValueKey('increment'),
              onPressed: () => clicks++,
              child: const Text('Increment'))
          : FilledButton(
              key: const ValueKey('increment'),
              onPressed: () => clicks++,
              child: const Text('Increment'));
      await tester.pumpWidget(MaterialApp(home: Scaffold(body: button)));
      await start();
      await tester.tap(find.byKey(const ValueKey('increment')));
      await stop();
      expect(clicks, 1);
      final down = events
          .firstWhere((event) => (event['payload'] as Map)['phase'] == 'down');
      final target = down['target'] as Map;
      expect(target['type'], 'FilledButton');
      expect(target['key'], 'increment');
      expect((target['candidates'] as List).single, {
        'query': {
          'match': {'key': 'increment'}
        },
        'stability': 'key',
        'matchCount': 1,
        'matchesTarget': true,
      });
    });
  }

  testWidgets(
      'down freezes original target before a business pointer callback destroys it',
      (tester) async {
    late StateSetter change;
    var shown = true;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(body: StatefulBuilder(builder: (context, setState) {
      change = setState;
      return shown
          ? Listener(
              onPointerDown: (_) => change(() => shown = false),
              child: ElevatedButton(
                  key: const ValueKey('open'),
                  onPressed: () {},
                  child: const Text('Open')))
          : const Text('Next page');
    }))));
    await start();
    final gesture = await tester
        .startGesture(tester.getCenter(find.byKey(const ValueKey('open'))));
    await tester.pump();
    expect(find.byKey(const ValueKey('open')), findsNothing);
    await gesture.up();
    await stop();
    final pointer = events
        .where((event) => (event['payload'] as Map)['kind'] == 'pointer')
        .toList();
    expect(pointer, hasLength(2));
    expect(pointer[0]['targetId'], pointer[1]['targetId']);
    final target = pointer[0]['target'] as Map;
    expect(target['status'], 'resolved');
    expect(
        target['candidates'],
        contains(predicate<Map>((candidate) =>
            candidate['stability'] == 'key' &&
            candidate['matchCount'] == 1 &&
            candidate['matchesTarget'] == true)));
    expect(pointer[1]['target'], target);
  });

  testWidgets('focused text uses the same logical input target as the pointer',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
        home: Scaffold(body: TextField(key: ValueKey('email')))));
    await start();
    await tester.tap(find.byKey(const ValueKey('email')));
    await tester.pump();
    await tester.enterText(
        find.byKey(const ValueKey('email')), 'first@example.com');
    await stop();
    final down = events
        .firstWhere((event) => (event['payload'] as Map)['phase'] == 'down');
    final text = events
        .firstWhere((event) => (event['payload'] as Map)['kind'] == 'text');
    expect(text['targetId'], down['targetId']);
    expect((text['target'] as Map)['type'], 'TextField');
    expect((text['payload'] as Map)['value'], 'first@example.com');
  });

  testWidgets('records first input after a pushed route autofocuses its field',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Builder(builder: (context) {
          return FilledButton(
            key: const Key('open_autofocus_form'),
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(
              builder: (_) => const Scaffold(
                body: TextField(
                  key: Key('autofocus_input'),
                  autofocus: true,
                ),
              ),
            )),
            child: const Text('Open autofocus form'),
          );
        }),
      ),
    ));
    await start();
    await tester.tap(find.byKey(const Key('open_autofocus_form')));
    await tester.pumpAndSettle();
    expect(
        tester
            .widget<EditableText>(find.byType(EditableText))
            .focusNode
            .hasFocus,
        true);
    await tester.enterText(find.byKey(const Key('autofocus_input')), 'pasted');
    await stop();
    final inputs =
        events.where((event) => (event['payload'] as Map)['kind'] == 'text');
    expect(inputs, hasLength(1));
    expect((inputs.single['payload'] as Map)['value'], 'pasted');
    expect((inputs.single['target'] as Map)['key'], 'autofocus_input');
    expect((inputs.single['target'] as Map)['status'], 'resolved');
    expect(
        (inputs.single['target'] as Map)['candidates'],
        contains(predicate<Map>((candidate) =>
            candidate['matchCount'] == 1 &&
            candidate['matchesTarget'] == true)));
  });
  testWidgets(
      'flushes composition before submit and records down before its business callback',
      (tester) async {
    final controller = TextEditingController();
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: Column(children: [
      TextField(key: const ValueKey('input'), controller: controller),
      Listener(
          onPointerDown: (_) => controller.text = 'callback value',
          child: TextButton(
              key: const ValueKey('submit'),
              onPressed: () {},
              child: const Text('Submit'))),
    ]))));
    await start();
    await tester.tap(find.byKey(const ValueKey('input')));
    await tester.pump();
    controller.value = const TextEditingValue(
        text: 'final composition', composing: TextRange(start: 0, end: 17));
    await tester.tap(find.byKey(const ValueKey('submit')));
    await stop();
    final composition = events.indexWhere(
        (event) => (event['payload'] as Map)['value'] == 'final composition');
    final submit = events.indexWhere((event) =>
        (event['payload'] as Map)['phase'] == 'down' &&
        (event['target'] as Map?)?['key'] == 'submit');
    final callback = events.indexWhere(
        (event) => (event['payload'] as Map)['value'] == 'callback value');
    expect(composition, greaterThanOrEqualTo(0));
    expect(submit, greaterThan(composition));
    expect(callback, greaterThan(submit));
    controller.dispose();
  });

  testWidgets(
      'emits autofocus and blur sessions with the input target and final clear',
      (tester) async {
    final controller = TextEditingController();
    final focus = FocusNode();
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: TextField(
                key: const ValueKey('input'),
                controller: controller,
                focusNode: focus,
                autofocus: true))));
    await tester.pump();
    await start();
    controller.text = 'pasted';
    controller.text = 'replacement';
    controller.clear();
    focus.unfocus();
    await tester.pump();
    focus.requestFocus();
    await tester.pump();
    controller.text = 'new session';
    await stop();
    final focusEvents = events
        .where((event) => (event['payload'] as Map)['kind'] == 'focus')
        .toList();
    expect(focusEvents.map((event) => (event['payload'] as Map)['focused']),
        [true, false, true]);
    expect(focusEvents[0]['targetId'], focusEvents[1]['targetId']);
    expect((focusEvents[0]['payload'] as Map)['focusSessionId'],
        isNot((focusEvents[2]['payload'] as Map)['focusSessionId']));
    final values = events
        .where((event) => (event['payload'] as Map)['kind'] == 'text')
        .toList();
    expect(values.map((event) => (event['payload'] as Map)['value']),
        ['pasted', 'replacement', '', 'new session']);
    expect(values.first['targetId'], focusEvents.first['targetId']);
    controller.dispose();
    focus.dispose();
  });
  testWidgets(
      'records programmatic route changes including repeated unnamed routes',
      (tester) async {
    final navigator = GlobalKey<NavigatorState>();
    await tester.pumpWidget(MaterialApp(
        navigatorKey: navigator, home: const Scaffold(body: Text('Home'))));
    await start();
    navigator.currentState!.push(MaterialPageRoute<void>(
        builder: (_) => const Scaffold(body: Text('Second'))));
    await tester.pumpAndSettle();
    navigator.currentState!.push(MaterialPageRoute<void>(
        builder: (_) => const Scaffold(body: Text('Third'))));
    await tester.pumpAndSettle();
    navigator.currentState!.pop();
    await tester.pumpAndSettle();
    await stop();
    final routeEvents = events
        .where((event) => (event['payload'] as Map)['kind'] == 'route')
        .toList();
    expect(routeEvents, hasLength(4));
    expect((routeEvents.first['payload'] as Map)['route'], '/');
    final count = events.length;
    navigator.currentState!.pop();
    await tester.pumpAndSettle();
    expect(events, hasLength(count));
  });
  testWidgets(
      'masks sensitive input before emitting events and preserves an explicit clear',
      (tester) async {
    final controller = TextEditingController();
    late StateSetter update;
    var obscure = false;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(body: StatefulBuilder(builder: (_, setState) {
      update = setState;
      return TextField(
          key: const ValueKey('password'),
          controller: controller,
          obscureText: obscure);
    }))));
    await start();
    await tester.tap(find.byKey(const ValueKey('password')));
    await tester.pump();
    update(() => obscure = true);
    await tester.pump();
    controller.text = 'private-one';
    update(() => obscure = false);
    await tester.pump();
    controller.text = 'private-two';
    controller.clear();
    await stop();
    final values = events
        .where((event) => (event['payload'] as Map)['kind'] == 'text')
        .toList();
    expect(values.map((event) => (event['payload'] as Map)['value']),
        ['<masked>', '<masked>', '']);
    expect((values[0]['payload'] as Map)['sensitive'], true);
    expect((values[1]['payload'] as Map)['sensitive'], true);
    expect((values[2]['payload'] as Map)['sensitive'], isNot(true));
    expect(events.toString(), isNot(contains('private-one')));
    expect(events.toString(), isNot(contains('private-two')));
    controller.dispose();
  });
}
