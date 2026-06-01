import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class HomePage extends StatelessWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Fliwright GoRouter Demo')),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              '导航到表单页面',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: () => context.go('/login'),
              icon: const Icon(Icons.login),
              label: const Text('登录页'),
            ),
            const SizedBox(height: 12),
            ElevatedButton.icon(
              onPressed: () => context.go('/register'),
              icon: const Icon(Icons.app_registration),
              label: const Text('注册页'),
            ),
            const SizedBox(height: 12),
            ElevatedButton.icon(
              onPressed: () => context.go('/profile/edit'),
              icon: const Icon(Icons.person),
              label: const Text('编辑资料'),
            ),
            const SizedBox(height: 12),
            ElevatedButton.icon(
              onPressed: () => context.go('/shell/home'),
              icon: const Icon(Icons.widgets),
              label: const Text('ShellRoute (底部导航)'),
            ),
          ],
        ),
      ),
    );
  }
}
