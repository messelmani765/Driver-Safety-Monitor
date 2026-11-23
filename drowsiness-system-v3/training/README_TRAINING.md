# Entraîner le modèle "yeux" (facultatif)

**Tu n'es PAS obligé d'entraîner pour tester le projet.** Le détecteur marche tout de suite avec MediaPipe:

    cd detector
    python detector_eyes.py --show --engine mediapipe

L'entraînement sert à avoir **ton propre modèle YOLO** (pour ton rapport/PFE): 2 classes,
`eye_open` (boîte verte) et `eye_closed` (boîte rouge), une boîte par œil.
Quand `models/eyes_best.pt` existe, `detector_eyes.py` l'utilise automatiquement (`--engine auto`).

## Étape 1 — Trouver un dataset (2 choix)

**Choix A (le plus simple): dataset déjà annoté avec des boîtes (Roboflow Universe)**
1. Va sur universe.roboflow.com et cherche: `open closed eyes` ou `eyes drowsiness`.
2. Prends un dataset avec 2 classes (ex: open / closed) et des boîtes sur les YEUX.
3. Export → format **YOLOv11** (ou YOLOv8) → télécharge le zip.
4. Dans le fichier `data.yaml` du dataset, mets les noms comme ça (l'ordre compte, 0 = ouvert):

       names:
         0: eye_open
         1: eye_closed

   (si le dataset a l'ordre inverse, inverse-le ici ET garde le même ordre dans les labels: le plus sûr est de choisir un dataset dont les noms contiennent "closed" et "open").
5. Saute l'étape 2 et va à l'étape 3.

**Choix B: images de visages sans boîtes** (Kaggle: cherche `Closed Eyes In The Wild`, `drowsiness dataset`, `open closed eyes`)
- Il faut des images de **visages entiers** (pas des petits yeux découpés: MediaPipe ne trouve pas de visage dans un œil seul).
- Organise-les en deux dossiers: `open/` et `closed/`.

## Étape 2 — Créer les boîtes automatiquement (choix B seulement)

    pip install mediapipe==0.10.14 opencv-python
    python prepare_dataset.py --src chemin/vers/mon_dataset --out datasets/eyes

Il crée `datasets/eyes/` (train 80 % / val 10 % / test 10 %) et `datasets/eyes/data.yaml`.
Si tu n'as pas de dossiers open/closed: ajoute `--ear-label` (la classe est décidée par la mesure EAR).

## Étape 3 — Entraîner (Kaggle ou Google Colab, GPU gratuit)

**Kaggle:** nouveau Notebook → à droite: *Accelerator = GPU T4* → *Add data* (ton dataset) → cellules:

    !pip install -q ultralytics mediapipe==0.10.14
    # envoie le dossier training/ du projet (Add data → Upload) puis:
    %cd /kaggle/working
    !python training/prepare_dataset.py --src /kaggle/input/NOM_DATASET --out datasets/eyes   # choix B
    !python training/train_eyes.py --data datasets/eyes/data.yaml --epochs 60 --batch 16 --device 0
    !python training/evaluate_eyes.py --data datasets/eyes/data.yaml

(avec le choix A: remplace `datasets/eyes/data.yaml` par le chemin du `data.yaml` Roboflow.)

**Sur ton PC** (sans GPU c'est lent: 1 à 3 heures pour 2000 images): même commandes, ajoute `--device cpu --epochs 30`.

## Étape 4 — Récupérer le modèle

Télécharge `models/eyes_best.pt` (Kaggle: *Output*) et mets-le dans le dossier `models/` du projet. Puis:

    cd detector
    python detector_eyes.py --show

Le terminal doit afficher `Moteur YOLO: ...eyes_best.pt`.

## Pour ton rapport

`python evaluate_eyes.py` crée dans `training/results/`:
- `metrics.md` (précision, rappel, mAP50 par classe),
- `confusion_matrix.png`, `PR_curve.png`, `F1_curve.png`.

Conseils de qualité: des images avec lunettes, jour/nuit, têtes un peu tournées; au moins ~1500 images par classe;
si le modèle confond: augmente les epochs ou prends yolo11s.pt (`--model yolo11s.pt`).
