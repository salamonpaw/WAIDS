// ── WAIDS — Premie handlowców ─────────────────────────────────────────────

let _bonusData    = null;
let _bonusWindow  = [];
let _bonusMinPct  = 100;   // próg kwalifikacji (%) — można zmienić w UI
let _bonusSearch  = '';

async function loadBonusTab() {
  await _loadBonusReps();
  // Default: start = 12 months ago
  const d = new Date();
  d.setMonth(d.getMonth() - 11);
  const defaultFrom = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  const inp = document.getElementById('bonusFrom');
  if (inp && !inp.value) inp.value = defaultFrom;
}

async function _loadBonusReps() {
  const sel = document.getElementById('bonusRep');
  if (!sel || sel.options.length > 1) return;  // already loaded
  try {
    const d = await (await fetch(`${API}/reps`)).json();
    const reps = d.reps || d || [];
    sel.innerHTML = '<option value="">— wybierz handlowca —</option>' +
      reps.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
  } catch(e) {
    sel.innerHTML = '<option value="">Błąd ładowania handlowców</option>';
  }
}

async function runBonusCheck() {
  const repId    = document.getElementById('bonusRep').value;
  const from     = document.getElementById('bonusFrom').value;
  const months   = parseInt(document.getElementById('bonusMonths').value) || 12;
  _bonusMinPct   = parseInt(document.getElementById('bonusThreshold').value) || 100;

  if (!repId)  { setMsg('msgBonus', 'Wybierz handlowca.', 'err'); return; }
  if (!from)   { setMsg('msgBonus', 'Wybierz miesiąc startowy.', 'err'); return; }

  setMsg('msgBonus', '⏳ Ładuję dane…', 'info');
  document.getElementById('bonusResult').style.display = 'none';

  try {
    const url = `${API}/reps/bonus-check?rep_id=${repId}&from_month=${from}&months=${months}`;
    const d = await (await fetch(url)).json();
    _bonusData   = d.devices || [];
    _bonusWindow = d.window  || [];
    const s      = d.summary || {};

    setMsg('msgBonus', '', 'info');
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
  const totalAmt = (s.total_amount || 0).toLocaleString('pl-PL', {minimumFractionDigits:2, maximumFractionDigits:2});
  wrap.innerHTML = `
    <div class="kpi-card" style="border-color:#1D9E75">
      <div class="kpi-val" style="color:#1D9E75">${s.full || 0}</div>
      <div class="kpi-label">Pełne (${_bonusMinPct}%+)</div>
    </div>
    <div class="kpi-card" style="border-color:var(--amber)">
      <div class="kpi-val" style="color:var(--amber)">${s.partial || 0}</div>
      <div class="kpi-label">Częściowe</div>
    </div>
    <div class="kpi-card" style="border-color:var(--danger)">
      <div class="kpi-val" style="color:var(--danger)">${s.no_pay || 0}</div>
      <div class="kpi-label">Brak wpłat</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-val">${s.avg_coverage || 0}%</div>
      <div class="kpi-label">Śr. pokrycie</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-val" style="font-size:1.1rem">${totalAmt}</div>
      <div class="kpi-label">Łączna kwota</div>
    </div>`;
}

function renderBonusTable() {
  const tbody  = document.getElementById('bonusTableBody');
  const hdr    = document.getElementById('bonusMonthsHeader');
  const search = (_bonusSearch || '').toLowerCase();
  if (!tbody) return;

  // Month headers
  if (hdr) {
    hdr.innerHTML = _bonusWindow.map(m =>
      `<th style="padding:4px 3px;font-size:10px;font-weight:500;white-space:nowrap;
                  color:var(--text-muted);text-align:center">${m.slice(5)}<br>${m.slice(0,4)}</th>`
    ).join('');
  }

  const show = _bonusData.filter(d => {
    if (!search) return true;
    return [d.firma, d.sn, d.maszyna, d.customer, d.operator].join(' ').toLowerCase().includes(search);
  });

  if (!show.length) {
    tbody.innerHTML = `<tr><td colspan="${_bonusWindow.length + 7}"
      style="text-align:center;color:var(--text-muted);padding:20px">Brak wyników.</td></tr>`;
    return;
  }

  tbody.innerHTML = show.map(d => {
    const qualifies = d.coverage_pct >= _bonusMinPct;
    const rowBg     = qualifies ? 'background:rgba(29,158,117,.06)'
                    : d.months_paid === 0 ? 'background:rgba(226,75,74,.04)' : '';

    const pctColor  = d.coverage_pct === 100 ? 'var(--green)'
                    : d.coverage_pct >= 50    ? 'var(--amber)' : 'var(--danger)';

    const monthCells = d.monthly_detail.map(m => {
      const [bg, title] = {
        paid:        ['#1D9E75', 'Opłacone: ' + (m.amount ? fmtPLN(m.amount) : '—')],
        suspended:   ['#3B82F6', 'Zawieszone'],
        gap_resumed: ['#F59E0B', 'Przerwa — wznowiono później'],
        unpaid:      ['#E24B4A', 'Nie opłacone'],
      }[m.status] || ['#9ca3af', m.status];
      return `<td style="text-align:center;padding:2px 3px">
        <span title="${title}" style="display:inline-block;width:14px;height:14px;
              border-radius:3px;background:${bg}"></span></td>`;
    }).join('');

    return `<tr style="${rowBg};border-bottom:1px solid var(--border-light)">
      <td style="padding:6px 10px">
        ${qualifies
          ? '<span style="color:var(--green);font-weight:700" title="Kwalifikuje do premii">✅</span>'
          : '<span style="color:var(--danger)" title="Nie kwalifikuje">✗</span>'}
      </td>
      <td style="padding:6px 10px;font-size:12px">${esc(d.firma||'—')}</td>
      <td style="padding:6px 10px;font-size:11px;color:var(--text-muted)">${esc(d.customer||'—')}</td>
      <td style="padding:6px 10px;font-family:monospace;font-size:11px">${esc(d.sn)}</td>
      <td style="padding:6px 10px;font-size:11px;color:var(--text-muted)">${esc(d.maszyna||'—')}</td>
      <td style="padding:6px 10px;text-align:center;font-weight:700;color:${pctColor}">
        ${d.months_paid}/${d.months_billable}
        ${d.months_suspended > 0 ? `<span style="font-size:10px;color:#3B82F6" title="Zawieszone: ${d.months_suspended} mies."> +${d.months_suspended}⏸</span>` : ''}
        ${d.months_gap_resumed > 0 ? `<span style="font-size:10px;color:var(--amber)" title="Przerwa z wznowieniem: ${d.months_gap_resumed} mies."> ${d.months_gap_resumed}⚠</span>` : ''}
      </td>
      <td style="padding:6px 10px;text-align:right;font-size:12px">
        ${d.total_amount > 0 ? fmtPLN(d.total_amount) : '<span style="color:var(--text-muted)">—</span>'}
      </td>
      ${monthCells}
    </tr>`;
  }).join('');
}

function bonusSearchChanged(val) {
  _bonusSearch = val;
  if (_bonusData) renderBonusTable();
}

function bonusThresholdChanged() {
  _bonusMinPct = parseInt(document.getElementById('bonusThreshold').value) || 100;
  if (_bonusData) {
    renderBonusSummary({
      full:         _bonusData.filter(d => d.coverage_pct >= _bonusMinPct).length,
      partial:      _bonusData.filter(d => d.coverage_pct < _bonusMinPct && d.months_paid > 0).length,
      no_pay:       _bonusData.filter(d => d.months_paid === 0).length,
      avg_coverage: _bonusData.length ? Math.round(_bonusData.reduce((s,d)=>s+d.coverage_pct,0)/_bonusData.length) : 0,
      total_amount: _bonusData.reduce((s,d)=>s+d.total_amount, 0),
    });
    renderBonusTable();
  }
}

function exportBonusXLSX() {
  if (!_bonusData || !_bonusData.length) return;
  const repName = document.getElementById('bonusRep').selectedOptions[0]?.text || 'handlowiec';
  const from    = document.getElementById('bonusFrom').value;

  const headers = ['Kwalifikuje', 'Firma', 'Klient', 'SN', 'Maszyna',
                   `Opłacone/${_bonusWindow.length}`, 'Kwota (PLN)',
                   ...(_bonusWindow.map(m => m))];

  const STATUS_SYM = { paid:'✅', suspended:'⏸', gap_resumed:'⚠', unpaid:'✗' };

  const rows = _bonusData.map(d => [
    d.coverage_pct >= _bonusMinPct ? 'TAK' : 'NIE',
    d.firma, d.customer, d.sn, d.maszyna,
    `${d.months_paid}/${d.months_billable}`,
    d.total_amount,
    ...d.monthly_detail.map(m => STATUS_SYM[m.status] || m.status),
  ]);

  const ws_data = [headers, ...rows];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(ws_data);
  XLSX.utils.book_append_sheet(wb, ws, 'Premie');
  XLSX.writeFile(wb, `premie_${repName}_${from}.xlsx`);
}
