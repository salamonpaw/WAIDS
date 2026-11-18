# ── WAIDS — Segmentacja klientów A–D (wolumen JP / jednostki produkcyjne) ──
#
# Etap 1: model danych + silnik liczący + dane dla tabeli klientów.
# Etap 2 (później): zrzuty miesięczne (seg_snapshots), macierz migracji, trend,
# karta klienta, wykresy.
# Etap 3 (później): panel admina do zarządzania seg_models / seg_thresholds
# (CRUD poniżej już gotowe, brakuje tylko frontendu).
#
# "Realizacja" (kto/kiedy/jaki model/ile sztuk) NIE ma osobnej tabeli — korzysta
# wprost z `devices` (sn = jedna pozycja, firma = klient, maszyna = model,
# prod_date = data realizacji, ilość zawsze 1 bo sn jest unikalny).
#
# ⚠️ Brakujące pola źródłowe (decyzja z 18.11.2026 — start bez nich):
#   - id_dokumentu  → "Liczba zamówień" nie jest liczona w etapie 1.
#   - projekt_oemw  → nic nie jest wykluczane z segmentacji; cały wolumen liczy się
#                      do JP, dopóki nie wskażesz źródła tej flagi.

import re
from datetime import date
from typing import Optional

import psycopg2.extras

from database import get_conn

# ── Słownik modeli — dane startowe (spec rozdz. 1.2) ────────────────────────
# (kod_modelu, aliasy, nazwa_cennikowa, jp_na_szt, typ)
SEED_MODELS = [
    ("D1080 NEO",     ["D1080NEO"],      "D1080 NEO",  1.00, "wlasne"),
    ("D1080M",        [],                "D1080M",     1.00, "wlasne"),
    ("D810 NEO",      [],                "D810NEO M",  0.85, "wlasne"),
    ("D810M",         [],                "D810M",      0.80, "wlasne"),
    ("D540 NEO",      [],                "D540NEO M",  0.80, "wlasne"),
    ("L40 M",         [],                "L40M",       0.30, "wlasne"),
    ("T15",           [],                "T15",        0.30, "wlasne"),
    ("D1080 NEO OEM", [],                "D1080 NEO",  1.00, "oem"),
    ("D1080OEM",      [],                "D1080S",     1.00, "oem"),
    ("D810 OEM NEO",  ["D810 NEO OEM"],  "D810NEO S",  0.85, "oem"),
    ("D810OEM",       [],                "D810S",      0.80, "oem"),
    ("L40 OEM",       [],                "L40S",       0.30, "oem"),
    ("L40 OEM DE",    [],                "L40S",       0.30, "oem"),
    ("C240",          [],                "C240",       0.35, "oem"),
    ("L20",           [],                "L20",        0.30, "oem"),
]

# Spec rozdz. 1.3 — wartości startowe, w pełni konfigurowalne (seg_thresholds
# jest wersjonowana; to tylko wiersz zasiewający wersję 1).
SEED_THRESHOLDS = dict(
    prog_a=30, prog_b=8, prog_c=3,
    prog_profil_oem=50, prog_na_granicy=25, prog_trend=10,
    min_miesiecy_okresu=3,
)

VALID_MODEL_TYPES = {"wlasne", "oem"}


def seed_segmentation_defaults() -> None:
    """Idempotentne — wstawia dane startowe tylko gdy tabele są puste."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM seg_models")
            if cur.fetchone()[0] == 0:
                for kod, aliasy, nazwa, jp, typ in SEED_MODELS:
                    cur.execute(
                        "INSERT INTO seg_models (kod_modelu, aliasy, nazwa_cennikowa, jp_na_szt, typ)"
                        " VALUES (%s, %s, %s, %s, %s)",
                        (kod, aliasy, nazwa, jp, typ),
                    )
            cur.execute("SELECT COUNT(*) FROM seg_thresholds")
            if cur.fetchone()[0] == 0:
                cur.execute(
                    "INSERT INTO seg_thresholds (prog_a, prog_b, prog_c, prog_profil_oem,"
                    " prog_na_granicy, prog_trend, min_miesiecy_okresu)"
                    " VALUES (%(prog_a)s, %(prog_b)s, %(prog_c)s, %(prog_profil_oem)s,"
                    " %(prog_na_granicy)s, %(prog_trend)s, %(min_miesiecy_okresu)s)",
                    SEED_THRESHOLDS,
                )


# ── Słownik modeli — CRUD (backend gotowy na etap 3 — panel admina) ────────

def get_seg_models() -> list:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM seg_models ORDER BY kod_modelu, wazny_od")
            return [dict(r) for r in cur.fetchall()]


def add_seg_model(kod_modelu: str, aliasy: list, nazwa_cennikowa: str,
                   jp_na_szt: float, typ: str, wazny_od: str = "2000-01-01") -> int:
    if typ not in VALID_MODEL_TYPES:
        raise ValueError(f"typ musi być jednym z: {', '.join(VALID_MODEL_TYPES)}")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO seg_models (kod_modelu, aliasy, nazwa_cennikowa, jp_na_szt, typ, wazny_od)"
                " VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                (kod_modelu.strip(), aliasy or [], nazwa_cennikowa.strip(), jp_na_szt, typ, wazny_od),
            )
            return cur.fetchone()[0]


def update_seg_model(model_id: int, **fields) -> None:
    allowed = {"kod_modelu", "aliasy", "nazwa_cennikowa", "jp_na_szt", "typ", "wazny_od", "wazny_do"}
    sets = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if "typ" in sets and sets["typ"] not in VALID_MODEL_TYPES:
        raise ValueError(f"typ musi być jednym z: {', '.join(VALID_MODEL_TYPES)}")
    if not sets:
        return
    cols = ", ".join(f"{k} = %s" for k in sets)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE seg_models SET {cols} WHERE id = %s", (*sets.values(), model_id))


def delete_seg_model(model_id: int) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM seg_models WHERE id = %s", (model_id,))


# ── Progi — wersjonowane, CRUD (backend gotowy na etap 3) ──────────────────

def get_seg_thresholds(wersja: Optional[int] = None) -> dict:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if wersja:
                cur.execute("SELECT * FROM seg_thresholds WHERE wersja = %s", (wersja,))
            else:
                cur.execute("SELECT * FROM seg_thresholds ORDER BY wersja DESC LIMIT 1")
            row = cur.fetchone()
            if not row:
                raise ValueError("Brak skonfigurowanych progów segmentacji — uruchom seed_segmentation_defaults()")
            return dict(row)


def get_seg_thresholds_history() -> list:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM seg_thresholds ORDER BY wersja DESC")
            return [dict(r) for r in cur.fetchall()]


def add_seg_threshold_version(prog_a: float, prog_b: float, prog_c: float,
                               prog_profil_oem: float, prog_na_granicy: float,
                               prog_trend: float, min_miesiecy_okresu: int,
                               wazny_od: str) -> int:
    """Nowa wersja progów NIE nadpisuje poprzedniej — historyczne seg_snapshots
    zostają przypisane do starej wersji (spec rozdz. 4.1 pkt 3)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO seg_thresholds (prog_a, prog_b, prog_c, prog_profil_oem,"
                " prog_na_granicy, prog_trend, min_miesiecy_okresu, wazny_od)"
                " VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING wersja",
                (prog_a, prog_b, prog_c, prog_profil_oem, prog_na_granicy,
                 prog_trend, min_miesiecy_okresu, wazny_od),
            )
            return cur.fetchone()[0]


# ── Dopasowanie modelu po tekście z devices.maszyna ─────────────────────────

_WS_RE = re.compile(r"\s+")


def _norm_model(s: str) -> str:
    return _WS_RE.sub(" ", str(s or "").strip().upper())


def _build_model_index(models: list) -> dict:
    idx: dict = {}
    for m in models:
        keys = {m["kod_modelu"]} | set(m.get("aliasy") or [])
        for k in keys:
            idx.setdefault(_norm_model(k), []).append(m)
    return idx


def _match_model(maszyna: str, data_realizacji: str, index: dict):
    """Zwraca wiersz słownika ważny w dniu realizacji, albo None (niezmapowany)."""
    cands = index.get(_norm_model(maszyna))
    if not cands:
        return None
    for m in cands:
        if m["wazny_od"] <= data_realizacji and (not m["wazny_do"] or data_realizacji <= m["wazny_do"]):
            return m
    return None  # kod rozpoznany, ale żadna wersja słownika nie obowiązywała w tej dacie


# ── Silnik liczący — tabela klientów dla wybranego okresu (spec rozdz. 2, krok 1-6) ─

def compute_customer_segments(
    od: str, do: str,
    model_filter: Optional[list] = None,
    typ_filter: Optional[str] = None,          # 'wlasne' | 'oem' | None (oba)
    wersja_progow: Optional[int] = None,
) -> dict:
    """
    Segment i wskaźniki klienta dla okresu [od, do] (YYYY-MM-DD, oba włącznie).

    Segment ZAWSZE liczony z pełnego wolumenu klienta (wszystkie modele, własne
    i OEM) — model_filter/typ_filter zmieniają tylko wyświetlane sztuki/JP
    (jp_okres_filtr/sztuki_filtr), nigdy segment ani "do wyższego segmentu"
    (spec rozdz. 2 intro i rozdz. 6 "zasady działania filtrów").
    """
    progi = get_seg_thresholds(wersja_progow)
    models = get_seg_models()
    index = _build_model_index(models)

    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT sn, firma, maszyna, prod_date
                FROM devices
                WHERE firma <> '' AND prod_date BETWEEN %s AND %s
            """, (od, do))
            rows = [dict(r) for r in cur.fetchall()]

    unmapped: dict = {}
    full: dict = {}   # firma -> pełny wolumen (podstawa segmentu)
    filt: dict = {}   # firma -> wolumen po filtrze model/typ (tylko do wyświetlenia)
    has_filter = bool(model_filter) or bool(typ_filter)

    for r in rows:
        m = _match_model(r["maszyna"], r["prod_date"], index)
        if not m:
            unmapped[r["maszyna"]] = unmapped.get(r["maszyna"], 0) + 1
            continue

        firma = r["firma"]
        jp = float(m["jp_na_szt"])
        is_oem = m["typ"] == "oem"

        f = full.setdefault(firma, {"jp": 0.0, "jp_oem": 0.0, "sztuki": 0, "modele": set()})
        f["jp"] += jp
        if is_oem:
            f["jp_oem"] += jp
        f["sztuki"] += 1
        f["modele"].add(m["kod_modelu"])

        if has_filter:
            if model_filter and m["kod_modelu"] not in model_filter:
                continue
            if typ_filter and m["typ"] != typ_filter:
                continue
            d = filt.setdefault(firma, {"jp": 0.0, "sztuki": 0})
            d["jp"] += jp
            d["sztuki"] += 1

    # Krok 3: liczba miesięcy okresu
    d_od, d_do = date.fromisoformat(od), date.fromisoformat(do)
    dni = (d_do - d_od).days + 1
    M = dni / 30.4375
    okres_za_krotki = M < float(progi["min_miesiecy_okresu"])

    total_jp = sum(f["jp"] for f in full.values()) or 0.0
    next_threshold_key = {"B": "prog_a", "C": "prog_b", "D": "prog_c"}

    def _segment(jp12: float) -> str:
        if jp12 <= 0:
            return "brak"
        if jp12 >= float(progi["prog_a"]):
            return "A"
        if jp12 >= float(progi["prog_b"]):
            return "B"
        if jp12 >= float(progi["prog_c"]):
            return "C"
        return "D"

    customers = []
    for firma, f in full.items():
        jp12 = f["jp"] * 12 / M if M > 0 else 0.0
        segment = _segment(jp12)
        udzial_oem = (f["jp_oem"] / f["jp"]) if f["jp"] > 0 else 0.0
        profil_oem = udzial_oem >= float(progi["prog_profil_oem"]) / 100

        do_wyzszego = None
        na_granicy = False
        if segment in next_threshold_key:
            prog_wyzszy = float(progi[next_threshold_key[segment]])
            do_wyzszego = round(prog_wyzszy - jp12, 2)
            na_granicy = do_wyzszego <= (float(progi["prog_na_granicy"]) / 100) * prog_wyzszy

        disp = filt.get(firma, {"jp": 0.0, "sztuki": 0}) if has_filter \
            else {"jp": f["jp"], "sztuki": f["sztuki"]}

        customers.append({
            "firma": firma,
            "segment": segment,
            "jp_okres": round(f["jp"], 2),
            "jp12": round(jp12, 2),
            "jp_miesiecznie": round(jp12 / 12, 2),
            "jp_oem": round(f["jp_oem"], 2),
            "udzial_oem": round(udzial_oem * 100, 1),
            "profil_oem": profil_oem,
            "sztuki": f["sztuki"],
            "liczba_modeli": len(f["modele"]),
            "do_wyzszego_segmentu": do_wyzszego,
            "na_granicy": na_granicy,
            "udzial_w_jp": round((f["jp"] / total_jp) * 100, 1) if total_jp else 0.0,
            # kolumny do wyświetlenia pod filtrem model/typ — segment powyżej z tego NIE korzysta
            "jp_okres_filtr": round(disp["jp"], 2),
            "sztuki_filtr": disp["sztuki"],
        })

    customers.sort(key=lambda c: c["jp_okres"], reverse=True)
    running = 0.0
    for c in customers:
        running += c["jp_okres"]
        c["udzial_narastajaco"] = round((running / total_jp) * 100, 1) if total_jp else 0.0

    unmapped_list = sorted(
        ({"maszyna": k, "sztuki": v} for k, v in unmapped.items()),
        key=lambda x: -x["sztuki"],
    )

    seg_counts: dict = {}
    for c in customers:
        seg_counts.setdefault(c["segment"], {"klienci": 0, "jp": 0.0})
        seg_counts[c["segment"]]["klienci"] += 1
        seg_counts[c["segment"]]["jp"] += c["jp_okres"]
    for s in seg_counts.values():
        s["jp"] = round(s["jp"], 2)

    return {
        "customers": customers,
        "unmapped_models": unmapped_list,
        "okres_miesiecy": round(M, 1),
        "okres_za_krotki": okres_za_krotki,
        "min_miesiecy_okresu": progi["min_miesiecy_okresu"],
        "wersja_progow": progi["wersja"],
        "progi": {k: (float(v) if isinstance(v, (int, float)) else v)
                  for k, v in progi.items() if k != "created_at"},
        "total_jp": round(total_jp, 2),
        "total_customers": len(customers),
        "segment_counts": seg_counts,
    }
