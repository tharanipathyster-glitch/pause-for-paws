/* Pause for Paws — static front end.
   Reads corridors.json, which precompute_corridors.py builds from the Iowa DOT
   Crash Data service (this year so far + last year). No backend required. */

let ALL = null;       // whole corridors.json
let DATA = null;      // ALL.years[year] currently shown
let year = null;
let view = "statewide";
let selectedMonth = new Date().getMonth(); // 0-11, defaults to the current calendar month
let googleMap = null;
let mapShapes = [];

const $ = (sel) => document.querySelector(sel);
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 3000);
}

function currentCorridors() {
  if (!DATA) return [];
  return view === "metro" ? DATA.desMoines.corridors : DATA.corridors;
}

function formatDate(mmdd) {
  const [m, d] = mmdd.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

function formatIsoDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return y && m && d ? `${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}` : iso;
}

/* "2026 so far" / "2025" — used wherever the page names the period. */
function periodLabel() {
  return DATA.partial ? `${DATA.year} so far` : String(DATA.year);
}

/* The comparison year: the other year in the file (2025 when showing 2026, and vice versa). */
function otherYearData() {
  const other = Object.keys(ALL.years).map(Number).find((y) => y !== year);
  return other ? ALL.years[other] : null;
}

/* Two series for the charts, oldest first: [{label, data, primary}] */
function chartSeries(pick) {
  const list = [DATA, otherYearData()].filter(Boolean)
    .sort((a, b) => a.year - b.year)
    .map((d) => ({ year: d.year, partial: d.partial, through: d.through, primary: d === DATA, data: pick(d) }));
  return list;
}

function legendHtml(series) {
  return series.map((s) => `<span class="legend-item${s.primary ? " primary" : ""}"><b></b>${s.year}${s.partial ? " so far" : ""}</span>`).join("");
}

function pctChange(now, before) {
  if (!before) return "";
  const change = Math.round(((now - before) / before) * 100);
  return Math.abs(change) < 3 ? "about the same" : change > 0 ? `up ${change}%` : `down ${Math.abs(change)}%`;
}

/* Last month that has any data: for a partial year, the month of the latest crash. */
function lastDataMonth() {
  return DATA.partial && DATA.through ? Number(DATA.through.split("-")[1]) - 1 : 11;
}

/* ---------- header date (today, refreshed at midnight) ---------- */

function renderTodayStamp() {
  const now = new Date();
  $("#updatedStamp").textContent = now.toLocaleDateString("en-US",
    { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  window.setTimeout(renderTodayStamp, midnight - now + 1000);
}
renderTodayStamp();

/* ---------- year switch ---------- */

function renderYearSwitch() {
  const years = Object.keys(ALL.years).map(Number).sort((a, b) => b - a);
  $("#yearSwitch").innerHTML = years.map((y) => {
    const d = ALL.years[y];
    return `<button class="year-pill${y === year ? " active" : ""}" data-year="${y}" aria-pressed="${y === year}">
      ${y}${d.partial ? " so far" : ""}</button>`;
  }).join("");
  $("#yearSwitch").querySelectorAll(".year-pill").forEach((button) => {
    button.addEventListener("click", () => setYear(Number(button.dataset.year)));
  });
}

function setYear(next) {
  year = next;
  DATA = ALL.years[year];
  if (selectedMonth > lastDataMonth()) selectedMonth = lastDataMonth();
  renderYearSwitch();
  renderStats();
  renderMonthChart();
  renderMonthPicker();
  renderDayChart();
  renderWeekdayStrip();
  document.querySelectorAll(".period-label").forEach((el) => { el.textContent = periodLabel(); });
  setView(view);
}

/* ---------- header numbers ---------- */

function renderStats() {
  $("#dataStamp").textContent = `Iowa DOT crash records, ${periodLabel()}`;
  $("#mapKicker").textContent = `Iowa DOT crash records / ${periodLabel()}`;
  $("#statCrashesLabel").textContent = `Crashes in ${periodLabel()}`;
  $("#statCrashes").textContent = DATA.totalCrashes.toLocaleString();
  $("#statCrashesNote").textContent = DATA.partial && DATA.through
    ? `animal-related, statewide, through ${formatIsoDate(DATA.through)}`
    : "animal-related, statewide";
  $("#statInjury").textContent = DATA.injuryOrWorse.toLocaleString();
  $("#statInjuryNote").textContent = DATA.fatal
    ? `includes ${DATA.fatal} death${DATA.fatal === 1 ? "" : "s"}`
    : (DATA.partial ? "no deaths recorded so far" : "no deaths recorded");

  const peak = DATA.monthly.reduce((best, m) => (m.crashes > best.crashes ? m : best));
  const yearTotal = DATA.monthly.reduce((sum, m) => sum + m.crashes, 0);
  $("#statMonthLabel").textContent = DATA.partial ? "Worst month so far" : "Worst month";
  $("#statMonth").textContent = peak.month;
  $("#statMonthNote").textContent =
    `${peak.crashes.toLocaleString()} crashes, ${Math.round((peak.crashes / yearTotal) * 100)}% of ${periodLabel()}`;
}

/* ---------- month chart ---------- */

function renderMonthChart() {
  const last = lastDataMonth();
  const series = chartSeries((d) => d.monthly.map((m) => m.crashes));
  const peakAll = Math.max(...series.flatMap((s) => s.data), 1);
  const primaryPeak = Math.max(...DATA.monthly.map((m) => m.crashes));
  const peakIdx = DATA.monthly.findIndex((m) => m.crashes === primaryPeak);
  const peakName = MONTHS[peakIdx];
  const other = otherYearData();

  $("#monthHeading").textContent = DATA.partial ? `${peakName} leads so far.` : `${peakName} is not close.`;
  $("#monthCaption").textContent = `crashes per month, ${series.map((s) => s.year).join(" vs ")}`;
  $("#monthLegend").innerHTML = legendHtml(series);

  $("#monthChart").innerHTML = MONTHS.map((name, i) => {
    const bars = series.map((s) => {
      const n = s.data[i];
      const noData = s.partial && i > (s.through ? Number(s.through.split("-")[1]) - 1 : 11);
      const inProgress = s.partial && s.through && i === Number(s.through.split("-")[1]) - 1;
      const cls = (s.primary ? " primary" : " secondary") + (s.primary && i === peakIdx ? " peak" : "") + (inProgress ? " partial" : "") + (noData ? " none" : "");
      return `<div class="month-bar${cls}" style="height:${noData ? 0 : Math.max(Math.round((n / peakAll) * 100), 2)}%"></div>`;
    });
    const values = series.map((s) => {
      const noData = s.partial && i > (s.through ? Number(s.through.split("-")[1]) - 1 : 11);
      return `<i class="${s.primary ? "primary" : "secondary"}">${noData ? "\u2013" : s.data[i].toLocaleString()}</i>`;
    });
    const tip = series.map((s) => `${s.year}: ${s.data[i]}`).join(" / ");
    const future = DATA.partial && i > last;
    return `<div class="month-col${i === peakIdx ? " peak" : ""}${future ? " future" : ""}" title="${name}. ${tip}">
      <span class="month-value">${values.join("")}</span>
      <div class="bar-wrap">${bars.join("")}</div>
      <span class="month-label">${name.slice(0, 3)}</span>
    </div>`;
  }).join("");

  const worst = DATA.topDates[0];
  const peakMM = String(peakIdx + 1).padStart(2, "0");
  const inPeak = DATA.topDates.filter((d) => d.date.startsWith(peakMM)).length;
  let compare = "";
  if (other) {
    const otherPeak = other.monthly[peakIdx].crashes;
    compare = ` ${peakName} ${other.year} had ${otherPeak.toLocaleString()} (${pctChange(primaryPeak, otherPeak) || "no comparison"} in ${DATA.year}).`;
    if (DATA.partial && DATA.through) {
      const mmdd = DATA.through.slice(5);
      const sameSpan = other.daily.reduce((sum, days, m) => sum + days.reduce((s2, n, d) => {
        const key = `${String(m + 1).padStart(2, "0")}-${String(d + 1).padStart(2, "0")}`;
        return key <= mmdd ? s2 + n : s2;
      }, 0), 0);
      compare += ` Year to date: ${DATA.totalCrashes.toLocaleString()} crashes in ${DATA.year} vs ${sameSpan.toLocaleString()} by ${formatIsoDate(`${other.year}-${mmdd}`)} (${pctChange(DATA.totalCrashes, sameSpan)}).`;
    }
  }
  $("#monthNote").textContent =
    `${inPeak} of the 10 worst individual days in ${periodLabel()} were in ${peakName}. The worst single day was ` +
    `${formatDate(worst.date)}, with ${worst.crashes} crashes in 24 hours.` + compare +
    (DATA.partial && DATA.through ? ` ${MONTHS[last]} ${DATA.year} is still in progress: data runs through ${formatIsoDate(DATA.through)}.` : "");
}

/* ---------- day-by-day chart for one month ---------- */

function renderMonthPicker() {
  const last = lastDataMonth();
  $("#monthPicker").innerHTML = DATA.monthly.map((m, i) =>
    `<button class="month-pill${i === selectedMonth ? " active" : ""}${i > last ? " ahead" : ""}" data-month="${i}" role="tab"
      aria-selected="${i === selectedMonth}">${m.month}</button>`
  ).join("");
  $("#monthPicker").querySelectorAll(".month-pill").forEach((button) => {
    button.addEventListener("click", () => {
      selectedMonth = Number(button.dataset.month);
      renderMonthPicker();
      renderDayChart();
    });
  });
}

function renderDayChart() {
  const now = new Date();
  const isCurrentMonth = selectedMonth === now.getMonth() && year === now.getFullYear();
  const series = chartSeries((d) => d.daily[selectedMonth] || []);
  const other = otherYearData();

  // For a partial year, days after the latest crash date have no data yet.
  const cutoff = (s) => {
    if (!s.partial || !s.through) return Infinity;
    const [, mm, dd] = s.through.split("-").map(Number);
    return selectedMonth < mm - 1 ? Infinity : selectedMonth === mm - 1 ? dd : 0;
  };
  const daysInMonth = Math.max(...series.map((s) => s.data.length));
  const peakAll = Math.max(...series.flatMap((s) => s.data.slice(0, cutoff(s))), 1);
  const primary = series.find((s) => s.primary);
  const primaryDays = primary.data.slice(0, cutoff(primary));
  const primaryTotal = primaryDays.reduce((a, b) => a + b, 0);
  const primaryPeak = Math.max(...primaryDays, 0);
  const primaryCut = cutoff(primary);

  $("#dayKicker").textContent = isCurrentMonth ? "This month, day by day" : "One month, day by day";
  $("#dayTitle").textContent = `${MONTHS[selectedMonth]}, ${series.map((s) => s.year).join(" vs ")}`;
  $("#dayTotal").textContent = series.map((s) => {
    const days = s.data.slice(0, cutoff(s));
    const total = days.reduce((a, b) => a + b, 0);
    return `${s.year}: ${total.toLocaleString()}${days.length && days.length < s.data.length ? ` (to the ${days.length}${ordinal(days.length)})` : ""}`;
  }).join(" / ");
  $("#dayLegend").innerHTML = legendHtml(series);

  $("#dayChart").innerHTML = Array.from({ length: daysInMonth }, (_, i) => {
    const bars = series.map((s) => {
      const n = s.data[i] || 0;
      const noData = i >= cutoff(s) || i >= s.data.length;
      const cls = (s.primary ? " primary" : " secondary") + (s.primary && n === primaryPeak && primaryPeak > 0 && !noData ? " peak" : "") + (noData ? " none" : "");
      return `<div class="day-bar${cls}" style="height:${noData ? 0 : Math.max(Math.round((n / peakAll) * 100), 2)}%"></div>`;
    });
    const tip = series.map((s) => `${s.year}: ${i >= cutoff(s) ? "no data yet" : s.data[i] || 0}`).join(" / ");
    const future = i >= primaryCut;
    return `<div class="day-col${future ? " future" : ""}" title="${MONTHS[selectedMonth]} ${i + 1}. ${tip}">
      <span class="day-value">${future ? "" : (primary.data[i] || 0)}</span>
      <div class="bar-wrap">${bars.join("")}</div>
      <span class="day-label">${i + 1}</span>
    </div>`;
  }).join("");

  let note;
  if (primaryDays.length === 0) {
    note = `No ${DATA.year} data for ${MONTHS[selectedMonth]} yet.`;
  } else {
    const worstDay = primaryDays.indexOf(primaryPeak) + 1;
    const quietDays = primaryDays.filter((n) => n === 0).length;
    note = (primaryCut < primary.data.length
      ? `${MONTHS[selectedMonth]} ${DATA.year} has had ${primaryTotal.toLocaleString()} animal-related crashes so far (data through ${formatIsoDate(DATA.through)}). `
      : `${MONTHS[selectedMonth]} ${DATA.year} had ${primaryTotal.toLocaleString()} animal-related crashes, ${Math.round((primaryTotal / DATA.totalCrashes) * 100)}% of ${periodLabel()}. `) +
      `The worst day was ${MONTHS[selectedMonth]} ${worstDay} with ${primaryPeak}. ` +
      (quietDays ? `${quietDays} day${quietDays === 1 ? "" : "s"} had none. ` : `Every day had at least one. `);
  }
  if (other) {
    const otherSeries = series.find((s) => !s.primary);
    const otherAll = otherSeries.data.reduce((a, b) => a + b, 0);
    const otherSame = otherSeries.data.slice(0, Math.min(primaryDays.length, cutoff(otherSeries))).reduce((a, b) => a + b, 0);
    if (primaryDays.length && primaryDays.length < primary.data.length) {
      note += `Same days in ${other.year}: ${otherSame.toLocaleString()} (${DATA.year} is ${pctChange(primaryTotal, otherSame) || "level"}); all of ${MONTHS[selectedMonth]} ${other.year}: ${otherAll.toLocaleString()}.`;
    } else if (primaryDays.length) {
      note += `${MONTHS[selectedMonth]} ${other.year}: ${otherAll.toLocaleString()} (${DATA.year} is ${pctChange(primaryTotal, otherAll) || "level"}).`;
    } else {
      note += `${MONTHS[selectedMonth]} ${other.year} had ${otherAll.toLocaleString()}.`;
    }
  }
  $("#dayNote").textContent = note;
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function renderWeekdayStrip() {
  const peak = Math.max(...DATA.weekday.map((d) => d.crashes));
  $("#weekdayStrip").innerHTML = DATA.weekday.map((d) => `
    <div class="weekday${d.crashes === peak ? " peak" : ""}">
      <span class="kicker">${d.day}</span>
      <strong>${d.crashes.toLocaleString()}</strong>
      <div class="weekday-bar"><div style="width:${Math.round((d.crashes / peak) * 100)}%"></div></div>
    </div>`).join("");
  const worst = DATA.weekday.find((d) => d.crashes === peak);
  const best = DATA.weekday.reduce((a, b) => (b.crashes < a.crashes ? b : a));
  $("#weekdayNote").textContent =
    `Across ${periodLabel()}, ${worst.day} is the worst day of the week (${worst.crashes.toLocaleString()} crashes) and ${best.day} the quietest (${best.crashes.toLocaleString()}).`;
}

/* ---------- corridor table ---------- */

const LIST_LIMIT = 10;

function renderCorridorList(list, label) {
  const rows = list.slice(0, LIST_LIMIT);
  $("#corridorCount").textContent = label || `${list.length.toLocaleString()} corridors`;
  $("#corridorList").innerHTML = rows.length ? rows.map((c, i) => `
    <article class="risk-row" data-id="${c.id}">
      <div class="risk-rank">${i + 1}</div>
      <div><strong>${c.id}</strong><span>${c.distanceMi != null ? `${c.distanceMi.toFixed(1)} mi away / ` : ""}${c.lat.toFixed(3)}, ${c.lng.toFixed(3)}</span></div>
      <div class="risk-animals">${c.risk}<span class="risk-trend">${trendTag(c)}</span></div>
      <div class="risk-score"><b>${c.crashes}</b><span>crashes in ${periodLabel()}</span></div>
      <button class="simulate-button" data-id="${c.id}">Show driver message <span>→</span></button>
    </article>`).join("") : `<p class="empty-state">No corridors match that search.</p>`;

  $("#corridorList").querySelectorAll(".simulate-button").forEach((button) => {
    button.addEventListener("click", () => {
      const corridor = currentCorridors().find((c) => c.id === button.dataset.id);
      if (corridor) selectCorridor(corridor, true);
    });
  });

  if (rows.length < list.length && !label) {
    $("#corridorList").insertAdjacentHTML("beforeend",
      `<p class="empty-state">Showing the ${LIST_LIMIT} worst of ${list.length.toLocaleString()} corridors. Enter a ZIP code to see the ones near you.</p>`);
  }
}

/* ---------- ZIP code search ---------- */

let ZIPS = null; // { "50263": [lat, lng], ... } Iowa ZCTA centroids from the US Census gazetteer

function distanceMiles(aLat, aLng, bLat, bLng) {
  const r = Math.PI / 180;
  const dLat = (bLat - aLat) * r, dLng = (bLng - aLng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function renderNearest(lat, lng, label) {
  const nearest = currentCorridors()
    .map((c) => ({ ...c, distanceMi: distanceMiles(lat, lng, c.lat, c.lng) }))
    .sort((a, b) => a.distanceMi - b.distanceMi);
  renderCorridorList(nearest, label);
  if (googleMap) {
    googleMap.panTo({ lat, lng });
    googleMap.setZoom(10);
  }
}

function searchByZip(zip) {
  const centre = ZIPS && ZIPS[zip];
  if (!centre) {
    $("#corridorCount").textContent = ZIPS ? "ZIP not found" : "loading ZIP codes";
    $("#corridorList").innerHTML = `<p class="empty-state">${ZIPS ? `${zip} is not an Iowa ZIP code we know. Try another, or search by corridor ID.` : "One moment..."}</p>`;
    return;
  }
  renderNearest(centre[0], centre[1], `10 nearest to ${zip}`);
}

/* ---------- "Near me": phone location, nearest corridors, approach popups ---------- */

const APPROACH_RADIUS_MILES = 2;
const APPROACH_COOLDOWN_MS = 10 * 60 * 1000;
let userMarker = null;
let proximityWatchId = null;
const lastApproachAt = {};

function placeUserMarker(lat, lng) {
  if (!googleMap || !window.google) return;
  if (!userMarker) {
    userMarker = new google.maps.Marker({ map: googleMap, title: "You are here", label: { text: "You", fontSize: "10px" } });
  }
  userMarker.setPosition({ lat, lng });
}

function nearMe() {
  if (!navigator.geolocation) { showToast("Location is not available on this device."); return; }
  $("#nearMe").disabled = true;
  navigator.geolocation.getCurrentPosition((position) => {
    $("#nearMe").disabled = false;
    const { latitude: lat, longitude: lng } = position.coords;
    $("#corridorSearch").value = "";
    placeUserMarker(lat, lng);
    renderNearest(lat, lng, "10 nearest to you");
    startProximityWatch();
  }, () => {
    $("#nearMe").disabled = false;
    showToast("Could not get your location. Check location permission and try again.");
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
}

function showApproachPopup(corridor) {
  $("#popupMessage").textContent =
    `${corridor.crashes} animal-related crashes on this stretch in ${periodLabel()}` +
    (corridor.compare && corridor.compare.crashes ? `, ${corridor.compare.crashes} in ${corridor.compare.year}` : "") +
    `. Slow down and watch both shoulders.`;
  const popup = $("#approachPopup");
  popup.classList.add("visible");
  window.setTimeout(() => popup.classList.remove("visible"), 8000);
}

/* Watches the phone's position and pops a warning when it comes within 2 miles of a busy corridor. */
function startProximityWatch() {
  if (proximityWatchId != null || !navigator.geolocation) return;
  proximityWatchId = navigator.geolocation.watchPosition((position) => {
    const { latitude, longitude } = position.coords;
    placeUserMarker(latitude, longitude);
    const zones = (DATA && DATA.corridors ? DATA.corridors : []).filter((c) => c.crashes >= 5);
    for (const corridor of zones) {
      if (distanceMiles(latitude, longitude, corridor.lat, corridor.lng) > APPROACH_RADIUS_MILES) continue;
      const now = Date.now();
      if (lastApproachAt[corridor.id] && now - lastApproachAt[corridor.id] < APPROACH_COOLDOWN_MS) continue;
      lastApproachAt[corridor.id] = now;
      selectCorridor(corridor, false);
      showApproachPopup(corridor);
    }
  }, () => undefined, { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 });
}

function runSearch(raw) {
  const query = raw.trim().toLowerCase();
  if (!query) { renderCorridorList(currentCorridors()); return; }
  if (/^\d{5}$/.test(query)) { searchByZip(query); return; }
  renderCorridorList(currentCorridors().filter((c) => c.id.toLowerCase().includes(query)));
}

/* One sentence comparing this year with last year on the same stretch of road. */
function trendSentence(corridor) {
  const cmp = corridor.compare;
  if (!cmp) return "";
  const hurt = (n) => (n ? ` (${n} hurt someone)` : "");
  if (DATA.partial) {
    // Showing the current year: compare with the same period last year, then the full year.
    let pace = "";
    if (cmp.samePeriod != null && cmp.samePeriod > 0) {
      const change = Math.round(((corridor.crashes - cmp.samePeriod) / cmp.samePeriod) * 100);
      pace = Math.abs(change) < 10 ? "about the same pace as last year"
        : change > 0 ? `up ${change}% on last year` : `down ${Math.abs(change)}% on last year`;
    } else if (cmp.samePeriod === 0) {
      pace = "none by this date last year";
    }
    return ` By this date in ${cmp.year} it had ${cmp.samePeriod ?? "no"} ${pace ? `(${pace})` : ""}` +
      `, and ${cmp.crashes} across all of ${cmp.year}${hurt(cmp.injuryOrWorse)}.`;
  }
  // Showing last year: say what this year looks like so far.
  const cur = ALL.years[cmp.year];
  return ` So far in ${cmp.year}${cur && cur.through ? ` (through ${formatIsoDate(cur.through)})` : ""} it has had ${cmp.crashes}${hurt(cmp.injuryOrWorse)}.`;
}

function trendTag(corridor) {
  const cmp = corridor.compare;
  if (!cmp) return "";
  if (DATA.partial) return cmp.samePeriod != null ? `${cmp.samePeriod} by this date in ${cmp.year}` : `${cmp.crashes} in ${cmp.year}`;
  return `${cmp.crashes} so far in ${cmp.year}`;
}

function selectCorridor(corridor, pan) {
  $("#alertTitle").textContent = "Pause for Paws";
  $("#alertMessage").textContent =
    `${corridor.crashes} animal-related crashes were recorded on this stretch of road in ${periodLabel()}` +
    (corridor.injuryOrWorse ? `, and ${corridor.injuryOrWorse} of them hurt someone` : "") +
    `.` + trendSentence(corridor) +
    ` Slow down and watch both shoulders. This is a historical pattern, not a live animal location.`;
  $("#alertSpecies").textContent = `${corridor.id} / ${corridor.risk}`;
  if (pan && googleMap) {
    googleMap.panTo({ lat: corridor.lat, lng: corridor.lng });
    googleMap.setZoom(12);
  }
  showToast(`Corridor ${corridor.id} selected`);
}

/* ---------- map ---------- */

function loadGoogleMap() {
  if (!window.GOOGLE_MAPS_API_KEY) { mapUnavailable("No map key configured."); return; }
  window.gm_authFailure = () => mapUnavailable("The map key was rejected. The table below has the same data.");
  window.initGoogleMap = () => {
    googleMap = new google.maps.Map($("#mapCanvas"), {
      center: { lat: 41.9, lng: -93.5 }, zoom: 7, mapTypeControl: false,
      streetViewControl: false, fullscreenControl: false, clickableIcons: false
    });
    $("#mapCanvas").classList.add("google-map-ready");
    drawCorridors();
    // The webview can report a zero-size container on first paint; re-frame once tiles are in.
    google.maps.event.addListenerOnce(googleMap, "tilesloaded", () => { google.maps.event.trigger(googleMap, "resize"); fitView(); });
  };
  const script = document.createElement("script");
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(window.GOOGLE_MAPS_API_KEY)}&callback=initGoogleMap&v=weekly&loading=async`;
  script.async = true;
  script.onerror = () => mapUnavailable("The map could not load. The table below has the same data.");
  document.head.appendChild(script);
}

function mapUnavailable(message) {
  const fallback = $("#mapFallback");
  if (!fallback) return;
  fallback.innerHTML = `<strong>Map unavailable</strong><span>${message}</span>`;
}

function drawCorridors() {
  if (!googleMap || !window.google || !DATA) return;
  mapShapes.forEach((shape) => shape.setMap(null));
  mapShapes = [];

  const list = currentCorridors();
  const bounds = new google.maps.LatLngBounds();

  list.forEach((corridor) => {
    const heavy = corridor.crashes >= 5;
    const circle = new google.maps.Circle({
      map: googleMap,
      center: { lat: corridor.lat, lng: corridor.lng },
      radius: 2000 + corridor.crashes * 120,
      fillColor: heavy ? "#df6e51" : "#245c43",
      fillOpacity: heavy ? 0.28 : 0.16,
      strokeColor: heavy ? "#df6e51" : "#245c43",
      strokeOpacity: 0.65,
      strokeWeight: 1,
      clickable: true,
    });
    circle.addListener("click", () => selectCorridor(corridor, false));
    mapShapes.push(circle);
    bounds.extend({ lat: corridor.lat, lng: corridor.lng });
  });

  (ALL.reports || []).forEach((report) => {
    const marker = new google.maps.Marker({
      map: googleMap,
      position: { lat: report.lat, lng: report.lng },
      title: `${report.species} reported by a driver: ${report.road}`,
      label: { text: "!", color: "#13231e", fontWeight: "700" },
    });
    marker.addListener("click", () => {
      $("#alertTitle").textContent = "Pause for Paws";
      $("#alertMessage").textContent =
        `A driver reported a ${report.species.toLowerCase()} crossing at ${report.road} on ${formatIsoDate(report.reportedOn)}. ` +
        `This is a single reviewed report, not a crash record. Slow down and watch both shoulders.`;
      $("#alertSpecies").textContent = `${report.id} / driver report`;
      showToast("Driver report selected");
    });
    mapShapes.push(marker);
  });

  fitView();
}

/* Frame the whole state (or the Des Moines area) with fixed bounds, so the view never depends on
   the map's size at draw time. Re-applied once the map has laid out, which matters in the phone webview. */
const IOWA_BOUNDS = { north: 43.55, south: 40.35, east: -90.10, west: -96.65 };
const METRO_BOUNDS = { north: 42.10, south: 41.15, east: -92.90, west: -94.55 };
let viewPending = false;
function fitView() {
  if (!googleMap || !window.google) return;
  const box = view === "metro" ? METRO_BOUNDS : IOWA_BOUNDS;
  googleMap.fitBounds(box, 24);
  if (!viewPending) {
    viewPending = true;
    google.maps.event.addListenerOnce(googleMap, "idle", () => {
      viewPending = false;
      const c = googleMap.getCenter();
      const offIowa = !c || c.lat() < IOWA_BOUNDS.south || c.lat() > IOWA_BOUNDS.north || c.lng() < IOWA_BOUNDS.west || c.lng() > IOWA_BOUNDS.east;
      if (googleMap.getZoom() < 5 || offIowa) googleMap.fitBounds(box, 24);
    });
  }
}

/* Badge and footer counts must not depend on the map loading. */
function renderMapMeta() {
  const list = currentCorridors();
  const total = list.reduce((sum, c) => sum + c.crashes, 0);
  $("#mapCount").textContent = `${total.toLocaleString()} crashes mapped`;
  $("#mapBadge").textContent = `${list.length.toLocaleString()} corridors`;
}

/* ---------- view switching ---------- */

function setView(next) {
  view = next;
  $("#mapTitle").textContent = next === "metro" ? "Des Moines area" : "Iowa, statewide";
  $("#viewStatewide").classList.toggle("active", next === "statewide");
  $("#viewMetro").classList.toggle("active", next === "metro");
  $("#corridorSearch").value = "";
  renderCorridorList(currentCorridors());
  renderMapMeta();
  drawCorridors();
}

/* ---------- boot ---------- */

$("#viewStatewide").addEventListener("click", () => setView("statewide"));
$("#viewMetro").addEventListener("click", () => setView("metro"));
$("#corridorSearch").addEventListener("input", (event) => runSearch(event.target.value));
$("#nearMe").addEventListener("click", nearMe);
$("#closePopup").addEventListener("click", () => $("#approachPopup").classList.remove("visible"));

/* Inside the phone app: start the native background alert service and use location straight away. */
const isNativeApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
if (isNativeApp) document.body.classList.add("native");
if (isNativeApp && window.Capacitor.Plugins && window.Capacitor.Plugins.CorridorAlert) {
  window.Capacitor.Plugins.CorridorAlert.start().catch(() => undefined);
}

fetch("iowa-zips.json")
  .then((response) => (response.ok ? response.json() : null))
  .then((zips) => { ZIPS = zips; if ($("#corridorSearch").value) runSearch($("#corridorSearch").value); })
  .catch(() => { ZIPS = null; });

/* Installed apps bundle corridors.json at build time, so it goes stale until
   the next reinstall. Try the live site first so the app picks up new Iowa
   data without a reinstall; fall back to the bundled copy when offline or
   unreachable. The website itself just fetches its own same-origin copy. */
async function fetchCorridorData() {
  if (isNativeApp) {
    try {
      const response = await fetch("https://pauseforpawsusa.org/corridors.json", { cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (response.ok) return response.json();
    } catch (error) { /* offline or unreachable; fall back to the bundled copy below */ }
  }
  const response = await fetch("corridors.json");
  if (!response.ok) throw new Error("corridors.json not found");
  return response.json();
}

fetchCorridorData()
  .then((data) => {
    ALL = data;
    setYear(data.defaultYear);
    loadGoogleMap();
    if (isNativeApp) nearMe();
  })
  .catch(() => {
    mapUnavailable("Corridor data did not load.");
    $("#corridorList").innerHTML = `<p class="empty-state">Corridor data did not load. Please refresh.</p>`;
  });
