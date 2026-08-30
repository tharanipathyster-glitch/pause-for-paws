from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import csv
import json
import math
import os

ROOT = Path(__file__).parent
PORT = int(os.environ.get("PORT", "5500"))


def parse_events(text, content_type=""):
    if "json" in content_type or text.lstrip().startswith("["):
        events = json.loads(text)
    else:
        events = list(csv.DictReader(text.splitlines()))
    if not isinstance(events, list) or not events:
        raise ValueError("Archive must contain at least one event.")
    clean = []
    for event in events:
        try:
            lat = float(event["lat"])
            lng = float(event["lng"])
        except (KeyError, TypeError, ValueError):
            raise ValueError("Every event needs numeric lat and lng coordinates.")
        if not -90 <= lat <= 90 or not -180 <= lng <= 180:
            raise ValueError("Coordinates are outside valid latitude/longitude ranges.")
        clean.append({**event, "lat": lat, "lng": lng, "confidence": float(event.get("confidence") or 0.5)})
    return clean


def parse_icat_csv():
    source = ROOT / "2025 - IA Data.csv"
    with source.open(encoding="utf-8-sig", newline="") as file:
        rows = csv.DictReader(file)
        return [{
            "id": row["Case Number"],
            "lat": float(row["Latitude"]),
            "lng": float(row["Longitude"]),
            "species": "Animal-related crash",
            "confidence": 0.8,
            "reportedAt": row["Date of Crash"],
            "severity": row["Crash Severity"],
            "source": "Iowa DOT ICAT 2025",
        } for row in rows]


def des_moines_area(events):
    counties = {
        "Polk / Des Moines": (41.45, 41.85, -93.90, -93.35),
        "Dallas": (41.45, 41.85, -94.10, -93.90),
        "Warren": (41.15, 41.55, -94.10, -93.35),
        "Story": (41.85, 42.10, -93.90, -93.35),
        "Madison": (41.30, 41.65, -94.55, -94.05),
        "Jasper": (41.55, 41.90, -93.35, -92.90),
    }
    selected = []
    for event in events:
        matches = [name for name, (south, north, west, east) in counties.items() if south <= event["lat"] <= north and west <= event["lng"] <= east]
        if matches:
            selected.append({**event, "county": matches[0]})
    return selected


def distance_km(first, second):
    lat_km = 111.0
    lng_km = 111.0 * math.cos(math.radians((first["lat"] + second["lat"]) / 2))
    return math.hypot((first["lat"] - second["lat"]) * lat_km, (first["lng"] - second["lng"]) * lng_km)


def analyze(events):
    clusters = []
    for event in events:
        nearby = next((cluster for cluster in clusters if distance_km(event, cluster["center"]) <= 4), None)
        if nearby:
            nearby["events"].append(event)
            count = len(nearby["events"])
            nearby["center"] = {
                "lat": sum(item["lat"] for item in nearby["events"]) / count,
                "lng": sum(item["lng"] for item in nearby["events"]) / count,
            }
        else:
            clusters.append({"center": {"lat": event["lat"], "lng": event["lng"]}, "events": [event]})
    results = []
    for index, cluster in enumerate(clusters, 1):
        species = sorted({item.get("species", "Wildlife") for item in cluster["events"] if item.get("species")})
        confidence = round(sum(item["confidence"] for item in cluster["events"]) / len(cluster["events"]) * 100)
        results.append({
            "id": f"H{index:02d}",
            "center": cluster["center"],
            "events": len(cluster["events"]),
            "species": " + ".join(species) or "Wildlife",
            "confidence": confidence,
            "risk": "Elevated" if len(cluster["events"]) >= 3 else "Monitored",
        })
    return {"events": len(events), "confidence": round(sum(item["confidence"] for item in events) / len(events) * 100), "clusters": results}


def send_json(handler, payload, status=200):
    body = json.dumps(payload).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/icat-2025":
            try:
                events = parse_icat_csv()
                result = analyze(events)
                result["raw"] = events
                result["source"] = "Iowa DOT ICAT 2025"
                send_json(self, result)
            except Exception as error:
                send_json(self, {"error": str(error)}, 500)
            return
        if self.path == "/api/icat-2025-des-moines":
            try:
                events = des_moines_area(parse_icat_csv())
                result = analyze(events)
                result["raw"] = events
                result["source"] = "Iowa DOT ICAT 2025 / Des Moines area"
                send_json(self, result)
            except Exception as error:
                send_json(self, {"error": str(error)}, 500)
            return
        if self.path == "/api/archive":
            try:
                text = (ROOT / "waze-archive-test-data.csv").read_text(encoding="utf-8")
                send_json(self, analyze(parse_events(text)))
            except Exception as error:
                send_json(self, {"error": str(error)}, 500)
            return
        path = ROOT / ("index.html" if self.path in ("/", "") else self.path.lstrip("/"))
        if path.exists() and path.is_file() and ROOT in path.parents:
            content_type = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".csv": "text/csv"}.get(path.suffix, "application/octet-stream")
            body = path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            send_json(self, {"error": "Not found"}, 404)

    def do_POST(self):
        if self.path != "/api/analyze":
            send_json(self, {"error": "Not found"}, 404)
            return
        length = int(self.headers.get("Content-Length", 0))
        try:
            text = self.rfile.read(length).decode("utf-8")
            result = analyze(parse_events(text, self.headers.get("Content-Type", "")))
            send_json(self, result)
        except (ValueError, json.JSONDecodeError) as error:
            send_json(self, {"error": str(error)}, 400)

    def log_message(self, format, *args):
        if self.path.startswith("/api/"):
            super().log_message(format, *args)


if __name__ == "__main__":
    print(f"Pause for Paws running at http://localhost:{PORT}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
