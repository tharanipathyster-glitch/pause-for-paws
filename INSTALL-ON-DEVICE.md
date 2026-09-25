# Installing Pause for Paws on iPhones and iPads (no coding needed)

This is the manual, click-by-click way to put the app on a phone or iPad
from the Mac using Xcode. It takes about 3 minutes per device once set up.

## Before you start (once per Mac)

1. **Xcode** is installed from the App Store and has been opened once (it
   installs extra components on first launch).
2. The project is on the Mac: `Documents/Pause for Paws`. If not, clone it
   from GitHub (`tharanipathyster-glitch/pause-for-paws`) or copy the folder.
3. The Google Maps key file `google-maps-config.js` exists in the project
   folder (it is deliberately *not* on GitHub; copy it from another Mac).
4. Xcode is signed in to your Apple ID: **Xcode → Settings → Accounts → +**
   → Apple ID. The project is already set to your team.

## Build and install (every time)

1. Plug the device in with a cable and **unlock it**.
2. On the device, tap **Trust** if it asks "Trust This Computer?".
3. In Finder, open `Documents/Pause for Paws/ios/App/` and double-click
   **`App.xcworkspace`** (the white icon — *not* `App.xcodeproj`).
4. In the toolbar at the top of Xcode, click the device selector (it says
   something like "App > iPhone 16 Pro") and pick **your device** from the
   list. It may say "Preparing device…" for a minute the first time.
5. Press the **▶ Run** button (or **⌘R**). Xcode builds, installs and
   launches the app. The first build takes a few minutes; later ones ~30 s.

If Xcode complains about signing, open the **App** project in the left
sidebar → **Signing & Capabilities** tab → tick **Automatically manage
signing** and pick your **Team**.

## On the device (once per device)

You may hit one or more of these the first time. All are normal.

| Xcode / device says | What to do on the device |
|---|---|
| "Developer Mode is disabled" | **Settings → Privacy & Security → Developer Mode** → on → **Restart** → after reboot tap **Turn On**, enter passcode. (The row appears only after Xcode has tried to talk to the device.) |
| App installed but won't open / "untrusted developer" | **Settings → General → VPN & Device Management** → tap **Apple Development: <your Apple ID>** → **Trust** → **Trust**. |
| First launch prompts | **Allow While Using App** → later **Change to Always Allow** (needed for alerts while the app is in the background) → **Allow** for the "localhost" map prompt. |

## The 7-day expiry (free Apple ID)

Apps installed with a free Apple ID stop opening **7 days** after install.
To refresh: plug the device in, unlock it, open `App.xcworkspace`, pick the
device, press **▶**. That's it — settings and permissions are kept.

A paid Apple Developer Program membership (developer.apple.com/programs)
makes installs last a year, allows TestFlight sharing without cables, and
is required to request the CarPlay entitlement.

## Android

### Before you start (once per PC)

1. **Android Studio** is installed (bundles the JDK and Android SDK).
2. The **Google USB Driver** is installed: Android Studio → **Tools → SDK
   Manager → SDK Tools** tab → check **Google USB Driver** → **Apply**.
   Without this, Windows will show the phone as an unrecognized/"Unknown"
   device and nothing below will work, no matter what's toggled on the phone.
3. The Google Maps key file `google-maps-config.js` exists in the project
   folder **and** in `www/google-maps-config.js` (it is deliberately *not*
   on GitHub; copy it from another machine that has it, or ask for the key).

### On the phone (once per device)

1. **Settings → About phone → tap "Build number" 7 times** to unlock
   Developer Options.
2. **Settings → System → Developer options → USB debugging** → on.
3. Plug the phone into the PC with a cable, **unlocked**.
4. A popup appears on the phone: **"Allow USB debugging?"** → check
   **"Always allow from this computer"** → **Allow**. If no popup appears,
   see Troubleshooting below.

### Build and install (every time)

```bash
git pull
npm install
npm run android:sync
npm run android:open
```

Then in Android Studio, pick the connected device from the device dropdown
in the toolbar and press **▶ Run**. First build takes a few minutes.

**Command-line alternative** (no Android Studio UI needed, useful for a
quick reinstall): from the `android/` folder run
`./gradlew.bat assembleDebug`, then install the result with
`adb install -r app/build/outputs/apk/debug/app-debug.apk`
(`adb` is in the SDK's `platform-tools` folder).

### Troubleshooting

| Symptom | What to do |
|---|---|
| Windows Device Manager shows the phone as "Unknown" / no driver | Install the **Google USB Driver** (see above), then in Device Manager right-click the device → **Update driver** → **Browse my computer for drivers** → point to `<Android SDK>\extras\google\usb_driver`. |
| Windows notification: **"USB device malfunctioned"** | This is a cable/port issue, not software — no driver fixes it. Try a different USB-C cable (charge-only cables are a common cause) and a different port, ideally a rear/motherboard USB port rather than a hub. |
| `adb devices` shows nothing at all | Restart the adb server: `adb kill-server && adb start-server`, then reconnect. Confirm the phone is **unlocked** — the debugging popup often won't show on a locked screen. |
| `adb devices` shows the device but "unauthorized" | The on-phone "Allow USB debugging?" popup hasn't been accepted yet, or was previously revoked — check the phone screen, or **Developer options → Revoke USB debugging authorizations** then reconnect to force the prompt again. |
| Gradle build fails with an SSL/PKIX certificate error | Usually antivirus software (e.g. Norton) intercepting HTTPS with its own certificate, which the JDK doesn't trust even though Windows does. Fix is per-machine; ask for help rather than disabling antivirus protection. |
| Map is blank | `google-maps-config.js` is missing from the project root **and/or** `www/` (see "Before you start"). |

## Troubleshooting

- **Device not in Xcode's list** → unlock it, reseat the cable, and wait for
  "Preparing device" to finish. On the device check for a Trust prompt.
- **"Unable to install… device not registered"** → in Signing & Capabilities
  make sure *Automatically manage signing* is on; Xcode registers the device.
- **Build fails with a CocoaPods/Pods error** → in Terminal run
  `cd "Documents/Pause for Paws/ios/App" && pod install`, then reopen the
  workspace.
- **Map is blank** → `google-maps-config.js` is missing (see "Before you
  start").
- **No voice alert in the car** → phone must be unlocked once after install,
  location set to **Always**, volume up; alerts only fire above ~20 mph and
  once per pass through a zone.
