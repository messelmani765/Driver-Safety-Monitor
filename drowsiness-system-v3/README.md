# Driver Safety Monitor — détection de somnolence (simulation temps réel sur PC)

La webcam du PC joue la caméra de la voiture. Si les **yeux restent fermés 5 secondes**, le conducteur est
déclaré **endormi** : une photo avec les boîtes sur les yeux est prise, une alerte rouge + sirène apparaît
sur le **site web** et dans l'**app téléphone**, et un **appel de police SIMULÉ** démarre si personne ne répond.

> ⚠️ **Tout est simulé** : GPS, choc et appel de police (numéro fictif `+216 00 000 000`).
> Aucun vrai appel, aucun vrai SMS. Les matricules et noms sont inventés.

```
[Webcam] -> detector_eyes.py (yeux ouverts/fermés + règle 5 s) --MQTT ou HTTP--> server.py (FastAPI + SQLite)
                                  \--- image JPEG (HTTP) -------------------------> |--WebSocket--> site web (carte, dashboard)
                                                                                    |--WebSocket--> app Flutter
```

## 1. Installer (une seule fois)

Python 3.9 ou plus. Dans PowerShell, dans le dossier du projet :

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```
(`mediapipe==0.10.14` et `numpy<2` sont voulus : les versions récentes de MediaPipe n'ont plus l'outil FaceMesh utilisé ici.)

**Facultatif** : Mosquitto (broker MQTT, `winget install mosquitto`). Sans lui, tout marche en HTTP.

## 2. Lancer (le plus simple)

```powershell
.\start_all.ps1                    # serveur + 3 voitures simulées
.\start_all.ps1 -Webcam            # serveur + ta webcam
.\start_all.ps1 -Vehicles 5 -Fast  # test rapide: alerte au bout de ~15 s
```
Si PowerShell refuse : `powershell -ExecutionPolicy Bypass -File .\start_all.ps1`.

Ouvre ensuite **http://localhost:8000** (Ctrl+F5). Sur le téléphone : `http://IP_DU_PC:8000`
(`ipconfig` → Adresse IPv4 ; même Wi-Fi). La première fois, Windows demande d'autoriser Python : **Autoriser**.

### À la main (4 fenêtres)
```powershell
# 1 (facultatif) Mosquitto
& "C:\Program Files\mosquitto\mosquitto.exe" -c .\mosquitto\mosquitto.conf -v
# 2 serveur
cd server ; python -m uvicorn server:app --host 0.0.0.0 --port 8000
# 3a voitures simulées (--http si pas de Mosquitto)       3b ou ta webcam
cd detector ; python fake_driver.py --vehicles 3 --fast   cd detector ; python detector_eyes.py --show
```

## 3. Utiliser le site

1. Clique **ACTIVER LE SON** (obligatoire sur téléphone, sinon le navigateur bloque le son).
2. **Dashboard** : total d'alertes, voitures (en ligne / hors ligne), conducteurs, carte en direct, graphique.
3. **Carte en direct** : le trajet gris, la partie parcourue en couleur, la voiture qui tourne, départ 🚩 / arrivée 🏁.
4. **Detection History** : les images prises par le modèle (boîtes rouges sur les yeux fermés), filtres, téléchargement, **Exporter Excel**.
5. **Voitures / Conducteurs** : ajouter, modifier, supprimer ; **Exporter Excel** (matricule + nom du conducteur).
6. **Réglages** : durée des yeux fermés (5 s), délai avant l'appel simulé (10 s), numéro fictif, et le bouton **Tester l'alerte**.

### Que se passe-t-il quand le conducteur dort ?
| Temps | Événement |
|---|---|
| 2 s yeux fermés | bip d'avertissement |
| 5 s | **ENDORMI** : photo + alerte rouge plein écran + sirène + vibration |
| 5 s → 15 s | compte à rebours ; bouton **Je suis réveillé** annule tout (sur tous les écrans) |
| 15 s sans réponse | **appel de police SIMULÉ** : numéro fictif, chronomètre, voix qui lit le message |

## 4. Trajet sur de vraies routes (une fois, avec Internet)

```powershell
cd detector
python build_route.py
```
Il relie les points `ROUTE_WAYPOINTS` de `server/config.py` par les vraies routes de Sousse (service gratuit OSRM) et écrit
`server/static/route.json`. Sans ça, la voiture roule en lignes droites (trajet de secours). Change le trajet en modifiant
la liste des points, puis relance la commande. Le départ = `START_LAT/START_LON` (ISSAT Sousse, à vérifier sur Google Maps).

## 5. App mobile Flutter

```powershell
cd flutter_app
powershell -ExecutionPolicy Bypass -File .\install_app.ps1
```
Téléphone branché en USB. Voir `flutter_app/README_FLUTTER.md` (réglages Xiaomi, volume alarme, bug du son corrigé).
Dans l'app : écris `IP_DU_PC:8000` puis **Connecter**.

## 6. Le modèle des yeux

| Moteur | Comment | Entraînement |
|---|---|---|
| `mediapipe` | `--engine mediapipe` (EAR = mesure de l'ouverture de l'œil) | non |
| `yolo` | ton modèle `models/eyes_best.pt` (2 classes eye_open / eye_closed) | oui, voir `training/README_TRAINING.md` |
| `auto` (défaut) | yolo si `models/eyes_best.pt` existe, sinon mediapipe | — |

Si les yeux sont mal vus avec MediaPipe : `--ear 0.19` (il faut fermer plus) ou `--ear 0.24` (plus sensible).
Test rapide de la règle : `python detector_eyes.py --show --seconds 3`.
L'ancien détecteur à 6 classes (`detector/detector.py`, avec ton `best.pt` à la racine si tu le remets) est conservé mais n'est plus utilisé.

## 7. Mesures pour le rapport

`server/logs/states.csv` (latence) et `server/logs/alerts.csv` :
```powershell
cd server ; python measure.py
```

## 8. Fichiers importants

| Fichier | Rôle |
|---|---|
| `server/config.py` | **tous les réglages** (trajet, 5 s, cooldown, délai d'appel, numéro fictif) |
| `server/server.py` | API REST + WebSocket + MQTT + export Excel + réception des images |
| `server/db.py` | base SQLite `server/data/app.db` (voitures, conducteurs, détections, alertes) |
| `server/seed_demo.py` | données de démonstration (`python seed_demo.py --reset`) |
| `server/static/` | le site (index.html, app.js, app.css, libs locales dans vendor/) |
| `detector/detector_eyes.py` | webcam → yeux → règle des 5 s → capture |
| `detector/fake_driver.py` | 1 à 5 voitures simulées |
| `detector/build_route.py` | trajet sur vraies routes |
| `training/` | entraînement du modèle yeux (Kaggle/Colab) |
| `flutter_app/` | l'application téléphone |

## Problèmes fréquents

- **Le téléphone n'ouvre pas le site** : mauvaise IP, autre Wi-Fi, ou pare-feu Windows (autorise Python en réseau privé).
- **Pas de son sur téléphone** : appuie sur ACTIVER LE SON, monte le volume (média pour le site, ALARME pour l'app).
- **La carte est grise** : les tuiles OpenStreetMap ont besoin d'Internet.
- **`/api/vehicles` vide** : supprime `server/data/app.db` et relance (la base est recréée avec 5 voitures de démo).
