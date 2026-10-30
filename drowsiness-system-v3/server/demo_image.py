from __future__ import annotations

"""Fabrique une image de démonstration (visage dessiné + boîtes rouges sur les yeux fermés).

Sert à tester le site / l'app sans webcam (fake_driver.py, seed_demo.py, bouton "Tester l'alerte").
"""
import random

import cv2
import numpy as np


def make_demo_jpeg(seconds: float = 5.0, label: str = "car01", seed: int | None = None) -> bytes:
    rnd = random.Random(seed)
    w, h = 640, 480
    img = np.full((h, w, 3), (52, 46, 40), np.uint8)
    # fond dégradé simple
    for y in range(h):
        c = 40 + int(30 * y / h)
        img[y, :, :] = (c + 10, c, c - 6)
    skin = (150 + rnd.randint(-15, 15), 170 + rnd.randint(-15, 15), 205 + rnd.randint(-10, 10))
    cv2.ellipse(img, (w // 2, h // 2 + 20), (130, 165), 0, 0, 360, skin, -1)          # visage
    cv2.ellipse(img, (w // 2, h // 2 - 120), (140, 70), 0, 180, 360, (30, 30, 35), -1)  # cheveux
    cv2.ellipse(img, (w // 2, h // 2 + 120), (45, 14), 0, 0, 180, (80, 70, 150), 3)     # bouche
    cv2.line(img, (w // 2, h // 2 - 5), (w // 2 - 8, h // 2 + 55), (120, 130, 170), 3)  # nez
    boxes = []
    for cx in (w // 2 - 62, w // 2 + 62):
        cy = h // 2 - 40
        cv2.ellipse(img, (cx, cy), (30, 14), 0, 0, 360, (240, 240, 240), -1)            # œil
        cv2.line(img, (cx - 30, cy + 2), (cx + 30, cy + 2), (30, 30, 30), 4)            # paupière fermée
        boxes.append((cx - 42, cy - 26, cx + 42, cy + 26))
    for n, (x1, y1, x2, y2) in enumerate(boxes):
        conf = round(rnd.uniform(0.86, 0.97), 2)
        cv2.rectangle(img, (x1, y1), (x2, y2), (60, 60, 255), 2)                        # BGR: rouge
        ty = y1 - 8 if n == 0 else y2 + 20                                              # 2 étiquettes: haut / bas
        cv2.putText(img, f"eye_closed {conf:.2f}", (x1 - 10 if n == 0 else x1 + 8, ty),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (60, 60, 255), 2)
    cv2.putText(img, f"Yeux fermes: {seconds:.1f} s / 5 s", (12, 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
    cv2.putText(img, f"{label}  (image de demonstration)", (12, h - 14),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (200, 200, 200), 1)
    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
    return buf.tobytes() if ok else b""
