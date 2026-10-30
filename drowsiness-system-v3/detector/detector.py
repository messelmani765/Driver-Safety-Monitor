from __future__ import annotations

"""Détecteur temps réel: webcam (ou vidéo) -> YOLO11s -> MQTT.

Exemples:
    python detector.py --show                    # webcam 0 avec fenêtre
    python detector.py --source ma_video.mp4     # une vidéo
    python detector.py --broker 192.168.1.20     # broker sur un autre PC

Touches (avec --show):  q = quitter,  c = simuler un choc (3 secondes)
"""
import argparse
import json
import time
from pathlib import Path

import cv2
import paho.mqtt.client as mqtt
from ultralytics import YOLO

from utils import RouteSimulator, StateSmoother, DEFAULT_SPEED_KMH

# Seuils par classe (repris du dépôt d'origine). Les autres: 0.40
THRESHOLDS = {
    "DangerousDriving": 0.50,
    "Distracted": 0.45,
    "Drinking": 0.25,
    "SafeDriving": 0.50,
    "SleepyDriving": 0.40,
    "Yawn": 0.40,
}
DEFAULT_THRESHOLD = 0.40
BOX_COLORS = {  # BGR
    "SafeDriving": (175, 207, 62),
    "SleepyDriving": (255, 111, 180),
    "Yawn": (60, 190, 255),
    "Distracted": (60, 190, 255),
    "Drinking": (66, 140, 255),
    "DangerousDriving": (70, 70, 255),
}


def parse_args():
    here = Path(__file__).resolve().parent
    p = argparse.ArgumentParser()
    p.add_argument("--source", default="0", help="0 = webcam, ou chemin d'une vidéo")
    p.add_argument("--model", default=str(here.parent / "best.pt"))
    p.add_argument("--broker", default="localhost")
    p.add_argument("--port", type=int, default=1883)
    p.add_argument("--vehicle", default="car01")
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--hz", type=float, default=2.0, help="messages MQTT par seconde")
    p.add_argument("--speed", type=float, default=DEFAULT_SPEED_KMH, help="vitesse simulée (km/h)")
    p.add_argument("--window", type=float, default=1.5, help="fenêtre de lissage (s)")
    p.add_argument("--show", action="store_true", help="afficher la fenêtre vidéo")
    return p.parse_args()


def pick_detection(result, names):
    """Garde la détection avec la meilleure confiance qui dépasse son seuil."""
    best = None
    boxes = result.boxes
    for i in range(len(boxes)):
        name = names[int(boxes.cls[i])]
        conf = float(boxes.conf[i])
        if conf < THRESHOLDS.get(name, DEFAULT_THRESHOLD):
            continue
        if best is None or conf > best[1]:
            best = (name, conf, boxes.xyxy[i].tolist())
    return best  # (nom, confiance, [x1,y1,x2,y2]) ou None


def draw_overlay(frame, det, smooth_state, fps, lat, lon, impact):
    if det:
        name, conf, (x1, y1, x2, y2) = det
        color = BOX_COLORS.get(name, (255, 255, 255))
        cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), color, 2)
        cv2.putText(frame, f"{name} {conf:.2f}", (int(x1), max(20, int(y1) - 8)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
    cv2.putText(frame, f"Etat lisse: {smooth_state}", (10, 28),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
    cv2.putText(frame, f"{fps:.0f} FPS  GPS {lat:.4f},{lon:.4f}", (10, 56),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1)
    if impact:
        cv2.putText(frame, "CHOC SIMULE", (10, 90),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 255), 3)


def main():
    args = parse_args()
    source = int(args.source) if args.source.isdigit() else args.source
    is_file = not isinstance(source, int)

    print(f"Chargement du modèle: {args.model}")
    model = YOLO(args.model)
    names = model.names

    topic_state = f"car/{args.vehicle}/state"
    topic_status = f"car/{args.vehicle}/status"
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                         client_id=f"detector-{args.vehicle}")
    client.will_set(topic_status, "offline", qos=1, retain=True)

    def on_connect(c, userdata, flags, reason_code, properties):
        print(f"MQTT connecté à {args.broker}:{args.port} ({reason_code})")
        c.publish(topic_status, "online", qos=1, retain=True)

    client.on_connect = on_connect
    client.connect_async(args.broker, args.port, keepalive=30)  # réessaie tout seul
    client.loop_start()

    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise SystemExit(f"Impossible d'ouvrir la source: {args.source}")

    smoother = StateSmoother(args.window)
    route = RouteSimulator(speed_kmh=args.speed)
    lat, lon = route.step(0)
    last_pub = time.time()
    last_frame_t = time.time()
    fps = 0.0
    impact_until = 0.0
    infer_ms = 0.0

    print("Démarrage. Ctrl+C pour arrêter." + ("  Touche q = quitter, c = choc" if args.show else ""))
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                if is_file:  # vidéo finie: on recommence
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                print("La caméra ne donne plus d'image.")
                break

            t_capture = time.time()
            result = model.predict(frame, imgsz=args.imgsz, conf=0.25, verbose=False)[0]
            infer_ms = (time.time() - t_capture) * 1000
            det = pick_detection(result, names)
            raw_state, raw_conf = (det[0], det[1]) if det else ("NoDetection", 0.0)
            smoother.add(raw_state, raw_conf)

            now = time.time()
            fps = 0.9 * fps + 0.1 * (1.0 / max(now - last_frame_t, 1e-6))
            last_frame_t = now

            if now - last_pub >= 1.0 / args.hz:
                lat, lon = route.step(now - last_pub)
                last_pub = now
                state, conf = smoother.result()
                payload = {
                    "vehicle_id": args.vehicle,
                    "state": state,
                    "confidence": round(conf, 3),
                    "raw_state": raw_state,
                    "lat": round(lat, 6),
                    "lon": round(lon, 6),
                    "speed": args.speed,
                    "impact": now < impact_until,
                    "ts": int(t_capture * 1000),  # moment de la capture (ms)
                    "infer_ms": round(infer_ms, 1),
                    "fps": round(fps, 1),
                }
                client.publish(topic_state, json.dumps(payload), qos=0)

            if args.show:
                state_now, _ = smoother.result()
                draw_overlay(frame, det, state_now, fps, lat, lon, time.time() < impact_until)
                cv2.imshow("Driver monitor (q = quitter, c = choc)", frame)
                key = cv2.waitKey(1) & 0xFF
                if key == ord("q"):
                    break
                if key == ord("c"):
                    impact_until = time.time() + 3.0
    except KeyboardInterrupt:
        pass
    finally:
        client.publish(topic_status, "offline", qos=1, retain=True)
        time.sleep(0.2)
        client.loop_stop()
        client.disconnect()
        cap.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
