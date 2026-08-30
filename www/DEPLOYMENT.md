# Deployment and Android Packaging Guide

## 1. Public web deployment

This project is a static web app plus a small Python backend. For public viewing, use one of the following:

- Netlify: deploy the folder directly with the included netlify.toml
- Vercel: deploy from the repo with the included vercel.json
- Render or Railway: use the Python backend for production API routes

### Recommended path

- Use public hosting for the front-end view
- Use a Python host for /api/analyze and /api/icat-2025
- Keep the app framed as historical corridor analysis, not live animal tracking

## 2. Android wrapper

The app is set up for Capacitor-based Android wrapping:

- package.json includes Capacitor scripts
- capacitor.config.ts is included for Android app metadata

### Commands to run after the shell prompt issue is cleared

```powershell
cd "C:\Users\Owner\OneDrive\Desktop\Wildlife Corridor"
npm install
npx cap add android
npx cap sync android
npx cap open android
```

Then build in Android Studio or use:

```powershell
npx cap build android
```

## 3. Google Play upload

- Create a Google Play Console developer account
- Use a proper keystore for signing
- Upload an AAB or APK
- Run internal or closed testing first
- Use a valid privacy policy if geolocation or analytics is used
- Publish only after confirming data rights and product claims

## 4. Legal notes

- This app is a historical pattern tool, not a live animal tracker
- Driver messages must remain advisory
- Do not imply current wildlife presence unless you have approved data and legal review
- Map keys and data sources must be licensed and restricted
- A privacy policy is required if location or analytics are used

## 5. Update process

1. Update the app or data
2. Bump versionCode and versionName
3. Generate a new signed app package
4. Upload to Play Console
5. Test in closed testing
6. Release to production
