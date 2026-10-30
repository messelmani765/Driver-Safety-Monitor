from __future__ import annotations

"""Détecteur "YEUX SEULEMENT": webcam -> yeux ouverts/fermés -> règle des 5 s -> MQTT + capture.

Deux moteurs (--engine):
  yolo       modèle entraîné par toi: models/eyes_best.pt (classes eye_open / eye_closed)
  mediapipe  AUCUN entraînement: MediaPipe FaceMesh + EAR (mesure de l'ouverture de l'œil)
  auto       (par défaut) yolo si models/eyes_best.pt existe, sinon mediapipe

Exemples:
    python detector_eyes.py --show
    python detector_eyes.py --show --engine mediapipe
    python detector_eyes.py --show --vehicle car01 --server http://localhost:8000
    python detector_eyes.py --transport http     # sans Mosquitto (envoie par HTTP)

Touches (avec --show):  q = quitter,  c = simuler un choc (3 s)
"""
import argparse
import json
import sys
import threading
import time
import urllib.request
from pathlib import Path

import cv2

from utils import (EYES_CLOSED_SECONDS, EyeTimer, RouteSimulator, DEFAULT_SPEED_KMH)

ROOT = Path(__file__).resolve().parent.parent
GREEN = (80, 200, 80)    # BGR
RED = (60, 60, 255)

# Points FaceMesh de chaque œil (p1..p6 pour l'EAR) + contour pour la boîte
R_EYE = [33, 160, 158, 133, 153, 144]
L_EYE = [362, 385, 387, 263, 373, 380]


# ------------------------------------------------------------------ moteurs
class YoloEyes:
    name = "yolo"

    def __init__(self, path: str, conf: float, imgsz: int):
        from ultralytics import YOLO
        self.model = YOLO(path)
        self.conf, self.imgsz = conf, imgsz
        names = self.model.names
        self.closed_ids = {i for i, n in names.items() if "closed" in str(n).lower()}
        if not self.closed_ids:
            raise SystemExit(f"Ce modèle n'a pas de classe 'closed': {names}")

    def detect(self, frame):
        r = self.model.predict(frame, imgsz=self.imgsz, conf=self.conf, verbose=False)[0]
        out = []
        for i in range(len(r.boxes)):
            cls = int(r.boxes.cls[i])
            out.append(("closed" if cls in self.closed_ids else "open",
                        float(r.boxes.conf[i]), [float(v) for v in r.boxes.xyxy[i].tolist()]))
        return out


class MediaPipeEyes:
    name = "mediapipe"

    def __init__(self, ear_threshold: float):
        try:
            import mediapipe as mp
            self.mesh = mp.solutions.face_mesh.FaceMesh(
                static_image_mode=False, max_num_faces=1, refine_landmarks=True,
                min_detection_confidence=0.5, min_tracking_confidence=0.5)
        except Exception as e:
            raise SystemExit(
                "MediaPipe indisponible (" + str(e) + ").\n"
                "Installe la bonne version:  pip install mediapipe==0.10.14")
        self.ear_threshold = ear_threshold

    @staticmethod
    def _ear(pts):
        d = lambda a, b: ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5  # noqa: E731
        return (d(pts[1], pts[5]) + d(pts[2], pts[4])) / (2.0 * d(pts[0], pts[3]) + 1e-6)

    def detect(self, frame):
        h, w = frame.shape[:2]
        res = self.mesh.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        if not res.multi_face_landmarks:
            return []
        lm = res.multi_face_landmarks[0].landmark
        out = []
        for idx in (R_EYE, L_EYE):
            pts = [(lm[i].x * w, lm[i].y * h) for i in idx]
            ear = self._ear(pts)
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            bw, bh = max(xs) - min(xs), max(ys) - min(ys)
            pad_x, pad_y = bw * 0.35, max(bh, bw * 0.30) * 0.9
            cy = (max(ys) + min(ys)) / 2
            box = [min(xs) - pad_x, cy - bh / 2 - pad_y, max(xs) + pad_x, cy + bh / 2 + pad_y]
            closed = ear < self.ear_threshold
            conf = min(0.99, 0.5 + abs(ear - self.ear_threshold) * 4)
            out.append(("closed" if closed else "open", conf, box))
        return out


# ------------------------------------------------------------------ dessin
def draw_overlay(frame, dets, state, closed_s, limit_s, fps, lat, lon, impact):
    for kind, conf, (x1, y1, x2, y2) in dets:
        color = RED if kind == "closed" else GREEN
        cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), color, 2)
        cv2.putText(frame, f"eye_{kind} {conf:.2f}", (int(x1), max(18, int(y1) - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)
    h, w = frame.shape[:2]
    label = {"EyesOpen": "Yeux ouverts", "EyesClosed": "Yeux fermes", "Asleep": "ENDORMI !",
             "NoFace": "Visage non detecte"}.get(state, state)
    col = RED if state in ("Asleep", "EyesClosed") else (255, 255, 255)
    cv2.putText(frame, label, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, col, 2)
    cv2.putText(frame, f"Yeux fermes: {closed_s:.1f} s / {limit_s:g} s", (10, 60),
                cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2)
    frac = max(0.0, min(1.0, closed_s / limit_s))
    cv2.rectangle(frame, (10, 72), (10 + 240, 88), (70, 70, 70), -1)
    cv2.rectangle(frame, (10, 72), (10 + int(240 * frac), 88), RED if frac >= 1 else (0, 180, 255), -1)
    cv2.putText(frame, f"{fps:.0f} FPS  GPS {lat:.4f},{lon:.4f}", (10, h - 12),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)
    if impact:
        cv2.putText(frame, "CHOC SIMULE", (10, 120), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 255), 3)


# ------------------------------------------------------------------ réseau
def http_json(url: str, payload: dict | None = None, timeout: float = 3.0):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode() or "{}")


def send_capture(server: str, jpeg: bytes, vehicle: str, lat: float, lon: float, secs: float,
                 delay: float = 0.6) -> None:
    """Envoie l'image au serveur (HTTP). Dans un thread: ne bloque pas la caméra."""
    def run():
        time.sleep(delay)  # laisse le temps à l'alerte MQTT d'arriver d'abord
        url = (f"{server}/api/detections?vehicle={vehicle}&lat={lat}&lon={lon}"
               f"&eyes_closed_s={secs:.1f}&ts={int(time.time() * 1000)}")
        req = urllib.request.Request(url, data=jpeg, headers={"Content-Type": "image/jpeg"})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                print("Image envoyée au serveur:", r.read().decode()[:120])
        except Exception as e:
            print("Envoi de l'image impossible (le serveur tourne ?):", e)
    threading.Thread(target=run, daemon=True).start()


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--source", default="0", help="0 = webcam, ou chemin d'une vidéo")
    p.add_argument("--engine", default="auto", choices=["auto", "yolo", "mediapipe"])
    p.add_argument("--model", default=str(ROOT / "models" / "eyes_best.pt"))
    p.add_argument("--conf", type=float, default=0.4)
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--ear", type=float, default=0.21, help="seuil EAR (mediapipe): plus bas = il faut fermer plus")
    p.add_argument("--server", default="http://localhost:8000")
    p.add_argument("--transport", default="mqtt", choices=["mqtt", "http"])
    p.add_argument("--broker", default="localhost")
    p.add_argument("--port", type=int, default=1883)
    p.add_argument("--vehicle", default="car01")
    p.add_argument("--hz", type=float, default=2.0, help="messages par seconde")
    p.add_argument("--speed", type=float, default=DEFAULT_SPEED_KMH, help="vitesse simulée (km/h)")
    p.add_argument("--seconds", type=float, default=None, help="durée yeux fermés (sinon: réglage du serveur / config.py)")
    p.add_argument("--show", action="store_true", help="afficher la fenêtre vidéo")
    return p.parse_args()


def main():
    args = parse_args()
    source = int(args.source) if args.source.isdigit() else args.source
    is_file = not isinstance(source, int)

    # Moteur
    engine_name = args.engine
    if engine_name == "auto":
        engine_name = "yolo" if Path(args.model).exists() else "mediapipe"
    if engine_name == "yolo":
        if not Path(args.model).exists():
            raise SystemExit(f"Modèle introuvable: {args.model}\n"
                             "-> entraîne-le (training/README_TRAINING.md) ou utilise --engine mediapipe")
        print(f"Moteur YOLO: {args.model}")
        engine = YoloEyes(args.model, args.conf, args.imgsz)
    else:
        print("Moteur MediaPipe (EAR) - pas besoin d'entraînement")
        engine = MediaPipeEyes(args.ear)

    # Durée des yeux fermés: option > serveur (page Settings) > config.py
    limit_s, cooldown_s = float(EYES_CLOSED_SECONDS), 60.0
    try:
        s = http_json(f"{args.server}/api/settings")
        limit_s = float(s.get("eyes_closed_s", limit_s))
        cooldown_s = float(s.get("asleep_cooldown_s", cooldown_s))
    except Exception:
        print("(serveur injoignable: réglages de config.py utilisés)")
    if args.seconds:
        limit_s = args.seconds
    print(f"Règle: yeux fermés {limit_s:g} s = ENDORMI")
    timer = EyeTimer(closed_seconds=limit_s)

    # Transport
    topic_state = f"car/{args.vehicle}/state"
    topic_status = f"car/{args.vehicle}/status"
    client = None
    if args.transport == "mqtt":
        import paho.mqtt.client as mqtt
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"detector-{args.vehicle}")
        client.will_set(topic_status, "offline", qos=1, retain=True)

        def on_connect(c, userdata, flags, reason_code, properties):
            print(f"MQTT connecté à {args.broker}:{args.port} ({reason_code})")
            c.publish(topic_status, "online", qos=1, retain=True)

        client.on_connect = on_connect
        client.connect_async(args.broker, args.port, keepalive=30)
        client.loop_start()

    if isinstance(source, int) and sys.platform.startswith("win"):
        cap = cv2.VideoCapture(source, cv2.CAP_DSHOW)
        if not cap.isOpened():
            cap = cv2.VideoCapture(source)
    else:
        cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise SystemExit(f"Impossible d'ouvrir la source: {args.source}. Vérifie que la webcam n'est pas utilisée par une autre application.")

    custom_points = None
    try:
        r_data = http_json(f"{args.server}/api/vehicles/{args.vehicle}/route", timeout=3.0)
        pts = r_data.get("points") or []
        if isinstance(pts, list) and len(pts) >= 2:
            custom_points = [[float(p[0]), float(p[1])] for p in pts]
            print(f"Trajet personnalisé chargé pour {args.vehicle}: {len(custom_points)} points")
    except Exception as e:
        print(f"Trajet personnalisé non disponible pour {args.vehicle} ({e}), utilisation du trajet par défaut.")

    route = RouteSimulator(points=custom_points, speed_kmh=args.speed)
    lat, lon, heading, progress = route.step(0)
    last_pub = last_frame_t = time.time()
    fps, impact_until = 0.0, 0.0
    prev_state, last_capture = "EyesOpen", -1e9
    state, closed_s = "NoFace", 0.0

    print("Démarrage. Ctrl+C pour arrêter." + ("  Touche q = quitter, c = choc" if args.show else ""))
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                if is_file:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                print("La caméra ne donne plus d'image. Vérifie la connexion USB ou que la webcam n'est pas sollicitée ailleurs.")
                break

            t_capture = time.time()
            dets = engine.detect(frame)
            infer_ms = (time.time() - t_capture) * 1000
            n_open = sum(1 for d in dets if d[0] == "open")
            n_closed = sum(1 for d in dets if d[0] == "closed")
            now = time.time()
            state, closed_s = timer.update(n_open, n_closed, now)
            fps = 0.9 * fps + 0.1 * (1.0 / max(now - last_frame_t, 1e-6))
            last_frame_t = now

            # dessiner AVANT la capture: l'image envoyée contient les boîtes
            draw_overlay(frame, dets, state, closed_s, limit_s, fps, lat, lon, now < impact_until)

            # Capture au moment exact où "endormi" commence (une seule fois par épisode)
            if state == "Asleep" and now - last_capture >= cooldown_s and n_open == 0 and n_closed >= 1 and all(d[1] >= 0.90 for d in dets if d[0] == "closed"):
                last_capture = now
                ok_jpg, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
                if ok_jpg:
                    print(f"ENDORMI ! (yeux fermés {closed_s:.1f} s) -> capture envoyée")
                    send_capture(args.server, buf.tobytes(), args.vehicle,
                                 round(lat, 6), round(lon, 6), closed_s)
            prev_state = state

            if now - last_pub >= 1.0 / args.hz:
                lat, lon, heading, progress = route.step(now - last_pub)
                last_pub = now
                confs = [d[1] for d in dets]
                payload = {
                    "vehicle_id": args.vehicle,
                    "state": state,
                    "eyes_closed_s": round(closed_s, 2),
                    "eyes_open": n_open, "eyes_closed": n_closed,
                    "confidence": round(sum(confs) / len(confs), 3) if confs else 0.0,
                    "lat": round(lat, 6), "lon": round(lon, 6),
                    "heading": round(heading, 1), "route_progress": round(progress, 1),
                    "speed": args.speed,
                    "impact": now < impact_until,
                    "ts": int(t_capture * 1000),
                    "infer_ms": round(infer_ms, 1),
                    "fps": round(fps, 1),
                }
                if client is not None:
                    client.publish(topic_state, json.dumps(payload), qos=0)
                else:
                    try:
                        http_json(f"{args.server}/api/state", payload, timeout=1.5)
                    except Exception:
                        pass

            if args.show:
                cv2.imshow("Driver monitor - yeux (q = quitter, c = choc)", frame)
                key = cv2.waitKey(1) & 0xFF
                if key == ord("q"):
                    break
                if key == ord("c"):
                    impact_until = time.time() + 3.0
    except KeyboardInterrupt:
        pass
    finally:
        if client is not None:
            client.publish(topic_status, "offline", qos=1, retain=True)
            time.sleep(0.2)
            client.loop_stop()
            client.disconnect()
        cap.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
