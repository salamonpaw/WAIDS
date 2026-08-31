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
  const mode = document.querySelector('input[name="modeP"]:checked')?.value || 'append';
  const tag  = document.getElementById('importTypeTag')?.value || '';
  document.getElementById('btnProd').disabled = true;
  setMsg('msgProd', `⏳ Importuję ${files.length} plik(ów)…`);
  const form = new FormData();
  [...files].forEach(f => form.append('files', f));
  form.append('mode', mode);
  if (tag) form.append('device_type_tag', tag);
  try {
    const r = await fetch(`${API}/import/production`, { method:'POST', body:form });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || r.statusText);
    const skipNote = (d.skipped > 0)
      ? ` · pominięto ${d.skipped} istniejących` : '';
    const tagNote  = tag ? ` · oznaczono jako „${tag}"` : '';
    const warn = d.errors.length ? ` ⚠ ${d.errors.length} błędów: ${d.errors.join(' | ')}` : '';
    setMsg('msgProd', `✓ Dodano ${d.imported} urządzeń${skipNote}${tagNote}.${warn}`, d.errors.length?'':'ok');
    refreshStatus();
    loadImportHistory();
  } catch(e) { setMsg('msgProd', '❌ '+e.message, 'err'); }
  finally    { checkImportReady(); }
}

// ── Import payments ────────────────────────────────────────────────────────
async function importPayments() {
  const file = document.getElementById('filePay').files[0];
  if (!file) return;
  const mode = document.querySelector('input[name="modePay"]:checked')?.value || 'append';
  document.getElementById('btnPay').disabled = true;
  setMsg('msgPay', '⏳ Importuję płatności…');
  const form = new FormData();
  form.append('file', file);
  const ym = document.getElementById('yearMonth').value;
  if (ym) form.append('year_month', ym);
  form.append('mode', mode);
  try {
    const r = await fetch(`${API}/import/payments`, { method:'POST', body:form });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || r.statusText);
    const skipExist  = d.skipped > 0
      ? ` · pominięto ${d.skipped} istniejących` : '';
    const skipUnpaid = d.skipped_unpaid > 0
      ? ` · pominięto ${d.skipped_unpaid} nieopłaconych`
      : (d.pay_date_col ? '' : ' · ⚠ brak kolumny daty spłaty');
    const nettoInfo = d.netto_col
      ? ` · netto: "${d.netto_col}" (${d.netto_col_type === 'total' ? 'łączna ÷ mies.' : 'cena jedn./mies.'})`
      : ' · ⚠ brak kolumny netto';
    setMsg('msgPay',
      `✓ Dodano ${d.inserted} rekordów (${d.format}). Miesiące: ${d.months.join(', ')}${skipExist}${skipUnpaid}${nettoInfo}`,
      'ok');
    refreshStatus();
    loadImportHistory();
  } catch(e) { setMsg('msgPay', '❌ '+e.message, 'err'); }
  finally    { checkImportReady(); }
}

// ── Import history ─────────────────────────────────────────────────────────
function toggleImportHistory() {
  const body  = document.getElementById('importHistoryBody');
  const arrow = document.getElementById('importHistoryArrow');
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  arrow.textContent  = isOpen ? '▶' : '▼';
  if (!isOpen) loadImportHistory();
}

async function loadImportHistory() {
  const el = document.getElementById('importHistoryList');
  if (!el) return;
  el.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:.75rem">⏳ Ładowanie…</td></tr>';
  try {
    const r = await fetch(`${API}/import/sessions`);
    if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
    const d = await r.json();
    const sessions = d.sessions || [];
    if (!sessions.length) {
      el.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:.75rem">Brak historii importów.</td></tr>';
      return;
    }
    el.innerHTML = sessions.map(s => {
      const typeIcon = s.import_type === 'production' ? '🏭' : '💳';
      const typeLabel = s.import_type === 'production' ? 'Urządzenia' : 'Płatności';
      const tagBadge = s.device_type_tag
        ? `<span class="dt-badge stare" style="font-size:10px;padding:1px 6px">${esc(s.device_type_tag)}</span>`
        : '—';
      const skippedNote = s.records_skipped > 0
        ? `<span style="font-size:10px;color:var(--text-muted)"> / ${s.records_skipped} pom.</span>` : '';
      return `<tr>
        <td style="font-family:monospace;font-size:11px;color:var(--text-muted);white-space:nowrap">${esc(String(s.created_at).slice(0,16).replace('T',' '))}</td>
        <td style="font-size:12px">${typeIcon} ${typeLabel}</td>
        <td style="font-size:11px;color:var(--text-muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(s.filenames)}">${esc(s.filenames)}</td>
        <td style="text-align:center">
          <span style="color:var(--green);font-weight:600;font-size:12px">+${s.records_added}</span>${skippedNote}
        </td>
        <td style="text-align:center">${tagBadge}</td>
        <td style="text-align:right">
          <button onclick="undoImport(${s.id})"
                  style="padding:3px 10px;font-size:11px;border-radius:var(--radius-md);
                         background:none;border:1px solid var(--red);color:var(--red);cursor:pointer"
                  title="Cofnij ten import — usuwa zaimportowane rekordy">↩ Cofnij</button>
        </td>
      </tr>`;
    }).join('');
  } catch(e) {
    el.innerHTML = `<tr><td colspan="6" style="color:var(--red);padding:.75rem">❌ ${esc(e.message)}</td></tr>`;
  }
}

async function undoImport(id) {
  if (!confirm('Cofnąć ten import?\n\nUsunie to zaimportowane rekordy. Ręczne zmiany (typ, firma, handlowcy) nie zostaną cofnięte.')) return;
  try {
    const r = await fetch(`${API}/import/sessions/${id}`, { method: 'DELETE' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || r.statusText);
    const devDel = d.devices_deleted  || 0;
    const payDel = d.payments_deleted || 0;
    setMsg('msgImportHistory',
      `✓ Cofnięto import: usunięto ${devDel} urządzeń, ${payDel} rekordów płatności.`, 'ok');
    loadImportHistory();
    refreshStatus();
  } catch(e) {
    setMsg('msgImportHistory', '❌ ' + e.message, 'err');
  }
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
