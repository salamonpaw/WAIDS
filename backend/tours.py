# ── WAIDS — przewodnik po aplikacji: treść tur edytowalna w bazie ──────────
#
# Kroki tury dla każdej zakładki trzymane w tabeli tour_steps, nie na sztywno
# w js/tour.js — admin edytuje je w Konfiguracja → Przewodnik (wybór elementu
# na ekranie, tytuł, opis, kolejność) bez dotykania kodu.
#
# `selector` jest rozwiązywany PO STRONIE FRONTENDU wewnątrz #tab-<tab_name>
# (patrz js/tour.js _driverSteps) — tu trzymamy go jako zwykły string.

import psycopg2.extras

from database import get_conn

VALID_TAB_NAMES = {
    "import", "report", "monitor", "firstpay", "device", "revenue", "bonus",
    "commissions", "pricing", "segmentation", "arrears", "sales", "config",
}

# Seed — dokładna treść z pierwszej wersji js/tour.js (v2.9.0-2.10.0), żeby
# włączenie edytora niczego nie zmieniło na starcie.
SEED_TOURS = {
    "import": [
        (".section-title", "🏭 Import danych", "Tu zaczyna się wszystko — wgrywasz plik produkcji (numery seryjne, model, data) i plik płatności z ERP. Reszta aplikacji liczy się z tych dwóch źródeł."),
        ("#zoneP", "Plik produkcji", "Przeciągnij lub wybierz plik (xlsx/csv/ods) z listą wyprodukowanych urządzeń."),
        ("#btnProd", "Tryb importu", "„Dopisz” pomija już zaimportowane numery seryjne. „Nadpisz” aktualizuje istniejące rekordy nowymi danymi."),
        ("#zonePay", "Plik płatności", "Rozpoznaje automatycznie format IDS (surowy eksport z ERP), tabelę przestawną (kolumny = miesiące) albo prostą listę miesięczną."),
        ("#importHistoryArrow", "Historia importów", "Każdy wgrany plik można tu cofnąć (undo), jeśli coś poszło nie tak."),
    ],
    "report": [
        (".kpi-grid", "📊 Kluczowe liczby", "Ile urządzeń jest w bazie, ile ma opłacony abonament, a ile nie — licząc tylko urządzenia typu master."),
        ("#chartPie", "Status abonamentów", "Kliknij wycinek wykresu, żeby przefiltrować tabelę poniżej do tego statusu."),
        ("#fSearch", "Szukaj", "Szukaj po numerze seryjnym, nazwie firmy, modelu maszyny albo kliencie."),
        ("#filtersBar", "Filtry", "Status, typ firmy, typ urządzenia, handlowiec, zakres dat produkcji, zaległości — można łączyć dowolnie."),
    ],
    "monitor": [
        ("#monFirma", "📈 Monitoring nowych masterów", "Sprawdzasz tu, które nowo wyprodukowane mastery zaczęły płacić abonament i kiedy dokładnie."),
        ("#monProdFrom", "Data produkcji od", "Wybierz miesiąc produkcji i kliknij „Zastosuj” — zobaczysz urządzenia wyprodukowane od tej daty i status ich pierwszej płatności."),
        ("#monIdsOnly", "Tylko IDS", "Domyślnie liczone są tylko firmy z typem IDS (abonament cykliczny). Odhacz, żeby zobaczyć też Licencję, OEM i Inne."),
    ],
    "firstpay": [
        (".section-title", "🆕 Nowe płatności", "Kontrola, czy nowo wyprodukowane urządzenia dostały już pierwszą płatność abonamentu — i ile miesięcy to zajęło."),
        ("#fpMonthTo", "Zakres dat", "Zawęź do konkretnego okresu produkcji, jeśli interesuje Cię tylko któryś miesiąc."),
    ],
    "device": [
        ("#snSearchInput", "🔍 Wyszukiwarka urządzeń", "Wpisz numer seryjny (działa też bez wiodących zer) i wciśnij Enter albo „Szukaj”."),
        ("#snSearchResult", "Karta urządzenia", "Zobaczysz dane urządzenia i pełną historię płatności miesiąc po miesiącu."),
    ],
    "revenue": [
        ("#revKpiGrid", "💰 Wyliczenia — przychody", "Przychody netto w PLN, podzbiór w EUR, liczba płacących urządzeń i klientów — filtrowane rokiem z selektora w prawym górnym rogu."),
        ("#revCurrencySection", "Przychody wg waluty", "Pełny rozkład wszystkich przychodów (zawsze za wszystkie lata) wg waluty faktury — PLN, EUR, USD, GBP. To te same pieniądze co w kafelku PLN netto, tylko podzielone wg waluty, nie coś dodatkowego."),
        ("#chartRevTrend", "Trend miesięczny", "Kliknij słupek, żeby przefiltrować Top klientów do tego miesiąca."),
        ("#revTableSearch", "Tabela klientów", "Pełna lista klientów z przychodem, liczbą urządzeń i płatności — szukaj i sortuj klikając nagłówki."),
    ],
    "bonus": [
        (".section-title", "🆕 Pierwsze IDS", "Lista nowych urządzeń per handlowiec — do rozliczania bonusu za pierwsze podłączenie klienta do abonamentu IDS."),
    ],
    "commissions": [
        (".section-title", "💸 Prowizje", "Stawki prowizji dla handlowców i rozliczenia za wybrane okresy."),
        ("#commRatesTable", "Stawki prowizji", "Tu ustawiasz procent prowizji per handlowiec — zmiana obowiązuje od wskazanej daty."),
    ],
    "pricing": [
        (".section-title", "📈 Analiza pricingu IDS", "Klasyfikuje klientów wg ceny abonamentu, którą faktycznie płacą — do wykrywania zaniżonych stawek i planowania podwyżek."),
    ],
    "segmentation": [
        ("#segHeaderTitle", "🎯 Segmentacja klientów (A–D)", "Segment wynika z wolumenu zamówień w jednostkach produkcyjnych (JP), przeliczonego zawsze na 12 miesięcy: A ≥30 JP, B ≥8, C ≥3, D poniżej 3."),
        ("#segOd", "Okres", "Wybierz zakres dat albo użyj gotowego presetu (ostatnie 12 mies., bieżący/poprzedni rok, ostatni kwartał)."),
        ("#segCmp", "Okres porównawczy", "Ustaw „rok wcześniej” albo „poprzedni okres”, żeby zobaczyć kolumny Migracja i Zmiana r/r w tabeli oraz macierz migracji niżej."),
        ("#segYearPills", "Segmenty w latach", "Pilki wybierają, które lata pokazać jako osobne kolumny w tabeli — bieżący rok oznaczony gwiazdką, bo jest niepełny."),
        ("#segKpiGrid", "KPI per segment", "Liczba klientów i suma JP w każdym segmencie dla wybranego okresu."),
        ("#chartSegJpTime", "Wykresy w czasie", "Pokazują historię segmentów miesiąc po miesiącu — wymagają wcześniejszego wygenerowania zrzutów (panel admina niżej, sekcja „Zrzuty miesięczne”)."),
        ("#segMigrationSection", "Macierz migracji", "Wiersze = segment w okresie porównawczym, kolumny = segment teraz. Kliknij komórkę, żeby przefiltrować tabelę klientów do tej migracji."),
        ("#segCustomerTable", "Tabela klientów", "Kliknij dowolny wiersz, żeby otworzyć kartę klienta — historię segmentu, JP miesięcznie i miks modeli."),
        ("#segModelsPanel", "Słownik modeli (Admin)", "Tu dodajesz, edytujesz i usuwasz przelicznik JP dla każdego modelu maszyny. Model spoza słownika zgłasza czerwony alert nad tabelą klientów zamiast cicho zniknąć z wyliczeń."),
        ("#segThresholdsPanel", "Progi segmentacji (Admin)", "Zmiana progów A/B/C (i pozostałych) zapisuje się jako NOWA wersja — poprzednia zostaje w historii i nadal obowiązuje dla już zapisanych zrzutów miesięcznych, dopóki świadomie ich nie przeliczysz."),
    ],
    "arrears": [
        ("h2", "⚠ Zaległości abonamentowe", "Urządzenia, które od dłuższego czasu nie mają zarejestrowanej płatności — ustaw próg miesięcy, żeby zawęzić listę."),
        ("#arrRepFilter", "Filtr handlowca", "Zawęź listę zaległości do konkretnego opiekuna klienta."),
    ],
    "sales": [
        ("h2", "📦 Zakupy per klient", "Zestawienie wyprodukowanych maszyn per firma w wybranym zakresie dat — to raport produkcyjny, pokazuje WSZYSTKIE maszyny niezależnie od statusu abonamentu."),
    ],
    "config": [
        (".section-title", "⚙ Konfiguracja", "Zarządzanie użytkownikami i ich uprawnieniami (tylko administrator), typy firm, handlowcy, opłaty licencyjne."),
    ],
}


def seed_tour_steps() -> None:
    """Idempotentne — wstawia treść startową tylko gdy tabela jest pusta."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM tour_steps")
            if cur.fetchone()[0] != 0:
                return
            for tab_name, steps in SEED_TOURS.items():
                for i, (selector, title, description) in enumerate(steps):
                    cur.execute(
                        "INSERT INTO tour_steps (tab_name, position, selector, title, description)"
                        " VALUES (%s, %s, %s, %s, %s)",
                        (tab_name, i, selector, title, description),
                    )


def get_all_tours() -> dict:
    """{tab_name: [{id, selector, title, description}, ...]} — do tour.js (wszyscy użytkownicy)."""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT id, tab_name, selector, title, description"
                " FROM tour_steps ORDER BY tab_name, position"
            )
            rows = [dict(r) for r in cur.fetchall()]
    out: dict = {}
    for r in rows:
        out.setdefault(r["tab_name"], []).append(
            {"id": r["id"], "selector": r["selector"], "title": r["title"], "description": r["description"]}
        )
    return out


def add_tour_step(tab_name: str, selector: str, title: str, description: str) -> int:
    if tab_name not in VALID_TAB_NAMES:
        raise ValueError(f"Nieznana zakładka: {tab_name}")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM tour_steps WHERE tab_name = %s", (tab_name,))
            next_pos = cur.fetchone()[0]
            cur.execute(
                "INSERT INTO tour_steps (tab_name, position, selector, title, description)"
                " VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (tab_name, next_pos, selector.strip(), title.strip(), description.strip()),
            )
            return cur.fetchone()[0]


def update_tour_step(step_id: int, **fields) -> None:
    allowed = {"selector", "title", "description"}
    sets = {k: v.strip() if isinstance(v, str) else v for k, v in fields.items() if k in allowed and v is not None}
    if not sets:
        return
    set_parts = [f"{k} = %s" for k in sets] + ["updated_at = NOW()"]
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE tour_steps SET {', '.join(set_parts)} WHERE id = %s",
                        (*sets.values(), step_id))


def delete_tour_step(step_id: int) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM tour_steps WHERE id = %s", (step_id,))


def reorder_tour_steps(tab_name: str, ordered_ids: list) -> None:
    """ordered_ids = lista id kroków w nowej kolejności (muszą należeć do tab_name)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            for i, step_id in enumerate(ordered_ids):
                cur.execute(
                    "UPDATE tour_steps SET position = %s WHERE id = %s AND tab_name = %s",
                    (i, step_id, tab_name),
                )
