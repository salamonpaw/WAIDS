// ── WAIDS — app shell: tab switching, status bar, changelog ──────────────

// ── Tab switching ──────────────────────────────────────────────────────────
const ADMIN_TABS = ['revenue', 'config'];

function switchTab(name) {
  if (ADMIN_TABS.includes(name) && !currentUser?.is_admin) return;
  if (name === 'commissions' &&
      !currentUser?.is_admin && !currentUser?.can_view_commissions) return;
  if (name === 'pricing' &&
      !currentUser?.is_admin && !currentUser?.can_view_pricing) return;
  if (name === 'segmentation' &&
      !currentUser?.is_admin && !currentUser?.can_view_segmentation) return;
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  // switchTab bywa też wywoływane programowo (np. przez edytor przewodnika przy
  // "wskaż element"), nie tylko z inline onclick — wtedy nie ma klikniętego
  // przycisku do podświetlenia, więc sprawdzamy ostrożnie zamiast zakładać event.
  if (typeof event !== 'undefined' && event?.currentTarget?.classList) {
    event.currentTarget.classList.add('active');
  } else {
    const btn = document.querySelector(`.tab-btn[onclick*="switchTab('${name}')"]`);
    if (btn) btn.classList.add('active');
  }
  if (name === 'report')       loadReport();
  if (name === 'monitor')      loadMonitoringTab();
  if (name === 'firstpay')     loadFirstPayTab();
  if (name === 'device')       { /* data loaded on demand via searchBySN() */ }
  if (name === 'revenue')      { loadRevenue(); loadSeasonality(); }
  if (name === 'bonus')        { loadBonusTab(); }
  if (name === 'config')       { loadConfig(); loadLicenseFees(); if (typeof initTourAdminPanel === 'function') initTourAdminPanel(); }
  if (name === 'commissions')  { onTabCommissions(); }
  if (name === 'pricing')      { onTabPricing(); }
  if (name === 'segmentation') { onTabSegmentation(); }
  if (name === 'arrears')      { onTabArrears(); }
  if (name === 'sales')        { onTabSales(); }
  if (typeof maybeAutoStartTour === 'function') maybeAutoStartTour(name);
}

function applyAdminTabs() {
  const isAdmin = currentUser?.is_admin || false;
  const canComm    = isAdmin || currentUser?.can_view_commissions || false;
  const canPricing = isAdmin || currentUser?.can_view_pricing    || false;
  const canSeg     = isAdmin || currentUser?.can_view_segmentation || false;
  document.getElementById('tabBtnRevenue').style.display     = isAdmin    ? '' : 'none';
  document.getElementById('tabBtnCommissions').style.display = canComm    ? '' : 'none';
  document.getElementById('tabBtnPricing').style.display     = canPricing ? '' : 'none';
  document.getElementById('tabBtnSegmentation').style.display = canSeg    ? '' : 'none';
  document.getElementById('tabBtnConfig').style.display      = isAdmin    ? '' : 'none';
  // Show admin-only rate form
  const rateForm = document.getElementById('commAdminRateForm');
  if (rateForm) rateForm.style.display = isAdmin ? '' : 'none';
  const periodForm = document.getElementById('commAdminPeriodForm');
  if (periodForm) periodForm.style.display = isAdmin ? '' : 'none';
}

// ── DB status bar ──────────────────────────────────────────────────────────
async function refreshStatus() {
  // Fetch app version (fire-and-forget)
  fetch(`${API}/version`).then(r => r.ok ? r.json() : null).then(d => {
    if (d?.version) {
      const el = document.getElementById('appVersion');
      if (el) el.textContent = 'v' + d.version;
    }
  }).catch(() => {});
  // Fetch DB status
  try {
    const r = await fetch(`${API}/status`);
    if (!r.ok) throw 0;
    const d = await r.json();
    document.getElementById('dbDot').className = 'db-dot green';
    document.getElementById('dbDevices').textContent = `${d.devices} urządzeń w bazie`;
    const mp = document.getElementById('dbMonthsPill');
    if (d.months.length) {
      mp.style.display = 'flex';
      const range = d.months.length > 1
        ? `${d.months[0]} — ${d.months[d.months.length-1]} (${d.months.length} mies.)`
        : d.months[0];
      document.getElementById('dbMonths').textContent = '📅 ' + range;
    } else { mp.style.display = 'none'; }
  } catch {
    document.getElementById('dbDot').className = 'db-dot red';
    document.getElementById('dbDevices').textContent = 'Brak połączenia z API';
  }
}

// ── Changelog modal ────────────────────────────────────────────────────────

const CHANGELOG_ENTRIES = [
  {
    version: '2.11.1', date: '2026-11-18',
    fixed: [
      '<b>Edytor przewodnika — 3 błędy znalezione przy weryfikacji „Wskaż na ekranie”</b> (żaden nie dotarł jeszcze na produkcję): (1) po wskazaniu elementu formularz resetował się do pustego, kasując już wpisany tytuł/opis nowego kroku; (2) wyścig asynchroniczny mógł wysypać całą operację wyjątkiem przy edycji istniejącego kroku (cache bywał `null` w momencie odczytu); (3) programowe przełączenie zakładki w trakcie wskazywania mogło przypadkiem odpalić PRAWDZIWY samouczek tej zakładki na wierzchu trybu wskazywania, a nawet trwale oznaczyć go jako „widziany” bez realnego pokazania. Dodatkowo: kliknięcie poza aktywną zakładką (np. w przycisk „❓ Pomoc” nad paskiem) nie jest już ciche — pokazuje ostrzeżenie i pozwala kliknąć ponownie.',
    ],
  },
  {
    version: '2.11.0', date: '2026-11-18',
    added: [
      '<b>🧭 Edytor przewodnika</b> (Konfiguracja → Przewodnik, Admin) — treść kroków przewodnika (❓ Pomoc) jest teraz w bazie, nie na sztywno w kodzie. Dla każdej zakładki: lista kroków z tytułem, opisem i selektorem elementu, dodawanie/edycja/usuwanie, zmiana kolejności (↑/↓).',
      '<b>„🎯 Wskaż na ekranie”</b> — zamiast ręcznie wpisywać selektor CSS, przycisk w edytorze kroku przełącza na wybraną zakładkę, podświetla element pod kursorem, a kliknięcie zapisuje go jako cel kroku (Esc anuluje). Selektor liczy się od najbardziej stabilnego (ID elementu), przez unikalną klasę, po ścieżkę pozycyjną.',
      'Zmiany w edytorze są widoczne natychmiast dla wszystkich użytkowników, bez wdrożenia — treść pobierana jest przy starcie tury (GET /tours).',
    ],
  },
  {
    version: '2.10.0', date: '2026-11-18',
    added: [
      '<b>Segmentacja — Etap 3: panel admina do progów i słownika modeli</b>. „📖 Słownik modeli” — dodawanie/edycja/usuwanie przelicznika JP per model (kod, aliasy, nazwa cennikowa, JP/szt, typ własne/OEM, ważność), od razu odświeża filtr modeli w głównej tabeli. „📏 Progi segmentacji” — edycja progów A/B/C i pozostałych parametrów (profil OEM, na granicy, trend, min. miesięcy); zapis tworzy NOWĄ wersję zamiast nadpisywać poprzednią, więc już zapisane zrzuty miesięczne zostają policzone starą wersją, dopóki świadomie się ich nie przeliczy — z pełną historią wersji w tabeli niżej.',
      'Przewodnik (❓ Pomoc) rozszerzony o kroki dla obu nowych paneli admina.',
    ],
  },
  {
    version: '2.9.1', date: '2026-11-18',
    fixed: [
      '<b>Wyliczenia — prawdziwa przyczyna mylącego kafelka „Przychody EUR”</b>: JS nadpisywał `.textContent` całego diva z etykietą, kasując przy każdym renderze ikonkę ⓘ (tooltip z wyjaśnieniem nigdy nie był widoczny) i resetując tekst do ogólnego „Przychody {rok} (EUR)” — wcześniejsza poprawka tekstu w HTML (v2.8.1) nigdy realnie nie trafiała na ekran. Tekst etykiet jest teraz w osobnym `&lt;span&gt;`, JS dotyka tylko jego.',
    ],
    added: [
      '<b>Kafelek „w tym EUR” wizualnie podporządkowany</b> kafelkowi PLN netto (cieńsza ramka, mniejsza czcionka, strzałka ↳) zamiast wyglądać jak drugi, równorzędny total do zsumowania. Pod głównym kafelkiem PLN netto dodatkowo widoczna od razu kwota EUR z dopiskiem „już tu policzone” — bez potrzeby patrzenia na sąsiedni kafelek czy czytania tooltipa.',
    ],
  },
  {
    version: '2.9.0', date: '2026-11-18',
    added: [
      '<b>❓ Przewodnik po aplikacji</b> (driver.js) — tura z opisami kluczowych elementów dla każdej zakładki, odpala się automatycznie przy pierwszym wejściu (zapamiętane, nie powtarza się) i ręcznie przyciskiem „❓ Pomoc” w nagłówku dla aktualnie otwartej zakładki.',
    ],
  },
  {
    version: '2.8.3', date: '2026-11-18',
    fixed: [
      '<b>Segmentacja — 5 niezmapowanych modeli z produkcji dopisanych do słownika</b> (potwierdzone przez użytkownika): „D810M NEO” to literówka „D810 NEO” (alias, 0,85 JP); „L40 PRO” liczony jak „L40 M” (0,30), „D540” (bez NEO) jak „D540 NEO” (0,80), „D540M” jak „D810M” (0,80), „T10” jak „T15” (0,30) — te cztery jako osobne wpisy w słowniku, żeby zostały widoczne pod własną nazwą w raportach (miks modeli), a nie zniknęły pod inną.',
    ],
  },
  {
    version: '2.8.2', date: '2026-11-18',
    added: [
      '<b>Segmentacja — filtr zakresu wykresów „w czasie”</b> (12/24/36 mies. / wszystkie zrzuty) nad wykresami „JP wg segmentów” i „Klienci w segmentach”.',
      '<b>deploy.sh dociąga zrzuty segmentacji automatycznie</b> po każdym wdrożeniu (backfill od 2024-01, idempotentny) — wykresy w czasie nie stoją już puste czekając na ręczne kliknięcie w panelu admina.',
    ],
    fixed: [
      '<b>Segmentacja — alias „D810NEO”/„D810Neo” (bez spacji)</b> dopisany do modelu „D810 NEO” w już zasianym słowniku (nie tylko dla nowej instalacji) — znaleziony w prawdziwych danych produkcyjnych jako „niezmapowany model”.',
    ],
  },
  {
    version: '2.8.1', date: '2026-11-18',
    fixed: [
      '<b>Wyliczenia — błędna notka pod tabelą „Przychody wg waluty”</b> — napis twierdził, że suma kolumny „Odpowiednik w PLN netto” równa się kafelkowi „Przychody (PLN netto)” u góry. Nieprawda przy filtrze roku: tabela jest zawsze za wszystkie lata łącznie (jak „Top klienci”), a kafelek pokazuje tylko wybrany rok. Poprawiono opis, dodano wyjaśnienie że „Kwota w walucie oryginalnej” to cena referencyjna z faktury (ob_CenaWaluta) — przy rabatach bywa wyższa niż rzeczywiście zafakturowana wartość, więc dzielenie jej przez netto nie daje realnego kursu wymiany.',
    ],
  },
  {
    version: '2.8.0', date: '2026-11-18',
    added: [
      '<b>🎯 Segmentacja — etap 2</b>: filtr „Okres porównawczy” (brak / poprzedni okres / rok wcześniej) dodaje do tabeli kolumny Migracja i Zmiana r/r per klient; kolumny „Segmenty w latach” (wybieralne pilkami) pokazują segment klienta w każdym roku kalendarzowym (bieżący rok oznaczony gwiazdką — niepełny).',
      '<b>Macierz migracji</b> — P0 (okres porównawczy) × P1 (wybrany okres), z liczbą klientów i JP w każdej komórce; kliknięcie komórki filtruje tabelę klientów do tej migracji.',
      '<b>Zrzuty miesięczne</b> (<code>seg_snapshots</code>) — kroczące 12 mies. zapisywane co miesiąc (cron dzień 2., 3:00) i wykorzystywane do wykresów „JP w czasie wg segmentów” / „Klienci w segmentach w czasie” oraz do karty klienta. Panel admina do ręcznego backfillu i przeliczenia ostatniego miesiąca.',
      '<b>Karta klienta</b> (kliknięcie wiersza w tabeli) — segment i flagi, pasek historii segmentu, wykres JP miesięcznie z linią JP kroczącego 12 mies., miks modeli w okresie.',
    ],
  },
  {
    version: '2.7.0', date: '2026-11-18',
    added: [
      '<b>🎯 Segmentacja klientów A–D</b> (etap 1, nowe uprawnienie <code>can_view_segmentation</code> — podgląd dla Admina i wyznaczonych osób, konfiguracja progów/słownika modeli na razie wyłącznie przez Admina) — nowa zakładka liczy segment klienta wg wolumenu w jednostkach produkcyjnych (JP), przeliczonego na 12 miesięcy: A ≥30 JP, B ≥8, C ≥3, D <3. Tabela klientów z JP (okres/12mies/miesięcznie), udziałem OEM, flagami „profil OEM” i „blisko progu”, dystansem do wyższego segmentu oraz udziałem w JP/narastająco. Filtry: zakres dat (z presetami), typ maszyn (własne/OEM), modele — zmieniają tylko wyświetlane JP/sztuki, segment zawsze liczony z pełnego wolumenu klienta.',
      'Słownik 15 modeli z przelicznikiem JP/szt. i progi segmentacji są w pełni konfigurowalne w bazie (wersjonowane), zasiane wartościami startowymi — panel admina do ich edycji to etap 3. Model spoza słownika zgłasza alert administratorowi zamiast cicho znikać z wyliczeń.',
    ],
  },
  {
    version: '2.6.0', date: '2026-11-18',
    added: [
      '<b>Wyliczenia — tabela „Przychody wg waluty"</b> — nowa sekcja pokazuje rozkład całego przychodu (PLN netto) wg waluty oryginalnej faktury: PLN, EUR, USD, GBP. Ujawnia że dotąd niewidoczny przychód w USD (≈19% wszystkich przychodów w danych na dzień wdrożenia) był wliczony w PLN netto, ale nigdzie nie pokazywany osobno.'
    ],
    fixed: [
      '<b>Wyliczenia — mylące zestawienie PLN netto / EUR</b> — kafelek „Przychody EUR" obok „Przychody PLN netto" sugerował dwa osobne źródła przychodu; w rzeczywistości EUR (i USD, GBP) są już WLICZONE w PLN netto (IDS przelicza faktury walutowe na PLN wg kursu z dnia wystawienia). Dodano ostrzeżenie w opisie kafelka EUR i nową tabelę wg waluty, która pokazuje to jawnie — żeby nikt nie sumował PLN netto + EUR traktując to jako dodatkowy przychód.'
    ]
  },
  {
    version: '2.5.1', date: '2026-11-02',
    fixed: [
      '<b>deploy.sh — nowa wersja skryptu nie była wykonywana</b> — <code>git pull</code> wewnątrz deploy.sh podmieniał skrypt w trakcie działania i dalej leciała stara wersja (bez instalacji crona diagnostyki). Teraz skrypt po pullu uruchamia się ponownie, jeśli się zmienił; całość w funkcji main(), więc nadpisanie pliku w trakcie nie psuje przebiegu.'
    ]
  },
  {
    version: '2.5.0', date: '2026-11-02',
    added: [
      '<b>Diagnostyka awarii na ekranie logowania</b> — przy błędzie 502/503/504 lub braku połączenia ekran logowania pokazuje przyczynę: restart VM, stan Dockera i kontenerów (z komunikatem błędu), wynik automatycznej naprawy, miejsce na dysku i ostatnie logi. Dane z pliku <code>health.json</code> generowanego co minutę na VM przez <code>ops/waids_health.py</code> (cron instalowany przez deploy.sh).',
      '<b>Samonaprawa po restarcie VM</b> — gdy Docker działa, a kontenery WAIDS nie, skrypt diagnostyczny wykonuje <code>docker compose up -d</code> (max raz na 5 min, pomijane w trakcie deployu). deploy.sh włącza autostart Dockera.'
    ],
    fixed: [
      '<b>Awaria po restarcie serwera (zasilanie)</b> — systemowy PostgreSQL zajmował port 5432 przed Dockerem i kontener bazy nie startował (502 przy logowaniu). Baza WAIDS wystawiona teraz na hoście na porcie <code>127.0.0.1:5433</code>; backend bez zmian (łączy się przez sieć Dockera).',
      '<b>Logowanie</b> — błąd serwera nie pokazuje już „Unexpected token &lt;… is not valid JSON”, a awaria backendu przy wejściu na stronę nie kasuje sesji.'
    ]
  },
  {
    version: '2.4.1', date: '2026-09-10',
    fixed: [
      '<b>Zakupy — brak klientów na licencji</b> — firmy wykluczone z analizy abonamentowej (excluded_firms, np. klienci na licencji) były pomijane w zestawieniu zakupów. Zakupy to raport produkcyjny — teraz pokazuje WSZYSTKIE wyprodukowane maszyny niezależnie od statusu abonamentu.'
    ]
  },
  {
    version: '2.4.0', date: '2026-09-10',
    added: [
      '<b>Zakupy per klient</b> — nowa zakładka 📦 Zakupy: agregacja urządzeń z tabeli produkcyjnej (devices) per firma, z filtrem zakresu dat produkcji, kolumnami per typ maszyny i eksportem XLSX.'
    ]
  },
  {
    version: '2.3.8', date: '2026-09-01',
    fixed: [
      '<b>Pierwsze IDS — błąd kalendarza i czerwone przyszłe miesiące</b> — nagłówki kolumn były brane z pierwszego urządzenia, więc urządzenia z późniejszą pierwszą płatnością (np. BEESWIFT first_pay 2026-06) renderowały komórki pod złymi kolumnami. Naprawiono przez globalny wspólny kalendarz — union wszystkich miesięcy ze wszystkich urządzeń. Miesiące przed pierwszą płatnością urządzenia → szare (półprzezroczyste), przyszłe miesiące (po bieżącym) → jasno-szare zamiast czerwonych.'
    ]
  },
  {
    version: '2.3.7', date: '2026-08-31',
    added: [
      '<b>Zawieszenia uwzględnione we wszystkich widokach</b> — Monitoring: nowy status "Zawieszone" (niebieski badge), urządzenia z aktywnym zawieszeniem nie trafiają już do "Przerwa". Zaległości: zawieszone urządzenia oznaczone niebieską etykietą ⏸ i wykluczone z sumy szacowanych zaległości. Zaległości/Nigdy nieopłacone: analogiczne oznaczenie.'
    ]
  },
  {
    version: '2.3.6', date: '2026-08-31',
    fixed: [
      '<b>Zaległości — kolejny 500</b> — kolumna <code>device_type_tag</code> istnieje w <code>import_sessions</code>, nie w <code>devices</code>. Zastąpiono <code>COALESCE(fc.firm_type, \'ids\')</code> z istniejącego JOIN-a na <code>firm_config</code>.'
    ]
  },
  {
    version: '2.3.5', date: '2026-08-31',
    fixed: [
      '<b>Zaległości — 500 Internal Server Error</b> — kolumna <code>prod_date</code> w bazie to VARCHAR, nie typ DATE; kod próbował wywołać <code>.year/.month</code> na stringu. Naprawiono parsowanie daty z formatu YYYY-MM-DD / YYYY-MM / DD.MM.YYYY.'
    ]
  },
  {
    version: '2.3.4', date: '2026-08-31',
    fixed: [
      '<b>Lista rewizji — pusta dla segmentów bez targetu (np. PREMIUM)</b> — lista używała <code>revision_list</code> (tylko urządzenia z potencjałem > 0). Teraz używa <code>device_list</code> (wszystkie urządzenia), więc PREMIUM/ENTERPRISE/STANDARD widoczne zawsze; target można ręcznie ustawić per wiersz i dodać do listy podwyżek.'
    ]
  },
  {
    version: '2.3.3', date: '2026-08-31',
    added: [
      '<b>⚠ Zaległości abonamentowe</b> — nowa zakładka dostępna dla wszystkich zalogowanych użytkowników. Dwa widoki: <b>Przestały płacić</b> — urządzenia IDS z co najmniej 1 miesiącem bez opłat (filtr minimalnej liczby miesięcy), z wyliczeniem szacowanej zaległości (mies. × śr. stawka z ostatnich 3 płatności); <b>Nigdy nieopłacone</b> — urządzenia wyprodukowane bez żadnej zarejestrowanej płatności. Kolory wierszy sygnalizują pilność (zielony ≤ 2 mies., żółty 3–6, pomarańczowy 7–12, czerwony > 12). Sortowanie po każdej kolumnie, filtr opiekuna, KPI na górze.'
    ]
  },
  {
    version: '2.3.2', date: '2026-08-31',
    added: [
      '<b>Drilldown segmentu w widoku Segmenty (6.2)</b> — kliknięcie wiersza segmentu rozwija panel inline z listą wszystkich urządzeń w segmencie (Symbol IDS, Firma, Opiekun, Stawka, Potencjał/mies., Ost. płatność), podsumowaniem MRR i potencjału segmentu oraz rozkładem wg opiekunów. Ponowne kliknięcie zwija panel. Sortowanie: LEGACY/DISCOUNT od najtańszych, pozostałe od najdroższych.'
    ]
  },
  {
    version: '2.3.1', date: '2026-08-31',
    fixed: [
      '<b>Import płatności — błędne kwoty netto dla płatności z góry (advance payment)</b> — kod dzielił <code>ob_cenanetto</code> (cena miesięczna) przez liczbę miesięcy, dając 1/12 rzeczywistej stawki. Teraz: jeśli plik ma <code>ob_wartnetto</code> (wartość łączna) → dzieli przez miesiące; jeśli tylko <code>ob_cenanetto</code> (cena jednostkowa/mies.) → bez dzielenia. Wynik importu pokazuje teraz typ kolumny (łączna vs cena jedn.).'
    ]
  },
  {
    version: '2.3.0', date: '2026-08-31',
    added: [
      '<b>📈 Analiza pricingu IDS</b> — nowa zakładka (uprawnienie <code>can_view_pricing</code>) z globalnym wyborem przedziału czasu i parametrami (target migracji, progi segmentów, klasyfikator ceny, próg zaległości)',
      '<b>Przegląd (6.1)</b> — KPI (Liczba IDS, Średnia, Mediana, MRR, LEGACY, do migracji, potencjał /mies. i /rok), histogram cen, wykres udziałów segmentów, potencjał wg segmentu',
      '<b>Segmenty cenowe (6.2)</b> — tabela LEGACY/DISCOUNT/STANDARD/PREMIUM/ENTERPRISE z kliknięciem drilldown do listy rewizji',
      '<b>Opiekunowie (6.3)</b> — tabela i wykres potencjału per handlowiec; kliknięcie filtruje listę rewizji',
      '<b>Lista rewizji (6.4)</b> — interaktywna tabela do migracji: edytowalny target per wiersz, zaznaczanie + licznik potencjału zaznaczonych, akcja „+ Dodaj do listy podwyżek"',
      '<b>Lista podwyżek</b> — CRUD ze statusami DO_KONTAKTU / W_TOKU / PODNIESIONO / ODRZUCONO; pole notatki i nowej stawki inline',
      '<b>Presety czasu</b>: bieżący rok, poprzedni rok, ostatnie 12 miesięcy',
    ],
    fixed: [
      '<b>Select handlowca w stawkach prowizji</b> — pole używało <code>r.rep_id</code> (integer) zamiast <code>r.name</code>; lista była pusta — naprawiono'
    ]
  },
  {
    version: '2.2.5', date: '2026-08-31',
    changed: [
      '<b>Stawki prowizji — handlowiec jako select</b> — zamiast ręcznego wpisywania nazwy handlowca, formularz stawek używa listy wyboru zaciągniętej z systemu (bez ryzyka literówki)',
      '<b>Filtr "Rok podatkowy"</b> — etykieta i opcja domyślna ujednolicone z nomenklaturą księgową'
    ]
  },
  {
    version: '2.2.4', date: '2026-08-31',
    added: [
      '<b>Rok rozliczeniowy w prowizjach</b> — kolumna "Rok rozl." w tabeli pozycji pokazuje rok 12. miesiąca płatności (rok księgowy prowizji); nowy filtr "Wszystkie lata / 2024 / 2025 / …" pozwala wyfiltrować pozycje według roku rozliczenia'
    ]
  },
  {
    version: '2.2.3', date: '2026-08-31',
    fixed: [
      '<b>Przypisanie/usunięcie firmy handlowca</b> — brak invalidacji cache powodował że raport nadal pokazywał stare dane; dodano <code>_invalidate_cache()</code> po każdej zmianie',
      '<b>Osierocone przypisania firm</b> — po scaleniu firm wpisy w <code>firm_reps</code> ze starą nazwą firmy były nadal widoczne; <code>get_reps()</code> teraz filtruje tylko aktywne firmy z tabeli devices; scalenie automatycznie czyści osierocone wpisy'
    ],
    added: [
      '<b>🧹 Wyczyść osierocone</b> — przycisk w Konfiguracja → Handlowcy usuwa jednorazowo stare przypisania do firm które już nie istnieją (np. sprzed wdrożenia automatycznego czyszczenia)'
    ]
  },
  {
    version: '2.2.2', date: '2026-08-31',
    fixed: [
      '<b>Pobieranie Excel</b> — link tworzony przez blob URL jest dołączany do DOM przed kliknięciem (fix dla przeglądarek wymagających elementu w drzewie), obsługa błędu z komunikatem',
      '<b>Panel pozycji</b> — przewija stronę do tabeli po kliknięciu ⟳ Przelicz'
    ],
    changed: [
      '<b>Przyciski akcji w tabeli prowizji</b> — zamiast dropdownu: wyraźne przyciski ✓ Zatwierdź / 💰 Wypłacono / ↺ Cofnij per wiersz; pozycja Wypłacona jest zablokowana 🔒'
    ]
  },
  {
    version: '2.2.1', date: '2026-08-31',
    fixed: [
      '<b>Eksport Excel prowizji</b> — pobieranie pliku przez fetch+blob z tokenem autoryzacji (poprzednio otwierał URL bezpośrednio → Not authenticated)',
      '<b>Panel pozycji</b> — otwiera się automatycznie po kliknięciu ⟳ Przelicz (poprzednio wymagał osobnego kliknięcia w kartę okresu)',
      '<b>Stawka globalna</b> — wyświetlała surowy HTML zamiast tekstu kursywą'
    ]
  },
  {
    version: '2.2.0', date: '2026-08-31',
    added: [
      '<b>System prowizji handlowców (tab 💸 Prowizje)</b> — pełny moduł rozliczeniowy: stawki % per handlowiec (data-based), okresy rozliczeniowe z kohortą dat produkcji, automatyczne wyliczanie prowizji na podstawie 12 opłaconych miesięcy, statusy pozycji (W toku / Kwalifikuje / Zatwierdzona / Wypłacona / Anulowana), bulk-zmiana statusów, eksport Excel (pozycje + agregacja per handlowiec)',
      '<b>Uprawnienie: can_view_commissions</b> — niezależne od roli Admin; zarządzanie w Konfiguracja → Użytkownicy',
      '<b>months_batch w płatnościach</b> — import faktury z ob_Ilosc > 1 zapisuje liczbę miesięcy w kolumnie <code>months_batch</code>; używane do wykrywania płatności z góry (⬆ badge) w systemie prowizji'
    ]
  },
  {
    version: '2.1.2', date: '2026-08-13',
    added: [
      '<b>Nowy typ: ⚠ Problematyczne</b> — maszyna z trudnym do ustalenia właścicielem / płatnikiem; wymaga osobnych działań; filtr w raporcie',
      '<b>Nowy typ: 🚫 Wycofany</b> — urządzenie nieaktywne (uszkodzone, zamienione, wycofane z użytku); widoczne w bazie ale wykluczone z naliczania; filtr w raporcie'
    ],
    fixed: [
      '<b>Usuwanie zawieszenia (przycisk ✕)</b> — dodano invalidację cache po dodaniu/usunięciu zawieszenia; badge ⏸ aktualizuje się natychmiast po zmianie'
    ]
  },
  {
    version: '2.1.1', date: '2026-07-02',
    fixed: [
      '<b>Zmiana typu urządzenia (Master/OEM/Stare) dla wszystkich użytkowników z uprawnieniem edycji</b> — root cause: te same co przy komentarzach — urządzenia bez wiersza w tabeli produkcji (status „Brak w prod.") miały UPDATE z 0 wierszami. Naprawiono przez tabelę <code>device_type_overrides</code> z UPSERT; zmiana działa teraz niezależnie od statusu urządzenia i uprawnień (admin / edytor)'
    ]
  },
  {
    version: '2.1.0', date: '2026-07-02',
    fixed: [
      '<b>Komentarze — trwały zapis</b> — root cause: urządzenia istniejące tylko w płatnościach (status „Brak w prod.") nie mają wiersza w tabeli <code>devices</code>, więc UPDATE trafiał w 0 wierszy. Naprawiono przez dedykowaną tabelę <code>device_comments</code> z UPSERT — komentarz zapisywany niezależnie od tego czy urządzenie jest w bazie produkcyjnej; migracja istniejących komentarzy wykonana automatycznie'
    ]
  },
  {
    version: '2.0.9', date: '2026-07-02',
    added: [
      '<b>Usuwanie komentarza</b> — przycisk 🗑 Usuń pojawia się w modalu gdy komentarz istnieje; komentarz trwale zapisany w bazie aż do usunięcia; edycja przez nadpisanie'
    ]
  },
  {
    version: '2.0.8', date: '2026-07-02',
    fixed: [
      '<b>Komentarze</b> — usunięto background refresh który nadpisywał lokalną zmianę starymi danymi z cache; komentarz pozostaje widoczny po zapisie'
    ]
  },
  {
    version: '2.0.7', date: '2026-07-02',
    fixed: [
      '<b>Komentarze</b> — natychmiastowy update lokalnego <code>results[]</code> po zapisie; komentarz widoczny w tabeli bez czekania na odświeżenie backendu'
    ]
  },
  {
    version: '2.0.6', date: '2026-07-02',
    fixed: [
      '<b>Komentarze</b> — po zapisaniu komentarz był niewidoczny bo <code>loadReport()</code> resetował filtry; zamieniono na <code>_refreshReportData()</code> który odświeża dane zachowując aktualny widok'
    ]
  },
  {
    version: '2.0.5', date: '2026-07-02',
    fixed: [
      '<b>Komentarze</b> — brak invalidacji cache po zapisie powodował że komentarz nie był widoczny po odświeżeniu; naprawiono',
      '<b>Szerokość strony</b> — zwiększono max-width z 1300px do 1600px; tabela nie jest ucinana na szerokich ekranach'
    ]
  },
  {
    version: '2.0.4', date: '2026-06-29',
    added: [
      '<b>Filtr „Porzucone"</b> — wyłania urządzenia które kiedyś płaciły abonament (min. 1 wpłata) i przestały: opcje &gt;3, &gt;6, &gt;12, &gt;24 mies. od ostatniej wpłaty; działa niezależnie od filtra zaległości'
    ]
  },
  {
    version: '2.0.3', date: '2026-06-29',
    changed: [
      '<b>Dostęp do zakładek Wyliczenia i Konfiguracja</b> — widoczne i dostępne wyłącznie dla administratorów'
    ]
  },
  {
    version: '2.0.2', date: '2026-06-17',
    added: [
      '<b>Scalanie firm — lista rozwijana</b> — historia scaleń pogrupowana wg firmy docelowej; kliknięcie nazwy rozwija/zwija listę scalonych źródeł; przycisk ✕ usuwa wpis z historii (urządzenia bez zmian)'
    ],
    fixed: [
      '<b>Token JWT</b> — TTL przedłużone z 8h do 24h; sesja nie wygasa w ciągu dnia pracy'
    ]
  },
  {
    version: '2.0.1', date: '2026-06-08',
    fixed: [
      '<b>Picker zawieszenia</b> — dropdowny Miesiąc + Rok zamiast <code>type=month</code> (działa na HTTP bez HTTPS); domyślnie bieżący miesiąc → Grudzień bieżącego roku'
    ]
  },
  {
    version: '2.0.0', date: '2026-06-08',
    changed: [
      '<b>Stabilna wersja produkcyjna</b> — Docker Compose z jawną siecią <code>waids_net</code> (fix DNS między kontenerami); <code>deploy.sh</code> jako jedyna komenda wdrożenia; automatyczny restart po restarcie VM'
    ]
  },
  {
    version: '1.9.9', date: '2026-06-08', added: [
      '<b>Masowe zawieszenie abonamentu</b> — nowy przycisk „⏸ Zawieś…" w pasku bulk; otwiera wiersz z wyborem zakresu miesięcy (od/do) i notatką; jednym kliknięciem zawiesza wszystkie zaznaczone urządzenia'
    ]
  },
  {
    version: '1.9.8', date: '2026-06-03',
    fixed: [
      '<b>Kopiowanie SN do schowka</b> — fallback na HTTP (brak HTTPS); execCommand gdy clipboard API niedostępne',
      '<b>Badge „Zawieszone"</b> — cichy refresh po dodaniu/usunięciu zawieszenia; badge aktualny bez resetowania filtrów',
      '<b>Wyszukiwarka</b> — normalizacja SN: „1028732" znajdzie „SN001028732"'
    ],
    added: [
      '<b>Uprawnienie: Edycja urządzeń</b> (<code>can_edit_devices</code>) — niezależne od roli Admina; zarządzanie w Konfiguracja → Użytkownicy'
    ]
  },
  {
    version: '1.9.7', date: '2026-06-02', added: [
      '<b>Typ urządzenia: Stare</b> — szara kategoria archiwalna; wykluczona z bilingów; filtr, pie chart, wykres typów',
      '<b>Oznaczanie zaimportowanych urządzeń typem</b> — select przy imporcie produkcji (Stare / OEM / Master / auto)',
      '<b>Historia importów</b> — tabela sesji z przyciskiem ↩ Cofnij',
      '<b>Bulk edycja</b> — zmiana firmy i operatora dla zaznaczonych; endpoint PATCH /devices/bulk'
    ]
  },
  {
    version: '1.9.6', date: '2026-06-02', added: [
      '<b>Tryb importu</b> — ➕ Dopisz brakujące (ON CONFLICT DO NOTHING) lub 🔄 Nadpisz istniejące'
    ]
  },
  {
    version: '1.9.5', date: '2026-06-02', added: [
      '<b>Zakładka 🆕 Pierwsze IDS</b> — weryfikacja pokrycia płatności po pierwszym abonamencie; siatka miesięcy per urządzenie; KPI; eksport XLSX'
    ]
  },
  {
    version: '1.9.4', date: '2026-06-02', added: [
      '<b>Zawieszone opłaty</b> — per urządzenie i per firma; badge ⏸ Zawieszone; niebieski wycinek w pie chart; sekcja zarządzania w modalu',
      '<b>Export/Import handlowców</b> — Excel; widok firm bez handlowca'
    ]
  },
  {
    version: '1.9.3', date: '2026-06-01', added: [
      '<b>Podgląd firm w bazie</b> — sekcja „🏢 Firmy w bazie" z wyszukiwarką i liczbą urządzeń'
    ]
  },
  {
    version: '1.9.2', date: '2026-06-01', added: [
      '<b>Historia scaleń firm</b> — tabela w sekcji Scalanie firm; tabela DB <code>firm_merges</code>'
    ]
  },
  {
    version: '1.9.1', date: '2026-06-01',
    fixed: ['<b>Crash przy zapisie opłaty licencyjnej</b> — undefined showMsg() → setMsg()'],
    changed: [
      'Scalanie firm przeniesione na górę Konfiguracji',
      'Autouzupełnianie firm w scalaniu z 3 źródeł; walidacja i normalizacja nazwy'
    ]
  },
  {
    version: '1.9.0', date: '2026-06-01',
    changed: [
      '<b>Refaktoring frontendu</b> — index.html podzielony na css/main.css + 10 plików JS (utils, auth, app, import, report, monitoring, config, firstpay, device, revenue)'
    ],
    fixed: ['showMsg undefined w sekcjach Opłaty licencyjne i Scalanie', 'loadMergeFirmaLists — błędny endpoint (Excel zamiast JSON)']
  },
  {
    version: '1.8.0', date: '2026-06-01', added: [
      '<b>Prognoza przychodów</b> — przerywana linia na wykresie trendu; średnia z ostatnich 3 miesięcy'
    ],
    changed: ['<b>Scalanie firm</b> — UI chip-based zamiast pola tekstowego']
  },
  {
    version: '1.7.0', date: '2026-06-01', added: [
      '<b>Wykres sezonowości produkcji</b> — linie rok-do-roku; filtr typu i modelu; X=Sty–Gru',
      '<b>Opłaty licencyjne</b> — pełne CRUD; tabela <code>firm_license_fees</code>',
      '<b>Scalanie firm</b> — podgląd przed wykonaniem; kaskadowe scalenie przez API'
    ],
    fixed: ['Popover ⓘ — lazy lookup; wymuszenie layout przed pozycjonowaniem']
  },
  {
    version: '1.6.0', date: '2026-06-01', added: [
      '<b>Zakładka 💰 Wyliczenia</b> — KPI, trend miesięczny, przychody roczne, top klienci, donut wg typu, tabela sortowalna; endpoint /revenue'
    ]
  },
  {
    version: '1.5.0', date: '2026-06-01', added: [
      'Filtr lat wykresu słupkowego; przycisk Rozwiń ⤢',
      'Globalny filtr dat w nagłówku',
      '<b>Kopiuj SN</b> — ikonka ⎘ przy każdym numerze seryjnym'
    ]
  },
  {
    version: '1.4.0', date: '2026-06-01', added: [
      '<b>Indeksy bazy danych</b> + <b>cache /analyze w RAM</b> — raport natychmiastowy; inwalidacja po każdym imporcie/edycji'
    ]
  },
  {
    version: '1.3.0', date: '2026-06-01', added: [
      'Kolumny kwot w imporcie: ob_CenaWaluta, ob_CenaNetto, ob_WartBrutto',
      'Historia płatności w zakładce Urządzenie — Netto PLN i Brutto PLN'
    ]
  },
  {
    version: '1.2.0', date: '2026-06-01', added: [
      'Historia płatności urządzenia w zakładce Monitoring'
    ],
    fixed: ['Scroll poziomy tabeli w Raporcie']
  },
  {
    version: '1.1.0', date: '2026-05-31', added: [
      '<b>Autoryzacja JWT</b> — logowanie emailem i hasłem; panel administracyjny',
      'Changelog / Release notes — przycisk wersji w nagłówku'
    ]
  },
  {
    version: '1.0.0', date: '2026-05-30', added: [
      'Pierwsza wersja: import produkcji + płatności, raport/dashboard, monitoring masterów, konfiguracja firm i handlowców, eksport Excel, dark mode'
    ]
  }
];

function showChangelog() {
  const modal = document.getElementById('changelogModal');
  const div   = document.getElementById('changelogContent');

  const sectionLabel = { added: '✅ Dodano', fixed: '🔧 Naprawiono', changed: '🔄 Zmieniono' };
  const sectionColor = { added: '#16a34a', fixed: '#d97706', changed: '#2563eb'  };

  div.innerHTML = CHANGELOG_ENTRIES.map(e => {
    const sections = ['added','fixed','changed']
      .filter(k => e[k]?.length)
      .map(k => `
        <div style="margin:8px 0 4px;font-size:11px;font-weight:700;color:${sectionColor[k]};
                    text-transform:uppercase;letter-spacing:.04em">${sectionLabel[k]}</div>
        <ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:3px">
          ${e[k].map(item => `<li style="font-size:13px;line-height:1.5">${item}</li>`).join('')}
        </ul>`).join('');

    return `
      <div style="border-bottom:1px solid var(--border);padding:14px 0 12px">
        <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px">
          <span style="font-weight:700;font-size:15px;color:var(--text)">v${e.version}</span>
          <span style="font-size:12px;color:var(--text-muted)">${e.date}</span>
        </div>
        ${sections}
      </div>`;
  }).join('');

  modal.showModal();
}
