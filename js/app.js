// ── WAIDS — app shell: tab switching, status bar, changelog ──────────────

// ── Tab switching ──────────────────────────────────────────────────────────
const ADMIN_TABS = ['revenue', 'config'];

function switchTab(name) {
  if (ADMIN_TABS.includes(name) && !currentUser?.is_admin) return;
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  event.currentTarget.classList.add('active');
  if (name === 'report')   loadReport();
  if (name === 'monitor')  loadMonitoringTab();
  if (name === 'firstpay') loadFirstPayTab();
  if (name === 'device')   { /* data loaded on demand via searchBySN() */ }
  if (name === 'revenue')  { loadRevenue(); loadSeasonality(); }
  if (name === 'bonus')    { loadBonusTab(); }
  if (name === 'config')   { loadConfig(); loadLicenseFees(); }
}

function applyAdminTabs() {
  const isAdmin = currentUser?.is_admin || false;
  document.getElementById('tabBtnRevenue').style.display = isAdmin ? '' : 'none';
  document.getElementById('tabBtnConfig').style.display  = isAdmin ? '' : 'none';
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
