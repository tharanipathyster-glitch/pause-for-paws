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
  const peak = Math.max(...DATA.monthly.map((m) => m.crashes));
  const peakName = MONTHS[DATA.monthly.findIndex((m) => m.crashes === peak)];

  $("#monthHeading").textContent = DATA.partial ? `${peakName} leads so far.` : `${peakName} is not close.`;
  $("#monthCaption").textContent = `crashes per month, ${periodLabel()}`;

  $("#monthChart").innerHTML = DATA.monthly.map((m, i) => {
    const pct = Math.round((m.crashes / peak) * 100);
    const cls = (m.crashes === peak ? " peak" : "") + (i === last && DATA.partial ? " partial" : "") + (i > last ? " future" : "");
    return `<div class="month-col${cls}" title="${MONTHS[i]}: ${m.crashes} crashes${i === last && DATA.partial ? " (month in progress)" : ""}">
      <span class="month-value">${i > last ? "" : m.crashes.toLocaleString()}</span>
      <div class="bar-wrap"><div class="month-bar" style="height:${i > last ? 0 : Math.max(pct, 3)}%"></div></div>
      <span class="month-label">${m.month}</span>
    </div>`;
  }).join("");

  const worst = DATA.topDates[0];
  const peakMM = String(DATA.monthly.findIndex((m) => m.crashes === peak) + 1).padStart(2, "0");
  const inPeak = DATA.topDates.filter((d) => d.date.startsWith(peakMM)).length;
  $("#monthNote").textContent =
    `${inPeak} of the 10 worst individual days in ${periodLabel()} were in ${peakName}. The worst single day was ` +
    `${formatDate(worst.date)}, with ${worst.crashes} crashes in 24 hours.` +
    (DATA.partial && DATA.through ? ` ${MONTHS[last]} is still in progress: data runs through ${formatIsoDate(DATA.through)}.` : "");
}

/* ---------- day-by-day chart for one month ---------- */

function renderMonthPicker() {
  const last = lastDataMonth();
  $("#monthPicker").innerHTML = DATA.monthly.map((m, i) =>
    `<button class="month-pill${i === selectedMonth ? " active" : ""}" data-month="${i}" role="tab"
      aria-selected="${i === selectedMonth}" ${i > last ? "disabled" : ""}>${m.month}</button>`
  ).join("");
  $("#monthPicker").querySelectorAll(".month-pill:not([disabled])").forEach((button) => {
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
  const inProgress = DATA.partial && selectedMonth === lastDataMonth() && DATA.through;
  const throughDay = inProgress ? Number(DATA.through.split("-")[2]) : null;
  const allDays = DATA.daily[selectedMonth] || [];
  const days = throughDay ? allDays.slice(0, throughDay) : allDays;   // ignore days that have not happened yet
  const total = days.reduce((sum, n) => sum + n, 0);
  const peak = Math.max(...days, 1);

  $("#dayKicker").textContent = isCurrentMonth ? "This month, day by day" : "One month, day by day";
  $("#dayTitle").textContent = `${MONTHS[selectedMonth]} ${year}` +
    (isCurrentMonth ? "" : (selectedMonth === now.getMonth() ? " (this month, last year)" : ""));
  $("#dayTotal").textContent = `${total.toLocaleString()} crashes / ${(total / Math.max(days.length, 1)).toFixed(1)} per day`;

  $("#dayChart").innerHTML = allDays.map((n, i) => {
    const future = throughDay && i >= throughDay;
    const pct = Math.round((n / peak) * 100);
    const cls = (n === peak && !future ? " peak" : "") + (future ? " future" : "");
    return `<div class="day-col${cls}" title="${MONTHS[selectedMonth]} ${i + 1}: ${future ? "no data yet" : `${n} crashes`}">
      <span class="day-value">${future ? "" : n}</span>
      <div class="bar-wrap"><div class="day-bar" style="height:${future ? 0 : Math.max(pct, 2)}%"></div></div>
      <span class="day-label">${i + 1}</span>
    </div>`;
  }).join("");

  const worstDay = days.indexOf(peak) + 1;
  const quietDays = days.filter((n) => n === 0).length;
  const share = Math.round((total / DATA.totalCrashes) * 100);
  $("#dayNote").textContent =
    (inProgress
      ? `${MONTHS[selectedMonth]} has had ${total.toLocaleString()} animal-related crashes so far (data through ${formatIsoDate(DATA.through)}). `
      : `${MONTHS[selectedMonth]} had ${total.toLocaleString()} animal-related crashes, ${share}% of ${periodLabel()}. `) +
    `The worst day was ${MONTHS[selectedMonth]} ${worstDay} with ${peak}. ` +
    (quietDays ? `${quietDays} day${quietDays === 1 ? "" : "s"} had none.` : `Every single day had at least one.`);
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

function searchByZip(zip) {
  const centre = ZIPS && ZIPS[zip];
  if (!centre) {
    $("#corridorCount").textContent = ZIPS ? "ZIP not found" : "loading ZIP codes";
    $("#corridorList").innerHTML = `<p class="empty-state">${ZIPS ? `${zip} is not an Iowa ZIP code we know. Try another, or search by corridor ID.` : "One moment..."}</p>`;
    return;
  }
  const [lat, lng] = centre;
  const nearest = currentCorridors()
    .map((c) => ({ ...c, distanceMi: distanceMiles(lat, lng, c.lat, c.lng) }))
    .sort((a, b) => a.distanceMi - b.distanceMi);
  renderCorridorList(nearest, `10 nearest to ${zip}`);
  if (googleMap) {
    googleMap.panTo({ lat, lng });
    googleMap.setZoom(10);
  }
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

  if (list.length) googleMap.fitBounds(bounds, 40);
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

fetch("iowa-zips.json")
  .then((response) => (response.ok ? response.json() : null))
  .then((zips) => { ZIPS = zips; if ($("#corridorSearch").value) runSearch($("#corridorSearch").value); })
  .catch(() => { ZIPS = null; });

fetch("corridors.json")
  .then((response) => {
    if (!response.ok) throw new Error("corridors.json not found");
    return response.json();
  })
  .then((data) => {
    ALL = data;
    setYear(data.defaultYear);
    loadGoogleMap();
  })
  .catch(() => {
    mapUnavailable("Corridor data did not load.");
    $("#corridorList").innerHTML = `<p class="empty-state">Corridor data did not load. Please refresh.</p>`;
  });
