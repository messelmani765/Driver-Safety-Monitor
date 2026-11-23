from __future__ import annotations

"""Prépare un dataset YOLO "yeux" (2 classes) à partir d'images de VISAGES.

Classes:  0 = eye_open   1 = eye_closed     (une boîte par œil)

Entrée (--src): un dossier avec deux sous-dossiers d'images de visages:
    mon_dataset/open/     (visages yeux ouverts)
    mon_dataset/closed/   (visages yeux fermés)
Les boîtes sont créées AUTOMATIQUEMENT avec MediaPipe FaceMesh.
Si tu n'as pas de sous-dossiers (--ear-label), la classe est décidée par l'EAR
(mesure de l'ouverture de l'œil, seuil --ear).

Exemple:
    python prepare_dataset.py --src /kaggle/input/mon_dataset --out datasets/eyes

IMPORTANT: pip install mediapipe==0.10.14   (les versions récentes n'ont plus mp.solutions)
Si ton dataset est déjà au format YOLO avec des boîtes (Roboflow), tu n'as PAS besoin
de ce script: voir README_TRAINING.md.
"""
import argparse
import random
import shutil
from pathlib import Path

import cv2

R_EYE = [33, 160, 158, 133, 153, 144]
L_EYE = [362, 385, 387, 263, 373, 380]
IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def ear(pts):
    d = lambda a, b: ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5  # noqa: E731
    return (d(pts[1], pts[5]) + d(pts[2], pts[4])) / (2.0 * d(pts[0], pts[3]) + 1e-6)


def eye_boxes(mesh, img):
    """Renvoie [(ear, (x1,y1,x2,y2)), ...] pour les 2 yeux (pixels), ou []."""
    h, w = img.shape[:2]
    res = mesh.process(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    if not res.multi_face_landmarks:
        return []
    lm = res.multi_face_landmarks[0].landmark
    out = []
    for idx in (R_EYE, L_EYE):
        pts = [(lm[i].x * w, lm[i].y * h) for i in idx]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        bw, bh = max(xs) - min(xs), max(ys) - min(ys)
        pad_x, pad_y = bw * 0.35, max(bh, bw * 0.30) * 0.9
        cy = (max(ys) + min(ys)) / 2
        x1, x2 = max(0, min(xs) - pad_x), min(w - 1, max(xs) + pad_x)
        y1, y2 = max(0, cy - bh / 2 - pad_y), min(h - 1, cy + bh / 2 + pad_y)
        if x2 - x1 < 6 or y2 - y1 < 6:
            continue
        out.append((ear(pts), (x1, y1, x2, y2)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="dossier avec open/ et closed/ (ou toutes les images)")
    ap.add_argument("--out", default="datasets/eyes")
    ap.add_argument("--ear", type=float, default=0.21)
    ap.add_argument("--ear-label", action="store_true", help="décider open/closed avec l'EAR (pas de sous-dossiers)")
    ap.add_argument("--max", type=int, default=0, help="nombre max d'images (0 = toutes)")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    try:
        import mediapipe as mp
        mesh = mp.solutions.face_mesh.FaceMesh(static_image_mode=True, max_num_faces=1,
                                               refine_landmarks=True, min_detection_confidence=0.5)
    except Exception as e:
        raise SystemExit(f"MediaPipe: {e}\n-> pip install mediapipe==0.10.14")

    src, out = Path(args.src), Path(args.out)
    items = []  # (chemin, classe_forcée ou None)
    for p in sorted(src.rglob("*")):
        if p.suffix.lower() not in IMG_EXT:
            continue
        parts = {x.lower() for x in p.relative_to(src).parts[:-1]}
        forced = None
        if not args.ear_label:
            if parts & {"closed", "close", "closed_eyes", "sleepy", "drowsy"}:
                forced = 1
            elif parts & {"open", "opened", "open_eyes", "awake", "alert"}:
                forced = 0
        if forced is None and not args.ear_label:
            continue  # image hors open/closed: ignorée
        items.append((p, forced))
    random.Random(args.seed).shuffle(items)
    if args.max:
        items = items[: args.max]
    if not items:
        raise SystemExit("Aucune image trouvée (vérifie les dossiers open/ et closed/, ou utilise --ear-label).")

    n_train, n_val = int(len(items) * 0.8), int(len(items) * 0.1)
    for sp in ("train", "val", "test"):
        (out / "images" / sp).mkdir(parents=True, exist_ok=True)
        (out / "labels" / sp).mkdir(parents=True, exist_ok=True)

    kept = skipped = 0
    counts = {0: 0, 1: 0}
    for i, (p, forced) in enumerate(items):
        img = cv2.imread(str(p))
        if img is None:
            skipped += 1
            continue
        boxes = eye_boxes(mesh, img)
        if len(boxes) < 2:
            skipped += 1
            continue
        h, w = img.shape[:2]
        sp = "train" if i < n_train else "val" if i < n_train + n_val else "test"
        lines = []
        for e, (x1, y1, x2, y2) in boxes:
            cls = forced if forced is not None else (1 if e < args.ear else 0)
            counts[cls] += 1
            lines.append(f"{cls} {(x1 + x2) / 2 / w:.6f} {(y1 + y2) / 2 / h:.6f} {(x2 - x1) / w:.6f} {(y2 - y1) / h:.6f}")
        name = f"{i:06d}{p.suffix.lower()}"
        shutil.copy(p, out / "images" / sp / name)
        (out / "labels" / sp / f"{i:06d}.txt").write_text("\n".join(lines) + "\n")
        kept += 1
        if kept % 200 == 0:
            print(f"  {kept} images préparées...")

    (out / "data.yaml").write_text(
        f"path: {out.resolve().as_posix()}\ntrain: images/train\nval: images/val\ntest: images/test\n"
        "names:\n  0: eye_open\n  1: eye_closed\n")
    print(f"Terminé: {kept} images gardées, {skipped} ignorées (visage non trouvé).")
    print(f"Yeux ouverts: {counts[0]}   Yeux fermés: {counts[1]}")
    print(f"Fichier de config: {out / 'data.yaml'}")


if __name__ == "__main__":
    main()
