import 'extension_registry.dart';

/// An optional, application-configured bridge capability.
///
/// Modules own their VM-service methods and lifecycle while [FliwrightBridge]
/// owns registration order, reset, and handshake discovery.
abstract interface class FliwrightBridgeModule {
  String get id;

  bool get isAvailable;

  Map<String, Object?> describe();

  void register(ExtensionRegistry registry);

  Future<void> reset();
}
