const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const files = ["index.html", "app.js", "styles.css", "privacy-policy.html", "corridors.json", "iowa-zips.json", "waze-archive-test-data.csv"];

for (const file of files) {
  fs.copyFileSync(path.join(root, file), path.join(root, "www", file));
}
fs.mkdirSync(path.join(root, "www", "data"), { recursive: true });
fs.copyFileSync(path.join(root, "data", "corridors.json"), path.join(root, "www", "data", "corridors.json"));

// Gitignored, so absent in a fresh clone — index.html loads it for the Maps key.
const mapsConfig = "google-maps-config.js";
const hasMapsConfig = fs.existsSync(path.join(root, mapsConfig));
if (hasMapsConfig) {
  fs.copyFileSync(path.join(root, mapsConfig), path.join(root, "www", mapsConfig));
} else {
  console.warn(`WARNING: ${mapsConfig} not found at repo root — the map will not load.`);
}

console.log(`Synced ${files.length + 1 + (hasMapsConfig ? 1 : 0)} files into www/`);
