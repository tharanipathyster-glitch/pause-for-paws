import UIKit
import Capacitor

// Capacitor only auto-registers plugins installed from npm; the app's own plugins go here.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CorridorAlertPlugin())
    }
}
