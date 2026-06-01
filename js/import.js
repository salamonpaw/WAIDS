// ── WAIDS — import tab ────────────────────────────────────────────────────

// ── Drag-and-drop upload zones ─────────────────────────────────────────────
function setupZone(zoneId, inputId, nameId) {
  const zone = document.getElementById(zoneId);
  const inp  = document.getElementById(inputId);
  inp.addEventListener('change', () => {
    if (inp.files.length) {
      document.getElementById(nameId).textContent = [...inp.files].map(f=>f.name).join(', ');
      zone.classList.add('has-file'); checkImportReady();
    }
  });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.background='var(--bg-tertiary)'; });
  zone.addEventListener('dragleave', () => { zone.style.background=''; });
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.style.background='';
    const dt = new DataTransfer();
    [...e.dataTransfer.files].forEach(f => dt.items.add(f));
    inp.files = dt.files;
    document.getElementById(nameId).textContent = [...dt.files].map(f=>f.name).join(', ');
    zone.classList.add('has-file'); checkImportReady();
  });
}

// Scripts are at end of body — DOM is ready
setupZone('zoneP',   'fileP',   'nameP');
setupZone('zonePay', 'filePay', 'namePay');

function checkImportReady() {
  document.getElementById('btnProd').disabled = !document.getElementById('fileP').files.length;
  document.getElementById('btnPay').disabled  = !document.getElementById('filePay').files[0];
}

// ── Import production ──────────────────────────────────────────────────────
async function importProduction() {
  const files = document.getElementById('fileP').files;
  if (!files.length) return;
  document.getElementById('btnProd').disabled = true;
  setMsg('msgProd', `⏳ Importuję ${files.length} plik(ów)…`);
  const form = new FormData();
  [...files].forEach(f => form.append('files', f));
  try {
    const r = await fetch(`${API}/import/production`, { method:'POST', body:form });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || r.statusText);
    const warn = d.errors.length ? ` ⚠ ${d.errors.length} błędów: ${d.errors.join(' | ')}` : '';
    setMsg('msgProd', `✓ Zaimportowano ${d.imported} urządzeń.${warn}`, d.errors.length?'':'ok');
    refreshStatus();
  } catch(e) { setMsg('msgProd', '❌ '+e.message, 'err'); }
  finally    { checkImportReady(); }
}

// ── Import payments ────────────────────────────────────────────────────────
async function importPayments() {
  const file = document.getElementById('filePay').files[0];
  if (!file) return;
  document.getElementById('btnPay').disabled = true;
  setMsg('msgPay', '⏳ Importuję płatności…');
  const form = new FormData();
  form.append('file', file);
  const ym = document.getElementById('yearMonth').value;
  if (ym) form.append('year_month', ym);
  try {
    const r = await fetch(`${API}/import/payments`, { method:'POST', body:form });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || r.statusText);
    const skipNote = d.skipped_unpaid > 0
      ? ` · pominięto ${d.skipped_unpaid} nieopłaconych (brak daty spłaty)`
      : (d.pay_date_col ? '' : ' · ⚠ brak kolumny daty spłaty — nie walidowano');
    setMsg('msgPay', `✓ Zaimportowano ${d.inserted} rekordów (${d.format}). Miesiące: ${d.months.join(', ')}${skipNote}`, 'ok');
    refreshStatus();
  } catch(e) { setMsg('msgPay', '❌ '+e.message, 'err'); }
  finally    { checkImportReady(); }
}

async function confirmClearPayments() {
  const ym = document.getElementById('yearMonth').value;
  if (!confirm(ym ? `Usunąć płatności za ${ym}?` : 'Usunąć WSZYSTKIE płatności? (urządzenia pozostaną)')) return;
  try {
    const url = ym ? `${API}/import/payments?year_month=${ym}` : `${API}/import/payments`;
    const d = await (await fetch(url, {method:'DELETE'})).json();
    setMsg('msgPay', `✓ Usunięto ${d.deleted} rekordów.`, 'ok');
    refreshStatus();
  } catch(e) { setMsg('msgPay', '❌ '+e.message, 'err'); }
}

// ── Import templates ───────────────────────────────────────────────────────
function _xlsxDownload(wb, filename) {
  XLSX.writeFile(wb, filename);
}

function downloadTemplateProd() {
  const wb = XLSX.utils.book_new();
  const data = [
    ['tw_SN', 'Firma', 'Maszyna', 'Operator', 'Data produkcji'],
    ['ABC123',  'PRZYKŁADOWA SP. Z O.O.', 'D540 NEO M',   'Jan Kowalski',  '2025-03-15'],
    ['XYZ999',  'INNA FIRMA S.A.',         'D540 NEO OEM', 'Anna Nowak',    '2025-04-01'],
    ['QWE456',  '',                         'D530 M',       '',              '2025-05-20'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [14, 30, 18, 20, 16].map(wch => ({wch}));
  XLSX.utils.book_append_sheet(wb, ws, 'Produkcja');
  const info = XLSX.utils.aoa_to_sheet([
    ['Kolumna',         'Opis',                                                  'Wymagana?'],
    ['tw_SN',           'Numer seryjny urządzenia (alfanumeryczny, maks. 15 znaków)', 'TAK'],
    ['Firma',           'Nazwa firmy / klienta u którego zainstalowano urządzenie',   'nie'],
    ['Maszyna',         'Model urządzenia (OEM w nazwie → auto-typ OEM)',              'nie'],
    ['Operator',        'Osoba kontaktowa / operator urządzenia',                      'nie'],
    ['Data produkcji',  'Format: YYYY-MM-DD lub DD.MM.YYYY lub YYYY-MM',               'nie'],
    ['', '', ''],
    ['UWAGI', '', ''],
    ['• Możesz wgrać wiele plików jednocześnie (wszystkie zostaną zmergowane)', '', ''],
    ['• Duplikaty SN są nadpisywane (upsert)', '', ''],
    ['• Jeśli plik zawiera kolumnę "Wdrożeniowiec" — Operator i Firma zamieniają się miejscami', '', ''],
    ['• Akceptowane formaty pliku: .xlsx, .xls, .csv, .ods', '', ''],
  ]);
  info['!cols'] = [28, 58, 12].map(wch => ({wch}));
  XLSX.utils.book_append_sheet(wb, info, 'Instrukcja');
  _xlsxDownload(wb, 'szablon_produkcja.xlsx');
}

function downloadTemplatePivot() {
  const wb = XLSX.utils.book_new();
  const months = [];
  const now = new Date();
  for (let i = -6; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  const header   = ['tw_SN', 'adr_NazwaPelna', ...months];
  const example1 = ['ABC123', 'FIRMA PRZYKŁADOWA', ...months.map((_, i) => i < 4 ? 120.00 : '')];
  const example2 = ['XYZ999', 'INNA FIRMA S.A.',   ...months.map((_, i) => i < 6 ? 95.00  : '')];
  const ws = XLSX.utils.aoa_to_sheet([header, example1, example2]);
  ws['!cols'] = [14, 28, ...months.map(() => ({wch:11}))].map((w,i) => typeof w === 'number' ? {wch:w} : w);
  XLSX.utils.book_append_sheet(wb, ws, 'Płatności przestawne');
  const info = XLSX.utils.aoa_to_sheet([
    ['Kolumna',         'Opis'],
    ['tw_SN',           'Numer seryjny urządzenia — WYMAGANY'],
    ['adr_NazwaPelna',  'Nazwa klienta — opcjonalna'],
    ['YYYY-MM (kolumny)', 'Kwota opłaty za dany miesiąc. Pusta komórka lub 0 = brak opłaty.'],
    ['', ''],
    ['UWAGI', ''],
    ['• Kolumny miesięcy muszą być w formacie YYYY-MM (np. 2026-01)', ''],
    ['• Wartość w komórce może być kwotą (120.00) lub dowolnym tekstem ("TAK", "X")', ''],
    ['• Nie musisz podawać miesiąca ręcznie — system wykrywa go z nagłówków kolumn', ''],
  ]);
  info['!cols'] = [24, 55].map(wch => ({wch}));
  XLSX.utils.book_append_sheet(wb, info, 'Instrukcja');
  _xlsxDownload(wb, 'szablon_platnosci_przestawna.xlsx');
}

function downloadTemplateMonthly() {
  const wb   = XLSX.utils.book_new();
  const curYM = nowYM();
  const ws = XLSX.utils.aoa_to_sheet([
    ['tw_SN',   'adr_NazwaPelna',              'Kwota',  'Waluta', 'Oplacony'],
    ['ABC123',  'FIRMA PRZYKŁADOWA SP. Z O.O.', 120.00,  'PLN',    'TAK'],
    ['XYZ999',  'INNA FIRMA S.A.',               95.00,  'PLN',    'TAK'],
    ['QWE456',  'FIRMA BEZ OPŁATY',                  0,  '',       'NIE'],
  ]);
  ws['!cols'] = [14, 32, 10, 8, 10].map(wch => ({wch}));
  XLSX.utils.book_append_sheet(wb, ws, `Płatności ${curYM}`);
  const info = XLSX.utils.aoa_to_sheet([
    ['Kolumna',        'Opis',                                              'Wymagana?'],
    ['tw_SN',          'Numer seryjny urządzenia',                          'TAK'],
    ['adr_NazwaPelna', 'Nazwa klienta',                                     'nie'],
    ['Kwota',          'Kwota opłaty (liczba, np. 120.00)',                  'nie'],
    ['Waluta',         'Waluta (PLN, EUR, USD)',                             'nie'],
    ['Oplacony',       'TAK / NIE / 1 / 0 — wiersze z NIE/0 są pomijane',  'nie'],
    ['', '', ''],
    ['WAŻNE: wpisz miesiąc ręcznie w polu "Miesiąc płatności" przed importem tego pliku!', '', ''],
    ['Format miesiąca: YYYY-MM  np. ' + curYM, '', ''],
  ]);
  info['!cols'] = [22, 50, 12].map(wch => ({wch}));
  XLSX.utils.book_append_sheet(wb, info, 'Instrukcja');
  _xlsxDownload(wb, `szablon_platnosci_lista_${curYM}.xlsx`);
}
