const demoCorridors = [
  { id: "01", name: "Polk County approach", species: "Animal-related crashes", detail: "Iowa roads / Des Moines area", risk: "Elevated", confidence: 94, detections: 12 },
  { id: "02", name: "Dallas County corridor", species: "Animal-related crashes", detail: "Iowa roads / Dallas County", risk: "Elevated", confidence: 88, detections: 8 },
  { id: "03", name: "Warren County passage", species: "Animal-related crashes", detail: "Iowa roads / Warren County", risk: "Monitored", confidence: 76, detections: 4 }
];
const REMOTE_FEED_URL = "data/corridors.json";
const corridorList = document.querySelector("#corridorList");
const toast = document.querySelector("#toast");
const riskAreas = [
  { id: "US-01", name: "Yellowstone gateway", state: "WY / MT", road: "US-191 + US-20", animals: "Elk, deer", lat: 44.995, lng: -110.743, collisions: 312, risk: "Very high" },
  { id: "US-02", name: "Jackson Hole approach", state: "WY", road: "US-89 + US-26", animals: "Mule deer, moose", lat: 43.479, lng: -110.762, collisions: 286, risk: "Very high" },
  { id: "US-03", name: "Front Range foothills", state: "CO", road: "US-285", animals: "Mule deer, elk", lat: 39.410, lng: -105.650, collisions: 264, risk: "High" },
  { id: "US-04", name: "Sierra foothill crossing", state: "CA", road: "CA-49", animals: "Black bear, deer", lat: 38.750, lng: -120.710, collisions: 238, risk: "High" },
  { id: "US-05", name: "North Cascades passage", state: "WA", road: "US-2", animals: "Deer, black bear", lat: 47.755, lng: -121.090, collisions: 221, risk: "High" },
  { id: "US-06", name: "Green Mountain corridor", state: "VT", road: "VT-100", animals: "Moose, deer", lat: 44.020, lng: -72.750, collisions: 207, risk: "High" },
  { id: "US-07", name: "Blue Ridge crossing", state: "NC / VA", road: "US-441", animals: "Black bear, deer", lat: 35.570, lng: -83.480, collisions: 193, risk: "High" },
  { id: "US-08", name: "Upper Peninsula passage", state: "MI", road: "US-2", animals: "Deer, moose", lat: 46.410, lng: -86.800, collisions: 181, risk: "High" }
];
let googleMap;
let googleMarkers = [];
let googleCircles = [];
let latestEvents = [];
let riskMarkers = [];
let riskCircles = [];
let currentLocationCoordinates;
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
      streetViewControl: false, fullscreenControl: false, clickableIcons: false
    });
    document.querySelector("#mapCanvas").classList.add("google-map-ready");
    renderGoogleEvents(latestEvents);
    renderRiskAreas(riskAreas);
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
    marker.addListener("click", () => updateDriverMessage(event.species || "Animal-related wildlife", "Historical Iowa crash pattern"));
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
  showToast("Driver message preview updated");
}

function renderRiskAreas(areas) {
  if (!googleMap || !window.google) return;
  riskMarkers.forEach((marker) => marker.setMap(null));
  riskCircles.forEach((circle) => circle.setMap(null));
  areas.forEach((area) => {
    const position = { lat: area.lat, lng: area.lng };
    const marker = new google.maps.Marker({ position, map: googleMap, title: `${area.name}: ${area.risk} collision risk`, label: "P" });
    marker.addListener("click", () => updateDriverMessage("animal-related crash", `${area.name} / ${area.state}`));
    riskMarkers.push(marker);
    riskCircles.push(new google.maps.Circle({ map: googleMap, center: position, radius: 9000, fillColor: "#f0b84b", fillOpacity: .1, strokeColor: "#f0b84b", strokeOpacity: .55, strokeWeight: 1 }));
  });
}

function showApproachPopup(area) {
  const popup = document.querySelector("#approachPopup");
  popup.querySelector("#popupMessage").textContent = `${area.name} on ${area.road}. ${area.animals} activity is historically elevated here.`;
  popup.classList.add("visible");
  window.setTimeout(() => popup.classList.remove("visible"), 8000);
}

function simulateDriverMessage(name, road, animals, source) {
  document.querySelector("#mapTitle").textContent = name;
  document.querySelector("#archiveSource").textContent = source;
  document.querySelector("#alertTitle").textContent = "Pause for Paws";
  document.querySelector("#alertMessage").textContent = `${animals} activity has been recorded on ${road}. Slow down and watch both shoulders. This is a historical warning, not a live animal location.`;
  document.querySelector("#alertSpecies").textContent = `${animals} pattern`;
  showApproachPopup({ name, road, animals });
}

function renderRiskList(areas) {
  document.querySelector("#riskList").innerHTML = areas.length ? areas.map((area) => `
    <article class="risk-row"><div class="risk-rank">${area.id.replace("US-", "")}</div><div><strong>${area.name}</strong><span>${area.state} · ${area.road}</span></div><div class="risk-animals">${area.animals}</div><div class="risk-score"><b>${area.collisions}</b><span>index events</span></div><button class="simulate-button" data-area="${area.id}">Simulate approach <span>→</span></button></article>`).join("") : `<p class="empty-state">No areas match that search.</p>`;
  document.querySelectorAll(".simulate-button").forEach((button) => button.addEventListener("click", () => showApproachPopup(riskAreas.find((area) => area.id === button.dataset.area))));
  renderRiskAreas(areas);
}

function applyBackendAnalysis(analysis, payload, sourceLabel) {
  const averageConfidence = analysis?.confidence || Math.round(payload.reduce((sum, item) => sum + (Number(item.confidence) || .5), 0) / payload.length * 100);
  const species = [...new Set(payload.map((item) => item.species).filter(Boolean))].join(" + ") || "Wildlife";
  document.querySelector("#confidenceValue").innerHTML = `${averageConfidence}<small>%</small>`;
  document.querySelector("#signalsCount").textContent = String(27 + payload.length);
  document.querySelector("#alertSpecies").textContent = `${species} movement`;
  document.querySelector("#archiveSource").textContent = sourceLabel;
  document.querySelector("#feedUpdated").textContent = remoteFeedState.updatedAt ? `Updated ${formatFeedDate(remoteFeedState.updatedAt)}` : sourceLabel;
  renderGoogleEvents(payload);
  if (analysis?.clusters) renderCorridors(analysis.clusters.slice().sort((first, second) => second.events - first.events).slice(0, 60).map((cluster) => ({ id: cluster.id, name: `Historical cluster ${cluster.id}`, species: cluster.species, detail: `${cluster.events} events / ${cluster.center.lat.toFixed(3)}, ${cluster.center.lng.toFixed(3)}`, risk: cluster.risk, confidence: cluster.confidence })));
}

function formatFeedDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "date unavailable" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

async function loadRemoteHistoricalFeed() {
  const status = document.querySelector("#formStatus");
  try {
    const response = await fetch(`${REMOTE_FEED_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Remote feed returned ${response.status}`);
    const feed = await response.json();
    if (!feed.updatedAt || !Array.isArray(feed.events) || !feed.events.length) throw new Error("Remote feed has no historical events");
    if (feed.expiresAt && new Date(feed.expiresAt) <= new Date()) throw new Error("Remote feed has expired");
    const payload = validateFeed(feed.events);
    remoteFeedState = { updatedAt: feed.updatedAt, expiresAt: feed.expiresAt, source: feed.source || "Remote historical feed" };
    document.querySelector("#feedInput").value = payload.slice(0, 20).map((item) => `${item.id || "event"},${item.lat},${item.lng},${item.species || "Wildlife"},${item.confidence || .5},${item.reportedAt || ""}`).join("\n");
    applyBackendAnalysis(null, payload, remoteFeedState.source);
    status.textContent = `${payload.length} historical events loaded`;
    status.className = "form-status success";
    showToast(`Historical data refreshed: ${formatFeedDate(feed.updatedAt)}`);
  } catch (error) {
    remoteFeedState = { updatedAt: null, expiresAt: null, source: "Bundled fallback" };
    try {
      const fallbackResponse = await fetch("/waze-archive-test-data.csv");
      const fallbackPayload = validateFeed(parseArchive(await fallbackResponse.text()));
      applyBackendAnalysis(null, fallbackPayload, "Bundled fallback archive");
      status.textContent = `Using bundled fallback: ${fallbackPayload.length} events`;
      status.className = "form-status error";
      document.querySelector("#feedUpdated").textContent = "Offline fallback";
    } catch (fallbackError) {
      status.textContent = `No historical feed available: ${fallbackError.message}`;
      status.className = "form-status error";
    }
  }
}

function renderCorridors(corridors = demoCorridors) {
  corridorList.innerHTML = corridors.map((corridor) => `
    <div class="corridor-row">
      <span class="row-id">${corridor.id}</span>
      <span class="row-name">${corridor.name}</span>
      <span class="row-species">${corridor.species}</span>
      <span class="risk-pill ${corridor.risk === "Monitored" ? "low-risk" : ""}">${corridor.risk}</span>
      <span class="row-arrow">↗</span>
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

document.querySelector("#feedForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#formStatus");
  try {
    const rawArchive = document.querySelector("#feedInput").value;
    const payload = validateFeed(parseArchive(rawArchive));
    const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "text/csv" }, body: rawArchive });
    const analysis = response.ok ? await response.json() : null;
    if (analysis?.error) throw new Error(analysis.error);
    applyBackendAnalysis(analysis, payload, "Custom archive");
    status.textContent = `${payload.length} events analyzed by backend`;
    status.className = "form-status success";
    showToast(`Backend analyzed ${payload.length} historical events`);
  } catch (error) {
    status.textContent = error.message;
    status.className = "form-status error";
  }
});

document.querySelector("#previewButton").addEventListener("click", () => {
  showToast("Historical risk message previewed");
  document.querySelector("#alertCard").animate([{ transform: "translateY(0)" }, { transform: "translateY(-4px)" }, { transform: "translateY(0)" }], { duration: 350 });
});

let backgroundAlertsActive = false;
document.querySelector("#backgroundAlertButton").addEventListener("click", async () => {
  if (!window.Capacitor?.isNativePlatform?.()) { showToast("Background alerts are available in the Android app"); return; }
  const button = document.querySelector("#backgroundAlertButton");
  try {
    const corridorAlert = window.Capacitor.Plugins.CorridorAlert;
    const result = backgroundAlertsActive ? await corridorAlert.stop() : await corridorAlert.start();
    backgroundAlertsActive = result.running;
    button.textContent = backgroundAlertsActive ? "Disable background alerts" : "Enable background alerts (Android app)";
    showToast(backgroundAlertsActive ? "Background corridor alerts enabled" : "Background corridor alerts disabled");
  } catch (error) {
    showToast(error.message || "Could not toggle background alerts");
  }
});

document.querySelector("#feedButton").addEventListener("click", () => document.querySelector("#feedSection").scrollIntoView({ behavior: "smooth" }));
document.querySelector("#loadIowaButton").addEventListener("click", async () => {
  const status = document.querySelector("#formStatus");
  try {
    const response = await fetch("/api/icat-2025");
    const analysis = await response.json();
    if (!response.ok || analysis.error) throw new Error(analysis.error || "Could not load ICAT data.");
    const payload = validateFeed(analysis.raw);
    document.querySelector("#feedInput").value = payload.slice(0, 20).map((item) => `${item.id},${item.lat},${item.lng},${item.species},${item.confidence},${item.reportedAt}`).join("\n");
    applyBackendAnalysis(analysis, payload, "Iowa DOT ICAT 2025");
    status.textContent = `${analysis.events.toLocaleString()} ICAT records analyzed by backend`;
    status.className = "form-status success";
    showToast(`Loaded ${analysis.events.toLocaleString()} Iowa ICAT records`);
  } catch (error) {
    status.textContent = error.message;
    status.className = "form-status error";
  }
});
document.querySelector("#loadMetroButton").addEventListener("click", async () => {
  const status = document.querySelector("#formStatus");
  try {
    const response = await fetch("/api/icat-2025-des-moines");
    const analysis = await response.json();
    if (!response.ok || analysis.error) throw new Error(analysis.error || "Could not load Des Moines data.");
    const payload = validateFeed(analysis.raw);
    document.querySelector("#feedInput").value = payload.slice(0, 20).map((item) => `${item.id},${item.lat},${item.lng},${item.species},${item.confidence},${item.reportedAt}`).join("\n");
    applyBackendAnalysis(analysis, payload.slice(0, 150), "Iowa DOT ICAT 2025 / Des Moines area");
    document.querySelector("#mapTitle").textContent = "Des Moines area / 2025";
    updateDriverMessage("animal-related crash", "Des Moines area / 2025");
    status.textContent = `${analysis.events.toLocaleString()} Des Moines-area records analyzed`;
    status.className = "form-status success";
    showToast(`Loaded ${analysis.events.toLocaleString()} Des Moines-area records`);
  } catch (error) {
    status.textContent = error.message;
    status.className = "form-status error";
  }
});
document.querySelector("#simulateIowaButton").addEventListener("click", () => simulateDriverMessage("Iowa statewide / 2025", "Iowa roads", "Animal-related crash", "Iowa DOT ICAT 2025"));
document.querySelector("#simulateDesMoinesButton").addEventListener("click", () => simulateDriverMessage("Des Moines area / 2025", "US-65 / Polk County", "Animal-related crash", "Iowa DOT ICAT 2025 / Des Moines area"));
document.querySelector("#allCorridors").addEventListener("click", () => showToast("Showing the 3 corridors in this field view"));
document.querySelector("#riskSearch").addEventListener("input", (event) => {
  const query = event.target.value.toLowerCase();
  renderRiskList(riskAreas.filter((area) => `${area.name} ${area.state} ${area.road} ${area.animals}`.toLowerCase().includes(query)));
});
document.querySelector("#approachButton").addEventListener("click", () => {
  if (!navigator.geolocation) { showToast("Location is not available in this browser"); return; }
  navigator.geolocation.watchPosition((position) => {
    const nearest = riskAreas.map((area) => ({ area, distance: distanceMiles(position.coords.latitude, position.coords.longitude, area.lat, area.lng) })).sort((first, second) => first.distance - second.distance)[0];
    if (nearest.distance <= 5) showApproachPopup(nearest.area);
  }, () => showToast("Location permission is needed for approach alerts"));
  showToast("Approach alerts enabled for this browser");
});
document.querySelector("#closePopup").addEventListener("click", () => document.querySelector("#approachPopup").classList.remove("visible"));
document.querySelector("#refreshFeedButton").addEventListener("click", loadRemoteHistoricalFeed);
function distanceMiles(latOne, lngOne, latTwo, lngTwo) { const radians = Math.PI / 180; const latitude = (latTwo - latOne) * radians; const longitude = (lngTwo - lngOne) * radians; const value = Math.sin(latitude / 2) ** 2 + Math.cos(latOne * radians) * Math.cos(latTwo * radians) * Math.sin(longitude / 2) ** 2; return 3958.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value)); }
let zoom = 1;
let currentLocationMarker;
function showCurrentLocation(isInitialLoad = false) {
  if (!navigator.geolocation) { showToast("Location is not available on this device"); return; }
  navigator.geolocation.getCurrentPosition((position) => {
    currentLocationCoordinates = { lat: position.coords.latitude, lng: position.coords.longitude };
    centerMapOnCurrentLocation();
    if (!isInitialLoad) showToast("Map centered on your current location");
  }, () => { if (!isInitialLoad) showToast("Location permission is needed to center the map"); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
}
document.querySelector("#locateMe").addEventListener("click", showCurrentLocation);
document.querySelector("#zoomIn").addEventListener("click", () => { zoom = Math.min(1.25, zoom + .05); document.querySelector("#mapCanvas").style.transform = `scale(${zoom})`; });
document.querySelector("#zoomOut").addEventListener("click", () => { zoom = Math.max(1, zoom - .05); document.querySelector("#mapCanvas").style.transform = `scale(${zoom})`; });

document.querySelectorAll(".corridor").forEach((marker) => marker.addEventListener("click", () => {
  const names = { canyon: "Gardiner gateway", elk: "Blacktail plateau", madison: "Madison bend" };
  document.querySelector("#alertTitle").textContent = `${names[marker.dataset.corridor]} pattern`;
  showToast(`${names[marker.dataset.corridor]} selected`);
}));
renderCorridors();
loadGoogleMap();
renderRiskList(riskAreas);
loadRemoteHistoricalFeed();
