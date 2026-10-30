from __future__ import annotations

"""Crée server/static/route.json = trajet sur de VRAIES routes.

Lancer UNE FOIS (il faut Internet):
    cd detector
    python build_route.py

Le script demande à OSRM (service gratuit, sans clé) de relier les points
ROUTE_WAYPOINTS de server/config.py par la route. Si Internet ne marche pas,
il garde un trajet en lignes droites (la voiture roule quand même).
"""
import json
import sys
import urllib.request
from pathlib import Path

from utils import ROUTE_FILE, ROUTE_WAYPOINTS, haversine_m


def fetch_osrm(waypoints):
    coords = ";".join(f"{lon},{lat}" for lat, lon in waypoints)
    url = (f"https://router.project-osrm.org/route/v1/driving/{coords}"
           "?overview=full&geometries=geojson&continue_straight=true")
    req = urllib.request.Request(url, headers={"User-Agent": "driver-safety-monitor/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.loads(r.read().decode())
    if data.get("code") != "Ok":
        raise RuntimeError(f"OSRM: {data.get('code')} {data.get('message', '')}")
    # GeoJSON = [lon, lat]  ->  on stocke [lat, lon]
    return [[round(lat, 6), round(lon, 6)] for lon, lat in data["routes"][0]["geometry"]["coordinates"]]


def straight_lines(waypoints, step_m=25.0):
    pts = []
    for a, b in zip(waypoints[:-1], waypoints[1:]):
        n = max(1, int(haversine_m(a, b) / step_m))
        for i in range(n):
            f = i / n
            pts.append([round(a[0] + (b[0] - a[0]) * f, 6), round(a[1] + (b[1] - a[1]) * f, 6)])
    pts.append([round(waypoints[-1][0], 6), round(waypoints[-1][1], 6)])
    return pts


def main():
    out = Path(ROUTE_FILE)
    try:
        pts = fetch_osrm(ROUTE_WAYPOINTS)
        fallback = False
        print(f"OK: trajet sur routes réelles ({len(pts)} points)")
    except Exception as e:
        print("Pas d'accès à OSRM:", e)
        print("-> trajet de secours en lignes droites.")
        pts = straight_lines(ROUTE_WAYPOINTS)
        fallback = True
    total = sum(haversine_m(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "fallback": fallback,
        "length_m": round(total),
        "waypoints": [list(p) for p in ROUTE_WAYPOINTS],
        "points": pts,
    }), encoding="utf-8")
    print(f"Écrit: {out}  (longueur ≈ {total / 1000:.1f} km)")
    if fallback:
        sys.exit(1)


if __name__ == "__main__":
    main()
