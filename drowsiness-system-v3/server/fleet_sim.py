"""Simulation de flotte: fait rouler les voitures qui n'ont pas de webcam active.

Seules les POSITIONS sont simulées (état "yeux ouverts"). Aucune alerte et aucune
image ne sont créées ici: les images viennent uniquement de la vraie webcam.
"""
from __future__ import annotations

import math
import zlib


def _hav(a, b) -> float:
    r = 6371000.0
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _bearing(a, b) -> float:
    la1, la2 = math.radians(a[0]), math.radians(b[0])
    dlo = math.radians(b[1] - a[1])
    y = math.sin(dlo) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dlo)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


class _Track:
    def __init__(self, code: str, points: list):
        self.key = (len(points), tuple(points[0]), tuple(points[-1]))
        self.pts = [(float(p[0]), float(p[1])) for p in points]
        self.cum = [0.0]
        for i in range(len(self.pts) - 1):
            self.cum.append(self.cum[-1] + _hav(self.pts[i], self.pts[i + 1]))
        self.total = self.cum[-1]
        # chaque voiture démarre à un endroit différent du trajet
        self.s = (zlib.crc32(code.encode()) % 100) / 100.0 * self.total * 2.0

    def step(self, speed_kmh: float, dt: float):
        if self.total <= 0:
            return None
        self.s = (self.s + speed_kmh / 3.6 * dt) % (2 * self.total)
        forward = self.s <= self.total
        d = self.s if forward else 2 * self.total - self.s  # aller puis retour
        lo, hi = 1, len(self.pts) - 1
        while lo < hi:  # recherche dichotomique
            mid = (lo + hi) // 2
            if self.cum[mid] < d:
                lo = mid + 1
            else:
                hi = mid
        i = lo
        a, b = self.pts[i - 1], self.pts[i]
        seg = self.cum[i] - self.cum[i - 1]
        f = (d - self.cum[i - 1]) / seg if seg > 0 else 0.0
        lat = a[0] + (b[0] - a[0]) * f
        lon = a[1] + (b[1] - a[1]) * f
        heading = _bearing(a, b) if forward else _bearing(b, a)
        return lat, lon, heading, 100.0 * d / self.total


class FleetSim:
    def __init__(self):
        self.tracks: dict[str, _Track] = {}

    def step(self, code: str, points: list, speed_kmh: float, dt: float):
        if not points or len(points) < 2:
            return None
        key = (len(points), tuple(points[0]), tuple(points[-1]))
        tr = self.tracks.get(code)
        if tr is None or tr.key != key:
            tr = self.tracks[code] = _Track(code, points)
        return tr.step(speed_kmh, dt)
