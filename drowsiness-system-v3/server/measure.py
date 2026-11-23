from __future__ import annotations

"""Mesures pour le rapport: latence, états, alertes "endormi".

    cd server
    python measure.py
Lit  logs/states.csv  et  logs/alerts.csv  (créés par le serveur).
"""
import csv
import statistics
from collections import Counter
from pathlib import Path

LOGS = Path(__file__).resolve().parent / "logs"


def read(name):
    p = LOGS / name
    if not p.exists():
        return []
    with open(p, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main():
    states, alerts = read("states.csv"), read("alerts.csv")
    if not states:
        print("Pas encore de données: lance le serveur et un détecteur d'abord.")
        return
    lat = [float(r["latency_ms"]) for r in states if r.get("latency_ms") not in (None, "")]
    t = [float(r["time"]) for r in states]
    minutes = max((max(t) - min(t)) / 60.0, 1e-6)
    print(f"Messages d'état : {len(states)}  sur {minutes:.1f} min")
    if lat:
        lat_sorted = sorted(lat)
        print(f"Latence (détecteur -> serveur) : moyenne {statistics.mean(lat):.0f} ms, "
              f"médiane {statistics.median(lat):.0f} ms, 95e centile {lat_sorted[int(0.95 * (len(lat) - 1))]:.0f} ms, max {max(lat):.0f} ms")
    print("États :", dict(Counter(r["state"] for r in states)))
    asleep = [r for r in alerts if r["title"] == "Conducteur endormi"]
    print(f"Alertes totales : {len(alerts)}  (niveau 4 'endormi' : {len(asleep)})")
    print(f"Alertes 'endormi' par minute : {len(asleep) / minutes:.2f}")
    print("Astuce faux positifs: filme-toi 2 min yeux ouverts / clignements normaux -> il doit y avoir 0 alerte 'endormi'.")


if __name__ == "__main__":
    main()
