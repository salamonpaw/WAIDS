// ── WAIDS — Segmentacja klientów A–D (wolumen JP) — etap 1 ────────────────
// Tabela klientów dla wybranego okresu. Historia lat, migracje, trend,
// zrzuty miesięczne, karta klienta i panel admina (progi/słownik modeli) —
// etap 2/3, patrz backend/segmentation.py.

let _segData     = null;
let _segSortKey  = 'jp_okres_filtr';
let _segSortAsc  = false;
let _segSearch   = '';

const SEG_LABELS = {
  A: 'partner strategiczny', B: 'partner rozwojowy',
  C: 'partner aktywny',      D: 'klient okazjonalny',
};

// ── Init / presety dat ──────────────────────────────────────────────────────
async function onTabSegmentation() {
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
  const modelSel = document.getElementById('segModel');
  const models = [...modelSel.selectedOptions].map(o => o.value);

  const tbody = document.getElementById('segTableBody');
  tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--text-muted);padding:2rem">⏳ Liczenie…</td></tr>';
  setMsg('segMsg', '', '');

  const qs = new URLSearchParams({ od, do: doV });
  if (typ) qs.set('typ', typ);
  if (models.length) qs.set('model', models.join(','));

  try {
    const r = await fetch(`${API}/segmentation/customers?${qs}`);
    if (!r.ok) throw new Error((await r.json()).detail || ('HTTP ' + r.status));
    _segData = await r.json();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;color:var(--red);padding:2rem">❌ ${esc(e.message)}</td></tr>`;
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
  renderSegTable();
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

// ── Tabela klientów ──────────────────────────────────────────────────────
function _segRows() {
  let rows = _segData.customers;
  if (_segSearch) {
    const q = _segSearch.toLowerCase();
    rows = rows.filter(c => c.firma.toLowerCase().includes(q));
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
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--text-muted);padding:2rem">Brak klientów w wybranym okresie.</td></tr>';
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
    return `<tr>
      <td>${i + 1}</td>
      <td>${esc(c.firma)} ${flags}</td>
      <td>${segBadge}</td>
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
