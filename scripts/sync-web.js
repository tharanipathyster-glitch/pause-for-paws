const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const files = ["index.html", "app.js", "styles.css", "privacy-policy.html", "waze-archive-test-data.csv"];

for (const file of files) {
  fs.copyFileSync(path.join(root, file), path.join(root, "www", file));
}
fs.mkdirSync(path.join(root, "www", "data"), { recursive: true });
fs.copyFileSync(path.join(root, "data", "corridors.json"), path.join(root, "www", "data", "corridors.json"));

console.log(`Synced ${files.length + 1} files into www/`);
