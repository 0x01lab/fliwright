import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  tearDown(() async {
    await FliwrightBridge.reset();
  });

  test('registers a module configured before bridge initialization', () async {
    FliwrightBridge.registerModule(WebSocketMockBridgeModule(_FakeDelegate()));

    await FliwrightBridge.initForDioMock();

    expect(
      FliwrightBridge.registry.isRegistered(
        'ext.fliwright.websocket.setRules',
      ),
      isTrue,
    );
    final handshake = await FliwrightBridge.registry.invoke(
      'ext.fliwright.handshake',
      {'protocolVersion': '1'},
    );
    final capabilities =
        handshake['bridgeCapabilities'] as Map<String, dynamic>;
    expect(capabilities['modules'], [
      {
        'id': 'websocketMock',
        'methods': contains('ext.fliwright.websocket.clearCalls'),
      },
    ]);
  });

  test('forwards generic rules, pushes, and call queries to the host delegate',
      () async {
    final delegate = _FakeDelegate();
    final registry = ExtensionRegistry();
    final module = WebSocketMockBridgeModule(delegate);
    module.register(registry);

    final setResult =
        await registry.invoke('ext.fliwright.websocket.setRules', {
      'rules':
          '[{"id":"orders","connection":"public","channel":"orders","suppressRemote":true,"onSubscribe":[{"payload":{"id":"order-1"},"delayMs":20}]}]',
    });
    final pushResult = await registry.invoke('ext.fliwright.websocket.push', {
      'push':
          '{"connection":"public","channel":"orders","payload":{"id":"order-2"}}',
    });
    final callsResult =
        await registry.invoke('ext.fliwright.websocket.getCalls', {});
    final rulesResult =
        await registry.invoke('ext.fliwright.websocket.getRules', {});
    final clearCallsResult =
        await registry.invoke('ext.fliwright.websocket.clearCalls', {});

    expect(setResult, {'success': true, 'rules': 1});
    expect(pushResult, {
      'success': true,
      'matchedSessions': 1,
      'deliveredSessions': 1,
    });
    expect(delegate.rules.single.connection, 'public');
    expect(delegate.rules.single.onSubscribe.single.delayMs, 20);
    expect(rulesResult['rules'], [
      {
        'id': 'orders',
        'connection': 'public',
        'channel': 'orders',
        'suppressRemote': true,
        'onSubscribe': [
          {
            'connection': 'public',
            'channel': 'orders',
            'payload': {'id': 'order-1'},
            'delayMs': 20,
          },
        ],
      },
    ]);
    expect(delegate.pushes.single.payload, {'id': 'order-2'});
    expect(clearCallsResult, {'success': true});
    expect(delegate.clearCallsCount, 1);
    expect(callsResult['calls'], [
      {
        'connection': 'public',
        'channel': 'orders',
        'direction': 'mock',
        'payload': {'id': 'order-2'},
      },
    ]);
  });

  test('resets registered modules and rejects duplicate identifiers', () async {
    final delegate = _FakeDelegate();
    FliwrightBridge.registerModule(WebSocketMockBridgeModule(delegate));
    expect(
      () => FliwrightBridge.registerModule(
          WebSocketMockBridgeModule(_FakeDelegate())),
      throwsStateError,
    );

    await FliwrightBridge.reset();

    expect(delegate.rules, isEmpty);
    expect(delegate.clearCallsCount, 1);
  });

  test('rejects malformed rules instead of silently omitting them', () async {
    final registry = ExtensionRegistry();
    WebSocketMockBridgeModule(_FakeDelegate()).register(registry);

    final result = await registry.invoke('ext.fliwright.websocket.setRules', {
      'rules':
          '[{"id":"orders","connection":"public","channel":"orders","onSubscribe":[{}]},null]',
    });

    expect(result['success'], isFalse);
    expect(result['error'], contains('payload is required'));
  });
}

class _FakeDelegate implements WebSocketMockDelegate {
  List<WebSocketMockRule> rules = [];
  final List<WebSocketMockPush> pushes = [];
  int clearCallsCount = 0;

  @override
  Future<void> clearRules() async {
    rules = [];
  }

  @override
  Future<List<WebSocketMockRule>> getRules() async => rules;

  @override
  Future<void> clearCalls() async {
    clearCallsCount++;
  }

  @override
  Future<List<WebSocketMockCall>> getCalls() async => [
        const WebSocketMockCall(
          connection: 'public',
          channel: 'orders',
          direction: 'mock',
          payload: {'id': 'order-2'},
        ),
      ];

  @override
  Future<WebSocketMockPushResult> push(WebSocketMockPush push) async {
    pushes.add(push);
    return const WebSocketMockPushResult(
      matchedSessions: 1,
      deliveredSessions: 1,
    );
  }

  @override
  Future<void> setRules(List<WebSocketMockRule> rules) async {
    this.rules = rules;
  }
}
