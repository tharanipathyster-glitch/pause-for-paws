/* Pause for Paws — static front end.
   Reads corridors.json (precomputed from Iowa DOT 2025 crash records).
   No backend required: this page works on any static host. */

const SIGHTING_FORM_URL = ""; // <-- paste your Google Form link here

let DATA = null;
let view = "statewide";
let selectedMonth = new Date().getMonth(); // 0-11, defaults to the current calendar month
let googleMap = null;
let mapShapes = [];

const $ = (sel) => document.querySelector(sel);

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

/* ---------- header numbers ---------- */

function renderStats() {
  $("#dataStamp").textContent = `Iowa DOT crash records ${DATA.year}`;
  $("#updatedStamp").textContent = `built ${formatIsoDate(DATA.generated)}`;
  $("#statCrashesLabel").textContent = `Crashes in ${DATA.year}`;
  $("#statCrashes").textContent = DATA.totalCrashes.toLocaleString();
  $("#statInjury").textContent = DATA.injuryOrWorse.toLocaleString();
  $("#statInjuryNote").textContent = DATA.fatal ? `includes ${DATA.fatal} deaths` : "injury or fatal crashes";

  const peak = DATA.monthly.reduce((best, m) => (m.crashes > best.crashes ? m : best));
  const yearTotal = DATA.monthly.reduce((sum, m) => sum + m.crashes, 0);
  $("#statMonth").textContent = peak.month;
  $("#statMonthNote").textContent =
    `${peak.crashes.toLocaleString()} crashes — ${Math.round((peak.crashes / yearTotal) * 100)}% of the year`;
}

/* ---------- month chart ---------- */

function renderMonthChart() {
  const peak = Math.max(...DATA.monthly.map((m) => m.crashes));
  $("#monthChart").innerHTML = DATA.monthly.map((m) => {
    const pct = Math.round((m.crashes / peak) * 100);
    const hot = m.crashes === peak ? " peak" : "";
    return `<div class="month-col${hot}">
      <span class="month-value">${m.crashes.toLocaleString()}</span>
      <div class="bar-wrap"><div class="month-bar" style="height:${Math.max(pct, 3)}%"></div></div>
      <span class="month-label">${m.month}</span>
    </div>`;
  }).join("");

  const worst = DATA.topDates[0];
  const novDates = DATA.topDates.filter((d) => d.date.startsWith("11")).length;
  $("#monthNote").textContent =
    `${novDates} of the 10 worst individual days in 2025 were in November. The worst single day was ` +
    `${formatDate(worst.date)}, with ${worst.crashes} crashes in 24 hours.`;
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function formatDate(mmdd) {
  const [m, d] = mmdd.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

function formatIsoDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}` : iso;
}

/* ---------- day-by-day chart for one month ---------- */

function renderMonthPicker() {
  $("#monthPicker").innerHTML = DATA.monthly.map((m, i) =>
    `<button class="month-pill${i === selectedMonth ? " active" : ""}" data-month="${i}" role="tab" aria-selected="${i === selectedMonth}">${m.month}</button>`
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
  const days = DATA.daily[selectedMonth] || [];
  const total = days.reduce((sum, n) => sum + n, 0);
  const peak = Math.max(...days, 1);
  const isCurrentMonth = selectedMonth === new Date().getMonth();

  $("#dayTitle").textContent = `${MONTHS[selectedMonth]} ${DATA.year}${isCurrentMonth ? " (this month, last year)" : ""}`;
  $("#dayTotal").textContent = `${total.toLocaleString()} crashes / ${(total / days.length).toFixed(1)} per day`;

  $("#dayChart").innerHTML = days.map((n, i) => {
    const pct = Math.round((n / peak) * 100);
    const hot = n === peak ? " peak" : "";
    return `<div class="day-col${hot}" title="${MONTHS[selectedMonth]} ${i + 1}: ${n} crashes">
      <span class="day-value">${n}</span>
      <div class="bar-wrap"><div class="day-bar" style="height:${Math.max(pct, 2)}%"></div></div>
      <span class="day-label">${i + 1}</span>
    </div>`;
  }).join("");

  const worstDay = days.indexOf(peak) + 1;
  const quietDays = days.filter((n) => n === 0).length;
  const share = Math.round((total / DATA.totalCrashes) * 100);
  $("#dayNote").textContent =
    `${MONTHS[selectedMonth]} had ${total.toLocaleString()} animal-related crashes, ${share}% of the year. ` +
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
    `Across the whole year, ${worst.day} is the worst day of the week (${worst.crashes.toLocaleString()} crashes) and ${best.day} the quietest (${best.crashes.toLocaleString()}).`;
}

/* ---------- corridor table ---------- */

function renderCorridorList(list) {
  const rows = list.slice(0, 25);
  $("#corridorCount").textContent = `${list.length.toLocaleString()} corridors`;
  $("#corridorList").innerHTML = rows.length ? rows.map((c, i) => `
    <article class="risk-row" data-id="${c.id}">
      <div class="risk-rank">${i + 1}</div>
      <div><strong>${c.id}</strong><span>${c.lat.toFixed(3)}, ${c.lng.toFixed(3)}</span></div>
      <div class="risk-animals">${c.risk}</div>
      <div class="risk-score"><b>${c.crashes}</b><span>crashes in 2025</span></div>
      <button class="simulate-button" data-id="${c.id}">Show driver message <span>→</span></button>
    </article>`).join("") : `<p class="empty-state">No corridors match that search.</p>`;

  $("#corridorList").querySelectorAll(".simulate-button").forEach((button) => {
    button.addEventListener("click", () => {
      const corridor = currentCorridors().find((c) => c.id === button.dataset.id);
      if (corridor) selectCorridor(corridor, true);
    });
  });

  if (rows.length < list.length) {
    $("#corridorList").insertAdjacentHTML("beforeend",
      `<p class="empty-state">Showing the 25 worst of ${list.length.toLocaleString()} corridors. Search by ID to find others.</p>`);
  }
}

function selectCorridor(corridor, pan) {
  $("#alertTitle").textContent = "Pause for Paws";
  $("#alertMessage").textContent =
    `${corridor.crashes} animal-related crashes were recorded on this stretch of road in 2025` +
    (corridor.injuryOrWorse ? `, and ${corridor.injuryOrWorse} of them hurt someone` : "") +
    `. Slow down and watch both shoulders. This is a historical pattern, not a live animal location.`;
  $("#alertSpecies").textContent = `${corridor.id} · ${corridor.risk}`;
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

  (DATA.reports || []).forEach((report) => {
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
  $("#mapTitle").textContent = next === "metro" ? "Des Moines area" : "Iowa — statewide";
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
$("#reportButton").addEventListener("click", () =>
  $("#reportSection").scrollIntoView({ behavior: "smooth" }));
$("#corridorSearch").addEventListener("input", (event) => {
  const query = event.target.value.trim().toLowerCase();
  renderCorridorList(currentCorridors().filter((c) => c.id.toLowerCase().includes(query)));
});

if (SIGHTING_FORM_URL) {
  $("#reportLink").href = SIGHTING_FORM_URL;
} else {
  const link = $("#reportLink");
  link.href = "mailto:hello@pauseforpawsusa.org?subject=Animal%20crossing%20sighting";
  link.innerHTML = "Email us a sighting <span>→</span>";
}

fetch("corridors.json")
  .then((response) => {
    if (!response.ok) throw new Error("corridors.json not found");
    return response.json();
  })
  .then((data) => {
    DATA = data;
    renderStats();
    renderMonthChart();
    renderMonthPicker();
    renderDayChart();
    renderWeekdayStrip();
    setView("statewide");
    loadGoogleMap();
  })
  .catch(() => {
    mapUnavailable("Corridor data did not load.");
    $("#corridorList").innerHTML = `<p class="empty-state">Corridor data did not load. Please refresh.</p>`;
  });
