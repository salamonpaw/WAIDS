# Changelog — WAIDS (Weryfikator Abonamentów IDS)

Wszystkie istotne zmiany w aplikacji są dokumentowane w tym pliku.
Format zgodny z [Keep a Changelog](https://keepachangelog.com/pl/1.0.0/),
wersjonowanie zgodne z [Semantic Versioning](https://semver.org/lang/pl/).

---

## [1.0.0] — 2026-05-30

Pierwsza oficjalnie wersjonowana wersja. Zawiera kompletny zestaw funkcji do
monitorowania abonamentów urządzeń IDS.

### Dodano
- **Import danych produkcji** — wiele plików Excel/ODS jednocześnie, automatyczne wykrywanie kolumn SN, firmy, modelu, daty produkcji
- **Import płatności** — obsługa 3 formatów (Prod, Pivot, Monthly); wykrywanie kolumny `nzf_DataOstatniejSplaty` (pominięcie nieopłaconych faktur); import kwoty (`nzf_WartoscPierwotnaWaluta`) i waluty (`nzf_IdWaluty`) z proporcjonalnym podziałem dla faktur wielomiesięcznych
- **Szablony importu** — przyciski pobierania szablonów Excel dla każdego formatu
- **Raport / Dashboard** — tabela z 15 kolumnami, filtry (status, typ, firma, klient, handlowiec, daty), paginacja, KPI, wykresy (Chart.js)
- **Historia płatności urządzenia** — modal z chipami miesięcy, kwotą per miesiąc, sumą łączną
- **Monitoring masterów** — analiza kohortowa nowych masterów wg miesiąca produkcji; filtry: klient, data od, Tylko IDS
- **Pierwsze płatności** — lista urządzeń z pierwszą płatnością w wybranym miesiącu/przedziale
- **Konfiguracja firmy (`firm_config`)** — typy: IDS / Licencja / OEM / Inne; cykl, oczekiwana kwota, waluta; edycja inline (modal), usuwanie
- **Eksport / Import tabeli klientów** — Excel z kolumnami Firma, Typ, Cykl, Kwota, Waluta, Handlowiec 1 & 2; tryby: Uzupełnij / Nadpisz
- **Zarządzanie handlowcami** — dodawanie i usuwanie handlowców przez UI, przypisywanie firm
- **Przychody miesięczne** — sekcja w zakładce Raport; suma płatności per miesiąc i waluta; eksport CSV
- **Wykluczanie firm** z abonamentu
- **Ręczne nadpisanie typu urządzenia** (master / slave / OEM / showroom)
- **Tooltips** na wszystkich nagłówkach kolumn i wskaźnikach KPI
- **Wersjonowanie** — wersja aplikacji widoczna w nagłówku; endpoint `/version`; `CHANGELOG.md`
- **Dark mode** — obsługa `prefers-color-scheme: dark`
- **DEPLOYMENT.md** — pełna instrukcja wdrożenia na Debian 12 (nginx, systemd, PostgreSQL)

### Bezpieczeństwo
- Wszystkie operacje bazodanowe ograniczone wyłącznie do bazy `abonaments`
- Klucze bazy danych przechowywane w `.env` (nigdy nie commitowane do gita)

---

## Jak wersjonować

### Bump wersji (przy każdym wydaniu)
1. Edytuj `backend/version.py` — zmień `APP_VERSION`
2. Dodaj wpis do tego pliku (`CHANGELOG.md`)
3. Zrób commit: `git commit -m "chore: bump version to X.Y.Z"`
4. Otaguj: `git tag vX.Y.Z && git push origin vX.Y.Z`

### Kiedy co zwiększać
| Sytuacja | Przykład | Zmiana |
|---|---|---|
| Zmiana schematu bazy / łamie API | nowa tabela z migracji wymaganą przez frontend | **MAJOR** (1.x.x → 2.0.0) |
| Nowa funkcja, wstecznie zgodna | nowy endpoint, nowa sekcja UI | **MINOR** (x.1.x → x.2.0) |
| Naprawa błędu, retusz UI | fix importu, poprawka CSS | **PATCH** (x.x.1 → x.x.2) |
