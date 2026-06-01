# Changelog — WAIDS (Weryfikator Abonamentów IDS)

Wszystkie istotne zmiany w aplikacji są dokumentowane w tym pliku.
Format zgodny z [Keep a Changelog](https://keepachangelog.com/pl/1.0.0/),
wersjonowanie zgodne z [Semantic Versioning](https://semver.org/lang/pl/).

---

## [1.9.2] — 2026-06-01

### Dodano
- **Historia scaleń firm** — tabela w sekcji Scalanie firm pokazuje wszystkie wykonane scalenia (data, źródło → cel, liczba przeniesionych urządzeń); dane przechowywane w nowej tabeli `firm_merges`
- **Endpoint `GET /firms/merges`** — zwraca historię scaleń od najnowszych
- **Tabela `firm_merges`** — `id`, `source`, `target`, `merged_at`, `devices_affected`; tworzona automatycznie przy starcie backendu

---

## [1.9.1] — 2026-06-01

### Naprawiono
- **`showMsg` crash przy zapisie opłaty licencyjnej** — `saveLicenseFee()` wywoływała niezdefiniowaną `showMsg()`; zastąpiono `setMsg()` (naprawione już w 1.9.0, teraz wdrożone)

### Zmieniono
- **Scalanie firm przeniesione NA GÓRĘ** zakładki Konfiguracja (ponad opłaty licencyjne) — scalanie musi być wykonane przed konfiguracją, żeby wszystkie późniejsze wpisy dotyczyły już scalonej nazwy; sekcja oznaczona żółtym ostrzeżeniem
- **Autouzupełnianie firm w scalaniu** — lista pochodzi z 3 źródeł łącznie: załadowane wyniki analizy (`results[]`), endpoint `/api/reps/firms` (wszystkie firmy z bazy produkcji), skonfigurowane firmy (`firm_config`); sortowanie polskie (locale `pl`)
- **Walidacja nazwy firmy przy scalaniu** — jeśli wpisana nazwa nie istnieje w bazie, chip jest oznaczony czerwonym obramowaniem i ostrzeżeniem ⚠; nazwy są normalizowane do wielkości liter z bazy (case-insensitive match)
- **`loadMergeFirmaLists` wywołane wewnątrz `loadConfig()`** — po załadowaniu `firm-configs`, nie współbieżnie z resztą inicjalizacji; gwarantuje że `_firmConfigData` jest dostępna w momencie budowania listy firm

---

## [1.9.0] — 2026-06-01

### Zmieniono
- **Refaktoring frontendu** — `index.html` (4933 linii) podzielony na osobne pliki statyczne serwowane przez nginx:
  - `css/main.css` — wszystkie style CSS
  - `js/utils.js` — globalne zmienne stanu, helpery, formattery
  - `js/auth.js` — interceptor fetch, logowanie/wylogowanie
  - `js/app.js` — przełączanie zakładek, pasek statusu DB, changelog
  - `js/import.js` — import produkcji i płatności, strefy drag-and-drop, szablony
  - `js/report.js` — zakładka Raport: wykresy, filtry, tabela, eksport, override modala
  - `js/monitoring.js` — zakładka Monitoring: analiza kohortowa masterów
  - `js/config.js` — zakładka Konfiguracja: firmy, handlowcy, wykluczenia, scalanie
  - `js/firstpay.js` — zakładka Nowe płatności
  - `js/device.js` — zakładka Wyszukiwarka urządzeń
  - `js/revenue.js` — zakładka Wyliczenia: revenue analytics + sezonowość
  - `js/tooltip.js` — globalny tooltip ⓘ
- `update.sh` — zaktualizowany: kopiuje `css/` i `js/` do `/var/www/waids/`

### Naprawiono
- **`showMsg` undefined** — w sekcjach Opłaty licencyjne i Scalanie firm kod wywoływał niezdefiniowaną funkcję `showMsg()`; wszystkie wywołania zastąpione poprawną `setMsg(id, text, type)`
- **`loadMergeFirmaLists` — błędny endpoint** — funkcja wywoływała `/api/firms/export` (zwraca binarny plik Excel) i próbowała parsować go jako JSON; zmieniono na `/api/reps/firms` (zwraca `{firms: [...]}`) — ten sam endpoint co `loadReps()`

---

## [1.8.0] — 2026-06-01

### Dodano
- **Prognoza przychodów** (zakładka Wyliczenia) — przerywana linia na wykresie trendu miesięcznego pokazuje przewidywany przychód PLN netto od bieżącego miesiąca do końca roku; obliczana jako średnia z ostatnich 3 zakończonych miesięcy; tooltip wyraźnie oznacza wartość jako „Prognoza (śr. 3 mies.)"

### Zmieniono
- **Scalanie firm** — przebudowany UI z pola tekstowego na podejście chip-based: firmy dodaje się przyciskiem „+ Dodaj" (jak w sekcji Handlowcy); po zebraniu ≥2 firm przycisk „🔗 Scal" otwiera dialog z pytaniem o nazwę docelową; potwierdzenie uruchamia kaskadowe scalenie przez API

### Naprawiono
- **Surowy kod JS renderował się jako tekst strony** — komentarz `// Tooltip div is defined AFTER </script> in HTML` zawierał literal `</script>`, co powodowało przedwczesne zakończenie tagu `<script>` przez parser HTML i wyświetlenie reszty skryptu jako widocznego tekstu; zmieniono na „closing script tag"

---

## [1.7.1] — 2026-06-01

### Naprawiono
- **Popover ⓘ nadal nie działał** — zamiana `mouseout` (odpala się na każdy ruch myszy wewnątrz elementu) na podejście: każdy `mouseover` na element inny niż `.info-icon` chowa tooltip; dodano wymuszenie layout przed pozycjonowaniem by `offsetWidth/Height` były wyliczone
- **Panel Zarządzanie użytkownikami** — przeniesiony na górę zakładki Konfiguracja (był schowany na samym dole); `loadConfig()` teraz zawsze odświeża listę użytkowników gdy zalogowany admin przełącza zakładkę

---

## [1.7.0] — 2026-06-01

### Naprawiono
- **Popover ⓘ nie wyświetlał się** — `const tip = getElementById(...)` wywoływany przed sparsowaniem diva przez przeglądarkę; zmieniono na lazy lookup w każdym handlerze

### Dodano
- **Wykres sezonowości produkcji** (zakładka Wyliczenia) — linie rok do roku, każdy rok inny kolor; filtr typu urządzenia (Master/OEM/Wszystkie) i modelu maszyny; checkbox aktywnych lat; przycisk Rozwiń; X=miesiące Sty–Gru, Y=liczba urządzeń; tooltip z rokiem i liczbą urządzeń
- **Opłaty licencyjne** (zakładka Konfiguracja) — nowa tabela `firm_license_fees` z polami: firma, kwota/mies., waluta, od, do (puste=bieżąca), uwagi; pełne CRUD (dodaj/edytuj/usuń); formularz z autocomplete listy firm; endpoint `GET/POST/PUT/DELETE /license-fees`
- **Scalanie firm** (zakładka Konfiguracja) — formularz z dwoma polami z autocomplete; podgląd operacji przed wykonaniem; scal przesuwa urządzenia, handlowców, konfigurację i opłaty licencyjne; endpoint `POST /firms/merge`; inwalidacja cache po scaleniu
- **Endpoint `GET /production/seasonality`** — zwraca dane dla wykresu sezonowości (year×month counts, lista modeli) na podstawie cache analizy

---

## [1.6.0] — 2026-06-01

### Dodano
- **Zakładka "💰 Wyliczenia"** — kompletny dashboard revenue analytics:
  - **KPI row**: Przychody roku (PLN netto / EUR), płacące urządzenia, płacący klienci
  - **Trend miesięczny**: wykres słupkowo-liniowy PLN netto + EUR (oś prawa); filtr lat + przycisk Rozwiń
  - **Przychody roczne**: grupowany wykres słupkowy PLN netto / PLN brutto / EUR per rok
  - **Top klienci**: poziomy wykres słupkowy z przełącznikiem Top 10 / 15 / 20, tooltip z detalami
  - **Rozkład wg typu klienta**: donut chart IDS / Licencja / OEM / Inne
  - **Przychody wg handlowca**: wykres PLN netto i EUR per handlowiec
  - **Tabela klientów**: sortowalna, przeszukiwalna, z kolumnami PLN netto/brutto, EUR, urządzenia, płatności, avg/urządzenie, % udziału
  - Filtr roku w nagłówku zakładki zsynchronizowany z wykresami i KPI
- **Nowy endpoint `GET /revenue`** — agregacje przychodów: monthly trend, annual totals, top 50 klientów, wg handlowca, wg typu firmy, KPI all-time + YTD

### Naprawiono
- **Zwijanie wykresu słupkowego** (⤡ Zwiń) — użyto `style.removeProperty('grid-column')` zamiast `= ''`; dodano pełną przebudowę wykresu po zwinięciu — canvas poprawnie wraca do połowy szerokości

---

## [1.5.1] — 2026-06-01

### Naprawiono
- **Rozwiń wykres** — poprawiono działanie przycisku ⤢; zamiast klasy CSS (`expanded`) stosowane są teraz bezpośrednie style inline (`gridColumn`, `order`, `height`), co eliminuje konflikty z układem siatki

---

## [1.5.0] — 2026-06-01

### Dodano
- **Filtr lat wykresu słupkowego** — przyciski Wszystkie / 2022 / 2023 / … nad wykresem produkcji miesięcznej; kliknięcie zawęża widok do wybranego roku
- **Rozwiń wykres** — przycisk ⤢ przy wykresie słupkowym zwiększa go do pełnej szerokości i podwaja wysokość
- **Globalny filtr dat w nagłówku** — przycisk 📅 Zakres dat otwiera popup z wyborem od/do; po ustawieniu pojawia się pill z aktywnym zakresem i przyciskiem × do czyszczenia
- **Kopiuj SN** — ikonka ⎘ przy każdym numerze seryjnym (tabela Raportu i lista nadpisań) kopiuje go do schowka jednym kliknięciem
- **Ręczne nadpisania typów** — lista skrócona do 10 wierszy, reszta ukryta za przyciskiem "Pokaż wszystkie N nadpisań"
- **Kolory handlowców w kartach** — nagłówek i tagi firm każdego handlowca podświetlone jego kolorem; przycisk Usuń przeniesiony z obszaru dodawania firm i wyciszony wizualnie

---

## [1.4.0] — 2026-06-01

### Wydajność
- **Indeksy bazy danych** — dodano indeksy na `payments.sn`, `devices.sn`, `devices.firma`, `firm_config.firma`, `excluded_firms.firma`, `firm_reps.firma`; zapytanie analityczne znacznie szybsze
- **Cache w pamięci** — wynik `/analyze` (wszystkie 3486 urządzeń) cachowany w RAM po pierwszym zapytaniu; każde kolejne wejście w Raport jest natychmiastowe
- **Inwalidacja cache** — cache czyszczony automatycznie po każdym imporcie, zmianie typu urządzenia, edycji konfiguracji firmy, zmianie wykluczeń

---

## [1.3.1] — 2026-06-01

### Naprawiono
- Usunięto `nzf_WartoscPierwotnaWaluta` jako fallback kwoty — kolumna zawierała błędne dane
- Fallback kwoty: `ob_CenaWaluta` → `ob_CenaNetto` (PLN netto)
- Poprawiono nazwę kolumny brutto: `ob_CenaBrutto` (było: `ob_WartBrutto`)

---

## [1.3.0] — 2026-06-01

### Dodano
- **Kolumny kwot w imporcie płatności** — import teraz odczytuje trzy kolumny kwot z pliku IDS:
  - `ob_CenaWaluta` — kwota w walucie oryginalnej (główna kwota, priorytet nad `nzf_WartoscPierwotnaWaluta`)
  - `ob_CenaNetto` — cena netto w PLN
  - `ob_WartBrutto` — wartość brutto w PLN
- **Historia płatności w zakładce Urządzenie** — tabela pokazuje kolumny Netto PLN i Brutto PLN gdy dane są dostępne; wiersz sumaryczny na dole

### Zmieniono
- Kolumna kwoty w imporcie IDS zmieniona z `nzf_WartoscPierwotnaWaluta` na `ob_CenaWaluta` jako pierwszeństwo

---

## [1.2.0] — 2026-06-01

### Dodano
- **Historia płatności urządzenia** w zakładce Monitoring — wyszukaj po numerze seryjnym i zobacz pełną tabelę płatności (miesiąc, klient, kwota) wraz z sumą łączną i informacją o urządzeniu

### Naprawiono
- **Scroll poziomy tabeli w Raporcie** — tabela z wieloma kolumnami teraz poprawnie wyświetla pasek przewijania poziomego zamiast ucinać kolumny

---

## [1.1.0] — 2026-05-31

### Dodano
- **Autoryzacja JWT** — wymagane logowanie emailem i hasłem przed dostępem do aplikacji; token przechowywany w `localStorage`, automatyczne wylogowanie po wygaśnięciu
- **Panel administracyjny** (zakładka Konfiguracja, widoczna tylko dla admina) — lista użytkowników, dodawanie kont, resetowanie hasła, dezaktywacja konta
- **Konto administratora** — tworzone automatycznie przy starcie z env `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- **Changelog / Release notes** — przycisk wersji w nagłówku otwiera modal z historią zmian
- **Filtr "Tylko IDS"** w zakładce Monitoring — ukrywa firmy z typem Licencja / OEM / Inne
- **Zakładka "Nowe płatności"** przepisana od nowa — pokazuje urządzenia wg daty produkcji (nie daty pierwszej płatności); domyślnie poprzedni miesiąc; kolumna statusu płatności; nierozliczone wyróżnione czerwonym tłem

### Naprawiono
- **Nagłówki kolumn** — błąd z cudzysłowem w atrybucie `title` (tooltips nie renderowały się poprawnie gdy nazwa zawierała `"`)
- **Zastąpiono passlib biblioteką bcrypt** — passlib 1.7.4 niekompatybilna z bcrypt ≥ 5.0.0 (błąd przy hashowaniu hasła)

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
