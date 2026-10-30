// Daily status report for Pause for Paws, sent to WhatsApp through Meta's WhatsApp Cloud API.
// Run: node scripts/daily-report.mjs          (prints the message; sends only when the WA_* secrets are set)
//      node scripts/daily-report.mjs --dry    (never sends; the workflow's dry_run input does the same)
// Each source returns one short line. A source that is not set up yet says so instead of failing the report.
import { createSign } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The App Store icon already in the repo (the same artwork uploaded to App Store Connect); sent inline so it shows without loading remote images.
const LOGO_PATH = fileURLToPath(new URL("../ios/App/App/Assets.xcassets/AppIcon.appiconset/IMG_1463.png", import.meta.url));

const DRY = process.argv.includes("--dry") || process.env.WA_DRY === "1";
const HELLO = process.argv.includes("--hello") || process.env.WA_HELLO === "1";   // connection test with Meta's built-in hello_world template
const env = process.env;

async function freshness() {
  try {
    const r = await fetch("https://pauseforpawsusa.org/corridors.json?x=" + Date.now(), { signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    const y = j.years[String(j.defaultYear)];
    const age = Math.floor((Date.now() - new Date(j.generated + "T12:00:00Z").getTime()) / 86400000);
    const stale = age > 18 ? " STALE" : "";
    return `refreshed ${j.generated}${stale}, ${y.totalCrashes.toLocaleString("en-US")} crashes through ${y.through}`;
  } catch (e) {
    return "could not read the live site (" + e.message + ")";
  }
}

// ---- Google Maps usage, read with the read-only service account (role: Monitoring Viewer) ----

async function googleToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = b64({ alg: "RS256", typ: "JWT" }) + "." +
    b64({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/monitoring.read", aud: tokenUri, iat: now, exp: now + 3000 });
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const r = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: unsigned + "." + signature }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("Google sign-in failed: " + (j.error_description || j.error || r.status));
  return j.access_token;
}

async function monitoringSum(token, project, filter, hours) {
  const end = new Date();
  const start = new Date(end.getTime() - hours * 3600e3);
  const q = new URLSearchParams({
    filter,
    "interval.startTime": start.toISOString(),
    "interval.endTime": end.toISOString(),
    "aggregation.alignmentPeriod": hours * 3600 + "s",
    "aggregation.perSeriesAligner": "ALIGN_SUM",
    "aggregation.crossSeriesReducer": "REDUCE_SUM",
    view: "FULL",
  });
  const url = "https://monitoring.googleapis.com/v3/projects/" + project + "/timeSeries?" + q;
  const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return (j.timeSeries || []).reduce(
    (sum, ts) => sum + (ts.points || []).reduce((a, p) => a + Number(p.value.int64Value ?? p.value.doubleValue ?? 0), 0), 0);
}

// One value per day for the last `days` days (day buckets end now, so labels are UTC dates).
async function monitoringDaily(token, project, filter, days) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400e3);
  const q = new URLSearchParams({
    filter,
    "interval.startTime": start.toISOString(),
    "interval.endTime": end.toISOString(),
    "aggregation.alignmentPeriod": "86400s",
    "aggregation.perSeriesAligner": "ALIGN_SUM",
    "aggregation.crossSeriesReducer": "REDUCE_SUM",
    view: "FULL",
  });
  const byDay = new Map();
  let pageToken = "";
  do {   // follow every page, or part of the history silently goes missing
    if (pageToken) q.set("pageToken", pageToken);
    const r = await fetch("https://monitoring.googleapis.com/v3/projects/" + project + "/timeSeries?" + q, { headers: { Authorization: "Bearer " + token } });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    for (const ts of j.timeSeries || []) for (const p of ts.points || []) {
      const d = new Date(new Date(p.interval.endTime).getTime() - 43200e3).toISOString().slice(0, 10);
      byDay.set(d, (byDay.get(d) || 0) + Number(p.value.int64Value ?? p.value.doubleValue ?? 0));
    }
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86400e3 - 43200e3).toISOString().slice(0, 10);
    out.push({ date: d, n: byDay.get(d) || 0 });
  }
  return out;
}

// Dry-run diagnostic: does the same Maps usage question get the same answer from different queries? (counts only)
async function mapsBreakdown() {
  const sa = JSON.parse(env.GCP_SERVICE_ACCOUNT_JSON);
  const token = await googleToken(sa);
  const filter = 'metric.type="serviceruntime.googleapis.com/api/request_count" AND resource.labels.service="maps-backend.googleapis.com"';
  const total = async (days, period, reducer) => {
    const end = new Date(), start = new Date(end.getTime() - days * 86400e3);
    const q = new URLSearchParams({ filter, "interval.startTime": start.toISOString(), "interval.endTime": end.toISOString(),
      "aggregation.alignmentPeriod": period + "s", "aggregation.perSeriesAligner": "ALIGN_SUM", view: "FULL" });
    if (reducer) q.set("aggregation.crossSeriesReducer", "REDUCE_SUM");
    let sum = 0, series = 0, points = 0, tok = "";
    do {
      if (tok) q.set("pageToken", tok);
      const j = await (await fetch("https://monitoring.googleapis.com/v3/projects/" + sa.project_id + "/timeSeries?" + q, { headers: { Authorization: "Bearer " + token } })).json();
      if (j.error) return "error " + j.error.message;
      for (const ts of j.timeSeries || []) { series++; for (const x of ts.points || []) { points++; sum += Number(x.value.int64Value ?? x.value.doubleValue ?? 0); } }
      tok = j.nextPageToken || "";
    } while (tok);
    return sum + " (" + series + " series, " + points + " points)";
  };
  const out = [];
  for (const [label, days, period, reducer] of [["7d one bucket reduced", 7, 7 * 86400, true], ["7d daily reduced", 7, 86400, true], ["7d daily per series", 7, 86400, false],
    ["30d daily reduced", 30, 86400, true], ["30d daily per series", 30, 86400, false], ["30d hourly per series", 30, 3600, false], ["30d one bucket reduced", 30, 30 * 86400, true]]) {
    out.push(label + " = " + await total(days, period, reducer));
  }
  return out.join(" ;; ");
}

let mapsPromise;
function mapsData() {
  return (mapsPromise ??= (async () => {
    if (!env.GCP_SERVICE_ACCOUNT_JSON) return null;
    const sa = JSON.parse(env.GCP_SERVICE_ACCOUNT_JSON);
    const token = await googleToken(sa);
    const project = sa.project_id;
    // Google bills map loads; the quota usage metric is the closest match. The request count is the fallback.
    const svc = 'resource.labels.service="maps-backend.googleapis.com"';
    const quota = 'metric.type="serviceruntime.googleapis.com/quota/rate/net_usage" AND ' + svc +
      ' AND metric.labels.quota_metric="maps-backend.googleapis.com/map_loads"';
    const requests = 'metric.type="serviceruntime.googleapis.com/api/request_count" AND ' + svc;
    let day = await monitoringSum(token, project, quota, 24);
    let week = await monitoringSum(token, project, quota, 168);
    let kind = "map loads", filter = quota;
    if (!week) {
      day = await monitoringSum(token, project, requests, 24);
      week = await monitoringSum(token, project, requests, 168);
      kind = "requests"; filter = requests;
    }
    // Google's daily series has come back incomplete now and then. The last 7 days must match the separate 7-day total; otherwise ask again.
    let all;
    for (let attempt = 1; attempt <= 4; attempt++) {
      all = await monitoringDaily(token, project, filter, 190);
      const last7 = all.slice(-7).reduce((a, d) => a + d.n, 0);
      if (Math.abs(last7 - week) <= Math.max(10, week * 0.1)) break;
      if (attempt === 4) throw new Error("Google daily usage did not match its 7-day total");
      await sleep(3000);
    }
    const daily = all.slice(-30);
    const sumOf = (list) => list.reduce((a, d) => a + d.n, 0);
    // Calendar month to date and calendar quarter to date (UTC dates; Google resets free usage on the 1st).
    const now = new Date(), y = now.getUTCFullYear(), mo = now.getUTCMonth();
    const pad = (n) => String(n + 1).padStart(2, "0");
    const monthKey = y + "-" + pad(mo), qStartMonth = mo - (mo % 3);
    const mtd = sumOf(all.filter((d) => d.date.startsWith(monthKey)));
    const dayOfMonth = now.getUTCDate(), daysInMonth = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const quarterMonths = [];
    for (let k = qStartMonth; k <= mo; k++) {
      const key = y + "-" + pad(k);
      quarterMonths.push({ label: new Date(Date.UTC(y, k, 1)).toLocaleDateString("en-US", { timeZone: "UTC", month: "long" }), n: sumOf(all.filter((d) => d.date.startsWith(key))) });
    }
    const monthDaily = all.filter((d) => d.date.startsWith(monthKey));
    // Earlier calendar months, oldest first, starting at the first month that has any usage.
    const byMonth = new Map();
    for (const d of all) byMonth.set(d.date.slice(0, 7), (byMonth.get(d.date.slice(0, 7)) || 0) + d.n);
    const pastMonths = [...byMonth].filter(([k]) => k < monthKey).map(([k, n]) => ({ date: k + "-01", n,
      label: new Date(k + "-01T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short" }) }));
    while (pastMonths.length && !pastMonths[0].n) pastMonths.shift();
    return {
      kind, day, week, daily, monthDaily, pastMonths, month: sumOf(daily),
      monthName: new Date(Date.UTC(y, mo, 1)).toLocaleDateString("en-US", { timeZone: "UTC", month: "long" }),
      mtd, projected: Math.round(mtd / dayOfMonth * daysInMonth), dayOfMonth, daysInMonth,
      quarterLabel: "Q" + (Math.floor(mo / 3) + 1) + " " + y, quarterMonths, quarterTotal: sumOf(quarterMonths),
    };
  })());
}

async function mapsLoads() {
  try {
    const m = await mapsData();
    if (!m) return "not set up yet";
    return m.day.toLocaleString("en-US") + " " + m.kind + " in the last 24 hours, " + m.week.toLocaleString("en-US") +
      " in 7 days; " + m.monthName + " so far " + m.mtd.toLocaleString("en-US") + ", on pace for " + m.projected.toLocaleString("en-US") +
      " (Google gives about 10,000 free map loads a month)";
  } catch (e) {
    return "could not read Google usage (" + String(e.message).slice(0, 80) + ")";
  }
}

// ---- iOS downloads, from App Store Connect's daily sales reports (read-only "Sales and Reports" key) ----

const APPLE_APP_ID = env.APPLE_APP_ID || "6816612414";                 // Pause for Paws
const FIRST_DOWNLOAD_TYPES = new Set(["1", "1F", "1T"]);               // first-time downloads (iPhone, universal, iPad)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ascToken() {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = b64({ alg: "ES256", kid: env.ASC_KEY_ID, typ: "JWT" }) + "." +
    b64({ iss: env.ASC_ISSUER_ID, iat: now, exp: now + 900, aud: "appstoreconnect-v1" });
  const key = env.ASC_PRIVATE_KEY.replace(/\\n/g, "\n");
  const signature = createSign("SHA256").update(unsigned).sign({ key, dsaEncoding: "ieee-p1363" }, "base64url");
  return unsigned + "." + signature;
}

// First-time downloads of the app on one day, or null when Apple has no report for that day (no sales, or not published yet).
async function firstDownloadsOn(token, date) {
  const q = new URLSearchParams({
    "filter[frequency]": "DAILY", "filter[reportSubType]": "SUMMARY", "filter[reportType]": "SALES",
    "filter[vendorNumber]": env.ASC_VENDOR, "filter[reportDate]": date,
  });
  const r = await fetch("https://api.appstoreconnect.apple.com/v1/salesReports?" + q, {
    headers: { Authorization: "Bearer " + token, Accept: "application/a-gzip, application/json" },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("Apple said HTTP " + r.status + " " + (await r.text()).slice(0, 120));
  const text = gunzipSync(Buffer.from(await r.arrayBuffer())).toString("utf8");
  const rows = text.split(/\r?\n/).filter(Boolean).map((l) => l.split("\t"));
  const head = rows.shift() || [];
  const iId = head.indexOf("Apple Identifier"), iUnits = head.indexOf("Units"), iType = head.indexOf("Product Type Identifier");
  if (iId < 0 || iUnits < 0 || iType < 0) throw new Error("unexpected report columns");
  return rows.filter((c) => c[iId] === APPLE_APP_ID && FIRST_DOWNLOAD_TYPES.has(c[iType])).reduce((a, c) => a + Number(c[iUnits] || 0), 0);
}

const LAUNCH_DATE = env.APPLE_LAUNCH_DATE || "2026-10-13";               // approved and public; "total users" counts from here

let iosPromise;
function iosData() {
  return (iosPromise ??= (async () => {
    if (!env.ASC_KEY_ID || !env.ASC_ISSUER_ID || !env.ASC_PRIVATE_KEY || !env.ASC_VENDOR) return null;
    const token = ascToken();
    const days = [];   // newest first, from yesterday back to launch (at least 30 days so the chart is full)
    const span = Math.min(365, Math.max(30, Math.ceil((Date.now() - Date.parse(LAUNCH_DATE)) / 86400e3)));
    for (let i = 1; i <= span; i++) {
      const date = new Date(Date.now() - i * 86400e3).toISOString().slice(0, 10);
      days.push({ date, n: await firstDownloadsOn(token, date) });
      await sleep(150);
    }
    return days;
  })());
}

async function iosInstalls() {
  try {
    const days = await iosData();
    if (!days) return "not set up yet";
    const have = days.filter((d) => d.n !== null);
    if (!have.length) return "no download reports from Apple yet (they can lag a day or two)";
    const sum = (list) => list.reduce((a, d) => a + (d.n || 0), 0);
    const latest = have[0];
    return latest.n + " new download" + (latest.n === 1 ? "" : "s") + " on " + latest.date + " (last 7 days: " + sum(days.slice(0, 7)) + ", last 30 days: " + sum(days.slice(0, 30)) + ", since launch: " + sum(days.filter((d) => d.date >= LAUNCH_DATE)) + ")";
  } catch (e) {
    return "could not read App Store downloads (" + String(e.message).slice(0, 80) + ")";
  }
}

async function androidInstalls() {
  // Android is in closed testing, so there is no public install count to report yet.
  // To add it later: read the Play Console installs report from its Cloud Storage bucket (env.PLAY_BUCKET) with the Google service account.
  if (!env.GCP_SERVICE_ACCOUNT_JSON || !env.PLAY_BUCKET) return "not tracked yet (app is in closed testing)";
  return "not tracked yet (app is in closed testing)";
}

function oneLine(s) {
  // WhatsApp template variables cannot contain new lines, tabs or runs of 4+ spaces
  return String(s).replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim();
}

async function send(parts) {
  const need = ["WA_TOKEN", "WA_PHONE_NUMBER_ID", "WA_TO"];
  if (DRY || need.some((k) => !env[k])) {
    console.log("(not sent: " + (DRY ? "dry run" : "missing " + need.filter((k) => !env[k]).join(", ")) + ")");
    return;
  }
  const body = HELLO ? {
    messaging_product: "whatsapp",
    to: env.WA_TO.replace(/[^0-9]/g, ""),
    type: "template",
    template: { name: "hello_world", language: { code: "en_US" } },
  } : {
    messaging_product: "whatsapp",
    to: env.WA_TO.replace(/[^0-9]/g, ""),
    type: "template",
    template: {
      name: env.WA_TEMPLATE || "daily_report",
      language: { code: env.WA_LANG || "en" },
      components: [{ type: "body", parameters: parts.map((t) => ({ type: "text", text: oneLine(t) })) }],
    },
  };
  const r = await fetch("https://graph.facebook.com/v21.0/" + env.WA_PHONE_NUMBER_ID + "/messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.WA_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) { console.error("WhatsApp send failed:", r.status, text); process.exit(1); }
  console.log("WhatsApp send ok:", text);
}

// ---- Email through Gmail (an app password, not the account password) ----

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function loadNodemailer() {
  try { return (await import("nodemailer")).default; }
  catch {
    // The workflow installs it into .mail-deps so the project's own dependencies stay untouched.
    const { createRequire } = await import("node:module");
    return createRequire(process.cwd() + "/")("./.mail-deps/node_modules/nodemailer");
  }
}

// ---- Report design: header, one-line headline, tiles with trends, free-tier gauge, charts (plain HTML, so every mail app shows it) ----

const fmt = (n) => Number(n).toLocaleString("en-US");
const shortDate = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const GREEN = "#2e7d5b", BLUE = "#3b6fb6", AMBER = "#b26a00", RED = "#b3261e", MUTED = "#5b6b64";
const FREE_LOADS = 10000;   // Google's monthly free map loads

// Change against the previous period. upGood: a rise is good news (downloads); for Maps a rise is more usage, so it shows amber.
function trend(cur, prev, upGood, what) {
  if (!prev) return { arrow: "&#9679;", text: cur ? "new activity" : "no change", color: MUTED };
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return { arrow: "&#9679;", text: "no change " + what, color: MUTED };
  const up = pct > 0;
  return { arrow: up ? "&#9650;" : "&#9660;", text: Math.abs(pct) + "% " + what, color: up === upGood ? GREEN : AMBER };
}

function tile(label, value, note, accent, tr) {
  return '<td style="padding:12px 14px;background:#f4f8f6;border:1px solid #e3e9e6;border-left:4px solid ' + accent + ';border-radius:10px;vertical-align:top">' +
    '<div style="font-size:10.5px;color:' + MUTED + ';text-transform:uppercase;letter-spacing:.05em">' + escapeHtml(label) + "</div>" +
    '<div style="font-size:27px;font-weight:bold;color:#17221e;margin:4px 0 2px">' + escapeHtml(value) + "</div>" +
    (tr ? '<div style="font-size:11.5px;font-weight:bold;color:' + tr.color + '">' + tr.arrow + " " + escapeHtml(tr.text) + "</div>" : "") +
    '<div style="font-size:10.5px;color:' + MUTED + ';margin-top:2px">' + escapeHtml(note) + "</div></td>";
}

// Moments worth marking on the charts (shown as a flag under that day's bar).
const EVENTS = [{ date: "2026-10-21", label: "WHO 13 News (Des Moines) featured the app", url: "https://who13.com/news/metro-news/waukee-middle-school-students-develop-app-to-warn-drivers-of-animal-crash-hotspots/" }];

function barChart(title, series, color, unit, opts = {}) {
  const max = Math.max(1, ...series.map((d) => d.n));
  const total = series.reduce((a, d) => a + d.n, 0);
  const labelOf = opts.label || ((d) => Number(d.date.slice(8)));
  const marks = opts.events === false ? [] : EVENTS.filter((e) => series.some((d) => d.date === e.date));
  const peak = opts.peak || color;
  const cols = series.map((d) => {
    const h = d.n ? Math.max(3, Math.round((d.n / max) * 100)) : 1;
    return '<td valign="bottom" title="' + shortDate(d.date) + ": " + fmt(d.n) + '" style="padding:0 1px;height:126px;vertical-align:bottom">' +
      '<div style="text-align:center;font-size:9px;font-weight:bold;color:#17221e;height:13px;line-height:13px">' + (d.n || opts.showZero ? d.n : "") + "</div>" +
      '<div style="height:' + h + "px;background:" + (!d.n ? "#d5ddd9" : d.n === max ? peak : color) + ';border-radius:3px 3px 0 0;font-size:0;line-height:0">&nbsp;</div></td>';
  }).join("");
  const flags = marks.length ? '<table width="100%" style="border-collapse:collapse;table-layout:fixed;font-size:9px;text-align:center;color:' + RED + ';font-weight:bold"><tr>' +
    series.map((d) => '<td style="padding:0">' + (marks.some((e) => e.date === d.date) ? "&#9650;" : "&nbsp;") + "</td>").join("") + "</tr></table>" : "";
  return '<div style="margin:14px 0 0;padding:12px 14px;border:1px solid #e3e9e6;border-radius:12px;background:#ffffff">' +
    '<div style="font-weight:bold;font-size:14.5px"><span style="display:inline-block;width:9px;height:9px;border-radius:5px;background:' + color + ';margin-right:7px"></span>' + escapeHtml(title) + "</div>" +
    '<div style="font-size:12px;color:' + MUTED + ';margin:2px 0 6px">' + fmt(total) + " " + unit + " " + (opts.span || "in 30 days") + ". Tallest bar: " + fmt(max) + ".</div>" +
    '<table width="100%" style="border-collapse:collapse;table-layout:fixed;border-bottom:1px solid #9aa8a1"><tr>' + cols + "</tr></table>" +
    '<table width="100%" style="border-collapse:collapse;table-layout:fixed;font-size:8.5px;font-weight:bold;color:#2f3b35;text-align:center"><tr>' +
    series.map((d) => '<td style="padding:2px 0">' + labelOf(d) + "</td>").join("") + "</tr></table>" + flags +
    (marks.length ? '<div style="font-size:11px;color:' + RED + '">&#9650; ' + marks.map((e) => shortDate(e.date) + ": " + (e.url ? '<a href="' + e.url + '" style="color:' + RED + '">' + escapeHtml(e.label) + "</a>" : escapeHtml(e.label))).join("; ") + "</div>" : "") +
    (opts.note ? '<div style="font-size:11px;color:' + MUTED + '">' + opts.note + "</div>" : "") + "</div>";
}

// Thin progress bar for the monthly free tier; colour follows where the month is heading, not where it is today.
function gauge(m) {
  const used = Math.min(100, Math.round((m.mtd / FREE_LOADS) * 100)), projPct = Math.round((m.projected / FREE_LOADS) * 100);
  const color = projPct >= 90 ? RED : projPct >= 70 ? "#d98e04" : GREEN;
  return '<div style="margin:14px 0 0;padding:12px 14px;border:1px solid #e3e9e6;border-radius:12px;background:#ffffff">' +
    '<div style="font-weight:bold;font-size:14.5px">Google Maps free tier, ' + escapeHtml(m.monthName) + "</div>" +
    '<div style="font-size:12px;color:' + MUTED + ';margin:2px 0 8px">' + fmt(m.mtd) + " of about " + fmt(FREE_LOADS) + " free a month (" + used + "% used). On pace to finish at " + fmt(m.projected) + " (" + projPct + "%).</div>" +
    '<table width="100%" style="border-collapse:collapse"><tr><td width="' + Math.max(1, used) + '%" height="10" bgcolor="' + color + '" style="background:' + color + ';border-radius:5px;font-size:0;line-height:0">&nbsp;</td>' +
    '<td height="10" bgcolor="#e3e9e6" style="background:#e3e9e6;border-radius:5px;font-size:0;line-height:0">&nbsp;</td></tr></table>' +
    '<div style="font-size:10.5px;color:' + MUTED + ';margin-top:5px">Green under 70% of the free tier, amber 70-90%, red above 90%. These are request counts, so Billing is the source for the real bill.</div></div>';
}

const WEEKLY = env.REPORT_MODE === "weekly";

async function buildReport(subject, rows) {
  const [ios, maps] = await Promise.allSettled([iosData(), mapsData()]);
  const iosDays = ios.status === "fulfilled" ? ios.value : null, m = maps.status === "fulfilled" ? maps.value : null;
  const sum = (l) => l.reduce((a, d) => a + (d.n || 0), 0);
  const tiles = [], headBits = [];
  let iosCharts = "", mapsCharts = "", quarter = "";

  if (iosDays) {
    const since = sum(iosDays.filter((d) => d.date >= LAUNCH_DATE)), wk = sum(iosDays.slice(0, 7)), prevWk = sum(iosDays.slice(7, 14));
    const best = iosDays.filter((d) => d.date >= LAUNCH_DATE).reduce((b, d) => ((d.n || 0) > (b.n || 0) ? d : b), { n: 0, date: LAUNCH_DATE });
    let line = fmt(since) + " iOS downloads since launch";
    if (best.n) {
      const ev = EVENTS.find((e) => { const gap = (Date.parse(best.date) - Date.parse(e.date)) / 86400e3; return gap >= 0 && gap <= 2; });
      line += "; the best day was " + shortDate(best.date) + " with " + fmt(best.n) + (ev ? ", right after " + ev.label : "");
    }
    headBits.push(line + ".");
    tiles.push(tile("Total users downloaded", fmt(since), "iOS, since launch " + shortDate(LAUNCH_DATE), GREEN, { arrow: "&#9650;", text: fmt(wk) + " this week", color: wk ? GREEN : MUTED }));
    tiles.push(tile(WEEKLY ? "Downloads, this week" : "Downloads, 7 days", fmt(wk), "last 30 days: " + fmt(sum(iosDays.slice(0, 30))), GREEN, trend(wk, prevWk, true, "vs the 7 days before")));
    const nowD = new Date(), monthKey = nowD.getUTCFullYear() + "-" + String(nowD.getUTCMonth() + 1).padStart(2, "0");
    const monthName = nowD.toLocaleDateString("en-US", { timeZone: "UTC", month: "long" });
    const monthDays = iosDays.filter((d) => d.date.startsWith(monthKey)).reverse().map((d) => ({ date: d.date, n: d.n || 0 }));
    const byMonth = new Map();
    for (const d of iosDays) if (d.date >= LAUNCH_DATE) byMonth.set(d.date.slice(0, 7), (byMonth.get(d.date.slice(0, 7)) || 0) + (d.n || 0));
    const past = [...byMonth].reverse().map(([k, n]) => ({ date: k + "-01", n, label: new Date(k + "-01T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short" }) + (k === monthKey ? " (so far)" : "") }));
    // Show the month before launch as 0 so the chart has an earlier month to compare with.
    if (past.length && past[0].date.slice(0, 7) === LAUNCH_DATE.slice(0, 7)) past.unshift({ date: "pre", n: 0, label: "Pre-launch" });
    if (monthDays.length) iosCharts += barChart("iOS downloads per day, " + monthName + " so far", monthDays, GREEN, "downloads", { peak: "#1b5e41", span: "so far this month", note: "Day of month. Apple reports lag about two days, so the last two bars may still rise." });
    if (past.length) iosCharts += barChart("iOS downloads by month, since launch", past, "#7fb59a", "downloads", { peak: "#4f9a79", label: (d) => d.label, span: "since launch", events: false, showZero: true, note: "Earlier months fill in here as each month ends; the app went live " + shortDate(LAUNCH_DATE) + "." });
  }

  if (m) {
    const last7 = m.daily.slice(-7).reduce((a, d) => a + d.n, 0), prev7 = m.daily.slice(-14, -7).reduce((a, d) => a + d.n, 0);
    headBits.push("Google Maps is at " + Math.round((m.mtd / FREE_LOADS) * 100) + "% of this month's free tier (on pace for " + Math.round((m.projected / FREE_LOADS) * 100) + "%).");
    tiles.push(tile("Google Maps, " + m.monthName + " so far", fmt(m.mtd), "of about " + fmt(FREE_LOADS) + " free a month", BLUE, trend(last7, prev7, false, "last 7 days vs 7 before")));
    tiles.push(WEEKLY
      ? tile("Google Maps, this week", fmt(last7), m.kind + "; 30 days: " + fmt(m.month), BLUE, trend(last7, prev7, false, "vs the week before"))
      : tile("Google Maps, 24 hours", fmt(m.day), m.kind + "; 7 days: " + fmt(m.week), BLUE, trend(m.day, m.daily[m.daily.length - 2] ? m.daily[m.daily.length - 2].n : 0, false, "vs the day before")));
    mapsCharts += gauge(m);
    mapsCharts += barChart("Google Maps " + m.kind + " per day, " + m.monthName + " so far", m.monthDaily, BLUE, m.kind, { peak: "#244e8a", span: "so far this month", note: "Day of month" });
    if (m.pastMonths.length) mapsCharts += barChart("Google Maps " + m.kind + " by month, earlier months", m.pastMonths, "#7d93b8", m.kind, { peak: "#5877a6", label: (d) => d.label, span: "in earlier months", events: false });
    quarter = '<div style="margin:14px 0 0;padding:12px 14px;border:1px solid #e3e9e6;border-radius:12px;background:#ffffff"><div style="font-weight:bold;font-size:14.5px;margin-bottom:6px">Google Maps usage, ' + escapeHtml(m.quarterLabel) + " (quarter to date)</div>" +
      '<table style="border-collapse:collapse;font-size:13.5px">' +
      m.quarterMonths.map((q) => '<tr><td style="padding:3px 24px 3px 0">' + escapeHtml(q.label) + '</td><td align="right" style="padding:3px 0">' + fmt(q.n) + " " + m.kind + "</td></tr>").join("") +
      '<tr><td style="padding:6px 24px 3px 0;border-top:1px solid #9aa8a1;font-weight:bold">Quarter total</td><td align="right" style="padding:6px 0 3px;border-top:1px solid #9aa8a1;font-weight:bold">' + fmt(m.quarterTotal) + " " + m.kind + "</td></tr></table></div>";
  }

  const headline = headBits.join(" ");
  const tilesHtml = tiles.length ? '<table width="100%" style="border-collapse:separate;border-spacing:8px 0;margin:14px -8px 0"><tr>' + tiles.join("") + "</tr></table>" : "";
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#17221e;max-width:640px;background:#ffffff">' +
    '<table width="100%" style="border-collapse:collapse"><tr><td bgcolor="#17382b" style="background:#17382b;border-radius:12px;padding:14px 18px">' +
    '<table style="border-collapse:collapse"><tr>' + (existsSync(LOGO_PATH) ? '<td style="padding:0 14px 0 0;vertical-align:middle"><img src="cid:applogo" width="52" height="52" alt="Pause for Paws" style="display:block;border-radius:12px;border:0"></td>' : "") +
    '<td style="vertical-align:middle"><div style="font-size:21px;font-weight:bold;color:#ffffff">Pause for Paws</div>' +
    '<div style="font-size:12.5px;color:#bfd8cb;margin-top:2px">' + escapeHtml(subject.replace(/^Pause for Paws /, "")) + "</div>" +
    '<div style="font-size:11.5px;color:#8fb8a3;margin-top:2px">Built by The Blizzards, a Waukee middle school student team</div></td></tr></table></td></tr></table>' +
    (headline ? '<div style="font-size:15.5px;font-weight:bold;line-height:1.4;margin:14px 0 0">' + escapeHtml(headline) + "</div>" : "") +
    tilesHtml + iosCharts + mapsCharts + quarter +
    '<div style="margin:14px 0 6px;font-weight:bold;font-size:14.5px">Details</div><table style="border-collapse:collapse;font-size:13px">' +
    rows.map(([k, v]) => '<tr><td style="padding:4px 14px 4px 0;vertical-align:top;font-weight:bold;white-space:nowrap">' + escapeHtml(k) + '</td><td style="padding:4px 0">' + escapeHtml(v) + "</td></tr>").join("") +
    '</table><p style="color:#6b7280;font-size:11px;margin-top:14px">Automatic report for the Pause for Paws app owner. Sources: App Store Connect sales reports (first-time downloads, about two days behind) and Google Cloud Monitoring request counts. Android will be added once the app has public installs.' +
    EVENTS.map((e) => ' WHO 13 News story: <a href="' + e.url + '" style="color:#6b7280">' + e.url + "</a>").join("") + "</p></div>";
  return { html, headline };
}

async function sendEmail(subject, rows, report) {
  const user = env.GMAIL_USER;
  const pass = (env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
  if (!user || !pass) return false;
  const to = env.EMAIL_TO || user;
  const masked = to.replace(/^(.{2}).*(@.*)$/, "$1***$2");
  const text = subject + "\n\n" + (report.headline ? report.headline + "\n\n" : "") + rows.map(([k, v]) => k + ": " + v).join("\n") + "\n";
  if (env.PREVIEW_FILE) { (await import("node:fs")).writeFileSync(env.PREVIEW_FILE, report.html); console.log("Preview written to " + env.PREVIEW_FILE); }
  if (DRY) { console.log("(email not sent: dry run; it would go to " + masked + ")"); return true; }
  const nodemailer = await loadNodemailer();
  const transport = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
  const info = await transport.sendMail({ from: '"Pause for Paws report" <' + user + ">", to, subject, text, html: report.html,
    attachments: existsSync(LOGO_PATH) ? [{ filename: "pause-for-paws.png", path: LOGO_PATH, cid: "applogo" }] : [] });
  console.log("Email sent to " + masked + " (" + info.messageId + ")");
  return true;
}

const lines = await Promise.all([freshness(), mapsLoads(), iosInstalls(), androidInstalls()]);
const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" });
const labels = ["Website data", "Google Maps", "iOS downloads", "Android installs"];
const subject = WEEKLY ? "Pause for Paws weekly summary, week ending " + today : "Pause for Paws daily report, " + today;
console.log(subject);
labels.forEach((k, i) => console.log(k + ": " + lines[i]));

let report = { html: "", headline: "" };
try { report = await buildReport(subject, labels.map((k, i) => [k, lines[i]])); } catch (e) { console.error("Charts skipped: " + e.message); }

if (DRY) {
  // Dry runs also print the finished report page (counts only) so a one-page PDF can be made from it without sending an email.
  try { console.log("MAPS_BREAKDOWN " + await mapsBreakdown()); } catch (e) { console.log("breakdown failed " + e.message); }
  console.log("REPORT_HTML " + Buffer.from(report.html).toString("base64"));
}

let delivered = false;
try {
  delivered = await sendEmail(subject, labels.map((k, i) => [k, lines[i]]), report);
} catch (e) {
  console.error("Email failed: " + String(e.message).slice(0, 200));
  process.exit(1);   // fail the run so GitHub emails you about it
}
// WhatsApp stays switched off: Meta has locked the sending account until the business is verified.
if (env.WA_ENABLED === "1") { await send([today, ...lines]); delivered = true; }
if (!delivered) console.log("(nothing sent: no email settings found. Add GMAIL_USER and GMAIL_APP_PASSWORD as secrets.)");
