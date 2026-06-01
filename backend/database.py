import os
import secrets
from contextlib import contextmanager
from typing import Optional

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
import bcrypt as _bcrypt_lib


def _hash_pwd(password: str) -> str:
    return _bcrypt_lib.hashpw(password.encode("utf-8"), _bcrypt_lib.gensalt()).decode()


def _verify_pwd(password: str, hashed: str) -> bool:
    return _bcrypt_lib.checkpw(password.encode("utf-8"), hashed.encode())

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://asd:asd_dev_pass@localhost:5432/abonaments",
)

DEFAULT_REPS = [
    "Błażej Chrapek",
    "Sebastian Domagała",
    "Natalia Cukier",
    "Ireneusz Pawełek",
    "Karol Lewandowski",
    "Joanna Bednarz-Neter",
    "BOK",
]


@contextmanager
def get_conn():
    conn = psycopg2.connect(DATABASE_URL)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    """Create all tables and seed default sales reps."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS devices (
                    sn          VARCHAR PRIMARY KEY,
                    firma       VARCHAR NOT NULL DEFAULT '',
                    maszyna     VARCHAR NOT NULL DEFAULT '',
                    operator    VARCHAR NOT NULL DEFAULT '',
                    prod_date   VARCHAR NOT NULL DEFAULT '',
                    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS payments (
                    sn          VARCHAR  NOT NULL,
                    year_month  VARCHAR  NOT NULL,
                    customer    VARCHAR  NOT NULL DEFAULT '',
                    PRIMARY KEY (sn, year_month)
                );

                -- Firmy wykluczone z naliczania abonamentu (OEM, licencja itp.)
                CREATE TABLE IF NOT EXISTS excluded_firms (
                    firma       VARCHAR PRIMARY KEY,
                    reason      VARCHAR NOT NULL DEFAULT ''
                );

                -- Handlowcy
                CREATE TABLE IF NOT EXISTS sales_reps (
                    id          SERIAL PRIMARY KEY,
                    name        VARCHAR UNIQUE NOT NULL
                );

                -- Przypisanie firm do handlowców (many-to-many)
                CREATE TABLE IF NOT EXISTS firm_reps (
                    firma       VARCHAR NOT NULL,
                    rep_id      INTEGER NOT NULL REFERENCES sales_reps(id) ON DELETE CASCADE,
                    PRIMARY KEY (firma, rep_id)
                );

                -- Konfiguracja firm: typ + cykl płatności
                -- firm_type: ids | licencja | oem | inne
                -- cycle:     monthly | quarterly | annual | once | (puste = nieznane)
                CREATE TABLE IF NOT EXISTS firm_config (
                    firma            VARCHAR PRIMARY KEY,
                    firm_type        VARCHAR NOT NULL DEFAULT 'ids',
                    cycle            VARCHAR NOT NULL DEFAULT '',
                    expected_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
                    currency         VARCHAR NOT NULL DEFAULT ''
                );

                CREATE INDEX IF NOT EXISTS idx_payments_sn       ON payments(sn);
                CREATE INDEX IF NOT EXISTS idx_devices_operator  ON devices(operator);
                CREATE INDEX IF NOT EXISTS idx_devices_firma     ON devices(firma);
                CREATE INDEX IF NOT EXISTS idx_firm_reps_firma   ON firm_reps(firma);
            """)
            # Idempotent column additions (PostgreSQL 9.6+)
            cur.execute("""
                ALTER TABLE devices
                    ADD COLUMN IF NOT EXISTS device_type_override VARCHAR NOT NULL DEFAULT '';
            """)
            cur.execute("""
                ALTER TABLE devices
                    ADD COLUMN IF NOT EXISTS showroom_until VARCHAR NOT NULL DEFAULT '';
            """)
            cur.execute("""
                ALTER TABLE devices
                    ADD COLUMN IF NOT EXISTS comment VARCHAR NOT NULL DEFAULT '';
            """)
            cur.execute("""
                ALTER TABLE payments
                    ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2) NOT NULL DEFAULT 0;
            """)
            cur.execute("""
                ALTER TABLE payments
                    ADD COLUMN IF NOT EXISTS currency VARCHAR NOT NULL DEFAULT '';
            """)
            cur.execute("""
                ALTER TABLE payments
                    ADD COLUMN IF NOT EXISTS amount_netto NUMERIC(12,2) NOT NULL DEFAULT 0;
            """)
            cur.execute("""
                ALTER TABLE payments
                    ADD COLUMN IF NOT EXISTS amount_brutto NUMERIC(12,2) NOT NULL DEFAULT 0;
            """)

            # ── indeksy dla wydajności ─────────────────────────────────────
            cur.execute("CREATE INDEX IF NOT EXISTS idx_payments_sn      ON payments(sn);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_devices_sn        ON devices(sn);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_devices_firma      ON devices(firma);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_firm_config_firma  ON firm_config(firma);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_excluded_firma     ON excluded_firms(firma);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_firm_reps_firma    ON firm_reps(firma);")

            # Ustawienia aplikacji (klucz-wartość)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS app_settings (
                    key   VARCHAR PRIMARY KEY,
                    value TEXT NOT NULL
                );
            """)

            # Użytkownicy systemu
            cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id            SERIAL PRIMARY KEY,
                    email         VARCHAR UNIQUE NOT NULL,
                    name          VARCHAR NOT NULL DEFAULT '',
                    password_hash VARCHAR NOT NULL,
                    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
                    is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at    TIMESTAMPTZ DEFAULT now(),
                    last_login    TIMESTAMPTZ
                );
            """)

            # Seed domyślnych handlowców (idempotentne)
            for name in DEFAULT_REPS:
                cur.execute(
                    "INSERT INTO sales_reps (name) VALUES (%s) ON CONFLICT (name) DO NOTHING",
                    (name,),
                )


# ── status bar ────────────────────────────────────────────────────────────────

def get_status() -> dict:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM devices")
            device_count = cur.fetchone()[0]
            cur.execute(
                "SELECT year_month FROM payments GROUP BY year_month ORDER BY year_month"
            )
            months = [r[0] for r in cur.fetchall()]
    return {"devices": device_count, "months": months}


# ── analysis ──────────────────────────────────────────────────────────────────

def get_analysis() -> list:
    """Return ALL rows — filtering happens in main.py (on cached result)."""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                WITH payment_summary AS (
                    SELECT
                        sn,
                        MAX(customer) FILTER (WHERE customer <> '') AS customer,
                        MIN(year_month)  AS first_pay,
                        MAX(year_month)  AS last_pay,
                        COUNT(*)         AS total_months,
                        SUM(amount)      AS total_amount,
                        MAX(currency) FILTER (WHERE currency <> '') AS currency
                    FROM payments
                    GROUP BY sn
                ),
                rep_summary AS (
                    SELECT
                        fr.firma,
                        STRING_AGG(sr.name, ', ' ORDER BY sr.name) AS handlowcy
                    FROM firm_reps fr
                    JOIN sales_reps sr ON fr.rep_id = sr.id
                    GROUP BY fr.firma
                )
                SELECT
                    COALESCE(d.sn, ps.sn) AS sn,
                    -- Status: urządzenie OEM → showroom → typ firmy (inne/licencja) → wykluczone → paid → unpaid → only
                    CASE
                        WHEN COALESCE(NULLIF(d.device_type_override,''),
                                      CASE WHEN COALESCE(d.maszyna,'') ILIKE '%OEM%'
                                           THEN 'oem' ELSE 'master' END
                             ) = 'oem'                              THEN 'oem'
                        WHEN COALESCE(d.device_type_override,'') = 'showroom' THEN 'showroom'
                        WHEN COALESCE(fc.firm_type,'ids') = 'inne'     THEN 'inne'
                        WHEN COALESCE(fc.firm_type,'ids') = 'licencja' THEN 'licencja'
                        WHEN COALESCE(fc.firm_type,'ids') = 'oem'      THEN 'oem'
                        WHEN ef.firma IS NOT NULL                   THEN 'excluded'
                        WHEN d.sn IS NOT NULL AND ps.sn IS NOT NULL THEN 'paid'
                        WHEN d.sn IS NOT NULL AND ps.sn IS NULL     THEN 'unpaid'
                        ELSE 'only'
                    END                          AS status,
                    -- device_type: manual override → auto (OEM or master)
                    COALESCE(
                        NULLIF(COALESCE(d.device_type_override,''), ''),
                        CASE WHEN COALESCE(d.maszyna,'') ILIKE '%OEM%' THEN 'oem' ELSE 'master' END
                    )                            AS device_type,
                    COALESCE(d.device_type_override, '') AS type_override,
                    COALESCE(d.showroom_until,   '') AS showroom_until,
                    COALESCE(ps.customer,  '')   AS customer,
                    COALESCE(d.firma,      '')   AS firma,
                    COALESCE(d.maszyna,    '')   AS maszyna,
                    COALESCE(d.operator,   '')   AS operator,
                    COALESCE(d.prod_date,  '')   AS prod_date,
                    COALESCE(ps.first_pay, '')   AS first_pay,
                    COALESCE(ps.last_pay,  '')   AS last_pay,
                    COALESCE(ps.total_months, 0)  AS total_months,
                    COALESCE(ps.total_amount, 0)  AS total_amount,
                    COALESCE(ps.currency,    '')  AS currency,
                    COALESCE(rs.handlowcy,  '')   AS handlowcy,
                    COALESCE(d.comment,     '')   AS comment,
                    COALESCE(fc.firm_type,        'ids') AS firm_type,
                    COALESCE(fc.cycle,            '')    AS firm_cycle,
                    COALESCE(fc.expected_amount,  0)     AS firm_expected_amount,
                    COALESCE(fc.currency,         '')    AS firm_currency
                FROM devices d
                FULL OUTER JOIN payment_summary ps ON d.sn = ps.sn
                LEFT JOIN excluded_firms ef  ON COALESCE(d.firma,'') = ef.firma
                LEFT JOIN rep_summary rs     ON COALESCE(d.firma,'') = rs.firma
                LEFT JOIN firm_config fc     ON COALESCE(d.firma,'') = fc.firma
                ORDER BY COALESCE(d.sn, ps.sn)
            """)
            return [dict(r) for r in cur.fetchall()]


# ── exclusions ────────────────────────────────────────────────────────────────

def get_excluded_firms() -> list:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT firma, reason FROM excluded_firms ORDER BY firma")
            return [dict(r) for r in cur.fetchall()]


def add_excluded_firm(firma: str, reason: str = "") -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO excluded_firms (firma, reason) VALUES (%s, %s) "
                "ON CONFLICT (firma) DO UPDATE SET reason = EXCLUDED.reason",
                (firma, reason),
            )


def remove_excluded_firm(firma: str) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM excluded_firms WHERE firma = %s", (firma,))


# ── sales reps ────────────────────────────────────────────────────────────────

def get_reps() -> list:
    """Return all reps with their assigned firms."""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT id, name FROM sales_reps ORDER BY name")
            reps = [dict(r) for r in cur.fetchall()]

            cur.execute("""
                SELECT fr.rep_id, fr.firma
                FROM firm_reps fr
                ORDER BY fr.firma
            """)
            assignments = cur.fetchall()

    firm_map: dict = {}
    for row in assignments:
        firm_map.setdefault(row["rep_id"], []).append(row["firma"])

    for rep in reps:
        rep["firms"] = firm_map.get(rep["id"], [])

    return reps


def get_all_firms() -> list:
    """Return distinct firma values from devices for the assignment UI."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT firma FROM devices WHERE firma <> '' ORDER BY firma"
            )
            return [r[0] for r in cur.fetchall()]


def assign_firm_to_rep(rep_id: int, firma: str) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO firm_reps (firma, rep_id) VALUES (%s, %s) "
                "ON CONFLICT DO NOTHING",
                (firma, rep_id),
            )


def remove_firm_from_rep(rep_id: int, firma: str) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM firm_reps WHERE firma = %s AND rep_id = %s",
                (firma, rep_id),
            )


def add_sales_rep(name: str) -> int:
    """Add a new sales rep. Returns the new id. Raises if name already exists."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO sales_reps (name) VALUES (%s) RETURNING id",
                (name.strip(),),
            )
            return cur.fetchone()[0]


def remove_sales_rep(rep_id: int) -> None:
    """Delete a sales rep and cascade-delete all their firm assignments."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM sales_reps WHERE id = %s", (rep_id,))


def get_monthly_revenue() -> list:
    """Return sum of payments per year_month, grouped by currency."""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT
                    year_month,
                    COALESCE(NULLIF(currency,''), 'PLN') AS currency,
                    COUNT(DISTINCT sn)                   AS devices,
                    SUM(amount)                          AS total
                FROM payments
                WHERE amount > 0
                GROUP BY year_month, COALESCE(NULLIF(currency,''), 'PLN')
                ORDER BY year_month, currency
            """)
            return [dict(r) for r in cur.fetchall()]


# ── device type override ───────────────────────────────────────────────────────

def set_device_type_override(sn: str, dtype: str, showroom_until: str = "") -> None:
    """Set manual device_type override. dtype='' resets to auto-detection."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE devices SET device_type_override = %s, showroom_until = %s WHERE sn = %s",
                (dtype, showroom_until if dtype == "showroom" else "", sn),
            )


def get_type_overrides() -> list:
    """Return all manually overridden devices."""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT sn, firma, maszyna, device_type_override
                FROM devices
                WHERE device_type_override <> ''
                ORDER BY sn
            """)
            return [dict(r) for r in cur.fetchall()]


# ── payment history per device ────────────────────────────────────────────────

def get_payments_for_sn(sn: str) -> list:
    """Return all payment records for a single device, ordered by month."""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT year_month, customer, amount, currency, amount_netto, amount_brutto "
                "FROM payments WHERE sn = %s ORDER BY year_month",
                (sn,),
            )
            return [dict(r) for r in cur.fetchall()]


# ── comment ───────────────────────────────────────────────────────────────────

def set_device_comment(sn: str, comment: str) -> None:
    """Set / clear a free-text comment on a device."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE devices SET comment = %s WHERE sn = %s",
                (comment, sn),
            )


# ── bulk type override ────────────────────────────────────────────────────────

def bulk_set_device_type(sns: list, dtype: str, showroom_until: str = "") -> int:
    """Set device_type_override for multiple SNs at once. Returns affected row count."""
    if not sns:
        return 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE devices
                   SET device_type_override = %s,
                       showroom_until = %s
                   WHERE sn = ANY(%s)""",
                (dtype,
                 showroom_until if dtype == "showroom" else "",
                 sns),
            )
            return cur.rowcount


# ── firm config ───────────────────────────────────────────────────────────────

VALID_FIRM_TYPES = {"ids", "licencja", "oem", "inne"}
VALID_CYCLES     = {"monthly", "quarterly", "annual", "once", ""}


def get_firm_configs() -> list:
    """Return all firm configs."""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT firma, firm_type, cycle, expected_amount, currency
                FROM firm_config ORDER BY firma
            """)
            return [dict(r) for r in cur.fetchall()]


def upsert_firm_config(firma: str, firm_type: str, cycle: str,
                       expected_amount: float, currency: str) -> None:
    firm_type = firm_type if firm_type in VALID_FIRM_TYPES else "ids"
    cycle     = cycle     if cycle     in VALID_CYCLES     else ""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO firm_config (firma, firm_type, cycle, expected_amount, currency)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (firma) DO UPDATE SET
                    firm_type       = EXCLUDED.firm_type,
                    cycle           = EXCLUDED.cycle,
                    expected_amount = EXCLUDED.expected_amount,
                    currency        = EXCLUDED.currency
            """, (firma, firm_type, cycle, expected_amount or 0, currency or ""))


def delete_firm_config(firma: str) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM firm_config WHERE firma = %s", (firma,))


def get_firms_for_export() -> list:
    """
    All distinct firma names (from devices) with current config + assigned reps (max 2).
    Canonical name: prefers customer from payments when SN matches.
    """
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                WITH device_firms AS (
                    SELECT DISTINCT firma FROM devices WHERE firma <> ''
                ),
                rep_agg AS (
                    SELECT
                        fr.firma,
                        ARRAY_AGG(sr.name ORDER BY sr.name) AS rep_names
                    FROM firm_reps fr
                    JOIN sales_reps sr ON fr.rep_id = sr.id
                    GROUP BY fr.firma
                )
                SELECT
                    df.firma,
                    COALESCE(fc.firm_type,       'ids') AS firm_type,
                    COALESCE(fc.cycle,           '')    AS cycle,
                    COALESCE(fc.expected_amount, 0)     AS expected_amount,
                    COALESCE(fc.currency,        '')    AS currency,
                    COALESCE(ra.rep_names, ARRAY[]::text[]) AS rep_names
                FROM device_firms df
                LEFT JOIN firm_config fc ON df.firma = fc.firma
                LEFT JOIN rep_agg ra     ON df.firma = ra.firma
                ORDER BY df.firma
            """)
            return [dict(r) for r in cur.fetchall()]


def import_firms_table(rows: list, mode: str = "supplement") -> dict:
    """
    Import firm configs + rep assignments from a parsed table.
    rows: list of dicts with keys: firma, firm_type, cycle, expected_amount, currency,
                                   rep1 (name), rep2 (name)
    mode: 'overwrite'  — upsert config, replace all reps for each firma
          'supplement' — only add missing configs, add new rep assignments (don't remove existing)
    Returns: {updated_config, updated_reps, skipped, errors}
    """
    updated_config = 0
    updated_reps   = 0
    skipped        = 0
    errors         = []

    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Build rep name → id map
            cur.execute("SELECT id, name FROM sales_reps")
            rep_map = {r["name"].strip().lower(): r["id"] for r in cur.fetchall()}

        for row in rows:
            firma = str(row.get("firma", "")).strip()
            if not firma:
                skipped += 1
                continue

            firm_type = str(row.get("firm_type", "ids")).strip().lower()
            if firm_type not in VALID_FIRM_TYPES:
                firm_type = "ids"
            cycle = str(row.get("cycle", "")).strip().lower()
            if cycle not in VALID_CYCLES:
                cycle = ""
            try:
                expected_amount = float(str(row.get("expected_amount", "0")).replace(",", ".") or 0)
            except (ValueError, TypeError):
                expected_amount = 0.0
            currency = str(row.get("currency", "")).strip().upper()

            # Rep names (up to 2)
            rep_ids = []
            for key in ("rep1", "rep2"):
                name = str(row.get(key, "")).strip()
                if not name:
                    continue
                rid = rep_map.get(name.lower())
                if rid:
                    rep_ids.append(rid)
                else:
                    errors.append(f"Handlowiec '{name}' nie istnieje — pominięto dla firmy '{firma}'")

            with get_conn() as conn:
                with conn.cursor() as cur:
                    if mode == "overwrite":
                        # Upsert config
                        cur.execute("""
                            INSERT INTO firm_config (firma, firm_type, cycle, expected_amount, currency)
                            VALUES (%s,%s,%s,%s,%s)
                            ON CONFLICT (firma) DO UPDATE SET
                                firm_type       = EXCLUDED.firm_type,
                                cycle           = EXCLUDED.cycle,
                                expected_amount = EXCLUDED.expected_amount,
                                currency        = EXCLUDED.currency
                        """, (firma, firm_type, cycle, expected_amount, currency))
                        updated_config += 1
                        # Replace reps
                        cur.execute("DELETE FROM firm_reps WHERE firma = %s", (firma,))
                        for rid in rep_ids:
                            cur.execute(
                                "INSERT INTO firm_reps (firma, rep_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                                (firma, rid),
                            )
                            updated_reps += 1
                    else:  # supplement
                        # Only insert new config (don't touch existing)
                        cur.execute("""
                            INSERT INTO firm_config (firma, firm_type, cycle, expected_amount, currency)
                            VALUES (%s,%s,%s,%s,%s)
                            ON CONFLICT (firma) DO NOTHING
                        """, (firma, firm_type, cycle, expected_amount, currency))
                        updated_config += cur.rowcount
                        # Add new rep assignments only
                        for rid in rep_ids:
                            cur.execute(
                                "INSERT INTO firm_reps (firma, rep_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                                (firma, rid),
                            )
                            updated_reps += cur.rowcount

    return {"updated_config": updated_config, "updated_reps": updated_reps,
            "skipped": skipped, "errors": errors}


# ── auth / users ──────────────────────────────────────────────────────────────

def get_or_create_secret_key() -> str:
    """Returns a persistent secret key stored in app_settings table."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT value FROM app_settings WHERE key = 'secret_key'")
            row = cur.fetchone()
            if row:
                return row[0]
            key = secrets.token_hex(32)
            cur.execute(
                "INSERT INTO app_settings (key, value) VALUES ('secret_key', %s)"
                " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
                (key,),
            )
            return key


def create_admin_if_needed(email: str, password: str) -> bool:
    """Creates first admin user if none exist. Returns True if created."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM users WHERE is_admin")
            if cur.fetchone()[0] > 0:
                return False
            cur.execute(
                "INSERT INTO users (email, name, password_hash, is_active, is_admin)"
                " VALUES (%s, %s, %s, TRUE, TRUE)"
                " ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash,"
                "   is_admin = TRUE, is_active = TRUE",
                (email.lower(), email.split("@")[0], _hash_pwd(password)),
            )
            return True


def verify_user(email: str, password: str) -> Optional[dict]:
    """Returns user dict if credentials are valid, else None."""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM users WHERE email = %s AND is_active",
                (email.strip().lower(),),
            )
            user = cur.fetchone()
            if not user or not _verify_pwd(password, user["password_hash"]):
                return None
            cur.execute("UPDATE users SET last_login = now() WHERE id = %s", (user["id"],))
            return dict(user)


def get_user_by_id(user_id: int) -> Optional[dict]:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
            return dict(row) if row else None


def list_users() -> list:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT id, email, name, is_active, is_admin, created_at, last_login"
                " FROM users ORDER BY id"
            )
            return [dict(r) for r in cur.fetchall()]


def create_user_db(email: str, name: str, password: str, is_admin: bool = False) -> dict:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "INSERT INTO users (email, name, password_hash, is_admin)"
                " VALUES (%s, %s, %s, %s)"
                " RETURNING id, email, name, is_active, is_admin",
                (email.strip().lower(), name, _hash_pwd(password), is_admin),
            )
            return dict(cur.fetchone())


def set_user_status(user_id: int, active: bool) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE users SET is_active = %s WHERE id = %s", (active, user_id))


def reset_user_password(user_id: int, new_password: str) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET password_hash = %s WHERE id = %s",
                (_hash_pwd(new_password), user_id),
            )
