// ── WAIDS — revenue analytics tab + seasonality ───────────────────────────

// ── State ─────────────────────────────────────────────────────────────────
let _revData          = null;   // raw API response
let _revTopN          = 10;     // current Top-N for customer bar
let _revTrendYear     = '';     // selected year for trend filter
let _revTrendExpanded = false;
let _revSortKey       = 'netto';
let _revSortAsc       = false;
let _revSearch        = '';

// ── Chart instances ────────────────────────────────────────────────────────
let chartRevTrend  = null;
let chartRevAnnual = null;
let chartRevTop    = null;
let chartRevType   = null;
let chartRevRep    = null;

// ── Constants ─────────────────────────────────────────────────────────────
const REV_COLORS = {
  pln:    '#2563EB',
  eur:    '#F59E0B',
  brutto: '#1D9E75',
  bar:    ['#2563EB','#1D9E75','#F59E0B','#7C3AED','#E24B4A','#0e7490','#BA7517','#9ca3af'],
};

const REV_TYPE_LABELS = { ids:'IDS', licencja:'Licencja', oem:'OEM', inne:'Inne', brak:'Brak konfiguracji' };

// ── Load ───────────────────────────────────────────────────────────────────
async function loadRevenue() {
  const tbody = document.getElementById('revTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:2rem">⏳ Ładowanie…</td></tr>';

  try {
    const r = await fetch(`${API}/revenue`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    _revData = await r.json();
  } catch(e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--red);padding:2rem">❌ ${e.message}</td></tr>`;
    return;
  }

  // Populate year filter dropdown
  const sel = document.getElementById('revYearFilter');
  if (sel) {
    const years = [...new Set(_revData.annual.map(r => r.year))].sort();
    sel.innerHTML = '<option value="">Wszystkie lata</option>' +
      years.map(y => `<option value="${y}"${y === _revData.kpi_ytd.year ? ' selected':''}>${y}</option>`).join('');
    _revTrendYear = _revData.kpi_ytd.year;
    sel.value = _revTrendYear;
  }

  renderRevKPI();
  renderRevTrend();
  renderRevAnnual();
  renderRevTop();
  renderRevType();
  renderRevRep();
  renderRevTable();
}

// ── KPI cards ──────────────────────────────────────────────────────────────
function renderRevKPI() {
  const ytd = _revData.kpi_ytd;
  const selectedYear = document.getElementById('revYearFilter')?.value || '';
  let kpi;

  if (selectedYear && _revData.annual) {
    const row = _revData.annual.find(r => r.year === selectedYear);
    kpi = row
      ? { netto: row.netto, eur: row.eur, devices: row.devices, customers: row.customers, year: selectedYear }
      : { netto: 0, eur: 0, devices: 0, customers: 0, year: selectedYear };
  } else {
    kpi = ytd;
  }

  const label = kpi.year ? `${kpi.year}` : 'Wszystkie lata';
  document.getElementById('revKpiNettoLbl').textContent     = `Przychody ${label} (PLN netto)`;
  document.getElementById('revKpiEurLbl').textContent       = `Przychody ${label} (EUR)`;
  document.getElementById('revKpiDevicesLbl').textContent   = `Płacących urządzeń (${label})`;
  document.getElementById('revKpiCustomersLbl').textContent = `Płacących klientów (${label})`;

  document.getElementById('revKpiNetto').textContent     = fmtPLN(kpi.netto);
  document.getElementById('revKpiEur').textContent       = fmtEUR(kpi.eur);
  document.getElementById('revKpiDevices').textContent   = fmtNum(kpi.devices);
  document.getElementById('revKpiCustomers').textContent = fmtNum(kpi.customers);
}

function onRevYearChange() {
  _revTrendYear = document.getElementById('revYearFilter')?.value || '';
  if (!_revData) return;
  renderRevKPI();
  renderRevTrend();
  renderRevTop();
  renderRevTable();
}

// ── Monthly trend ──────────────────────────────────────────────────────────
function buildRevTrendYearPills(monthly) {
  const years = [...new Set(monthly.map(r => r.month.slice(0,4)))].sort();
  const pills = document.getElementById('revTrendYearPills');
  if (!pills) return;
  pills.innerHTML = [''].concat(years).map(y =>
    `<button class="year-pill${_revTrendYear===y?' active':''}"
             onclick="setRevTrendYear('${y}')">${y||'Wszystkie'}</button>`).join('');
}

function setRevTrendYear(y) {
  _revTrendYear = y;
  const sel = document.getElementById('revYearFilter');
  if (sel) sel.value = y;
  renderRevKPI();
  renderRevTrend();
  renderRevTop();
  renderRevTable();
}

function renderRevTrend() {
  const monthly = _revData.monthly.filter(r =>
    !_revTrendYear || r.month.startsWith(_revTrendYear));

  buildRevTrendYearPills(_revData.monthly);

  const wrap = document.getElementById('revTrendWrap');
  if (wrap) wrap.style.height = (_revTrendExpanded ? '400px' : '220px');

  const labels   = monthly.map(r => r.month);
  const nettoArr = monthly.map(r => r.netto);
  const eurArr   = monthly.map(r => r.eur);

  // ── Revenue forecast (dashed line) ────────────────────────────────────────
  const today       = new Date();
  const curYear     = today.getFullYear();
  const curMonth    = today.getMonth() + 1;                          // 1-indexed
  const curMonthStr = `${curYear}-${String(curMonth).padStart(2,'0')}`;
  // Show forecast only when view includes current year
  const showForecast = !_revTrendYear || _revTrendYear === String(curYear);

  // Average PLN netto from last 3 completed months (before current)
  const histArr  = _revData.monthly.filter(r => r.month < curMonthStr);
  const last3    = histArr.slice(-3);
  const avgNetto = last3.length
    ? last3.reduce((s, r) => s + (r.netto || 0), 0) / last3.length
    : 0;

  // Extend labels with missing forecast months (current → December)
  let allLabels = [...labels];
  let allNetto  = [...nettoArr];
  let allEur    = [...eurArr];

  if (showForecast && avgNetto > 0) {
    for (let m = curMonth; m <= 12; m++) {
      const lbl = `${curYear}-${String(m).padStart(2,'0')}`;
      if (!allLabels.includes(lbl)) {
        allLabels.push(lbl);
        allNetto.push(null);
        allEur.push(null);
      }
    }
  }

  // Forecast array: null for history, avgNetto for current month and beyond
  const forecastNetto = allLabels.map(lbl =>
    (showForecast && avgNetto > 0 && lbl >= curMonthStr && lbl.startsWith(String(curYear)))
      ? Math.round(avgNetto) : null
  );
  const hasForecast = forecastNetto.some(v => v !== null);

  if (chartRevTrend) chartRevTrend.destroy();
  const ctx = document.getElementById('chartRevTrend');
  if (!ctx) return;

  chartRevTrend = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: allLabels,
      datasets: [
        {
          type: 'bar',
          label: 'PLN netto',
          data: allNetto,
          backgroundColor: REV_COLORS.pln + 'cc',
          borderRadius: 3,
          yAxisID: 'y',
        },
        {
          type: 'line',
          label: 'EUR',
          data: allEur,
          borderColor: REV_COLORS.eur,
          backgroundColor: REV_COLORS.eur + '33',
          borderWidth: 2,
          pointRadius: 3,
          fill: false,
          tension: 0.3,
          yAxisID: 'y2',
        },
        ...(hasForecast ? [{
          type: 'line',
          label: 'Prognoza PLN',
          data: forecastNetto,
          borderColor: REV_COLORS.pln,
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [6, 4],
          pointRadius: 4,
          pointStyle: 'circle',
          fill: false,
          tension: 0,
          yAxisID: 'y',
        }] : []),
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const v = ctx.parsed.y;
              if (v === null || v === undefined) return null;
              if (ctx.dataset.label === 'Prognoza PLN')
                return ` Prognoza (śr. 3 mies.): ${fmtPLN(v)}`;
              if (ctx.dataset.yAxisID === 'y2')
                return ` EUR: ${fmtNum(v)} €`;
              return ` PLN netto: ${fmtPLN(v)}`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { autoSkip: true, maxRotation: 45, font: { size: 10 } } },
        y:  { beginAtZero: true, position: 'left',
              ticks: { callback: v => fmtNum(v), font: { size: 10 } } },
        y2: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false },
              ticks: { callback: v => fmtNum(v) + ' €', font: { size: 10 } } },
      },
    },
  });
}

function toggleRevTrendExpand() {
  _revTrendExpanded = !_revTrendExpanded;
  const card = document.getElementById('revTrendCard');
  const btn  = document.getElementById('revTrendExpandBtn');
  const row  = document.getElementById('revRow1');
  if (_revTrendExpanded) {
    card.style.gridColumn = '1 / -1';
    card.style.order = '-1';
    btn.textContent = '⤡ Zwiń';
    if (row) row.classList.remove('col2');
  } else {
    card.style.removeProperty('grid-column');
    card.style.removeProperty('order');
    btn.textContent = '⤢ Rozwiń';
    if (row) row.classList.add('col2');
  }
  setTimeout(() => { if (_revData) renderRevTrend(); }, 80);
}

// ── Annual chart ───────────────────────────────────────────────────────────
function renderRevAnnual() {
  const annual = _revData.annual;
  const labels = annual.map(r => r.year);
  if (chartRevAnnual) chartRevAnnual.destroy();
  const ctx = document.getElementById('chartRevAnnual');
  if (!ctx) return;
  chartRevAnnual = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'PLN netto',  data: annual.map(r => r.netto),  backgroundColor: REV_COLORS.pln,    borderRadius: 3 },
        { label: 'PLN brutto', data: annual.map(r => r.brutto), backgroundColor: REV_COLORS.brutto, borderRadius: 3 },
        { label: 'EUR',        data: annual.map(r => r.eur),    backgroundColor: REV_COLORS.eur,    borderRadius: 3, yAxisID: 'y2' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const v = ctx.parsed.y;
              if (ctx.dataset.label === 'EUR') return ` EUR: ${fmtNum(v)} €`;
              return ` ${ctx.dataset.label}: ${fmtPLN(v)}`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { font: { size: 11 } } },
        y:  { beginAtZero: true, ticks: { callback: v => fmtNum(v), font: { size: 10 } } },
        y2: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false },
              ticks: { callback: v => fmtNum(v) + ' €', font: { size: 10 } } },
      },
    },
  });
}

// ── Top customers ──────────────────────────────────────────────────────────
function setTopN(n, el) {
  _revTopN = n;
  document.querySelectorAll('.top-n-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  renderRevTop();
}

function renderRevTop() {
  const customers = _revData.customers;
  const top = customers.slice(0, _revTopN);

  const wrap = document.getElementById('revTopWrap');
  if (wrap) wrap.style.height = Math.max(180, _revTopN * 26 + 40) + 'px';

  if (chartRevTop) chartRevTop.destroy();
  const ctx = document.getElementById('chartRevTop');
  if (!ctx) return;

  chartRevTop = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top.map(c => c.customer.length > 32 ? c.customer.slice(0,30)+'…' : c.customer),
      datasets: [
        { label: 'PLN netto', data: top.map(c => c.netto),  backgroundColor: REV_COLORS.pln + 'cc', borderRadius: 3 },
        { label: 'EUR',       data: top.map(c => c.eur),    backgroundColor: REV_COLORS.eur + 'aa', borderRadius: 3, yAxisID: 'y2' },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const c = _revData.customers[ctx.dataIndex];
              if (ctx.dataset.label === 'EUR') return c.eur ? ` EUR: ${fmtNum(c.eur)} €` : '';
              return ` PLN netto: ${fmtPLN(c.netto)} · urządzeń: ${c.devices} · płatności: ${c.payment_count}`;
            }
          }
        }
      },
      scales: {
        x:  { beginAtZero: true, ticks: { callback: v => fmtNum(v), font: { size: 10 } } },
        y:  { ticks: { font: { size: 10 } } },
        y2: { display: false },
      },
    },
  });
}

// ── Firm type donut ────────────────────────────────────────────────────────
function renderRevType() {
  const types = _revData.by_type;
  const labels = types.map(t => REV_TYPE_LABELS[t.type] || t.type);
  const colors = ['#2563EB','#1D9E75','#9ca3af','#7C3AED','#E24B4A'];

  // Build legend
  const leg = document.getElementById('revTypeLegend');
  if (leg) {
    leg.innerHTML = types.map((t, i) =>
      `<span><span class="leg-sq" style="background:${colors[i]||'#aaa'}"></span>${labels[i]} – ${fmtPLN(t.netto)}</span>`
    ).join('');
  }

  if (chartRevType) chartRevType.destroy();
  const ctx = document.getElementById('chartRevType');
  if (!ctx) return;
  chartRevType = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: types.map(t => t.netto), backgroundColor: colors, borderWidth: 1 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmtPLN(ctx.parsed)}` } }
      },
      cutout: '62%',
    },
  });
}

// ── Revenue by rep ─────────────────────────────────────────────────────────
function renderRevRep() {
  const reps = _revData.by_rep;
  if (!reps.length) return;
  if (chartRevRep) chartRevRep.destroy();
  const ctx = document.getElementById('chartRevRep');
  if (!ctx) return;
  chartRevRep = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: reps.map(r => r.rep),
      datasets: [
        { label: 'PLN netto', data: reps.map(r => r.netto),  backgroundColor: REV_COLORS.pln + 'cc', borderRadius: 3 },
        { label: 'EUR',       data: reps.map(r => r.eur),    backgroundColor: REV_COLORS.eur + 'aa', borderRadius: 3, yAxisID: 'y2' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const v = ctx.parsed.y;
              return ctx.dataset.label === 'EUR'
                ? (v ? ` EUR: ${fmtNum(v)} €` : '')
                : ` PLN netto: ${fmtPLN(v)}`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { font: { size: 10 } } },
        y:  { beginAtZero: true, ticks: { callback: v => fmtNum(v), font: { size: 9 } } },
        y2: { display: false },
      },
    },
  });
}

// ── Customer table ─────────────────────────────────────────────────────────
function renderRevTable() {
  const tbody = document.getElementById('revTableBody');
  if (!tbody) return;

  const search = _revSearch.toLowerCase();
  let rows = _revData.customers.filter(c =>
    !search || c.customer.toLowerCase().includes(search));

  // Sort
  rows = [...rows].sort((a, b) => {
    const va = a[_revSortKey], vb = b[_revSortKey];
    if (typeof va === 'string') return _revSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    return _revSortAsc ? va - vb : vb - va;
  });

  const totalNetto = _revData.customers.reduce((s, c) => s + c.netto, 0) || 1;

  tbody.innerHTML = rows.map((c, i) => {
    const avg   = c.devices ? c.netto / c.devices : 0;
    const share = totalNetto ? c.netto / totalNetto * 100 : 0;
    const barW  = Math.max(2, Math.round(share / (_revData.customers[0].netto / totalNetto * 100) * 100));
    return `<tr>
      <td style="color:var(--text-muted)">${i+1}</td>
      <td><strong>${c.customer}</strong></td>
      <td class="num">${fmtPLN(c.netto)}</td>
      <td class="num">${c.brutto ? fmtPLN(c.brutto) : '—'}</td>
      <td class="num">${c.eur ? fmtNum(c.eur)+' €' : '—'}</td>
      <td class="num">${c.devices}</td>
      <td class="num">${c.payment_count}</td>
      <td class="num">${fmtPLN(avg)}</td>
      <td class="bar-cell"><div class="mini-bar" style="width:${barW}%"></div>
          <span style="font-size:10px;color:var(--text-muted)">${share.toFixed(1)}%</span></td>
    </tr>`;
  }).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:1.5rem">Brak wyników</td></tr>';
}

function filterRevTable() {
  _revSearch = document.getElementById('revTableSearch')?.value || '';
  if (_revData) renderRevTable();
}

function sortRevTable(key) {
  if (_revSortKey === key) _revSortAsc = !_revSortAsc;
  else { _revSortKey = key; _revSortAsc = key === 'customer'; }
  if (_revData) renderRevTable();
}

// ── SEASONALITY CHART ──────────────────────────────────────────────────────
let chartSeason        = null;
let _seasonData        = null;
let _seasonActiveYears = new Set();
let _seasonExpanded    = false;

const SEASON_COLORS = [
  '#2563EB','#1D9E75','#E24B4A','#F59E0B','#7C3AED',
  '#0e7490','#BA7517','#9ca3af','#6366f1','#ec4899',
];

async function loadSeasonality() {
  const dtype = document.getElementById('seasonTypeFilter')?.value || 'master';
  const model = document.getElementById('seasonModelFilter')?.value || '';
  try {
    const r = await fetch(`${API}/production/seasonality?device_type=${encodeURIComponent(dtype)}&model=${encodeURIComponent(model)}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    _seasonData = await r.json();
  } catch(e) {
    console.error('seasonality load error', e);
    return;
  }
  // Populate model dropdown (only once — keep selected value)
  const modelSel = document.getElementById('seasonModelFilter');
  if (modelSel && _seasonData.models) {
    const cur = modelSel.value;
    modelSel.innerHTML = '<option value="">Wszystkie modele</option>' +
      _seasonData.models.map(m => `<option value="${m}"${m===cur?' selected':''}>${m}</option>`).join('');
  }
  // Default: activate all years
  if (_seasonActiveYears.size === 0) {
    _seasonData.series.forEach(s => _seasonActiveYears.add(s.year));
  }
  renderSeasonYearPills();
  renderSeasonChart();
}

function renderSeasonYearPills() {
  const container = document.getElementById('seasonYearPills');
  if (!container || !_seasonData) return;
  container.innerHTML = _seasonData.series.map((s, i) => {
    const active = _seasonActiveYears.has(s.year);
    const color  = SEASON_COLORS[i % SEASON_COLORS.length];
    return `<button class="year-pill${active?' active':''}"
                    style="${active ? `background:${color};color:#fff;border-color:${color}` : ''}"
                    onclick="toggleSeasonYear('${s.year}',${i})">${s.year} <span style="font-size:10px;opacity:.7">(${s.total})</span></button>`;
  }).join('');
}

function toggleSeasonYear(year, idx) {
  if (_seasonActiveYears.has(year)) {
    if (_seasonActiveYears.size > 1) _seasonActiveYears.delete(year);
  } else {
    _seasonActiveYears.add(year);
  }
  renderSeasonYearPills();
  renderSeasonChart();
}

function renderSeasonChart() {
  const wrap = document.getElementById('seasonWrap');
  if (wrap) wrap.style.height = (_seasonExpanded ? '420px' : '240px');
  if (chartSeason) { chartSeason.destroy(); chartSeason = null; }
  const ctx = document.getElementById('chartSeason');
  if (!ctx || !_seasonData) return;

  const labels = _seasonData.months_labels;
  const datasets = _seasonData.series
    .filter(s => _seasonActiveYears.has(s.year))
    .map((s, i) => {
      const allIdx = _seasonData.series.findIndex(x => x.year === s.year);
      const color  = SEASON_COLORS[allIdx % SEASON_COLORS.length];
      return {
        label:           s.year,
        data:            s.data,
        borderColor:     color,
        backgroundColor: color + '22',
        borderWidth:     2,
        pointRadius:     4,
        pointHoverRadius:6,
        tension:         0.35,
        fill:            false,
      };
    });

  chartSeason = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom',
                  labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            title: items => `${items[0].label}`,
            label: ctx  => ` ${ctx.dataset.label}: ${ctx.parsed.y} urządzeń`,
          }
        }
      },
      scales: {
        x: { ticks: { font: { size: 11 } } },
        y: { beginAtZero: true,
             ticks: { stepSize: 1, font: { size: 10 } },
             title: { display: true, text: 'Liczba urządzeń', font: { size: 10 } } },
      },
    },
  });
}

function toggleSeasonExpand() {
  _seasonExpanded = !_seasonExpanded;
  const btn = document.getElementById('seasonExpandBtn');
  if (btn) btn.textContent = _seasonExpanded ? '⤡ Zwiń' : '⤢ Rozwiń';
  setTimeout(() => renderSeasonChart(), 80);
}
