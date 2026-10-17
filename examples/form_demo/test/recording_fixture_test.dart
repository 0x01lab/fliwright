import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:form_demo/recording_fixture.dart';

void main() {
  testWidgets('repeated Save labels expose which action actually ran',
      (tester) async {
    await tester.pumpWidget(const RecordingFixtureApp());
    await tester.tap(find.byKey(const Key('open_repeated_text')));
    await tester.pumpAndSettle();
    expect(find.text('Save'), findsNWidgets(2));
    await tester.tap(find.byKey(const Key('secondary_save')));
    await tester.pump();
    expect(find.text('Saved: secondary'), findsOneWidget);
    await tester.tap(find.byKey(const Key('primary_save')));
    await tester.pump();
    expect(find.text('Saved: primary'), findsOneWidget);
  });

  testWidgets(
      'covers counter, input, navigation destruction, repeated text and scroll',
      (tester) async {
    await tester.pumpWidget(const RecordingFixtureApp());
    expect(find.byKey(const Key('counter_value')), findsOneWidget);
    await tester.tap(find.byKey(const Key('counter_increment')));
    await tester.pump();
    expect(find.text('Count: 1'), findsOneWidget);

    final hold = await tester.startGesture(
        tester.getCenter(find.byKey(const Key('counter_increment'))));
    await tester.pump(const Duration(milliseconds: 600));
    await hold.up();
    await tester.pump();
    expect(find.text('Count: 11'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('ime_input')), 'draft');
    expect(find.text('draft'), findsOneWidget);

    await tester.tap(find.byKey(const Key('open_destroy_form')));
    await tester.pumpAndSettle();
    await tester.enterText(
        find.byKey(const Key('destroy_form_input')), 'saved');
    await tester.tap(find.byKey(const Key('destroy_form_submit')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('saved_value')), findsOneWidget);
    expect(find.text('Saved: saved'), findsOneWidget);

    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('open_repeated_text')));
    await tester.pumpAndSettle();
    expect(find.text('Save'), findsNWidgets(2));

    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('open_scroll_list')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('scroll_item_0')), findsOneWidget);
    for (var index = 0; index < 12; index++) {
      await tester.drag(
          find.byKey(const Key('fixture_scroll_list')), const Offset(0, -600));
      await tester.pump();
    }
    expect(find.byKey(const Key('scroll_item_99')), findsOneWidget);
  });
}
