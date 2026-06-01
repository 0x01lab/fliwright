import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'pages/home_page.dart';
import 'pages/login_page.dart';
import 'pages/register_page.dart';
import 'pages/profile_page.dart';

// ── Top-level routes ────────────────────────────────────────

final _rootNavigatorKey = GlobalKey<NavigatorState>();
final _shellNavigatorKey = GlobalKey<NavigatorState>();

final appRouter = GoRouter(
  navigatorKey: _rootNavigatorKey,
  initialLocation: '/',
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const HomePage(),
    ),
    GoRoute(
      path: '/login',
      builder: (context, state) => const LoginPage(),
    ),
    GoRoute(
      path: '/register',
      builder: (context, state) => const RegisterPage(),
    ),
    GoRoute(
      path: '/profile/edit',
      builder: (context, state) {
        final extra = state.extra as Map<String, String>?;
        return ProfileEditPage(initialData: extra);
      },
    ),
    // ShellRoute with bottom navigation bar
    ShellRoute(
      navigatorKey: _shellNavigatorKey,
      builder: (context, state, child) {
        return ShellScaffold(child: child);
      },
      routes: [
        GoRoute(
          path: '/shell/home',
          builder: (context, state) => const ShellHomePage(),
        ),
        GoRoute(
          path: '/shell/settings',
          builder: (context, state) => const ShellSettingsPage(),
        ),
      ],
    ),
  ],
);

// ── Shell layout ────────────────────────────────────────────

class ShellScaffold extends StatelessWidget {
  final Widget child;
  const ShellScaffold({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: child,
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentIndex(context),
        onTap: (index) {
          switch (index) {
            case 0:
              context.go('/shell/home');
              break;
            case 1:
              context.go('/shell/settings');
              break;
          }
        },
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.home), label: '首页'),
          BottomNavigationBarItem(icon: Icon(Icons.settings), label: '设置'),
        ],
      ),
    );
  }

  int _currentIndex(BuildContext context) {
    final location = GoRouterState.of(context).uri.path;
    if (location.startsWith('/shell/settings')) return 1;
    return 0;
  }
}

// ── Shell sub-pages ─────────────────────────────────────────

class ShellHomePage extends StatelessWidget {
  const ShellHomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.home, size: 64, color: Colors.blue),
          SizedBox(height: 16),
          Text('Shell 首页', style: TextStyle(fontSize: 24)),
        ],
      ),
    );
  }
}

class ShellSettingsPage extends StatefulWidget {
  const ShellSettingsPage({super.key});

  @override
  State<ShellSettingsPage> createState() => _ShellSettingsPageState();
}

class _ShellSettingsPageState extends State<ShellSettingsPage> {
  final _nicknameController = TextEditingController();
  final _bioController = TextEditingController();

  @override
  void dispose() {
    _nicknameController.dispose();
    _bioController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('设置', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
          const SizedBox(height: 24),
          TextField(
            controller: _nicknameController,
            decoration: const InputDecoration(
              hintText: '输入昵称',
              labelText: '昵称',
              prefixIcon: Icon(Icons.person),
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _bioController,
            decoration: const InputDecoration(
              hintText: '个人简介',
              labelText: '简介',
              prefixIcon: Icon(Icons.info),
              border: OutlineInputBorder(),
            ),
            maxLines: 3,
          ),
        ],
      ),
    );
  }
}
