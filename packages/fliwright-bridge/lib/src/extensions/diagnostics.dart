Map<String, dynamic> normalizedSuccess({
  required String action,
  Object? target,
  Object? details,
  Object? routeBefore,
  Object? routeAfter,
  Map<String, dynamic> extra = const {},
}) => {
  'success': true,
  'action': action,
  if (target != null) 'target': target,
  if (details != null) 'details': details,
  if (routeBefore != null) 'routeBefore': routeBefore,
  if (routeAfter != null) 'routeAfter': routeAfter,
  ...extra,
};

Map<String, dynamic> normalizedFailure({
  required String code,
  required String message,
  String? action,
  Object? target,
  Object? details,
  List<Map<String, String>> recoveryHints = const [],
  Map<String, dynamic> extra = const {},
}) => {
  'success': false,
  'code': code,
  'message': message,
  'error': message,
  if (action != null) 'action': action,
  if (target != null) 'target': target,
  if (details != null) 'details': details,
  'recoveryHints': recoveryHints,
  ...extra,
};

Map<String, dynamic> coordinateTarget(double x, double y) => {
  'kind': 'coordinate',
  'x': x,
  'y': y,
};

Map<String, dynamic> selectorTarget(
  String selector, {
  String? targetId,
  String? targetType,
  Map<String, dynamic>? rect,
}) => {
  'kind': 'selector',
  'selector': selector,
  if (targetId != null) 'ref': targetId,
  if (targetType != null) 'type': targetType,
  if (rect != null) 'rect': rect,
};

List<Map<String, String>> selectorRecoveryHints() => const [
  {
    'kind': 'observe',
    'description': 'Inspect the current widget tree and visible refs.',
  },
  {
    'kind': 'change-selector',
    'description': 'Use a more stable key, semantics label, or ref.',
  },
  {'kind': 'retry', 'description': 'Retry after the UI has settled.'},
];

List<Map<String, String>> actionabilityRecoveryHints() => const [
  {
    'kind': 'close-overlay',
    'description': 'Dismiss overlays that may intercept the action.',
  },
  {
    'kind': 'wait',
    'description': 'Wait for layout, animation, or route transition to settle.',
  },
  {
    'kind': 'retry',
    'description': 'Retry the action after the target becomes actionable.',
  },
];
