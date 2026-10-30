from __future__ import annotations

"""Remplit la base avec des données de démonstration FICTIVES.

    cd server
    python seed_demo.py            # ajoute des détections de démo (si la base est vide de détections)
    python seed_demo.py --reset    # efface TOUTE la base puis recrée 5 voitures + 5 conducteurs + détections

Les noms, matricules et téléphones sont inventés.
"""
import argparse
import random
import time

import db
from demo_image import make_demo_jpeg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true", help="efface la base avant")
    ap.add_argument("--count", type=int, default=14, help="nombre de détections de démo")
    args = ap.parse_args()

    if args.reset and db.DB_PATH.exists():
        db.DB_PATH.unlink()
    db.init_db(seed=True)

    with db.conn() as c:
        if c.execute("SELECT COUNT(*) FROM detections").fetchone()[0] > 0 and not args.reset:
            print("Il y a déjà des détections. Utilise --reset pour tout recommencer.")
            return

    rnd = random.Random(42)
    vehicles = db.list_vehicles()
    now = time.time()
    for i in range(args.count):
        v = rnd.choice(vehicles)
        ts = now - rnd.uniform(60, 6 * 86400)
        day = time.strftime("%Y-%m-%d", time.localtime(ts))
        folder = db.CAPTURES_DIR / day
        folder.mkdir(parents=True, exist_ok=True)
        name = f"{v['code']}_{time.strftime('%H%M%S', time.localtime(ts))}_demo{i}.jpg"
        secs = round(rnd.uniform(5.0, 8.5), 1)
        (folder / name).write_bytes(make_demo_jpeg(secs, v["code"], seed=i))
        lat = 35.8256 + rnd.uniform(-0.01, 0.02)
        lon = 10.5908 + rnd.uniform(0.0, 0.04)
        status = rnd.choice(["acknowledged", "acknowledged", "escalated", "new"])
        det_id = db.insert_detection(v["code"], int(ts * 1000), lat, lon, secs, 4,
                                     f"captures/{day}/{name}", status)
        db.insert_alert({"ts": int(ts * 1000), "vehicle_id": v["code"], "level": 4,
                         "title": "Conducteur endormi",
                         "message": f"Yeux fermés depuis {secs:.0f} s. Appel d'urgence (SIMULÉ).",
                         "detection_id": det_id})
        # quelques alertes de niveau 1 autour
        for _ in range(rnd.randint(0, 2)):
            db.insert_alert({"ts": int((ts - rnd.uniform(5, 60)) * 1000), "vehicle_id": v["code"],
                             "level": 1, "title": "Alarme conducteur",
                             "message": "Yeux fermés depuis 2 s", "detection_id": None})
    print(f"OK: {args.count} détections de démonstration créées ({len(vehicles)} voitures).")


if __name__ == "__main__":
    main()
