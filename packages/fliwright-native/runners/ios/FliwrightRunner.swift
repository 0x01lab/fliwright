import Foundation
import UIKit
import XCTest

/// Owned UI-test process. It attaches to the target; it never launches or resets it.
final class FliwrightRunner: XCTestCase {
  private var elements: [String: XCUIElement] = [:]
  private var snapshotID = ""
  private var environment: [String: String] = [:]
  private var controlShutdown = false
  private var activeBrokerTask: Task<BrokerReply, Error>?

  private struct BrokerReply {
    let data: Data
    let response: URLResponse
  }

  @MainActor
  func testServe() async throws {
    continueAfterFailure = false
    executionTimeAllowance = 3600
    environment = ProcessInfo.processInfo.environment
    let actualDevice = environment["SIMULATOR_UDID"] ?? ""
    guard actualDevice == required("FLIWRIGHT_RUNNER_DEVICE") else {
      throw RunnerFailure("device_mismatch", "Runner did not start on the selected simulator.")
    }
    let control = try RunnerRecoveryControl(identity: .init(
      sessionId: required("FLIWRIGHT_RUNNER_SESSION"), generation: required("FLIWRIGHT_RUNNER_GENERATION"),
      deviceId: actualDevice, simulatorBootedAt: required("FLIWRIGHT_RUNNER_BOOT"),
      runnerPid: Int(ProcessInfo.processInfo.processIdentifier)), key: required("FLIWRIGHT_RUNNER_RECOVERY_KEY"),
      onShutdown: { [weak self] in
        Task { @MainActor in
          self?.controlShutdown = true
          self?.activeBrokerTask?.cancel()
        }
      })
    defer { control.stop(); activeBrokerTask?.cancel() }
    let recoveryPort = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<UInt16, Error>) in
      control.start { continuation.resume(with: $0) }
    }
    do {
      _ = try await call("/ready", body: [
        "protocolVersion": 2,
        "sessionId": required("FLIWRIGHT_RUNNER_SESSION"),
        "generation": required("FLIWRIGHT_RUNNER_GENERATION"),
        "deviceId": actualDevice,
        "appId": required("FLIWRIGHT_RUNNER_APP"),
        "runnerPid": ProcessInfo.processInfo.processIdentifier,
        "recoveryPort": recoveryPort,
      ])

      // Session lifetime is bounded independently of the Node owner.
      let expires = Date().addingTimeInterval(3600)
      while Date() < expires && !controlShutdown {
        let command = try await call("/next")
        if controlShutdown { return }
        if command.isEmpty { continue }
        guard let requestID = command["requestId"] as? String,
              command["protocolVersion"] as? Int == 2,
              command["sessionId"] as? String == required("FLIWRIGHT_RUNNER_SESSION"),
              command["generation"] as? String == required("FLIWRIGHT_RUNNER_GENERATION"),
              let operation = command["operation"] as? String,
              let budget = command["budgetMs"] as? Double, budget > 0 else {
          throw RunnerFailure("protocol_mismatch", "Invalid command envelope.")
        }
        let payload = command["payload"] as? [String: Any] ?? [:]
        var response: [String: Any] = ["requestId": requestID]
        do {
          response["result"] = try perform(operation, payload: payload)
        } catch let error as RunnerFailure {
          response["error"] = ["code": error.code, "message": error.message]
        } catch {
          // Do not serialize arbitrary errors or input values into logs/results.
          response["error"] = ["code": "protocol_mismatch", "message": "XCTest operation failed."]
        }
        _ = try await call("/result", body: response)
      }
    } catch {
      // Control shutdown cancels the current URLSession task, including a long
      // poll. Loss of the owner broker also ends this generation without replay.
      if controlShutdown { return }
      throw error
    }
  }

  @MainActor
  private func perform(_ operation: String, payload: [String: Any]) throws -> Any {
    switch operation {
    case "snapshot": return try snapshot(payload)
    case "screenshot":
      return ["png": XCUIScreen.main.screenshot().pngRepresentation.base64EncodedString()]
    case "click", "fill":
      guard payload["snapshotId"] as? String == snapshotID,
            let node = payload["node"] as? [String: Any], let nodeID = node["id"] as? String,
            let element = elements[nodeID], element.exists else {
        throw RunnerFailure("target_not_found", "Native target is no longer present in the active snapshot.")
      }
      guard element.isEnabled && element.isHittable else {
        throw RunnerFailure("not_interactable", "Native target is not enabled and hittable.")
      }
      if operation == "click" { element.tap(); return ["acknowledged": true] }
      guard element.elementType == .textField || element.elementType == .textView,
            let text = payload["text"] as? String, text.count <= 4096,
            let oldValue = element.value as? String else {
        throw RunnerFailure("unsupported_capability", "Native fill requires a readable non-password text field.")
      }
      element.tap()
      // An unresolved insertion point could produce an incorrect replacement.
      // Select-all avoids assuming where the cursor was left by a prior action.
      element.press(forDuration: 1.1)
      let selectAll = XCUIApplication(bundleIdentifier: required("FLIWRIGHT_RUNNER_APP"))
        .menuItems.matching(identifier: "Select All").firstMatch
      if selectAll.exists {
        selectAll.tap()
        element.typeText(text.isEmpty ? XCUIKeyboardKey.delete.rawValue : text)
      } else if oldValue.isEmpty || oldValue == element.placeholderValue {
        if !text.isEmpty { element.typeText(text) }
      } else {
        throw RunnerFailure("unsupported_capability", "Cannot reliably select and replace this native text field on the current OS/language.")
      }
      guard element.value as? String == text || (text.isEmpty && element.value as? String == element.placeholderValue) else {
        throw RunnerFailure("action_outcome_unknown", "Native replacement text could not be verified.")
      }
      return ["acknowledged": true]
    case "swipe":
      guard let from = payload["from"] as? [String: Double], let to = payload["to"] as? [String: Double],
            let x1 = from["x"], let y1 = from["y"], let x2 = to["x"], let y2 = to["y"],
            let duration = payload["durationMs"] as? Double, duration > 0, duration <= 10000 else {
        throw RunnerFailure("precondition_failed", "Invalid native swipe geometry.")
      }
      let app = XCUIApplication(bundleIdentifier: required("FLIWRIGHT_RUNNER_APP"))
      let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
      let start = origin.withOffset(CGVector(dx: x1 - app.frame.minX, dy: y1 - app.frame.minY))
      let end = origin.withOffset(CGVector(dx: x2 - app.frame.minX, dy: y2 - app.frame.minY))
      start.press(forDuration: 0.05, thenDragTo: end, withVelocity: XCUIGestureVelocity(1000 / duration * hypot(x2 - x1, y2 - y1)), thenHoldForDuration: 0)
      return ["acknowledged": true]
    default: throw RunnerFailure("unsupported_capability", "Unsupported XCTest operation.")
    }
  }

  @MainActor
  private func snapshot(_ payload: [String: Any]) throws -> [String: Any] {
    snapshotID = UUID().uuidString
    elements.removeAll()
    let allowed = try JSONSerialization.jsonObject(with: Data(required("FLIWRIGHT_RUNNER_APPS").utf8)) as? [String] ?? []
    guard allowed.contains(required("FLIWRIGHT_RUNNER_APP")) else {
      throw RunnerFailure("precondition_failed", "Runner application allowlist is missing its target application.")
    }
    var nodes: [[String: Any]] = []
    var appStates: [String: UInt] = [:]
    let query = payload["query"] as? [String: Any]
    let queryAppIDs = payload["appIds"] as? [String] ?? allowed
    // A hostless UI-test runner can report a legacy UIScreen.bounds. The device
    // screenshot uses the actual display pixels, while XCUIElement uses points.
    let scale = UIScreen.main.scale
    guard let pixels = XCUIScreen.main.screenshot().image.cgImage else {
      throw RunnerFailure("protocol_mismatch", "Unable to obtain display geometry.")
    }
    let displayBounds = CGRect(x: 0, y: 0, width: CGFloat(pixels.width) / scale, height: CGFloat(pixels.height) / scale)
    for appID in queryAppIDs {
      guard allowed.contains(appID) else {
        throw RunnerFailure("precondition_failed", "Requested application is not allowlisted.")
      }
      let app = XCUIApplication(bundleIdentifier: appID)
      appStates[appID] = app.state.rawValue
      if app.state == .notRunning { continue }
      var matched = app.descendants(matching: .any)
      if let query, let field = query["field"] as? String, let value = query["value"] as? String {
        let attribute = field == "resourceId" ? "identifier" : "label"
        let comparison = query["exact"] as? Bool == false ? "CONTAINS" : "=="
        matched = matched.matching(NSPredicate(format: "\(attribute) \(comparison) %@", value))
      }
      let descendants = matched.allElementsBoundByIndex
      guard descendants.count <= 20000 - nodes.count else {
        throw RunnerFailure("protocol_mismatch", "Native element count exceeds the snapshot limit.")
      }
      for element in descendants {
        let id = "n\(nodes.count)"
        let frame = element.frame
        let password = element.elementType == .secureTextField
        elements[id] = element
        var node: [String: Any] = [
          "id": id, "appId": appID, "resourceId": element.identifier,
          "text": element.label, "label": element.label,
          "enabled": element.isEnabled, "visible": !frame.isEmpty && frame.intersects(displayBounds),
          "hittable": element.isHittable, "password": password,
          "frame": ["x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height],
        ]
        if !password, let value = element.value as? String { node["value"] = value }
        nodes.append(node)
      }
    }
    return [
      "id": snapshotID, "nodes": nodes, "capturedAt": ISO8601DateFormatter().string(from: Date()), "appStates": appStates,
      "screen": ["width": displayBounds.width, "height": displayBounds.height, "scale": scale,
                 "orientation": displayBounds.width > displayBounds.height ? "landscape" : "portrait"],
    ]
  }

  private func required(_ key: String) -> String { environment[key] ?? "" }

  @MainActor
  private func call(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
    if controlShutdown { throw CancellationError() }
    guard let url = URL(string: required("FLIWRIGHT_RUNNER_URL") + path) else {
      throw RunnerFailure("protocol_mismatch", "Missing broker URL.")
    }
    var request = URLRequest(url: url, timeoutInterval: 10)
    request.setValue("Bearer " + required("FLIWRIGHT_RUNNER_TOKEN"), forHTTPHeaderField: "Authorization")
    if let body {
      request.httpMethod = "POST"
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try JSONSerialization.data(withJSONObject: body)
    }
    let task = Task {
      let (data, response) = try await URLSession.shared.data(for: request)
      return BrokerReply(data: data, response: response)
    }
    activeBrokerTask = task
    defer { activeBrokerTask = nil }
    let reply = try await task.value
    let data = reply.data, response = reply.response
    guard let http = response as? HTTPURLResponse, http.statusCode == 200 || http.statusCode == 204 else {
      throw RunnerFailure("transport_lost", "Broker rejected the XCTest request.")
    }
    if data.isEmpty { return [:] }
    return try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
  }
}

private struct RunnerFailure: Error {
  let code: String
  let message: String
  init(_ code: String, _ message: String) { self.code = code; self.message = message }
}
