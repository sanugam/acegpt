import SwiftUI
import AppKit
import ApplicationServices
import ScreenCaptureKit
import Network
import Security

let allowedOrigin = "https://acegpt-kappa.vercel.app"
let port: UInt16 = 48623
let appIDs = ["com.apple.TextEdit", "com.apple.iWork.Pages", "com.apple.iWork.Keynote", "com.apple.iWork.Numbers", "com.apple.calculator", "com.apple.Preview", "com.google.Chrome", "com.apple.Safari", "org.mozilla.firefox"]
let dangerous = try! NSRegularExpression(pattern: "\\b(send|submit|publish|post|delete|remove|trash|buy|pay|purchase|checkout|transfer|password|credential|sign.?in|log.?in|allow|install|grant|share|turn.?in|accept|agree|confirm)\\b", options: .caseInsensitive)
func needsHandoff(_ text: String) -> Bool { dangerous.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil }
func sameSecret(_ a: String, _ b: String) -> Bool { let x = Array(a.utf8), y = Array(b.utf8); guard x.count == y.count else { return false }; var diff: UInt8 = 0; for i in x.indices { diff |= x[i] ^ y[i] }; return diff == 0 }
func secret() -> String { var bytes = [UInt8](repeating: 0, count: 32); precondition(SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess); return Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
func ax(_ element: AXUIElement, _ key: String) -> CFTypeRef? { var value: CFTypeRef?; AXUIElementCopyAttributeValue(element, key as CFString, &value); return value }
func axString(_ element: AXUIElement, _ key: String) -> String { (ax(element, key) as? String) ?? "" }
func unicodeChunks(_ text: String) -> [[UInt16]] {
  var chunks: [[UInt16]] = []; var chunk: [UInt16] = []
  for scalar in text.unicodeScalars {
    let units = Array(String(scalar).utf16)
    if chunk.count + units.count > 16 { chunks.append(chunk); chunk = [] }
    chunk.append(contentsOf: units)
  }
  if !chunk.isEmpty { chunks.append(chunk) }; return chunks
}
struct BridgeError: LocalizedError { let message: String; var errorDescription: String? { message } }
struct Action: Decodable { let kind: String; let reason: String; let elementId: Int?; let x: Double?; let y: Double?; let text: String?; let key: String?; let app: String?; let direction: String? }
struct Execute: Decodable { let observationId: String; let action: Action }
struct ElementInfo { let element: AXUIElement; let label: String; let pid: pid_t }

@MainActor final class Companion: ObservableObject {
  @Published var pairing = secret()
  @Published var active = false
  @Published var accessibility = false
  @Published var recording = false
  @Published var activity = "Stopped. No computer access is active."
  @Published var serverReady = false
  private var listener: NWListener?
  private var elements: [Int: ElementInfo] = [:]
  private var observationID = ""
  private var observationDate = Date.distantPast
  private var observedPID: pid_t = 0
  private var imageWidth = 0
  private var imageHeight = 0
  private var displayBounds = CGRect.zero
  private var expires = Date.distantPast
  private var busy = false
  private var timer: Timer?
  private var escapeMonitor: Any?
  init() {
    refreshPermissions()
    do {
      let parameters = NWParameters.tcp
      parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
      let listener = try NWListener(using: parameters)
      self.listener = listener
      listener.stateUpdateHandler = { state in Task { @MainActor in
        if case .ready = state { self.serverReady = true }
        if case .failed = state { self.activity = "Cannot start the companion. Another copy may already be open." }
      } }
      listener.newConnectionHandler = { connection in
        connection.start(queue: .global(qos: .userInitiated))
        DispatchQueue.global().asyncAfter(deadline: .now() + 20) { connection.cancel() }
        self.receive(connection, buffer: Data())
      }
      listener.start(queue: .global(qos: .userInitiated))
    } catch { activity = error.localizedDescription }
    timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in Task { @MainActor in
      self.refreshPermissions()
      if self.active && (Date() > self.expires || !self.accessibility || !self.recording) { self.stop() }
    } }
  }
  func refreshPermissions() { accessibility = AXIsProcessTrusted(); recording = CGPreflightScreenCaptureAccess() }
  func requestAccessibility() { _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary); refreshPermissions() }
  func requestRecording() { _ = CGRequestScreenCaptureAccess(); refreshPermissions() }
  func start() {
    refreshPermissions()
    guard accessibility && recording && serverReady else { activity = "Allow both macOS permissions first."; return }
    if escapeMonitor == nil { escapeMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { event in
      if event.keyCode == 53 && event.modifierFlags.contains([.command, .shift]) { Task { @MainActor in self.stop() } }
    } }
    pairing = secret(); active = true; expires = Date().addingTimeInterval(600)
    activity = "Session ready for 10 minutes. Pair only with your ACEGPT tab."
  }
  func stop() { if let monitor = escapeMonitor { NSEvent.removeMonitor(monitor); escapeMonitor = nil }; active = false; pairing = secret(); elements.removeAll(); observationID = ""; activity = "Stopped. Pairing code revoked." }

  nonisolated func receive(_ connection: NWConnection, buffer: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { chunk, _, complete, error in
      var data = buffer; if let chunk { data.append(chunk) }
      if data.count > 1048576 || error != nil { connection.cancel(); return }
      guard let split = data.range(of: Data("\r\n\r\n".utf8)) else {
        if !complete && data.count < 16384 { self.receive(connection, buffer: data) } else { connection.cancel() }; return
      }
      let header = String(decoding: data[..<split.lowerBound], as: UTF8.self)
      let lines = header.components(separatedBy: "\r\n")
      var headers: [String: String] = [:]
      for line in lines.dropFirst() { if let colon = line.firstIndex(of: ":") { headers[String(line[..<colon]).lowercased()] = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces) } }
      let length = Int(headers["content-length"] ?? "0") ?? -1
      guard length >= 0 && length < 50000 && headers["transfer-encoding"] == nil else { connection.cancel(); return }
      if data.count - split.upperBound < length { if !complete { self.receive(connection, buffer: data) } else { connection.cancel() }; return }
      let request = (lines.first ?? "").split(separator: " ")
      guard request.count == 3 else { connection.cancel(); return }
      let body = Data(data[split.upperBound..<(split.upperBound + length)])
      Task { @MainActor in await self.handle(connection, method: String(request[0]), path: String(request[1]), headers: headers, body: body) }
    }
  }
  func reply(_ connection: NWConnection, _ status: Int, _ value: [String: Any], cors: Bool = false) {
    let body = (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{}".utf8)
    let origin = cors ? "Access-Control-Allow-Origin: \(allowedOrigin)\r\nAccess-Control-Allow-Headers: Authorization, Content-Type\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Private-Network: true\r\nAccess-Control-Max-Age: 600\r\nVary: Origin\r\n" : ""
    let header = "HTTP/1.1 \(status) Response\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nConnection: close\r\n\(origin)Content-Length: \(body.count)\r\n\r\n"
    connection.send(content: Data(header.utf8) + body, completion: .contentProcessed { _ in connection.cancel() })
  }
  func handle(_ connection: NWConnection, method: String, path: String, headers: [String: String], body: Data) async {
    guard headers["host"] == "127.0.0.1:\(port)", headers["origin"] == allowedOrigin else { reply(connection, 403, ["error": "This origin is not allowed."]); return }
    if method == "OPTIONS" { reply(connection, 200, [:], cors: true); return }
    guard method == "POST", sameSecret(headers["authorization"] ?? "", "Bearer \(pairing)") else { reply(connection, 401, ["error": "The pairing code is incorrect or expired. Start a new session in the companion."], cors: true); return }
    if path == "/stop" { stop(); reply(connection, 200, ["ok": true], cors: true); return }
    guard active && Date() < expires else { reply(connection, 403, ["error": "Start a session in ACEGPT Companion first."], cors: true); return }
    if path == "/status" { reply(connection, 200, ["ok": true, "version": "1.0", "accessibility": accessibility, "recording": recording], cors: true); return }
    guard !busy else { reply(connection, 409, ["error": "Wait for the current action to finish."], cors: true); return }
    busy = true; defer { busy = false }
    do {
      if path == "/observe" { reply(connection, 200, try await observe(), cors: true) }
      else if path == "/execute" { let command = try JSONDecoder().decode(Execute.self, from: body); try await execute(command); reply(connection, 200, ["ok": true, "message": activity], cors: true) }
      else { reply(connection, 404, ["error": "Unknown operation."], cors: true) }
    } catch { reply(connection, 400, ["error": error.localizedDescription], cors: true) }
  }
  func observe() async throws -> [String: Any] {
    let sessionSecret = pairing
    refreshPermissions()
    guard active && accessibility && recording else { throw BridgeError(message: "The session stopped or a macOS permission is missing.") }
    guard let app = NSWorkspace.shared.frontmostApplication else { throw BridgeError(message: "No active app is visible.") }
    let bundle = app.bundleIdentifier ?? ""
    if !appIDs.contains(bundle) {
      // Starting from this companion (or another unsupported app) may only open
      // a supported app. Never capture that app's screen, text, or controls.
      elements.removeAll(); imageWidth = 0; imageHeight = 0
      observationID = UUID().uuidString; observationDate = Date(); observedPID = app.processIdentifier
      return ["id": observationID, "width": 1, "height": 1, "app": "No supported app active", "text": "The active app has not been observed. First use open_app to activate a supported app needed for the task. No screen image, text or controls from the current app are available. The 1x1 dimensions are placeholders. Only open_app is allowed for this observation.", "elements": [] as [[String: Any]]]
    }
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) else { throw BridgeError(message: "The main display is unavailable.") }
    let excluded = content.applications.filter { $0.bundleIdentifier == Bundle.main.bundleIdentifier }
    let filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])
    let config = SCStreamConfiguration()
    let bounds = CGDisplayBounds(display.displayID)
    config.width = min(1440, Int(bounds.width)); config.height = Int(Double(config.width) * bounds.height / bounds.width)
    config.showsCursor = true
    let cgImage = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
    guard let image = NSBitmapImageRep(cgImage: cgImage).representation(using: .jpeg, properties: [.compressionFactor: 0.65]) else { throw BridgeError(message: "Screen capture failed.") }
    elements.removeAll(); var lines: [String] = []; var visited = 0
    let root = AXUIElementCreateApplication(app.processIdentifier)
    func walk(_ node: AXUIElement, _ depth: Int) {
      visited += 1; if visited > 650 || depth > 14 || lines.joined().count > 10000 || elements.count >= 150 { return }
      let role = axString(node, kAXRoleAttribute)
      let subrole = axString(node, kAXSubroleAttribute)
      if role == "AXSecureTextField" || subrole == "AXSecureTextField" { return }
      let label = [axString(node, kAXTitleAttribute), axString(node, kAXDescriptionAttribute), axString(node, kAXValueAttribute)].filter { !$0.isEmpty }.joined(separator: " ")
      if !label.isEmpty || ["AXTextArea", "AXTextField", "AXComboBox"].contains(role) {
        let id = elements.count
        let trimmed = String(label.prefix(350))
        elements[id] = ElementInfo(element: node, label: "\(role) \(trimmed)", pid: app.processIdentifier)
        lines.append("\(id): \(role) \(trimmed)")
      }
      for child in (ax(node, kAXChildrenAttribute) as? [AXUIElement]) ?? [] { walk(child, depth + 1) }
    }
    if let window = ax(root, kAXFocusedWindowAttribute) { walk(window as! AXUIElement, 0) } else { walk(root, 0) }
    guard active && sameSecret(pairing, sessionSecret) else { throw BridgeError(message: "The session was stopped during observation.") }
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else { throw BridgeError(message: "The active app changed during observation. Observe again.") }
    imageWidth = config.width; imageHeight = config.height; displayBounds = bounds
    observationID = UUID().uuidString; observationDate = Date(); observedPID = app.processIdentifier
    return ["id": observationID, "width": config.width, "height": config.height, "app": "\(app.localizedName ?? bundle) (\(bundle))", "text": lines.joined(separator: "\n"), "elements": elements.sorted { $0.key < $1.key }.map { ["id": $0.key, "label": $0.value.label] as [String: Any] }, "image": "data:image/jpeg;base64,\(image.base64EncodedString())"]
  }
  func execute(_ command: Execute) async throws {
    guard active && Date() < expires && command.observationId == observationID && Date().timeIntervalSince(observationDate) < 45 else { throw BridgeError(message: "The screen changed or the observation expired. Observe again.") }
    observationID = "" // Consume the observation: retries cannot replay a click.
    let action = command.action
    guard !needsHandoff(action.reason) else { throw BridgeError(message: "This step needs you to take over. Ace has paused.") }
    guard let app = NSWorkspace.shared.frontmostApplication, app.processIdentifier == observedPID else { throw BridgeError(message: "The active app changed. Observe again before acting.") }
    if action.kind == "open_app" {
      guard let id = action.app, appIDs.contains(id), let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) else { throw BridgeError(message: "That app is not supported or installed.") }
      let sessionSecret = pairing
      let config = NSWorkspace.OpenConfiguration(); config.activates = true
      let target = try await NSWorkspace.shared.openApplication(at: url, configuration: config)
      guard active && Date() < expires && sameSecret(pairing, sessionSecret) else { throw BridgeError(message: "The session stopped while opening the app.") }
      let currentPID = NSWorkspace.shared.frontmostApplication?.processIdentifier
      guard currentPID == observedPID || currentPID == target.processIdentifier else { throw BridgeError(message: "The active app changed while opening the app. Take over and start again when ready.") }
      // Launch completion does not mean macOS has activated an already-running app.
      // Use the granted Accessibility permission to raise it, then verify focus.
      target.unhide()
      _ = target.activate(options: [])
      let targetRoot = AXUIElementCreateApplication(target.processIdentifier)
      _ = AXUIElementSetAttributeValue(targetRoot, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
      if let window = ax(targetRoot, kAXFocusedWindowAttribute) { _ = AXUIElementPerformAction(window as! AXUIElement, kAXRaiseAction as CFString) }
      for _ in 0..<20 {
        guard active && Date() < expires && sameSecret(pairing, sessionSecret) else { throw BridgeError(message: "The session stopped while opening the app.") }
        if NSWorkspace.shared.frontmostApplication?.processIdentifier == target.processIdentifier {
          activity = "Opened and activated \(id)."; return
        }
        try await Task.sleep(nanoseconds: 100_000_000)
      }
      throw BridgeError(message: "\(target.localizedName ?? id) opened, but macOS did not bring it to the front. Take over: click its window, then start the task again.")
    }
    guard appIDs.contains(app.bundleIdentifier ?? "") else { throw BridgeError(message: "Only opening a supported app is allowed from this screen. Nothing was executed.") }
    let root = AXUIElementCreateApplication(app.processIdentifier)
    if let focused = ax(root, kAXFocusedUIElementAttribute) {
      let element = focused as! AXUIElement
      guard axString(element, kAXRoleAttribute) != "AXSecureTextField", axString(element, kAXSubroleAttribute) != "AXSecureTextField" else { throw BridgeError(message: "Enter credentials yourself. Ace cannot type into password fields.") }
    }
    switch action.kind {
    case "click":
      if let id = action.elementId, let item = elements[id], item.pid == observedPID {
        guard !needsHandoff(item.label) else { throw BridgeError(message: "This control needs you to take over. Ace has paused.") }
        var result = AXUIElementPerformAction(item.element, kAXPressAction as CFString)
        if result != .success && ["AXTextArea", "AXTextField", "AXComboBox"].contains(axString(item.element, kAXRoleAttribute)) { result = AXUIElementSetAttributeValue(item.element, kAXFocusedAttribute as CFString, kCFBooleanTrue) }
        guard result == .success else { throw BridgeError(message: "This control cannot be pressed directly. Choose another action.") }
      } else if let x = action.x, let y = action.y, x.isFinite, y.isFinite, x >= 0, y >= 0, x < Double(imageWidth), y < Double(imageHeight), imageWidth > 0, imageHeight > 0 {
        let point = CGPoint(x: displayBounds.minX + x * displayBounds.width / Double(imageWidth), y: displayBounds.minY + y * displayBounds.height / Double(imageHeight))
        var target: AXUIElement?
        let system = AXUIElementCreateSystemWide()
        guard AXUIElementCopyElementAtPosition(system, Float(point.x), Float(point.y), &target) == .success, let target else { throw BridgeError(message: "The click target cannot be verified. Take over for this step.") }
        var targetPID: pid_t = 0; AXUIElementGetPid(target, &targetPID)
        guard targetPID == observedPID else { throw BridgeError(message: "The click target belongs to another app. Observe again.") }
        let label = axString(target, kAXTitleAttribute) + " " + axString(target, kAXDescriptionAttribute)
        guard !needsHandoff(label), axString(target, kAXSubroleAttribute) != "AXSecureTextField" else { throw BridgeError(message: "This click needs you to take over. Ace has paused.") }
        for kind in [CGEventType.leftMouseDown, .leftMouseUp] {
          CGEvent(mouseEventSource: nil, mouseType: kind, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
        }
      } else { throw BridgeError(message: "A click needs a valid observed control or screen coordinate.") }
    case "type":
      guard let text = action.text, !text.isEmpty, text.count <= 2000 else { throw BridgeError(message: "Invalid text action.") }
      guard let focused = ax(root, kAXFocusedUIElementAttribute) else { throw BridgeError(message: "Focus an editable text field first.") }
      let role = axString(focused as! AXUIElement, kAXRoleAttribute)
      guard ["AXTextField", "AXTextArea", "AXComboBox"].contains(role) else { throw BridgeError(message: "The focused control is not an editable text field.") }
      let focusedElement = focused as! AXUIElement
      let fieldLabel = (axString(focusedElement, kAXTitleAttribute) + " " + axString(focusedElement, kAXDescriptionAttribute)).lowercased()
      if fieldLabel.contains("address") && ["javascript:", "data:", "file:", "chrome:", "about:"].contains(where: { text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().hasPrefix($0) }) { throw BridgeError(message: "Only ordinary web navigation is supported.") }
      for chars in unicodeChunks(text) {
        guard active && Date() < expires && NSWorkspace.shared.frontmostApplication?.processIdentifier == observedPID else { throw BridgeError(message: "Typing stopped. Review the partially entered text before retrying.") }
        let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true)!
        let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)!
        chars.withUnsafeBufferPointer { pointer in down.keyboardSetUnicodeString(stringLength: chars.count, unicodeString: pointer.baseAddress!); up.keyboardSetUnicodeString(stringLength: chars.count, unicodeString: pointer.baseAddress!) }
        down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
        try await Task.sleep(nanoseconds: 20_000_000)
      }
    case "key":
      let keys: [String: CGKeyCode] = ["Return": 36, "Tab": 48, "Escape": 53, "Backspace": 51, "Left": 123, "Right": 124, "Down": 125, "Up": 126, "Cmd+A": 0, "Cmd+L": 37, "Cmd+N": 45, "Cmd+S": 1, "Cmd+F": 3, "Cmd+Z": 6]
      guard let name = action.key, let key = keys[name] else { throw BridgeError(message: "Unsupported shortcut.") }
      let focusLabel = ax(root, kAXFocusedUIElementAttribute).map { node -> String in let control = node as! AXUIElement; return axString(control, kAXTitleAttribute) + " " + axString(control, kAXDescriptionAttribute) } ?? ""
      let navigation = focusLabel.lowercased().contains("address") || focusLabel.lowercased().contains("search")
      if name == "Return" && !navigation && !["com.apple.TextEdit", "com.apple.iWork.Pages", "com.apple.iWork.Keynote", "com.apple.iWork.Numbers", "com.apple.calculator"].contains(app.bundleIdentifier ?? "") { throw BridgeError(message: "Press Return yourself in this app. It might submit a form.") }
      for down in [true, false] { let event = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: down)!; if name.hasPrefix("Cmd+") { event.flags = .maskCommand }; event.post(tap: .cghidEventTap) }
    case "scroll":
      guard ["up", "down"].contains(action.direction ?? "") else { throw BridgeError(message: "Invalid scroll direction.") }
      CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: action.direction == "up" ? 500 : -500, wheel2: 0, wheel3: 0)?.post(tap: .cghidEventTap)
    default: throw BridgeError(message: "Unknown action. Nothing was executed.")
    }
    activity = action.reason
  }
}

@main struct CompanionApp: App {
  @StateObject private var companion = Companion()
  init() {
    if CommandLine.arguments.contains("--self-test") {
      precondition(sameSecret("abc", "abc") && !sameSecret("abc", "abd"))
      precondition(needsHandoff("Publish the document") && needsHandoff("Enter password") && !needsHandoff("Focus the document"))
      precondition(unicodeChunks(String(repeating: "test🙂", count: 30)).allSatisfy { $0.count <= 16 })
      precondition(unicodeChunks("Hello 🙂 world").flatMap { $0 } == Array("Hello 🙂 world".utf16))
      precondition(secret().count == 43 && !appIDs.contains("com.apple.Terminal"))
      print("Companion validation tests passed. No permissions requested and no computer actions performed."); exit(0)
    }
  }
  var body: some Scene {
    WindowGroup("ACEGPT Companion") {
      VStack(alignment: .leading, spacing: 16) {
        Text("ACEGPT Companion").font(.largeTitle.bold())
        Text("Let Ace work in supported Mac apps while you supervise. Runs only on this Mac and stops after 10 minutes.")
        HStack { Label(companion.accessibility ? "Accessibility allowed" : "Accessibility needed", systemImage: companion.accessibility ? "checkmark.circle.fill" : "circle"); Spacer(); Button("Allow Accessibility") { companion.requestAccessibility() } }
        HStack { Label(companion.recording ? "Screen Recording allowed" : "Screen Recording needed", systemImage: companion.recording ? "checkmark.circle.fill" : "circle"); Spacer(); Button("Allow Screen Recording") { companion.requestRecording() } }
        Divider()
        Text("Starting a session lets the paired ACEGPT tab read the visible screen and control supported apps. Screens and visible text go to ACEGPT's AI provider, Groq. Close private windows first. Passwords, payments, sending/publishing and security changes require you to take over.").font(.callout)
        Button(companion.active ? "Stop and revoke access" : "Start a 10-minute session") { if companion.active { companion.stop() } else { companion.start() } }.buttonStyle(.borderedProminent).tint(companion.active ? .red : .blue)
        if companion.active {
          Text("Pairing code — paste only into acegpt-kappa.vercel.app").font(.headline)
          Text(companion.pairing).font(.system(.body, design: .monospaced)).textSelection(.enabled)
          Button("Copy pairing code") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(companion.pairing, forType: .string) }
        }
        Text(companion.activity).foregroundStyle(.secondary)
        Text("Emergency stop: ⌘⇧Esc • Quit this app to disconnect. No startup service is installed.").font(.caption)
      }.padding(24).frame(width: 590)
    }.defaultSize(width: 640, height: 470)
    MenuBarExtra("Ace", systemImage: companion.active ? "desktopcomputer.trianglebadge.exclamationmark" : "desktopcomputer") {
      Button("Stop and revoke access") { companion.stop() }
      Button("Quit ACEGPT Companion") { companion.stop(); NSApplication.shared.terminate(nil) }
    }
  }
}
