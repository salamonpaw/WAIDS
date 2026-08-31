// ── WAIDS — Analiza pricingu IDS ──────────────────────────────────────────────

const PRICING_SEG_COLORS = {
  LEGACY:     '#ef4444',
  DISCOUNT:   '#f97316',
  STANDARD:   '#eab308',
  PREMIUM:    '#22c55e',
  ENTERPRISE: '#3b82f6',
};

const PRICING_RAISE_LABELS = {
  DO_KONTAKTU: 'Do kontaktu',
  W_TOKU:      'W toku',
  PODNIESIONO: 'Podniesiono',
  ODRZUCONO:   'Odrzucono',
};

// state
let _pricingData  = null;   // last result from /pricing/analyze
let _pricingView  = 'overview';
let _pricingCharts = {};    // chart instances keyed by id
let _pricingSel   = new Set(); // selected SNs in revision list
let _pricingRaiseRowTargets = {}; // per-SN edited target in revision table
let _activeDrillSeg = null;  // currently expanded segment in drill-down

// ── init ──────────────────────────────────────────────────────────────────────

async function initPricing() {
  await loadPricingReps();
  syncPricingYearPresets();
  await runPricingAnalysis();
}

async function loadPricingReps() {
  try {
    const r = await fetch(`${API}/reps`);
    if (!r.ok) return;
    const reps = await r.json();
    const sel = document.getElementById('pRepFilter');
    if (!sel) return;
    const names = [...new Set(reps.map(r => r.name))].sort();
    sel.innerHTML = '<option value="">Wszyscy opiekunowie</option>' +
      names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  } catch {}
}

function syncPricingYearPresets() {
  const now = new Date();
  const y = now.getFullYear();
  // Default: current year
  if (!document.getElementById('pYmFrom').value)
    document.getElementById('pYmFrom').value = `${y}-01`;
  if (!document.getElementById('pYmTo').value)
    document.getElementById('pYmTo').value = `${y}-${String(now.getMonth() + 1).padStart(2,'0')}`;
}

function setPricingPreset(preset) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2,'0');
  const prev = y - 1;
  let from, to;
  if (preset === 'curr_year') { from = `${y}-01`;   to   = `${y}-${m}`; }
  if (preset === 'prev_year') { from = `${prev}-01`; to  = `${prev}-12`; }
  if (preset === 'last12')    { from = (() => { const d = new Date(now); d.setMonth(d.getMonth()-11); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; })(); to = `${y}-${m}`; }
  document.getElementById('pYmFrom').value = from;
  document.getElementById('pYmTo').value   = to;
  runPricingAnalysis();
}

// ── analysis request ──────────────────────────────────────────────────────────

async function runPricingAnalysis() {
  const ymFrom  = document.getElementById('pYmFrom')?.value;
  const ymTo    = document.getElementById('pYmTo')?.value;
  if (!ymFrom || !ymTo) { setMsg('pricingMsg', 'Podaj przedział czasu', 'error'); return; }
  if (ymFrom > ymTo)    { setMsg('pricingMsg', 'Data "od" musi być wcześniejsza niż "do"', 'error'); return; }

  const tLegacy   = parseFloat(document.getElementById('pTargetLegacy')?.value || '90');
  const tDiscount = parseFloat(document.getElementById('pTargetDiscount')?.value || '100');
  const thresh    = [
    parseFloat(document.getElementById('pT1')?.value || '50'),
    parseFloat(document.getElementById('pT2')?.value || '90'),
    parseFloat(document.getElementById('pT3')?.value || '140'),
    parseFloat(document.getElementById('pT4')?.value || '200'),
  ];
  const classifierN = parseInt(document.getElementById('pClassifier')?.value || '1');
  const staleness   = parseInt(document.getElementById('pStaleness')?.value || '3');
  const repFilter   = document.getElementById('pRepFilter')?.value;
  const statusFilter = document.getElementById('pStatusFilter')?.value || 'all';

  setMsg('pricingMsg', 'Przeliczanie…', '');
  try {
    const r = await fetch(`${API}/pricing/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ym_from: ymFrom, ym_to: ymTo,
        target_legacy: tLegacy, target_discount: tDiscount,
        thresholds: thresh,
        classifier_n: classifierN,
        staleness_months: staleness,
        rep_filter: repFilter ? [repFilter] : [],
        status_filter: statusFilter,
      }),
    });
    if (!r.ok) { const d = await r.json().catch(()=>({})); setMsg('pricingMsg', d.detail||'Błąd', 'error'); return; }
    _pricingData = await r.json();
    _pricingSel.clear();
    _pricingRaiseRowTargets = {};
    setMsg('pricingMsg', `${_pricingData.kpi.count} urządzeń · MRR ${fmtPLN(_pricingData.kpi.mrr)}`, 'ok');
    renderPricingView();
  } catch (e) {
    setMsg('pricingMsg', 'Błąd połączenia: ' + e.message, 'error');
  }
}

// ── view switching ────────────────────────────────────────────────────────────

function switchPricingView(v) {
  _pricingView = v;
  ['overview','segments','reps','revision','raises'].forEach(name => {
    const btn = document.getElementById(`pBtn_${name}`);
    if (btn) btn.className = `ghost sm${name === v ? ' primary' : ''}`;
    const panel = document.getElementById(`pPanel_${name}`);
    if (panel) panel.style.display = name === v ? '' : 'none';
  });
  renderPricingView();
}

function renderPricingView() {
  if (!_pricingData) return;
  if (_pricingView === 'overview')  renderPricingOverview();
  if (_pricingView === 'segments')  renderPricingSegments();
  if (_pricingView === 'reps')      renderPricingReps();
  if (_pricingView === 'revision')  renderPricingRevision();
  if (_pricingView === 'raises')    renderPricingRaises();
}

// ── helpers ───────────────────────────────────────────────────────────────────

function destroyPricingChart(id) {
  if (_pricingCharts[id]) { _pricingCharts[id].destroy(); delete _pricingCharts[id]; }
}

function segBadge(seg) {
  const c = PRICING_SEG_COLORS[seg] || '#888';
  return `<span style="font-size:10px;padding:2px 6px;border-radius:99px;background:${c}20;color:${c};border:0.5px solid ${c}80">${seg}</span>`;
}

// ── 6.1 Przegląd ─────────────────────────────────────────────────────────────

function renderPricingOverview() {
  const kpi = _pricingData.kpi;
  const el = document.getElementById('pPanelOverviewContent');
  if (!el) return;

  el.innerHTML = `
    <!-- KPI bar -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:18px">
      ${[
        ['Liczba IDS',       kpi.count],
        ['Średnia cena',     fmtPLN(kpi.mean)],
        ['Mediana ceny',     fmtPLN(kpi.median)],
        ['MRR',              fmtPLN(kpi.mrr)],
        ['IDS w LEGACY',     `${kpi.legacy_count} (${kpi.legacy_pct}%)`],
        ['IDS do migracji',  kpi.migration_count],
        ['Potencjał /mies.', fmtPLN(kpi.potential_monthly)],
        ['Potencjał /rok',   fmtPLN(kpi.potential_yearly)],
      ].map(([lbl,val]) => `
        <div style="background:var(--bg-secondary);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:12px 14px">
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">${lbl}</div>
          <div style="font-size:18px;font-weight:700">${val}</div>
        </div>`).join('')}
    </div>
    <!-- Auto-odczyt -->
    <div style="font-size:12px;color:var(--text-muted);background:var(--bg-secondary);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:10px 14px;margin-bottom:18px">
      Mediana (${fmtPLN(kpi.median)}) jest niższa od średniej (${fmtPLN(kpi.mean)}) — portfel jest skośny w dół (większość stawek poniżej średniej).
      LEGACY stanowi ${kpi.legacy_pct}% portfela · potencjał podwyżek: <strong>${fmtPLN(kpi.potential_monthly)}/mies.</strong> = <strong>${fmtPLN(kpi.potential_yearly)}/rok</strong>.
    </div>
    <!-- Charts row -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
      <div style="background:var(--bg-secondary);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:12px">
        <div style="font-size:12px;font-weight:600;margin-bottom:8px">Histogram cen (PLN/mies.)</div>
        <div style="position:relative;height:200px"><canvas id="pChartHistogram"></canvas></div>
      </div>
      <div style="background:var(--bg-secondary);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:12px">
        <div style="font-size:12px;font-weight:600;margin-bottom:8px">Udział wg segmentu</div>
        <div style="position:relative;height:200px"><canvas id="pChartSegPie"></canvas></div>
      </div>
    </div>
    <div style="background:var(--bg-secondary);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:12px">
      <div style="font-size:12px;font-weight:600;margin-bottom:8px">Potencjał podwyżek wg segmentu (PLN/mies.)</div>
      <div style="position:relative;height:180px"><canvas id="pChartSegPotential"></canvas></div>
    </div>
  `;

  // Histogram
  destroyPricingChart('histogram');
  const hCtx = document.getElementById('pChartHistogram')?.getContext('2d');
  if (hCtx) {
    _pricingCharts['histogram'] = new Chart(hCtx, {
      type: 'bar',
      data: {
        labels: _pricingData.histogram.map(b => b.label),
        datasets: [{ label: 'Liczba IDS', data: _pricingData.histogram.map(b => b.count),
          backgroundColor: '#3b82f680', borderColor: '#3b82f6', borderWidth: 1 }]
      },
      options: { responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false} }, scales:{ y:{ beginAtZero:true } } }
    });
  }

  // Segment pie
  destroyPricingChart('segPie');
  const pCtx = document.getElementById('pChartSegPie')?.getContext('2d');
  const segs = _pricingData.segments;
  if (pCtx && segs.length) {
    _pricingCharts['segPie'] = new Chart(pCtx, {
      type: 'doughnut',
      data: {
        labels: segs.map(s => `${s.name} (${s.count})`),
        datasets: [{ data: segs.map(s => s.count),
          backgroundColor: segs.map(s => PRICING_SEG_COLORS[s.name] + '90'),
          borderColor: segs.map(s => PRICING_SEG_COLORS[s.name]),
          borderWidth: 1.5 }]
      },
      options: { responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ position:'right', labels:{font:{size:11}} } } }
    });
  }

  // Segment potential bar
  destroyPricingChart('segPotential');
  const spCtx = document.getElementById('pChartSegPotential')?.getContext('2d');
  const segsWithPot = segs.filter(s => s.potential_monthly > 0);
  if (spCtx && segsWithPot.length) {
    _pricingCharts['segPotential'] = new Chart(spCtx, {
      type: 'bar',
      data: {
        labels: segsWithPot.map(s => s.name),
        datasets: [{ label: 'Potencjał /mies. (PLN)',
          data: segsWithPot.map(s => s.potential_monthly),
          backgroundColor: segsWithPot.map(s => PRICING_SEG_COLORS[s.name] + '90'),
          borderColor: segsWithPot.map(s => PRICING_SEG_COLORS[s.name]),
          borderWidth: 1.5 }]
      },
      options: { responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false} }, scales:{ y:{ beginAtZero:true } } }
    });
  }
}

// ── 6.2 Segmenty ─────────────────────────────────────────────────────────────

function renderPricingSegments() {
  const el = document.getElementById('pPanelSegments');
  if (!el) return;
  const segs = _pricingData?.segments || [];
  el.innerHTML = `
    <table class="data-table" style="font-size:12px;margin-bottom:4px" id="pSegTable">
      <thead><tr>
        <th style="width:20px"></th>
        <th>Segment</th><th>Zakres</th>
        <th style="text-align:center">Liczba IDS</th>
        <th style="text-align:center">Udział %</th>
        <th style="text-align:right">Śr. cena</th>
        <th style="text-align:right">Mediana</th>
        <th style="text-align:right">MRR</th>
        <th style="text-align:right">Target</th>
        <th style="text-align:right">Potencjał /mies.</th>
      </tr></thead>
      <tbody>
        ${segs.map(s => `<tr style="cursor:pointer;user-select:none" onclick="pricingDrillSeg('${s.name}')" id="pSegRow_${s.name}">
          <td style="font-size:11px;color:var(--text-muted);text-align:center" id="pSegArrow_${s.name}">▶</td>
          <td>${segBadge(s.name)}</td>
          <td style="color:var(--text-muted)">${s.range}</td>
          <td style="text-align:center;font-weight:600">${s.count}</td>
          <td style="text-align:center">${s.pct}%</td>
          <td style="text-align:right">${fmtPLN(s.mean)}</td>
          <td style="text-align:right">${fmtPLN(s.median)}</td>
          <td style="text-align:right">${fmtPLN(s.mrr)}</td>
          <td style="text-align:right">${s.target > 0 ? fmtPLN(s.target) : '—'}</td>
          <td style="text-align:right;font-weight:600;color:${s.potential_monthly > 0 ? '#15803d' : 'inherit'}">${s.potential_monthly > 0 ? fmtPLN(s.potential_monthly) : '—'}</td>
        </tr>
        <tr id="pSegDrill_${s.name}" style="display:none">
          <td colspan="10" style="padding:0">
            <div id="pSegDrillContent_${s.name}" style="padding:10px 12px 14px;background:var(--bg-secondary);border-left:3px solid ${PRICING_SEG_COLORS[s.name]}"></div>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:14px;padding-left:4px">↑ Kliknij segment aby rozwinąć listę urządzeń</div>
    <div style="display:flex;gap:14px">
      <div style="flex:1;background:var(--bg-secondary);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:12px">
        <div style="font-size:12px;font-weight:600;margin-bottom:8px">Liczba IDS wg segmentu</div>
        <div style="position:relative;height:200px"><canvas id="pChartSegCount"></canvas></div>
      </div>
      <div style="flex:1;background:var(--bg-secondary);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:12px">
        <div style="font-size:12px;font-weight:600;margin-bottom:8px">Potencjał wg segmentu</div>
        <div style="position:relative;height:200px"><canvas id="pChartSegPot2"></canvas></div>
      </div>
    </div>
  `;

  // Restore active drill-down if any
  if (_activeDrillSeg) _renderSegDrillContent(_activeDrillSeg, true);

  destroyPricingChart('segCount');
  const cCtx = document.getElementById('pChartSegCount')?.getContext('2d');
  if (cCtx) _pricingCharts['segCount'] = new Chart(cCtx, {
    type: 'bar',
    data: { labels: segs.map(s=>s.name), datasets: [{
      data: segs.map(s=>s.count),
      backgroundColor: segs.map(s => PRICING_SEG_COLORS[s.name]+'90'),
      borderColor: segs.map(s => PRICING_SEG_COLORS[s.name]), borderWidth:1.5
    }]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true}} }
  });

  destroyPricingChart('segPot2');
  const pCtx2 = document.getElementById('pChartSegPot2')?.getContext('2d');
  const withPot = segs.filter(s=>s.potential_monthly>0);
  if (pCtx2 && withPot.length) _pricingCharts['segPot2'] = new Chart(pCtx2, {
    type: 'bar',
    data: { labels: withPot.map(s=>s.name), datasets: [{
      label: 'PLN/mies.', data: withPot.map(s=>s.potential_monthly),
      backgroundColor: withPot.map(s => PRICING_SEG_COLORS[s.name]+'90'),
      borderColor: withPot.map(s => PRICING_SEG_COLORS[s.name]), borderWidth:1.5
    }]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true}} }
  });
}

function pricingDrillSeg(seg) {
  if (_activeDrillSeg === seg) {
    // toggle off
    _activeDrillSeg = null;
    const drillRow = document.getElementById(`pSegDrill_${seg}`);
    const arrow    = document.getElementById(`pSegArrow_${seg}`);
    if (drillRow) drillRow.style.display = 'none';
    if (arrow)    arrow.textContent = '▶';
    return;
  }
  // Close previously open segment
  if (_activeDrillSeg) {
    const prev = document.getElementById(`pSegDrill_${_activeDrillSeg}`);
    const prevA = document.getElementById(`pSegArrow_${_activeDrillSeg}`);
    if (prev)  prev.style.display = 'none';
    if (prevA) prevA.textContent = '▶';
  }
  _activeDrillSeg = seg;
  _renderSegDrillContent(seg, false);
}

function _renderSegDrillContent(seg, restoring) {
  const drillRow = document.getElementById(`pSegDrill_${seg}`);
  const arrow    = document.getElementById(`pSegArrow_${seg}`);
  const content  = document.getElementById(`pSegDrillContent_${seg}`);
  if (!drillRow || !content) return;

  const devices = (_pricingData?.device_list || []).filter(d => d.segment === seg);
  const color = PRICING_SEG_COLORS[seg] || '#888';
  const totalMrr = devices.reduce((s, d) => s + d.price, 0);
  const totalPot = devices.reduce((s, d) => s + d.potential_monthly, 0);

  // Sort: by price asc for LEGACY/DISCOUNT, desc for premium
  const sortedDevices = [...devices].sort((a, b) =>
    ['LEGACY','DISCOUNT'].includes(seg) ? a.price - b.price : b.price - a.price
  );

  // Group by opiekun for summary line
  const repGroups = {};
  devices.forEach(d => {
    const r = d.rep_name || '(brak)';
    if (!repGroups[r]) repGroups[r] = { count: 0, mrr: 0, pot: 0 };
    repGroups[r].count++;
    repGroups[r].mrr += d.price;
    repGroups[r].pot += d.potential_monthly;
  });
  const repSummary = Object.entries(repGroups)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([rep, g]) => `<span style="display:inline-flex;align-items:center;gap:4px;margin:2px 4px 2px 0;font-size:10px;padding:1px 7px;border-radius:99px;background:${color}18;border:0.5px solid ${color}60">
      ${esc(rep)} <strong>${g.count}</strong>${g.pot > 0 ? ` · ${fmtPLN(g.pot)}/mies.` : ''}</span>`).join('');

  content.innerHTML = `
    <div style="display:flex;gap:16px;align-items:baseline;flex-wrap:wrap;margin-bottom:10px">
      <span style="font-size:13px;font-weight:700">${seg} — ${devices.length} urządzeń</span>
      <span style="font-size:12px;color:var(--text-muted)">MRR: <strong style="color:var(--text)">${fmtPLN(totalMrr)}</strong></span>
      ${totalPot > 0 ? `<span style="font-size:12px;color:#15803d">Potencjał: <strong>${fmtPLN(totalPot)}/mies.</strong></span>` : ''}
    </div>
    <div style="margin-bottom:10px">${repSummary}</div>
    <div style="overflow-x:auto;max-height:340px;overflow-y:auto">
      <table class="data-table" style="font-size:11px;min-width:600px">
        <thead style="position:sticky;top:0;z-index:1;background:var(--bg-secondary)"><tr>
          <th>Symbol IDS</th><th>Firma</th><th>Opiekun</th>
          <th style="text-align:right">Stawka</th>
          ${totalPot > 0 ? '<th style="text-align:right">Potencjał /mies.</th>' : ''}
          <th>Ost. płatność</th>
        </tr></thead>
        <tbody>
          ${sortedDevices.map(d => `<tr>
            <td style="font-family:monospace">${esc(d.sn)}</td>
            <td>${esc(d.firma)}</td>
            <td>${esc(d.rep_name || '—')}</td>
            <td style="text-align:right;font-weight:600">${fmtPLN(d.price)}</td>
            ${totalPot > 0 ? `<td style="text-align:right;color:${d.potential_monthly > 0 ? '#15803d' : 'var(--text-muted)'}">${d.potential_monthly > 0 ? fmtPLN(d.potential_monthly) : '—'}</td>` : ''}
            <td style="color:var(--text-muted)">${d.last_paid_ym || '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;

  drillRow.style.display = '';
  if (arrow) arrow.textContent = '▼';

  if (!restoring) {
    drillRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ── 6.3 Opiekunowie ───────────────────────────────────────────────────────────

function renderPricingReps() {
  const el = document.getElementById('pPanelReps');
  if (!el) return;
  const reps = _pricingData?.reps || [];
  el.innerHTML = `
    <table class="data-table" style="font-size:12px;margin-bottom:16px">
      <thead><tr>
        <th>Opiekun</th>
        <th style="text-align:center">IDS</th>
        <th style="text-align:center">Do migracji</th>
        <th style="text-align:right">Śr. cena</th>
        <th style="text-align:right">Mediana</th>
        <th style="text-align:right">Potencjał /mies.</th>
      </tr></thead>
      <tbody>
        ${reps.map(r => `<tr style="cursor:pointer" onclick="pricingDrillRep('${esc(r.rep_name)}')">
          <td style="font-weight:600">${esc(r.rep_name)}</td>
          <td style="text-align:center">${r.count}</td>
          <td style="text-align:center">${r.migration_count}</td>
          <td style="text-align:right">${fmtPLN(r.mean)}</td>
          <td style="text-align:right">${fmtPLN(r.median)}</td>
          <td style="text-align:right;font-weight:600;color:${r.potential_monthly > 0 ? '#15803d' : 'inherit'}">${r.potential_monthly > 0 ? fmtPLN(r.potential_monthly) : '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div style="background:var(--bg-secondary);border:0.5px solid var(--border);border-radius:var(--radius-lg);padding:12px">
      <div style="font-size:12px;font-weight:600;margin-bottom:8px">Potencjał wg opiekuna (PLN/mies.)</div>
      <div style="position:relative;height:220px"><canvas id="pChartReps"></canvas></div>
    </div>
  `;
  destroyPricingChart('reps');
  const ctx = document.getElementById('pChartReps')?.getContext('2d');
  const top = reps.filter(r=>r.potential_monthly>0).slice(0,15);
  if (ctx && top.length) _pricingCharts['reps'] = new Chart(ctx, {
    type: 'bar',
    data: { labels: top.map(r=>r.rep_name), datasets: [{
      label: 'Potencjał /mies.', data: top.map(r=>r.potential_monthly),
      backgroundColor: '#3b82f680', borderColor: '#3b82f6', borderWidth:1.5
    }]},
    options:{ responsive:true, maintainAspectRatio:false, indexAxis:'y',
      plugins:{legend:{display:false}}, scales:{x:{beginAtZero:true}} }
  });
}

function pricingDrillRep(repName) {
  switchPricingView('revision');
  setTimeout(() => {
    const f = document.getElementById('pRevisionRepFilter');
    if (f) { f.value = repName; renderPricingRevision(); }
  }, 50);
}

// ── 6.4 Lista rewizji ─────────────────────────────────────────────────────────

function renderPricingRevision() {
  const el = document.getElementById('pPanelRevision');
  if (!el || !_pricingData) return;

  const fSeg = document.getElementById('pRevisionSegFilter')?.value || '';
  const fRep = document.getElementById('pRevisionRepFilter')?.value || '';

  let items = _pricingData.device_list;
  if (fSeg) items = items.filter(i => i.segment === fSeg);
  if (fRep) items = items.filter(i => i.rep_name === fRep);

  const selItems  = items.filter(i => _pricingSel.has(i.sn));
  const selPot    = selItems.reduce((s, i) => s + ((_pricingRaiseRowTargets[i.sn] ?? i.target) - i.price), 0);
  const selPotPos = Math.max(0, selPot);

  // Build filters HTML
  const segOptions = ['LEGACY','DISCOUNT','STANDARD','PREMIUM','ENTERPRISE']
    .map(s => `<option value="${s}" ${fSeg===s?'selected':''}>${s}</option>`).join('');
  const repOptions = [...new Set(_pricingData.device_list.map(i=>i.rep_name))].sort()
    .map(r => `<option value="${esc(r)}" ${fRep===r?'selected':''}>${esc(r)}</option>`).join('');

  el.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
      <select id="pRevisionSegFilter" onchange="renderPricingRevision()" style="height:30px;font-size:12px;padding:0 6px;border-radius:var(--radius-md);border:0.5px solid var(--border-med);background:var(--bg);color:var(--text)">
        <option value="">Wszystkie segmenty</option>${segOptions}
      </select>
      <select id="pRevisionRepFilter" onchange="renderPricingRevision()" style="height:30px;font-size:12px;padding:0 6px;border-radius:var(--radius-md);border:0.5px solid var(--border-med);background:var(--bg);color:var(--text)">
        <option value="">Wszyscy opiekunowie</option>${repOptions}
      </select>
      <span style="font-size:12px;color:var(--text-muted)">${items.length} pozycji</span>
      <button class="ghost sm" onclick="pricingSelectAll()">☑ Zaznacz wszystkie</button>
      <button class="ghost sm" onclick="_pricingSel.clear();renderPricingRevision()">☐ Odznacz</button>
    </div>
    ${_pricingSel.size > 0 ? `
    <div style="background:var(--primary);color:#fff;border-radius:var(--radius-md);padding:8px 14px;display:flex;gap:12px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
      <span style="font-weight:600">${_pricingSel.size} zaznaczonych</span>
      <span>potencjał: <strong>${fmtPLN(selPotPos)}/mies.</strong> ≈ <strong>${fmtPLN(selPotPos*12)}/rok</strong></span>
      <button onclick="addToRaiseList()" style="background:#fff;color:var(--primary);border:none;border-radius:var(--radius-md);padding:4px 12px;font-weight:600;cursor:pointer">+ Dodaj do listy podwyżek</button>
    </div>` : ''}
    <div style="overflow-x:auto">
      <table class="data-table" style="font-size:11px;min-width:800px">
        <thead><tr>
          <th class="cb-col"><input type="checkbox" onchange="if(this.checked)pricingSelectAll();else{_pricingSel.clear();renderPricingRevision()}"></th>
          <th>Symbol IDS</th><th>Firma</th><th>Opiekun</th><th>Segment</th>
          <th style="text-align:right">Stawka</th>
          <th style="text-align:right">Target (edyt.)</th>
          <th style="text-align:right">Potencjał /mies.</th>
          <th>Ost. płatność</th>
        </tr></thead>
        <tbody>
          ${items.map(it => {
            const rowTarget = _pricingRaiseRowTargets[it.sn] ?? it.target;
            const pot = Math.max(0, rowTarget - it.price);
            return `<tr class="${_pricingSel.has(it.sn) ? 'row-selected' : ''}">
              <td><input type="checkbox" ${_pricingSel.has(it.sn)?'checked':''} onchange="pricingToggleSel('${esc(it.sn)}',this.checked)"></td>
              <td style="font-family:monospace">${esc(it.sn)}</td>
              <td style="font-size:11px">${esc(it.firma)}</td>
              <td style="font-size:11px">${esc(it.rep_name)}</td>
              <td>${segBadge(it.segment)}</td>
              <td style="text-align:right;font-weight:600">${fmtPLN(it.price)}</td>
              <td style="text-align:right">
                <input type="number" min="0" step="1" value="${rowTarget}"
                  style="width:70px;height:24px;font-size:11px;text-align:right;padding:0 4px;border-radius:4px;border:0.5px solid var(--border-med);background:var(--bg);color:var(--text)"
                  onchange="_pricingRaiseRowTargets['${esc(it.sn)}']=parseFloat(this.value||0);renderPricingRevision()">
              </td>
              <td style="text-align:right;color:#15803d;font-weight:600">${fmtPLN(pot)}</td>
              <td style="color:var(--text-muted)">${it.last_paid_ym || '—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function pricingToggleSel(sn, checked) {
  if (checked) _pricingSel.add(sn);
  else _pricingSel.delete(sn);
  renderPricingRevision();
}

function pricingSelectAll() {
  const fSeg = document.getElementById('pRevisionSegFilter')?.value || '';
  const fRep = document.getElementById('pRevisionRepFilter')?.value || '';
  let items = _pricingData?.device_list || [];
  if (fSeg) items = items.filter(i => i.segment === fSeg);
  if (fRep) items = items.filter(i => i.rep_name === fRep);
  items.forEach(i => _pricingSel.add(i.sn));
  renderPricingRevision();
}

async function addToRaiseList() {
  if (!_pricingSel.size) return;
  const items = (_pricingData?.device_list || [])
    .filter(i => _pricingSel.has(i.sn))
    .map(i => ({
      sn:            i.sn,
      firma:         i.firma,
      rep_name:      i.rep_name,
      current_price: i.price,
      target_price:  _pricingRaiseRowTargets[i.sn] ?? i.target,
      potential_msc: Math.max(0, (_pricingRaiseRowTargets[i.sn] ?? i.target) - i.price),
      segment:       i.segment,
    }));
  const r = await fetch(`${API}/pricing/raises`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  const d = await r.json().catch(()=>({}));
  if (r.ok) {
    _pricingSel.clear();
    setMsg('pricingMsg', `Dodano ${d.added} pozycji do listy podwyżek`, 'ok');
    renderPricingRevision();
    if (_pricingView === 'raises') renderPricingRaises();
  } else {
    setMsg('pricingMsg', d.detail || 'Błąd dodawania', 'error');
  }
}

// ── Lista podwyżek ────────────────────────────────────────────────────────────

async function renderPricingRaises() {
  const el = document.getElementById('pPanelRaises');
  if (!el) return;
  try {
    const r = await fetch(`${API}/pricing/raises`);
    if (!r.ok) { el.innerHTML = '<div style="color:var(--error)">Błąd ładowania</div>'; return; }
    const d = await r.json();
    const raises = d.raises || [];
    if (!raises.length) {
      el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">Brak pozycji na liście podwyżek.</div>';
      return;
    }
    el.innerHTML = `
      <table class="data-table" style="font-size:11px">
        <thead><tr>
          <th>Symbol IDS</th><th>Firma</th><th>Opiekun</th><th>Segment</th>
          <th style="text-align:right">Stawka</th>
          <th style="text-align:right">Target</th>
          <th style="text-align:right">Pot. /mies.</th>
          <th>Status</th><th>Uwaga</th><th>Nowa stawka</th><th></th>
        </tr></thead>
        <tbody>
          ${raises.map(rz => {
            const statusColors = {
              DO_KONTAKTU: '#3b82f6', W_TOKU: '#f59e0b',
              PODNIESIONO: '#22c55e', ODRZUCONO: '#ef4444'
            };
            const c = statusColors[rz.status] || '#888';
            const badge = `<span style="font-size:10px;padding:2px 7px;border-radius:99px;background:${c}20;color:${c};border:0.5px solid ${c}80">${PRICING_RAISE_LABELS[rz.status]||rz.status}</span>`;
            const isDone = rz.status === 'PODNIESIONO' || rz.status === 'ODRZUCONO';
            return `<tr>
              <td style="font-family:monospace">${esc(rz.sn)}</td>
              <td>${esc(rz.firma)}</td>
              <td>${esc(rz.rep_name)}</td>
              <td>${segBadge(rz.segment)}</td>
              <td style="text-align:right">${fmtPLN(rz.current_price)}</td>
              <td style="text-align:right">${fmtPLN(rz.target_price)}</td>
              <td style="text-align:right;color:#15803d;font-weight:600">${fmtPLN(rz.potential_msc)}</td>
              <td>
                ${isDone ? badge : `<select onchange="updateRaise(${rz.id},'status',this.value)" style="font-size:11px;height:26px;border-radius:4px;border:0.5px solid var(--border-med);background:var(--bg);color:var(--text)">
                  ${Object.entries(PRICING_RAISE_LABELS).map(([v,l]) =>
                    `<option value="${v}" ${rz.status===v?'selected':''}>${l}</option>`).join('')}
                </select>`}
              </td>
              <td>
                ${isDone ? esc(rz.note) : `<input type="text" value="${esc(rz.note)}" placeholder="Notatka"
                  style="width:120px;height:24px;font-size:11px;padding:0 6px;border-radius:4px;border:0.5px solid var(--border-med);background:var(--bg);color:var(--text)"
                  onblur="updateRaise(${rz.id},'note',this.value)">`}
              </td>
              <td>
                ${rz.status === 'PODNIESIONO' ? fmtPLN(rz.new_price) :
                  `<input type="number" min="0" step="1" value="${rz.new_price || ''}" placeholder="PLN"
                    style="width:70px;height:24px;font-size:11px;text-align:right;padding:0 4px;border-radius:4px;border:0.5px solid var(--border-med);background:var(--bg);color:var(--text)"
                    onblur="updateRaise(${rz.id},'new_price',this.value)">`}
              </td>
              <td style="white-space:nowrap">
                ${!isDone ? `<button class="ghost sm" style="font-size:10px;color:#dc2626" onclick="deleteRaise(${rz.id})">✕</button>` : ''}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    el.innerHTML = `<div style="color:var(--error)">Błąd: ${e.message}</div>`;
  }
}

async function updateRaise(id, field, value) {
  const body = {};
  if (field === 'status')    body.status    = value;
  if (field === 'note')      body.note      = value;
  if (field === 'new_price') body.new_price = parseFloat(value) || null;
  const r = await fetch(`${API}/pricing/raises/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.ok) renderPricingRaises();
  else setMsg('pricingMsg', 'Błąd aktualizacji', 'error');
}

async function deleteRaise(id) {
  if (!confirm('Usunąć tę pozycję z listy podwyżek?')) return;
  const r = await fetch(`${API}/pricing/raises/${id}`, { method: 'DELETE' });
  if (r.ok) renderPricingRaises();
  else { const d = await r.json().catch(()=>({})); setMsg('pricingMsg', d.detail||'Błąd usuwania', 'error'); }
}

// called when pricing tab is activated
async function onTabPricing() {
  await initPricing();
}
