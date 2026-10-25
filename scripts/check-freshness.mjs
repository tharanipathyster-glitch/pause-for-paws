// Alarm: fails the job (so GitHub emails the repo owner) when the current year's saved crash data has gone stale.
// usage: node scripts/check-freshness.mjs
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_AGE_DAYS = 14;
const now = new Date();
const year = now.getUTCFullYear();
const dayOfYear = Math.floor((Date.UTC(year, now.getUTCMonth(), now.getUTCDate()) - Date.UTC(year, 0, 1)) / 86400000);
const file = join(ROOT, "data", `crashes-${year}.csv`);

if (!existsSync(file)) {
  if (dayOfYear < 45) { console.log(`No ${year} file yet; it is early in the year, so this is fine.`); process.exit(0); }
  console.error(`STALE: data/crashes-${year}.csv does not exist.`); process.exit(1);
}
let newest = "", rows = 0;
for (const line of readFileSync(file, "utf8").split(/\r?\n/).slice(1)) {
  if (!line.trim()) continue;
  rows++;
  const d = line.split(",")[1].trim();
  if (d > newest) newest = d;
}
if (!newest) { console.error(`STALE: no dated rows in data/crashes-${year}.csv`); process.exit(1); }
const newestDate = new Date(Date.UTC(+newest.slice(0, 4), +newest.slice(4, 6) - 1, +newest.slice(6, 8)));
const age = Math.floor((now - newestDate) / 86400000);
console.log(`${year}: ${rows} saved crashes, newest ${newest}, ${age} days old (limit ${MAX_AGE_DAYS}).`);
if (age > MAX_AGE_DAYS) {
  console.error(`STALE: the newest ${year} crash is ${age} days old. The Iowa DOT feed and the ICAT fallback both failed to bring in newer data. ` +
    `Export from ICAT by hand (statewide, ${year}, Animal-related, crash table, Export Data as CSV) and load it.`);
  process.exit(1);
}
