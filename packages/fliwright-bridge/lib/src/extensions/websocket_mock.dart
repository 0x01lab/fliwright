import 'dart:convert';

import '../bridge_module.dart';
import '../extension_registry.dart';

/// A transport-neutral mock rule. Applications define how [connection] and
/// [channel] map to their realtime protocol.
class WebSocketMockRule {
  const WebSocketMockRule({
    required this.id,
    required this.connection,
    required this.channel,
    this.suppressRemote = false,
    this.onSubscribe = const [],
  });

  final String id;
  final String connection;
  final String channel;
  final bool suppressRemote;
  final List<WebSocketMockPush> onSubscribe;

  factory WebSocketMockRule.fromJson(Map<String, dynamic> json) {
    final id = json['id'];
    final connection = json['connection'];
    final channel = json['channel'];
    if (id is! String || id.isEmpty) {
      throw const FormatException('WebSocket mock rule id is required.');
    }
    if (connection is! String || connection.isEmpty) {
      throw const FormatException(
          'WebSocket mock rule connection is required.');
    }
    if (channel is! String || channel.isEmpty) {
      throw const FormatException('WebSocket mock rule channel is required.');
    }
    final suppressRemote = json['suppressRemote'];
    if (suppressRemote != null && suppressRemote is! bool) {
      throw const FormatException(
          'WebSocket mock rule suppressRemote must be a boolean.');
    }
    final pushes = json['onSubscribe'];
    if (pushes != null && pushes is! List) {
      throw const FormatException(
          'WebSocket mock rule onSubscribe must be a JSON array.');
    }
    final onSubscribe = <WebSocketMockPush>[];
    if (pushes is List) {
      for (var index = 0; index < pushes.length; index++) {
        final push = pushes[index];
        if (push is! Map) {
          throw FormatException(
            'WebSocket mock rule onSubscribe[$index] must be a JSON object.',
          );
        }
        onSubscribe.add(WebSocketMockPush.fromJson(
          _stringKeyedMap(push),
          defaultConnection: connection,
          defaultChannel: channel,
        ));
      }
    }
    return WebSocketMockRule(
      id: id,
      connection: connection,
      channel: channel,
      suppressRemote: suppressRemote ?? false,
      onSubscribe: onSubscribe,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'connection': connection,
        'channel': channel,
        'suppressRemote': suppressRemote,
        if (onSubscribe.isNotEmpty)
          'onSubscribe': onSubscribe.map((push) => push.toJson()).toList(),
      };
}

class WebSocketMockPush {
  const WebSocketMockPush({
    required this.connection,
    required this.channel,
    required this.payload,
    this.delayMs = 0,
  });

  final String connection;
  final String channel;
  final Object? payload;
  final int delayMs;

  factory WebSocketMockPush.fromJson(
    Map<String, dynamic> json, {
    String? defaultConnection,
    String? defaultChannel,
  }) {
    final connection = json['connection'] ?? defaultConnection;
    final channel = json['channel'] ?? defaultChannel;
    if (connection is! String || connection.isEmpty) {
      throw const FormatException(
          'WebSocket mock push connection is required.');
    }
    if (channel is! String || channel.isEmpty) {
      throw const FormatException('WebSocket mock push channel is required.');
    }
    if (!json.containsKey('payload')) {
      throw const FormatException('WebSocket mock push payload is required.');
    }
    final delayMs = json['delayMs'];
    if (delayMs != null && (delayMs is! int || delayMs < 0)) {
      throw const FormatException(
          'WebSocket mock push delayMs must be a non-negative integer.');
    }
    return WebSocketMockPush(
      connection: connection,
      channel: channel,
      payload: json['payload'],
      delayMs: delayMs ?? 0,
    );
  }

  Map<String, dynamic> toJson() => {
        'connection': connection,
        'channel': channel,
        'payload': payload,
        'delayMs': delayMs,
      };
}

/// The app-level outcome of a synthetic message delivery attempt.
class WebSocketMockPushResult {
  const WebSocketMockPushResult({
    required this.matchedSessions,
    required this.deliveredSessions,
  });

  final int matchedSessions;
  final int deliveredSessions;

  Map<String, dynamic> toJson() => {
        'matchedSessions': matchedSessions,
        'deliveredSessions': deliveredSessions,
      };
}

class WebSocketMockCall {
  const WebSocketMockCall({
    required this.connection,
    required this.direction,
    this.channel,
    this.mockPayload,
    this.payload,
  });

  final String connection;
  final String direction;
  final String? channel;
  final Object? mockPayload;
  final Object? payload;

  Map<String, dynamic> toJson() => {
        'connection': connection,
        if (channel != null) 'channel': channel,
        'direction': direction,
        if (mockPayload != null) 'mockPayload': mockPayload,
        if (payload != null) 'payload': payload,
      };
}

/// Application-owned implementation of WebSocket protocol interception.
abstract interface class WebSocketMockDelegate {
  Future<void> setRules(List<WebSocketMockRule> rules);
  Future<void> clearRules();
  Future<List<WebSocketMockRule>> getRules();
  Future<void> clearCalls();
  Future<WebSocketMockPushResult> push(WebSocketMockPush push);
  Future<List<WebSocketMockCall>> getCalls();
}

/// VM extensions that expose generic WebSocket mock control to Fliwright.
class WebSocketMockBridgeModule implements FliwrightBridgeModule {
  WebSocketMockBridgeModule(this.delegate);

  final WebSocketMockDelegate delegate;

  @override
  String get id => 'websocketMock';

  @override
  bool get isAvailable => true;

  @override
  Map<String, Object?> describe() => {
        'id': id,
        'methods': const [
          'ext.fliwright.websocket.setRules',
          'ext.fliwright.websocket.clearRules',
          'ext.fliwright.websocket.getRules',
          'ext.fliwright.websocket.clearCalls',
          'ext.fliwright.websocket.push',
          'ext.fliwright.websocket.getCalls',
        ],
      };

  @override
  void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.websocket.setRules', _setRules);
    registry.register('ext.fliwright.websocket.clearRules', _clearRules);
    registry.register('ext.fliwright.websocket.getRules', _getRules);
    registry.register('ext.fliwright.websocket.clearCalls', _clearCalls);
    registry.register('ext.fliwright.websocket.push', _push);
    registry.register('ext.fliwright.websocket.getCalls', _getCalls);
  }

  @override
  Future<void> reset() async {
    await delegate.clearRules();
    await delegate.clearCalls();
  }

  Future<Map<String, dynamic>> _setRules(Map<String, String> params) async {
    try {
      final decoded = jsonDecode(params['rules'] ?? '[]');
      if (decoded is! List) {
        return {
          'success': false,
          'error': 'WebSocket mock rules must be a JSON array.'
        };
      }
      final rules = <WebSocketMockRule>[];
      for (var index = 0; index < decoded.length; index++) {
        final rule = decoded[index];
        if (rule is! Map) {
          throw FormatException(
            'WebSocket mock rules[$index] must be a JSON object.',
          );
        }
        rules.add(WebSocketMockRule.fromJson(_stringKeyedMap(rule)));
      }
      await delegate.setRules(rules);
      return {'success': true, 'rules': rules.length};
    } on Object catch (error) {
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> _clearRules(Map<String, String> params) async {
    try {
      await delegate.clearRules();
      return {'success': true};
    } on Object catch (error) {
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> _getRules(Map<String, String> params) async {
    try {
      final rules = await delegate.getRules();
      return {
        'success': true,
        'rules': rules.map((rule) => rule.toJson()).toList(),
      };
    } on Object catch (error) {
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> _clearCalls(Map<String, String> params) async {
    try {
      await delegate.clearCalls();
      return {'success': true};
    } on Object catch (error) {
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> _push(Map<String, String> params) async {
    try {
      final decoded = jsonDecode(params['push'] ?? '{}');
      if (decoded is! Map) {
        return {
          'success': false,
          'error': 'WebSocket mock push must be a JSON object.'
        };
      }
      final result = await delegate
          .push(WebSocketMockPush.fromJson(_stringKeyedMap(decoded)));
      return {'success': true, ...result.toJson()};
    } on Object catch (error) {
      return {'success': false, 'error': error.toString()};
    }
  }

  Future<Map<String, dynamic>> _getCalls(Map<String, String> params) async {
    try {
      final calls = await delegate.getCalls();
      return {
        'success': true,
        'calls': calls.map((call) => call.toJson()).toList()
      };
    } on Object catch (error) {
      return {'success': false, 'error': error.toString()};
    }
  }
}

Map<String, dynamic> _stringKeyedMap(Map<dynamic, dynamic> map) => {
      for (final entry in map.entries) entry.key.toString(): entry.value,
    };
