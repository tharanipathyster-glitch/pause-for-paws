# Pause for Paws: maintenance guide

Live site: https://pauseforpawsusa.org (GitHub Pages, deployed from `main`). iOS and Android apps are Capacitor builds of the same pages.

## What runs by itself

| What | When | Where |
|---|---|---|
| Crash data refresh (Iowa DOT feed, ICAT as backup), then deploy | 1st and 16th, 11:00 UTC, and on every push to `main` | `.github/workflows/deploy-pages.yml` |
| Stale-data alarm (fails the run if the newest crash is over 14 days old) | end of every deploy | `scripts/check-freshness.mjs` |
| Daily report email | every day, 01:00 UTC (7 PM Central in winter) | `.github/workflows/daily-report.yml` |
| Weekly summary email | Mondays, 14:00 UTC (8 AM Central in winter) | same workflow |

Reports go to the addresses in the GitHub secret `EMAIL_TO` (comma separated). Sending uses `GMAIL_USER` and `GMAIL_APP_PASSWORD`. Other secrets: `GCP_SERVICE_ACCOUNT_JSON` (Maps usage, read-only), `ASC_*` (App Store Connect sales reports, read-only), `GOOGLE_MAPS_API_KEY`.

## Routine

**Every day / Monday:** read the emails. A missing email is the first warning; check the repo's Actions tab.

**Monthly (about 5 minutes):**
1. Actions tab: the latest daily report, crash refresh and deploy runs are green.
2. pauseforpawsusa.org: the header date ("Data through ...") is within 2 weeks.
3. Google Maps usage in the email is under about 70% of the 10,000 free loads a month.

**Calendar reminders**

| When | What |
|---|---|
| Nov 1 and March | Daylight saving moves the report time by an hour (cron is in UTC). Optional to fix. |
| Mid-January to mid-February | Check the new year's crash data is arriving (the alarm is relaxed for the first 45 days of the year). |
| Every year, iOS | Renew the Apple developer fee; build a release with a current Xcode; bump the build number. |
| Every year, Android | Release a build targeting Google Play's newest Android version. |
| Every year, domain | Renew pauseforpawsusa.org; check the HTTPS certificate in GitHub Pages settings. |
| Once | Keep two backups of the Android release key (it is not in git). Losing it blocks updates. |
| Every quarter | Update GitHub Action versions and the Capacitor and Node packages. |

## If something happens

| Symptom | Action |
|---|---|
| "Run failed" email from GitHub | Open the run and read the failed step. A one-off `Internal Server Error` from GitHub: re-run. Otherwise ask for help. |
| No daily email | Check the Gmail app password (revoked if the Google password changes or 2-Step Verification is turned off); update `GMAIL_APP_PASSWORD`. |
| Actions shows scheduled workflows "disabled" | GitHub switches them off after 60 days with no repo activity. Click "Enable workflow". |
| Report shows "could not read ..." for a line | That source (Apple, Google or the live site) failed for the day; if it repeats, check its secret. |
| Maps usage near 10,000 | Set a daily cap in Google Cloud (about 1,000 to 2,000 loads) and look at Billing. |
| Website text or layout change | Change `index.html`, `app.js`, `styles.css`; the apps only pick it up in their next release. |

## Good to know

- The apps bundle the website pages (`www/`); only `corridors.json` is fetched live, so crash data stays current without a release but page changes need one.
- Maps numbers in the report are API request counts, not billed map loads. Billing is the source for the real bill.
- iOS downloads come from Apple's sales reports (first-time downloads, about two days behind). Apple's Analytics page can show a different number.
- Always keep git, the live site and the `www/` copy in sync after a change. The deploy job saves refreshed data back to the repo.
- Report code: `scripts/daily-report.mjs`. A dry run (Actions > Daily and weekly email report > Run workflow > dry_run) builds everything without sending.
