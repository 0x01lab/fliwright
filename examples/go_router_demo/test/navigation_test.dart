import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router_demo/main.dart';
import 'package:go_router_demo/router.dart';

void main() {
  testWidgets('home navigation opens the login form and returns home', (
    tester,
  ) async {
    appRouter.go('/');
    await tester.pumpWidget(const GoRouterDemoApp());
    await tester.pumpAndSettle();
    await tester.tap(find.text('登录页'));
    await tester.pumpAndSettle();
    expect(appRouter.routeInformationProvider.value.uri.path, '/login');
    expect(find.text('导航到表单页面'), findsNothing);
    expect(find.text('手机号'), findsOneWidget);
    expect(find.text('返回首页'), findsOneWidget);
    await tester.tap(find.text('返回首页'));
    await tester.pumpAndSettle();
    expect(find.text('导航到表单页面'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('shell navigation switches from home to the settings form', (
    tester,
  ) async {
    appRouter.go('/');
    await tester.pumpWidget(const GoRouterDemoApp());
    await tester.pumpAndSettle();
    await tester.tap(find.text('ShellRoute (底部导航)'));
    await tester.pumpAndSettle();
    expect(find.text('Shell 首页'), findsOneWidget);
    await tester.tap(find.byIcon(Icons.settings));
    await tester.pumpAndSettle();
    expect(find.text('昵称'), findsOneWidget);
    expect(find.text('个人简介'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
