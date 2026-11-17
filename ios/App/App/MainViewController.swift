import Capacitor

/// The app's web view, with the Ɔsɔreɛ "Screen" plugin (ScreenPlugin.swift) added.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ScreenPlugin())
    }
}
