import Foundation
import Capacitor
import UIKit
import WebKit
import AVFoundation
import AVKit
import PDFKit
import Speech
import StoreKit
import UserNotifications
import PhotosUI
import UniformTypeIdentifiers
import AudioToolbox

/// The iPhone side of Ɔsɔreɛ Plus (same calls as the Android plugin):
/// the projector on a cable (HDMI adapter) or AirPlay screen, the church's files, the scripture listener,
/// notifications, the device ID and App Store purchases.
@objc(ScreenPlugin)
public class ScreenPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ScreenPlugin"
    public let jsName = "Screen"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openCastSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startServer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopServer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDeviceId", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestCamera", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestMicrophone", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "audioInputs", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "streamStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "streamStop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "streamStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickMedia", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveMediaPage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteMedia", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "downloadMedia", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeTemp", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listen", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startListening", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopListening", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "buzz", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestNotifications", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notify", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "iapProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "iapBuy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "iapRestore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "installUpdate", returnType: CAPPluginReturnPromise),
    ]

    private var state: String?
    private var external: ExternalScreen?
    private let mediaDir: URL = {
        let d = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("media", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()

    public override func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged), name: UIScreen.didConnectNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged), name: UIScreen.didDisconnectNotification, object: nil)
        DispatchQueue.main.async { self.screensChanged() }
    }

    // MARK: projector (second screen)

    @objc private func screensChanged() {
        DispatchQueue.main.async {
            let other = UIScreen.screens.first { $0 != UIScreen.main }
            if let s = other {
                if self.external?.screen != s { self.external?.close(); self.external = ExternalScreen(screen: s, state: self.state) }
            } else { self.external?.close(); self.external = nil }
            self.notifyListeners("status", data: self.statusObject())
        }
    }

    private func statusObject() -> [String: Any] {
        let name = external == nil ? "" : (AVAudioSession.sharedInstance().currentRoute.outputs.first { $0.portType == .airPlay || $0.portType == .HDMI }?.portName ?? "the screen")
        return ["display": external != nil, "displayName": name, "server": false, "clients": 0, "urls": [String](), "camera": false, "port": 0]
    }

    @objc func status(_ call: CAPPluginCall) { DispatchQueue.main.async { call.resolve(self.statusObject()) } }

    @objc func send(_ call: CAPPluginCall) {
        if let s = call.getString("state") { state = s; DispatchQueue.main.async { self.external?.render(s) } }
        call.resolve()
    }

    /// AirPlay picker (Apple TV, AirPlay TVs). A cable adapter needs nothing: the screen appears by itself.
    @objc func openCastSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let picker = AVRoutePickerView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
            picker.prioritizesVideoDevices = true
            self.bridge?.viewController?.view.addSubview(picker)
            if let button = picker.subviews.compactMap({ $0 as? UIButton }).first { button.sendActions(for: .touchUpInside) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { picker.removeFromSuperview() }
            call.resolve(self.statusObject())
        }
    }

    @objc func startServer(_ call: CAPPluginCall) { call.reject("Wi-Fi screens are coming to iPhone soon. Use a cable adapter or AirPlay for now.") }
    @objc func stopServer(_ call: CAPPluginCall) { call.resolve(statusObject()) }

    // MARK: device, links, permissions

    /// A random ID kept in the Keychain: the same after reinstalling, so the licence and trial stay with this iPhone.
    @objc func getDeviceId(_ call: CAPPluginCall) {
        let key = "osoree-device-id"
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: key, kSecReturnData as String: true]
        var out: CFTypeRef?
        var sys = utsname(); uname(&sys)
        let machine = withUnsafeBytes(of: &sys.machine) { String(decoding: $0.prefix { $0 != 0 }, as: UTF8.self) }
        let info: [String: Any] = ["model": machine.isEmpty ? UIDevice.current.model : machine, "os": "iOS " + UIDevice.current.systemVersion]
        if SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data, let id = String(data: d, encoding: .utf8) { call.resolve(info.merging(["id": "ios-" + id]) { a, _ in a }); return }
        let id = UUID().uuidString
        let add: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: key, kSecValueData as String: Data(id.utf8), kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        SecItemAdd(add as CFDictionary, nil)
        call.resolve(info.merging(["id": "ios-" + id]) { a, _ in a })
    }

    @objc func openUrl(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), s.hasPrefix("https://"), let u = URL(string: s) else { call.reject("Bad address."); return }
        DispatchQueue.main.async { UIApplication.shared.open(u); call.resolve() }
    }

    @objc func requestCamera(_ call: CAPPluginCall) { AVCaptureDevice.requestAccess(for: .video) { call.resolve(["granted": $0]) } }
    @objc func requestMicrophone(_ call: CAPPluginCall) { AVAudioSession.sharedInstance().requestRecordPermission { call.resolve(["granted": $0]) } }

    // Streaming from the iPhone itself comes later; the OBS guide covers laptops meanwhile.
    @objc func audioInputs(_ call: CAPPluginCall) { call.resolve(["inputs": [[String: Any]]()]) }
    @objc func streamStart(_ call: CAPPluginCall) { call.reject("Streaming from iPhone is coming soon.") }
    @objc func streamStop(_ call: CAPPluginCall) { call.resolve(["running": false, "targets": [[String: Any]]()]) }
    @objc func streamStatus(_ call: CAPPluginCall) { call.resolve(["running": false, "level": 0, "audioInput": "", "targets": [[String: Any]]()]) }

    // MARK: the church's files

    private var pickCall: CAPPluginCall?

    @objc func pickMedia(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else { call.reject("No screen."); return }
            self.pickCall = call
            let sheet = UIAlertController(title: "Add to Media", message: nil, preferredStyle: .actionSheet)
            sheet.addAction(UIAlertAction(title: "Photos and videos", style: .default) { _ in
                var cfg = PHPickerConfiguration()
                cfg.selectionLimit = 0
                cfg.filter = .any(of: [.images, .videos])
                let p = PHPickerViewController(configuration: cfg)
                p.delegate = self
                vc.present(p, animated: true)
            })
            sheet.addAction(UIAlertAction(title: "Files (PDF, PowerPoint, Word, Excel…)", style: .default) { _ in
                var types: [UTType] = [.image, .movie, .pdf, .commaSeparatedText, .plainText]
                for ext in ["pptx", "docx", "xlsx", "ppt", "doc", "xls"] { if let t = UTType(filenameExtension: ext) { types.append(t) } }
                let p = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
                p.allowsMultipleSelection = true
                p.delegate = self
                vc.present(p, animated: true)
            })
            sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in self.finishPick([]) })
            sheet.popoverPresentationController?.sourceView = vc.view
            sheet.popoverPresentationController?.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.maxY - 80, width: 1, height: 1)
            vc.present(sheet, animated: true)
        }
    }

    private func finishPick(_ items: [[String: Any]]) { pickCall?.resolve(["items": items]); pickCall = nil }

    private func newId() -> String { String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(16)).lowercased() }

    /// Copies one picked file into the app; PDFs become one picture per page; Office files are converted by the app.
    fileprivate func importFile(_ src: URL, name: String) -> [String: Any]? {
        let ext = src.pathExtension.lowercased()
        let id = newId()
        if ext == "pdf" { return importPdf(src, name: name, id: id) }
        if ["heic", "heif"].contains(ext), let img = UIImage(contentsOfFile: src.path), let jpg = img.jpegData(compressionQuality: 0.9) {
            let out = mediaDir.appendingPathComponent(id + ".jpg")
            guard (try? jpg.write(to: out)) != nil else { return nil }
            return ["id": id, "name": name, "type": "image/jpeg", "path": out.path, "size": jpg.count]
        }
        let out = mediaDir.appendingPathComponent(id + "." + (ext.isEmpty ? "bin" : ext))
        do { try FileManager.default.copyItem(at: src, to: out) } catch { return nil }
        let size = (try? FileManager.default.attributesOfItem(atPath: out.path)[.size] as? Int) ?? 0
        let office = ["pptx", "docx", "xlsx", "ppt", "doc", "xls", "csv", "txt"].contains(ext)
        let type = UTType(filenameExtension: ext)?.preferredMIMEType ?? ""
        var o: [String: Any] = ["id": id, "name": name, "type": type, "path": out.path, "size": size]
        if office { o["office"] = true }
        return o
    }

    private func importPdf(_ src: URL, name: String, id: String) -> [String: Any]? {
        guard let doc = PDFDocument(url: src), doc.pageCount > 0 else { return nil }
        let dir = mediaDir.appendingPathComponent(id, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var pages: [String] = []
        var size = 0
        let total = doc.pageCount
        for n in 0..<min(total, 300) {
            guard let page = doc.page(at: n) else { continue }
            let box = page.bounds(for: .mediaBox)
            let scale = min(2880 / box.width, 1620 / box.height)
            let sz = CGSize(width: max(1, box.width * scale), height: max(1, box.height * scale))
            let img = UIGraphicsImageRenderer(size: sz).image { ctx in
                UIColor.white.setFill(); ctx.fill(CGRect(origin: .zero, size: sz))
                ctx.cgContext.translateBy(x: 0, y: sz.height); ctx.cgContext.scaleBy(x: scale, y: -scale)
                page.draw(with: .mediaBox, to: ctx.cgContext)
            }
            guard let jpg = img.jpegData(compressionQuality: 0.9) else { continue }
            let out = dir.appendingPathComponent("p\(n + 1).jpg")
            if (try? jpg.write(to: out)) != nil { pages.append(out.path); size += jpg.count }
        }
        if pages.isEmpty { try? FileManager.default.removeItem(at: dir); return nil }
        return ["id": id, "name": name, "type": "application/pdf", "path": dir.path, "pages": pages, "size": size, "more": total > 300 ? total : 0]
    }

    @objc func saveMediaPage(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), id.range(of: "^[A-Za-z0-9]+$", options: .regularExpression) != nil, let data = Data(base64Encoded: call.getString("data") ?? "") else { call.reject("Bad page."); return }
        let dir = mediaDir.appendingPathComponent(id, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let out = dir.appendingPathComponent("p\(call.getInt("n") ?? 1).jpg")
        do { try data.write(to: out); call.resolve(["path": out.path]) } catch { call.reject("The page could not be saved (is the iPhone full?).") }
    }

    @objc func deleteMedia(_ call: CAPPluginCall) {
        let p = call.getString("path") ?? ""
        if p.hasPrefix(mediaDir.path) { try? FileManager.default.removeItem(atPath: p) }
        call.resolve()
    }

    @objc func downloadMedia(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), s.hasPrefix("https://"), let u = URL(string: s), let id = call.getString("id"), id.range(of: "^[A-Za-z0-9]+$", options: .regularExpression) != nil else { call.reject("Bad download."); return }
        let ext = ["jpg", "png", "mp4"].contains(call.getString("ext") ?? "") ? call.getString("ext")! : "jpg"
        let out = mediaDir.appendingPathComponent(id + "." + ext)
        URLSession.shared.downloadTask(with: u) { tmp, resp, err in
            guard let tmp = tmp, err == nil, (resp as? HTTPURLResponse)?.statusCode == 200 else { call.reject("The download did not finish. Check the internet and try again."); return }
            try? FileManager.default.removeItem(at: out)
            do { try FileManager.default.moveItem(at: tmp, to: out) } catch { call.reject("The download could not be saved."); return }
            let size = (try? FileManager.default.attributesOfItem(atPath: out.path)[.size] as? Int) ?? 0
            call.resolve(["path": out.path, "size": size])
        }.resume()
    }

    // Backups: written in pieces, then shared with "Save to Files", WhatsApp, e-mail…
    private var tempBackup: URL { FileManager.default.temporaryDirectory.appendingPathComponent("backup.tmp") }

    @objc func writeTemp(_ call: CAPPluginCall) {
        let data = Data((call.getString("data") ?? "").utf8)
        if call.getBool("append") ?? false, let h = try? FileHandle(forWritingTo: tempBackup) { h.seekToEndOfFile(); h.write(data); h.closeFile() }
        else { try? data.write(to: tempBackup) }
        call.resolve()
    }

    @objc func saveFile(_ call: CAPPluginCall) {
        let name = call.getString("name") ?? "backup.json"
        let out = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        try? FileManager.default.removeItem(at: out)
        guard (try? FileManager.default.copyItem(at: tempBackup, to: out)) != nil else { call.reject("Nothing to save."); return }
        DispatchQueue.main.async {
            let vc = UIActivityViewController(activityItems: [out], applicationActivities: nil)
            vc.popoverPresentationController?.sourceView = self.bridge?.viewController?.view
            vc.completionWithItemsHandler = { _, done, _, _ in done ? call.resolve() : call.reject("cancelled") }
            self.bridge?.viewController?.present(vc, animated: true)
        }
    }

    // MARK: speech (voice search and the scripture listener), on the iPhone when it can

    private let audio = AVAudioEngine()
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var listening = false
    private var oneShot: CAPPluginCall?
    private var restartTimer: Timer?

    private func speechAllowed(_ done: @escaping (Bool) -> Void) {
        SFSpeechRecognizer.requestAuthorization { st in
            AVAudioSession.sharedInstance().requestRecordPermission { mic in DispatchQueue.main.async { done(st == .authorized && mic) } }
        }
    }

    private func beginSpeech(lang: String) throws {
        recognizer = SFSpeechRecognizer(locale: Locale(identifier: lang))
        guard let r = recognizer, r.isAvailable else { throw NSError(domain: "osoree", code: 1, userInfo: [NSLocalizedDescriptionKey: "Speech recognition is not available right now."]) }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .measurement, options: [.mixWithOthers, .defaultToSpeaker, .allowBluetooth])
        try session.setActive(true, options: .notifyOthersOnDeactivation)
        let input = audio.inputNode
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { [weak self] buf, _ in self?.request?.append(buf) }
        audio.prepare()
        try audio.start()
        newTask()
    }

    private func newTask() {
        task?.cancel()
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if recognizer?.supportsOnDeviceRecognition == true { req.requiresOnDeviceRecognition = true }
        request = req
        task = recognizer?.recognitionTask(with: req) { [weak self] result, error in
            guard let self = self else { return }
            if let result = result {
                let text = result.bestTranscription.formattedString
                if let call = self.oneShot, result.isFinal || text.split(separator: " ").count >= 6 {
                    self.oneShot = nil
                    call.resolve(["results": [text] + result.transcriptions.dropFirst().prefix(4).map { $0.formattedString }])
                    self.endSpeech()
                    return
                }
                self.notifyListeners("speech", data: ["text": text, "final": result.isFinal])
                if result.isFinal && self.listening { DispatchQueue.main.async { self.newTask() } }
            } else if error != nil, self.listening {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { if self.listening { self.newTask() } }
            }
        }
        // Apple limits one recognition to about a minute: start a fresh one every 50 seconds.
        DispatchQueue.main.async {
            self.restartTimer?.invalidate()
            if self.listening { self.restartTimer = Timer.scheduledTimer(withTimeInterval: 50, repeats: false) { _ in if self.listening { self.request?.endAudio() } } }
        }
    }

    private func endSpeech() {
        listening = false
        restartTimer?.invalidate()
        task?.cancel(); task = nil
        request?.endAudio(); request = nil
        if audio.isRunning { audio.stop() }
        audio.inputNode.removeTap(onBus: 0)
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
    }

    /// Voice search (the microphone button): one sentence.
    @objc func listen(_ call: CAPPluginCall) {
        speechAllowed { ok in
            guard ok else { call.reject("Allow the microphone and speech recognition in Settings."); return }
            self.oneShot = call
            do { try self.beginSpeech(lang: "en-US") } catch { self.oneShot = nil; call.reject(error.localizedDescription) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 8) { if let c = self.oneShot { self.oneShot = nil; self.endSpeech(); c.reject("cancelled") } }
        }
    }

    @objc func startListening(_ call: CAPPluginCall) {
        speechAllowed { ok in
            guard ok else { call.reject("Allow the microphone and speech recognition in Settings."); return }
            self.listening = true
            do { try self.beginSpeech(lang: call.getString("lang") ?? "en-US"); self.notifyListeners("listen", data: ["state": "listening"]); call.resolve() }
            catch { self.listening = false; call.reject(error.localizedDescription) }
        }
    }

    @objc func stopListening(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.endSpeech(); self.notifyListeners("listen", data: ["state": "off"]); call.resolve() }
    }

    // MARK: getting the operator's attention

    @objc func buzz(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let g = UINotificationFeedbackGenerator(); g.notificationOccurred(.warning)
            if call.getBool("sound") ?? false { AudioServicesPlaySystemSound(1113) }
            call.resolve()
        }
    }

    @objc func requestNotifications(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { ok, _ in call.resolve(["granted": ok]) }
    }

    @objc func notify(_ call: CAPPluginCall) {
        let c = UNMutableNotificationContent()
        c.title = call.getString("title") ?? "Ɔsɔreɛ Plus"
        c.body = call.getString("body") ?? ""
        c.sound = .default
        let id = call.getString("channel") == "scripture" ? "scripture" : UUID().uuidString
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: c, trigger: nil))
        call.resolve()
    }

    /// iPhone updates come from the App Store.
    @objc func installUpdate(_ call: CAPPluginCall) {
        DispatchQueue.main.async { UIApplication.shared.open(URL(string: "itms-apps://apps.apple.com/app/id" + (call.getString("appId") ?? ""))!); call.resolve() }
    }

    // MARK: App Store purchases (Pro)

    @objc func iapProducts(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self) ?? []
        Task {
            do {
                let ps = try await Product.products(for: ids)
                call.resolve(["products": ps.map { ["id": $0.id, "title": $0.displayName, "price": $0.displayPrice] }])
            } catch { call.reject("The App Store did not answer. Check the internet.") }
        }
    }

    /// Buys a product; the app sends Apple's signed transaction to our server, which gives the licence.
    @objc func iapBuy(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("No product."); return }
        Task {
            do {
                guard let p = try await Product.products(for: [id]).first else { call.reject("This product is not in the App Store yet."); return }
                switch try await p.purchase() {
                case .success(let v):
                    if case .verified(let t) = v { await t.finish() }
                    call.resolve(["jws": v.jwsRepresentation])
                case .pending: call.reject("The purchase is waiting for approval (Ask to Buy). Pro switches on once it is approved.")
                case .userCancelled: call.reject("cancelled")
                @unknown default: call.reject("The purchase did not finish.")
                }
            } catch { call.reject(error.localizedDescription) }
        }
    }

    /// "Restore purchases": every Pro purchase this Apple ID owns.
    @objc func iapRestore(_ call: CAPPluginCall) {
        Task {
            try? await AppStore.sync()
            var out: [String] = []
            for await v in Transaction.currentEntitlements { out.append(v.jwsRepresentation) }
            for await v in Transaction.all where !out.contains(v.jwsRepresentation) {
                if case .verified(let t) = v, t.productType == .nonRenewable, t.revocationDate == nil { out.append(v.jwsRepresentation) }
            }
            call.resolve(["transactions": out])
        }
    }
}

extension ScreenPlugin: PHPickerViewControllerDelegate, UIDocumentPickerDelegate {
    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        if results.isEmpty { finishPick([]); return }
        let group = DispatchGroup()
        var items: [[String: Any]] = []
        let lock = NSLock()
        for r in results {
            let p = r.itemProvider
            let type = p.hasItemConformingToTypeIdentifier(UTType.movie.identifier) ? UTType.movie : UTType.image
            group.enter()
            p.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
                defer { group.leave() }
                guard let url = url else { return }
                let name = p.suggestedName ?? url.deletingPathExtension().lastPathComponent
                if let o = self.importFile(url, name: name + "." + url.pathExtension) { lock.lock(); items.append(o); lock.unlock() }
            }
        }
        group.notify(queue: .main) { self.finishPick(items) }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        DispatchQueue.global(qos: .userInitiated).async {
            let items = urls.compactMap { self.importFile($0, name: $0.lastPathComponent) }
            DispatchQueue.main.async { self.finishPick(items) }
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finishPick([]) }
}

/// The projector or TV: a full-screen page on the second screen (cable adapter or AirPlay).
final class ExternalScreen: NSObject, WKNavigationDelegate {
    let screen: UIScreen
    private let window: UIWindow
    private let web: WKWebView
    private var ready = false
    private var pending: String?

    init(screen: UIScreen, state: String?) {
        self.screen = screen
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.setURLSchemeHandler(LocalFiles(), forURLScheme: "capacitor")
        web = WKWebView(frame: screen.bounds, configuration: cfg)
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.isScrollEnabled = false
        window = UIWindow(frame: screen.bounds)
        window.screen = screen
        window.backgroundColor = .black
        let vc = UIViewController()
        vc.view = web
        window.rootViewController = vc
        window.isHidden = false
        pending = state
        super.init()
        web.navigationDelegate = self
        web.load(URLRequest(url: URL(string: "capacitor://localhost/display.html?screen")!))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        ready = true
        if let s = pending { render(s) }
    }

    func render(_ json: String) {
        pending = json
        guard ready else { return }
        web.evaluateJavaScript("window.osoreeRender && window.osoreeRender(\(json))", completionHandler: nil)
    }

    func close() { window.isHidden = true; web.stopLoading() }
}

/// Serves the app's own files (display.html, Bibles, fonts) and the church's media (/_capacitor_file_/…) to the
/// projector page, with byte ranges so videos can play and seek.
final class LocalFiles: NSObject, WKURLSchemeHandler {
    private let root = Bundle.main.url(forResource: "public", withExtension: nil)!

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path.removingPercentEncoding ?? url.path
        let file: URL
        if path.hasPrefix("/_capacitor_file_") {
            path = String(path.dropFirst("/_capacitor_file_".count))
            let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].path
            guard path.hasPrefix(docs) else { fail(task, 403); return }
            file = URL(fileURLWithPath: path)
        } else {
            if path == "/" || path.isEmpty { path = "/index.html" }
            file = root.appendingPathComponent(String(path.dropFirst()))
            guard file.standardizedFileURL.path.hasPrefix(root.standardizedFileURL.path) else { fail(task, 403); return }
        }
        guard let data = try? Data(contentsOf: file, options: .mappedIfSafe) else { fail(task, 404); return }
        let mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        var status = 200
        var body = data
        var headers: [String: String] = ["Content-Type": mime, "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*"]
        if let range = task.request.value(forHTTPHeaderField: "Range"), let m = range.range(of: #"bytes=(\d*)-(\d*)"#, options: .regularExpression) {
            let parts = range[m].dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
            let start = Int(parts.first ?? "") ?? 0
            let end = min(Int(parts.count > 1 ? parts[1] : "") ?? (data.count - 1), data.count - 1)
            if start <= end {
                body = data.subdata(in: start..<(end + 1))
                status = 206
                headers["Content-Range"] = "bytes \(start)-\(end)/\(data.count)"
            }
        }
        headers["Content-Length"] = String(body.count)
        task.didReceive(HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(body)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private func fail(_ task: WKURLSchemeTask, _ code: Int) {
        task.didReceive(HTTPURLResponse(url: task.request.url!, statusCode: code, httpVersion: "HTTP/1.1", headerFields: nil)!)
        task.didFinish()
    }
}
