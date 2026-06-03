import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:fliwright_bridge_riverpod/fliwright_bridge_riverpod.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

final counterProvider = StateProvider<int>(
  (ref) => 0,
  name: 'counterProvider',
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
}
