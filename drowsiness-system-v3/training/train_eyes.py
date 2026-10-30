from __future__ import annotations

"""Entraîne le modèle YOLO "yeux" (eye_open / eye_closed).

    python train_eyes.py --data datasets/eyes/data.yaml
    python train_eyes.py --data datasets/eyes/data.yaml --epochs 80 --batch 32 --device 0

Le meilleur modèle est copié dans  models/eyes_best.pt  (utilisé par detector_eyes.py).
À faire sur Kaggle / Colab (GPU gratuit): voir README_TRAINING.md.
"""
import argparse
import shutil
from pathlib import Path

from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent.parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help="chemin de data.yaml")
    ap.add_argument("--model", default="yolo11n.pt", help="petit et rapide pour la webcam")
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--device", default=None, help="0 = première carte GPU, cpu = processeur")
    ap.add_argument("--project", default=str(ROOT / "training" / "runs"))
    args = ap.parse_args()

    model = YOLO(args.model)
    model.train(
        data=args.data, epochs=args.epochs, imgsz=args.imgsz, batch=args.batch, device=args.device,
        project=args.project, name="eyes", exist_ok=True,
        # augmentations légères: luminosité (jour/nuit), un peu de flou/rotation. Pas de flip vertical, pas de mosaïque forte.
        hsv_h=0.015, hsv_s=0.5, hsv_v=0.5, degrees=8, translate=0.08, scale=0.35,
        fliplr=0.5, flipud=0.0, mosaic=0.5, mixup=0.0, patience=15,
    )
    best = Path(args.project) / "eyes" / "weights" / "best.pt"
    dest = ROOT / "models" / "eyes_best.pt"
    dest.parent.mkdir(parents=True, exist_ok=True)
    if best.exists():
        shutil.copy(best, dest)
        print(f"\nModèle copié ici: {dest}")
        print("Prochaine étape:  python evaluate_eyes.py --data", args.data)
    else:
        print("best.pt introuvable, regarde le dossier:", Path(args.project) / "eyes")


if __name__ == "__main__":
    main()
