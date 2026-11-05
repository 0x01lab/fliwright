import AVFoundation
import Flutter
import UIKit

/// Source overlay for a disposable Flutter iOS host, not a production plugin.
@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var fixtureChannel: FlutterMethodChannel?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    #if FLIWRIGHT_NATIVE_FIXTURE && targetEnvironment(simulator)
    let channel = FlutterMethodChannel(name: "dev.fliwright/native_fixture", binaryMessenger: engineBridge.applicationRegistrar.messenger())
    fixtureChannel = channel
    channel.setMethodCallHandler { [weak self] call, result in
      DispatchQueue.main.async {
        switch call.method {
        case "confirm": self?.confirm(result)
        case "textInput": self?.textInput(result)
        case "microphone":
          AVAudioSession.sharedInstance().requestRecordPermission { granted in
            DispatchQueue.main.async { result(granted ? "granted" : "denied") }
          }
        default: result(FlutterMethodNotImplemented)
        }
      }
    }
    #endif
  }

  private func confirm(_ result: @escaping FlutterResult) {
    let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
    guard let root = windows.first(where: \.isKeyWindow)?.rootViewController,
          root.presentedViewController == nil else {
      result(FlutterError(code: "not_ready", message: "The fixture presenter is unavailable.", details: nil))
      return
    }
    let alert = UIAlertController(title: "Native confirmation", message: "Choose a real UIKit action.", preferredStyle: .alert)
    alert.view.accessibilityIdentifier = "native_confirmation"
    alert.addAction(UIAlertAction(title: "Confirm native", style: .default) { _ in result("confirmed") })
    alert.addAction(UIAlertAction(title: "Cancel native", style: .cancel) { _ in result("cancelled") })
    root.present(alert, animated: true)
  }

  private func textInput(_ result: @escaping FlutterResult) {
    let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
    guard let root = windows.first(where: \.isKeyWindow)?.rootViewController,
          root.presentedViewController == nil else {
      result(FlutterError(code: "not_ready", message: "The fixture presenter is unavailable.", details: nil))
      return
    }
    let alert = UIAlertController(title: "Native text input", message: "Replace the actual UIKit field value.", preferredStyle: .alert)
    alert.addTextField { field in
      field.accessibilityIdentifier = "native_text_input"
      field.placeholder = "Native value"
      field.text = "Original native text"
      field.autocorrectionType = .no
      field.autocapitalizationType = .none
      field.spellCheckingType = .no
    }
    alert.addAction(UIAlertAction(title: "Confirm input", style: .default) { [weak alert] _ in
      guard let text = alert?.textFields?.first?.text else {
        result(FlutterError(code: "missing_input", message: "The native field is unavailable.", details: nil))
        return
      }
      result(["status": "confirmed", "text": text])
    })
    alert.addAction(UIAlertAction(title: "Cancel input", style: .cancel) { _ in result(["status": "cancelled"]) })
    root.present(alert, animated: true)
  }
}
