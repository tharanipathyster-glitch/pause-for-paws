"""Build corridors.json for the Pause for Paws website.

Pulls every animal-related crash (major cause = Animal) for the years in YEARS
straight from the Iowa DOT Crash Data feature service, caches the raw rows in
data/crashes-<year>.csv (so the site can be rebuilt offline and the repo keeps
a snapshot), then writes one JSON file with a full set of statistics and
corridor clusters for each year.

    python precompute_corridors.py            # fetch live, fall back to cache
    python precompute_corridors.py --offline  # cache only, no network
"""
import csv, json, math, sys, collections, datetime, calendar, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
CACHE_DIR = ROOT / "data"
OUT = ROOT / "corridors.json"

SERVICE = "https://gis.iowadot.gov/agshost/rest/services/Traffic_Safety/Crash_Data/FeatureServer/0/query"
PAGE = 2000  # the service's maxRecordCount
THIS_YEAR = datetime.date.today().year
YEARS = [THIS_YEAR, THIS_YEAR - 1]
OFFLINE = "--offline" in sys.argv

# CSEV codes in the service
SEVERITY = {1: "Fatal Crash", 2: "Suspected Serious Injury Crash", 3: "Suspected Minor Injury Crash",
            4: "Possible/Unknown Injury Crash", 5: "Property Damage Only"}

# Reviewed reports sent in by drivers (not in the DOT file). Keep this list short and verified.
USER_REPORTS = [
    {"id": "R-001", "lat": 41.5811505, "lng": -93.8617349, "species": "Coyote",
     "road": "SE Florence Dr and SE Esker Ridge Dr, Waukee", "reportedOn": "2026-09-06"},
]


# ---------------------------------------------------------------- fetch / cache

def fetch_year(year):
    """Return rows [{id, lat, lng, date 'YYYYMMDD', sev}] for one year from the live service."""
    rows, offset = [], 0
    where = f"MAJCSE=1 AND CRASH_DATE >= DATE '{year}-01-01' AND CRASH_DATE < DATE '{year + 1}-01-01'"
    while True:
        params = {
            "f": "json", "where": where, "outFields": "CASENUMBER,CRASH_DATE,CSEV", "outSR": "4326",
            "orderByFields": "CRASH_KEY", "resultOffset": offset, "resultRecordCount": PAGE,
        }
        req = urllib.request.Request(SERVICE, data=urllib.parse.urlencode(params).encode(),
                                     headers={"User-Agent": "pause-for-paws/1.0 (+https://pauseforpawsusa.org)"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = json.load(resp)
        if "error" in payload:
            raise RuntimeError(payload["error"])
        feats = payload.get("features", [])
        for f in feats:
            a, g = f["attributes"], f.get("geometry") or {}
            if g.get("x") is None or a.get("CRASH_DATE") is None:
                continue
            # CRASH_DATE is midnight UTC on the crash date, so UTC gives the right calendar day
            d = datetime.datetime.fromtimestamp(a["CRASH_DATE"] / 1000, datetime.timezone.utc).date()
            rows.append({"id": str(int(a["CASENUMBER"])) if a.get("CASENUMBER") else "", "lat": g["y"], "lng": g["x"],
                         "date": d.strftime("%Y%m%d"), "sev": SEVERITY.get(a.get("CSEV"), "Unknown")})
        offset += len(feats)
        if not payload.get("exceededTransferLimit") or not feats:
            break
    return rows


def cache_path(year):
    return CACHE_DIR / f"crashes-{year}.csv"


def write_cache(year, rows):
    CACHE_DIR.mkdir(exist_ok=True)
    with cache_path(year).open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Case Number", "Date of Crash", "Crash Severity", "Longitude", "Latitude"])
        for r in rows:
            w.writerow([r["id"], r["date"], r["sev"], f'{r["lng"]:.10g}', f'{r["lat"]:.10g}'])


def read_cache(year):
    p = cache_path(year)
    if not p.exists():
        return []
    rows = []
    with p.open(encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            try:
                rows.append({"id": r["Case Number"].strip(), "lat": float(r["Latitude"]), "lng": float(r["Longitude"]),
                             "date": r["Date of Crash"].strip(), "sev": r["Crash Severity"].strip()})
            except (ValueError, KeyError):
                continue
    return rows


def load_year(year):
    if not OFFLINE:
        try:
            rows = fetch_year(year)
            print(f"{year}: fetched {len(rows)} rows from Iowa DOT")
            write_cache(year, rows)
            return rows, "live"
        except Exception as exc:  # network down, service changed, etc.
            print(f"{year}: live fetch failed ({exc}); using cache")
    rows = read_cache(year)
    print(f"{year}: {len(rows)} rows from cache")
    return rows, "cache"


# ---------------------------------------------------------------- clustering

RADIUS_KM = 4.0
LAT_KM = 111.0
CELL = RADIUS_KM / LAT_KM  # ~0.036 deg


def dist_km(a_lat, a_lng, b_lat, b_lng):
    lng_km = LAT_KM * math.cos(math.radians((a_lat + b_lat) / 2))
    return math.hypot((a_lat - b_lat) * LAT_KM, (a_lng - b_lng) * lng_km)


def cluster(points):
    """Greedy merge: each point joins the first existing cluster within RADIUS_KM, else starts one."""
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


def is_injury(sev):
    return "Injury" in sev or "Fatal" in sev


def summarize(clusters, prefix, limit=None, min_crashes=1):
    out = []
    ranked = sorted(clusters, key=lambda c: len(c["pts"]), reverse=True)
    for i, c in enumerate(ranked, 1):
        n = len(c["pts"])
        if n < min_crashes:
            continue
        injury = sum(1 for p in c["pts"] if is_injury(p["sev"]))
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


# ---------------------------------------------------------------- per-year stats

MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
DSM = {"south": 41.15, "north": 42.10, "west": -94.55, "east": -92.90}


def build_year(year, rows, source):
    months, dates, weekdays = collections.Counter(), collections.Counter(), collections.Counter()
    latest = None
    for x in rows:
        d = x["date"]
        if len(d) == 8 and d.isdigit():
            dt = datetime.date(int(d[:4]), int(d[4:6]), int(d[6:8]))
            months[dt.month] += 1
            dates[f"{d[4:6]}-{d[6:8]}"] += 1
            weekdays[dt.weekday()] += 1
            latest = dt if latest is None or dt > latest else latest

    monthly = [{"month": MONTH_NAMES[m - 1], "crashes": months.get(m, 0)} for m in range(1, 13)]
    daily = [[dates.get(f"{m:02d}-{day:02d}", 0) for day in range(1, calendar.monthrange(year, m)[1] + 1)]
             for m in range(1, 13)]
    weekday = [{"day": WEEKDAY_NAMES[i], "crashes": weekdays.get(i, 0)} for i in range(7)]
    top_dates = [{"date": d, "crashes": c} for d, c in dates.most_common(10)]

    all_clusters = cluster(rows)
    dsm_rows = [r for r in rows
                if DSM["south"] <= r["lat"] <= DSM["north"] and DSM["west"] <= r["lng"] <= DSM["east"]]
    dsm_clusters = cluster(dsm_rows)

    sev_all = collections.Counter(x["sev"] for x in rows)
    partial = year == THIS_YEAR
    print(f"{year}: {len(rows)} crashes, {len(all_clusters)} clusters, peak {max(monthly, key=lambda m: m['crashes'])}, "
          f"latest {latest}")
    return {
        "year": year,
        "partial": partial,
        "through": latest.isoformat() if latest else None,
        "source": source,
        "totalCrashes": len(rows),
        "injuryOrWorse": sum(1 for x in rows if is_injury(x["sev"])),
        "fatal": sum(1 for x in rows if "Fatal" in x["sev"]),
        "severityBreakdown": dict(sev_all),
        "monthly": monthly,
        "daily": daily,
        "weekday": weekday,
        "topDates": top_dates,
        "corridors": summarize(all_clusters, "IA", limit=400, min_crashes=3),
        "desMoines": {
            "totalCrashes": len(dsm_rows),
            "corridors": summarize(dsm_clusters, "DM", limit=250, min_crashes=2),
        },
    }


# ---------------------------------------------------------------- main

years = {}
for year in YEARS:
    rows, source = load_year(year)
    if rows:
        years[str(year)] = build_year(year, rows, source)

if not years:
    sys.exit("no crash data available (live fetch failed and no cache)")

default_year = max(int(y) for y in years)
payload = {
    "generated": datetime.date.today().isoformat(),
    "source": "Iowa DOT Crash Data feature service (Traffic_Safety/Crash_Data), crashes whose major cause is Animal",
    "defaultYear": default_year,
    "years": years,
    "reports": USER_REPORTS,
}
OUT.write_text(json.dumps(payload, separators=(",", ":")))
print("wrote", OUT, OUT.stat().st_size, "bytes; default year", default_year)
