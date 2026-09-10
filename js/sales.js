// ── WAIDS — Zakupy per klient ────────────────────────────────────────────────

let _salesData    = null;
let _salesSort    = { col: 'total', dir: -1 };
let _salesSearch  = '';

async function onTabSales() {
  const fromEl = document.getElementById('salesFrom');
  const toEl   = document.getElementById('salesTo');
  if (fromEl && !fromEl.value) {
    const y = new Date().getFullYear();
    fromEl.value = `${y}-01`;
    toEl.value   = `${y}-12`;
  }
  if (!_salesData) await loadSales();
}

async function loadSales() {
  const from = document.getElementById('salesFrom')?.value || '';
  const to   = document.getElementById('salesTo')?.value   || '';
  setSalesStatus('⏳ Ładowanie…');
  document.getElementById('salesTableWrap').innerHTML = '';
  document.getElementById('salesKpi').innerHTML = '';
  _salesData = null;
  try {
    let url = `${API}/devices/sales-by-client`;
    const params = [];
    if (from) params.push(`from_ym=${encodeURIComponent(from)}`);
    if (to)   params.push(`to_ym=${encodeURIComponent(to)}`);
    if (params.length) url += '?' + params.join('&');
    const r = await fetch(url);
    if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
    _salesData = await r.json();
    setSalesStatus('');
    renderSalesKpi();
    renderSalesTable();
  } catch (e) {
    setSalesStatus('❌ ' + e.message, true);
  }
}

function setSalesStatus(msg, err) {
  const el = document.getElementById('salesStatus');
  if (!el) return;
  el.textContent = msg;
  el.style.color = err ? 'var(--danger)' : 'var(--text-muted)';
}

function renderSalesKpi() {
  const s = _salesData?.summary || {};
  const el = document.getElementById('salesKpi');
  if (!el) return;
  el.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Klientów</div>
      <div class="kpi-value">${s.total_clients ?? 0}</div>
    </div>
    <div class="kpi-card" style="border-left:3px solid var(--green)">
      <div class="kpi-label">Urządzeń łącznie</div>
      <div class="kpi-value" style="color:var(--green)">${s.total_devices ?? 0}</div>
    </div>
  `;
}

function salesSortBy(col) {
  if (_salesSort.col === col) _salesSort.dir *= -1;
  else { _salesSort.col = col; _salesSort.dir = -1; }
  renderSalesTable();
}

function _salesArrow(col) {
  if (_salesSort.col !== col) return '<span style="opacity:.3">⇅</span>';
  return _salesSort.dir > 0 ? '↑' : '↓';
}

function salesSearchChanged(val) {
  _salesSearch = val;
  renderSalesTable();
}

function renderSalesTable() {
  const el = document.getElementById('salesTableWrap');
  if (!el || !_salesData) return;

  const mTypes = _salesData.maszyna_types || [];
  const search = (_salesSearch || '').toLowerCase();

  let rows = (_salesData.clients || []).filter(c =>
    !search || c.firma.toLowerCase().includes(search)
  );

  const { col, dir } = _salesSort;
  rows = [...rows].sort((a, b) => {
    let av, bv;
    if (col === 'firma') { av = a.firma; bv = b.firma; }
    else if (col === 'total') { av = a.total; bv = b.total; }
    else { av = a.by_maszyna[col] ?? 0; bv = b.by_maszyna[col] ?? 0; }
    if (typeof av === 'string') return dir * av.localeCompare(bv);
    return dir * (av - bv);
  });

  if (!rows.length) {
    el.innerHTML = `<div style="color:var(--text-muted);padding:2rem;text-align:center">Brak danych dla wybranego okresu.</div>`;
    return;
  }

  const thFirma = `<th style="cursor:pointer" onclick="salesSortBy('firma')">Firma ${_salesArrow('firma')}</th>`;
  const thTotal = `<th style="cursor:pointer;text-align:right" onclick="salesSortBy('total')">Łącznie ${_salesArrow('total')}</th>`;
  const thTypes = mTypes.map(m =>
    `<th style="cursor:pointer;text-align:right;white-space:nowrap" onclick="salesSortBy('${esc(m)}')">${esc(m)} ${_salesArrow(m)}</th>`
  ).join('');
  const thFirmType = `<th style="text-align:center">Typ</th>`;

  const tbody = rows.map(c => {
    const typeCells = mTypes.map(m => {
      const cnt = c.by_maszyna[m] || 0;
      return `<td style="text-align:right;color:${cnt > 0 ? 'var(--text)' : 'var(--text-muted)'}">${cnt > 0 ? cnt : '—'}</td>`;
    }).join('');
    return `<tr>
      <td style="font-weight:600">${esc(c.firma)}</td>
      <td style="text-align:right;font-weight:700;color:var(--green)">${c.total}</td>
      ${typeCells}
      <td style="text-align:center;font-size:11px;color:var(--text-muted)">${esc(c.firm_type || 'ids')}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div style="overflow-x:auto">
      <table class="data-table" style="font-size:12px;min-width:500px">
        <thead>
          <tr>${thFirma}${thTotal}${thTypes}${thFirmType}</tr>
        </thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
  `;
}

function exportSalesXLSX() {
  if (!_salesData || !_salesData.clients.length) return;
  const mTypes = _salesData.maszyna_types || [];
  const from   = document.getElementById('salesFrom')?.value || '';
  const to     = document.getElementById('salesTo')?.value   || '';

  const headers = ['Firma', 'Typ firmy', 'Łącznie', ...mTypes];
  const rows = (_salesData.clients || []).map(c => [
    c.firma,
    c.firm_type || 'ids',
    c.total,
    ...mTypes.map(m => c.by_maszyna[m] || 0),
  ]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, 'Zakupy_per_klient');
  XLSX.writeFile(wb, `zakupy_per_klient_${from}_${to}.xlsx`);
}
