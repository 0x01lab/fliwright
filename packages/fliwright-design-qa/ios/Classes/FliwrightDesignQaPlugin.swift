import CoreMotion
import Flutter
import UIKit

public final class FliwrightDesignQaPlugin: NSObject, FlutterPlugin, FlutterStreamHandler {
  private static let accelerometerChannel = "fliwright_design_qa/accelerometer"
  private static let transportChannel = "fliwright_design_qa/transport"
  private static let transportControlChannel = "fliwright_design_qa/transport_control"
  private static let standardGravity = 9.80665

  private let motionManager = CMMotionManager()
  private var accelerometerSink: FlutterEventSink?

  public static func register(with registrar: FlutterPluginRegistrar) {
    let instance = FliwrightDesignQaPlugin()
    let accelerometer = FlutterEventChannel(
      name: accelerometerChannel,
      binaryMessenger: registrar.messenger()
    )
    accelerometer.setStreamHandler(instance)

    let transport = FlutterMethodChannel(
      name: transportChannel,
      binaryMessenger: registrar.messenger()
    )
    registrar.addMethodCallDelegate(instance, channel: transport)

    let transportControl = FlutterEventChannel(
      name: transportControlChannel,
      binaryMessenger: registrar.messenger()
    )
    transportControl.setStreamHandler(TransportControlStreamHandler())
  }

  public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    result(FlutterError(
      code: "TRANSPORT_UNAVAILABLE",
      message: "The Fliwright Design QA WebRTC transport is not installed for iOS.",
      details: "Implement the Fliwright-owned WebRTC transport before pairing a device."
    ))
  }

  public func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? {
    guard motionManager.isAccelerometerAvailable else {
      return FlutterError(
        code: "ACCELEROMETER_UNAVAILABLE",
        message: "This device does not provide accelerometer data.",
        details: nil
      )
    }

    accelerometerSink = events
    motionManager.accelerometerUpdateInterval = 1.0 / 60.0
    motionManager.startAccelerometerUpdates(to: .main) { [weak self] data, error in
      guard let self else { return }
      if let error {
        self.accelerometerSink?(FlutterError(
          code: "ACCELEROMETER_ERROR",
          message: error.localizedDescription,
          details: nil
        ))
        return
      }
      guard let acceleration = data?.acceleration else { return }
      // CoreMotion reports acceleration in g; the Dart detector and Android
      // SensorManager both use m/s², so normalize iOS at the platform edge.
      self.accelerometerSink?([
        "x": acceleration.x * FliwrightDesignQaPlugin.standardGravity,
        "y": acceleration.y * FliwrightDesignQaPlugin.standardGravity,
        "z": acceleration.z * FliwrightDesignQaPlugin.standardGravity,
        "timestampMs": Int(Date().timeIntervalSince1970 * 1000),
      ])
    }
    return nil
  }

  public func onCancel(withArguments arguments: Any?) -> FlutterError? {
    motionManager.stopAccelerometerUpdates()
    accelerometerSink = nil
    return nil
  }
}

private final class TransportControlStreamHandler: NSObject, FlutterStreamHandler {
  func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? {
    return nil
  }

  func onCancel(withArguments arguments: Any?) -> FlutterError? {
    return nil
  }
}
