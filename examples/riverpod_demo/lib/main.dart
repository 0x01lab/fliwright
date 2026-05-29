import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final counterProvider = StateProvider<int>((ref) => 0);
final userProvider = StateProvider<Map<String, dynamic>?>((ref) => null);

void main() {
  runApp(const ProviderScope(child: MyApp()));
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Fliwright Riverpod Demo',
      home: const HomePage(),
    );
  }
}

class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final count = ref.watch(counterProvider);
    final user = ref.watch(userProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Fliwright Demo')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text('Count: $count', key: const Key('counter_text')),
            const SizedBox(height: 16),
            if (user != null)
              Text('User: ${user['name']}', key: const Key('user_text'))
            else
              const Text('No user logged in', key: Key('no_user_text')),
            const SizedBox(height: 16),
            ElevatedButton(
              key: const Key('increment_button'),
              onPressed: () => ref.read(counterProvider.notifier).state++,
              child: const Text('Increment'),
            ),
          ],
        ),
      ),
    );
  }
}
