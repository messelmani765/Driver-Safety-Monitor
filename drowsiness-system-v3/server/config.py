"""Configuration unique du système Driver Safety Monitor.

Toutes les variables modifiables se trouvent ici.
Tu peux modifier les valeurs directement dans ce fichier ou via les variables d'environnement.
(Certains réglages peuvent aussi être changés depuis la page "Settings" du site.)
"""
from __future__ import annotations

import os

# ==============================================================================
# 1. POSITION GPS DE DÉPART (ISSAT Sousse)
# ==============================================================================
# Comment copier tes coordonnées depuis Google Maps :
#   1. Ouvre Google Maps (maps.google.com).
#   2. Cherche "ISSAT Sousse" (ou ton lieu souhaité).
#   3. Fais un CLIC DROIT sur le bâtiment de l'ISSAT.
#   4. La première ligne du menu affiche les coordonnées (ex: 35.8256, 10.5908).
#   5. Clique dessus pour les copier, puis colle-les ci-dessous :
START_LAT: float = float(os.getenv("START_LAT", "35.8256"))
START_LON: float = float(os.getenv("START_LON", "10.5908"))

# Vitesse de la voiture simulée (en km/h, réaliste: 30 à 60 km/h)
DEFAULT_SPEED_KMH: float = float(os.getenv("DEFAULT_SPEED_KMH", "45.0"))

# ==============================================================================
# 2. TRAJET (ROUTE) DE LA VOITURE
# ==============================================================================
# Points de passage : départ -> étapes -> retour au départ.
# Le script detector/build_route.py demande à OSRM (service gratuit) de relier ces
# points par de VRAIES ROUTES et sauvegarde le résultat dans server/static/route.json.
# Pour changer de trajet : modifie cette liste, puis relance build_route.py.
ROUTE_WAYPOINTS: list[tuple[float, float]] = [
    (START_LAT, START_LON),            # 1. DÉPART : ISSAT Sousse
    (35.8300, 10.6050),                # 2. vers l'est
    (35.8265, 10.6340),                # 3. ARRIVÉE INTERMÉDIAIRE : centre-ville / Médina
    (35.8190, 10.6180),                # 4. retour par le sud
    (START_LAT, START_LON),            # 5. ARRIVÉE : retour à l'ISSAT
]
# Ancienne petite boucle (utilisée seulement si route.json n'existe pas)
DEFAULT_ROUTE: list[tuple[float, float]] = ROUTE_WAYPOINTS

# ==============================================================================
# 3. RÈGLE "YEUX FERMÉS" (détecteur)
# ==============================================================================
# Durée d'yeux fermés (en secondes) pour déclarer le conducteur ENDORMI
EYES_CLOSED_SECONDS: float = float(os.getenv("EYES_CLOSED_SECONDS", "5"))
# Yeux ouverts plus longtemps que ça = le chronomètre repart à zéro (anti clignement)
EYES_OPEN_RESET_S: float = float(os.getenv("EYES_OPEN_RESET_S", "0.3"))
# Si le modèle ne voit plus rien pendant moins de ça, on continue l'état précédent
DETECTION_HOLD_S: float = float(os.getenv("DETECTION_HOLD_S", "0.8"))
# Visage perdu plus longtemps que ça = chronomètre remis à zéro
NOFACE_RESET_S: float = float(os.getenv("NOFACE_RESET_S", "3"))

# ==============================================================================
# 4. ALERTES
# ==============================================================================
# Délai minimum entre deux alertes "endormi" pour la même voiture (secondes)
ASLEEP_COOLDOWN_S: float = float(os.getenv("ASLEEP_COOLDOWN_S", "60"))
# Si personne ne clique "Je suis réveillé" pendant ce délai -> escalade (appel police SIMULÉ)
ALERT_ACK_TIMEOUT_S: float = float(os.getenv("ALERT_ACK_TIMEOUT_S", "10"))
# Taille max d'une image envoyée par le détecteur (octets)
MAX_IMAGE_BYTES: int = int(os.getenv("MAX_IMAGE_BYTES", str(2 * 1024 * 1024)))

# ==============================================================================
# 5. BROKER MQTT
# ==============================================================================
MQTT_HOST: str = os.getenv("MQTT_HOST", "localhost")
MQTT_PORT: int = int(os.getenv("MQTT_PORT", "1883"))

# ==============================================================================
# 6. RAPPORTS PÉRIODIQUES ET APPEL D'URGENCE SIMULÉ
# ==============================================================================
# Intervalle d'envoi du rapport périodique en secondes (120 = 2 min, 300 = 5 min)
REPORT_INTERVAL_S: int = int(os.getenv("REPORT_INTERVAL_S", "120"))

# Numéro et message pour l'appel d'urgence SIMULÉ.
# ATTENTION: Il s'agit d'une SIMULATION, aucun appel réel n'est passé.
EMERGENCY_NUMBER: str = os.getenv("EMERGENCY_NUMBER", "+216 00 000 000")
EMERGENCY_MESSAGE: str = (
    "Simulation: conducteur endormi, position envoyée à la Protection civile."
)

# Telegram (optionnel)
TELEGRAM_TOKEN: str = os.getenv("TELEGRAM_TOKEN", "")
TELEGRAM_CHAT_ID: str = os.getenv("TELEGRAM_CHAT_ID", "")
