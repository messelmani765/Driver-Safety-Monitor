"""Moteur d'alertes (sans dépendance, facile à tester).

Niveau 1: alarme dans la voiture (état à risque pendant quelques secondes: yeux fermés 2 s, ...)
Niveau 2: 3 épisodes en 5 minutes -> notification au contact avec la position
Niveau 3: fatigue continue >= 10 s -> escalade vers le contact d'urgence
Niveau 4: - conducteur ENDORMI (yeux fermés 5 s) -> alerte d'urgence + appel police (SIMULÉ)
          - choc + conducteur pas en conduite normale (SIMULÉ)
"""
from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field

try:
    from config import ASLEEP_COOLDOWN_S, EMERGENCY_MESSAGE, EMERGENCY_NUMBER
except ImportError:
    ASLEEP_COOLDOWN_S = 60.0
    EMERGENCY_NUMBER = "+216 00 000 000"
    EMERGENCY_MESSAGE = "Simulation: conducteur endormi, position envoyée à la Protection civile."

# Les états regroupés en "familles" de risque
FAMILY = {
    "EyesClosed": "eyes",          # nouveau: yeux fermés (avant les 5 s)
    "SleepyDriving": "fatigue",    # anciens états du modèle à 6 classes
    "Yawn": "fatigue",
    "Distracted": "distraction",
    "Drinking": "drinking",
    "DangerousDriving": "dangerous",
}
FAMILY_LABEL = {
    "eyes": "Yeux fermés",
    "fatigue": "Fatigue détectée",
    "distraction": "Conducteur distrait",
    "drinking": "Boisson au volant (mains hors du volant)",
    "dangerous": "Conduite dangereuse",
}


@dataclass
class AlertConfig:
    level1_seconds: dict = field(
        default_factory=lambda: {"eyes": 2.0, "fatigue": 2.0, "distraction": 3.0,
                                 "drinking": 3.0, "dangerous": 3.0}
    )
    level1_repeat_s: float = 10.0     # l'alarme se répète tant que ça continue
    level2_count: int = 3             # nombre d'épisodes ...
    level2_window_s: float = 300.0    # ... dans cette fenêtre (5 min)
    level2_cooldown_s: float = 300.0
    level3_fatigue_s: float = 10.0
    level4_cooldown_s: float = 60.0   # pour le choc
    asleep_cooldown_s: float = ASLEEP_COOLDOWN_S  # répétition de l'alerte si le conducteur RESTE endormi
    asleep_rearm_s: float = 1.0       # temps hors "endormi" avant qu'un nouvel épisode puisse alerter
    grace_s: float = 1.5              # petite pause d'état ignorée (évite les coupures)


@dataclass
class _Track:
    family: str | None = None
    since: float = 0.0
    lost_since: float | None = None
    last_l1: float = 0.0
    episode_fired: bool = False
    l3_fired: bool = False
    episodes: deque = field(default_factory=deque)
    last_l2: float = -1e9
    last_l4: float = -1e9
    last_asleep: float = -1e9
    asleep_active: bool = False
    asleep_gap_since: float | None = None


class AlertEngine:
    def __init__(self, cfg: AlertConfig | None = None):
        self.cfg = cfg or AlertConfig()
        self.tracks: dict[str, _Track] = {}

    def reset_asleep_cooldown(self, vehicle_id: str) -> None:
        tr = self.tracks.setdefault(vehicle_id, _Track())
        tr.last_asleep = -1e9
        tr.asleep_active, tr.asleep_gap_since = False, None

    def update(self, vehicle_id: str, msg: dict, now: float | None = None) -> list[dict]:
        now = time.time() if now is None else now
        cfg = self.cfg
        tr = self.tracks.setdefault(vehicle_id, _Track())
        state = msg.get("state", "NoDetection")
        family = FAMILY.get(state)
        alerts: list[dict] = []

        # --- Niveau 4: conducteur endormi (yeux fermés 5 s) --------------------
        # Une alerte à chaque NOUVEL épisode (le conducteur a rouvert les yeux puis s'est rendormi),
        # et une répétition toutes les asleep_cooldown_s s'il reste endormi.
        if state == "Asleep":
            tr.asleep_gap_since = None
            if not tr.asleep_active or now - tr.last_asleep >= cfg.asleep_cooldown_s:
                tr.asleep_active = True
                tr.last_asleep = now
                secs = msg.get("eyes_closed_s")
                alerts.append(self._make(
                    4, vehicle_id, msg, now, "Conducteur endormi",
                    (f"Yeux fermés depuis {secs:.0f} s. " if isinstance(secs, (int, float)) else "Yeux fermés. ")
                    + "Appel d'urgence (SIMULÉ).", kind="asleep"))
        elif tr.asleep_active:
            if tr.asleep_gap_since is None:
                tr.asleep_gap_since = now
            elif now - tr.asleep_gap_since >= cfg.asleep_rearm_s:
                tr.asleep_active, tr.asleep_gap_since = False, None

        # Petite coupure: on continue l'épisode pendant grace_s secondes
        if family is None and tr.family is not None:
            if tr.lost_since is None:
                tr.lost_since = now
            if now - tr.lost_since < cfg.grace_s:
                family = tr.family
        else:
            tr.lost_since = None

        if family != tr.family:  # nouvel épisode (ou fin d'épisode)
            tr.family = family
            tr.since = now
            tr.episode_fired = False
            tr.l3_fired = False
            tr.lost_since = None

        if family is not None:
            duration = now - tr.since

            if duration >= cfg.level1_seconds[family]:
                if not tr.episode_fired:
                    tr.episode_fired = True
                    tr.last_l1 = now
                    tr.episodes.append(now)
                    alerts.append(self._make(1, vehicle_id, msg, now,
                                             "Alarme conducteur",
                                             f"{FAMILY_LABEL[family]} depuis {duration:.0f} s"))
                    while tr.episodes and now - tr.episodes[0] > cfg.level2_window_s:
                        tr.episodes.popleft()
                    if (len(tr.episodes) >= cfg.level2_count
                            and now - tr.last_l2 >= cfg.level2_cooldown_s):
                        tr.last_l2 = now
                        alerts.append(self._make(
                            2, vehicle_id, msg, now, "Alertes répétées",
                            f"{len(tr.episodes)} épisodes en "
                            f"{cfg.level2_window_s / 60:.0f} min. Contact prévenu avec la position."))
                elif now - tr.last_l1 >= cfg.level1_repeat_s:
                    tr.last_l1 = now
                    alerts.append(self._make(1, vehicle_id, msg, now,
                                             "Alarme conducteur",
                                             f"{FAMILY_LABEL[family]} depuis {duration:.0f} s"))

            if family == "fatigue" and duration >= cfg.level3_fatigue_s and not tr.l3_fired:
                tr.l3_fired = True
                alerts.append(self._make(
                    3, vehicle_id, msg, now, "Fatigue prolongée",
                    f"Fatigue continue depuis {duration:.0f} s. Escalade vers le contact d'urgence."))

        if (msg.get("impact") and state not in ("SafeDriving", "EyesOpen")
                and now - tr.last_l4 >= cfg.level4_cooldown_s):
            tr.last_l4 = now
            alerts.append(self._make(
                4, vehicle_id, msg, now, "Impact détecté",
                "Choc + conducteur pas en conduite normale. Appel d'urgence (SIMULÉ).", kind="impact"))

        return alerts

    @staticmethod
    def _make(level, vehicle_id, msg, now, title, message, kind="alarm") -> dict:
        lat, lon = msg.get("lat"), msg.get("lon")
        res = {
            "type": "alert",
            "kind": kind,
            "level": level,
            "vehicle_id": vehicle_id,
            "title": title,
            "message": message,
            "state": msg.get("state"),
            "eyes_closed_s": msg.get("eyes_closed_s"),
            "lat": lat,
            "lon": lon,
            "speed": msg.get("speed"),
            "maps_url": f"https://www.google.com/maps?q={lat},{lon}" if lat is not None else None,
            "notify": level >= 2,
            "ts": int(now * 1000),
        }
        if level == 4:
            res["simulated_call"] = {
                "number": EMERGENCY_NUMBER,
                "message": EMERGENCY_MESSAGE,
            }
        return res
