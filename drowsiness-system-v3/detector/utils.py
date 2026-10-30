from __future__ import annotations

"""Petits outils: lissage des états, trajet GPS simulé, minuteur des yeux fermés."""
import bisect
import json
import math
import sys
import time
from collections import Counter, deque
from pathlib import Path

# Importer la configuration commune (server/config.py)
_root_dir = Path(__file__).resolve().parent.parent
if str(_root_dir / "server") not in sys.path:
    sys.path.insert(0, str(_root_dir / "server"))

from config import (  # noqa: E402
    DEFAULT_SPEED_KMH, DETECTION_HOLD_S, EYES_CLOSED_SECONDS, EYES_OPEN_RESET_S,
    NOFACE_RESET_S, ROUTE_WAYPOINTS, START_LAT, START_LON,
)

ROUTE_FILE = _root_dir / "server" / "static" / "route.json"


class StateSmoother:
    """Vote majoritaire sur une fenêtre de temps (gardé de la version 1)."""

    def __init__(self, window_s: float = 1.5):
        self.window_s = window_s
        self.items = deque()  # (temps, état, confiance)

    def add(self, state: str, conf: float, now: float | None = None) -> None:
        now = time.time() if now is None else now
        self.items.append((now, state, conf))
        while self.items and now - self.items[0][0] > self.window_s:
            self.items.popleft()

    def result(self) -> tuple[str, float]:
        if not self.items:
            return "NoDetection", 0.0
        votes = Counter(s for _, s, _ in self.items)
        state = votes.most_common(1)[0][0]
        confs = [c for _, s, c in self.items if s == state]
        return state, sum(confs) / len(confs)


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Distance en mètres entre deux points (lat, lon)."""
    r = 6371000.0
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    dla, dlo = la2 - la1, lo2 - lo1
    h = math.sin(dla / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def bearing_deg(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Cap (0 = nord, 90 = est) pour aller du point a au point b."""
    la1, la2 = math.radians(a[0]), math.radians(b[0])
    dlo = math.radians(b[1] - a[1])
    y = math.sin(dlo) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dlo)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def load_route_points() -> list[tuple[float, float]]:
    """Lit server/static/route.json (créé par build_route.py). Sinon: lignes droites."""
    try:
        data = json.loads(ROUTE_FILE.read_text(encoding="utf-8"))
        pts = [(float(p[0]), float(p[1])) for p in data["points"]]
        if len(pts) >= 2:
            return pts
    except Exception:
        pass
    return list(ROUTE_WAYPOINTS)


class RouteSimulator:
    """Fait avancer une voiture le long d'un trajet fermé (boucle).

    step(dt) renvoie (lat, lon, cap_en_degrés, progression_en_%).
    start_frac (0..1) permet de démarrer plusieurs voitures à des endroits différents.
    """

    def __init__(self, points=None, speed_kmh: float = DEFAULT_SPEED_KMH,
                 start_frac: float = 0.0):
        pts = list(points or load_route_points())
        if haversine_m(pts[0], pts[-1]) > 20:  # boucle: on revient au départ
            pts.append(pts[0])
        self.points = pts
        self.cum = [0.0]
        for i in range(len(pts) - 1):
            self.cum.append(self.cum[-1] + haversine_m(pts[i], pts[i + 1]))
        self.total = self.cum[-1]
        if self.total <= 0:
            raise ValueError("Il faut au moins deux points différents")
        self.speed_kmh = speed_kmh
        self.s = (start_frac % 1.0) * self.total  # mètres parcourus sur la boucle

    def step(self, dt: float) -> tuple[float, float, float, float]:
        self.s = (self.s + (self.speed_kmh / 3.6) * dt) % self.total
        i = max(1, bisect.bisect_left(self.cum, self.s))
        i = min(i, len(self.points) - 1)
        a, b = self.points[i - 1], self.points[i]
        seg = self.cum[i] - self.cum[i - 1]
        frac = (self.s - self.cum[i - 1]) / seg if seg > 0 else 0.0
        lat = a[0] + (b[0] - a[0]) * frac
        lon = a[1] + (b[1] - a[1]) * frac
        return lat, lon, bearing_deg(a, b), 100.0 * self.s / self.total


class EyeTimer:
    """Règle des yeux fermés.

    update(n_open, n_closed) est appelé à chaque image avec le nombre d'yeux
    ouverts / fermés vus par le modèle. Il renvoie:
        (état, secondes_yeux_fermés)
    états: EyesOpen, EyesClosed, Asleep, NoFace

    - Un clignement court ne compte pas: il faut que les yeux soient ouverts
      plus de `open_reset_s` pour remettre le chronomètre à zéro.
    - Si le modèle ne voit plus rien pendant moins de `hold_s`, on garde l'état
      précédent (un œil fermé est parfois plus dur à détecter).
    - Visage perdu: état NoFace, le chronomètre s'arrête, puis repart de zéro
      après `noface_reset_s`.
    """

    def __init__(self, closed_seconds: float = EYES_CLOSED_SECONDS,
                 open_reset_s: float = EYES_OPEN_RESET_S,
                 hold_s: float = DETECTION_HOLD_S,
                 noface_reset_s: float = NOFACE_RESET_S):
        self.closed_seconds = closed_seconds
        self.open_reset_s = open_reset_s
        self.hold_s = hold_s
        self.noface_reset_s = noface_reset_s
        self.closed_since: float | None = None
        self.open_since: float | None = None
        self.last_seen = -1e9
        self.noface_since: float | None = None
        self.last_kind = "open"  # dernier "vrai" résultat: open / closed

    def update(self, n_open: int, n_closed: int, now: float | None = None) -> tuple[str, float]:
        now = time.time() if now is None else now
        kind = None
        if n_open > 0:
            kind = "open"          # au moins un œil ouvert = pas endormi
        elif n_closed > 0:
            kind = "closed"

        if kind is None:  # rien détecté
            if now - self.last_seen <= self.hold_s:
                kind = self.last_kind  # petite coupure: on continue
            else:
                if self.noface_since is None:
                    self.noface_since = now
                if now - self.noface_since >= self.noface_reset_s:
                    self.closed_since = None
                    self.open_since = None
                    return "NoFace", 0.0
                # chronomètre en pause (on décale le départ du temps perdu)
                closed_s = (self.last_seen - self.closed_since) if self.closed_since else 0.0
                return "NoFace", max(0.0, closed_s)
        else:
            self.last_seen = now
            self.last_kind = kind
            self.noface_since = None

        if kind == "closed":
            self.open_since = None
            if self.closed_since is None:
                self.closed_since = now
            secs = now - self.closed_since
            return ("Asleep" if secs >= self.closed_seconds else "EyesClosed"), secs

        # yeux ouverts
        if self.open_since is None:
            self.open_since = now
        if now - self.open_since >= self.open_reset_s:
            self.closed_since = None
        if self.closed_since is not None:  # clignement en cours: le chrono continue
            secs = now - self.closed_since
            return ("Asleep" if secs >= self.closed_seconds else "EyesOpen"), secs
        return "EyesOpen", 0.0
