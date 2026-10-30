from __future__ import annotations

"""Faux conducteurs: envoient un scénario sans webcam ni modèle (une ou plusieurs voitures).

    python fake_driver.py                    # 1 voiture (car01)
    python fake_driver.py --vehicles 5       # car01 ... car05, chacune sur le trajet
    python fake_driver.py --http             # sans Mosquitto (envoi par HTTP)
    python fake_driver.py --fast             # scénario plus court (endormi au bout de ~15 s)

Scénario d'une voiture (en boucle): yeux ouverts -> yeux fermés 2.5 s (bip) ->
yeux ouverts -> yeux fermés 7 s (ENDORMI à 5 s: capture + alerte niveau 4) ->
yeux ouverts -> visage perdu 4 s -> yeux ouverts.
"""
import argparse
import json
import random
import threading
import time
import urllib.request

from utils import RouteSimulator, DEFAULT_SPEED_KMH, EYES_CLOSED_SECONDS

# (type, durée en s)   type: open / closed / noface
SCENARIO = [("open", 12), ("closed", 2.5), ("open", 8), ("closed", 7), ("open", 10),
            ("noface", 4), ("open", 15)]
SCENARIO_FAST = [("open", 6), ("closed", 2.5), ("open", 4), ("closed", 7), ("open", 8)]


def post(url: str, data: bytes, ctype: str, timeout: float = 3.0):
    req = urllib.request.Request(url, data=data, headers={"Content-Type": ctype})
    return urllib.request.urlopen(req, timeout=timeout).read()


def run_vehicle(args, idx: int, stop: threading.Event):
    vehicle = f"car{idx + 1:02d}"
    scenario = SCENARIO_FAST if args.fast else SCENARIO
    client = None
    if not args.http:
        import paho.mqtt.client as mqtt
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"fake-{vehicle}")
        client.will_set(f"car/{vehicle}/status", "offline", qos=1, retain=True)
        client.on_connect = lambda c, u, f, rc, pr: c.publish(
            f"car/{vehicle}/status", "online", qos=1, retain=True)
        client.connect_async(args.broker, args.port, keepalive=30)
        client.loop_start()

    speed = args.speed * random.Random(idx).uniform(0.85, 1.15)
    route = RouteSimulator(speed_kmh=speed, start_frac=idx / max(args.vehicles, 1))
    dt = 1.0 / args.hz
    # Décalage: les voitures ne s'endorment pas toutes en même temps
    offset = (idx * 17) % sum(d for _, d in scenario)
    print(f"[{vehicle}] en marche ({speed:.0f} km/h)")
    first = True
    try:
        while not stop.is_set():
            t_in_loop = 0.0
            for kind, seconds in scenario:
                n = int(seconds * args.hz)
                closed_s = 0.0
                asleep_sent = False
                for k in range(n):
                    if stop.is_set():
                        return
                    t_in_loop += dt
                    if first and t_in_loop < offset:
                        continue  # on saute le début pour décaler
                    lat, lon, heading, progress = route.step(dt)
                    if kind == "closed":
                        closed_s += dt
                        state = "Asleep" if closed_s >= EYES_CLOSED_SECONDS else "EyesClosed"
                    elif kind == "noface":
                        state, closed_s = "NoFace", 0.0
                    else:
                        state, closed_s = "EyesOpen", 0.0
                    payload = {
                        "vehicle_id": vehicle, "state": state,
                        "eyes_closed_s": round(closed_s, 2),
                        "confidence": round(random.uniform(0.85, 0.98), 3),
                        "lat": round(lat, 6), "lon": round(lon, 6),
                        "heading": round(heading, 1), "route_progress": round(progress, 1),
                        "speed": round(speed, 1), "impact": False,
                        "ts": int(time.time() * 1000),
                        "infer_ms": round(random.uniform(6, 12), 1),
                        "fps": round(random.uniform(24, 30), 1),
                    }
                    try:
                        if client is not None:
                            client.publish(f"car/{vehicle}/state", json.dumps(payload))
                        else:
                            post(f"{args.server}/api/state", json.dumps(payload).encode(),
                                 "application/json")
                    except Exception as e:
                        if k == 0:
                            print(f"[{vehicle}] envoi impossible: {e}")
                    # Image de démonstration au moment exact "Asleep"
                    if state == "Asleep" and not asleep_sent:
                        asleep_sent = True
                        threading.Thread(target=send_demo_image, args=(args, vehicle, lat, lon, closed_s),
                                         daemon=True).start()
                    time.sleep(dt)
            first = False
    finally:
        if client is not None:
            client.publish(f"car/{vehicle}/status", "offline", qos=1, retain=True)
            time.sleep(0.2)
            client.loop_stop()
            client.disconnect()


def send_demo_image(args, vehicle, lat, lon, secs):
    try:
        from demo_image import make_demo_jpeg
    except Exception as e:
        print("Image de démo impossible (opencv manquant ?):", e)
        return
    time.sleep(0.6)  # l'alerte arrive d'abord
    url = (f"{args.server}/api/detections?vehicle={vehicle}&lat={lat}&lon={lon}"
           f"&eyes_closed_s={secs:.1f}&ts={int(time.time() * 1000)}")
    try:
        post(url, make_demo_jpeg(secs, vehicle), "image/jpeg", timeout=10)
        print(f"[{vehicle}] ENDORMI -> image envoyée")
    except Exception as e:
        print(f"[{vehicle}] image non envoyée: {e}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--broker", default="localhost")
    p.add_argument("--port", type=int, default=1883)
    p.add_argument("--server", default="http://localhost:8000")
    p.add_argument("--vehicles", type=int, default=1, help="nombre de voitures (1 à 5)")
    p.add_argument("--hz", type=float, default=2.0)
    p.add_argument("--speed", type=float, default=DEFAULT_SPEED_KMH)
    p.add_argument("--http", action="store_true", help="envoyer par HTTP au lieu de MQTT")
    p.add_argument("--fast", action="store_true", help="scénario court pour tester vite")
    args = p.parse_args()
    args.vehicles = max(1, min(args.vehicles, 5))

    stop = threading.Event()
    threads = [threading.Thread(target=run_vehicle, args=(args, i, stop), daemon=True)
               for i in range(args.vehicles)]
    for t in threads:
        t.start()
    print("Faux conducteurs en marche. Ctrl+C pour arrêter.")
    try:
        while any(t.is_alive() for t in threads):
            time.sleep(0.5)
    except KeyboardInterrupt:
        stop.set()
        time.sleep(0.6)


if __name__ == "__main__":
    main()
