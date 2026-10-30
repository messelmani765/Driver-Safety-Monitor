"""Accès direct à la configuration depuis la racine du projet."""
from __future__ import annotations

import sys
from pathlib import Path

# Ajouter le dossier server au sys.path
_server_dir = Path(__file__).resolve().parent / "server"
if str(_server_dir) not in sys.path:
    sys.path.insert(0, str(_server_dir))

from config import *  # noqa: F401, F403
