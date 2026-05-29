import os
from contextlib import contextmanager
from typing import Optional

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

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

def get_analysis(
    status_filter: Optional[str] = None,
    customer_filter: Optional[str] = None,
    operator_filter: Optional[str] = None,
    rep_filter: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    device_type_filter: Optional[str] = None,
) -> list:
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
                    COALESCE(d.sn,       ps.sn)  AS sn,
                    -- Status: OEM → showroom → excluded → paid → unpaid → only
                    CASE
                        WHEN COALESCE(NULLIF(d.device_type_override,''),
                                      CASE WHEN COALESCE(d.maszyna,'') ILIKE '%OEM%'
                                           THEN 'oem' ELSE 'master' END
                             ) = 'oem'                              THEN 'oem'
                        WHEN COALESCE(d.device_type_override,'') = 'showroom' THEN 'showroom'
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
                    COALESCE(d.comment,     '')   AS comment
                FROM devices d
                FULL OUTER JOIN payment_summary ps ON d.sn = ps.sn
                LEFT JOIN excluded_firms ef ON COALESCE(d.firma,'') = ef.firma
                LEFT JOIN rep_summary rs    ON COALESCE(d.firma,'') = rs.firma
                ORDER BY COALESCE(d.sn, ps.sn)
            """)
            rows = [dict(r) for r in cur.fetchall()]

    if status_filter:
        rows = [r for r in rows if r["status"] == status_filter]
    if customer_filter:
        rows = [r for r in rows if r["customer"] == customer_filter]
    if operator_filter:
        rows = [r for r in rows if r["operator"] == operator_filter]
    if rep_filter:
        rows = [r for r in rows if rep_filter in r["handlowcy"]]
    if device_type_filter:
        rows = [r for r in rows if r["device_type"] == device_type_filter]
    if date_from:
        rows = [r for r in rows if r["prod_date"] and r["prod_date"] >= date_from]
    if date_to:
        rows = [r for r in rows if not r["prod_date"] or r["prod_date"] <= date_to]

    return rows


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
                "SELECT year_month, customer, amount, currency "
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
