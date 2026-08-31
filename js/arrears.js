// ── WAIDS — Zaległości (lapsed & never-paid devices) ──────────────────────────

let _arrearsData = null;
let _arrearsView = 'lapsed';    // 'lapsed' | 'never'
let _arrearsMinMonths = 1;
let _arrearsRepFilter = '';
let _arrearsSort = { col: 'total_arrears', dir: -1 };
let _arrearsNeverSort = { col: 'months_since_prod', dir: -1 };

async function onTabArrears() {
  if (!_arrearsData) await loadArrears();
}

async function loadArrears() {
  const btnRefresh = document.getElementById('arrBtnRefresh');
  if (btnRefresh) btnRefresh.disabled = true;
  setArrearsStatus('⏳ Ładowanie…');
  try {
    const min = parseInt(document.getElementById('arrMinMonths')?.value || '1', 10) || 1;
    _arrearsMinMonths = min;
    const r = await fetch(`${API}/arrears?min_months=${min}`);
    if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
    _arrearsData = await r.json();
    setArrearsStatus('');
    renderArrearsKpi();
    renderArrearsRepFilter();
    renderArrearsTable();
  } catch (e) {
    setArrearsStatus('❌ ' + e.message, true);
  } finally {
    if (btnRefresh) btnRefresh.disabled = false;
  }
}

function setArrearsStatus(msg, err) {
  const el = document.getElementById('arrStatus');
  if (!el) return;
  el.textContent = msg;
  el.style.color = err ? 'var(--red)' : 'var(--text-muted)';
}

function switchArrearsView(v) {
  _arrearsView = v;
  document.getElementById('arrBtnLapsed').classList.toggle('active', v === 'lapsed');
  document.getElementById('arrBtnNever').classList.toggle('active',  v === 'never');
  renderArrearsTable();
}

function renderArrearsKpi() {
  const s = _arrearsData?.summary || {};
  const el = document.getElementById('arrKpi');
  if (!el) return;
  el.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Zaległe (lapsed)</div>
      <div class="kpi-value">${s.lapsed_count ?? 0}</div>
      <div class="kpi-sub">urządzeń</div>
    </div>
    <div class="kpi-card" style="border-left:3px solid var(--red)">
      <div class="kpi-label">Szacowane zaległości</div>
      <div class="kpi-value" style="color:var(--red)">${fmtPLN(s.total_lapsed_arrears ?? 0)}</div>
      <div class="kpi-sub">łącznie / mies. × nieobecne miesiące</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Nigdy nieopłacone</div>
      <div class="kpi-value">${s.never_paid_count ?? 0}</div>
      <div class="kpi-sub">urządzeń</div>
    </div>
  `;
}

function renderArrearsRepFilter() {
  const sel = document.getElementById('arrRepFilter');
  if (!sel || !_arrearsData) return;
  const cur = sel.value;
  const allReps = new Set();
  (_arrearsData.lapsed || []).forEach(d => allReps.add(d.rep_name));
  (_arrearsData.never_paid || []).forEach(d => allReps.add(d.rep_name));
  const sorted = [...allReps].filter(Boolean).sort();
  sel.innerHTML = '<option value="">— Wszyscy opiekunowie —</option>' +
    sorted.map(r => `<option value="${esc(r)}" ${r === cur ? 'selected' : ''}>${esc(r)}</option>`).join('');
  sel.value = sorted.includes(cur) ? cur : '';
}

function onArrearsRepFilter() {
  _arrearsRepFilter = document.getElementById('arrRepFilter')?.value || '';
  renderArrearsTable();
}

function renderArrearsTable() {
  if (_arrearsView === 'lapsed') renderArrearsLapsed();
  else                            renderArrearsNever();
}

function _arrearsMonthsColor(months) {
  if (months <= 2)  return '#15803d';
  if (months <= 6)  return '#b45309';
  if (months <= 12) return '#c2410c';
  return '#991b1b';
}

function arrSortLapsed(col) {
  if (_arrearsSort.col === col) _arrearsSort.dir *= -1;
  else { _arrearsSort.col = col; _arrearsSort.dir = col === 'last_paid_ym' ? 1 : -1; }
  renderArrearsLapsed();
}

function arrSortNever(col) {
  if (_arrearsNeverSort.col === col) _arrearsNeverSort.dir *= -1;
  else { _arrearsNeverSort.col = col; _arrearsNeverSort.dir = -1; }
  renderArrearsNever();
}

function _sortArrow(col, state) {
  if (state.col !== col) return '<span style="opacity:.3">⇅</span>';
  return state.dir > 0 ? '↑' : '↓';
}

function renderArrearsLapsed() {
  const el = document.getElementById('arrTableWrap');
  if (!el) return;
  let rows = (_arrearsData?.lapsed || []).filter(
    d => !_arrearsRepFilter || d.rep_name === _arrearsRepFilter
  );

  const { col, dir } = _arrearsSort;
  rows = [...rows].sort((a, b) => {
    const av = a[col] ?? 0, bv = b[col] ?? 0;
    if (typeof av === 'string') return dir * av.localeCompare(bv);
    return dir * (av - bv);
  });

  const totalArrears = rows.reduce((s, r) => s + r.total_arrears, 0);
  const totalMrr     = rows.reduce((s, r) => s + r.monthly_rate, 0);

  const th = (label, c) =>
    `<th style="cursor:pointer;white-space:nowrap" onclick="arrSortLapsed('${c}')">${label} ${_sortArrow(c, _arrearsSort)}</th>`;

  el.innerHTML = `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">
      ${rows.length} urządzeń · szac. zaległości: <strong style="color:var(--red)">${fmtPLN(totalArrears)}</strong>
      · utracone MRR: <strong>${fmtPLN(totalMrr)}/mies.</strong>
    </div>
    <div style="overflow-x:auto">
      <table class="data-table" style="font-size:12px;min-width:700px">
        <thead><tr>
          ${th('Symbol IDS','sn')}
          ${th('Firma','firma')}
          ${th('Opiekun','rep_name')}
          ${th('Ost. płatność','last_paid_ym')}
          ${th('Mies. bez opłat','months_unpaid')}
          ${th('Stawka /mies.','monthly_rate')}
          ${th('Szac. zaległość','total_arrears')}
          <th>Typ</th>
        </tr></thead>
        <tbody>
          ${rows.length ? rows.map(d => {
            const urgency = d.is_suspended ? '#3B82F6' : _arrearsMonthsColor(d.months_unpaid);
            const suspBadge = d.is_suspended
              ? `<span style="font-size:10px;background:#3B82F620;color:#3B82F6;border:0.5px solid #3B82F6;border-radius:99px;padding:1px 7px;margin-left:4px">⏸ zawieszone</span>`
              : '';
            return `<tr style="${d.is_suspended ? 'opacity:.75' : ''}">
              <td style="font-family:monospace">${esc(d.sn)}</td>
              <td>${esc(d.firma)}${suspBadge}</td>
              <td>${esc(d.rep_name)}</td>
              <td style="color:${urgency};font-weight:600">${esc(d.last_paid_ym)}</td>
              <td style="text-align:center;font-weight:700;color:${urgency}">${d.months_unpaid}</td>
              <td style="text-align:right">${d.monthly_rate > 0 ? fmtPLN(d.monthly_rate) : '—'}</td>
              <td style="text-align:right;font-weight:700;color:${urgency}">${d.is_suspended ? '<span style="color:#3B82F6">⏸</span>' : d.total_arrears > 0 ? fmtPLN(d.total_arrears) : '—'}</td>
              <td style="color:var(--text-muted);font-size:11px">${esc(d.firm_type || 'ids')}</td>
            </tr>`;
          }).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:2rem">Brak zaległych urządzeń.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function renderArrearsNever() {
  const el = document.getElementById('arrTableWrap');
  if (!el) return;
  let rows = (_arrearsData?.never_paid || []).filter(
    d => !_arrearsRepFilter || d.rep_name === _arrearsRepFilter
  );

  const { col, dir } = _arrearsNeverSort;
  rows = [...rows].sort((a, b) => {
    const av = a[col] ?? '', bv = b[col] ?? '';
    if (typeof av === 'string') return dir * av.localeCompare(bv);
    return dir * (av - bv);
  });

  const th = (label, c) =>
    `<th style="cursor:pointer;white-space:nowrap" onclick="arrSortNever('${c}')">${label} ${_sortArrow(c, _arrearsNeverSort)}</th>`;

  el.innerHTML = `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">
      ${rows.length} urządzeń — wyprodukowane, bez żadnej płatności
    </div>
    <div style="overflow-x:auto">
      <table class="data-table" style="font-size:12px;min-width:600px">
        <thead><tr>
          ${th('Symbol IDS','sn')}
          ${th('Firma','firma')}
          ${th('Opiekun','rep_name')}
          ${th('Data produkcji','prod_date')}
          ${th('Mies. od prod.','months_since_prod')}
          <th>Typ</th>
        </tr></thead>
        <tbody>
          ${rows.length ? rows.map(d => {
            const urgency = d.is_suspended ? '#3B82F6' : _arrearsMonthsColor(d.months_since_prod);
            const suspBadge = d.is_suspended
              ? `<span style="font-size:10px;background:#3B82F620;color:#3B82F6;border:0.5px solid #3B82F6;border-radius:99px;padding:1px 7px;margin-left:4px">⏸ zawieszone</span>`
              : '';
            return `<tr style="${d.is_suspended ? 'opacity:.75' : ''}">
              <td style="font-family:monospace">${esc(d.sn)}</td>
              <td>${esc(d.firma)}${suspBadge}</td>
              <td>${esc(d.rep_name)}</td>
              <td style="color:${urgency}">${esc(d.prod_date || '—')}</td>
              <td style="text-align:center;font-weight:700;color:${urgency}">${d.months_since_prod || '—'}</td>
              <td style="color:var(--text-muted);font-size:11px">${esc(d.firm_type || 'ids')}</td>
            </tr>`;
          }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:2rem">Brak urządzeń bez płatności.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}
