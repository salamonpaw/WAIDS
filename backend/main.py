from __future__ import annotations

import io
import re
from typing import Annotated, List, Optional

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from psycopg2.extras import execute_values

from database import (
    get_conn, get_status, get_analysis, init_db,
    get_excluded_firms, add_excluded_firm, remove_excluded_firm,
    get_reps, get_all_firms, assign_firm_to_rep, remove_firm_from_rep,
    set_device_type_override, get_type_overrides,
    get_payments_for_sn,
    set_device_comment, bulk_set_device_type,
)

app = FastAPI(title="Weryfikator Abonamentów API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    init_db()


# ── shared helpers ────────────────────────────────────────────────────────────

def norm_sn(s) -> str:
    if not s or str(s).strip() in ("", "nan", "None"):
        return ""
    s = str(s).strip()
    if s.endswith(".0"):        # int stored as float in Excel
        s = s[:-2]
    return re.sub(r"^0+", "", s).upper()


_PL = str.maketrans("ąćęłńóśźżĄĆĘŁŃÓŚŹŻ", "acelnoszzACELNOSZZ")

def _n(s: str) -> str:
    """Lowercase + strip Polish diacritics for fuzzy header matching."""
    return str(s).lower().translate(_PL)


def find_col(df: pd.DataFrame, keywords: List[str]) -> Optional[str]:
    """Case-insensitive, diacritics-insensitive column search."""
    for kw in keywords:
        nkw = _n(kw)
        for col in df.columns:
            if nkw in _n(col):
                return col
    return None


_SN_RE = re.compile(r'^[A-Z0-9]{3,15}$')

def _clean_sn_val(v: str) -> str:
    """Strip float suffix (.0) and normalize for SN pattern matching."""
    v = str(v).strip().upper()
    if v.endswith(".0"):
        v = v[:-2]
    return v

def find_sn_col_by_data(df: pd.DataFrame) -> Optional[str]:
    """
    Fallback: gdy żaden nagłówek nie pasuje do SN (np. pusta/scalona komórka w ODS),
    szukamy kolumny której wartości wyglądają jak numery seryjne (krótkie alfanumeryczne).
    Preferujemy kolumny 'Unnamed' zaraz po kolumnie z nazwą maszyny.
    ODS/Excel często eksportuje liczby z '.0' — strippujemy przed dopasowaniem.
    """
    unnamed_cols = [c for c in df.columns if str(c).startswith("Unnamed")]
    maszyna_idx = next(
        (i for i, c in enumerate(df.columns) if _n("maszyna") in _n(c) or _n("model") in _n(c)),
        -1,
    )
    if maszyna_idx >= 0:
        ordered = sorted(
            unnamed_cols,
            key=lambda c: abs(list(df.columns).index(c) - maszyna_idx - 1),
        )
    else:
        ordered = unnamed_cols

    for col in ordered:
        raw_vals = [str(v).strip() for v in df[col]
                    if str(v).strip() not in ("", "nan", "NaN", "NAN", "None", "NONE")]
        sample = [_clean_sn_val(v) for v in raw_vals[:50]]
        if not sample:          # kolumna całkowicie pusta
            continue
        hits = sum(1 for v in sample if _SN_RE.match(v))
        # Progi trafień (hits/sample):
        #  - 1 wpis  → 100% (unikamy pojedynczego fałszywego trafienia)
        #  - 2-5     → 50%  (dopuszcza 1 wiersz nagłówkowy + 1-4 prawdziwe SN-y,
        #                    typowe dla pliku z 1 urządzeniem + 2-nagłówkowy ODS)
        #  - 6+      → 35%  (dla plików z wierszami podsumowań / tytułowymi)
        if len(sample) == 1:
            threshold = 1.0
        elif len(sample) <= 5:
            threshold = 0.5
        else:
            threshold = 0.35
        if hits / len(sample) >= threshold:
            return col

    return None


def fmt_date(raw) -> str:
    """
    Parse a date value and return YYYY-MM-DD.
    Handles Polish DD.MM.YYYY format explicitly — avoids the dayfirst ambiguity bug
    in pd.to_datetime (which is 'not strict' and may swap day/month when day ≤ 12).
    """
    if raw is None or str(raw).strip() in ("", "nan", "NaT", "None"):
        return ""

    # If already a datetime-like object (e.g. from Excel date cell), use it directly
    if hasattr(raw, "strftime"):
        return raw.strftime("%Y-%m-%d")

    s = str(raw).strip()

    # 1. Polish/European format: DD.MM.YYYY or DD-MM-YYYY or DD/MM/YYYY
    #    Always treat first component as DAY, second as MONTH — no ambiguity.
    m = re.match(r'^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$', s)
    if m:
        day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= month <= 12 and 1 <= day <= 31:
            try:
                from datetime import date as _date
                return _date(year, month, day).strftime("%Y-%m-%d")
            except ValueError:
                return f"{year}-{month:02d}"

    # 2. ISO format: YYYY-MM-DD (what Excel/pandas gives for date cells)
    m = re.match(r'^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})', s)
    if m:
        year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= month <= 12 and 1 <= day <= 31:
            try:
                from datetime import date as _date
                return _date(year, month, day).strftime("%Y-%m-%d")
            except ValueError:
                return f"{year}-{month:02d}"

    # 3. Already YYYY-MM-DD or YYYY-MM
    m = re.match(r'^(\d{4}-\d{2}-\d{2})', s)
    if m:
        return m.group(1)
    m = re.match(r'^(\d{4}-\d{2})$', s)
    if m:
        return m.group(1)

    # 4. Pandas fallback (last resort — still uses dayfirst hint)
    try:
        dt = pd.to_datetime(s, dayfirst=True, errors="raise")
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return ""


MONTH_RE = re.compile(
    r"\d{4}[-/\.]\d{2}"
    r"|\d{2}[-/\.]\d{4}"
    r"|sty|lut|mar|kwi|maj|cze|lip|sie|wrz|paź|paz|lis|gru"
    r"|jan|feb|apr|jun|jul|aug|sep|oct|nov|dec",
    re.IGNORECASE,
)


def detect_month_cols(df: pd.DataFrame) -> List[str]:
    return [c for c in df.columns if MONTH_RE.search(str(c))]


def detect_sep(data: bytes) -> str:
    """Sniff CSV separator from the first 4 KB (handles UTF-8 BOM)."""
    sample = data[:4096].decode("utf-8-sig", errors="ignore")
    return ";" if sample.count(";") > sample.count(",") else ","


def read_upload(data: bytes, filename: str) -> pd.DataFrame:
    name = filename.lower()
    if name.endswith(".csv"):
        sep = detect_sep(data)
        # Twoje pliki "Rozliczenie produkcyjne" mają wiersze podsumowań z >N kolumn
        # on_bad_lines='skip' pomija takie wiersze automatycznie.
        # Kodowanie: UTF-8-BOM → CP1250 → ISO-8859-2 (polskie excelowe eksporty)
        for enc in ("utf-8-sig", "cp1250", "iso-8859-2"):
            try:
                df = pd.read_csv(
                    io.BytesIO(data), dtype=str, encoding=enc, sep=sep,
                    on_bad_lines="skip",   # pandas ≥ 1.3; ignoruje wiersze z za dużą liczbą pól
                )
                break
            except (UnicodeDecodeError, TypeError):
                # TypeError gdy starsza pandas nie zna on_bad_lines — fallback
                try:
                    df = pd.read_csv(
                        io.BytesIO(data), dtype=str, encoding=enc, sep=sep,
                        error_bad_lines=False,  # pandas < 1.3
                    )
                    break
                except UnicodeDecodeError:
                    continue
        else:
            raise ValueError("Nie można odczytać pliku CSV (spróbuj zapisać jako UTF-8).")
    elif name.endswith(".ods"):
        # ODS (LibreOffice/OpenOffice) — wymaga odfpy
        df = pd.read_excel(io.BytesIO(data), dtype=str, engine="odf")
    else:
        # XLSX / XLS
        df = pd.read_excel(io.BytesIO(data), dtype=str)
    df = df.fillna("")
    df.columns = [str(c).strip() for c in df.columns]
    return df


# ── endpoints ─────────────────────────────────────────────────────────────────

@app.get("/status")
def db_status():
    """How many devices and which payment months are in the DB."""
    try:
        return get_status()
    except Exception as e:
        raise HTTPException(503, f"Błąd bazy danych: {e}")


@app.post("/import/production")
async def import_production(files: List[UploadFile] = File(...)):
    """
    Import one or more production files (zestawienie produkcji).
    Records are upserted — re-importing the same file is safe.
    """
    total = 0
    errors: List[str] = []

    for file in files:
        try:
            raw_data = await file.read()
            df = read_upload(raw_data, file.filename)

            _SN_KW = ["numer seryjny", "serial", "nr_ser", "nr ser", "sn",
                      "nr.ser", "nr. ser", "nr.seryjny", "nr seryjny",
                      "number", "device", "sn.", "s/n"]

            sn_col = find_col(df, _SN_KW)
            # Fallback: nagłówek może być pusty (scalona komórka w ODS/XLSX)
            if not sn_col:
                sn_col = find_sn_col_by_data(df)

            # Dla plików ODS: starsze pliki (2018-2019) mogą mieć wiersz tytułowy
            # w wierszu 0, a rzeczywiste nagłówki dopiero w wierszu 1 lub 2.
            # Próbujemy ponownie z różnymi wartościami parametru header.
            if not sn_col and file.filename.lower().endswith(".ods"):
                for hdr in (1, 2):
                    try:
                        df2 = pd.read_excel(
                            io.BytesIO(raw_data),
                            dtype=str, engine="odf", header=hdr,
                        )
                        df2 = df2.fillna("")
                        df2.columns = [str(c).strip() for c in df2.columns]
                        sn2 = find_col(df2, _SN_KW)
                        if not sn2:
                            sn2 = find_sn_col_by_data(df2)
                        if sn2:
                            df = df2
                            sn_col = sn2
                            break
                    except Exception:
                        pass

            if not sn_col:
                cols_preview = " | ".join(str(c) for c in df.columns[:15])
                # Dołącz próbkę wartości z kolumn Unnamed — pomaga debugować format
                unnamed_samples = []
                for c in df.columns:
                    if str(c).startswith("Unnamed"):
                        vals = [str(v).strip() for v in df[c]
                                if str(v).strip() not in ("", "nan")][:3]
                        if vals:
                            unnamed_samples.append(f"{c}: {vals}")
                hint = ("; próbki: " + ", ".join(unnamed_samples)) if unnamed_samples else ""
                errors.append(
                    f"{file.filename}: nie znaleziono kolumny z SN. "
                    f"Kolumny: [{cols_preview}]{hint}"
                )
                continue

            # ── column mapping ─────────────────────────────────────────────
            # "Rozliczenie produkcyjne" format (Twoje pliki):
            #   OPERATOR      = klient (CANIS, HHW, BEESWIFT…)   → firma
            #   Wdrożeniowiec = wdrożeniowiec (WIĘZIK, WÓJTOWICZ) → operator
            # Generic format:
            #   firma/company/klient/zamow → firma
            #   operator/handlowiec        → operator
            wdrozeniowiec_col = find_col(df, ["wdrożeniowiec", "wdrozeniowiec", "wdroż", "wdroz"])

            if wdrozeniowiec_col:
                # Twój format – OPERATOR = klient, Wdrożeniowiec = implementer
                firma_col    = find_col(df, ["operator"])
                operator_col = wdrozeniowiec_col
            else:
                firma_col    = find_col(df, ["firma", "company", "klient", "zamow"])
                operator_col = find_col(df, ["operator", "handlowiec"])

            maszyna_col = find_col(df, ["maszyna", "model", "typ", "machine"])
            date_col    = find_col(df, ["data produkcji", "data", "date"])

            records = []
            for _, row in df.iterrows():
                sn = norm_sn(row.get(sn_col, ""))
                if not sn:
                    continue
                records.append((
                    sn,
                    str(row.get(firma_col,    "")).strip() if firma_col    else "",
                    str(row.get(maszyna_col,  "")).strip() if maszyna_col  else "",
                    str(row.get(operator_col, "")).strip() if operator_col else "",
                    fmt_date(row.get(date_col, ""))         if date_col     else "",
                ))

            if records:
                # Deduplikacja po SN w obrębie jednego pliku (zachowaj ostatnie)
                deduped = list({r[0]: r for r in records}.values())
                with get_conn() as conn:
                    with conn.cursor() as cur:
                        execute_values(cur, """
                            INSERT INTO devices (sn, firma, maszyna, operator, prod_date)
                            VALUES %s
                            ON CONFLICT (sn) DO UPDATE SET
                                firma      = EXCLUDED.firma,
                                maszyna    = EXCLUDED.maszyna,
                                operator   = EXCLUDED.operator,
                                prod_date  = EXCLUDED.prod_date,
                                updated_at = NOW()
                        """, deduped)
                total += len(deduped)

        except Exception as e:
            errors.append(f"{file.filename}: {e}")

    return {"imported": total, "errors": errors}


@app.post("/import/payments")
async def import_payments(
    file: UploadFile = File(...),
    year_month: Annotated[Optional[str], Form()] = None,
):
    """
    Obsługuje trzy formaty pliku płatności:

    1. Format IDS (surowy z ERP) — wykrywany automatycznie po kolumnie
       FS_DataWystawienia: każdy wiersz = jedna faktura, data wystawienia
       określa miesiąc płatności.

    2. Tabela przestawna — kolumny = miesiące, komórka = wartość płatności.

    3. Lista miesięczna — jeden miesiąc na raz; podaj year_month = 'YYYY-MM'.
    """
    df = read_upload(await file.read(), file.filename)

    # SN: tw_SN (IDS) lub generyczny
    sn_col = find_col(df, ["tw_sn", "numer seryjny", "serial", "nr_ser", "nr ser"])
    if not sn_col:
        raise HTTPException(422, "Brak kolumny z numerem seryjnym. Oczekiwano: tw_SN lub 'Numer seryjny'.")

    # Kolumna klienta: IDS używa adr_NazwaPelna
    cust_col = find_col(df, ["adr_nazwapelna", "adr_nazwa", "klient", "client", "customer", "nazwa"])

    # Data wystawienia faktury (format IDS)
    invoice_date_col = find_col(df, ["fs_datawystawienia", "datawystawienia", "data wystawienia", "fs_data"])

    month_cols = detect_month_cols(df)

    records: List[tuple] = []

    if invoice_date_col:
        # ── Format IDS: surowy eksport z ERP ─────────────────────────────────
        # Każdy wiersz = jedna faktura; data wystawienia → miesiąc płatności.
        # Kolumna ob_Ilosc wskazuje ile miesięcy obejmuje faktura (np. 12 dla
        # rocznego abonamentu) — generujemy tyle kolejnych rekordów miesięcznych.
        qty_col = find_col(df, ["ob_ilosc", "ob_il", "ilosc", "quantity", "qty"])
        cat_col = find_col(df, ["fs_kategoria", "fs_kat", "kategoria", "category"])

        # DEBUG: log detected columns and a sample qty value
        import logging
        logging.warning(
            f"[import/payments] invoice_date_col={invoice_date_col!r} "
            f"qty_col={qty_col!r} cat_col={cat_col!r} "
            f"all_cols={list(df.columns[:30])!r}"
        )
        if qty_col:
            sample_vals = [str(v) for v in df[qty_col].dropna().head(5).tolist()]
            logging.warning(f"[import/payments] qty sample values: {sample_vals}")

        skipped = 0
        for _, row in df.iterrows():
            sn = norm_sn(row.get(sn_col, ""))
            if not sn:
                continue
            ym_full = fmt_date(row.get(invoice_date_col, ""))
            if not ym_full:
                skipped += 1
                continue
            ym = ym_full[:7]   # zawsze YYYY-MM — unikamy duplikatów z różnych dni
            customer = str(row.get(cust_col, "")).strip() if cust_col else ""

            # Liczba miesięcy z ob_Ilosc
            months_count = 1
            if qty_col:
                try:
                    q = float(str(row.get(qty_col, "1")).replace(",", "."))
                    if 1 <= q <= 120:   # rozsądny zakres 1-120 mies.
                        months_count = int(q)
                except (ValueError, TypeError):
                    pass

            # Fallback: parsuj "co 12 miesięcy" z FS_Kategoria
            if months_count == 1 and cat_col:
                cat_str = str(row.get(cat_col, ""))
                m = re.search(r'co\s+(\d+)\s+miesi', cat_str, re.IGNORECASE)
                if m:
                    months_count = int(m.group(1))

            # Generuj rekord dla każdego miesiąca objętego fakturą
            base_y, base_m = int(ym[:4]), int(ym[5:7])
            for i in range(months_count):
                offset = base_m - 1 + i
                rec_y = base_y + offset // 12
                rec_m = offset % 12 + 1
                records.append((sn, f"{rec_y}-{rec_m:02d}", customer))

    elif month_cols:
        # ── Tabela przestawna ─────────────────────────────────────────────────
        for _, row in df.iterrows():
            sn = norm_sn(row.get(sn_col, ""))
            if not sn:
                continue
            customer = str(row.get(cust_col, "")).strip() if cust_col else ""
            for mc in month_cols:
                val = str(row.get(mc, "")).strip()
                if val and val not in ("0", "nan", "None", ""):
                    ym = fmt_date(mc) or str(mc).strip()[:7]
                    if ym:
                        records.append((sn, ym, customer))

    elif year_month:
        # ── Lista miesięczna ──────────────────────────────────────────────────
        paid_col = find_col(df, ["oplacony", "oplacone", "paid", "status", "kwota", "amount"])
        for _, row in df.iterrows():
            sn = norm_sn(row.get(sn_col, ""))
            if not sn:
                continue
            customer = str(row.get(cust_col, "")).strip() if cust_col else ""
            if paid_col:
                val = str(row.get(paid_col, "")).strip().lower()
                if val in ("0", "nie", "no", "false", "", "nan"):
                    continue
            records.append((sn, year_month, customer))

    else:
        raise HTTPException(
            422,
            "Nie rozpoznano formatu pliku. Oczekiwano kolumny FS_DataWystawienia "
            "(format IDS), kolumn miesięcy (tabela przestawna) lub podaj miesiąc ręcznie.",
        )

    if not records:
        return {"inserted": 0, "months": [], "message": "Brak rekordów do importu."}

    # Deduplikacja po (sn, year_month) — wiele faktur dla tego SN w tym samym miesiącu
    # zachowujemy pierwszą z niepustym klientem, resztę pomijamy
    deduped_pay: dict = {}
    for sn, ym, customer in records:
        key = (sn, ym)
        if key not in deduped_pay or (customer and not deduped_pay[key][2]):
            deduped_pay[key] = (sn, ym, customer)
    deduped_list = list(deduped_pay.values())

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                execute_values(cur, """
                    INSERT INTO payments (sn, year_month, customer)
                    VALUES %s
                    ON CONFLICT (sn, year_month) DO UPDATE SET
                        customer = CASE
                            WHEN EXCLUDED.customer <> '' THEN EXCLUDED.customer
                            ELSE payments.customer
                        END
                """, deduped_list)
    except Exception as e:
        raise HTTPException(500, f"Błąd zapisu do bazy: {e}")

    months = sorted({r[1] for r in deduped_list})
    fmt = "IDS" if invoice_date_col else ("pivot" if month_cols else "monthly")
    return {
        "inserted": len(deduped_list),
        "months":   months,
        "format":   fmt,
        "duplicates_merged": len(records) - len(deduped_list),
        "_debug": {
            "invoice_date_col": invoice_date_col,
            "qty_col":          qty_col if invoice_date_col else None,
            "cat_col":          cat_col if invoice_date_col else None,
            "raw_records":      len(records),
            "columns_detected": list(df.columns[:20]),
        }
    }


@app.delete("/import/production")
def clear_production():
    """Remove all devices from the DB (use with caution)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM devices")
            deleted = cur.rowcount
    return {"deleted": deleted}


@app.delete("/import/payments")
def clear_payments(year_month: Optional[str] = None):
    """Remove payments — optionally only for a specific month."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            if year_month:
                cur.execute("DELETE FROM payments WHERE year_month = %s", (year_month,))
            else:
                cur.execute("DELETE FROM payments")
            deleted = cur.rowcount
    return {"deleted": deleted, "year_month": year_month}


@app.get("/analyze")
def analyze(
    status:      Optional[str] = None,
    customer:    Optional[str] = None,
    operator:    Optional[str] = None,
    rep:         Optional[str] = None,
    device_type: Optional[str] = None,
    date_from:   Optional[str] = None,
    date_to:     Optional[str] = None,
):
    """Return the full joined result from the DB, with optional filters."""
    try:
        rows = get_analysis(status, customer, operator, rep, date_from, date_to, device_type)
    except Exception as e:
        raise HTTPException(503, f"Błąd bazy danych: {e}")

    paid        = sum(1 for r in rows if r["status"] == "paid")
    unpaid      = sum(1 for r in rows if r["status"] == "unpaid")
    only        = sum(1 for r in rows if r["status"] == "only")
    excluded    = sum(1 for r in rows if r["status"] == "excluded")
    oem         = sum(1 for r in rows if r["status"] == "oem")
    master_paid = sum(1 for r in rows if r["status"] == "paid" and r["device_type"] == "master")

    return {
        "results": rows,
        "summary": {
            "total":       len(rows),
            "paid":        paid,
            "unpaid":      unpaid,
            "only":        only,
            "excluded":    excluded,
            "oem":         oem,
            "noBill":      oem + excluded,
            "masterPaid":  master_paid,
            "pct":         round(master_paid / (master_paid + unpaid) * 100) if (master_paid + unpaid) > 0 else 0,
        },
    }


# ── exclusions ────────────────────────────────────────────────────────────────

class ExclusionIn(BaseModel):
    firma: str
    reason: str = ""


@app.get("/exclusions")
def list_exclusions():
    try:
        return get_excluded_firms()
    except Exception as e:
        raise HTTPException(503, str(e))


@app.post("/exclusions")
def create_exclusion(body: ExclusionIn):
    try:
        add_excluded_firm(body.firma, body.reason)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.delete("/exclusions")
def delete_exclusion(firma: str):
    try:
        remove_excluded_firm(firma)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))


# ── sales reps ────────────────────────────────────────────────────────────────

class FirmAssign(BaseModel):
    firma: str


@app.get("/reps")
def list_reps():
    try:
        return get_reps()
    except Exception as e:
        raise HTTPException(503, str(e))


@app.get("/reps/firms")
def list_all_firms_for_reps():
    try:
        return {"firms": get_all_firms()}
    except Exception as e:
        raise HTTPException(503, str(e))


@app.post("/reps/{rep_id}/firms")
def add_firm_to_rep(rep_id: int, body: FirmAssign):
    try:
        assign_firm_to_rep(rep_id, body.firma)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.delete("/reps/{rep_id}/firms")
def remove_firm_from_rep_endpoint(rep_id: int, firma: str):
    try:
        remove_firm_from_rep(rep_id, firma)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))


# ── device type overrides ─────────────────────────────────────────────────────

class DeviceTypeIn(BaseModel):
    device_type: str            # 'master', 'oem', 'showroom', or '' (reset)
    showroom_until: Optional[str] = ""   # YYYY-MM, only used when device_type='showroom'


@app.patch("/devices/{sn}/type")
def override_device_type(sn: str, body: DeviceTypeIn):
    if body.device_type not in ("", "master", "oem", "showroom"):
        raise HTTPException(400, "device_type must be 'master', 'oem', 'showroom', or '' (reset)")
    if body.device_type == "showroom" and not body.showroom_until:
        raise HTTPException(400, "showroom_until (YYYY-MM) is required for showroom type")
    try:
        set_device_type_override(sn, body.device_type, body.showroom_until or "")
        return {"ok": True, "sn": sn, "device_type": body.device_type,
                "showroom_until": body.showroom_until}
    except Exception as e:
        raise HTTPException(500, str(e))


class CommentIn(BaseModel):
    comment: str = ""


@app.patch("/devices/{sn}/comment")
def update_device_comment(sn: str, body: CommentIn):
    """Set or clear the free-text comment on a device."""
    try:
        set_device_comment(sn, body.comment)
        return {"ok": True, "sn": sn}
    except Exception as e:
        raise HTTPException(500, str(e))


class BulkTypeIn(BaseModel):
    sns:           List[str]
    device_type:   str            # 'master', 'oem', or '' (reset)
    showroom_until: Optional[str] = ""


@app.post("/devices/bulk-type")
def bulk_override_type(body: BulkTypeIn):
    """Change device_type_override for multiple SNs at once."""
    if body.device_type not in ("", "master", "oem"):
        raise HTTPException(400, "Bulk type must be 'master', 'oem', or '' (reset)")
    if not body.sns:
        raise HTTPException(400, "No SNs provided")
    try:
        count = bulk_set_device_type(body.sns, body.device_type)
        return {"ok": True, "updated": count}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/devices/overrides")
def list_overrides():
    try:
        return get_type_overrides()
    except Exception as e:
        raise HTTPException(503, str(e))


@app.get("/payments/{sn}")
def payments_for_sn(sn: str):
    """Return all payment records for a single device (for history expand)."""
    try:
        return get_payments_for_sn(sn)
    except Exception as e:
        raise HTTPException(503, str(e))


@app.get("/health")
def health():
    return {"status": "ok"}