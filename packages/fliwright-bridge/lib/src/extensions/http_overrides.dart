import 'dart:developer' as developer;
import 'dart:io';

import 'mock_server.dart';

/// HTTP interceptor that redirects all plain-HTTP traffic through the mock
/// server via Dart's [HttpOverrides.findProxyFromEnvironment] mechanism.
///
/// **Limitation:** Only `http://` requests are intercepted. HTTPS traffic
/// (`https://`) cannot be proxied through a plain [HttpServer] because Dart's
/// HttpClient uses CONNECT tunneling for HTTPS, which requires TLS termination.
/// To mock HTTPS endpoints, consider:
/// - Using `http://` URLs in test environments
/// - Injecting a custom DNS resolver or service-level mock
/// - Using a man-in-the-middle proxy with a custom CA certificate
class FliwrightHttpOverrides extends HttpOverrides {
  final int mockPort;
  final HttpOverrides? _previous;

  FliwrightHttpOverrides._(this.mockPort, this._previous);

  static void _log(String message) {
    developer.log(message, name: 'fliwright.mock');
  }

  static void install({required int port}) {
    final current = HttpOverrides.current;
    if (current is FliwrightHttpOverrides && current.mockPort == port) {
      _log('HttpOverrides already installed for mock port $port');
      return;
    }
    HttpOverrides.global = FliwrightHttpOverrides._(
      port,
      current is FliwrightHttpOverrides ? current._previous : current,
    );
    _log('HttpOverrides installed; http:// traffic proxies to 127.0.0.1:$port');
  }

  static void uninstall() {
    final current = HttpOverrides.current;
    if (current is FliwrightHttpOverrides) {
      HttpOverrides.global = current._previous;
      _log('HttpOverrides uninstalled');
    }
  }

  @override
  HttpClient createHttpClient(SecurityContext? context) {
    return _previous?.createHttpClient(context) ??
        super.createHttpClient(context);
  }

  @override
  String findProxyFromEnvironment(
    Uri url,
    Map<String, String>? environment,
  ) {
    if (_isMockServerUrl(url)) {
      return 'DIRECT';
    }

    if (url.scheme == 'http') {
      if (!MockServerExtension.shouldProxy(url)) {
        return _previous?.findProxyFromEnvironment(url, environment) ??
            super.findProxyFromEnvironment(url, environment);
      }
      _log('Proxying ${url.toString()} to 127.0.0.1:$mockPort');
      return 'PROXY 127.0.0.1:$mockPort';
    }

    if (url.scheme == 'https') {
      _log(
          'Cannot proxy HTTPS request ${url.toString()}; use FliwrightDioMockInterceptor for Dio HTTPS APIs');
    }

    return _previous?.findProxyFromEnvironment(url, environment) ??
        super.findProxyFromEnvironment(url, environment);
  }

  bool _isMockServerUrl(Uri url) {
    final host = url.host.toLowerCase();
    return url.port == mockPort &&
        (host == '127.0.0.1' || host == 'localhost' || host == '::1');
  }
}
