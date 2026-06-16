import 'package:flutter/widgets.dart';
import 'package:flutter/material.dart';

import '../bridge.dart';

/// VM Service extension for programmatic route navigation.
///
/// Supports any router that exposes `push(String)` / `go(String)` / `pop()` methods
/// (e.g. go_router) injected via [FliwrightBridge.init(router: ...)].
///
/// Fallback to [NavigatorState] when no router is injected.
class RouterNavigateExtension {
  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.navigate', _navigate);
    registry.register('ext.fliwright.resetRouteStack', _resetRouteStack);
    registry.register('ext.fliwright.currentRoute', _currentRoute);
    registry.register('ext.fliwright.goBack', _goBack);
  }

  /// Navigate to [path] using the injected router or fallback Navigator.
  ///
  /// Params:
  ///   - path (required): Route path, e.g. '/register'
  ///   - extra (optional): JSON-encoded extra data passed to the router
  static Future<Map<String, dynamic>> _navigate(
    Map<String, String> params,
  ) async {
    final path = params['path'];
    if (path == null || path.isEmpty) {
      return {'success': false, 'error': 'path is required'};
    }

    // 1. Try injected router (e.g. GoRouter). Normal navigation should keep a
    // route below the destination so app back buttons can pop safely.
    final router = FliwrightBridge.router;
    if (router != null) {
      try {
        final extraRaw = params['extra'];
        if (extraRaw != null && extraRaw.isNotEmpty) {
          (router as dynamic).push(path, extra: extraRaw);
        } else {
          (router as dynamic).push(path);
        }
        return {
          'success': true,
          'method': 'injected_router_push',
          'path': path,
        };
      } on NoSuchMethodError {
        try {
          final extraRaw = params['extra'];
          if (extraRaw != null && extraRaw.isNotEmpty) {
            (router as dynamic).go(path, extra: extraRaw);
          } else {
            (router as dynamic).go(path);
          }
          return {
            'success': true,
            'method': 'injected_router_go',
            'path': path,
          };
        } catch (e) {
          return {
            'success': false,
            'error': 'injected router fallback failed: $e',
            'path': path,
          };
        }
      } catch (e) {
        return {
          'success': false,
          'error': 'injected router failed: $e',
          'path': path,
        };
      }
    }

    // 2. Fallback: find NavigatorState in the widget tree
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) {
      return {'success': false, 'error': 'no root element', 'path': path};
    }

    final navigator = _findNavigatorState(root);
    if (navigator == null) {
      return {
        'success': false,
        'error': 'no navigator found',
        'path': path,
      };
    }

    try {
      navigator.pushNamed(path);
      return {
        'success': true,
        'method': 'navigator_pushNamed',
        'path': path,
      };
    } catch (e) {
      return {
        'success': false,
        'error': 'navigator pushNamed failed: $e',
        'path': path,
      };
    }
  }

  /// Reset the route stack to [path].
  ///
  /// For injected routers this uses `go(path)`, which replaces the current
  /// location in declarative router stacks. For Navigator fallback this uses
  /// pushNamedAndRemoveUntil so back cannot return to the previous route.
  static Future<Map<String, dynamic>> _resetRouteStack(
    Map<String, String> params,
  ) async {
    final path = params['path'];
    if (path == null || path.isEmpty) {
      return {'success': false, 'error': 'path is required'};
    }

    final router = FliwrightBridge.router;
    if (router != null) {
      try {
        final extraRaw = params['extra'];
        if (extraRaw != null && extraRaw.isNotEmpty) {
          (router as dynamic).go(path, extra: extraRaw);
        } else {
          (router as dynamic).go(path);
        }
        return {
          'success': true,
          'method': 'injected_router_go',
          'path': path,
        };
      } catch (e) {
        return {
          'success': false,
          'error': 'injected router reset failed: $e',
          'path': path,
        };
      }
    }

    final root = WidgetsBinding.instance.rootElement;
    if (root == null) {
      return {'success': false, 'error': 'no root element', 'path': path};
    }

    final navigator = _findNavigatorState(root);
    if (navigator == null) {
      return {
        'success': false,
        'error': 'no navigator found',
        'path': path,
      };
    }

    try {
      navigator.pushNamedAndRemoveUntil(path, (route) => false);
      return {
        'success': true,
        'method': 'navigator_pushNamedAndRemoveUntil',
        'path': path,
      };
    } catch (e) {
      return {
        'success': false,
        'error': 'navigator reset failed: $e',
        'path': path,
      };
    }
  }

  /// Return the current route information.
  static Future<Map<String, dynamic>> _currentRoute(
    Map<String, String> params,
  ) async {
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) {
      return {'path': null, 'name': null};
    }

    // Try injected router first — GoRouter exposes routerState.currentUri
    final router = FliwrightBridge.router;
    if (router != null) {
      try {
        // GoRouter.routerState.uri gives the current location
        final state = (router as dynamic).routerState;
        if (state != null) {
          final uri = state.uri as Uri?;
          return {
            'path': uri?.path,
            'name': state.name?.toString(),
            'fullUri': uri?.toString(),
          };
        }
      } catch (_) {
        // Fall through to ModalRoute approach
      }
    }

    // Fallback: use ModalRoute to determine current route
    try {
      final modalRoute = ModalRoute.of(root);
      if (modalRoute != null) {
        final settings = modalRoute.settings;
        return {
          'path': settings.name,
          'name': settings.name,
        };
      }
    } catch (_) {
      // ModalRoute.of may throw if called outside of a route
    }

    return {'path': null, 'name': null};
  }

  /// Go back / pop the current route.
  static Future<Map<String, dynamic>> _goBack(
    Map<String, String> params,
  ) async {
    // 1. Try injected router
    final router = FliwrightBridge.router;
    if (router != null) {
      try {
        (router as dynamic).pop();
        return {'success': true, 'method': 'injected_router'};
      } catch (e) {
        // Fall through to Navigator.pop
      }
    }

    // 2. Fallback: Navigator.pop via root context
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) {
      return {'success': false, 'error': 'no root element'};
    }

    final navigator = _findNavigatorState(root);
    if (navigator == null) {
      return {'success': false, 'error': 'no navigator found'};
    }

    try {
      navigator.pop();
      return {'success': true, 'method': 'navigator_pop'};
    } catch (e) {
      return {'success': false, 'error': 'navigator pop failed: $e'};
    }
  }

  /// Walk the widget tree to find the innermost [NavigatorState].
  ///
  /// In apps using `MaterialApp.router`, the Navigator is created
  /// internally by the Router widget. We search for [Navigator] elements
  /// and return the last (most deeply nested) one found.
  static NavigatorState? _findNavigatorState(Element root) {
    NavigatorState? lastFound;

    void visitor(Element element) {
      if (element.widget is Navigator) {
        final statefulElement = element;
        if (statefulElement is StatefulElement) {
          final state = statefulElement.state;
          if (state is NavigatorState) {
            lastFound = state;
          }
        }
      }
      element.visitChildren(visitor);
    }

    root.visitChildren(visitor);
    return lastFound;
  }
}
