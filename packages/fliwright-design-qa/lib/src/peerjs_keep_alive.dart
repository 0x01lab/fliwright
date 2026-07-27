import 'dart:async';

import 'peerjs_signaling.dart';

abstract interface class DesignQaPeriodicTask {
  void cancel();
}

typedef DesignQaPeriodicTaskFactory = DesignQaPeriodicTask Function(
  Duration interval,
  void Function() callback,
);

/// Sends PeerJS heartbeats while a signaling socket is otherwise idle.
class DesignQaPeerJsSignalingKeepAlive {
  DesignQaPeerJsSignalingKeepAlive({
    this.interval = const Duration(seconds: 5),
    required void Function(DesignQaPeerJsMessage message) send,
    DesignQaPeriodicTaskFactory? schedule,
  })  : _send = send,
        _schedule = schedule ?? _schedulePeriodicTask;

  final Duration interval;
  final void Function(DesignQaPeerJsMessage message) _send;
  final DesignQaPeriodicTaskFactory _schedule;
  DesignQaPeriodicTask? _task;

  void start() {
    stop();
    _task = _schedule(interval, () {
      _send(designQaPeerJsHeartbeatMessage());
    });
  }

  void stop() {
    _task?.cancel();
    _task = null;
  }
}

DesignQaPeriodicTask _schedulePeriodicTask(
  Duration interval,
  void Function() callback,
) {
  return _TimerPeriodicTask(Timer.periodic(interval, (_) => callback()));
}

class _TimerPeriodicTask implements DesignQaPeriodicTask {
  _TimerPeriodicTask(this._timer);

  final Timer _timer;

  @override
  void cancel() {
    _timer.cancel();
  }
}
