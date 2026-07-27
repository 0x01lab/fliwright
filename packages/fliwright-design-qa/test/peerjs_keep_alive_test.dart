import 'package:fliwright_design_qa/src/peerjs_keep_alive.dart';
import 'package:fliwright_design_qa/src/peerjs_signaling.dart';
import 'package:test/test.dart';

void main() {
  test('sends a heartbeat for every scheduled idle interval', () {
    final scheduler = _FakePeriodicTaskFactory();
    final messages = <DesignQaPeerJsMessage>[];
    final keepAlive = DesignQaPeerJsSignalingKeepAlive(
      interval: const Duration(seconds: 5),
      schedule: scheduler.schedule,
      send: messages.add,
    );

    keepAlive.start();
    scheduler.fire();

    expect(scheduler.interval, const Duration(seconds: 5));
    expect(messages.single.type, DesignQaPeerJsMessageType.heartbeat);
  });

  test('stops scheduled heartbeats when the signaling session closes', () {
    final scheduler = _FakePeriodicTaskFactory();
    final keepAlive = DesignQaPeerJsSignalingKeepAlive(
      schedule: scheduler.schedule,
      send: (_) {},
    );

    keepAlive.start();
    keepAlive.stop();

    expect(scheduler.task.cancelled, isTrue);
  });
}

class _FakePeriodicTaskFactory {
  Duration? interval;
  late _FakePeriodicTask task;

  DesignQaPeriodicTask schedule(Duration interval, void Function() callback) {
    this.interval = interval;
    task = _FakePeriodicTask(callback);
    return task;
  }

  void fire() {
    task.callback();
  }
}

class _FakePeriodicTask implements DesignQaPeriodicTask {
  _FakePeriodicTask(this.callback);

  final void Function() callback;
  bool cancelled = false;

  @override
  void cancel() {
    cancelled = true;
  }
}
