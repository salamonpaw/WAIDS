// ── WAIDS — przewodnik po aplikacji (driver.js) ────────────────────────────
// Tura dla każdej zakładki, odpalana automatycznie przy pierwszym wejściu
// (zapamiętane w localStorage, nie powtarza się) + ręcznie przyciskiem „❓ Pomoc”
// w nagłówku dla aktualnie otwartej zakładki.
//
// Elementy spoza DOM bieżącej zakładki są pomijane (np. gdy użytkownik nie ma
// uprawnienia do panelu admina) — _driverSteps() filtruje po querySelector.

let _currentTabName = 'import';

const TOURS = {
  import: [
    { element: '.section-title', popover: {
      title: '🏭 Import danych', description: 'Tu zaczyna się wszystko — wgrywasz plik produkcji (numery seryjne, model, data) i plik płatności z ERP. Reszta aplikacji liczy się z tych dwóch źródeł.' } },
    { element: '#zoneP', popover: {
      title: 'Plik produkcji', description: 'Przeciągnij lub wybierz plik (xlsx/csv/ods) z listą wyprodukowanych urządzeń.' } },
    { element: '#btnProd', popover: {
      title: 'Tryb importu', description: '„Dopisz” pomija już zaimportowane numery seryjne. „Nadpisz” aktualizuje istniejące rekordy nowymi danymi.' } },
    { element: '#zonePay', popover: {
      title: 'Plik płatności', description: 'Rozpoznaje automatycznie format IDS (surowy eksport z ERP), tabelę przestawną (kolumny = miesiące) albo prostą listę miesięczną.' } },
    { element: '#importHistoryArrow', popover: {
      title: 'Historia importów', description: 'Każdy wgrany plik można tu cofnąć (undo), jeśli coś poszło nie tak.' } },
  ],

  report: [
    { element: '.kpi-grid', popover: {
      title: '📊 Kluczowe liczby', description: 'Ile urządzeń jest w bazie, ile ma opłacony abonament, a ile nie — licząc tylko urządzenia typu master.' } },
    { element: '#chartPie', popover: {
      title: 'Status abonamentów', description: 'Kliknij wycinek wykresu, żeby przefiltrować tabelę poniżej do tego statusu.' } },
    { element: '#fSearch', popover: {
      title: 'Szukaj', description: 'Szukaj po numerze seryjnym, nazwie firmy, modelu maszyny albo kliencie.' } },
    { element: '#filtersBar', popover: {
      title: 'Filtry', description: 'Status, typ firmy, typ urządzenia, handlowiec, zakres dat produkcji, zaległości — można łączyć dowolnie.' } },
  ],

  monitor: [
    { element: '#monFirma', popover: {
      title: '📈 Monitoring nowych masterów', description: 'Sprawdzasz tu, które nowo wyprodukowane mastery zaczęły płacić abonament i kiedy dokładnie.' } },
    { element: '#monProdFrom', popover: {
      title: 'Data produkcji od', description: 'Wybierz miesiąc produkcji i kliknij „Zastosuj” — zobaczysz urządzenia wyprodukowane od tej daty i status ich pierwszej płatności.' } },
    { element: '#monIdsOnly', popover: {
      title: 'Tylko IDS', description: 'Domyślnie liczone są tylko firmy z typem IDS (abonament cykliczny). Odhacz, żeby zobaczyć też Licencję, OEM i Inne.' } },
  ],

  firstpay: [
    { element: '.section-title', popover: {
      title: '🆕 Nowe płatności', description: 'Kontrola, czy nowo wyprodukowane urządzenia dostały już pierwszą płatność abonamentu — i ile miesięcy to zajęło.' } },
    { element: '#fpMonthTo', popover: {
      title: 'Zakres dat', description: 'Zawęź do konkretnego okresu produkcji, jeśli interesuje Cię tylko któryś miesiąc.' } },
  ],

  device: [
    { element: '#snSearchInput', popover: {
      title: '🔍 Wyszukiwarka urządzeń', description: 'Wpisz numer seryjny (działa też bez wiodących zer) i wciśnij Enter albo „Szukaj”.' } },
    { element: '#snSearchResult', popover: {
      title: 'Karta urządzenia', description: 'Zobaczysz dane urządzenia i pełną historię płatności miesiąc po miesiącu.' } },
  ],

  revenue: [
    { element: '#revKpiGrid', popover: {
      title: '💰 Wyliczenia — przychody', description: 'Przychody netto w PLN, podzbiór w EUR, liczba płacących urządzeń i klientów — filtrowane rokiem z selektora w prawym górnym rogu.' } },
    { element: '#revCurrencySection', popover: {
      title: 'Przychody wg waluty', description: 'Pełny rozkład wszystkich przychodów (zawsze za wszystkie lata) wg waluty faktury — PLN, EUR, USD, GBP. To te same pieniądze co w kafelku PLN netto, tylko podzielone wg waluty, nie coś dodatkowego.' } },
    { element: '#chartRevTrend', popover: {
      title: 'Trend miesięczny', description: 'Kliknij słupek, żeby przefiltrować Top klientów do tego miesiąca.' } },
    { element: '#revTableSearch', popover: {
      title: 'Tabela klientów', description: 'Pełna lista klientów z przychodem, liczbą urządzeń i płatności — szukaj i sortuj klikając nagłówki.' } },
  ],

  bonus: [
    { element: '.section-title', popover: {
      title: '🆕 Pierwsze IDS', description: 'Lista nowych urządzeń per handlowiec — do rozliczania bonusu za pierwsze podłączenie klienta do abonamentu IDS.' } },
  ],

  commissions: [
    { element: '.section-title', popover: {
      title: '💸 Prowizje', description: 'Stawki prowizji dla handlowców i rozliczenia za wybrane okresy.' } },
    { element: '#commRatesTable', popover: {
      title: 'Stawki prowizji', description: 'Tu ustawiasz procent prowizji per handlowiec — zmiana obowiązuje od wskazanej daty.' } },
  ],

  pricing: [
    { element: '.section-title', popover: {
      title: '📈 Analiza pricingu IDS', description: 'Klasyfikuje klientów wg ceny abonamentu, którą faktycznie płacą — do wykrywania zaniżonych stawek i planowania podwyżek.' } },
  ],

  segmentation: [
    { element: '#segHeaderTitle', popover: {
      title: '🎯 Segmentacja klientów (A–D)', description: 'Segment wynika z wolumenu zamówień w jednostkach produkcyjnych (JP), przeliczonego zawsze na 12 miesięcy: A ≥30 JP, B ≥8, C ≥3, D poniżej 3.' } },
    { element: '#segOd', popover: {
      title: 'Okres', description: 'Wybierz zakres dat albo użyj gotowego presetu (ostatnie 12 mies., bieżący/poprzedni rok, ostatni kwartał).' } },
    { element: '#segCmp', popover: {
      title: 'Okres porównawczy', description: 'Ustaw „rok wcześniej” albo „poprzedni okres”, żeby zobaczyć kolumny Migracja i Zmiana r/r w tabeli oraz macierz migracji niżej.' } },
    { element: '#segYearPills', popover: {
      title: 'Segmenty w latach', description: 'Pilki wybierają, które lata pokazać jako osobne kolumny w tabeli — bieżący rok oznaczony gwiazdką, bo jest niepełny.' } },
    { element: '#segKpiGrid', popover: {
      title: 'KPI per segment', description: 'Liczba klientów i suma JP w każdym segmencie dla wybranego okresu.' } },
    { element: '#chartSegJpTime', popover: {
      title: 'Wykresy w czasie', description: 'Pokazują historię segmentów miesiąc po miesiącu — wymagają wcześniejszego wygenerowania zrzutów (panel admina niżej, sekcja „Zrzuty miesięczne”).' } },
    { element: '#segMigrationSection', popover: {
      title: 'Macierz migracji', description: 'Wiersze = segment w okresie porównawczym, kolumny = segment teraz. Kliknij komórkę, żeby przefiltrować tabelę klientów do tej migracji.' } },
    { element: '#segCustomerTable', popover: {
      title: 'Tabela klientów', description: 'Kliknij dowolny wiersz, żeby otworzyć kartę klienta — historię segmentu, JP miesięcznie i miks modeli.' } },
    { element: '#segModelsPanel', popover: {
      title: 'Słownik modeli (Admin)', description: 'Tu dodajesz, edytujesz i usuwasz przelicznik JP dla każdego modelu maszyny. Model spoza słownika zgłasza czerwony alert nad tabelą klientów zamiast cicho zniknąć z wyliczeń.' } },
    { element: '#segThresholdsPanel', popover: {
      title: 'Progi segmentacji (Admin)', description: 'Zmiana progów A/B/C (i pozostałych) zapisuje się jako NOWA wersja — poprzednia zostaje w historii i nadal obowiązuje dla już zapisanych zrzutów miesięcznych, dopóki świadomie ich nie przeliczysz.' } },
  ],

  arrears: [
    { element: 'h2', popover: {
      title: '⚠ Zaległości abonamentowe', description: 'Urządzenia, które od dłuższego czasu nie mają zarejestrowanej płatności — ustaw próg miesięcy, żeby zawęzić listę.' } },
    { element: '#arrRepFilter', popover: {
      title: 'Filtr handlowca', description: 'Zawęź listę zaległości do konkretnego opiekuna klienta.' } },
  ],

  sales: [
    { element: 'h2', popover: {
      title: '📦 Zakupy per klient', description: 'Zestawienie wyprodukowanych maszyn per firma w wybranym zakresie dat — to raport produkcyjny, pokazuje WSZYSTKIE maszyny niezależnie od statusu abonamentu.' } },
  ],

  config: [
    { element: '.section-title', popover: {
      title: '⚙ Konfiguracja', description: 'Zarządzanie użytkownikami i ich uprawnieniami (tylko administrator), typy firm, handlowcy, opłaty licencyjne.' } },
  ],
};

function _driverSteps(tabName) {
  const scope = document.getElementById('tab-' + tabName);
  if (!scope) return [];
  const steps = TOURS[tabName] || [];
  // Selektory jak '.section-title' czy 'h2' powtarzają się na wielu zakładkach —
  // szukamy TYLKO wewnątrz panelu tej zakładki (scope.querySelector, nie document),
  // i przekazujemy do driver.js już rozwiązany element, nie string selektora.
  // Pomija też kroki, których element nie istnieje LUB jest ukryty (display:none) —
  // np. panel admina do progów/słownika modeli widoczny tylko dla is_admin. Element
  // istnieje wtedy w DOM, ale querySelector sam tego nie odfiltruje — stąd offsetParent.
  return steps
    .map(s => ({ el: scope.querySelector(s.element), popover: s.popover }))
    .filter(s => s.el && s.el.offsetParent !== null)
    .map(s => ({ element: s.el, popover: s.popover }));
}

function startTour(tabName) {
  if (typeof driver === 'undefined') return;   // CDN nie wczytał się (np. brak internetu)
  const steps = _driverSteps(tabName);
  if (!steps.length) return;
  const driverObj = driver.js.driver({
    showProgress: true,
    nextBtnText: 'Dalej →',
    prevBtnText: '← Wstecz',
    doneBtnText: 'Gotowe',
    progressText: '{{current}} / {{total}}',
    steps,
  });
  driverObj.drive();
}

function startTourForCurrentTab() {
  startTour(_currentTabName);
}

function maybeAutoStartTour(tabName) {
  _currentTabName = tabName;
  const key = 'waids_tour_seen_' + tabName;
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, '1');
  // Mały odstęp — niech zakładka zdąży się pokazać (animacje/layout) zanim driver.js
  // zmierzy pozycje elementów.
  setTimeout(() => startTour(tabName), 400);
}
