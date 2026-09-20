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

On any PC with Android Studio:

```bash
git pull
npm install
npm run android:sync
npm run android:open
```

Then plug the phone in (USB debugging on) and press **▶ Run** in Android
Studio.

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
