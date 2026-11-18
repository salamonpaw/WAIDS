# ── WAIDS — Segmentacja klientów A–D (wolumen JP / jednostki produkcyjne) ──
#
# Etap 1 (gotowe): model danych + silnik liczący + dane dla tabeli klientów.
# Etap 2 (gotowe): zrzuty miesięczne (seg_snapshots), backfill, macierz migracji,
# trend r/r, dane do karty klienta (JP miesięcznie, historia segmentu, miks modeli,
# lista pozycji), agregaty do wykresów dashboardu.
# Etap 3 (później): panel admina do zarządzania seg_models / seg_thresholds
# (CRUD poniżej już gotowe, brakuje tylko frontendu).
#
# "Realizacja" (kto/kiedy/jaki model/ile sztuk) NIE ma osobnej tabeli — korzysta
# wprost z `devices` (sn = jedna pozycja, firma = klient, maszyna = model,
# prod_date = data realizacji, ilość zawsze 1 bo sn jest unikalny).
#
# ⚠️ Brakujące pola źródłowe (decyzja z 18.11.2026 — start bez nich; do rewizji,
# jeśli numer zamówienia faktycznie da się wyciągnąć z pliku importu produkcji):
#   - id_dokumentu  → "Liczba zamówień" nie jest liczona.
#   - projekt_oemw  → nic nie jest wykluczane z segmentacji; cały wolumen liczy się
#                      do JP, dopóki nie wskażesz źródła tej flagi.

import re
from datetime import date, timedelta
from typing import Optional

import psycopg2.extras
from psycopg2.extras import execute_values

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


# ── Porównanie okresów — trend r/r i kierunek migracji per klient (rozdz. 4.2-4.3) ─

_SEG_RANK = {"A": 4, "B": 3, "C": 2, "D": 1, "brak": 0}


def _migration_direction(seg0: str, seg1: str) -> str:
    r0, r1 = _SEG_RANK[seg0], _SEG_RANK[seg1]
    if r0 == 0 and r1 > 0:
        return "nowy"
    if r0 > 0 and r1 == 0:
        return "utracony"
    if r1 > r0:
        return "awans"
    if r1 < r0:
        return "spadek"
    return "bez_zmian"


def _resolve_comparison_period(od: str, do: str, cmp_mode: str) -> Optional[tuple]:
    """cmp_mode: 'prev_period' | 'prev_year' -> (od0, do0); None gdy brak/nieznany tryb."""
    d_od, d_do = date.fromisoformat(od), date.fromisoformat(do)
    if cmp_mode == "prev_year":
        try:
            od0 = d_od.replace(year=d_od.year - 1)
        except ValueError:          # 29 lutego
            od0 = d_od.replace(year=d_od.year - 1, day=28)
        try:
            do0 = d_do.replace(year=d_do.year - 1)
        except ValueError:
            do0 = d_do.replace(year=d_do.year - 1, day=28)
        return od0.isoformat(), do0.isoformat()
    if cmp_mode == "prev_period":
        dni = (d_do - d_od).days + 1
        do0 = d_od - timedelta(days=1)
        od0 = do0 - timedelta(days=dni - 1)
        return od0.isoformat(), do0.isoformat()
    return None


def compute_customer_segments_with_trend(
    od: str, do: str,
    model_filter: Optional[list] = None,
    typ_filter: Optional[str] = None,
    wersja_progow: Optional[int] = None,
    cmp_mode: str = "",                     # '' | 'prev_period' | 'prev_year'
) -> dict:
    """Jak compute_customer_segments, plus (gdy cmp_mode ustawiony) per klient:
    segment_p0, kierunek_migracji, trend, zmiana_rr — spec rozdz. 4.2-4.3.
    P0 liczony zawsze z pełnego wolumenu (bez model_filter/typ_filter), tak jak P1."""
    result = compute_customer_segments(od, do, model_filter, typ_filter, wersja_progow)
    if not cmp_mode:
        return result

    cmp_period = _resolve_comparison_period(od, do, cmp_mode)
    if not cmp_period:
        return result
    od0, do0 = cmp_period
    r0 = compute_customer_segments(od0, do0, wersja_progow=wersja_progow)
    m0 = {c["firma"]: c for c in r0["customers"]}
    prog_trend = float(result["progi"]["prog_trend"]) / 100

    for c in result["customers"]:
        c0 = m0.get(c["firma"])
        jp12_p0 = c0["jp12"] if c0 else 0.0
        seg0 = c0["segment"] if c0 else "brak"
        c["segment_p0"] = seg0
        c["kierunek_migracji"] = _migration_direction(seg0, c["segment"])
        if jp12_p0 <= 0:
            c["trend"] = "nowy"
            c["zmiana_rr"] = None
        else:
            zmiana = c["jp12"] / jp12_p0 - 1
            c["zmiana_rr"] = round(zmiana * 100, 1)
            c["trend"] = ("wzrost" if zmiana > prog_trend
                          else "spadek" if zmiana < -prog_trend
                          else "stabilny")

    result["okres_porownawczy"] = {"od": od0, "do": do0, "miesiecy": r0["okres_miesiecy"]}
    return result


def compute_migration(od0: str, do0: str, od1: str, do1: str,
                       wersja_progow: Optional[int] = None) -> dict:
    """Macierz migracji P0 (okres bazowy) → P1 (okres porównywany) — spec rozdz. 4.2."""
    r0 = compute_customer_segments(od0, do0, wersja_progow=wersja_progow)
    r1 = compute_customer_segments(od1, do1, wersja_progow=wersja_progow)
    m0 = {c["firma"]: c for c in r0["customers"]}
    m1 = {c["firma"]: c for c in r1["customers"]}
    firmy = set(m0) | set(m1)

    customers = []
    matrix: dict = {}
    summary = {"awans": 0, "spadek": 0, "bez_zmian": 0, "nowy": 0, "utracony": 0}

    for firma in firmy:
        c0, c1 = m0.get(firma), m1.get(firma)
        seg0 = c0["segment"] if c0 else "brak"
        seg1 = c1["segment"] if c1 else "brak"
        kierunek = _migration_direction(seg0, seg1)
        summary[kierunek] += 1

        cell = matrix.setdefault((seg0, seg1), {"klienci": 0, "jp": 0.0})
        cell["klienci"] += 1
        cell["jp"] += c1["jp_okres"] if c1 else 0.0

        customers.append({
            "firma": firma, "segment_p0": seg0, "segment_p1": seg1, "kierunek": kierunek,
            "jp_p0": c0["jp_okres"] if c0 else 0.0, "jp_p1": c1["jp_okres"] if c1 else 0.0,
            "jp12_p0": c0["jp12"] if c0 else 0.0,   "jp12_p1": c1["jp12"] if c1 else 0.0,
        })

    matrix_list = [
        {"segment_p0": s0, "segment_p1": s1, "klienci": v["klienci"], "jp": round(v["jp"], 2)}
        for (s0, s1), v in matrix.items()
    ]

    return {
        "okres_p0": {"od": od0, "do": do0, "miesiecy": r0["okres_miesiecy"]},
        "okres_p1": {"od": od1, "do": do1, "miesiecy": r1["okres_miesiecy"]},
        "matrix": matrix_list,
        "summary": summary,
        "customers": customers,
    }


def get_segments_by_year(years: list, wersja_progow: Optional[int] = None) -> dict:
    """Segment klienta per rok kalendarzowy (tryb 'Rok kalendarzowy', spec rozdz. 4) —
    do kolumn 'Segmenty w latach' w tabeli klientów. Rok bieżący liczony do końca
    ostatniego zamkniętego miesiąca (pelny_rok=False → frontend dodaje gwiazdkę)."""
    today = date.today()
    last_closed = date(today.year, today.month, 1) - timedelta(days=1)
    out: dict = {}
    for y in years:
        y = int(y)
        od = f"{y}-01-01"
        if y == today.year:
            do, pelny = last_closed.isoformat(), False
        else:
            do, pelny = f"{y}-12-31", True
        r = compute_customer_segments(od, do, wersja_progow=wersja_progow)
        out[str(y)] = {
            "pelny_rok": pelny,
            "segmenty": {c["firma"]: c["segment"] for c in r["customers"]},
        }
    return out


# ── Zrzuty miesięczne — kroczące 12 mies. (spec rozdz. 4.1) ────────────────

def _month_end(ym: str) -> str:
    """'YYYY-MM' -> ostatni dzień tego miesiąca, 'YYYY-MM-DD'."""
    y, m = int(ym[:4]), int(ym[5:7])
    nxt = date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)
    return (nxt - timedelta(days=1)).isoformat()


def _rolling_12_window(ym: str) -> tuple:
    """Dla zamykanego miesiąca 'YYYY-MM' zwraca (od, do) okna kroczącego 12 mies.
    kończącego się na ostatnim dniu tego miesiąca."""
    do = _month_end(ym)
    y, m = int(ym[:4]), int(ym[5:7])
    start_m, start_y = m - 11, y
    while start_m <= 0:
        start_m += 12
        start_y -= 1
    return f"{start_y}-{start_m:02d}-01", do


def generate_snapshot_for_month(ym: str, wersja_progow: Optional[int] = None) -> dict:
    """Liczy i zapisuje zrzut (kroczące 12 mies. kończące się na ostatnim dniu `ym`)
    dla wszystkich klientów. Idempotentne — ON CONFLICT nadpisuje wiersz dla tej samej
    (firma, data_zrzutu, wersja_progow), więc bezpiecznie uruchamiać ponownie."""
    od, do = _rolling_12_window(ym)
    result = compute_customer_segments(od, do, wersja_progow=wersja_progow)
    wersja = result["wersja_progow"]

    rows = []
    for c in result["customers"]:
        flagi = {
            "profil_oem": c["profil_oem"], "na_granicy": c["na_granicy"],
            "udzial_oem": c["udzial_oem"], "do_wyzszego_segmentu": c["do_wyzszego_segmentu"],
        }
        rows.append((c["firma"], do, wersja, c["jp_okres"], c["jp12"], c["jp_oem"],
                     c["sztuki"], c["liczba_modeli"], c["segment"], psycopg2.extras.Json(flagi)))

    with get_conn() as conn:
        with conn.cursor() as cur:
            if rows:
                execute_values(cur, """
                    INSERT INTO seg_snapshots
                        (firma, data_zrzutu, wersja_progow, jp_okres, jp12, jp_oem,
                         sztuki, liczba_modeli, segment, flagi)
                    VALUES %s
                    ON CONFLICT (firma, data_zrzutu, wersja_progow) DO UPDATE SET
                        jp_okres = EXCLUDED.jp_okres, jp12 = EXCLUDED.jp12,
                        jp_oem = EXCLUDED.jp_oem, sztuki = EXCLUDED.sztuki,
                        liczba_modeli = EXCLUDED.liczba_modeli,
                        segment = EXCLUDED.segment, flagi = EXCLUDED.flagi
                """, rows, template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)")

    return {"data_zrzutu": do, "wersja_progow": wersja, "klientow": len(rows),
            "okres_od": od, "okres_do": do}


def backfill_snapshots(from_ym: str, to_ym: Optional[str] = None,
                        wersja_progow: Optional[int] = None) -> dict:
    """Generuje zrzuty dla każdego miesiąca od `from_ym` do `to_ym` (domyślnie: ostatni
    zamknięty miesiąc) — spec rozdz. 4.1 pkt 4, uruchamiane ręcznie przez admina."""
    if not to_ym:
        today = date.today()
        to_ym = (date(today.year, today.month, 1) - timedelta(days=1)).strftime("%Y-%m")

    y, m = int(from_ym[:4]), int(from_ym[5:7])
    ty, tm = int(to_ym[:4]), int(to_ym[5:7])
    details = []
    while (y, m) <= (ty, tm):
        details.append(generate_snapshot_for_month(f"{y:04d}-{m:02d}", wersja_progow))
        m += 1
        if m > 12:
            m = 1
            y += 1
    return {"from": from_ym, "to": to_ym, "months": len(details), "details": details}


def get_segments_overview(months: int = 24, wersja_progow: Optional[int] = None) -> list:
    """Agregat miesięczny po segmentach z seg_snapshots — do wykresów dashboardu
    'JP w czasie wg segmentów' i 'liczba klientów w segmentach w czasie' (rozdz. 7.1,
    bloki 3-4). Wymaga wcześniejszego backfill_snapshots()."""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if wersja_progow:
                cur.execute("""
                    SELECT data_zrzutu, segment, COUNT(*) AS klienci,
                           COALESCE(SUM(jp12), 0) AS jp12
                    FROM seg_snapshots WHERE wersja_progow = %s
                    GROUP BY data_zrzutu, segment ORDER BY data_zrzutu
                """, (wersja_progow,))
            else:
                cur.execute("""
                    SELECT data_zrzutu, segment, COUNT(*) AS klienci,
                           COALESCE(SUM(jp12), 0) AS jp12
                    FROM seg_snapshots
                    GROUP BY data_zrzutu, segment ORDER BY data_zrzutu
                """)
            rows = [dict(r) for r in cur.fetchall()]

    keep = set(sorted({r["data_zrzutu"] for r in rows})[-months:])
    rows = [r for r in rows if r["data_zrzutu"] in keep]
    for r in rows:
        r["jp12"] = round(float(r["jp12"]), 2)
    return rows


# ── Karta klienta (spec rozdz. 7.3) ─────────────────────────────────────────

def get_customer_monthly_jp(firma: str, months: int = 24) -> list:
    """JP wyprodukowane W DANYM miesiącu (nie kroczące) — do wykresu słupkowego na
    karcie klienta. Ostatnie `months` zamkniętych miesięcy, zera dla pustych."""
    today = date.today()
    last_closed = date(today.year, today.month, 1) - timedelta(days=1)
    end_y, end_m = last_closed.year, last_closed.month
    start_m, start_y = end_m - (months - 1), end_y
    while start_m <= 0:
        start_m += 12
        start_y -= 1
    od = f"{start_y}-{start_m:02d}-01"
    do = last_closed.isoformat()

    index = _build_model_index(get_seg_models())
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT maszyna, prod_date FROM devices
                WHERE firma = %s AND prod_date BETWEEN %s AND %s
            """, (firma, od, do))
            rows = [dict(r) for r in cur.fetchall()]

    buckets: dict = {}
    for r in rows:
        m = _match_model(r["maszyna"], r["prod_date"], index)
        if not m:
            continue
        b = buckets.setdefault(r["prod_date"][:7], {"jp": 0.0, "sztuki": 0})
        b["jp"] += float(m["jp_na_szt"])
        b["sztuki"] += 1

    out = []
    y, m = start_y, start_m
    while (y, m) <= (end_y, end_m):
        ym = f"{y:04d}-{m:02d}"
        b = buckets.get(ym, {"jp": 0.0, "sztuki": 0})
        out.append({"month": ym, "jp": round(b["jp"], 2), "sztuki": b["sztuki"]})
        m += 1
        if m > 12:
            m = 1
            y += 1
    return out


def get_customer_snapshot_history(firma: str, months: int = 24,
                                   wersja_progow: Optional[int] = None) -> list:
    """Historia zrzutów kroczących 12 mies. jednego klienta — pasek segmentów + linia
    JP12 na karcie klienta. Pusta lista dopóki nie uruchomiono backfill_snapshots()."""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if wersja_progow:
                cur.execute("""
                    SELECT data_zrzutu, jp_okres, jp12, segment, flagi FROM seg_snapshots
                    WHERE firma = %s AND wersja_progow = %s
                    ORDER BY data_zrzutu DESC LIMIT %s
                """, (firma, wersja_progow, months))
            else:
                cur.execute("""
                    SELECT data_zrzutu, jp_okres, jp12, segment, flagi FROM seg_snapshots
                    WHERE firma = %s ORDER BY data_zrzutu DESC LIMIT %s
                """, (firma, months))
            rows = [dict(r) for r in cur.fetchall()]
    rows.reverse()
    return rows


def get_customer_model_mix(firma: str, od: str, do: str) -> list:
    """Miks modeli klienta w okresie — model, sztuki, JP, typ (spec rozdz. 7.3)."""
    index = _build_model_index(get_seg_models())
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT maszyna, prod_date FROM devices
                WHERE firma = %s AND prod_date BETWEEN %s AND %s
            """, (firma, od, do))
            rows = [dict(r) for r in cur.fetchall()]

    mix: dict = {}
    for r in rows:
        m = _match_model(r["maszyna"], r["prod_date"], index)
        if not m:
            continue
        e = mix.setdefault(m["kod_modelu"], {"sztuki": 0, "jp": 0.0, "typ": m["typ"]})
        e["sztuki"] += 1
        e["jp"] += float(m["jp_na_szt"])

    out = [{"model": k, **v} for k, v in mix.items()]
    out.sort(key=lambda x: -x["jp"])
    for o in out:
        o["jp"] = round(o["jp"], 2)
    return out


def get_customer_items(firma: str, od: str, do: str, limit: int = 500) -> list:
    """Lista pozycji realizacji klienta w okresie — data, SN, model, JP (spec rozdz. 7.3)."""
    index = _build_model_index(get_seg_models())
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT sn, maszyna, prod_date FROM devices
                WHERE firma = %s AND prod_date BETWEEN %s AND %s
                ORDER BY prod_date DESC LIMIT %s
            """, (firma, od, do, limit))
            rows = [dict(r) for r in cur.fetchall()]

    out = []
    for r in rows:
        m = _match_model(r["maszyna"], r["prod_date"], index)
        out.append({
            "data": r["prod_date"], "sn": r["sn"], "maszyna": r["maszyna"],
            "kod_modelu": m["kod_modelu"] if m else None,
            "jp": float(m["jp_na_szt"]) if m else None,
            "typ": m["typ"] if m else None,
        })
    return out
