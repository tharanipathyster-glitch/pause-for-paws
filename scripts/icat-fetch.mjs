// Fallback crash data from ICAT (Iowa DOT's Iowa Crash Analysis Tool), used when the DOT open-data feed has no rows for the year.
// It makes the same calls the ICAT web page makes (an undocumented service), pages through the animal-related crashes for one year
// and, only if every check passes, replaces data/crashes-<year>.csv.
//
// usage: node scripts/icat-fetch.mjs <year> [--dry]
// exit codes: 0 = file updated, 10 = saved file already matches ICAT, 1 = failed or refused (saved file untouched)
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://icat.iowadot.gov";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const year = process.argv[2];
const DRY = process.argv.includes("--dry");
const PAGE = 100;               // rows per request, the size the ICAT table itself uses
const PAUSE_MS = 300;           // be gentle with a public server
const COLS = [333, 589, 501, 1043, 1042];   // ICAT column ids: Case Number, Date of Crash, Crash Severity, Longitude, Latitude
const HEADER = "Case Number,Date of Crash,Crash Severity,Longitude,Latitude";
const FORM = "application/x-www-form-urlencoded; charset=UTF-8";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!/^\d{4}$/.test(year || "")) { console.error("usage: node scripts/icat-fetch.mjs <year> [--dry]"); process.exit(1); }
const fail = (msg) => { console.error("ICAT fetch refused: " + msg); process.exit(1); };

async function call(method, path, body, tries = 3) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(BASE + path, {
        method,
        headers: { "User-Agent": "pause-for-paws-data-refresh (student project; pauseforpawsusa.org)", Accept: "application/json, text/plain, */*", ...(body != null ? { "Content-Type": FORM } : {}) },
        body,
        signal: AbortSignal.timeout(30000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 120)}`);
      return text;
    } catch (e) { lastErr = e; if (i < tries) await sleep(2000 * i); }
  }
  throw new Error(`${method} ${path.split("?")[0]} failed: ${lastErr.message}`);
}

// What is saved now
const savedPath = join(ROOT, "data", `crashes-${year}.csv`);
let savedIds = new Set(), savedNewest = "";
if (existsSync(savedPath)) {
  for (const line of readFileSync(savedPath, "utf8").replace(/^﻿/, "").split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const c = line.split(",");
    savedIds.add(c[0].trim());
    if (c[1] && c[1].trim() > savedNewest) savedNewest = c[1].trim();
  }
}

// Ask ICAT for the year's animal-related crashes (same project definition the page posts when "Animal-related" is ticked)
const id = randomUUID();
const project = {
  sessionId: id, name: "", author: "", description: "", lastupdated: "", selectedJurisdictionId: "", selectedJurisdictions: [],
  locationType: "", locationFilters: [], selectedYears: [year], queryFilters: [{ id: "F_Q_ANIMAL", values: [] }], queryBuilder: null,
  spatialFilters: [], spatialFiltersInactive: [], symbolShape: "Circle", symbolSize: "8", symbolColor: "255,0,0",
  showNonSelected: "true", showThematics: "false", thematicTopic: null, reportFile: null,
};
await call("POST", `/api/Project?replaceSessionId=${randomUUID()}`, "=" + JSON.stringify(project));
await sleep(500);
const count = JSON.parse(await call("GET", `/api/project/${id}/count`)).CrashCount;
console.log(`ICAT reports ${count} animal-related crashes for ${year}; saved file has ${savedIds.size} (newest ${savedNewest || "none"})`);
if (!count) fail("ICAT returned zero crashes for this year");

const rows = [];
for (let page = 1; rows.length < count; page++) {
  if (page > 300) fail("more than 300 pages, stopping");
  const j = JSON.parse(await call("POST", `/api/project/${id}/data/${page}/${PAGE}?sortColumnId=333&sortAsc=true`, "=" + JSON.stringify(COLS)));
  if (page === 1 && (j.Columns || []).slice(0, 5).join(",") !== HEADER) fail("unexpected columns from ICAT: " + (j.Columns || []).join(","));
  if (!j.Rows || !j.Rows.length) break;
  for (const r of j.Rows) rows.push(r.slice(0, 5).map((v) => String(v).trim()));
  await sleep(PAUSE_MS);
}

// Checks, all of which must pass before anything is written
if (rows.length !== count) fail(`fetched ${rows.length} rows but ICAT counted ${count}`);
const ids = new Set(rows.map((r) => r[0]));
if (ids.size !== rows.length) fail(`${rows.length - ids.size} repeated case numbers`);
for (const r of rows) {
  if (!/^\d{8}$/.test(r[1]) || r[1].slice(0, 4) !== year) fail(`bad date ${r[1]} on case ${r[0]}`);
  if (!r[2]) fail(`no severity on case ${r[0]}`);
  if (!isFinite(parseFloat(r[3])) || !isFinite(parseFloat(r[4]))) fail(`bad coordinates on case ${r[0]}`);
}
const newest = rows.map((r) => r[1]).sort().pop();
if (rows.length < savedIds.size) fail(`ICAT has ${rows.length} crashes but ${savedIds.size} are already saved; not shrinking the data`);
if (newest < savedNewest) fail(`ICAT's newest crash (${newest}) is older than the saved newest (${savedNewest})`);
const same = rows.length === savedIds.size && rows.every((r) => savedIds.has(r[0]));
if (same) { console.log("Saved file already matches ICAT; nothing to do."); process.exit(10); }

const added = rows.filter((r) => !savedIds.has(r[0])).length;
console.log(`All checks passed: ${rows.length} crashes (${added} new), newest ${newest}.`);
if (DRY) { console.log("--dry: not writing the file."); process.exit(0); }
writeFileSync(savedPath, HEADER + "\n" + rows.map((r) => r.join(",")).join("\n") + "\n");
console.log(`Wrote ${savedPath}`);
process.exit(0);
