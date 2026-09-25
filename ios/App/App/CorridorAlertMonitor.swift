import Foundation
import CoreLocation
import AVFoundation

// iOS counterpart of Android's CorridorAlertService: keeps watching the device location (in the
// background too) and speaks a short alert when the driver enters a bundled historical corridor, so
// it reaches them through CarPlay / Bluetooth car audio. Voice only, by design: no banners.
final class CorridorAlertMonitor: NSObject, CLLocationManagerDelegate, AVSpeechSynthesizerDelegate {
    static let shared = CorridorAlertMonitor()

    private static let alertRadiusMiles = 2.0
    private static let exitRadiusMiles = 3.0                   // re-arm a zone only once clearly past it
    private static let alertSpacing: TimeInterval = 2 * 60     // between any two alerts
    private static let minDrivingSpeed: CLLocationSpeed = 8.9  // m/s, about 20 mph
    private static let enabledKey = "corridorAlertEnabled"

    enum StartError: LocalizedError {
        case locationDenied
        var errorDescription: String? { "Location permission is required for corridor alerts." }
    }

    private struct Corridor {
        let id: String
        let species: String   // "animal-crash" for DOT clusters, or a real animal for reported crossings
        let location: CLLocation

        // Driver-facing wording for the spoken alert.
        var animal: String? {
            let generic = ["animal-crash", "animal-related crashes", "wildlife", ""]
            return generic.contains(species.lowercased()) ? nil : species
        }
        // Kept to one breath so it never competes with the road.
        var headline: String { "\(animal ?? "Wildlife") crossing ahead" }
        var advice: String { animal == nil ? "Watch for deer." : "Watch both sides." }
        var speech: String { "Pause for Paws. \(headline). \(advice)" }
    }

    private let locationManager = CLLocationManager()
    nonisolated(unsafe) private let speaker = AVSpeechSynthesizer()
    private let corridors: [Corridor]
    private var insideCorridorIds = Set<String>()
    private var lastAlertAt = Date.distantPast
    private var pendingStart: ((Error?) -> Void)?
    private(set) var isRunning = false

    private override init() {
        corridors = Self.loadCorridors()
        super.init()
        locationManager.delegate = self
        speaker.delegate = self
    }

    // MARK: - Start / stop

    func start(completion: @escaping (Error?) -> Void) {
        requestLocationThenStart(completion)
    }

    func stop() {
        locationManager.stopUpdatingLocation()
        locationManager.stopMonitoringSignificantLocationChanges()
        isRunning = false
        UserDefaults.standard.set(false, forKey: Self.enabledKey)
    }

    // Called when iOS relaunches the app in the background for a location event: the web view and
    // plugin never load in that case, so monitoring has to be resumed natively.
    func resumeIfEnabled() {
        guard UserDefaults.standard.bool(forKey: Self.enabledKey) else { return }
        switch authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: beginUpdates()
        default: break
        }
    }

    private func requestLocationThenStart(_ completion: @escaping (Error?) -> Void) {
        switch authorizationStatus {
        case .notDetermined:
            pendingStart = completion
            locationManager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse:
            // Upgrade to Always so alerts keep firing after the app leaves the foreground.
            locationManager.requestAlwaysAuthorization()
            beginUpdates()
            completion(nil)
        case .authorizedAlways:
            beginUpdates()
            completion(nil)
        default:
            completion(StartError.locationDenied)
        }
    }

    private func beginUpdates() {
        locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        locationManager.distanceFilter = 200
        locationManager.activityType = .automotiveNavigation
        locationManager.pausesLocationUpdatesAutomatically = false
        // Requires UIBackgroundModes = location in Info.plist.
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.showsBackgroundLocationIndicator = true
        locationManager.startUpdatingLocation()
        // Relaunches the app after iOS (or the user) kills it, so monitoring survives a swipe-away.
        if CLLocationManager.significantLocationChangeMonitoringAvailable() {
            locationManager.startMonitoringSignificantLocationChanges()
        }
        isRunning = true
        UserDefaults.standard.set(true, forKey: Self.enabledKey)
    }

    private var authorizationStatus: CLAuthorizationStatus {
        if #available(iOS 14.0, *) { return locationManager.authorizationStatus }
        return CLLocationManager.authorizationStatus()
    }

    // MARK: - CLLocationManagerDelegate

    @available(iOS 14.0, *)
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        handleAuthorizationChange()
    }

    func locationManager(_ manager: CLLocationManager, didChangeAuthorization status: CLAuthorizationStatus) {
        handleAuthorizationChange()
    }

    private func handleAuthorizationChange() {
        guard let completion = pendingStart else { return }
        switch authorizationStatus {
        case .notDetermined:
            return // still prompting
        case .authorizedWhenInUse, .authorizedAlways:
            pendingStart = nil
            if authorizationStatus == .authorizedWhenInUse { locationManager.requestAlwaysAuthorization() }
            beginUpdates()
            completion(nil)
        default:
            pendingStart = nil
            completion(StartError.locationDenied)
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        let distances = corridors.map { ($0, location.distance(from: $0.location) / 1609.344) }
        // Leaving a zone re-arms it for the next pass; 3 mi out vs 2 mi in absorbs GPS jitter.
        for (corridor, distance) in distances where distance > Self.exitRadiusMiles {
            insideCorridorIds.remove(corridor.id)
        }
        // Parked or walking inside a zone is not a reason to alert; unknown speed (-1) passes.
        if location.speed >= 0 && location.speed < Self.minDrivingSpeed { return }
        let inRange = distances.filter { $0.1 <= Self.alertRadiusMiles }
        // Corridors overlap; only the nearest zone we have not already announced gets to speak.
        guard let (nearest, _) = inRange.filter({ !insideCorridorIds.contains($0.0.id) }).min(by: { $0.1 < $1.1 }) else { return }
        let now = Date()
        if now.timeIntervalSince(lastAlertAt) < Self.alertSpacing { return }
        lastAlertAt = now
        // One alert covers every overlapping zone the driver is in right now.
        inRange.forEach { insideCorridorIds.insert($0.0.id) }
        speak(nearest.speech)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Transient GPS failures are expected while driving; keep watching.
    }

    // MARK: - Spoken alert (plays over CarPlay and Bluetooth without a CarPlay entitlement)

    private func speak(_ text: String) {
        let session = AVAudioSession.sharedInstance()
        // Duck music / navigation while speaking; requires UIBackgroundModes = audio to start in the background.
        try? session.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
        try? session.setActive(true)
        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate
        speaker.speak(utterance)
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        guard !synthesizer.isSpeaking else { return }
        // Hand the audio route back so the other app's volume comes back up.
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        speechSynthesizer(synthesizer, didFinish: utterance)
    }

    // MARK: - Data

    private static func loadCorridors() -> [Corridor] {
        guard let url = Bundle.main.url(forResource: "corridors", withExtension: "json", subdirectory: "public/data"),
              var data = try? Data(contentsOf: url) else { return [] }
        if data.starts(with: [0xEF, 0xBB, 0xBF]) { data.removeFirst(3) } // UTF-8 BOM
        guard let feed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let events = feed["events"] as? [[String: Any]] else { return [] }
        return events.enumerated().compactMap { index, event in
            guard let lat = event["lat"] as? Double, let lng = event["lng"] as? Double else { return nil }
            return Corridor(id: event["id"] as? String ?? "corridor-\(index)",
                            species: event["species"] as? String ?? "",
                            location: CLLocation(latitude: lat, longitude: lng))
        }
    }
}
