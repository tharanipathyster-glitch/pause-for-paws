# App Review notes — Pause for Paws

Paste the "Notes for Review" block below into App Store Connect at submission.
It exists because our core feature is location-triggered and a reviewer cannot
reach an Iowa wildlife corridor; guideline 2.1(a) asks us to provide a demo
path and to explain non-obvious features.

## Notes for Review (paste this)

Pause for Paws warns drivers, by voice, when they enter a stretch of road with
a documented history of animal-vehicle crashes. The corridor data is public
Iowa DOT crash records.

No account or login is required.

HOW TO TEST THE MAIN FEATURE WITHOUT DRIVING
On the first screen, tap "Play a test alert" in the green "Corridor alerts"
bar at the top. The app speaks a sample alert aloud through the device
speaker (or CarPlay/Bluetooth if connected). This works immediately on a
fresh install and does NOT require granting location access, so it can be
tested anywhere.

Please make sure the device is not on silent and the volume is up.

WHY THE APP USES BACKGROUND LOCATION
Alerts must reach the driver while the phone is locked or the app is in the
background, which is the normal state while driving. The app therefore uses
UIBackgroundModes: location. It speaks only; it posts no notifications.

To limit battery use and avoid nuisance alerts, an alert is only spoken when
all of the following are true:
  - the device is within 2 miles of a known corridor
  - it is travelling faster than about 20 mph
  - that corridor has not already been announced on this pass
  - at least 2 minutes have passed since any previous alert

The user can switch alerts off entirely with the toggle in the same bar,
which stops location monitoring completely (not just the audio).

LIVE ALERTS ARE GEOGRAPHIC
Real alerts only trigger near the 250 corridors in our dataset, all of which
are in Iowa, USA. That is why the test button exists.

WHAT THE APP DOES NOT CLAIM
The app never states that an animal is present. It reports a historical crash
pattern only, and says so on screen and in the privacy policy.
