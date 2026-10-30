from __future__ import annotations

"""Évalue le modèle yeux: précision, rappel, mAP50, matrice de confusion.

    python evaluate_eyes.py --data datasets/eyes/data.yaml

Résultats (pour ton rapport) dans  training/results/ :
  metrics.md, confusion_matrix.png, confusion_matrix_normalized.png, PR_curve.png, F1_curve.png ...
"""
import argparse
import shutil
from pathlib import Path

from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent.parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--model", default=str(ROOT / "models" / "eyes_best.pt"))
    ap.add_argument("--split", default="test", help="test (par défaut) ou val")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--device", default=None)
    args = ap.parse_args()

    out = ROOT / "training" / "results"
    out.mkdir(parents=True, exist_ok=True)
    model = YOLO(args.model)
    try:
        m = model.val(data=args.data, split=args.split, imgsz=args.imgsz, device=args.device,
                      plots=True, project=str(out), name="val", exist_ok=True)
    except Exception:
        print(f"Pas de split '{args.split}', j'utilise 'val'.")
        m = model.val(data=args.data, split="val", imgsz=args.imgsz, device=args.device,
                      plots=True, project=str(out), name="val", exist_ok=True)

    names = model.names
    lines = ["| Classe | Précision | Rappel | mAP50 | mAP50-95 |", "|---|---|---|---|---|"]
    for i, c in enumerate(m.box.ap_class_index):
        p, r, ap50, ap = m.box.class_result(i)
        lines.append(f"| {names[int(c)]} | {p:.3f} | {r:.3f} | {ap50:.3f} | {ap:.3f} |")
    lines.append(f"| **Toutes** | {m.box.mp:.3f} | {m.box.mr:.3f} | {m.box.map50:.3f} | {m.box.map:.3f} |")
    text = "\n".join(lines)
    (out / "metrics.md").write_text(text + "\n", encoding="utf-8")
    print("\n" + text)

    for f in Path(m.save_dir).glob("*.png"):
        shutil.copy(f, out / f.name)
    print(f"\nGraphiques et tableau copiés dans: {out}")


if __name__ == "__main__":
    main()
