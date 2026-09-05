# Pause for Paws

A standalone prototype for turning wildlife detection coordinates into a corridor-level driver alert.

## Run it

Run `py server.py`, then open `http://localhost:5500/index.html`. The server provides the website, reads [waze-archive-test-data.csv](waze-archive-test-data.csv), and exposes `POST /api/analyze` for archive processing. Opening [index.html](index.html) directly still works as a front-end fallback, but backend analysis requires the server.

## Legal and product framing

This prototype is intentionally positioned as a historical corridor signal and advisory driver reminder, not a live animal tracker. The UI and alert language should continue to state that the app is based on historical pattern analysis and does not guarantee current wildlife presence on the road.

Before any public deployment or Google Play release, confirm:

- you have lawful permission to use all dataset inputs;
- you have a privacy policy if location, analytics, or device telemetry are used;
- map and API keys are restricted and not exposed in source control;
- all app listing text accurately matches the product's real functionality;
- any third-party or partner data usage has been reviewed by legal counsel.

See [privacy-policy.html](privacy-policy.html) for the project disclaimer and consent language.

## Share it with someone else

The `localhost` address is private to this computer. For a permanent public link, deploy the folder to a host with HTTPS. The Google Maps key must be restricted to the final domain, for example `https://pause-for-paws.example.com/*`. The full Iowa analysis needs a Python-capable host because `server.py` provides the backend API. Static hosting can show the interface and map, but it cannot run `/api/analyze` or `/api/icat-2025`.

Recommended options:

1. Use Render, Railway, or PythonAnywhere for `server.py`; set the service start command to `py server.py` or the host's Python equivalent.
2. Use GitHub Pages or Netlify for the static interface only, after changing the frontend to load a hosted JSON export instead of local API routes.
3. In Google Cloud Console, add the final HTTPS domain under website restrictions and keep `Maps JavaScript API` as the only allowed API.

Do not publish the API key in a public repository. A browser key is visible by design, but it must be domain-restricted and rotated if exposed.

To enable the real Google basemap, put a browser-restricted Maps JavaScript API key in [google-maps-config.js](google-maps-config.js). The key must have Maps JavaScript API enabled, billing enabled, and an HTTP referrer restriction for the production domain. Do not commit a real key to source control.

## Historical data feed

The app reads approved historical events from [data/corridors.json](data/corridors.json) and falls back to the bundled archive when the remote feed is unavailable or expired. Replace the prototype feed with a reviewed Iowa DOT or wildlife-agency export before public use. Keep `updatedAt`, `expiresAt`, `source`, and `events` in the feed so the app can show freshness and reject stale data without requiring a new Play Store release.

## What is implemented

- A map-style field view with three monitored corridors.
- Optional Google Maps JavaScript rendering with historical markers and a derived corridor-radius overlay.
- A historical Waze-compatible coordinate archive importer accepting CSV or JSON event objects with `lat`, `lng`, `species`, `confidence`, and `reportedAt`.
- Basic input validation and confidence aggregation.
- Driver message preview that describes a historical corridor risk pattern rather than claiming a live per-animal location.
- Responsive desktop and mobile layouts.

## Production integration boundary

This prototype does not scrape Waze, fetch private historical data, write into Google Maps, or change routing. A production version needs an approved archive export or partner data agreement and a backend that:

1. Authenticates and validates the sensor or agency feed.
2. Deduplicates detections and maps points to stable 3–8 mile corridor IDs.
3. Applies rolling-window thresholds, confidence scoring, hysteresis, minimum dwell, and honest expiry times.
4. Publishes the approved corridor state as a CIFS feed to Waze Partner Hub.
5. Uses the approved Waze/Google Maps content-partner path for downstream map display.
6. Keeps a versioned audit log of every published state.

Waze and Google Maps availability, incident rendering, feed latency, and eligibility are controlled by their partner programs. Obtain permission before using any third-party coordinate data.

## Patent and legal posture

No one can guarantee that a product does not conflict with existing patents without a jurisdiction-specific professional freedom-to-operate search. The distinctive product framing here is a corridor-state publication layer: it aggregates short-lived point detections into transparent, expiring corridor risk states and keeps real-time per-animal alerts on first-party roadside or app channels. Before commercialization, have patent counsel search relevant claims and review data licenses, privacy, safety claims, trademarks, and partner terms.
