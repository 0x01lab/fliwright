import 'package:hive_ce_flutter/hive_flutter.dart';

import 'mock_rule_store.dart';

/// Hive-backed storage for active Fliwright mock routes.
///
/// Routes are stored in a normalized key-value shape:
/// - [routeIndexKey] contains the active route keys in display order.
/// - each `route:<METHOD> <path>` key contains one route map.
/// - [versionKey] stores the payload schema version.
///
/// This keeps the list nature of mock rules while still making each route easy
/// to inspect from an in-app debug panel.
class HiveMockRuleStorage implements MockRuleStorage {
  HiveMockRuleStorage._(
    this._box, {
    required this.routeIndexKey,
    required this.versionKey,
  });

  static const String defaultBoxName = 'fliwright_mock_rules';
  static const String defaultRouteIndexKey = 'routeIndex';
  static const String defaultVersionKey = 'version';
  static const String legacyRulesKey = 'activeRules';

  final Box<dynamic> _box;
  final String routeIndexKey;
  final String versionKey;

  Box<dynamic> get box => _box;

  String? get path => _box.path;

  static HiveMockRuleStorage fromBox(
    Box<dynamic> box, {
    String routeIndexKey = defaultRouteIndexKey,
    String versionKey = defaultVersionKey,
  }) {
    return HiveMockRuleStorage._(
      box,
      routeIndexKey: routeIndexKey,
      versionKey: versionKey,
    );
  }

  static Future<HiveMockRuleStorage> open({
    String boxName = defaultBoxName,
    String routeIndexKey = defaultRouteIndexKey,
    String versionKey = defaultVersionKey,
  }) async {
    await Hive.initFlutter();
    final box = Hive.isBoxOpen(boxName)
        ? Hive.box<dynamic>(boxName)
        : await Hive.openBox<dynamic>(boxName);
    return HiveMockRuleStorage._(
      box,
      routeIndexKey: routeIndexKey,
      versionKey: versionKey,
    );
  }

  @override
  Future<String?> load() async {
    final index = _box.get(routeIndexKey);
    if (index is List) {
      final rules = <Object?>[];
      for (final key in index) {
        if (key is! String) continue;
        final route = _box.get(key);
        if (route != null) rules.add(route);
      }
      return MockRuleStore.encodeStoragePayload({
        'version': _box.get(versionKey) ?? 1,
        'rules': rules,
      });
    }

    final legacyValue = _box.get(legacyRulesKey);
    if (legacyValue == null) return null;
    return MockRuleStore.encodeStoragePayload(legacyValue);
  }

  @override
  Future<void> save(String json) async {
    final payload = MockRuleStore.decodeStoragePayload(json);
    final rules = payload['rules'];
    final nextKeys = <String>[];

    if (rules is List) {
      for (final item in rules) {
        final route = MockRuleStore.decodeStoragePayload(item);
        if (route.isEmpty) continue;
        final key = _routeStorageKey(route);
        nextKeys.add(key);
        await _box.put(key, route);
      }
    }

    final previousIndex = _box.get(routeIndexKey);
    if (previousIndex is List) {
      for (final key in previousIndex) {
        if (key is String && !nextKeys.contains(key)) {
          await _box.delete(key);
        }
      }
    }

    await _box.put(versionKey, payload['version'] ?? 1);
    await _box.put(routeIndexKey, nextKeys);
    await _box.delete(legacyRulesKey);
    await _box.flush();
  }

  String _routeStorageKey(Map<String, dynamic> route) {
    final method = (route['method'] as String?)?.toUpperCase() ?? '*';
    final path =
        route['pathPattern'] as String? ?? route['path'] as String? ?? '/';
    return 'route:$method $path';
  }
}
