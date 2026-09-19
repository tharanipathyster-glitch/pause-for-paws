import Foundation
import Capacitor

// Bridges the JS UI to the native background corridor-alert monitor (mirrors the Android plugin).
@objc(CorridorAlertPlugin)
public class CorridorAlertPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CorridorAlertPlugin"
    public let jsName = "CorridorAlert"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            CorridorAlertMonitor.shared.start { error in
                if let error = error {
                    call.reject(error.localizedDescription)
                } else {
                    call.resolve(["running": true])
                }
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            CorridorAlertMonitor.shared.stop()
            call.resolve(["running": false])
        }
    }
}
