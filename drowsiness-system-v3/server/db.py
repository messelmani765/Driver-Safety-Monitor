from __future__ import annotations

"""Base de données SQLite (fichier server/data/app.db).

Tables: users, sessions, drivers, vehicles, detections, alerts, settings.
Toutes les données de démonstration sont FICTIVES.
Mots de passe hachés avec PBKDF2-HMAC-SHA256 (bibliothèque standard hashlib).
"""
import hashlib
import json
import os
import re
import secrets
import sqlite3
import time
from pathlib import Path

BASE = Path(__file__).resolve().parent
DATA_DIR = BASE / "data"
DB_PATH = DATA_DIR / "app.db"
CAPTURES_DIR = BASE / "static" / "captures"

SCHEMA = """
CREATE TABLE IF NOT EXISTS drivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    license_no TEXT DEFAULT '',
    cin TEXT DEFAULT '',
    email TEXT DEFAULT '',
    emergency_name TEXT DEFAULT '',
    emergency_phone TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,          -- identifiant technique: car01, car02 ...
    plate TEXT NOT NULL,                -- matricule
    brand TEXT DEFAULT '',
    model TEXT DEFAULT '',
    color TEXT DEFAULT '',
    driver_id INTEGER REFERENCES drivers(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL CHECK(role IN ('client', 'supervisor')),
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    driver_id INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS detections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_code TEXT NOT NULL,
    ts INTEGER NOT NULL,                -- millisecondes
    lat REAL, lon REAL,
    eyes_closed_s REAL,
    level INTEGER DEFAULT 4,
    image_path TEXT,                    -- ex: captures/2026-10-09/car01_210501.jpg
    status TEXT DEFAULT 'new',          -- new / acknowledged / escalated / responded / closed
    acknowledged_at INTEGER
);
CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    vehicle_code TEXT NOT NULL,
    level INTEGER NOT NULL,
    title TEXT,
    message TEXT,
    detection_id INTEGER,
    status TEXT DEFAULT 'new'           -- new / cancelled / police_called / responded / dispatched / closed
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
CREATE TABLE IF NOT EXISTS vehicle_routes (
    vehicle_code TEXT PRIMARY KEY,
    waypoints_json TEXT NOT NULL,
    points_json TEXT NOT NULL,
    distance_km REAL DEFAULT 0,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_det_ts ON detections(ts);
CREATE INDEX IF NOT EXISTS idx_alert_ts ON alerts(ts);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
"""

DEMO_DRIVERS = [
    ("Ahmed Ben Salah", "+216 20 000 001", "DEMO-001", "08123456", "client1@safety.tn", "Fatma Ben Salah", "+216 22 111 222"),
    ("Sana Trabelsi", "+216 20 000 002", "DEMO-002", "08234567", "sana@safety.tn", "Mohamed Trabelsi", "+216 22 333 444"),
    ("Karim Jlassi", "+216 20 000 003", "DEMO-003", "08345678", "karim@safety.tn", "Leila Jlassi", "+216 22 555 666"),
    ("Amel Gharbi", "+216 20 000 004", "DEMO-004", "08456789", "amel@safety.tn", "Ali Gharbi", "+216 22 777 888"),
    ("Youssef Mejri", "+216 20 000 005", "DEMO-005", "08567890", "youssef@safety.tn", "Salma Mejri", "+216 22 999 000"),
]

DEMO_VEHICLES = [
    ("car01", "123 TUN 4567", "Peugeot", "208", "Blanche"),
    ("car02", "201 TUN 8890", "Renault", "Clio", "Rouge"),
    ("car03", "145 TUN 3321", "Kia", "Picanto", "Grise"),
    ("car04", "178 TUN 6502", "Dacia", "Logan", "Bleue"),
    ("car05", "220 TUN 1184", "Volkswagen", "Polo", "Noire"),
]

DEFAULT_SETTINGS = {
    "eyes_closed_s": "5",
    "asleep_cooldown_s": "60",
    "ack_timeout_s": "10",
    "emergency_number": "+216 00 000 000",
}


def conn() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    c.execute("PRAGMA journal_mode = WAL")
    return c


def rows(cur) -> list[dict]:
    return [dict(r) for r in cur.fetchall()]


# ---------------------------------------------------------------- hachage sécurité
def hash_password(password: str) -> str:
    """PBKDF2-HMAC-SHA256 avec sel aléatoire de 16 octets (100 000 itérations)."""
    salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return f"{salt}:{key.hex()}"


def verify_password(password: str, hashed: str) -> bool:
    """Vérifie le mot de passe en temps constant contre les attaques temporelles."""
    try:
        if not hashed or ":" not in hashed:
            return False
        salt, key_hex = hashed.split(":", 1)
        key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
        return secrets.compare_digest(key.hex(), key_hex)
    except Exception:
        return False


# ---------------------------------------------------------------- initialisation & migrations
def _ensure_column(c: sqlite3.Connection, table: str, col: str, col_type: str, default: str = "''"):
    cols = [r[1] for r in c.execute(f"PRAGMA table_info({table})").fetchall()]
    if col not in cols:
        c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {col_type} DEFAULT {default}")


def init_db(seed: bool = True) -> None:
    CAPTURES_DIR.mkdir(parents=True, exist_ok=True)
    with conn() as c:
        c.executescript(SCHEMA)
        # Migrations souples si la table existe déjà
        _ensure_column(c, "drivers", "cin", "TEXT", "''")
        _ensure_column(c, "drivers", "email", "TEXT", "''")
        _ensure_column(c, "drivers", "emergency_name", "TEXT", "''")
        _ensure_column(c, "drivers", "emergency_phone", "TEXT", "''")
        _ensure_column(c, "alerts", "status", "TEXT", "'new'")
        c.execute(
            "CREATE TABLE IF NOT EXISTS subscriptions ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, driver_id INTEGER NOT NULL, plan_id TEXT NOT NULL, "
            "plan_name TEXT NOT NULL, amount REAL NOT NULL, card_last4 TEXT, receipt TEXT NOT NULL, "
            "started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active')")

        if seed:
            seed_data(c)


def seed_data(c: sqlite3.Connection) -> None:
    # 1. Véhicules et conducteurs
    if c.execute("SELECT COUNT(*) FROM vehicles").fetchone()[0] == 0:
        ids = []
        for name, phone, lic, cin, email, em_name, em_phone in DEMO_DRIVERS:
            cur = c.execute(
                "INSERT INTO drivers(full_name, phone, license_no, cin, email, emergency_name, emergency_phone) "
                "VALUES (?,?,?,?,?,?,?)",
                (name, phone, lic, cin, email, em_name, em_phone))
            ids.append(cur.lastrowid)
        for (code, plate, brand, model, color), did in zip(DEMO_VEHICLES, ids):
            c.execute(
                "INSERT INTO vehicles(code, plate, brand, model, color, driver_id) VALUES (?,?,?,?,?,?)",
                (code, plate, brand, model, color, did))

    # 2. Utilisateur Superviseur (police / police123)
    row_police = c.execute("SELECT id FROM users WHERE username = 'police'").fetchone()
    if not row_police:
        c.execute(
            "INSERT INTO users(role, username, password_hash, driver_id, created_at) VALUES (?,?,?,?,?)",
            ("supervisor", "police", hash_password("police123"), None, int(time.time() * 1000))
        )

    # 3. Utilisateur Client démo (client1 / client123)
    row_client = c.execute("SELECT id FROM users WHERE username = 'client1'").fetchone()
    d_row = c.execute("SELECT id FROM drivers ORDER BY id ASC LIMIT 1").fetchone()
    did = d_row[0] if d_row else None
    if did:
        c.execute(
            "UPDATE drivers SET cin = '08123456', email = 'client1@safety.tn', "
            "emergency_name = 'Fatma Ben Salah', emergency_phone = '+216 22 111 222', "
            "phone = '+216 20 000 001' WHERE id = ? AND (cin IS NULL OR cin = '')",
            (did,)
        )
    if not row_client:
        c.execute(
            "INSERT INTO users(role, username, password_hash, driver_id, created_at) VALUES (?,?,?,?,?)",
            ("client", "client1", hash_password("client123"), did, int(time.time() * 1000))
        )


# ---------------------------------------------------------------- sessions & auth
USER_FIELDS = (
    "u.id, u.role, u.username, u.driver_id, "
    "d.full_name, d.phone, d.cin, d.email, d.emergency_name, d.emergency_phone, "
    "v.code AS vehicle_code, v.plate, v.brand, v.model, v.color "
)
USER_JOIN = (
    "FROM users u "
    "LEFT JOIN drivers d ON d.id = u.driver_id "
    "LEFT JOIN vehicles v ON v.driver_id = d.id "
)


def authenticate_user(username: str, password: str) -> dict | None:
    username = username.strip().lower()
    with conn() as c:
        row = c.execute(
            f"SELECT {USER_FIELDS}, u.password_hash {USER_JOIN} WHERE lower(u.username) = ? OR lower(d.email) = ?",
            (username, username)
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        pw_hash = d.pop("password_hash")
        if verify_password(password, pw_hash):
            return d
        return None


def create_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    with conn() as c:
        c.execute("INSERT INTO sessions(token, user_id, created_at) VALUES (?, ?, ?)",
                  (token, user_id, int(time.time() * 1000)))
    return token


def get_user_by_token(token: str) -> dict | None:
    if not token:
        return None
    with conn() as c:
        row = c.execute(
            f"SELECT {USER_FIELDS} {USER_JOIN} "
            f"JOIN sessions s ON s.user_id = u.id WHERE s.token = ?",
            (token,)
        ).fetchone()
        return dict(row) if row else None


def get_user_by_id(user_id: int) -> dict | None:
    with conn() as c:
        row = c.execute(f"SELECT {USER_FIELDS} {USER_JOIN} WHERE u.id = ?", (user_id,)).fetchone()
        return dict(row) if row else None


def delete_session(token: str) -> None:
    with conn() as c:
        c.execute("DELETE FROM sessions WHERE token = ?", (token,))


def next_vehicle_code(c: sqlite3.Connection) -> str:
    """Génère le prochain code voiture unique (ex: car01, car02, car06...)."""
    codes = [r[0] for r in c.execute("SELECT code FROM vehicles WHERE code LIKE 'car%'").fetchall()]
    nums = []
    for cd in codes:
        m = re.search(r"car(\d+)", cd)
        if m:
            nums.append(int(m.group(1)))
    nxt = max(nums, default=0) + 1
    return f"car{nxt:02d}"


def save_vehicle_route(vehicle_code: str, waypoints: list, points: list, distance_km: float = 0) -> dict:
    with conn() as c:
        c.execute(
            "INSERT INTO vehicle_routes(vehicle_code, waypoints_json, points_json, distance_km, updated_at) "
            "VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(vehicle_code) DO UPDATE SET waypoints_json=excluded.waypoints_json, "
            "points_json=excluded.points_json, distance_km=excluded.distance_km, updated_at=excluded.updated_at",
            (vehicle_code, json.dumps(waypoints), json.dumps(points), float(distance_km or 0), int(time.time() * 1000))
        )
    return get_vehicle_route(vehicle_code) or {}


def get_vehicle_route(vehicle_code: str) -> dict | None:
    with conn() as c:
        row = c.execute("SELECT * FROM vehicle_routes WHERE vehicle_code = ?", (vehicle_code,)).fetchone()
        if row:
            try:
                return {
                    "vehicle_code": row["vehicle_code"],
                    "waypoints": json.loads(row["waypoints_json"]),
                    "points": json.loads(row["points_json"]),
                    "distance_km": float(row["distance_km"] or 0),
                    "updated_at": row["updated_at"],
                    "fallback": False
                }
            except Exception:
                pass
    return None


def register_client(data: dict) -> dict:
    """Inscription d'un nouveau conducteur avec création de compte, driver, voiture et trajet tracé."""
    full_name = str(data.get("full_name", "")).strip()
    raw_cin = str(data.get("cin", "")).strip()
    cin = re.sub(r"\D", "", raw_cin)
    phone = str(data.get("phone", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    username = str(data.get("username", "")).strip().lower() or email or cin
    password = str(data.get("password", "")).strip()
    plate = str(data.get("plate", "")).strip().upper()
    brand = str(data.get("brand", "")).strip()
    model = str(data.get("model", "")).strip()
    color = str(data.get("color", "Blanche")).strip()
    emergency_name = str(data.get("emergency_name", "")).strip()
    emergency_phone = str(data.get("emergency_phone", "")).strip()
    route_data = data.get("route")

    # Validations claires en français
    if not full_name or len(full_name) < 2:
        raise ValueError("Le nom complet est obligatoire (au moins 2 caractères).")
    if len(cin) != 8:
        raise ValueError("Le numéro CIN doit comporter exactement 8 chiffres (ex: 08123456).")
    if not email or "@" not in email or "." not in email:
        raise ValueError("L'adresse email est invalide.")
    if len(password) < 4:
        raise ValueError("Le mot de passe doit comporter au moins 4 caractères.")
    if not plate:
        raise ValueError("Le matricule de la voiture est obligatoire (ex: 123 TUN 4567).")

    with conn() as c:
        # Vérification d'unicité avec messages d'erreur détaillés
        if c.execute("SELECT 1 FROM users WHERE lower(username) = ?", (username,)).fetchone():
            raise ValueError(f"L'identifiant '{username}' est déjà utilisé par un autre compte.")
        if c.execute("SELECT 1 FROM drivers WHERE lower(email) = ?", (email,)).fetchone():
            raise ValueError("Cette adresse email est déjà associée à un compte conducteur.")
        if c.execute("SELECT 1 FROM drivers WHERE cin = ?", (cin,)).fetchone():
            raise ValueError(f"Le CIN '{cin}' est déjà enregistré dans le système.")
        if c.execute("SELECT 1 FROM vehicles WHERE plate = ?", (plate,)).fetchone():
            raise ValueError(f"Le matricule '{plate}' est déjà enregistré pour un autre véhicule.")

        # 1. Créer le conducteur
        cur_d = c.execute(
            "INSERT INTO drivers(full_name, phone, license_no, cin, email, emergency_name, emergency_phone) "
            "VALUES (?,?,?,?,?,?,?)",
            (full_name, phone, cin, cin, email, emergency_name, emergency_phone)
        )
        driver_id = cur_d.lastrowid

        # 2. Créer le véhicule avec code auto (ex: car06)
        code = next_vehicle_code(c)
        c.execute(
            "INSERT INTO vehicles(code, plate, brand, model, color, driver_id) VALUES (?,?,?,?,?,?)",
            (code, plate, brand, model, color, driver_id)
        )

        # 3. Créer l'utilisateur
        pw_hash = hash_password(password)
        cur_u = c.execute(
            "INSERT INTO users(role, username, password_hash, driver_id, created_at) VALUES (?,?,?,?,?)",
            ("client", username, pw_hash, driver_id, int(time.time() * 1000))
        )
        user_id = cur_u.lastrowid

        # 4. Enregistrer le trajet tracé si fourni
        saved_route = None
        if isinstance(route_data, dict):
            wps = route_data.get("waypoints", [])
            pts = route_data.get("points", [])
            dist = float(route_data.get("distance_km", 0) or 0)
            if wps and pts:
                c.execute(
                    "INSERT INTO vehicle_routes(vehicle_code, waypoints_json, points_json, distance_km, updated_at) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (code, json.dumps(wps), json.dumps(pts), dist, int(time.time() * 1000))
                )
                saved_route = {"vehicle_code": code, "waypoints": wps, "points": pts, "distance_km": dist}

        # 5. Créer la session
        token = secrets.token_urlsafe(32)
        c.execute("INSERT INTO sessions(token, user_id, created_at) VALUES (?, ?, ?)",
                  (token, user_id, int(time.time() * 1000)))

    user_info = get_user_by_id(user_id)
    return {
        "ok": True,
        "token": token,
        "user": user_info,
        "vehicle_code": code,
        "plate": plate,
        "route": saved_route
    }


def update_client_profile(driver_id: int, data: dict) -> dict:
    with conn() as c:
        c.execute(
            "UPDATE drivers SET full_name = ?, phone = ?, cin = ?, email = ?, "
            "emergency_name = ?, emergency_phone = ? WHERE id = ?",
            (
                str(data.get("full_name", "")).strip(),
                str(data.get("phone", "")).strip(),
                str(data.get("cin", "")).strip(),
                str(data.get("email", "")).strip().lower(),
                str(data.get("emergency_name", "")).strip(),
                str(data.get("emergency_phone", "")).strip(),
                driver_id,
            )
        )
        # Mise à jour des infos voiture si fournies
        if "brand" in data or "model" in data or "color" in data or "plate" in data:
            c.execute(
                "UPDATE vehicles SET plate = coalesce(nullif(?, ''), plate), "
                "brand = coalesce(?, brand), model = coalesce(?, model), color = coalesce(?, color) "
                "WHERE driver_id = ?",
                (data.get("plate"), data.get("brand"), data.get("model"), data.get("color"), driver_id)
            )
        row = c.execute("SELECT * FROM drivers WHERE id = ?", (driver_id,)).fetchone()
        return dict(row) if row else {}


# ---------------------------------------------------------------- réglages
def get_settings() -> dict:
    out = dict(DEFAULT_SETTINGS)
    with conn() as c:
        for r in c.execute("SELECT key, value FROM settings"):
            out[r["key"]] = r["value"]
    return out


def set_settings(values: dict) -> dict:
    with conn() as c:
        for k, v in values.items():
            if k in DEFAULT_SETTINGS:
                c.execute("INSERT INTO settings(key, value) VALUES (?, ?) "
                          "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (k, str(v)))
    return get_settings()


# ---------------------------------------------------------------- conducteurs
DRIVER_SELECT = (
    "SELECT d.*, v.plate AS plate, v.code AS vehicle_code, v.brand AS brand, v.model AS model, "
    "u.username AS username, u.id AS user_id "
    "FROM drivers d "
    "LEFT JOIN vehicles v ON v.driver_id = d.id "
    "LEFT JOIN users u ON u.driver_id = d.id "
)


def list_drivers() -> list[dict]:
    with conn() as c:
        return rows(c.execute(DRIVER_SELECT + "ORDER BY d.id"))


def get_driver(driver_id: int) -> dict | None:
    with conn() as c:
        r = c.execute(DRIVER_SELECT + "WHERE d.id = ?", (driver_id,)).fetchone()
        return dict(r) if r else None


def save_driver(data: dict, driver_id: int | None = None) -> dict:
    name = str(data.get("full_name", "")).strip()
    if not name:
        raise ValueError("Le nom est obligatoire")
    with conn() as c:
        if driver_id is None:
            cur = c.execute(
                "INSERT INTO drivers(full_name, phone, license_no, cin, email, emergency_name, emergency_phone) "
                "VALUES (?,?,?,?,?,?,?)",
                (name, str(data.get("phone", "")), str(data.get("license_no", "")),
                 str(data.get("cin", "")), str(data.get("email", "")),
                 str(data.get("emergency_name", "")), str(data.get("emergency_phone", ""))))
            driver_id = cur.lastrowid
        else:
            c.execute(
                "UPDATE drivers SET full_name=?, phone=?, license_no=?, cin=?, email=?, "
                "emergency_name=?, emergency_phone=? WHERE id=?",
                (name, str(data.get("phone", "")), str(data.get("license_no", "")),
                 str(data.get("cin", "")), str(data.get("email", "")),
                 str(data.get("emergency_name", "")), str(data.get("emergency_phone", "")), driver_id))
        return get_driver(driver_id) or {}


def delete_driver(driver_id: int) -> None:
    with conn() as c:
        c.execute("DELETE FROM drivers WHERE id=?", (driver_id,))


# ---------------------------------------------------------------- voitures
VEHICLE_SELECT = (
    "SELECT v.*, d.full_name AS driver_name, d.cin AS driver_cin, d.phone AS driver_phone, "
    "d.email AS driver_email, d.emergency_name AS emergency_name, d.emergency_phone AS emergency_phone, "
    "(SELECT COUNT(*) FROM alerts a WHERE a.vehicle_code = v.code) AS alerts_count "
    "FROM vehicles v LEFT JOIN drivers d ON d.id = v.driver_id "
)


def list_vehicles() -> list[dict]:
    with conn() as c:
        return rows(c.execute(VEHICLE_SELECT + "ORDER BY v.code"))


def vehicle_by_code(code: str) -> dict | None:
    with conn() as c:
        r = c.execute(VEHICLE_SELECT + "WHERE v.code = ?", (code,)).fetchone()
        return dict(r) if r else None


def save_vehicle(data: dict, vehicle_id: int | None = None) -> dict:
    code = str(data.get("code", "")).strip()
    plate = str(data.get("plate", "")).strip()
    if not plate:
        raise ValueError("Le matricule est obligatoire")
    driver_id = data.get("driver_id") or None
    with conn() as c:
        if vehicle_id is None:
            if not code:
                code = next_vehicle_code(c)
            cur = c.execute(
                "INSERT INTO vehicles(code, plate, brand, model, color, driver_id) VALUES (?,?,?,?,?,?)",
                (code, plate, data.get("brand", ""), data.get("model", ""),
                 data.get("color", ""), driver_id))
            vehicle_id = cur.lastrowid
        else:
            c.execute("UPDATE vehicles SET plate=?, brand=?, model=?, color=?, driver_id=? WHERE id=?",
                      (plate, data.get("brand", ""), data.get("model", ""),
                       data.get("color", ""), driver_id, vehicle_id))
        r = c.execute(VEHICLE_SELECT + "WHERE v.id = ?", (vehicle_id,)).fetchone()
        return dict(r)


def delete_vehicle(vehicle_id: int) -> None:
    with conn() as c:
        c.execute("DELETE FROM vehicles WHERE id=?", (vehicle_id,))


# ---------------------------------------------------------------- détections
DET_SELECT = (
    "SELECT x.*, v.plate AS plate, v.brand AS brand, v.model AS model, "
    "d.full_name AS driver_name, d.cin AS driver_cin, d.phone AS driver_phone "
    "FROM detections x LEFT JOIN vehicles v ON v.code = x.vehicle_code "
    "LEFT JOIN drivers d ON d.id = v.driver_id "
)


def _det_out(r: dict) -> dict:
    r["image_url"] = f"/static/{r['image_path']}" if r.get("image_path") else None
    return r


def insert_detection(vehicle_code: str, ts_ms: int, lat, lon, eyes_closed_s,
                     level: int = 4, image_path: str | None = None, status: str = "new") -> int:
    with conn() as c:
        cur = c.execute(
            "INSERT INTO detections(vehicle_code, ts, lat, lon, eyes_closed_s, level, image_path, status) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (vehicle_code, ts_ms, lat, lon, eyes_closed_s, level, image_path, status))
        return cur.lastrowid


def get_detection(det_id: int) -> dict | None:
    with conn() as c:
        r = c.execute(DET_SELECT + "WHERE x.id = ?", (det_id,)).fetchone()
        return _det_out(dict(r)) if r else None


def find_pending_detection(vehicle_code: str, since_ms: int) -> dict | None:
    with conn() as c:
        r = c.execute(
            "SELECT id FROM detections WHERE vehicle_code=? AND ts>=? AND image_path IS NULL "
            "ORDER BY ts DESC LIMIT 1", (vehicle_code, since_ms)).fetchone()
        return get_detection(r["id"]) if r else None


def find_unlinked_detection(vehicle_code: str, since_ms: int) -> dict | None:
    with conn() as c:
        r = c.execute(
            "SELECT x.id FROM detections x WHERE x.vehicle_code=? AND x.ts>=? "
            "AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.detection_id = x.id) "
            "ORDER BY x.ts DESC LIMIT 1", (vehicle_code, since_ms)).fetchone()
        return get_detection(r["id"]) if r else None


def set_detection_image(det_id: int, image_path: str) -> None:
    with conn() as c:
        c.execute("UPDATE detections SET image_path=? WHERE id=?", (image_path, det_id))


def set_detection_status(det_id: int, status: str, conn_obj: sqlite3.Connection | None = None) -> None:
    def _run(c):
        if status in ("acknowledged", "cancelled"):
            c.execute("UPDATE detections SET status=?, acknowledged_at=? WHERE id=?",
                      (status, int(time.time() * 1000), det_id))
        else:
            c.execute("UPDATE detections SET status=? WHERE id=?", (status, det_id))

    if conn_obj is not None:
        _run(conn_obj)
    else:
        with conn() as c:
            _run(c)


def list_detections(vehicle: str | None = None, date_from: str | None = None,
                    date_to: str | None = None, status: str | None = None,
                    limit: int = 500) -> list[dict]:
    where, args = [], []
    if vehicle:
        where.append("x.vehicle_code = ?")
        args.append(vehicle)
    if status:
        where.append("x.status = ?")
        args.append(status)
    if date_from:
        where.append("x.ts >= ?")
        args.append(_day_ms(date_from, 0))
    if date_to:
        where.append("x.ts < ?")
        args.append(_day_ms(date_to, 1))
    sql = DET_SELECT + (("WHERE " + " AND ".join(where) + " ") if where else "") + "ORDER BY x.ts DESC LIMIT ?"
    args.append(limit)
    with conn() as c:
        return [_det_out(r) for r in rows(c.execute(sql, args))]


def _day_ms(day: str, plus_days: int) -> int:
    t = time.mktime(time.strptime(day, "%Y-%m-%d")) + plus_days * 86400
    return int(t * 1000)


def delete_detection(det_id: int) -> None:
    d = get_detection(det_id)
    with conn() as c:
        c.execute("DELETE FROM detections WHERE id=?", (det_id,))
    if d and d.get("image_path"):
        try:
            p = (BASE / "static" / d["image_path"]).resolve()
            if CAPTURES_DIR.resolve() in p.parents and p.exists():
                os.remove(p)
        except OSError:
            pass


# ---------------------------------------------------------------- alertes
ALERT_SELECT = (
    "SELECT a.*, v.plate AS plate, v.brand AS brand, v.model AS model, "
    "d.full_name AS driver_name, d.cin AS driver_cin, d.phone AS driver_phone, "
    "d.emergency_name AS emergency_name, d.emergency_phone AS emergency_phone, "
    "x.status AS det_status, x.image_path AS image_path, x.lat AS lat, x.lon AS lon, "
    "x.eyes_closed_s AS eyes_closed_s "
    "FROM alerts a "
    "LEFT JOIN vehicles v ON v.code = a.vehicle_code "
    "LEFT JOIN drivers d ON d.id = v.driver_id "
    "LEFT JOIN detections x ON x.id = a.detection_id "
)


def _alert_out(r: dict) -> dict:
    if r.get("image_path"):
        r["image_url"] = f"/static/{r['image_path']}"
    else:
        r["image_url"] = None
    # statut convivial
    st = r.get("status") or "new"
    status_labels = {
        "new": "En attente",
        "cancelled": "Annulé par moi",
        "acknowledged": "Annulé par moi",
        "police_called": "Police appelée",
        "escalated": "Police appelée",
        "responded": "Police a répondu",
        "dispatched": "Unité envoyée",
        "closed": "Clôturé",
    }
    r["status_label"] = status_labels.get(st, st)
    return r


def insert_alert(a: dict) -> int:
    status = a.get("status", "new")
    with conn() as c:
        cur = c.execute(
            "INSERT INTO alerts(ts, vehicle_code, level, title, message, detection_id, status) VALUES (?,?,?,?,?,?,?)",
            (a.get("ts"), a.get("vehicle_id") or a.get("vehicle_code"), a.get("level"), a.get("title"),
             a.get("message"), a.get("detection_id"), status))
        return cur.lastrowid


def get_alert(alert_id: int) -> dict | None:
    with conn() as c:
        r = c.execute(ALERT_SELECT + "WHERE a.id = ?", (alert_id,)).fetchone()
        return _alert_out(dict(r)) if r else None


def update_alert_status(alert_id: int, new_status: str) -> dict | None:
    with conn() as c:
        c.execute("UPDATE alerts SET status = ? WHERE id = ?", (new_status, alert_id))
        r = c.execute("SELECT detection_id, vehicle_code FROM alerts WHERE id = ?", (alert_id,)).fetchone()
        if r and r["detection_id"]:
            det_st = "acknowledged" if new_status in ("cancelled", "acknowledged") else new_status
            set_detection_status(r["detection_id"], det_st, conn_obj=c)
    return get_alert(alert_id)


def list_alerts(vehicle_code: str | None = None, limit: int = 100) -> list[dict]:
    where = "WHERE a.vehicle_code = ? " if vehicle_code else ""
    args = [vehicle_code, limit] if vehicle_code else [limit]
    with conn() as c:
        return [_alert_out(r) for r in rows(c.execute(ALERT_SELECT + where + "ORDER BY a.ts DESC LIMIT ?", args))]


# ---------------------------------------------------------------- statistiques
def stats() -> dict:
    now = time.time()
    t0 = time.localtime(now)
    midnight_ms = int(time.mktime((t0.tm_year, t0.tm_mon, t0.tm_mday, 0, 0, 0, 0, 0, -1)) * 1000)
    with conn() as c:
        one = lambda sql, *a: c.execute(sql, a).fetchone()[0]  # noqa: E731
        last = c.execute(
            "SELECT a.*, v.plate AS plate, d.full_name AS driver_name FROM alerts a "
            "LEFT JOIN vehicles v ON v.code=a.vehicle_code "
            "LEFT JOIN drivers d ON d.id=v.driver_id "
            "ORDER BY a.ts DESC LIMIT 1").fetchone()
        by_day = []
        for i in range(6, -1, -1):
            start = midnight_ms - i * 86400 * 1000
            n = one("SELECT COUNT(*) FROM alerts WHERE ts >= ? AND ts < ?", start, start + 86400 * 1000)
            by_day.append({"day": time.strftime("%d/%m", time.localtime(start / 1000)), "count": n})
        by_hour = [0] * 24
        for r in c.execute("SELECT ts FROM alerts WHERE ts >= ?", (midnight_ms,)):
            by_hour[time.localtime(r["ts"] / 1000).tm_hour] += 1
        return {
            "total_alerts": one("SELECT COUNT(*) FROM alerts"),
            "alerts_today": one("SELECT COUNT(*) FROM alerts WHERE ts >= ?", midnight_ms),
            "total_detections": one("SELECT COUNT(*) FROM detections"),
            "detections_new": one("SELECT COUNT(*) FROM detections WHERE status='new'"),
            "vehicles_total": one("SELECT COUNT(*) FROM vehicles"),
            "drivers_total": one("SELECT COUNT(*) FROM drivers"),
            "clients_total": one("SELECT COUNT(*) FROM users WHERE role='client'"),
            "last_alert": _alert_out(dict(last)) if last else None,
            "by_day": by_day,
            "by_hour": by_hour,
        }


# =================================================================== OFFRES & PAIEMENT SIMULÉ
# Paiement 100% simulé: aucun débit, seul le dernier groupe de 4 chiffres de la carte est conservé.
PLANS = [
    {"id": "basic", "name": "Basique", "price": 19,
     "features": ["1 voiture", "Détection de somnolence en direct", "Alerte sonore et vibration"]},
    {"id": "standard", "name": "Standard", "price": 39, "popular": True,
     "features": ["Tout le Basique", "Appel de la police (simulé)", "Suivi du trajet en direct"]},
    {"id": "premium", "name": "Premium", "price": 69,
     "features": ["Tout le Standard", "Historique complet des images", "Assistance prioritaire (démo)"]},
]


def get_plan(plan_id: str) -> dict | None:
    return next((p for p in PLANS if p["id"] == plan_id), None)


def get_subscription(driver_id: int) -> dict | None:
    with conn() as c:
        row = c.execute("SELECT * FROM subscriptions WHERE driver_id = ? AND status = 'active' "
                        "ORDER BY id DESC LIMIT 1", (driver_id,)).fetchone()
        return dict(row) if row else None


def create_subscription(driver_id: int, plan_id: str, card_last4: str = "") -> dict:
    plan = get_plan(plan_id)
    if not plan:
        raise ValueError("Offre inconnue.")
    last4 = re.sub(r"\D", "", str(card_last4))[-4:]
    now = int(time.time() * 1000)
    receipt = f"REC-{time.strftime('%Y%m%d')}-{secrets.token_hex(3).upper()}"
    with conn() as c:
        c.execute("UPDATE subscriptions SET status = 'replaced' WHERE driver_id = ? AND status = 'active'",
                  (driver_id,))
        c.execute(
            "INSERT INTO subscriptions(driver_id, plan_id, plan_name, amount, card_last4, receipt, started_at, expires_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (driver_id, plan["id"], plan["name"], plan["price"], last4, receipt, now, now + 30 * 86400000))
    return get_subscription(driver_id)
