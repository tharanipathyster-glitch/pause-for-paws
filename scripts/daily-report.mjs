// Daily status report for Pause for Paws, sent to WhatsApp through Meta's WhatsApp Cloud API.
// Run: node scripts/daily-report.mjs          (prints the message; sends only when the WA_* secrets are set)
//      node scripts/daily-report.mjs --dry    (never sends; the workflow's dry_run input does the same)
// Each source returns one short line. A source that is not set up yet says so instead of failing the report.
import { createSign } from "node:crypto";
import { gunzipSync } from "node:zlib";

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
  const r = await fetch("https://monitoring.googleapis.com/v3/projects/" + project + "/timeSeries?" + q, { headers: { Authorization: "Bearer " + token } });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  const byDay = new Map();
  for (const ts of j.timeSeries || []) for (const p of ts.points || []) {
    const d = new Date(new Date(p.interval.endTime).getTime() - 43200e3).toISOString().slice(0, 10);
    byDay.set(d, (byDay.get(d) || 0) + Number(p.value.int64Value ?? p.value.doubleValue ?? 0));
  }
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86400e3 - 43200e3).toISOString().slice(0, 10);
    out.push({ date: d, n: byDay.get(d) || 0 });
  }
  return out;
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
    const all = await monitoringDaily(token, project, filter, 190);
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

// ---- Executive summary for the email: headline numbers plus two 30-day bar charts (plain HTML, so every mail app shows them) ----

const fmt = (n) => Number(n).toLocaleString("en-US");
const shortDate = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

function tile(label, value, note) {
  return '<td style="padding:12px 14px;background:#f1f6f3;border-radius:8px;vertical-align:top">' +
    '<div style="font-size:11px;color:#5b6b64;text-transform:uppercase;letter-spacing:.04em">' + escapeHtml(label) + "</div>" +
    '<div style="font-size:26px;font-weight:bold;color:#17221e;margin:4px 0 2px">' + escapeHtml(value) + "</div>" +
    '<div style="font-size:11px;color:#5b6b64">' + escapeHtml(note) + "</div></td>";
}

// Moments worth marking on the charts (shown as a flag under that day's bar).
const EVENTS = [{ date: "2026-10-21", label: "WHO 13 featured the app", url: "https://who13.com/news/metro-news/waukee-middle-school-students-develop-app-to-warn-drivers-of-animal-crash-hotspots/" }];

function barChart(title, series, color, unit, opts = {}) {
  const max = Math.max(1, ...series.map((d) => d.n));
  const total = series.reduce((a, d) => a + d.n, 0);
  const labelOf = opts.label || ((d) => Number(d.date.slice(8)));
  const marks = opts.events === false ? [] : EVENTS.filter((e) => series.some((d) => d.date === e.date));
  const cols = series.map((d) => {
    const h = d.n ? Math.max(3, Math.round((d.n / max) * 100)) : 1;
    return '<td valign="bottom" title="' + shortDate(d.date) + ": " + fmt(d.n) + '" style="padding:0 1px;height:126px;vertical-align:bottom">' +
      '<div style="text-align:center;font-size:9px;font-weight:bold;color:#17221e;height:13px;line-height:13px">' + (d.n || "") + "</div>" +
      '<div style="height:' + h + "px;background:" + (d.n ? color : "#d5ddd9") + ';border-radius:2px 2px 0 0;font-size:0;line-height:0">&nbsp;</div></td>';
  }).join("");
  const flags = marks.length ? '<table width="100%" style="border-collapse:collapse;table-layout:fixed;font-size:9px;text-align:center;color:#b3261e;font-weight:bold"><tr>' +
    series.map((d) => '<td style="padding:0">' + (marks.some((e) => e.date === d.date) ? "&#9650;" : "&nbsp;") + "</td>").join("") + "</tr></table>" : "";
  return '<div style="margin:22px 0 4px;font-weight:bold;font-size:15px">' + escapeHtml(title) + "</div>" +
    '<div style="font-size:12px;color:#5b6b64;margin-bottom:6px">' + fmt(total) + " " + unit + " " + (opts.span || "in 30 days") + ". Tallest bar: " + fmt(max) + ".</div>" +
    '<table width="100%" style="border-collapse:collapse;table-layout:fixed;border-bottom:1px solid #9aa8a1"><tr>' + cols + "</tr></table>" +
    '<table width="100%" style="border-collapse:collapse;table-layout:fixed;font-size:8.5px;font-weight:bold;color:#2f3b35;text-align:center"><tr>' +
    series.map((d) => '<td style="padding:2px 0">' + labelOf(d) + "</td>").join("") + "</tr></table>" + flags +
    (marks.length ? '<div style="font-size:11px;color:#b3261e">&#9650; ' + marks.map((e) => shortDate(e.date) + ": " + (e.url ? '<a href="' + e.url + '" style="color:#b3261e">' + escapeHtml(e.label) + "</a>" : escapeHtml(e.label))).join("; ") + "</div>" : "") +
    (opts.note ? '<div style="font-size:11px;color:#5b6b64">' + opts.note + "</div>" : "");
}

const WEEKLY = env.REPORT_MODE === "weekly";
const vs = (cur, prev) => prev ? (cur >= prev ? "up " : "down ") + Math.abs(Math.round((cur - prev) / prev * 100)) + "% from " + fmt(prev) + " the week before" : "week before: " + fmt(prev);

async function executiveHtml() {
  const [ios, maps] = await Promise.allSettled([iosData(), mapsData()]);
  let html = "";
  const tiles = [];
  let iosChart = "";
  if (ios.status === "fulfilled" && ios.value) {
    const days = ios.value, sum = (l) => l.reduce((a, d) => a + (d.n || 0), 0);
    const since = days.filter((d) => d.date >= LAUNCH_DATE);
    tiles.push(tile("Total users downloaded", fmt(sum(since)), "iOS, since launch (" + shortDate(LAUNCH_DATE) + ")"));
    if (WEEKLY) {
      const best = days.slice(0, 30).reduce((b, d) => ((d.n || 0) > (b.n || 0) ? d : b), days[0]);
      tiles.push(tile("Downloads this week", fmt(sum(days.slice(0, 7))), vs(sum(days.slice(0, 7)), sum(days.slice(7, 14)))));
      tiles.push(tile("Best day, last 30", fmt(best.n || 0), shortDate(best.date)));
    } else {
      tiles.push(tile("Downloads, 7 days", fmt(sum(days.slice(0, 7))), "last 30 days: " + fmt(sum(days.slice(0, 30)))));
    }
    const nowD = new Date(), monthKey = nowD.getUTCFullYear() + "-" + String(nowD.getUTCMonth() + 1).padStart(2, "0");
    const monthName = nowD.toLocaleDateString("en-US", { timeZone: "UTC", month: "long" });
    const monthDays = days.filter((d) => d.date.startsWith(monthKey)).reverse().map((d) => ({ date: d.date, n: d.n || 0 }));
    const byMonth = new Map();
    for (const d of days) if (d.date >= LAUNCH_DATE && d.date.slice(0, 7) < monthKey) byMonth.set(d.date.slice(0, 7), (byMonth.get(d.date.slice(0, 7)) || 0) + (d.n || 0));
    const past = [...byMonth].reverse().map(([k, n]) => ({ date: k + "-01", n, label: new Date(k + "-01T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short" }) }));
    iosChart = monthDays.length ? barChart("iOS downloads per day, " + monthName + " so far", monthDays, "#2e7d5b", "downloads", { span: "so far this month", note: "Day of month. Apple reports lag about two days, so the last two bars may still rise." }) : "";
    iosChart += past.length ? barChart("iOS downloads by month, earlier months", past, "#7fb59a", "downloads", { label: (d) => d.label, span: "in earlier months", events: false })
      : '<div style="margin:18px 0 0;font-size:12px;color:#5b6b64">iOS downloads by month, earlier months: none yet (the app went live ' + shortDate(LAUNCH_DATE) + ").</div>";
  }
  let mapsChart = "";
  if (maps.status === "fulfilled" && maps.value) {
    const m = maps.value;
    if (WEEKLY) {
      const wk = m.daily.slice(-7).reduce((a, d) => a + d.n, 0), prev = m.daily.slice(-14, -7).reduce((a, d) => a + d.n, 0);
      tiles.push(tile("Google Maps this week", fmt(wk), vs(wk, prev)));
    }
    tiles.push(tile("Google Maps, " + m.monthName + " so far", fmt(m.mtd), "of about 10,000 free a month; on pace for " + fmt(m.projected)));
    if (!WEEKLY) tiles.push(tile("Google Maps, 24 hours", fmt(m.day), m.kind + "; 7 days: " + fmt(m.week)));
    mapsChart = barChart("Google Maps " + m.kind + " per day, " + m.monthName + " so far", m.monthDaily, "#3b6fb6", m.kind, { span: "so far this month", note: "Day of month" });
    if (m.pastMonths.length) mapsChart += barChart("Google Maps " + m.kind + " by month, earlier months", m.pastMonths, "#7d93b8", m.kind, { label: (d) => d.label, span: "in earlier months", events: false });
  }
  if (tiles.length) html += '<table width="100%" style="border-collapse:separate;border-spacing:8px 0;margin:0 -8px"><tr>' + tiles.join("") + "</tr></table>";
  let quarter = "";
  if (maps.status === "fulfilled" && maps.value) {
    const m = maps.value;
    quarter = '<div style="margin:22px 0 6px;font-weight:bold;font-size:15px">Google Maps usage, ' + escapeHtml(m.quarterLabel) + " (quarter to date)</div>" +
      '<table style="border-collapse:collapse;font-size:14px">' +
      m.quarterMonths.map((q) => '<tr><td style="padding:3px 24px 3px 0">' + escapeHtml(q.label) + '</td><td align="right" style="padding:3px 0">' + fmt(q.n) + " " + m.kind + "</td></tr>").join("") +
      '<tr><td style="padding:6px 24px 3px 0;border-top:1px solid #9aa8a1;font-weight:bold">Quarter total</td><td align="right" style="padding:6px 0 3px;border-top:1px solid #9aa8a1;font-weight:bold">' + fmt(m.quarterTotal) + " " + m.kind + "</td></tr></table>";
  }
  return html + iosChart + mapsChart + quarter;
}

async function sendEmail(subject, rows) {
  const user = env.GMAIL_USER;
  const pass = (env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
  if (!user || !pass) return false;
  const to = env.EMAIL_TO || user;
  const masked = to.replace(/^(.{2}).*(@.*)$/, "$1***$2");
  const text = subject + "\n\n" + rows.map(([k, v]) => k + ": " + v).join("\n") + "\n";
  let summary = "";
  try { summary = await executiveHtml(); } catch (e) { console.error("Charts skipped: " + e.message); }
  const html = '<div style="font-family:Arial,sans-serif;font-size:15px;color:#17221e;max-width:640px"><h2 style="margin:0 0 14px">' + escapeHtml(subject) + "</h2>" +
    summary + '<div style="margin:24px 0 6px;font-weight:bold;font-size:15px">Details</div>' +
    '<table style="border-collapse:collapse">' +
    rows.map(([k, v]) => '<tr><td style="padding:6px 14px 6px 0;vertical-align:top;font-weight:bold;white-space:nowrap">' + escapeHtml(k) +
      '</td><td style="padding:6px 0">' + escapeHtml(v) + "</td></tr>").join("") +
    '</table><p style="color:#6b7280;font-size:12px;margin-top:16px">Automatic daily report for the Pause for Paws app owner.</p></div>';
  if (env.PREVIEW_FILE) { (await import("node:fs")).writeFileSync(env.PREVIEW_FILE, html); console.log("Preview written to " + env.PREVIEW_FILE); }
  if (DRY) { console.log("(email not sent: dry run; it would go to " + masked + ")"); return true; }
  const nodemailer = await loadNodemailer();
  const transport = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
  const info = await transport.sendMail({ from: '"Pause for Paws report" <' + user + ">", to, subject, text, html });
  console.log("Email sent to " + masked + " (" + info.messageId + ")");
  return true;
}

const lines = await Promise.all([freshness(), mapsLoads(), iosInstalls(), androidInstalls()]);
const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" });
const labels = ["Website data", "Google Maps", "iOS downloads", "Android installs"];
const subject = WEEKLY ? "Pause for Paws weekly summary, week ending " + today : "Pause for Paws daily report, " + today;
console.log(subject);
labels.forEach((k, i) => console.log(k + ": " + lines[i]));

if (DRY) {
  // Dry runs also print the daily numbers (counts only) so a one-page PDF can be built from them without sending an email.
  const [i, m] = await Promise.allSettled([iosData(), mapsData()]);
  console.log("REPORT_DATA " + JSON.stringify({ today, launch: LAUNCH_DATE, lines, ios: i.value || null, maps: m.value || null }));
}

let delivered = false;
try {
  delivered = await sendEmail(subject, labels.map((k, i) => [k, lines[i]]));
} catch (e) {
  console.error("Email failed: " + String(e.message).slice(0, 200));
  process.exit(1);   // fail the run so GitHub emails you about it
}
// WhatsApp stays switched off: Meta has locked the sending account until the business is verified.
if (env.WA_ENABLED === "1") { await send([today, ...lines]); delivered = true; }
if (!delivered) console.log("(nothing sent: no email settings found. Add GMAIL_USER and GMAIL_APP_PASSWORD as secrets.)");
