// ── WAIDS — Pierwsze IDS / Handlowiec ────────────────────────────────────

let _firstIdsData   = null;
let _firstIdsMinPct = 100;
let _firstIdsSearch = '';

async function loadBonusTab() {
  await _loadFirstIdsReps();
  // Default range: previous year full
  const now = new Date();
  const y   = now.getFullYear() - 1;
  const fromEl = document.getElementById('bonusFrom');
  const toEl   = document.getElementById('bonusTo');
  if (fromEl && !fromEl.value) fromEl.value = `${y}-01`;
  if (toEl   && !toEl.value)   toEl.value   = `${y}-12`;
}

async function _loadFirstIdsReps() {
  const sel = document.getElementById('bonusRep');
  if (!sel || sel.options.length > 1) return;
  try {
    const d = await (await fetch(`${API}/reps`)).json();
    const reps = Array.isArray(d) ? d : (d.reps || []);
    sel.innerHTML = '<option value="">— wybierz handlowca —</option>' +
      reps.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
  } catch(e) {
    sel.innerHTML = '<option value="">Błąd ładowania</option>';
  }
}

async function runBonusCheck() {
  const repId  = document.getElementById('bonusRep').value;
  const from   = document.getElementById('bonusFrom').value;
  const to     = document.getElementById('bonusTo').value;
  const months = parseInt(document.getElementById('bonusMonths').value) || 12;
  _firstIdsMinPct = parseInt(document.getElementById('bonusThreshold').value) || 100;

  if (!repId) { setMsg('msgBonus', 'Wybierz handlowca.', 'err'); return; }
  if (!from || !to) { setMsg('msgBonus', 'Wybierz zakres dat pierwszej płatności.', 'err'); return; }
  if (from > to) { setMsg('msgBonus', 'Data od nie może być późniejsza niż do.', 'err'); return; }

  setMsg('msgBonus', '⏳ Ładuję dane…', 'info');
  document.getElementById('bonusResult').style.display = 'none';

  try {
    const url = `${API}/reps/first-ids-check?rep_id=${repId}` +
                `&first_pay_from=${from}&first_pay_to=${to}&window_months=${months}`;
    const d = await (await fetch(url)).json();
    if (d.detail) throw new Error(d.detail);
    _firstIdsData = d.devices || [];
    const s = d.summary || {};

    setMsg('msgBonus', '');
    renderBonusSummary(s);
    renderBonusTable();
    document.getElementById('bonusResult').style.display = '';
  } catch(e) {
    setMsg('msgBonus', '❌ Błąd: ' + e.message, 'err');
  }
}

function renderBonusSummary(s) {
  const wrap = document.getElementById('bonusSummary');
  if (!wrap) return;
  const amt = (s.total_amount || 0).toLocaleString('pl-PL',
    {minimumFractionDigits:2, maximumFractionDigits:2});
  const winMonths = parseInt(document.getElementById('bonusMonths').value) || 12;
  wrap.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-val">${s.total || 0}</div>
      <div class="kpi-label">Urządzeń z pierwszą płatnością w przedziale</div>
    </div>
    <div class="kpi-card" style="border-color:#1D9E75">
      <div class="kpi-val" style="color:#1D9E75">${s.full || 0}</div>
      <div class="kpi-label">Pełnych ${winMonths} mies. (${_firstIdsMinPct}%+)</div>
    </div>
    <div class="kpi-card" style="border-color:var(--amber)">
      <div class="kpi-val" style="color:var(--amber)">${s.partial || 0}</div>
      <div class="kpi-label">Częściowe</div>
    </div>
    <div class="kpi-card" style="border-color:var(--danger)">
      <div class="kpi-val" style="color:var(--danger)">${s.no_pay || 0}</div>
      <div class="kpi-label">Tylko pierwsza płatność</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-val" style="font-size:1.1rem">${amt}</div>
      <div class="kpi-label">Łączna kwota</div>
    </div>`;
}

function renderBonusTable() {
  const tbody = document.getElementById('bonusTableBody');
  const thead = document.getElementById('bonusMonthsHeader');
  const curYM = nowYM();
  const search = (_firstIdsSearch || '').toLowerCase();
  if (!tbody) return;

  const show = (_firstIdsData || []).filter(d => {
    if (!search) return true;
    return [d.firma, d.sn, d.maszyna, d.customer, d.operator]
      .join(' ').toLowerCase().includes(search);
  });

  if (!show.length) {
    if (thead) thead.innerHTML = '';
    tbody.innerHTML = `<tr><td colspan="8"
      style="text-align:center;color:var(--text-muted);padding:24px">
      Brak urządzeń z pierwszą płatnością w wybranym przedziale.</td></tr>`;
    return;
  }

  // ── Global aligned calendar ───────────────────────────────────────────────
  // Collect ALL months from ALL devices, sort, deduplicate.
  // Each device has its own window starting at first_pay — we need one shared range.
  const allMonths = [...new Set(
    show.flatMap(d => d.monthly_detail.map(m => m.month))
  )].sort();

  // Month headers
  if (thead) {
    thead.innerHTML = allMonths.map(m => {
      const isFuture = m > curYM;
      return `<th style="padding:4px 3px;font-size:10px;font-weight:500;
                  color:${isFuture ? 'var(--border)' : 'var(--text-muted)'};
                  text-align:center;white-space:nowrap;min-width:22px">
        ${m.slice(5)}<br><span style="opacity:.6">${m.slice(2,4)}</span>
      </th>`;
    }).join('');
  }

  tbody.innerHTML = show.map(d => {
    const qualifies = d.coverage_pct >= _firstIdsMinPct;
    const rowBg = qualifies
      ? 'background:rgba(29,158,117,.05)'
      : d.months_paid <= 1 ? 'background:rgba(226,75,74,.03)' : '';
    const pctColor = d.coverage_pct === 100 ? 'var(--green)'
                   : d.coverage_pct >= 50   ? 'var(--amber)' : 'var(--danger)';

    // Build per-month lookup for this device
    const detailMap = Object.fromEntries(d.monthly_detail.map(m => [m.month, m]));

    const monthCells = allMonths.map(m => {
      // Before this device's subscription started → gray
      if (m < d.first_pay) {
        return `<td style="text-align:center;padding:3px 2px" title="${m}: przed pierwszą płatnością">
          <span style="display:inline-block;width:14px;height:14px;border-radius:3px;
                       background:#d1d5db;opacity:.4"></span></td>`;
      }
      // Future month (not yet occurred) → light gray
      if (m > curYM) {
        return `<td style="text-align:center;padding:3px 2px" title="${m}: przyszły miesiąc">
          <span style="display:inline-block;width:14px;height:14px;border-radius:3px;
                       background:#e5e7eb;opacity:.5"></span></td>`;
      }
      // Month in device's window
      const entry = detailMap[m];
      if (!entry) {
        // Month is past device's window end → gray
        return `<td style="text-align:center;padding:3px 2px" title="${m}: poza oknem">
          <span style="display:inline-block;width:14px;height:14px;border-radius:3px;
                       background:#d1d5db;opacity:.4"></span></td>`;
      }
      const COLORS = {
        paid:        ['#1D9E75', entry.amount > 0 ? fmtPLN(entry.amount) : 'Opłacone'],
        suspended:   ['#3B82F6', 'Zawieszone'],
        gap_resumed: ['#F59E0B', 'Przerwa — później wznowiono'],
        unpaid:      ['#E24B4A', 'Nie opłacone'],
      };
      const [bg, tip] = COLORS[entry.status] || ['#9ca3af', entry.status];
      return `<td style="text-align:center;padding:3px 2px" title="${m}: ${tip}">
        <span style="display:inline-block;width:14px;height:14px;border-radius:3px;
                     background:${bg}"></span></td>`;
    }).join('');

    const susNote = d.months_suspended > 0
      ? `<span style="font-size:10px;color:#3B82F6;margin-left:3px"
               title="${d.months_suspended} mies. zawieszonych">+${d.months_suspended}⏸</span>` : '';
    const gapNote = d.months_gap_resumed > 0
      ? `<span style="font-size:10px;color:var(--amber);margin-left:3px"
               title="${d.months_gap_resumed} przerw z wznowieniem">${d.months_gap_resumed}⚠</span>` : '';

    return `<tr style="${rowBg};border-bottom:1px solid var(--border-light)">
      <td style="padding:6px 8px;text-align:center;width:28px">
        ${qualifies
          ? '<span style="color:var(--green);font-size:15px" title="Kwalifikuje">✅</span>'
          : '<span style="color:var(--danger)" title="Nie kwalifikuje">✗</span>'}
      </td>
      <td style="padding:6px 10px;font-size:12px;font-weight:600">${esc(d.firma||'—')}</td>
      <td style="padding:6px 10px;font-size:11px;color:var(--text-muted)">${esc(d.customer||'—')}</td>
      <td style="padding:6px 10px;font-family:monospace;font-size:11px">${esc(d.sn)}</td>
      <td style="padding:6px 10px;font-size:11px;color:var(--text-muted)">${esc(d.maszyna||'—')}</td>
      <td style="padding:6px 6px;white-space:nowrap">
        <span style="font-size:11px;color:var(--text-muted)">pierwsza:</span>
        <strong style="font-size:12px;font-family:monospace">${esc(d.first_pay)}</strong>
      </td>
      <td style="padding:6px 8px;text-align:center;font-weight:700;color:${pctColor};white-space:nowrap">
        ${d.months_paid}/${d.months_billable}${susNote}${gapNote}
      </td>
      <td style="padding:6px 10px;text-align:right;font-size:12px;white-space:nowrap">
        ${d.total_amount > 0 ? fmtPLN(d.total_amount) : '<span style="color:var(--text-muted)">—</span>'}
      </td>
      ${monthCells}
    </tr>`;
  }).join('');
}

function bonusSearchChanged(val) {
  _firstIdsSearch = val;
  if (_firstIdsData) renderBonusTable();
}

function bonusThresholdChanged() {
  _firstIdsMinPct = parseInt(document.getElementById('bonusThreshold').value) || 100;
  if (_firstIdsData) {
    const s = _bonus_summary_js(_firstIdsData);
    renderBonusSummary(s);
    renderBonusTable();
  }
}

function _bonus_summary_js(devices) {
  if (!devices.length) return {total:0,full:0,partial:0,no_pay:0,total_amount:0,avg_coverage:0};
  const full     = devices.filter(d => d.coverage_pct >= _firstIdsMinPct).length;
  const no_pay   = devices.filter(d => d.months_paid <= 1).length;
  const partial  = devices.length - full - no_pay;
  const total_amount = devices.reduce((s,d) => s + d.total_amount, 0);
  const avg = Math.round(devices.reduce((s,d) => s + d.coverage_pct, 0) / devices.length);
  return {total: devices.length, full, partial, no_pay, total_amount, avg_coverage: avg};
}

function exportBonusXLSX() {
  if (!_firstIdsData || !_firstIdsData.length) return;
  const repName = document.getElementById('bonusRep').selectedOptions[0]?.text || 'handlowiec';
  const from    = document.getElementById('bonusFrom').value;
  const to      = document.getElementById('bonusTo').value;

  const STATUS_SYM = { paid:'OK', suspended:'⏸', gap_resumed:'⚠', unpaid:'BRAK' };
  const headers = ['✓', 'Firma', 'Klient', 'SN', 'Maszyna', 'Pierwsza płatność',
                   'Opłacone/Wymagane', 'Kwota',
                   ..._firstIdsData[0].monthly_detail.map(m => m.month)];

  const rows = _firstIdsData.map(d => [
    d.coverage_pct >= _firstIdsMinPct ? 'TAK' : 'NIE',
    d.firma, d.customer, d.sn, d.maszyna, d.first_pay,
    `${d.months_paid}/${d.months_billable}`,
    d.total_amount,
    ...d.monthly_detail.map(m => STATUS_SYM[m.status] || m.status),
  ]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, 'Pierwsze_IDS');
  XLSX.writeFile(wb, `pierwsze_ids_${repName}_${from}_${to}.xlsx`);
}
