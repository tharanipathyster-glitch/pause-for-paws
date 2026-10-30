# Release checklists

Use these when a release goes to the App Store or Google Play. Tick each box in your copy. Credentials are always added by you, never pasted in chat or committed.

Before either release, on the website side:
- [ ] Every page change is committed on `main`, deployed and visible on https://pauseforpawsusa.org.
- [ ] `node scripts/sync-web.js` has run, so `www/` matches the live site, and `www/` is committed.
- [ ] The latest deploy run on GitHub Actions is green and "Data through" is recent.
- [ ] Text still says historical pattern analysis, not a live animal tracker, and makes no claim that the app reduces crashes.

## iOS release (on the Mac)

Current: version 1.0, build 3 (check `ios/App/App.xcodeproj/project.pbxproj`).

1. [ ] `git pull` on the Mac so it has the latest `www/` and code.
2. [ ] `npm install`, then `npm run ios:sync`.
3. [ ] Confirm `google-maps-config.js` holds the browser-restricted Maps key (local file, never committed).
4. [ ] `npm run ios:open`. In Xcode, set the signing team and increase the **build number** (it must be higher than the last upload). Raise the **version** too when users will notice a change.
5. [ ] Run on a real iPhone: the map loads, the location prompt appears, the audible alert fires near a corridor, and the app opens with Wi-Fi off (bundled data).
6. [ ] Product > Archive, then Distribute App > App Store Connect > Upload.
7. [ ] In App Store Connect: pick the processed build, fill in "What's New" (draft in `Desktop\Pause for Paws outreach\app-store-wording.md`), check the screenshots and the privacy answers, and make sure the listing text matches what the app does.
8. [ ] Check `APP-REVIEW-NOTES.md` is pasted in the review notes, then submit for review.
9. [ ] After approval: install the live build from the App Store and open it once.
10. [ ] Calendar: Apple developer membership renewal date and the yearly Xcode requirement.

## Android release (on this PC)

Current: versionName 1.2, versionCode 13 (check `android/app/build.gradle`). The app is in closed testing.

1. [ ] `npm run android:sync`.
2. [ ] In `android/app/build.gradle`, increase **versionCode** (it must go up on every upload) and set **versionName**.
3. [ ] Check `android/variables.gradle`: targetSdk meets Google Play's current yearly requirement.
4. [ ] Confirm the release keystore is available outside git, and that you have **two backups** of it. If signing settings are missing, stop and fix that first.
5. [ ] Build the signed bundle: `cd android` then `gradlew bundleRelease`. The file is `android/app/build/outputs/bundle/release/app-release.aab`.
6. [ ] Test the build on a real phone or emulator: the map loads, the location prompt appears, the audible alert fires, and the offline fallback works.
7. [ ] In Play Console: upload the `.aab` to the closed testing track (or production when ready), add release notes, and check the Data Safety form, privacy policy URL (`https://pauseforpawsusa.org/privacy-policy.html`) and listing text.
8. [ ] Roll out, then check the track shows the new versionCode.
9. [ ] After rollout: install from the Play link on a tester phone and open it once.
10. [ ] Calendar: the yearly target-API update, and the keystore backups.

## After a release, either platform

- [ ] Update the "Current" version lines in `MASTER_PROMPTS.md` and in this file.
- [ ] Add a line to the daily report plan if Android goes public (so installs can be counted).
- [ ] Commit the version bump and push to `main`.
