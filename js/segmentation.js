// ── WAIDS — Segmentacja klientów A–D (wolumen JP) — etap 1 + 2 ────────────
// Etap 1: tabela klientów. Etap 2: trend/migracja, segmenty w latach, zrzuty
// miesięczne + wykresy w czasie, macierz migracji, karta klienta.
// Etap 3 (później): panel admina do progów/słownika modeli.

let _segData     = null;
let _segMigData  = null;
let _segSortKey  = 'jp_okres_filtr';
let _segSortAsc  = false;
let _segSearch   = '';
let _segYears    = [];          // lata wybrane do kolumn "Segmenty w latach"
let _segMigFilter = null;       // {segment_p0, segment_p1} po kliknięciu komórki macierzy

let chartSegJpTime    = null;
let chartSegCountTime = null;
let chartSegCustMonthly = null;
let chartSegCustHistory = null;

const SEG_LABELS = {
  A: 'partner strategiczny', B: 'partner rozwojowy',
  C: 'partner aktywny',      D: 'klient okazjonalny',
};
const SEG_ORDER = ['A', 'B', 'C', 'D', 'brak'];
const MIGRATION_ARROW = {
  awans: '<span style="color:var(--green)">▲</span>',
  spadek: '<span style="color:var(--red)">▼</span>',
  bez_zmian: '<span style="color:var(--text-muted)">▬</span>',
  nowy: '<span style="color:#1F77B4">●</span>',
  utracony: '<span style="color:var(--red)">✕</span>',
};
const TREND_LABEL = { wzrost: '📈 wzrost', spadek: '📉 spadek', stabilny: '➖ stabilny', nowy: '🆕 nowy' };

// ── Init / presety dat ──────────────────────────────────────────────────────
async function onTabSegmentation() {
  if (currentUser?.is_admin) {
    ['segAdminPanel', 'segModelsPanel', 'segThresholdsPanel'].forEach(id => {
      const panel = document.getElementById(id);
      if (panel) panel.style.display = 'block';
    });
    loadSegModelsAdmin();
    loadSegThresholdsAdmin();
  }
  if (!_segYears.length) {
    const y = new Date().getFullYear();
    _segYears = [y, y - 1, y - 2];
    renderSegYearPills();
  }
  if (document.getElementById('segModel').options.length === 0) {
    await loadSegModelsFilter();
  }
  if (!document.getElementById('segOd').value || !document.getElementById('segDo').value) {
    setSegPreset('last12');   // woła loadSegmentation()
  } else {
    loadSegmentation();
  }
}

function _segLastClosedMonthEnd() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 0);   // dzień 0 = ostatni dzień poprz. mies.
}
function _segFmtD(d) { return d.toISOString().slice(0, 10); }

function setSegPreset(p) {
  const end = _segLastClosedMonthEnd();
  let od, doD;
  if (p === 'last12') {
    od = new Date(end.getFullYear(), end.getMonth() - 11, 1);
    doD = end;
  } else if (p === 'curr_year') {
    od = new Date(new Date().getFullYear(), 0, 1);
    doD = end;
  } else if (p === 'prev_year') {
    const y = new Date().getFullYear() - 1;
    od = new Date(y, 0, 1); doD = new Date(y, 11, 31);
  } else if (p === 'last_q') {
    od = new Date(end.getFullYear(), end.getMonth() - 2, 1);
    doD = end;
  } else return;
  document.getElementById('segOd').value = _segFmtD(od);
  document.getElementById('segDo').value = _segFmtD(doD);
  loadSegmentation();
}

function renderSegYearPills() {
  const wrap = document.getElementById('segYearPills');
  if (!wrap) return;
  const curY = new Date().getFullYear();
  const candidates = [curY, curY - 1, curY - 2, curY - 3, curY - 4];
  wrap.innerHTML = candidates.map(y => {
    const active = _segYears.includes(y);
    return `<button class="year-pill${active ? ' active' : ''}" onclick="toggleSegYear(${y})">${y}${y === curY ? '*' : ''}</button>`;
  }).join('');
}

function toggleSegYear(y) {
  const i = _segYears.indexOf(y);
  if (i >= 0) _segYears.splice(i, 1); else _segYears.push(y);
  _segYears.sort();
  renderSegYearPills();
  loadSegmentation();
}

async function loadSegModelsFilter() {
  try {
    const models = await (await fetch(`${API}/segmentation/models`)).json();
    const sel = document.getElementById('segModel');
    const uniq = [...new Set(models.map(m => m.kod_modelu))].sort();
    sel.innerHTML = uniq.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join('');
  } catch { /* filtr modeli nieistotny jeśli padnie — tabela i tak zadziała bez niego */ }
}

// ── Load ─────────────────────────────────────────────────────────────────
async function loadSegmentation() {
  const od = document.getElementById('segOd').value;
  const doV = document.getElementById('segDo').value;
  if (!od || !doV) { setMsg('segMsg', 'Ustaw zakres dat (Od / Do).', 'err'); return; }

  const typ = document.getElementById('segTyp').value;
  const cmp = document.getElementById('segCmp').value;
  const modelSel = document.getElementById('segModel');
  const models = [...modelSel.selectedOptions].map(o => o.value);

  const tbody = document.getElementById('segTableBody');
  tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;color:var(--text-muted);padding:2rem">⏳ Liczenie…</td></tr>';
  setMsg('segMsg', '', '');
  _segMigFilter = null;

  const qs = new URLSearchParams({ od, do: doV });
  if (typ) qs.set('typ', typ);
  if (models.length) qs.set('model', models.join(','));
  if (cmp) qs.set('cmp', cmp);
  if (_segYears.length) qs.set('years', _segYears.join(','));

  try {
    const r = await fetch(`${API}/segmentation/customers?${qs}`);
    if (!r.ok) throw new Error((await r.json()).detail || ('HTTP ' + r.status));
    _segData = await r.json();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;color:var(--red);padding:2rem">❌ ${esc(e.message)}</td></tr>`;
    return;
  }

  document.getElementById('segPeriodLbl').textContent =
    `${od} → ${doV} (${_segData.okres_miesiecy} mies.)`;

  const warnEl = document.getElementById('segWarnShort');
  if (_segData.okres_za_krotki) {
    document.getElementById('segMinMies').textContent   = _segData.min_miesiecy_okresu;
    document.getElementById('segOkresMies').textContent = _segData.okres_miesiecy;
    warnEl.style.display = 'block';
  } else {
    warnEl.style.display = 'none';
  }

  const unmappedEl = document.getElementById('segUnmapped');
  if (currentUser?.is_admin && _segData.unmapped_models.length) {
    const total = _segData.unmapped_models.reduce((s, m) => s + m.sztuki, 0);
    unmappedEl.innerHTML = `⚠️ <b>${total} szt.</b> z modelami spoza słownika JP (pominięte z segmentacji — dodaj je w słowniku modeli): ` +
      _segData.unmapped_models.slice(0, 8).map(m => `${esc(m.maszyna)} (${m.sztuki})`).join(', ') +
      (_segData.unmapped_models.length > 8 ? '…' : '');
    unmappedEl.style.display = 'block';
  } else {
    unmappedEl.style.display = 'none';
  }

  renderSegKPI();
  renderSegTableHead();
  renderSegTable();
  loadSegOverview();

  if (cmp && _segData.okres_porownawczy) {
    loadSegMigration(_segData.okres_porownawczy.od, _segData.okres_porownawczy.do, od, doV);
  } else {
    _segMigData = null;
    document.getElementById('segMigrationBody').innerHTML =
      '<div style="text-align:center;color:var(--text-muted);padding:1rem;font-size:12px">Ustaw „Okres porównawczy” powyżej, żeby zobaczyć migrację.</div>';
  }
}

// ── KPI ──────────────────────────────────────────────────────────────────
function renderSegKPI() {
  const grid = document.getElementById('segKpiGrid');
  const sc = _segData.segment_counts || {};
  let html =
    `<div class="kpi"><div class="kpi-label">Klienci aktywni</div><div class="kpi-value">${fmtNum(_segData.total_customers)}</div></div>` +
    `<div class="kpi teal"><div class="kpi-label">JP w okresie</div><div class="kpi-value">${fmtNum(_segData.total_jp)}</div></div>`;

  for (const s of ['A', 'B', 'C', 'D']) {
    const d = sc[s] || { klienci: 0, jp: 0 };
    html += `<div class="kpi">
      <div class="kpi-label"><span class="seg-badge seg-${s}">${s}</span> ${SEG_LABELS[s]}</div>
      <div class="kpi-value">${fmtNum(d.klienci)}</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${fmtNum(d.jp)} JP</div>
    </div>`;
  }
  if (sc['brak']) {
    html += `<div class="kpi">
      <div class="kpi-label"><span class="seg-badge seg-brak">—</span> Brak zakupów</div>
      <div class="kpi-value">${fmtNum(sc['brak'].klienci)}</div>
    </div>`;
  }
  grid.innerHTML = html;
}

// ── Tabela klientów — nagłówek dynamiczny (kolumny lat) ─────────────────────
function renderSegTableHead() {
  const thead = document.getElementById('segTableHead');
  if (!thead) return;
  const hasCmp = !!(_segData && _segData.okres_porownawczy);
  const yearCols = _segYears.map(y =>
    `<th title="Segment za rok kalendarzowy ${y}${_segData?.segments_by_year_meta?.[y] && !_segData.segments_by_year_meta[y].pelny_rok ? ' (niepełny, do końca ostatniego zamkniętego miesiąca)' : ''}">${y}${_segData?.segments_by_year_meta?.[y] && !_segData.segments_by_year_meta[y].pelny_rok ? '*' : ''}</th>`
  ).join('');
  const cmpCols = hasCmp
    ? `<th title="Kierunek zmiany segmentu względem okresu porównawczego">Migracja</th>
       <th class="num rev-sort-icon" onclick="sortSegTable('zmiana_rr')" title="Zmiana JP/12mies względem okresu porównawczego">Zmiana r/r ↕</th>`
    : '';
  thead.innerHTML = `<tr>
    <th>#</th>
    <th onclick="sortSegTable('firma')" class="rev-sort-icon">Klient ↕</th>
    ${yearCols}
    <th onclick="sortSegTable('segment')" class="rev-sort-icon">Segment ↕</th>
    ${cmpCols}
    <th class="num rev-sort-icon" onclick="sortSegTable('jp_okres_filtr')">JP (okres) ↕</th>
    <th class="num rev-sort-icon" onclick="sortSegTable('jp12')">JP/12mies ↕</th>
    <th class="num rev-sort-icon" onclick="sortSegTable('jp_miesiecznie')">JP/mies ↕</th>
    <th class="num rev-sort-icon" onclick="sortSegTable('sztuki_filtr')">Sztuki ↕</th>
    <th class="num rev-sort-icon" onclick="sortSegTable('liczba_modeli')">Modele ↕</th>
    <th class="num rev-sort-icon" onclick="sortSegTable('udzial_oem')">Udział OEM ↕</th>
    <th class="num rev-sort-icon" onclick="sortSegTable('do_wyzszego_segmentu')">Do wyż. segmentu ↕</th>
    <th class="num rev-sort-icon" onclick="sortSegTable('udzial_w_jp')">Udział w JP ↕</th>
    <th class="num rev-sort-icon" onclick="sortSegTable('udzial_narastajaco')">Narastająco ↕</th>
  </tr>`;
}

function _segRows() {
  let rows = _segData.customers;
  if (_segSearch) {
    const q = _segSearch.toLowerCase();
    rows = rows.filter(c => c.firma.toLowerCase().includes(q));
  }
  if (_segMigFilter) {
    rows = rows.filter(c => c.segment_p0 === _segMigFilter.segment_p0 && c.segment === _segMigFilter.segment_p1);
  }
  return [...rows].sort((a, b) => {
    const va = a[_segSortKey], vb = b[_segSortKey];
    const na = typeof va === 'number' ? va : (va ?? '').toString().toLowerCase();
    const nb = typeof vb === 'number' ? vb : (vb ?? '').toString().toLowerCase();
    if (na < nb) return _segSortAsc ? -1 : 1;
    if (na > nb) return _segSortAsc ? 1 : -1;
    return 0;
  });
}

function renderSegTable() {
  const tbody = document.getElementById('segTableBody');
  if (!_segData) return;
  const rows = _segRows();
  const hasCmp = !!_segData.okres_porownawczy;
  const colCount = 12 + _segYears.length + (hasCmp ? 2 : 0);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;color:var(--text-muted);padding:2rem">Brak klientów w wybranym okresie${_segMigFilter ? ' dla tej komórki migracji' : ''}.</td></tr>`;
    return;
  }
  const zaKrotki = _segData.okres_za_krotki;
  tbody.innerHTML = rows.map((c, i) => {
    const flags =
      (c.profil_oem ? '<span class="seg-flag oem" title="Udział OEM w JP ≥ progu profilu OEM">OEM</span>' : '') +
      (c.na_granicy ? '<span class="seg-flag granica" title="Blisko wyższego segmentu">↑ blisko progu</span>' : '');
    const label = c.segment === 'brak' ? '—' : c.segment;
    const segBadge = `<span class="seg-badge seg-${c.segment}${zaKrotki ? ' seg-za-krotki' : ''}"` +
      (zaKrotki ? ` title="Okres krótszy niż ${_segData.min_miesiecy_okresu} mies. — ostrożnie z wynikiem"` : '') +
      `>${label}</span>`;

    const yearCells = _segYears.map(y => {
      const s = c.segments_by_year?.[y] ?? 'brak';
      const lbl = s === 'brak' ? '—' : s;
      return `<td><span class="seg-badge seg-${s}" style="font-size:10px;padding:1px 6px">${lbl}</span></td>`;
    }).join('');

    let cmpCells = '';
    if (hasCmp) {
      const arrow = MIGRATION_ARROW[c.kierunek_migracji] || '';
      const trendTxt = c.trend ? (TREND_LABEL[c.trend] || c.trend) : '—';
      const zmianaTxt = c.zmiana_rr === null || c.zmiana_rr === undefined ? '—'
        : `${c.zmiana_rr > 0 ? '+' : ''}${c.zmiana_rr.toFixed(1)}%`;
      cmpCells = `
        <td title="${esc(c.segment_p0)} → ${esc(c.segment)}">${arrow} ${esc(c.segment_p0)}→${esc(c.segment)}</td>
        <td class="num" title="${esc(trendTxt)}">${zmianaTxt}</td>`;
    }

    return `<tr style="cursor:pointer" onclick="openSegCustomerCard('${esc(c.firma).replace(/'/g, "\\'")}')">
      <td>${i + 1}</td>
      <td>${esc(c.firma)} ${flags}</td>
      ${yearCells}
      <td>${segBadge}</td>
      ${cmpCells}
      <td class="num">${c.jp_okres_filtr.toFixed(1)}</td>
      <td class="num">${c.jp12.toFixed(1)}</td>
      <td class="num">${c.jp_miesiecznie.toFixed(2)}</td>
      <td class="num">${fmtNum(c.sztuki_filtr)}</td>
      <td class="num">${fmtNum(c.liczba_modeli)}</td>
      <td class="num">${c.udzial_oem.toFixed(1)}%</td>
      <td class="num">${c.do_wyzszego_segmentu === null ? '—' : c.do_wyzszego_segmentu.toFixed(1) + ' JP'}</td>
      <td class="num">${c.udzial_w_jp.toFixed(1)}%</td>
      <td class="num">${c.udzial_narastajaco.toFixed(1)}%</td>
    </tr>`;
  }).join('');
}

function sortSegTable(key) {
  if (_segSortKey === key) _segSortAsc = !_segSortAsc;
  else { _segSortKey = key; _segSortAsc = false; }
  renderSegTable();
}

function filterSegTable() {
  _segSearch = document.getElementById('segSearch').value.trim();
  renderSegTable();
}

// ── Macierz migracji ─────────────────────────────────────────────────────
async function loadSegMigration(od0, do0, od1, do1) {
  const body = document.getElementById('segMigrationBody');
  body.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1rem;font-size:12px">⏳ Liczenie…</div>';
  try {
    const qs = new URLSearchParams({ od0, do0, od1, do1 });
    const r = await fetch(`${API}/segmentation/migration?${qs}`);
    if (!r.ok) throw new Error((await r.json()).detail || ('HTTP ' + r.status));
    _segMigData = await r.json();
  } catch (e) {
    body.innerHTML = `<div style="color:var(--red);padding:1rem;font-size:12px">❌ ${esc(e.message)}</div>`;
    return;
  }
  renderSegMigration();
}

function renderSegMigration() {
  const body = document.getElementById('segMigrationBody');
  if (!_segMigData) return;
  const m = _segMigData;
  const cell = (s0, s1) => m.matrix.find(x => x.segment_p0 === s0 && x.segment_p1 === s1);

  let html = `<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">
    P0: ${m.okres_p0.od} → ${m.okres_p0.do} (${m.okres_p0.miesiecy} mies.) &nbsp;→&nbsp;
    P1: ${m.okres_p1.od} → ${m.okres_p1.do} (${m.okres_p1.miesiecy} mies.)
  </div>`;
  html += `<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px;font-size:12px">
    <span>${MIGRATION_ARROW.awans} Awanse: <b>${m.summary.awans}</b></span>
    <span>${MIGRATION_ARROW.spadek} Spadki: <b>${m.summary.spadek}</b></span>
    <span>${MIGRATION_ARROW.nowy} Nowi: <b>${m.summary.nowy}</b></span>
    <span>${MIGRATION_ARROW.utracony} Utraceni: <b>${m.summary.utracony}</b></span>
    <span>${MIGRATION_ARROW.bez_zmian} Bez zmian: <b>${m.summary.bez_zmian}</b></span>
  </div>`;

  html += '<div style="overflow-x:auto"><table class="rev-table" style="width:auto"><thead><tr><th>P0 \\ P1</th>' +
    SEG_ORDER.map(s => `<th class="num">${s === 'brak' ? '—' : s}</th>`).join('') + '</tr></thead><tbody>';
  for (const s0 of SEG_ORDER) {
    html += `<tr><th>${s0 === 'brak' ? '—' : s0}</th>`;
    for (const s1 of SEG_ORDER) {
      const c = cell(s0, s1);
      const n = c ? c.klienci : 0;
      const jp = c ? c.jp : 0;
      const diag = s0 === s1;
      const active = _segMigFilter && _segMigFilter.segment_p0 === s0 && _segMigFilter.segment_p1 === s1;
      const bg = n === 0 ? 'transparent' : diag ? 'var(--bg-secondary)' : (SEG_ORDER.indexOf(s1) < SEG_ORDER.indexOf(s0) ? 'var(--green-light)' : 'var(--red-light)');
      html += `<td class="num" style="cursor:${n ? 'pointer' : 'default'};background:${active ? 'var(--teal-light)' : bg}"
                   onclick="${n ? `segFilterMigrationCell('${s0}','${s1}')` : ''}"
                   title="${n} klientów, ${jp.toFixed(1)} JP">${n || '—'}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  html += '<div class="chart-hint">💡 Kliknij komórkę, żeby przefiltrować tabelę klientów poniżej do tej migracji.</div>';
  body.innerHTML = html;
}

function segFilterMigrationCell(s0, s1) {
  if (_segMigFilter && _segMigFilter.segment_p0 === s0 && _segMigFilter.segment_p1 === s1) {
    _segMigFilter = null;   // kliknięcie tej samej komórki = wyczyść filtr
  } else {
    _segMigFilter = { segment_p0: s0, segment_p1: s1 };
  }
  renderSegMigration();
  renderSegTable();
}

// ── Wykresy w czasie (seg_snapshots) ────────────────────────────────────────
async function loadSegOverview() {
  const monthsParam = document.getElementById('segOverviewMonths')?.value || 24;
  let rows = [];
  try {
    rows = await (await fetch(`${API}/segmentation/overview?months=${monthsParam}`)).json();
  } catch { /* cicho — wykresy po prostu zostaną puste */ }

  const emptyEl = document.getElementById('segOverviewEmpty');
  if (!rows.length) {
    if (emptyEl) emptyEl.style.display = 'block';
    if (chartSegJpTime) { chartSegJpTime.destroy(); chartSegJpTime = null; }
    if (chartSegCountTime) { chartSegCountTime.destroy(); chartSegCountTime = null; }
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  const months = [...new Set(rows.map(r => r.data_zrzutu))].sort();
  const bySeg = s => months.map(mo => {
    const r = rows.find(x => x.data_zrzutu === mo && x.segment === s);
    return r ? r : { klienci: 0, jp12: 0 };
  });
  const colors = { A: '#2E7D32', B: '#9BBB59', C: '#F2A900', D: '#C00000', brak: '#BFBFBF' };

  if (chartSegJpTime) chartSegJpTime.destroy();
  const ctx1 = document.getElementById('chartSegJpTime');
  if (ctx1) {
    chartSegJpTime = new Chart(ctx1, {
      type: 'bar',
      data: {
        labels: months,
        datasets: ['A', 'B', 'C', 'D'].map(s => ({
          label: s, data: bySeg(s).map(r => r.jp12),
          backgroundColor: colors[s], stack: 'jp',
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } },
        scales: { x: { stacked: true, ticks: { font: { size: 9 }, maxRotation: 45 } }, y: { stacked: true, beginAtZero: true } },
      },
    });
  }

  if (chartSegCountTime) chartSegCountTime.destroy();
  const ctx2 = document.getElementById('chartSegCountTime');
  if (ctx2) {
    chartSegCountTime = new Chart(ctx2, {
      type: 'line',
      data: {
        labels: months,
        datasets: ['A', 'B', 'C', 'D'].map(s => ({
          label: s, data: bySeg(s).map(r => r.klienci),
          borderColor: colors[s], backgroundColor: colors[s] + '33', tension: 0.2,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } },
        scales: { x: { ticks: { font: { size: 9 }, maxRotation: 45 } }, y: { beginAtZero: true } },
      },
    });
  }
}

// ── Panel admina — zrzuty miesięczne ────────────────────────────────────────
async function segRunBackfill() {
  const from = document.getElementById('segBackfillFrom').value;
  const to = document.getElementById('segBackfillTo').value || null;
  if (!from) { setMsg('segAdminMsg', 'Podaj miesiąc początkowy.', 'err'); return; }
  setMsg('segAdminMsg', '⏳ Liczenie zrzutów wstecz — może potrwać kilkanaście sekund…', '');
  try {
    const r = await fetch(`${API}/segmentation/snapshots/backfill`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_month: from, to_month: to }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || 'Błąd backfillu');
    setMsg('segAdminMsg', `✅ Gotowe: ${d.months} miesięcy przeliczonych (${d.from} → ${d.to}).`, 'ok');
    loadSegOverview();
  } catch (e) { setMsg('segAdminMsg', '❌ ' + e.message, 'err'); }
}

async function segGenerateLastMonth() {
  setMsg('segAdminMsg', '⏳ Liczenie…', '');
  const end = _segLastClosedMonthEnd();
  const ym = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`;
  try {
    const r = await fetch(`${API}/segmentation/snapshots/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month: ym }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || 'Błąd przeliczania');
    setMsg('segAdminMsg', `✅ Przeliczono ${d.data_zrzutu}: ${d.klientow} klientów.`, 'ok');
    loadSegOverview();
  } catch (e) { setMsg('segAdminMsg', '❌ ' + e.message, 'err'); }
}

// ── Karta klienta ────────────────────────────────────────────────────────
async function openSegCustomerCard(firma) {
  const modal = document.getElementById('segCustomerModal');
  const body = document.getElementById('segModalBody');
  document.getElementById('segModalTitle').textContent = firma;
  body.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:2rem">⏳ Ładowanie…</div>';
  modal.showModal();

  const od = document.getElementById('segOd').value;
  const doV = document.getElementById('segDo').value;
  const cust = _segData?.customers?.find(c => c.firma === firma);

  let monthlyJp = [], history = [], mix = [];
  try {
    [monthlyJp, history, mix] = await Promise.all([
      fetch(`${API}/segmentation/customer/monthly-jp?${new URLSearchParams({ firma, months: 24 })}`).then(r => r.json()),
      fetch(`${API}/segmentation/customer/history?${new URLSearchParams({ firma, months: 24 })}`).then(r => r.json()),
      fetch(`${API}/segmentation/customer/model-mix?${new URLSearchParams({ firma, od, do: doV })}`).then(r => r.json()),
    ]);
  } catch (e) {
    body.innerHTML = `<div style="color:var(--red);padding:1rem">❌ ${esc(e.message)}</div>`;
    return;
  }

  const segBadge = cust
    ? `<span class="seg-badge seg-${cust.segment}">${cust.segment === 'brak' ? '—' : cust.segment}</span>`
    : '';
  const flags = cust
    ? (cust.profil_oem ? '<span class="seg-flag oem">OEM</span>' : '') +
      (cust.na_granicy ? '<span class="seg-flag granica">↑ blisko progu</span>' : '')
    : '';
  const doWyz = cust?.do_wyzszego_segmentu != null
    ? `Do wyższego segmentu: <b>${cust.do_wyzszego_segmentu.toFixed(1)} JP</b>` : '';

  const historyStrip = history.length
    ? `<div style="display:flex;gap:2px;flex-wrap:wrap;margin-top:4px">` +
      history.map(h => `<span class="seg-badge seg-${h.segment}" style="font-size:9px;padding:1px 5px"
             title="${h.data_zrzutu}: segment ${h.segment}, JP12=${Number(h.jp12).toFixed(1)}">${h.data_zrzutu.slice(0, 7)}</span>`).join('') +
      `</div>`
    : '<div style="font-size:11px;color:var(--text-muted);margin-top:4px">Brak historii zrzutów — poproś admina o backfill.</div>';

  const mixRows = mix.length
    ? mix.map(m => `<tr><td>${esc(m.model)}</td><td>${m.typ === 'oem' ? 'OEM' : 'Własne'}</td>
        <td class="num">${fmtNum(m.sztuki)}</td><td class="num">${m.jp.toFixed(1)}</td></tr>`).join('')
    : '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">Brak pozycji w okresie</td></tr>';

  body.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
      ${segBadge} <b style="font-size:14px">${esc(firma)}</b> ${flags}
    </div>
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Okres: ${od} → ${doV} ${doWyz ? '· ' + doWyz : ''}</div>
    <div style="margin-bottom:12px">${historyStrip}</div>

    <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin:14px 0 6px">JP MIESIĘCZNIE (24 MIES.)</div>
    <div style="position:relative;height:160px"><canvas id="chartSegCustMonthly"></canvas></div>

    <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin:16px 0 6px">MIKS MODELI W OKRESIE</div>
    <table class="rev-table"><thead><tr><th>Model</th><th>Typ</th><th class="num">Sztuki</th><th class="num">JP</th></tr></thead>
      <tbody>${mixRows}</tbody></table>
  `;

  if (chartSegCustMonthly) { chartSegCustMonthly.destroy(); chartSegCustMonthly = null; }
  const ctx = document.getElementById('chartSegCustMonthly');
  if (ctx && monthlyJp.length) {
    const jp12Map = {};
    history.forEach(h => { jp12Map[h.data_zrzutu.slice(0, 7)] = Number(h.jp12); });
    chartSegCustMonthly = new Chart(ctx, {
      data: {
        labels: monthlyJp.map(m => m.month),
        datasets: [
          { type: 'bar', label: 'JP (miesiąc)', data: monthlyJp.map(m => m.jp), backgroundColor: '#2563EBcc' },
          { type: 'line', label: 'JP kroczące 12 mies.', data: monthlyJp.map(m => jp12Map[m.month] ?? null),
            borderColor: '#F59E0B', backgroundColor: 'transparent', tension: 0.2, spanGaps: true },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } },
        scales: { x: { ticks: { font: { size: 9 }, maxRotation: 45 } }, y: { beginAtZero: true } },
      },
    });
  }
}

// ── Etap 3 — panel admina: słownik modeli ───────────────────────────────────
let _segModelsCache = [];

async function loadSegModelsAdmin() {
  const tbody = document.getElementById('segModelsTableBody');
  try {
    _segModelsCache = await (await fetch(`${API}/segmentation/models`)).json();
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--red)">❌ ${esc(e.message)}</td></tr>`;
    return;
  }
  if (!tbody) return;
  if (!_segModelsCache.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:1rem">Brak modeli w słowniku</td></tr>';
    return;
  }
  tbody.innerHTML = _segModelsCache.map(m => `<tr>
    <td><b>${esc(m.kod_modelu)}</b></td>
    <td style="font-size:11px;color:var(--text-muted)">${(m.aliasy || []).map(esc).join(', ') || '—'}</td>
    <td>${esc(m.nazwa_cennikowa) || '—'}</td>
    <td class="num">${Number(m.jp_na_szt).toFixed(2)}</td>
    <td>${m.typ === 'oem' ? 'OEM' : 'Własne'}</td>
    <td style="font-size:11px">${esc(m.wazny_od)}</td>
    <td style="font-size:11px">${m.wazny_do ? esc(m.wazny_do) : '—'}</td>
    <td style="white-space:nowrap">
      <button class="ghost sm" onclick="openSegModelModal(${m.id})">✏</button>
      <button class="ghost sm" onclick="deleteSegModelRow(${m.id},'${esc(m.kod_modelu).replace(/'/g, "\\'")}')">✕</button>
    </td>
  </tr>`).join('');
}

function openSegModelModal(id) {
  const modal = document.getElementById('segModelModal');
  document.getElementById('segModelModalMsg').textContent = '';
  if (id) {
    const m = _segModelsCache.find(x => x.id === id);
    if (!m) return;
    document.getElementById('segModelModalTitle').textContent = 'Edytuj model';
    document.getElementById('segModelEditId').value = m.id;
    document.getElementById('segModelKod').value    = m.kod_modelu;
    document.getElementById('segModelAliasy').value = (m.aliasy || []).join(', ');
    document.getElementById('segModelNazwa').value  = m.nazwa_cennikowa || '';
    document.getElementById('segModelJp').value     = m.jp_na_szt;
    document.getElementById('segModelTyp').value    = m.typ;
    document.getElementById('segModelWaznyOd').value = m.wazny_od;
  } else {
    document.getElementById('segModelModalTitle').textContent = 'Dodaj model';
    document.getElementById('segModelEditId').value = '';
    document.getElementById('segModelKod').value    = '';
    document.getElementById('segModelAliasy').value = '';
    document.getElementById('segModelNazwa').value  = '';
    document.getElementById('segModelJp').value     = '';
    document.getElementById('segModelTyp').value    = 'wlasne';
    document.getElementById('segModelWaznyOd').value = '2000-01-01';
  }
  modal.showModal();
}

async function saveSegModel() {
  const id = document.getElementById('segModelEditId').value;
  const kod = document.getElementById('segModelKod').value.trim();
  const jp = parseFloat(document.getElementById('segModelJp').value);
  const msgEl = document.getElementById('segModelModalMsg');
  if (!kod) { msgEl.textContent = 'Podaj kod modelu.'; msgEl.className = 'msg err'; return; }
  if (!(jp > 0)) { msgEl.textContent = 'JP na sztukę musi być liczbą większą od zera.'; msgEl.className = 'msg err'; return; }

  const body = {
    kod_modelu: kod,
    aliasy: document.getElementById('segModelAliasy').value.split(',').map(s => s.trim()).filter(Boolean),
    nazwa_cennikowa: document.getElementById('segModelNazwa').value.trim(),
    jp_na_szt: jp,
    typ: document.getElementById('segModelTyp').value,
    wazny_od: document.getElementById('segModelWaznyOd').value || '2000-01-01',
  };

  try {
    const r = await fetch(`${API}/segmentation/models${id ? '/' + id : ''}`, {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || 'Błąd zapisu');
    document.getElementById('segModelModal').close();
    await loadSegModelsAdmin();
    loadSegModelsFilter();   // odśwież listę modeli w filtrze tabeli klientów
  } catch (e) {
    msgEl.textContent = '❌ ' + e.message; msgEl.className = 'msg err';
  }
}

async function deleteSegModelRow(id, kod) {
  if (!confirm(`Usunąć model „${kod}” ze słownika? Pozycje z produkcji dopasowane do niego przestaną się liczyć do JP.`)) return;
  try {
    const r = await fetch(`${API}/segmentation/models/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json()).detail || 'Błąd usuwania');
    await loadSegModelsAdmin();
    loadSegModelsFilter();
  } catch (e) { alert('Błąd: ' + e.message); }
}

// ── Etap 3 — panel admina: progi segmentacji ────────────────────────────────
async function loadSegThresholdsAdmin() {
  let data;
  try {
    data = await (await fetch(`${API}/segmentation/thresholds`)).json();
  } catch (e) {
    setMsg('segThresholdsMsg', '❌ ' + e.message, 'err');
    return;
  }
  const c = data.current;
  document.getElementById('segThProgA').value       = c.prog_a;
  document.getElementById('segThProgB').value       = c.prog_b;
  document.getElementById('segThProgC').value       = c.prog_c;
  document.getElementById('segThProfilOem').value   = c.prog_profil_oem;
  document.getElementById('segThNaGranicy').value   = c.prog_na_granicy;
  document.getElementById('segThTrend').value       = c.prog_trend;
  document.getElementById('segThMinMies').value     = c.min_miesiecy_okresu;
  document.getElementById('segThWaznyOd').value     = new Date().toISOString().slice(0, 10);

  const histBody = document.getElementById('segThresholdsHistBody');
  if (histBody) {
    histBody.innerHTML = data.history.map(h => `<tr${h.wersja === c.wersja ? ' style="font-weight:700"' : ''}>
      <td>${h.wersja}${h.wersja === c.wersja ? ' (aktualna)' : ''}</td>
      <td style="font-size:11px">${esc(h.wazny_od)}</td>
      <td class="num">${Number(h.prog_a).toFixed(1)}</td>
      <td class="num">${Number(h.prog_b).toFixed(1)}</td>
      <td class="num">${Number(h.prog_c).toFixed(1)}</td>
      <td class="num">${Number(h.prog_profil_oem).toFixed(0)}%</td>
      <td class="num">${Number(h.prog_na_granicy).toFixed(0)}%</td>
      <td class="num">${Number(h.prog_trend).toFixed(0)}%</td>
      <td class="num">${h.min_miesiecy_okresu}</td>
    </tr>`).join('');
  }
}

async function segSaveNewThresholdVersion() {
  const body = {
    prog_a: parseFloat(document.getElementById('segThProgA').value),
    prog_b: parseFloat(document.getElementById('segThProgB').value),
    prog_c: parseFloat(document.getElementById('segThProgC').value),
    prog_profil_oem: parseFloat(document.getElementById('segThProfilOem').value),
    prog_na_granicy: parseFloat(document.getElementById('segThNaGranicy').value),
    prog_trend: parseFloat(document.getElementById('segThTrend').value),
    min_miesiecy_okresu: parseInt(document.getElementById('segThMinMies').value, 10),
    wazny_od: document.getElementById('segThWaznyOd').value,
  };
  if ([body.prog_a, body.prog_b, body.prog_c].some(v => !(v >= 0)) || !body.wazny_od) {
    setMsg('segThresholdsMsg', 'Uzupełnij progi A/B/C i datę „ważny od”.', 'err');
    return;
  }
  if (!confirm('Zapisać nową wersję progów? Poprzednia zostanie zachowana w historii i nadal będzie używana przez już zapisane zrzuty miesięczne.')) return;
  try {
    const r = await fetch(`${API}/segmentation/thresholds`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || 'Błąd zapisu');
    setMsg('segThresholdsMsg', `✅ Zapisano jako wersję ${d.wersja}. Odśwież tabelę klientów, żeby zobaczyć efekt.`, 'ok');
    await loadSegThresholdsAdmin();
  } catch (e) {
    setMsg('segThresholdsMsg', '❌ ' + e.message, 'err');
  }
}
