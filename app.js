const demoCorridors = [
  { id: "01", name: "Polk County approach", species: "Animal-related crashes", detail: "Iowa roads / Des Moines area", risk: "Elevated", confidence: 94, detections: 12 },
  { id: "02", name: "Dallas County corridor", species: "Animal-related crashes", detail: "Iowa roads / Dallas County", risk: "Elevated", confidence: 88, detections: 8 },
  { id: "03", name: "Warren County passage", species: "Animal-related crashes", detail: "Iowa roads / Warren County", risk: "Monitored", confidence: 76, detections: 4 }
];
const REMOTE_FEED_URL = "data/corridors.json";
const corridorList = document.querySelector("#corridorList");
const toast = document.querySelector("#toast");
let googleMap;
let googleMarkers = [];
let googleCircles = [];
let latestEvents = [];
let currentLocationCoordinates;
let currentLocationMarker;
let remoteFeedState = { updatedAt: null, expiresAt: null, source: "Bundled fallback" };

function loadGoogleMap() {
  const mapCanvas = document.querySelector("#mapCanvas");
  if (!window.GOOGLE_MAPS_API_KEY) {
    showToast("Showing the built-in historical map view");
    return;
  }
  window.gm_authFailure = () => {
    mapCanvas.classList.remove("google-map-ready");
    mapCanvas.querySelectorAll(":scope > div").forEach((child) => {
      if (child.querySelector(".gm-style") || child.textContent.includes("Oops! Something went wrong")) child.remove();
    });
    showToast("Google Maps access was rejected; historical map view remains available");
  };
  window.initGoogleMap = () => {
    googleMap = new google.maps.Map(document.querySelector("#mapCanvas"), {
      center: { lat: 45.2, lng: -110.7 }, zoom: 9, mapTypeControl: false,
      streetViewControl: false, fullscreenControl: false, clickableIcons: false, zoomControl: true
    });
    document.querySelector("#mapCanvas").classList.add("google-map-ready");
    renderGoogleEvents(latestEvents);
    showCurrentLocation(true);
  };
  const script = document.createElement("script");
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(window.GOOGLE_MAPS_API_KEY)}&callback=initGoogleMap&loading=async&v=weekly`;
  script.async = true;
  script.defer = true;
  script.onerror = () => showToast("Google Maps could not load; historical map view remains active");
  document.head.appendChild(script);
}

function renderGoogleEvents(events) {
  latestEvents = events;
  if (!googleMap || !window.google) return;
  googleMarkers.forEach((marker) => marker.setMap(null));
  googleCircles.forEach((circle) => circle.setMap(null));
  const bounds = new google.maps.LatLngBounds();
  events.forEach((event) => {
    const position = { lat: Number(event.lat), lng: Number(event.lng) };
    const marker = new google.maps.Marker({ position, map: googleMap, title: `${event.species || "Wildlife"} historical detection`, opacity: .8 });
    marker.addListener("click", () => updateDriverMessage(event.species || "Animal-related wildlife", event.road || "Historical Iowa crash pattern"));
    googleMarkers.push(marker);
    bounds.extend(position);
  });
  if (events.length > 1) {
    const center = events.reduce((sum, event) => ({ lat: sum.lat + Number(event.lat), lng: sum.lng + Number(event.lng) }), { lat: 0, lng: 0 });
    center.lat /= events.length; center.lng /= events.length;
    googleCircles.push(new google.maps.Circle({ map: googleMap, center, radius: 3500, fillColor: "#df6e51", fillOpacity: .16, strokeColor: "#df6e51", strokeOpacity: .7, strokeWeight: 2 }));
  }
  googleMap.fitBounds(bounds, 60);
  if (currentLocationCoordinates) centerMapOnCurrentLocation();
}

function centerMapOnCurrentLocation() {
  if (!googleMap || !currentLocationCoordinates) return;
  googleMap.panTo(currentLocationCoordinates);
  googleMap.setZoom(13);
  if (currentLocationMarker) currentLocationMarker.setMap(null);
  currentLocationMarker = new google.maps.Marker({ position: currentLocationCoordinates, map: googleMap, title: "Your current location", label: "You" });
}

function updateDriverMessage(activity, locationLabel) {
  document.querySelector("#mapTitle").textContent = locationLabel;
  document.querySelector("#alertTitle").textContent = "Pause for Paws";
  document.querySelector("#alertMessage").textContent = `Historical ${activity.toLowerCase()} activity has been recorded in this corridor. Slow down and watch both shoulders. This is not a live animal location.`;
  document.querySelector("#alertSpecies").textContent = `${activity} pattern`;
}

function showApproachPopup(details) {
  const popup = document.querySelector("#approachPopup");
  popup.querySelector("#popupMessage").textContent = `${details.road}. ${details.animals} activity is historically recorded here.`;
  popup.classList.add("visible");
  window.setTimeout(() => popup.classList.remove("visible"), 8000);
}

function renderCorridors(corridors = demoCorridors) {
  corridorList.innerHTML = corridors.map((corridor) => `
    <div class="corridor-row">
      <span class="row-id">${corridor.id}</span>
      <span class="row-name">${corridor.name}</span>
      <span class="row-species">${corridor.species}</span>
      <span class="risk-pill ${corridor.risk === "Monitored" ? "low-risk" : ""}">${corridor.risk}</span>
      <span class="row-arrow">?</span>
    </div>`).join("");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 3000);
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("CSV needs a header and at least one event.");
  const headers = lines.shift().split(",").map((header) => header.trim());
  return lines.map((line) => {
    const values = line.split(",");
    return headers.reduce((event, header, index) => ({ ...event, [header]: values[index]?.trim() }), {});
  });
}

function parseArchive(text) {
  const trimmed = text.trim();
  try {
    return trimmed.startsWith("[") ? JSON.parse(trimmed) : parseCsv(trimmed);
  } catch (error) {
    throw new Error(error.message.includes("CSV") ? error.message : "Archive must be valid JSON or CSV.");
  }
}

function validateFeed(payload) {
  if (!Array.isArray(payload) || payload.length === 0) throw new Error("Feed must be a non-empty JSON array.");
  const valid = payload.filter((item) => Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng)));
  if (valid.length !== payload.length) throw new Error("Every event needs numeric lat and lng coordinates.");
  return valid;
}

function applyBackendAnalysis(analysis, payload, sourceLabel) {
  const averageConfidence = analysis?.confidence || Math.round(payload.reduce((sum, item) => sum + (Number(item.confidence) || .5), 0) / payload.length * 100);
  const species = [...new Set(payload.map((item) => item.species).filter(Boolean))].join(" + ") || "Wildlife";
  document.querySelector("#confidenceValue").innerHTML = `${averageConfidence}<small>%</small>`;
  document.querySelector("#signalsCount").textContent = String(27 + payload.length);
  document.querySelector("#alertSpecies").textContent = `${species} movement`;
  document.querySelector("#feedUpdated").textContent = remoteFeedState.updatedAt ? `Updated ${formatFeedDate(remoteFeedState.updatedAt)}` : sourceLabel;
  renderGoogleEvents(payload);
  if (analysis?.clusters) renderCorridors(analysis.clusters.slice().sort((first, second) => second.events - first.events).slice(0, 60).map((cluster) => ({ id: cluster.id, name: `Historical cluster ${cluster.id}`, species: cluster.species, detail: `${cluster.events} events / ${cluster.center.lat.toFixed(3)}, ${cluster.center.lng.toFixed(3)}`, risk: cluster.risk, confidence: cluster.confidence })));
}

function formatFeedDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "date unavailable" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

async function loadRemoteHistoricalFeed() {
  try {
    const response = await fetch(`${REMOTE_FEED_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Remote feed returned ${response.status}`);
    const feed = await response.json();
    if (!feed.updatedAt || !Array.isArray(feed.events) || !feed.events.length) throw new Error("Remote feed has no historical events");
    if (feed.expiresAt && new Date(feed.expiresAt) <= new Date()) throw new Error("Remote feed has expired");
    const payload = validateFeed(feed.events);
    remoteFeedState = { updatedAt: feed.updatedAt, expiresAt: feed.expiresAt, source: feed.source || "Remote historical feed" };
    applyBackendAnalysis(null, payload, remoteFeedState.source);
  } catch (error) {
    remoteFeedState = { updatedAt: null, expiresAt: null, source: "Bundled fallback" };
    try {
      const fallbackResponse = await fetch("/waze-archive-test-data.csv");
      const fallbackPayload = validateFeed(parseArchive(await fallbackResponse.text()));
      applyBackendAnalysis(null, fallbackPayload, "Bundled fallback archive");
      document.querySelector("#feedUpdated").textContent = "Offline fallback";
    } catch (fallbackError) {
      document.querySelector("#feedUpdated").textContent = "Historical data unavailable";
    }
  }
}

document.querySelector("#closePopup").addEventListener("click", () => document.querySelector("#approachPopup").classList.remove("visible"));

function distanceMiles(latOne, lngOne, latTwo, lngTwo) { const radians = Math.PI / 180; const latitude = (latTwo - latOne) * radians; const longitude = (lngTwo - lngOne) * radians; const value = Math.sin(latitude / 2) ** 2 + Math.cos(latOne * radians) * Math.cos(latTwo * radians) * Math.sin(longitude / 2) ** 2; return 3958.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value)); }

function showCurrentLocation(isInitialLoad = false) {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((position) => {
    currentLocationCoordinates = { lat: position.coords.latitude, lng: position.coords.longitude };
    centerMapOnCurrentLocation();
  }, () => undefined, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
}

const FOREGROUND_ALERT_RADIUS_MILES = 2;
const FOREGROUND_ALERT_COOLDOWN_MS = 10 * 60 * 1000;
let lastForegroundAlertAt = {};
function startForegroundProximityWatch() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition((position) => {
    const { latitude, longitude } = position.coords;
    latestEvents.forEach((event) => {
      const distance = distanceMiles(latitude, longitude, Number(event.lat), Number(event.lng));
      if (distance > FOREGROUND_ALERT_RADIUS_MILES) return;
      const key = event.id || `${event.lat},${event.lng}`;
      const now = Date.now();
      if (lastForegroundAlertAt[key] && now - lastForegroundAlertAt[key] < FOREGROUND_ALERT_COOLDOWN_MS) return;
      lastForegroundAlertAt[key] = now;
      updateDriverMessage(event.species || "Wildlife", event.road || "Historical corridor");
      showApproachPopup({ road: event.road || "This corridor", animals: event.species || "Wildlife" });
    });
  }, () => undefined, { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 });
}

document.querySelectorAll(".corridor").forEach((marker) => marker.addEventListener("click", () => {
  const names = { canyon: "Gardiner gateway", elk: "Blacktail plateau", madison: "Madison bend" };
  document.querySelector("#alertTitle").textContent = `${names[marker.dataset.corridor]} pattern`;
  showToast(`${names[marker.dataset.corridor]} selected`);
}));

renderCorridors();
loadGoogleMap();
loadRemoteHistoricalFeed();
startForegroundProximityWatch();
if (window.Capacitor?.isNativePlatform?.()) {
  window.Capacitor.Plugins.CorridorAlert.start().catch(() => undefined);
}