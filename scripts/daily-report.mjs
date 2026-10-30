// Daily status report for Pause for Paws, sent to WhatsApp through Meta's WhatsApp Cloud API.
// Run: node scripts/daily-report.mjs          (prints the message; sends only when the WA_* secrets are set)
//      node scripts/daily-report.mjs --dry    (never sends; the workflow's dry_run input does the same)
// Each source returns one short line. A source that is not set up yet says so instead of failing the report.
import { createSign } from "node:crypto";

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

async function mapsLoads() {
  if (!env.GCP_SERVICE_ACCOUNT_JSON) return "not set up yet";
  try {
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
    let kind = "map loads";
    if (!week) {
      day = await monitoringSum(token, project, requests, 24);
      week = await monitoringSum(token, project, requests, 168);
      kind = "requests";
    }
    return day.toLocaleString("en-US") + " " + kind + " in the last 24 hours, " + week.toLocaleString("en-US") +
      " in 7 days (free allowance about 10,000 a month)";
  } catch (e) {
    return "could not read Google usage (" + String(e.message).slice(0, 80) + ")";
  }
}

async function iosInstalls() {
  if (!env.ASC_KEY_ID || !env.ASC_ISSUER_ID || !env.ASC_PRIVATE_KEY || !env.ASC_VENDOR) return "not set up yet";
  return "not set up yet";   // to be filled in with the App Store Connect sales report
}

async function androidInstalls() {
  if (!env.GCP_SERVICE_ACCOUNT_JSON || !env.PLAY_BUCKET) return "not set up yet";
  return "not set up yet";   // to be filled in with the Play Console installs report
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

const lines = await Promise.all([freshness(), mapsLoads(), iosInstalls(), androidInstalls()]);
const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" });
console.log("Pause for Paws daily report, " + today);
["Website data", "Google Maps", "iOS installs", "Android installs"].forEach((k, i) => console.log(k + ": " + lines[i]));
await send([today, ...lines]);
