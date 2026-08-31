import os
import secrets
from contextlib import contextmanager
from typing import Optional
from datetime import date as _date

import psycopg2
import psycopg2.extras
from psycopg2.extras import execute_values
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
                    id               SERIAL PRIMARY KEY,
                    email            VARCHAR UNIQUE NOT NULL,
                    name             VARCHAR NOT NULL DEFAULT '',
                    password_hash    VARCHAR NOT NULL,
                    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
                    is_admin         BOOLEAN NOT NULL DEFAULT FALSE,
                    can_edit_devices BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at       TIMESTAMPTZ DEFAULT now(),
                    last_login       TIMESTAMPTZ
                );
            """)
            # migracja: dodaj kolumnę jeśli tabela już istnieje bez niej
            cur.execute("""
                ALTER TABLE users
                ADD COLUMN IF NOT EXISTS can_edit_devices BOOLEAN NOT NULL DEFAULT FALSE;
            """)

            # ── tabela opłat licencyjnych ──────────────────────────────
            cur.execute("""
                CREATE TABLE IF NOT EXISTS firm_license_fees (
                    id          SERIAL PRIMARY KEY,
                    firma       VARCHAR NOT NULL,
                    amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
                    currency    VARCHAR NOT NULL DEFAULT 'PLN',
                    date_from   VARCHAR NOT NULL DEFAULT '',
                    date_to     VARCHAR NOT NULL DEFAULT '',
                    note        VARCHAR NOT NULL DEFAULT ''
                );
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_license_fees_firma
                ON firm_license_fees(firma);
            """)

            # Dziennik scaleń firm
            cur.execute("""
                CREATE TABLE IF NOT EXISTS firm_merges (
                    id               SERIAL PRIMARY KEY,
                    source           VARCHAR NOT NULL,
                    target           VARCHAR NOT NULL,
                    merged_at        TIMESTAMP NOT NULL DEFAULT NOW(),
                    devices_affected INTEGER NOT NULL DEFAULT 0
                );
            """)

            # Zawieszenia opłat — per urządzenie
            cur.execute("""
                CREATE TABLE IF NOT EXISTS device_suspensions (
                    id          SERIAL PRIMARY KEY,
                    sn          VARCHAR NOT NULL,
                    date_from   VARCHAR NOT NULL,
                    date_to     VARCHAR NOT NULL,
                    note        VARCHAR NOT NULL DEFAULT '',
                    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
                );
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_dev_susp_sn
                ON device_suspensions(sn);
            """)

            # Zawieszenia opłat — per firma (wszystkie urządzenia firmy)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS firm_suspensions (
                    id          SERIAL PRIMARY KEY,
                    firma       VARCHAR NOT NULL,
                    date_from   VARCHAR NOT NULL,
                    date_to     VARCHAR NOT NULL,
                    note        VARCHAR NOT NULL DEFAULT '',
                    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
                );
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_firm_susp_firma
                ON firm_suspensions(firma);
            """)

            # Komentarze do urządzeń — osobna tabela, działa też dla SNów bez wiersza w devices
            cur.execute("""
                CREATE TABLE IF NOT EXISTS device_comments (
                    sn      VARCHAR PRIMARY KEY,
                    comment VARCHAR NOT NULL DEFAULT ''
                );
            """)
            # Jednorazowa migracja: przenieś komentarze z devices.comment
            cur.execute("""
                INSERT INTO device_comments (sn, comment)
                SELECT sn, comment FROM devices WHERE comment <> ''
                ON CONFLICT (sn) DO NOTHING;
            """)

            # Nadpisania typu urządzenia — osobna tabela, działa też dla SNów bez wiersza w devices
            cur.execute("""
                CREATE TABLE IF NOT EXISTS device_type_overrides (
                    sn             VARCHAR PRIMARY KEY,
                    type_override  VARCHAR NOT NULL DEFAULT '',
                    showroom_until VARCHAR NOT NULL DEFAULT ''
                );
            """)
            # Jednorazowa migracja: przenieś overrides z devices.device_type_override
            cur.execute("""
                INSERT INTO device_type_overrides (sn, type_override, showroom_until)
                SELECT sn, device_type_override, COALESCE(showroom_until,'')
                FROM devices WHERE device_type_override <> ''
                ON CONFLICT (sn) DO NOTHING;
            """)

            # ── Migracja: months_batch w payments (wykrywanie płatności z góry) ───
            cur.execute("""
                ALTER TABLE payments
                ADD COLUMN IF NOT EXISTS months_batch INTEGER NOT NULL DEFAULT 1;
            """)

            # ── Migracja: can_view_commissions ────────────────────────────────
            cur.execute("""
                ALTER TABLE users
                ADD COLUMN IF NOT EXISTS can_view_commissions BOOLEAN NOT NULL DEFAULT FALSE;
            """)

            # ── Tabele systemu prowizji ───────────────────────────────────────
            cur.execute("""
                CREATE TABLE IF NOT EXISTS commission_rates (
                    id          SERIAL PRIMARY KEY,
                    rep_name    VARCHAR,
                    pct         NUMERIC(5,2) NOT NULL,
                    valid_from  DATE NOT NULL,
                    valid_to    DATE,
                    note        VARCHAR NOT NULL DEFAULT ''
                );
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS commission_periods (
                    id            SERIAL PRIMARY KEY,
                    name          VARCHAR NOT NULL,
                    cohort_from   DATE NOT NULL,
                    cohort_to     DATE NOT NULL,
                    created_by    INTEGER REFERENCES users(id),
                    created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
                    locked        BOOLEAN NOT NULL DEFAULT FALSE
                );
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS commission_items (
                    id              SERIAL PRIMARY KEY,
                    period_id       INTEGER NOT NULL REFERENCES commission_periods(id) ON DELETE CASCADE,
                    sn              VARCHAR NOT NULL,
                    firma           VARCHAR NOT NULL DEFAULT '',
                    rep_name        VARCHAR NOT NULL DEFAULT '',
                    prod_date       VARCHAR NOT NULL DEFAULT '',
                    months_paid     INTEGER NOT NULL DEFAULT 0,
                    month_12_ym     VARCHAR(7),
                    base_netto      NUMERIC(12,2) NOT NULL DEFAULT 0,
                    rate_pct        NUMERIC(5,2)  NOT NULL DEFAULT 0,
                    commission_amt  NUMERIC(12,2) NOT NULL DEFAULT 0,
                    currency        VARCHAR(3)    NOT NULL DEFAULT 'PLN',
                    status          VARCHAR(30)   NOT NULL DEFAULT 'W_TOKU',
                    advance_flag    BOOLEAN       NOT NULL DEFAULT FALSE,
                    UNIQUE (period_id, sn, rep_name)
                );
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_comm_items_period
                ON commission_items(period_id);
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS commission_status_log (
                    id          SERIAL PRIMARY KEY,
                    item_id     INTEGER NOT NULL REFERENCES commission_items(id) ON DELETE CASCADE,
                    old_status  VARCHAR(30),
                    new_status  VARCHAR(30) NOT NULL,
                    changed_by  INTEGER REFERENCES users(id),
                    changed_at  TIMESTAMP NOT NULL DEFAULT NOW(),
                    note        VARCHAR NOT NULL DEFAULT ''
                );
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_comm_log_item
                ON commission_status_log(item_id);
            """)

            # Historia sesji importu (urządzenia + płatności)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS import_sessions (
                    id              SERIAL PRIMARY KEY,
                    import_type     VARCHAR(20) NOT NULL,
                    filenames       TEXT NOT NULL DEFAULT '',
                    mode            VARCHAR(10) NOT NULL DEFAULT 'append',
                    device_type_tag VARCHAR(20) NOT NULL DEFAULT '',
                    records_added   INTEGER NOT NULL DEFAULT 0,
                    records_skipped INTEGER NOT NULL DEFAULT 0,
                    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
                );
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS import_session_devices (
                    session_id  INTEGER NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
                    sn          VARCHAR(50) NOT NULL
                );
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_isd_session
                ON import_session_devices(session_id);
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS import_session_payments (
                    session_id  INTEGER NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
                    sn          VARCHAR(50) NOT NULL,
                    year_month  VARCHAR(7)  NOT NULL
                );
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_isp_session
                ON import_session_payments(session_id);
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
                ),
                all_comments AS (
                    SELECT sn, comment FROM device_comments
                ),
                type_ovr AS (
                    SELECT sn, type_override, showroom_until FROM device_type_overrides
                )
                SELECT
                    COALESCE(d.sn, ps.sn) AS sn,
                    -- Status: urządzenie OEM → showroom → typ firmy (inne/licencja) → wykluczone → paid → unpaid → only
                    CASE
                        WHEN COALESCE(NULLIF(COALESCE(dto.type_override,''),''),
                                      CASE WHEN COALESCE(d.maszyna,'') ILIKE '%OEM%'
                                           THEN 'oem' ELSE 'master' END
                             ) = 'oem'                              THEN 'oem'
                        WHEN COALESCE(dto.type_override,'') = 'showroom'        THEN 'showroom'
                        WHEN COALESCE(dto.type_override,'') = 'stare'           THEN 'stare'
                        WHEN COALESCE(dto.type_override,'') = 'problematyczne'  THEN 'problematyczne'
                        WHEN COALESCE(dto.type_override,'') = 'wycofany'        THEN 'wycofany'
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
                        NULLIF(COALESCE(dto.type_override,''), ''),
                        CASE WHEN COALESCE(d.maszyna,'') ILIKE '%OEM%' THEN 'oem' ELSE 'master' END
                    )                            AS device_type,
                    COALESCE(dto.type_override,  '') AS type_override,
                    COALESCE(dto.showroom_until, '') AS showroom_until,
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
                    COALESCE(ac.comment,    '')   AS comment,
                    COALESCE(fc.firm_type,        'ids') AS firm_type,
                    COALESCE(fc.cycle,            '')    AS firm_cycle,
                    COALESCE(fc.expected_amount,  0)     AS firm_expected_amount,
                    COALESCE(fc.currency,         '')    AS firm_currency
                FROM devices d
                FULL OUTER JOIN payment_summary ps ON d.sn = ps.sn
                LEFT JOIN excluded_firms ef  ON COALESCE(d.firma,'') = ef.firma
                LEFT JOIN rep_summary rs     ON COALESCE(d.firma,'') = rs.firma
                LEFT JOIN firm_config fc     ON COALESCE(d.firma,'') = fc.firma
                LEFT JOIN all_comments ac    ON COALESCE(d.sn, ps.sn) = ac.sn
                LEFT JOIN type_ovr dto       ON COALESCE(d.sn, ps.sn) = dto.sn
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
                WHERE fr.firma IN (
                    SELECT DISTINCT firma FROM devices WHERE firma <> ''
                )
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
    """Set manual device_type override (works for all SNs incl. payments-only). dtype='' resets."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            if dtype:
                cur.execute(
                    """INSERT INTO device_type_overrides (sn, type_override, showroom_until)
                       VALUES (%s, %s, %s)
                       ON CONFLICT (sn) DO UPDATE
                           SET type_override  = EXCLUDED.type_override,
                               showroom_until = EXCLUDED.showroom_until""",
                    (sn, dtype, showroom_until if dtype == "showroom" else ""),
                )
            else:
                cur.execute("DELETE FROM device_type_overrides WHERE sn = %s", (sn,))


def get_type_overrides() -> list:
    """Return all manually overridden devices."""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT dto.sn,
                       COALESCE(d.firma,   '') AS firma,
                       COALESCE(d.maszyna, '') AS maszyna,
                       dto.type_override AS device_type_override
                FROM device_type_overrides dto
                LEFT JOIN devices d ON dto.sn = d.sn
                ORDER BY dto.sn
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
    """Set / clear a free-text comment on a device (works for all SNs incl. payments-only)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            if comment:
                cur.execute(
                    """INSERT INTO device_comments (sn, comment)
                       VALUES (%s, %s)
                       ON CONFLICT (sn) DO UPDATE SET comment = EXCLUDED.comment""",
                    (sn, comment),
                )
            else:
                cur.execute("DELETE FROM device_comments WHERE sn = %s", (sn,))


# ── bulk type override ────────────────────────────────────────────────────────

def bulk_set_device_type(sns: list, dtype: str, showroom_until: str = "") -> int:
    """Set device_type_override for multiple SNs at once (incl. payments-only). Returns count."""
    if not sns:
        return 0
    until = showroom_until if dtype == "showroom" else ""
    with get_conn() as conn:
        with conn.cursor() as cur:
            if dtype:
                for sn in sns:
                    cur.execute(
                        """INSERT INTO device_type_overrides (sn, type_override, showroom_until)
                           VALUES (%s, %s, %s)
                           ON CONFLICT (sn) DO UPDATE
                               SET type_override  = EXCLUDED.type_override,
                                   showroom_until = EXCLUDED.showroom_until""",
                        (sn, dtype, until),
                    )
            else:
                cur.execute(
                    "DELETE FROM device_type_overrides WHERE sn = ANY(%s)", (sns,)
                )
            return len(sns)


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
                "SELECT id, email, name, is_active, is_admin, can_edit_devices,"
                " can_view_commissions, created_at, last_login"
                " FROM users ORDER BY id"
            )
            return [dict(r) for r in cur.fetchall()]


def create_user_db(email: str, name: str, password: str, is_admin: bool = False) -> dict:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "INSERT INTO users (email, name, password_hash, is_admin)"
                " VALUES (%s, %s, %s, %s)"
                " RETURNING id, email, name, is_active, is_admin, can_edit_devices",
                (email.strip().lower(), name, _hash_pwd(password), is_admin),
            )
            return dict(cur.fetchone())


def set_user_can_edit(user_id: int, can_edit: bool) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET can_edit_devices = %s WHERE id = %s",
                (can_edit, user_id),
            )


def set_user_can_commission(user_id: int, can_view: bool) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET can_view_commissions = %s WHERE id = %s",
                (can_view, user_id),
            )


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


# ── license fees ──────────────────────────────────────────────────────────────

def get_license_fees() -> list:
    """Return all license fee rows ordered by firma."""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT id, firma, amount, currency, date_from, date_to, note
                FROM firm_license_fees
                ORDER BY firma, date_from
            """)
            return [dict(r) for r in cur.fetchall()]


def upsert_license_fee(firma: str, amount: float, currency: str,
                       date_from: str, date_to: str, note: str,
                       fee_id: int | None = None) -> dict:
    """Insert or update a license fee row. Returns the saved row."""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if fee_id:
                cur.execute("""
                    UPDATE firm_license_fees
                    SET firma = %s, amount = %s, currency = %s,
                        date_from = %s, date_to = %s, note = %s
                    WHERE id = %s
                    RETURNING id, firma, amount, currency, date_from, date_to, note
                """, (firma, amount, currency, date_from, date_to, note, fee_id))
            else:
                cur.execute("""
                    INSERT INTO firm_license_fees (firma, amount, currency, date_from, date_to, note)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    RETURNING id, firma, amount, currency, date_from, date_to, note
                """, (firma, amount, currency, date_from, date_to, note))
            return dict(cur.fetchone())


def delete_license_fee(fee_id: int) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM firm_license_fees WHERE id = %s", (fee_id,))


# ── company merge ─────────────────────────────────────────────────────────────

def merge_firms(source: str, target: str) -> dict:
    """
    Merge `source` firm name into `target` across all tables.
    After merge, all devices/configs/reps previously under `source`
    will be under `target`. `source` rows are deleted from config tables.
    Returns counts of affected rows per table.
    """
    if source == target:
        raise ValueError("Źródło i cel scalenia są identyczne")

    counts = {}
    with get_conn() as conn:
        with conn.cursor() as cur:
            # 1. devices — simple rename
            cur.execute(
                "UPDATE devices SET firma = %s WHERE firma = %s",
                (target, source),
            )
            counts["devices"] = cur.rowcount

            # 2. firm_reps — move assignments; avoid duplicate (firma, rep_id)
            cur.execute(
                "SELECT rep_id FROM firm_reps WHERE firma = %s", (source,)
            )
            source_reps = {r[0] for r in cur.fetchall()}
            cur.execute(
                "SELECT rep_id FROM firm_reps WHERE firma = %s", (target,)
            )
            target_reps = {r[0] for r in cur.fetchall()}
            new_reps = source_reps - target_reps
            reps_moved = 0
            for rep_id in new_reps:
                cur.execute(
                    "INSERT INTO firm_reps (firma, rep_id) VALUES (%s, %s)"
                    " ON CONFLICT DO NOTHING",
                    (target, rep_id),
                )
                reps_moved += 1
            cur.execute("DELETE FROM firm_reps WHERE firma = %s", (source,))
            counts["firm_reps"] = reps_moved

            # cleanup: remove any orphaned firm_reps (firma not in devices)
            cur.execute("""
                DELETE FROM firm_reps
                WHERE firma NOT IN (SELECT DISTINCT firma FROM devices WHERE firma <> '')
            """)

            # 3. firm_config — keep target config if both exist; else rename source
            cur.execute("SELECT 1 FROM firm_config WHERE firma = %s", (target,))
            target_has_config = cur.fetchone() is not None
            cur.execute("SELECT 1 FROM firm_config WHERE firma = %s", (source,))
            source_has_config = cur.fetchone() is not None

            if source_has_config:
                if target_has_config:
                    # target config wins — just delete source
                    cur.execute("DELETE FROM firm_config WHERE firma = %s", (source,))
                    counts["firm_config"] = "źródło usunięte (zachowano konfigurację celu)"
                else:
                    # rename source config to target
                    cur.execute(
                        "UPDATE firm_config SET firma = %s WHERE firma = %s",
                        (target, source),
                    )
                    counts["firm_config"] = "przeniesiona z źródła"
            else:
                counts["firm_config"] = "brak zmian"

            # 4. excluded_firms — same logic
            cur.execute("SELECT 1 FROM excluded_firms WHERE firma = %s", (target,))
            target_excl = cur.fetchone() is not None
            cur.execute("SELECT 1 FROM excluded_firms WHERE firma = %s", (source,))
            source_excl = cur.fetchone() is not None
            if source_excl:
                if target_excl:
                    cur.execute("DELETE FROM excluded_firms WHERE firma = %s", (source,))
                else:
                    cur.execute(
                        "UPDATE excluded_firms SET firma = %s WHERE firma = %s",
                        (target, source),
                    )
            counts["excluded_firms"] = "scalono" if source_excl else "brak zmian"

            # 5. firm_license_fees
            cur.execute(
                "UPDATE firm_license_fees SET firma = %s WHERE firma = %s",
                (target, source),
            )
            counts["firm_license_fees"] = cur.rowcount

            # 6. Zapisz w dzienniku scaleń
            cur.execute(
                """INSERT INTO firm_merges (source, target, devices_affected)
                   VALUES (%s, %s, %s)""",
                (source, target, counts.get("devices", 0)),
            )

    return counts


# ── Suspensions ───────────────────────────────────────────────────────────────

def _susp_row(r) -> dict:
    return {"id": r[0], "date_from": r[1], "date_to": r[2], "note": r[3],
            "created_at": r[4].strftime("%Y-%m-%d %H:%M") if r[4] else ""}


def get_device_suspensions(sn: str) -> list:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, date_from, date_to, note, created_at "
                "FROM device_suspensions WHERE sn = %s ORDER BY date_from",
                (sn,),
            )
            return [_susp_row(r) for r in cur.fetchall()]


def add_device_suspension(sn: str, date_from: str, date_to: str, note: str) -> int:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO device_suspensions (sn, date_from, date_to, note) "
                "VALUES (%s, %s, %s, %s) RETURNING id",
                (sn, date_from, date_to, note),
            )
            return cur.fetchone()[0]


def delete_device_suspension(susp_id: int) -> bool:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM device_suspensions WHERE id = %s", (susp_id,))
            return cur.rowcount > 0


def get_firm_suspensions(firma: str) -> list:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, date_from, date_to, note, created_at "
                "FROM firm_suspensions WHERE firma = %s ORDER BY date_from",
                (firma,),
            )
            return [_susp_row(r) for r in cur.fetchall()]


def add_firm_suspension(firma: str, date_from: str, date_to: str, note: str) -> int:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO firm_suspensions (firma, date_from, date_to, note) "
                "VALUES (%s, %s, %s, %s) RETURNING id",
                (firma, date_from, date_to, note),
            )
            return cur.fetchone()[0]


def delete_firm_suspension(susp_id: int) -> bool:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM firm_suspensions WHERE id = %s", (susp_id,))
            return cur.rowcount > 0


def bulk_suspend_devices(sns: list, date_from: str, date_to: str, note: str) -> int:
    """Dodaje zawieszenie dla listy SN-ów. Zwraca liczbę wstawionych wierszy."""
    count = 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            for sn in sns:
                cur.execute(
                    "INSERT INTO device_suspensions (sn, date_from, date_to, note) "
                    "VALUES (%s, %s, %s, %s)",
                    (sn, date_from, date_to, note),
                )
                count += 1
    return count


def get_active_suspensions() -> dict:
    """Zwraca SN-y i firmy, które są zawieszone w bieżącym miesiącu."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            today = __import__('datetime').date.today().strftime("%Y-%m")
            cur.execute(
                "SELECT sn FROM device_suspensions "
                "WHERE date_from <= %s AND date_to >= %s",
                (today, today),
            )
            sns = {r[0] for r in cur.fetchall()}
            cur.execute(
                "SELECT firma FROM firm_suspensions "
                "WHERE date_from <= %s AND date_to >= %s",
                (today, today),
            )
            firms = {r[0] for r in cur.fetchall()}
    return {"suspended_sns": list(sns), "suspended_firms": list(firms)}


def get_all_suspensions_map() -> dict:
    """
    Zwraca pełną mapę zawieszeń: {sn: [periods]} i {firma: [periods]}
    Używane przez endpoint /analyze do nakładania is_suspended.
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            today = __import__('datetime').date.today().strftime("%Y-%m")
            cur.execute(
                "SELECT sn, date_from, date_to FROM device_suspensions "
                "WHERE date_from <= %s AND date_to >= %s",
                (today, today),
            )
            sn_map = {}
            for r in cur.fetchall():
                sn_map.setdefault(r[0], []).append({"date_from": r[1], "date_to": r[2]})
            cur.execute(
                "SELECT firma, date_from, date_to FROM firm_suspensions "
                "WHERE date_from <= %s AND date_to >= %s",
                (today, today),
            )
            firm_map = {}
            for r in cur.fetchall():
                firm_map.setdefault(r[0], []).append({"date_from": r[1], "date_to": r[2]})
    return {"sns": sn_map, "firms": firm_map}


# ── Firm-rep export/import ─────────────────────────────────────────────────────

def get_firms_with_reps() -> list:
    """Zwraca listę firm z przypisanymi handlowcami (max 2)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Distinct firms from devices
            cur.execute(
                "SELECT DISTINCT firma FROM devices WHERE firma <> '' ORDER BY firma"
            )
            all_firms = [r[0] for r in cur.fetchall()]
            # Rep assignments
            cur.execute("""
                SELECT fr.firma, sr.name
                FROM firm_reps fr
                JOIN sales_reps sr ON fr.rep_id = sr.id
                ORDER BY fr.firma, sr.name
            """)
            rep_map: dict = {}
            for firma, name in cur.fetchall():
                rep_map.setdefault(firma, []).append(name)
    result = []
    for firma in all_firms:
        reps = rep_map.get(firma, [])
        result.append({
            "firma":       firma,
            "handlowiec_1": reps[0] if len(reps) > 0 else "",
            "handlowiec_2": reps[1] if len(reps) > 1 else "",
        })
    return result


def get_firms_without_reps() -> list:
    """Firmy z devices, które nie mają żadnego przypisanego handlowca."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT DISTINCT d.firma
                FROM devices d
                WHERE d.firma <> ''
                  AND NOT EXISTS (
                      SELECT 1 FROM firm_reps fr WHERE fr.firma = d.firma
                  )
                ORDER BY d.firma
            """)
            return [r[0] for r in cur.fetchall()]


def import_firm_reps(rows: list) -> dict:
    """
    Nadpisz przypisania handlowców dla firm z listy.
    rows = [{"firma": ..., "handlowiec_1": ..., "handlowiec_2": ...}]
    Firmy nieobecne w liście — bez zmian.
    """
    updated = skipped = errors = 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Build rep name→id map
            cur.execute("SELECT id, name FROM sales_reps")
            rep_id_map = {name.strip().lower(): rid for rid, name in cur.fetchall()}

            for row in rows:
                firma = (row.get("firma") or "").strip()
                if not firma:
                    skipped += 1
                    continue
                rep_names = [
                    (row.get("handlowiec_1") or "").strip(),
                    (row.get("handlowiec_2") or "").strip(),
                ]
                rep_ids = []
                for rn in rep_names:
                    if rn:
                        rid = rep_id_map.get(rn.lower())
                        if rid:
                            rep_ids.append(rid)
                # Delete existing assignments for this firma
                cur.execute("DELETE FROM firm_reps WHERE firma = %s", (firma,))
                # Insert new ones
                for rid in rep_ids:
                    cur.execute(
                        "INSERT INTO firm_reps (firma, rep_id) VALUES (%s, %s) "
                        "ON CONFLICT DO NOTHING",
                        (firma, rid),
                    )
                updated += 1
    return {"updated": updated, "skipped": skipped}


def delete_merge(merge_id: int):
    """Usuwa wpis z historii scaleń (nie cofa scalenia na urządzeniach)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM firm_merges WHERE id = %s", (merge_id,))


def get_merge_history() -> list:
    """Zwraca historię scaleń firm (od najnowszych)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, source, target,
                       TO_CHAR(merged_at, 'YYYY-MM-DD HH24:MI') AS merged_at,
                       devices_affected
                FROM firm_merges
                ORDER BY merged_at DESC
            """)
            rows = cur.fetchall()
    return [
        {"id": r[0], "source": r[1], "target": r[2],
         "merged_at": r[3], "devices_affected": r[4]}
        for r in rows
    ]


# ── Rep bonus check ────────────────────────────────────────────────────────────

def _ym_add(ym: str, n: int) -> str:
    """Add n months to YYYY-MM string."""
    y, m = int(ym[:4]), int(ym[5:7])
    m += n
    while m > 12:
        m -= 12; y += 1
    while m < 1:
        m += 12; y -= 1
    return f"{y:04d}-{m:02d}"


def get_rep_first_ids_check(
    rep_id: int,
    first_pay_from: str,
    first_pay_to: str,
    window_months: int = 12,
) -> dict:
    """
    Pierwsze IDS — Handlowiec.

    Zwraca urządzenia przypisanego handlowca, których PIERWSZA płatność
    (min year_month) mieści się w przedziale [first_pay_from, first_pay_to].

    Dla każdego urządzenia okno = window_months miesięcy od jego first_pay.
    Status każdego miesiąca: paid / suspended / gap_resumed / unpaid.
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Devices for this rep
            cur.execute("""
                SELECT DISTINCT d.sn, d.firma, d.maszyna, d.operator,
                       COALESCE(NULLIF(d.device_type_override,''),
                           CASE WHEN COALESCE(d.maszyna,'') ILIKE '%%OEM%%' THEN 'oem' ELSE 'master' END
                       ) AS device_type
                FROM devices d
                JOIN firm_reps fr ON d.firma = fr.firma
                WHERE fr.rep_id = %s AND d.firma <> ''
                ORDER BY d.firma, d.sn
            """, (rep_id,))
            raw_devices = cur.fetchall()

            if not raw_devices:
                return {"devices": [], "summary": _bonus_summary([])}

            sns = [r[0] for r in raw_devices]

            # First payment per SN (only for devices whose first_pay is in range)
            cur.execute("""
                SELECT sn,
                       MIN(year_month) AS first_pay,
                       MAX(customer) FILTER (WHERE customer <> '') AS customer,
                       MAX(currency) FILTER (WHERE currency <> '') AS currency
                FROM payments
                WHERE sn = ANY(%s)
                GROUP BY sn
                HAVING MIN(year_month) >= %s AND MIN(year_month) <= %s
            """, (sns, first_pay_from, first_pay_to))
            first_pay_map: dict = {}
            customer_map: dict = {}
            currency_map: dict = {}
            for sn, fp, cust, curr in cur.fetchall():
                first_pay_map[sn] = fp
                if cust: customer_map[sn] = cust
                if curr: currency_map[sn] = curr

            if not first_pay_map:
                return {"devices": [], "summary": _bonus_summary([])}

            # All payments for qualifying SNs
            qualifying_sns = list(first_pay_map.keys())
            # Max end month across all windows
            max_end = max(_ym_add(fp, window_months - 1) for fp in first_pay_map.values())

            cur.execute("""
                SELECT sn, year_month, COALESCE(SUM(amount),0)
                FROM payments
                WHERE sn = ANY(%s) AND year_month <= %s
                GROUP BY sn, year_month
            """, (qualifying_sns, max_end))
            all_pay_amt: dict = {}
            all_pay_set: dict = {}
            for sn, ym, amt in cur.fetchall():
                all_pay_amt.setdefault(sn, {})[ym] = float(amt)
                all_pay_set.setdefault(sn, set()).add(ym)

            # Suspensions (broad fetch, filter per device below)
            cur.execute("""
                SELECT sn, date_from, date_to FROM device_suspensions
                WHERE sn = ANY(%s)
            """, (qualifying_sns,))
            dev_susp: dict = {}
            for sn, df, dt in cur.fetchall():
                dev_susp.setdefault(sn, []).append((df, dt))

            firms_q = list({r[1] for r in raw_devices if r[0] in first_pay_map})
            cur.execute("""
                SELECT firma, date_from, date_to FROM firm_suspensions
                WHERE firma = ANY(%s)
            """, (firms_q,))
            firm_susp: dict = {}
            for firma, df, dt in cur.fetchall():
                firm_susp.setdefault(firma, []).append((df, dt))

    devices_out = []
    dtype_map = {r[0]: r[4] for r in raw_devices}
    firma_map  = {r[0]: r[1] for r in raw_devices}
    masz_map   = {r[0]: r[2] for r in raw_devices}
    oper_map   = {r[0]: r[3] for r in raw_devices}

    for sn, first_pay in first_pay_map.items():
        if dtype_map.get(sn) == 'oem':
            continue

        firma   = firma_map.get(sn, "")
        window  = [_ym_add(first_pay, i) for i in range(window_months)]
        sn_all  = all_pay_set.get(sn, set())

        detail = []
        months_paid = months_suspended = months_gap_resumed = months_unpaid = 0
        total_amount = 0.0

        for ym in window:
            susp = any(df <= ym <= dt for df, dt in dev_susp.get(sn, []))
            if not susp:
                susp = any(df <= ym <= dt for df, dt in firm_susp.get(firma, []))

            if susp:
                detail.append({"month": ym, "status": "suspended", "amount": 0})
                months_suspended += 1
                continue

            amt = all_pay_amt.get(sn, {}).get(ym, 0)
            if amt > 0:
                detail.append({"month": ym, "status": "paid", "amount": amt})
                months_paid += 1
                total_amount += amt
            else:
                resumed = any(m > ym for m in sn_all)
                status  = "gap_resumed" if resumed else "unpaid"
                detail.append({"month": ym, "status": status, "amount": 0})
                if resumed: months_gap_resumed += 1
                else:       months_unpaid += 1

        billable = window_months - months_suspended
        pct = round(months_paid / billable * 100) if billable > 0 else 0

        devices_out.append({
            "sn":               sn,
            "firma":            firma,
            "maszyna":          masz_map.get(sn, "") or "",
            "operator":         oper_map.get(sn, "") or "",
            "customer":         customer_map.get(sn, ""),
            "currency":         currency_map.get(sn, "PLN"),
            "first_pay":        first_pay,
            "window_months":    window_months,
            "months_suspended": months_suspended,
            "months_billable":  billable,
            "months_paid":      months_paid,
            "months_gap_resumed": months_gap_resumed,
            "months_unpaid":    months_unpaid,
            "total_amount":     round(total_amount, 2),
            "coverage_pct":     pct,
            "monthly_detail":   detail,
        })

    devices_out.sort(key=lambda x: (-x["coverage_pct"], x["firma"], x["sn"]))
    return {"devices": devices_out, "summary": _bonus_summary(devices_out)}


def _bonus_summary(devices: list) -> dict:
    if not devices:
        return {"total": 0, "full": 0, "partial": 0, "no_pay": 0,
                "total_amount": 0.0, "avg_coverage": 0}
    full = sum(1 for d in devices if d["coverage_pct"] == 100)
    no_pay = sum(1 for d in devices if d["months_paid"] == 0)
    partial = len(devices) - full - no_pay
    total_amount = sum(d["total_amount"] for d in devices)
    avg = round(sum(d["coverage_pct"] for d in devices) / len(devices)) if devices else 0
    return {
        "total":        len(devices),
        "full":         full,
        "partial":      partial,
        "no_pay":       no_pay,
        "total_amount": round(total_amount, 2),
        "avg_coverage": avg,
    }


# ── import sessions ────────────────────────────────────────────────────────────

def create_import_session(
    import_type: str,
    filenames: str,
    mode: str,
    device_type_tag: str,
    records_added: int,
    records_skipped: int,
    sns: list = None,
    pay_pairs: list = None,
) -> int:
    """Create an import session record. Returns the new session id."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO import_sessions
                    (import_type, filenames, mode, device_type_tag, records_added, records_skipped)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (import_type, filenames, mode, device_type_tag, records_added, records_skipped))
            session_id = cur.fetchone()[0]

            if sns:
                from psycopg2.extras import execute_values as _ev
                _ev(cur,
                    "INSERT INTO import_session_devices (session_id, sn) VALUES %s",
                    [(session_id, sn) for sn in sns])

            if pay_pairs:
                from psycopg2.extras import execute_values as _ev
                _ev(cur,
                    "INSERT INTO import_session_payments (session_id, sn, year_month) VALUES %s",
                    [(session_id, sn, ym) for sn, ym in pay_pairs])

    return session_id


def get_import_sessions(limit: int = 50) -> list:
    """Return recent import sessions, newest first."""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT id, import_type, filenames, mode, device_type_tag,
                       records_added, records_skipped, created_at
                FROM import_sessions
                ORDER BY created_at DESC
                LIMIT %s
            """, (limit,))
            return [dict(r) for r in cur.fetchall()]


def undo_import_session(session_id: int) -> dict:
    """
    Undo an import session:
    - production: delete devices whose SN was inserted in this session
    - payments:   delete (sn, year_month) pairs inserted in this session
    Returns {"deleted_devices": N, "deleted_payments": N}
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Check session exists
            cur.execute("SELECT import_type FROM import_sessions WHERE id = %s", (session_id,))
            row = cur.fetchone()
            if not row:
                return {"error": "Sesja nie istnieje"}

            del_dev = del_pay = 0

            cur.execute("""
                DELETE FROM devices
                WHERE sn IN (
                    SELECT sn FROM import_session_devices WHERE session_id = %s
                )
            """, (session_id,))
            del_dev = cur.rowcount

            cur.execute("""
                DELETE FROM payments
                WHERE (sn, year_month) IN (
                    SELECT sn, year_month FROM import_session_payments WHERE session_id = %s
                )
            """, (session_id,))
            del_pay = cur.rowcount

            cur.execute("DELETE FROM import_sessions WHERE id = %s", (session_id,))

    return {"deleted_devices": del_dev, "deleted_payments": del_pay}


# ── bulk device update ─────────────────────────────────────────────────────────

def bulk_update_devices(
    sns: list,
    firma: str = None,
    operator: str = None,
    device_type: str = None,
) -> int:
    """
    Bulk-update firma / operator / device_type_override for a list of SNs.
    Only non-None fields are updated.  Returns number of updated rows.
    """
    if not sns:
        return 0
    sets = []
    params = []
    if firma is not None:
        sets.append("firma = %s"); params.append(firma)
    if operator is not None:
        sets.append("operator = %s"); params.append(operator)
    if not sets and device_type is None:
        return 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            count = 0
            if sets:
                params.append(sns)
                cur.execute(
                    f"UPDATE devices SET {', '.join(sets)} WHERE sn = ANY(%s)",
                    params,
                )
                count = cur.rowcount
            if device_type is not None:
                if device_type:
                    for sn in sns:
                        cur.execute(
                            """INSERT INTO device_type_overrides (sn, type_override, showroom_until)
                               VALUES (%s, %s, '')
                               ON CONFLICT (sn) DO UPDATE
                                   SET type_override = EXCLUDED.type_override,
                                       showroom_until = ''""",
                            (sn, device_type),
                        )
                else:
                    cur.execute(
                        "DELETE FROM device_type_overrides WHERE sn = ANY(%s)", (sns,)
                    )
                if not sets:
                    count = len(sns)
            return count


# ── commission rates ───────────────────────────────────────────────────────────

COMMISSION_STATUSES = ('W_TOKU', 'KWALIFIKUJE', 'WYPLATA_ZATWIERDZONA', 'WYPLACONA', 'ANULOWANA')


def get_commission_rates() -> list:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT id, COALESCE(rep_name, '') AS rep_name, pct,
                       valid_from::text, COALESCE(valid_to::text, '') AS valid_to, note
                FROM commission_rates
                ORDER BY COALESCE(rep_name, '') NULLS FIRST, valid_from
            """)
            return [dict(r) for r in cur.fetchall()]


def upsert_commission_rate(rep_name: str, pct: float,
                           valid_from: str, valid_to: str,
                           note: str = '', rate_id: int = None) -> dict:
    rep = rep_name.strip() or None
    vto = valid_to.strip() or None
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if rate_id:
                cur.execute("""
                    UPDATE commission_rates
                    SET rep_name=%s, pct=%s, valid_from=%s, valid_to=%s, note=%s
                    WHERE id=%s
                    RETURNING id, COALESCE(rep_name,'') AS rep_name, pct,
                              valid_from::text, COALESCE(valid_to::text,'') AS valid_to, note
                """, (rep, pct, valid_from, vto, note, rate_id))
            else:
                cur.execute("""
                    INSERT INTO commission_rates (rep_name, pct, valid_from, valid_to, note)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING id, COALESCE(rep_name,'') AS rep_name, pct,
                              valid_from::text, COALESCE(valid_to::text,'') AS valid_to, note
                """, (rep, pct, valid_from, vto, note))
            row = cur.fetchone()
            if not row:
                raise ValueError("Nie znaleziono stawki")
            return dict(row)


def delete_commission_rate(rate_id: int) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM commission_rates WHERE id = %s", (rate_id,))


# ── commission periods ─────────────────────────────────────────────────────────

def list_commission_periods() -> list:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT cp.id, cp.name, cp.cohort_from::text, cp.cohort_to::text,
                       cp.locked, cp.created_at,
                       u.name AS created_by_name,
                       COUNT(ci.id) AS item_count,
                       COUNT(ci.id) FILTER (WHERE ci.status = 'KWALIFIKUJE')           AS qualifying,
                       COUNT(ci.id) FILTER (WHERE ci.status = 'W_TOKU')                AS in_progress,
                       COUNT(ci.id) FILTER (WHERE ci.status = 'WYPLATA_ZATWIERDZONA')  AS approved,
                       COUNT(ci.id) FILTER (WHERE ci.status = 'WYPLACONA')             AS paid_out,
                       COALESCE(SUM(ci.commission_amt) FILTER (WHERE ci.status IN ('KWALIFIKUJE','WYPLATA_ZATWIERDZONA','WYPLACONA')), 0) AS total_commission
                FROM commission_periods cp
                LEFT JOIN users u ON cp.created_by = u.id
                LEFT JOIN commission_items ci ON ci.period_id = cp.id
                GROUP BY cp.id, cp.name, cp.cohort_from, cp.cohort_to, cp.locked, cp.created_at, u.name
                ORDER BY cp.created_at DESC
            """)
            return [dict(r) for r in cur.fetchall()]


def create_commission_period(name: str, cohort_from: str, cohort_to: str,
                             user_id: int) -> dict:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO commission_periods (name, cohort_from, cohort_to, created_by)
                VALUES (%s, %s, %s, %s)
                RETURNING id, name, cohort_from::text, cohort_to::text, locked, created_at
            """, (name, cohort_from, cohort_to, user_id))
            return dict(cur.fetchone())


def delete_commission_period(period_id: int) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT locked FROM commission_periods WHERE id = %s", (period_id,))
            row = cur.fetchone()
            if not row:
                raise ValueError("Okres nie istnieje")
            if row[0]:
                raise ValueError("Nie można usunąć zablokowanego okresu")
            cur.execute("DELETE FROM commission_periods WHERE id = %s", (period_id,))


def lock_commission_period(period_id: int, locked: bool) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE commission_periods SET locked = %s WHERE id = %s",
                        (locked, period_id))


def compute_commission_period(period_id: int) -> dict:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT cohort_from, cohort_to, locked FROM commission_periods WHERE id = %s",
                        (period_id,))
            row = cur.fetchone()
            if not row:
                raise ValueError("Okres nie istnieje")
            cohort_from, cohort_to, locked = row
            if locked:
                raise ValueError("Okres jest zablokowany — odblokuj przed przeliczeniem")

            # Devices in cohort: prod_date BETWEEN cohort_from AND cohort_to, non-OEM/wycofany
            cur.execute("""
                SELECT d.sn, COALESCE(d.firma, '') AS firma, d.prod_date
                FROM devices d
                LEFT JOIN device_type_overrides dto ON d.sn = dto.sn
                WHERE d.prod_date >= %s AND d.prod_date <= %s
                  AND COALESCE(NULLIF(COALESCE(dto.type_override,''),''),
                               CASE WHEN d.maszyna ILIKE '%%OEM%%' THEN 'oem' ELSE 'master' END
                              ) NOT IN ('oem', 'wycofany')
            """, (str(cohort_from), str(cohort_to)))
            devices = cur.fetchall()

            if not devices:
                return {"items_computed": 0, "devices_in_cohort": 0,
                        "qualifying": 0, "in_progress": 0}

            qualifying_sns = [d[0] for d in devices]

            # Payments sorted per SN
            cur.execute("""
                SELECT sn, year_month, COALESCE(amount_netto, 0) AS netto,
                       COALESCE(months_batch, 1) AS batch
                FROM payments
                WHERE sn = ANY(%s)
                ORDER BY sn, year_month
            """, (qualifying_sns,))
            pays_by_sn: dict = {}
            for sn, ym, netto, batch in cur.fetchall():
                pays_by_sn.setdefault(sn, []).append((ym, float(netto), int(batch)))

            # firm → [rep_names]
            firms = list({d[1] for d in devices if d[1]})
            firm_to_reps: dict = {}
            if firms:
                cur.execute("""
                    SELECT fr.firma, sr.name
                    FROM firm_reps fr
                    JOIN sales_reps sr ON fr.rep_id = sr.id
                    WHERE fr.firma = ANY(%s)
                    ORDER BY fr.firma, sr.name
                """, (firms,))
                for firma, rep in cur.fetchall():
                    firm_to_reps.setdefault(firma, []).append(rep)

            # Commission rates valid today
            today = _date.today().isoformat()
            cur.execute("""
                SELECT COALESCE(rep_name, '') AS rep_name, pct
                FROM commission_rates
                WHERE valid_from <= %s
                  AND (valid_to IS NULL OR valid_to >= %s)
                ORDER BY rep_name NULLS LAST
            """, (today, today))
            rates: dict = {}
            global_rate = 0.0
            for rep_name, pct in cur.fetchall():
                if not rep_name:
                    global_rate = float(pct)
                else:
                    rates[rep_name] = float(pct)

            # Delete non-finalized items for this period
            cur.execute("""
                DELETE FROM commission_items
                WHERE period_id = %s
                  AND status NOT IN ('WYPLACONA', 'WYPLATA_ZATWIERDZONA')
            """, (period_id,))

            # Build items
            items = []
            for sn, firma, prod_date in devices:
                pays = pays_by_sn.get(sn, [])
                months_paid = len(pays)
                advance_flag = any(p[2] >= 12 for p in pays)

                if months_paid >= 12:
                    first_12 = pays[:12]
                    month_12_ym = first_12[-1][0]
                    base_netto = round(sum(p[1] for p in first_12), 2)
                    status = 'KWALIFIKUJE'
                else:
                    month_12_ym = None
                    base_netto = round(sum(p[1] for p in pays), 2)
                    status = 'W_TOKU'

                reps = firm_to_reps.get(firma, [])
                if not reps:
                    rate_pct = global_rate
                    items.append((
                        period_id, sn, firma, '', str(prod_date) if prod_date else '',
                        months_paid, month_12_ym, base_netto,
                        rate_pct, round(base_netto * rate_pct / 100, 2),
                        'PLN', status, advance_flag
                    ))
                else:
                    for rep in reps:
                        rate_pct = rates.get(rep, global_rate)
                        items.append((
                            period_id, sn, firma, rep, str(prod_date) if prod_date else '',
                            months_paid, month_12_ym, base_netto,
                            rate_pct, round(base_netto * rate_pct / 100, 2),
                            'PLN', status, advance_flag
                        ))

            if items:
                execute_values(cur, """
                    INSERT INTO commission_items
                        (period_id, sn, firma, rep_name, prod_date, months_paid,
                         month_12_ym, base_netto, rate_pct, commission_amt,
                         currency, status, advance_flag)
                    VALUES %s
                    ON CONFLICT (period_id, sn, rep_name) DO UPDATE SET
                        months_paid    = EXCLUDED.months_paid,
                        month_12_ym    = EXCLUDED.month_12_ym,
                        base_netto     = EXCLUDED.base_netto,
                        rate_pct       = EXCLUDED.rate_pct,
                        commission_amt = EXCLUDED.commission_amt,
                        advance_flag   = EXCLUDED.advance_flag,
                        status = CASE
                            WHEN commission_items.status IN ('WYPLACONA','WYPLATA_ZATWIERDZONA')
                            THEN commission_items.status
                            ELSE EXCLUDED.status
                        END
                """, items)

            qualifying = sum(1 for it in items if it[11] == 'KWALIFIKUJE')
            return {
                "items_computed": len(items),
                "devices_in_cohort": len(devices),
                "qualifying": qualifying,
                "in_progress": len(items) - qualifying,
            }


def get_commission_items(period_id: int, status: str = None,
                         rep_name: str = None) -> list:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            where = ["period_id = %s"]
            params: list = [period_id]
            if status:
                where.append("status = %s")
                params.append(status)
            if rep_name is not None:
                where.append("rep_name = %s")
                params.append(rep_name)
            cur.execute(f"""
                SELECT id, period_id, sn, firma, rep_name, prod_date,
                       months_paid, month_12_ym, base_netto, rate_pct,
                       commission_amt, currency, status, advance_flag
                FROM commission_items
                WHERE {' AND '.join(where)}
                ORDER BY rep_name, firma, sn
            """, params)
            return [dict(r) for r in cur.fetchall()]


def get_commission_summary(period_id: int) -> list:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT
                    rep_name,
                    COUNT(*) FILTER (WHERE status = 'KWALIFIKUJE')          AS qualifying,
                    COUNT(*) FILTER (WHERE status = 'W_TOKU')               AS in_progress,
                    COUNT(*) FILTER (WHERE status = 'WYPLATA_ZATWIERDZONA') AS approved,
                    COUNT(*) FILTER (WHERE status = 'WYPLACONA')            AS paid_out,
                    COUNT(*) FILTER (WHERE status = 'ANULOWANA')            AS cancelled,
                    COALESCE(SUM(commission_amt) FILTER (
                        WHERE status IN ('KWALIFIKUJE','WYPLATA_ZATWIERDZONA','WYPLACONA')
                    ), 0) AS total_commission,
                    COALESCE(SUM(commission_amt) FILTER (
                        WHERE status = 'WYPLACONA'
                    ), 0) AS paid_commission
                FROM commission_items
                WHERE period_id = %s
                GROUP BY rep_name
                ORDER BY rep_name
            """, (period_id,))
            return [dict(r) for r in cur.fetchall()]


def update_commission_status(item_id: int, new_status: str,
                             user_id: int, note: str = '') -> dict:
    if new_status not in COMMISSION_STATUSES:
        raise ValueError(f"Nieprawidłowy status: {new_status}")
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT status, period_id FROM commission_items WHERE id = %s", (item_id,))
            row = cur.fetchone()
            if not row:
                raise ValueError("Pozycja nie istnieje")
            old_status = row['status']
            # Check period not locked (except WYPLACONA → allow locking state)
            cur.execute("SELECT locked FROM commission_periods WHERE id = %s", (row['period_id'],))
            period = cur.fetchone()
            if period and period['locked'] and new_status not in ('WYPLACONA',):
                raise ValueError("Okres jest zablokowany")

            cur.execute("""
                UPDATE commission_items SET status = %s WHERE id = %s
                RETURNING id, sn, firma, rep_name, status, commission_amt
            """, (new_status, item_id))
            updated = dict(cur.fetchone())
            cur.execute("""
                INSERT INTO commission_status_log (item_id, old_status, new_status, changed_by, note)
                VALUES (%s, %s, %s, %s, %s)
            """, (item_id, old_status, new_status, user_id, note))
            return updated


def bulk_update_commission_status(period_id: int, item_ids: list,
                                  new_status: str, user_id: int,
                                  note: str = '') -> int:
    if new_status not in COMMISSION_STATUSES:
        raise ValueError(f"Nieprawidłowy status: {new_status}")
    if not item_ids:
        return 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, status FROM commission_items
                WHERE id = ANY(%s) AND period_id = %s
                  AND status NOT IN ('WYPLACONA')
            """, (item_ids, period_id))
            rows = cur.fetchall()
            if not rows:
                return 0
            ids = [r[0] for r in rows]
            cur.execute("""
                UPDATE commission_items SET status = %s WHERE id = ANY(%s)
            """, (new_status, ids))
            log_rows = [(item_id, r[1], new_status, user_id, note)
                        for r in rows for item_id in [r[0]]]
            execute_values(cur, """
                INSERT INTO commission_status_log (item_id, old_status, new_status, changed_by, note)
                VALUES %s
            """, log_rows)
            return len(ids)
