import 'package:flutter_test/flutter_test.dart';
import 'package:go_router_demo/main.dart';
import 'package:go_router_demo/router.dart';

void main() {
  testWidgets('home navigation opens the login form', (tester) async {
    appRouter.go('/');
    await tester.pumpWidget(const GoRouterDemoApp());
    await tester.pumpAndSettle();
    expect(find.text('导航到表单页面'), findsOneWidget);
    await tester.tap(find.text('登录页'));
    await tester.pumpAndSettle();
    expect(appRouter.routeInformationProvider.value.uri.path, '/login');
    expect(find.text('导航到表单页面'), findsNothing);
  });
}
