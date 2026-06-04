import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:fliwright_bridge_riverpod/fliwright_bridge_riverpod.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart';
import 'package:flutter_test/flutter_test.dart';

final counterProvider = StateProvider<int>(
  (ref) => 0,
  name: 'counterProvider',
);

final failingProvider = Provider<int>(
  (ref) => throw StateError('provider failed during initialization'),
  name: 'failingProvider',
);

final objectProvider = Provider<_InspectableObject>(
  (ref) => const _InspectableObject('alpha'),
  name: 'objectProvider',
);

final asyncObjectProvider = Provider<AsyncValue<_JsonConfig>>(
  (ref) => const AsyncData(_JsonConfig('https://api.example.test')),
  name: 'asyncObjectProvider',
);

final asyncBaseObjectProvider = Provider<AsyncValue<_BaseConfig>>(
  (ref) => const AsyncData<_BaseConfig>(
    _JsonConfig('https://base.example.test'),
  ),
  name: 'asyncBaseObjectProvider',
);

final futureBaseObjectProvider = FutureProvider<_BaseConfig>(
  (ref) async => const _JsonConfig('https://future.example.test'),
  name: 'futureBaseObjectProvider',
);

void main() {
  setUp(() async {
    await FliwrightBridge.reset();
    await FliwrightBridge.init();
  });

  test('observer records provider values for bridge list/read', () async {
    final container = ProviderContainer(
      observers: const [FliwrightRiverpodObserver()],
    );
    addTearDown(container.dispose);

    expect(container.read(counterProvider), 0);

    final status = await FliwrightBridge.registry.invoke(
      'ext.fliwright.riverpod.status',
      {},
    );
    expect(status['observerInstalled'], isTrue);
    expect(status['providerCount'], 1);

    final list = await FliwrightBridge.registry.invoke(
      'ext.fliwright.riverpod.list',
      {},
    );
    final providers = list['providers'] as List<dynamic>;
    expect(providers, isNotEmpty);
    expect(providers.first['key'], 'counterProvider');
    expect(providers.first['value'], 0);

    final read = await FliwrightBridge.registry.invoke(
      'ext.fliwright.riverpod.read',
      {'provider': 'counterProvider'},
    );
    expect(read['found'], isTrue);
    expect(read['value'], 0);
  });

  test('observer updates cached value after provider changes', () async {
    final container = ProviderContainer(
      observers: const [FliwrightRiverpodObserver()],
    );
    addTearDown(container.dispose);

    container.read(counterProvider);
    container.read(counterProvider.notifier).state = 2;

    final read = await FliwrightBridge.registry.invoke(
      'ext.fliwright.riverpod.read',
      {'provider': 'counterProvider'},
    );
    expect(read['value'], 2);
  });

  test('registered writable providers can be overridden through the bridge',
      () async {
    final container = ProviderContainer(
      observers: const [FliwrightRiverpodObserver()],
    );
    addTearDown(container.dispose);
    container.read(counterProvider);

    registerFliwrightWritableProvider(
      'counterProvider',
      (value) {
        final next = value as int;
        container.read(counterProvider.notifier).state = next;
        return next;
      },
      displayName: 'counterProvider',
      providerType: 'StateProvider<int>',
    );

    final result = await FliwrightBridge.registry.invoke(
      'ext.fliwright.riverpod.override',
      {'provider': 'counterProvider', 'value': '3'},
    );
    expect(result['overridden'], isTrue);
    expect(container.read(counterProvider), 3);

    final read = await FliwrightBridge.registry.invoke(
      'ext.fliwright.riverpod.read',
      {'provider': 'counterProvider'},
    );
    expect(read['value'], 3);
  });

  test('failed providers preserve read errors instead of returning null',
      () async {
    final container = ProviderContainer(
      observers: const [FliwrightRiverpodObserver()],
    );
    addTearDown(container.dispose);

    expect(() => container.read(failingProvider), throwsA(anything));

    final read = await FliwrightBridge.registry.invoke(
      'ext.fliwright.riverpod.read',
      {'provider': 'failingProvider'},
    );
    expect(read['found'], isTrue);
    expect(read['value'], isNull);
    expect(read['error'], contains('provider failed during initialization'));
  });

  test('registered serializers expose object provider values as JSON-safe maps',
      () async {
    final container = ProviderContainer(
      observers: const [FliwrightRiverpodObserver()],
    );
    addTearDown(container.dispose);
    registerFliwrightProviderSerializer('objectProvider', (value) {
      final object = value as _InspectableObject;
      return {'label': object.label};
    });

    expect(container.read(objectProvider).label, 'alpha');

    final read = await FliwrightBridge.registry.invoke(
      'ext.fliwright.riverpod.read',
      {'provider': 'objectProvider'},
    );
    expect(read['value'], {'label': 'alpha'});
  });

  test('async values expose nested toJson model fields', () async {
    final container = ProviderContainer(
      observers: const [FliwrightRiverpodObserver()],
    );
    addTearDown(container.dispose);

    expect(container.read(asyncObjectProvider).hasValue, isTrue);

    final read = await FliwrightBridge.registry.invoke(
      'ext.fliwright.riverpod.read',
      {'provider': 'asyncObjectProvider'},
    );
    expect(read['found'], isTrue);
    expect(read['value'], {
      r'$kind': 'AsyncData<_JsonConfig>',
      r'$type': 'AsyncData<_JsonConfig>',
      r'$encodedBy': 'riverpod.AsyncValue',
      'isLoading': false,
      'isRefreshing': false,
      'isReloading': false,
      'hasValue': true,
      'hasError': false,
      'retrying': false,
      'value': {
        r'$type': '_JsonConfig',
        r'$encodedBy': 'toJson',
        'value': {
          'baseUrl': 'https://api.example.test',
        },
      },
    });
  });

  test('async values preserve runtime model data when declared as base type',
      () async {
    final container = ProviderContainer(
      observers: const [FliwrightRiverpodObserver()],
    );
    addTearDown(container.dispose);

    expect(container.read(asyncBaseObjectProvider).hasValue, isTrue);

    final read = await FliwrightBridge.registry.invoke(
      'ext.fliwright.riverpod.read',
      {'provider': 'asyncBaseObjectProvider'},
    );
    expect(read['found'], isTrue);
    expect(read['value'], {
      r'$kind': 'AsyncData<_BaseConfig>',
      r'$type': 'AsyncData<_BaseConfig>',
      r'$encodedBy': 'riverpod.AsyncValue',
      'isLoading': false,
      'isRefreshing': false,
      'isReloading': false,
      'hasValue': true,
      'hasError': false,
      'retrying': false,
      'value': {
        r'$type': '_JsonConfig',
        r'$encodedBy': 'toJson',
        'value': {
          'baseUrl': 'https://base.example.test',
        },
      },
    });
  });

  test('future providers expose completed async model values', () async {
    final container = ProviderContainer(
      observers: const [FliwrightRiverpodObserver()],
    );
    addTearDown(container.dispose);

    expect(container.read(futureBaseObjectProvider).isLoading, isTrue);
    expect(await container.read(futureBaseObjectProvider.future),
        isA<_JsonConfig>());

    final read = await FliwrightBridge.registry.invoke(
      'ext.fliwright.riverpod.read',
      {'provider': 'futureBaseObjectProvider'},
    );
    expect(read['found'], isTrue);
    expect(read['value'], {
      r'$kind': 'AsyncData<_BaseConfig>',
      r'$type': 'AsyncData<_BaseConfig>',
      r'$encodedBy': 'riverpod.AsyncValue',
      'isLoading': false,
      'isRefreshing': false,
      'isReloading': false,
      'hasValue': true,
      'hasError': false,
      'retrying': false,
      'value': {
        r'$type': '_JsonConfig',
        r'$encodedBy': 'toJson',
        'value': {
          'baseUrl': 'https://future.example.test',
        },
      },
    });
  });
}

class _InspectableObject {
  const _InspectableObject(this.label);

  final String label;
}

abstract class _BaseConfig {
  const _BaseConfig();

  String get baseUrl;
}

class _JsonConfig extends _BaseConfig {
  const _JsonConfig(this.baseUrl);

  @override
  final String baseUrl;

  Map<String, Object?> toJson() => {
        'baseUrl': baseUrl,
      };
}
