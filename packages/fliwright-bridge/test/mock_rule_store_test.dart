import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

/// In-memory [MockRuleStorage] for tests — avoids touching Hive while still
/// exercising the load/save contract that backs persistence.
class _MemoryStorage implements MockRuleStorage {
  String? _data;

  @override
  Future<String?> load() async => _data;

  @override
  Future<void> save(String json) async {
    _data = json;
  }
}

MockRoute _route(String id, {String method = 'GET', String path = '/api/x'}) {
  return MockRoute(id: id, method: method, pathPattern: path, status: 200);
}

void main() {
  // Regression guard for "no active rule in VSCode but Flutter still mocks":
  // removeRoute/clearRoutes must mutate the authoritative in-memory map and
  // persist the result, never reloading stale routes from storage first.
  group('MockRuleStore resurrection guard', () {
    test('clearRoutes empties memory and persists empty state', () async {
      final storage = _MemoryStorage();
      await (MockRuleStore(storage: storage)).addRoute(_route('a'));

      final store = MockRuleStore(storage: storage);
      await store.loadFromStorage();
      expect(store.getAllRoutes(), hasLength(1));

      final cleared = await store.clearRoutes();
      expect(cleared, 1);
      expect(store.getAllRoutes(), isEmpty);

      // A freshly loaded store must NOT see the cleared route again.
      final reloaded = MockRuleStore(storage: storage);
      await reloaded.loadFromStorage();
      expect(reloaded.getAllRoutes(), isEmpty);
    });

    test('removeRoute mutates in-memory state without reloading stale routes', () async {
      final storage = _MemoryStorage();
      final seed = MockRuleStore(storage: storage);
      await seed.addRoute(_route('a', path: '/api/a'));
      await seed.addRoute(_route('b', path: '/api/b'));

      final store = MockRuleStore(storage: storage);
      await store.loadFromStorage();
      expect(store.getAllRoutes(), hasLength(2));

      expect(await store.removeRoute(path: '/api/a', method: 'GET'), isTrue);
      expect(store.getAllRoutes(), hasLength(1));
      expect(store.findRoute('GET', '/api/a'), isNull);
      expect(store.findRoute('GET', '/api/b')?.id, 'b');

      final reloaded = MockRuleStore(storage: storage);
      await reloaded.loadFromStorage();
      expect(reloaded.findRoute('GET', '/api/a'), isNull);
      expect(reloaded.findRoute('GET', '/api/b')?.id, 'b');
    });

    test('in-memory store stays authoritative across add/remove after one init load', () async {
      final storage = _MemoryStorage();
      await (MockRuleStore(storage: storage)).addRoute(_route('a'));

      final store = MockRuleStore(storage: storage);
      await store.loadFromStorage();
      expect(store.getAllRoutes(), hasLength(1));

      expect(await store.removeRoute(path: '/api/x', method: 'GET'), isTrue);
      expect(store.getAllRoutes(), isEmpty);

      await store.addRoute(_route('c', path: '/api/c'));
      expect(store.findRoute('GET', '/api/c')?.id, 'c');

      final reloaded = MockRuleStore(storage: storage);
      await reloaded.loadFromStorage();
      expect(reloaded.findRoute('GET', '/api/x'), isNull);
      expect(reloaded.findRoute('GET', '/api/c')?.id, 'c');
    });
  });

  // Root-cause confirmation for "VSCode rules vanish after running a test":
  // a test's mock.clearRoutes() -> ext.fliwright.mock.clearRoutes ->
  // store.clearRoutes currently wipes EVERY route, including ones VSCode
  // applied with a fliwright-vscode: id. VSCode and tests share one store, so
  // a test clearing its own routes also clears VSCode's.
  group('clearRoutes prefix behavior (root-cause confirmation)', () {
    test('clearRoutes wipes both fliwright-vscode:-prefixed and foreign routes', () async {
      final store = MockRuleStore();
      await store.addRoute(_route('fliwright-vscode:GET:%2Fapi%2Fa:success', path: '/api/a'));
      await store.addRoute(_route('test-injected-route', path: '/api/b'));
      expect(store.getAllRoutes(), hasLength(2));

      final cleared = await store.clearRoutes();

      expect(cleared, 2);
      expect(store.getAllRoutes(), isEmpty);
      // VSCode's prefixed route is gone too — this is the conflict.
      expect(store.findRoute('GET', '/api/a'), isNull);
    });

    test('clearForeignRoutes preserves fliwright-vscode:-prefixed routes, clears foreign', () async {
      final store = MockRuleStore();
      await store.addRoute(_route('fliwright-vscode:GET:%2Fapi%2Fa:success', path: '/api/a'));
      await store.addRoute(_route('fliwright-vscode:POST:%2Fapi%2Fb:error', method: 'POST', path: '/api/b'));
      await store.addRoute(_route('test-injected-1', path: '/api/c'));
      await store.addRoute(_route('test-injected-2', path: '/api/d'));
      expect(store.getAllRoutes(), hasLength(4));

      final cleared = await store.clearForeignRoutes();

      expect(cleared, 2);
      final remaining = store.getAllRoutes();
      expect(remaining, hasLength(2));
      expect(remaining.every((r) => r.id.startsWith('fliwright-vscode:')), isTrue);
      expect(store.findRoute('GET', '/api/a')?.id, 'fliwright-vscode:GET:%2Fapi%2Fa:success');
      expect(store.findRoute('POST', '/api/b')?.id, 'fliwright-vscode:POST:%2Fapi%2Fb:error');
      expect(store.findRoute('GET', '/api/c'), isNull);
      expect(store.findRoute('GET', '/api/d'), isNull);
    });
  });
}
