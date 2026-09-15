import csv, json, math, collections, datetime, calendar
from pathlib import Path

SRC = Path(__file__).parent / "2025 - IA Data.csv"
OUT = Path(__file__).parent / "corridors.json"


rows = []
with SRC.open(encoding="utf-8-sig", newline="") as f:
    for r in csv.DictReader(f):
        try:
            rows.append({
                "id": r["Case Number"].strip(),
                "lat": float(r["Latitude"]),
                "lng": float(r["Longitude"]),
                "date": r["Date of Crash"].strip(),
                "sev": r["Crash Severity"].strip(),
            })
        except (ValueError, KeyError):
            continue

print("parsed rows:", len(rows))
print("severities:", collections.Counter(x["sev"] for x in rows))

# monthly + worst dates, from the team's own data
months = collections.Counter()
dates = collections.Counter()
weekdays = collections.Counter()
for x in rows:
    d = x["date"]
    if len(d) == 8 and d.isdigit():
        months[int(d[4:6])] += 1
        dates[f"{d[4:6]}-{d[6:8]}"] += 1
        weekdays[datetime.date(int(d[:4]), int(d[4:6]), int(d[6:8])).weekday()] += 1
YEAR = int(rows[0]["date"][:4]) if rows else 2025

MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
monthly = [{"month": MONTH_NAMES[m-1], "crashes": months.get(m, 0)} for m in range(1, 13)]
top_dates = [{"date": d, "crashes": c} for d, c in dates.most_common(10)]
# crashes per calendar day, one list per month (index 0 = the 1st of the month)
daily = [[dates.get(f"{m:02d}-{day:02d}", 0) for day in range(1, calendar.monthrange(YEAR, m)[1] + 1)]
         for m in range(1, 13)]
WEEKDAY_NAMES = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
weekday = [{"day": WEEKDAY_NAMES[i], "crashes": weekdays.get(i, 0)} for i in range(7)]

# Reviewed reports sent in by drivers (not in the DOT file). Keep this list short and verified.
USER_REPORTS = [
    {"id": "R-001", "lat": 41.5811505, "lng": -93.8617349, "species": "Coyote",
     "road": "SE Florence Dr and SE Esker Ridge Dr, Waukee", "reportedOn": "2026-09-06"},
]

# ---- corridor clustering: grid pre-bucket, then greedy merge (same 4km rule) ----
RADIUS_KM = 4.0
LAT_KM = 111.0

def dist_km(a_lat, a_lng, b_lat, b_lng):
    lng_km = LAT_KM * math.cos(math.radians((a_lat + b_lat) / 2))
    return math.hypot((a_lat - b_lat) * LAT_KM, (a_lng - b_lng) * lng_km)

CELL = RADIUS_KM / LAT_KM  # ~0.036 deg

def cluster(points):
    grid = collections.defaultdict(list)   # cell -> cluster indices
    clusters = []
    for p in points:
        ci, cj = int(p["lat"] / CELL), int(p["lng"] / CELL)
        found = None
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for idx in grid.get((ci + di, cj + dj), ()):
                    c = clusters[idx]
                    if dist_km(p["lat"], p["lng"], c["lat"], c["lng"]) <= RADIUS_KM:
                        found = idx
                        break
                if found is not None:
                    break
            if found is not None:
                break
        if found is None:
            clusters.append({"lat": p["lat"], "lng": p["lng"], "pts": [p]})
            grid[(ci, cj)].append(len(clusters) - 1)
        else:
            c = clusters[found]
            c["pts"].append(p)
            n = len(c["pts"])
            c["lat"] = sum(q["lat"] for q in c["pts"]) / n
            c["lng"] = sum(q["lng"] for q in c["pts"]) / n
    return clusters

def summarize(clusters, prefix, limit=None, min_crashes=1):
    out = []
    ranked = sorted(clusters, key=lambda c: len(c["pts"]), reverse=True)
    for i, c in enumerate(ranked, 1):
        n = len(c["pts"])
        if n < min_crashes:
            continue
        sev = collections.Counter(p["sev"] for p in c["pts"])
        injury = sum(v for k, v in sev.items() if "Injury" in k or "Fatal" in k)
        out.append({
            "id": f"{prefix}{i:03d}",
            "lat": round(c["lat"], 5),
            "lng": round(c["lng"], 5),
            "crashes": n,
            "injuryOrWorse": injury,
            "risk": "Highest" if n >= 12 else "Elevated" if n >= 5 else "Monitored",
        })
        if limit and len(out) >= limit:
            break
    return out

all_clusters = cluster(rows)
print("statewide clusters:", len(all_clusters))
sizes = collections.Counter(len(c["pts"]) for c in all_clusters)
print("cluster size distribution (top):", sorted(sizes.items())[-8:])

DSM = {"south": 41.15, "north": 42.10, "west": -94.55, "east": -92.90}
dsm_rows = [r for r in rows
            if DSM["south"] <= r["lat"] <= DSM["north"] and DSM["west"] <= r["lng"] <= DSM["east"]]
dsm_clusters = cluster(dsm_rows)
print("des moines area rows:", len(dsm_rows), "clusters:", len(dsm_clusters))

sev_all = collections.Counter(x["sev"] for x in rows)
injury_all = sum(v for k, v in sev_all.items() if "Injury" in k or "Fatal" in k)

fatal_all = sum(v for k, v in sev_all.items() if "Fatal" in k)

payload = {
    "generated": datetime.date.today().isoformat(),
    "year": YEAR,
    "source": f"Iowa DOT crash records, calendar year {YEAR} (animal-related)",
    "totalCrashes": len(rows),
    "injuryOrWorse": injury_all,
    "fatal": fatal_all,
    "severityBreakdown": dict(sev_all),
    "statewideCorridors": len([c for c in all_clusters if len(c["pts"]) >= 5]),
    "monthly": monthly,
    "daily": daily,
    "weekday": weekday,
    "topDates": top_dates,
    "reports": USER_REPORTS,
    "corridors": summarize(all_clusters, "IA", limit=400, min_crashes=3),
    "desMoines": {
        "totalCrashes": len(dsm_rows),
        "corridors": summarize(dsm_clusters, "DM", limit=250, min_crashes=2),
    },
}
OUT.write_text(json.dumps(payload, separators=(",", ":")))
print("wrote", OUT, OUT.stat().st_size, "bytes")
print("peak month:", max(monthly, key=lambda m: m["crashes"]))
print("top dates:", top_dates[:5])
print("top corridors:", payload["corridors"][:3])
