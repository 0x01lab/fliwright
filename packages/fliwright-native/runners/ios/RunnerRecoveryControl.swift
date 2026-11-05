import CryptoKit
import Foundation
import Network

/// A generation-bound control channel. Shutdown ends its own Runner; it never signals a PID.
final class RunnerRecoveryControl {
  struct Identity {
    let sessionId: String
    let generation: String
    let deviceId: String
    let simulatorBootedAt: String
    let runnerPid: Int
  }

  private struct Request: Decodable {
    let version: Int
    let direction: String
    let operation: String
    let nonce: String
    let sessionId: String
    let generation: String
    let deviceId: String
    let simulatorBootedAt: String
    let runnerPid: Int
    let signature: String
  }

  enum Failure: Error { case invalidIdentity, unavailable }

  private let identity: Identity
  private let key: SymmetricKey
  private let queue = DispatchQueue(label: "dev.fliwright.runner-recovery")
  private let onShutdown: () -> Void
  private var listener: NWListener?
  private var connections: [ObjectIdentifier: NWConnection] = [:]
  private var nonces: Set<String> = []
  private var closing = false
  private var shutdownRequested = false
  private var started = false

  init(identity: Identity, key: String, onShutdown: @escaping () -> Void) throws {
    let fields = [identity.sessionId, identity.generation, identity.deviceId, identity.simulatorBootedAt]
    guard fields.allSatisfy({ $0.range(of: "^[A-Za-z0-9_.:-]{1,128}$", options: .regularExpression) != nil }),
          identity.runnerPid > 0, let bytes = Self.hex(key) else { throw Failure.invalidIdentity }
    self.identity = identity
    self.key = SymmetricKey(data: bytes)
    self.onShutdown = onShutdown
  }

  /// Completion and all connection work run independently of XCTest's main actor.
  func start(completion: @escaping (Result<UInt16, Error>) -> Void) {
    queue.async {
      guard !self.started, !self.closing else { completion(.failure(Failure.unavailable)); return }
      self.started = true
      do {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        let listener = try NWListener(using: parameters)
        self.listener = listener
        var completed = false
        listener.stateUpdateHandler = { [weak self] state in
          guard let self else { return }
          switch state {
          case .ready:
            guard !completed, let port = listener.port else { return }
            completed = true
            completion(.success(port.rawValue))
          case .failed:
            if !completed { completed = true; completion(.failure(Failure.unavailable)) }
            self.stopOnQueue()
          case .cancelled:
            if !completed { completed = true; completion(.failure(Failure.unavailable)) }
          default: break
          }
        }
        listener.newConnectionHandler = { [weak self] connection in
          guard let self, !self.closing, !self.shutdownRequested, self.connections.count < 2 else {
            connection.cancel()
            return
          }
          self.connections[ObjectIdentifier(connection)] = connection
          connection.start(queue: self.queue)
          self.receive(connection, accumulated: Data())
          self.queue.asyncAfter(deadline: .now() + 2) { [weak self, weak connection] in
            if let connection { self?.close(connection) }
          }
        }
        listener.start(queue: self.queue)
        self.queue.asyncAfter(deadline: .now() + 5) { [weak self] in
          guard !completed else { return }
          completed = true
          completion(.failure(Failure.unavailable))
          self?.stopOnQueue()
        }
      } catch { completion(.failure(Failure.unavailable)); self.stopOnQueue() }
    }
  }

  func stop() { queue.async { self.stopOnQueue() } }

  private func stopOnQueue() {
    closing = true
    listener?.cancel()
    for connection in Array(connections.values) { close(connection) }
  }

  private func receive(_ connection: NWConnection, accumulated: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] data, _, complete, error in
      guard let self, self.connections[ObjectIdentifier(connection)] != nil else { return }
      var bytes = accumulated
      if let data { bytes.append(data) }
      guard bytes.count <= 4096, error == nil else { self.close(connection); return }
      if let end = bytes.firstIndex(of: 10) {
        guard end == bytes.index(before: bytes.endIndex) else { self.close(connection); return }
        self.handle(Data(bytes.dropLast()), connection)
      } else if complete { self.close(connection) }
      else { self.receive(connection, accumulated: bytes) }
    }
  }

  private func handle(_ bytes: Data, _ connection: NWConnection) {
    guard !closing, !shutdownRequested, nonces.count < 64,
          let raw = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any], raw.count == 10,
          let request = try? JSONDecoder().decode(Request.self, from: bytes),
          request.version == 1, request.direction == "request",
          request.operation == "identify" || request.operation == "shutdown",
          request.sessionId == identity.sessionId, request.generation == identity.generation,
          request.deviceId == identity.deviceId, request.simulatorBootedAt == identity.simulatorBootedAt,
          request.runnerPid == identity.runnerPid, Self.hex(request.nonce) != nil,
          !nonces.contains(request.nonce), let signature = Self.hex(request.signature),
          HMAC<SHA256>.isValidAuthenticationCode(signature,
            authenticating: message(request.operation, request.nonce, direction: "request", status: ""), using: key)
    else { close(connection); return }
    nonces.insert(request.nonce)
    let shutdown = request.operation == "shutdown"
    let status = shutdown ? "stopping" : "identified"
    let responseSignature = HMAC<SHA256>.authenticationCode(
      for: message(request.operation, request.nonce, direction: "response", status: status), using: key)
      .map { String(format: "%02x", $0) }.joined()
    let response: [String: Any] = [
      "version": 1, "direction": "response", "operation": request.operation, "nonce": request.nonce,
      "sessionId": identity.sessionId, "generation": identity.generation, "deviceId": identity.deviceId,
      "simulatorBootedAt": identity.simulatorBootedAt, "runnerPid": identity.runnerPid,
      "status": status, "signature": responseSignature,
    ]
    guard var frame = try? JSONSerialization.data(withJSONObject: response) else { close(connection); return }
    frame.append(10)
    if shutdown {
      shutdownRequested = true
      listener?.cancel()
    }
    connection.send(content: frame, completion: .contentProcessed { [weak self] _ in
      guard let self else { return }
      self.close(connection)
    })
    // An authenticated request is acted on once even when its ACK cannot be delivered.
    // Notify independently of socket completion so a stalled peer cannot pin the Runner.
    if shutdown { onShutdown() }
  }

  private func message(_ operation: String, _ nonce: String, direction: String, status: String) -> Data {
    Data(["fliwright-runner-recovery", "1", direction, operation, nonce, identity.sessionId, identity.generation,
      identity.deviceId, identity.simulatorBootedAt, String(identity.runnerPid), status].joined(separator: "\n").utf8)
  }

  private func close(_ connection: NWConnection) {
    connections.removeValue(forKey: ObjectIdentifier(connection))
    connection.cancel()
  }

  private static func hex(_ value: String) -> Data? {
    guard value.utf8.count == 64, value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { return nil }
    var bytes = Data()
    var index = value.startIndex
    for _ in 0..<32 {
      let end = value.index(index, offsetBy: 2)
      guard let byte = UInt8(value[index..<end], radix: 16) else { return nil }
      bytes.append(byte)
      index = end
    }
    return bytes
  }
}
