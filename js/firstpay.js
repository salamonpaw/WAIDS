// ── WAIDS — first-payment tab ─────────────────────────────────────────────

let _fpRows    = [];     // all rows for current search (before gap/customer filter)
let _fpIsRange = false;  // true when showing a date range (multiple months)

async function loadFirstPayTab() {
  // Auto-fetch if results not yet loaded
  if (!results.length) {
    setMsg('msgFp', '⏳ Ładuję dane z bazy…');
    try {
      const r = await fetch(`${API}/analyze`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      results = data.results;
      populateFilters();   // build repColorMap too
      setMsg('msgFp', '');
    } catch(e) {
      setMsg('msgFp', '❌ Brak połączenia z API — uruchom backend.', 'err');
      return;
    }
  }

  // Default month = PREVIOUS month (devices just leaving production)
  const fpMonth = document.getElementById('fpMonth');
  if (!fpMonth.value) {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    fpMonth.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }

  // Populate rep dropdown from repColorMap (already built)
  const fpRep = document.getElementById('fpRep');
  const repNames = Object.keys(repColorMap).sort();
  fpRep.innerHTML = '<option value="">Wszyscy handlowcy</option>' +
    repNames.map(n => {
      const info = repColorMap[n];
      return `<option value="${esc(n)}">${esc(info ? info.initials + ' — ' + n : n)}</option>`;
    }).join('');

  // Populate customer dropdown
  const fpCustomer = document.getElementById('fpCustomer');
  const prevCust = fpCustomer.value;
  const customers = [...new Set(
    results.filter(r => r.customer).map(r => r.customer)
  )].sort((a,b) => a.localeCompare(b));
  fpCustomer.innerHTML = '<option value="">Wszyscy klienci</option>' +
    customers.map(c => `<option value="${esc(c)}"${c===prevCust?' selected':''}>${esc(c)}</option>`).join('');
}

async function runFirstPaySearch() {
  const ymFrom = document.getElementById('fpMonth').value;
  const ymTo   = (document.getElementById('fpMonthTo').value || '').trim();
  const rep    = document.getElementById('fpRep').value;
  const isRange = ymTo && ymTo >= ymFrom;

  if (!ymFrom) { setMsg('msgFp', '⚠ Wybierz miesiąc produkcji.', 'err'); return; }
  if (!results.length) { setMsg('msgFp', '⚠ Brak danych — przejdź do zakładki Raport.', 'err'); return; }

  // Filtruj mastery wg daty produkcji (nie wg daty płatności)
  _fpRows = results.filter(r => {
    if (r.device_type !== 'master') return false;
    if (!r.prod_date) return false;
    const pd = r.prod_date.slice(0,7);
    return isRange ? (pd >= ymFrom && pd <= ymTo) : (pd === ymFrom);
  });
  if (rep) _fpRows = _fpRows.filter(r => r.handlowcy && r.handlowcy.includes(rep));
  // Sort: brak płatności (krytyczne) → zapłacone; w ramach grupy wg firmy i SN
  _fpRows.sort((a,b) => {
    const aPaid = (a.total_months||0) > 0 ? 1 : 0;
    const bPaid = (b.total_months||0) > 0 ? 1 : 0;
    return aPaid - bPaid || (a.firma||'').localeCompare(b.firma||'') || (a.sn||'').localeCompare(b.sn||'');
  });

  // Store range mode for applyFpFilter
  _fpIsRange = isRange;

  if (!_fpRows.length) {
    const rangeLabel = isRange ? `${ymFrom} – ${ymTo}` : ymFrom;
    setMsg('msgFp', `⚠ Brak masterów wyprodukowanych w ${rangeLabel}.`, 'err');
    document.getElementById('fpResults').style.display = 'none';
    return;
  }
  setMsg('msgFp', '');

  // ── summary bar ───────────────────────────────────────────
  const repCounts = {};
  let noRep = 0;
  _fpRows.forEach(r => {
    const names = r.handlowcy ? r.handlowcy.split(', ').map(s=>s.trim()).filter(Boolean) : [];
    if (!names.length) { noRep++; return; }
    names.forEach(n => { repCounts[n] = (repCounts[n]||0) + 1; });
  });

  const paidCount   = _fpRows.filter(r => (r.total_months||0) > 0).length;
  const unpaidCount = _fpRows.length - paidCount;
  const rangeLabel  = isRange
    ? `${ymFrom} – ${ymTo}`
    : new Date(ymFrom + '-01').toLocaleDateString('pl-PL', {month:'long', year:'numeric'});
  let summaryHtml = `
    <strong style="font-size:15px">${_fpRows.length}</strong>
    <span style="color:var(--text-muted)">masterów z produkcji &nbsp;·&nbsp; ${rangeLabel}</span>
    <span class="badge unpaid" title="Urządzenia bez zarejestrowanej żadnej płatności — wymagają uwagi">✗ ${unpaidCount} bez płatności</span>
    <span class="badge paid"   title="Urządzenia z co najmniej jedną zarejestrowaną płatnością">✓ ${paidCount} zapłacono</span>
    <span style="flex:1"></span>`;
  Object.entries(repCounts).sort((a,b)=>b[1]-a[1]).forEach(([n,cnt]) => {
    const info = repColorMap[n] || {};
    const c = info.color || '#888';
    summaryHtml += `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px">
      <span class="rep-chip" style="background:${c}22;color:${c};border:1px solid ${c}55">${esc(info.initials||n)}</span>
      <strong>${cnt}</strong>
    </span>`;
  });
  if (noRep) summaryHtml += `<span style="font-size:12px;color:var(--text-muted)">bez handlowca: <strong>${noRep}</strong></span>`;
  document.getElementById('fpSummary').innerHTML = summaryHtml;

  document.getElementById('fpResults').style.display = 'block';
  applyFpFilter();
}

// Gap detection helper: returns true if device has gaps in payment history
function hasFpGap(r) {
  if (!r.first_pay || !r.last_pay || !r.total_months) return false;
  const expected = (monthsDiff(r.first_pay.slice(0,7), r.last_pay.slice(0,7)) ?? 0) + 1;
  return r.total_months < expected;
}

function applyFpFilter() {
  const gapsOnly   = document.getElementById('fpGapsOnly')?.checked;
  const custFilter = document.getElementById('fpCustomer')?.value || '';
  let rows = _fpRows;
  if (gapsOnly)   rows = rows.filter(hasFpGap);
  if (custFilter) rows = rows.filter(r => r.customer === custFilter);

  if (rows.length === 0) {
    document.getElementById('fpBody').innerHTML =
      `<tr><td colspan="8" style="text-align:center;padding:1.5rem;color:var(--text-muted)">Brak wyników.</td></tr>`;
    return;
  }

  // In range mode: insert month-group header rows between months
  let rowsHtml = '';
  if (_fpIsRange) {
    const byMonth = {};
    rows.forEach(r => {
      const m = r.first_pay ? r.first_pay.slice(0,7) : 'none';
      if (!byMonth[m]) byMonth[m] = [];
      byMonth[m].push(r);
    });
    for (const [m, mRows] of Object.entries(byMonth).sort()) {
      const mFmt = m !== 'none'
        ? new Date(m + '-01').toLocaleDateString('pl-PL', {month:'long', year:'numeric'})
        : 'Brak płatności';
      rowsHtml += `<tr style="background:var(--bg-secondary)">
        <td colspan="8" style="padding:8px 12px;font-weight:600;font-size:13px;
            border-top:2px solid var(--border-med)">
          📅 ${mFmt} &nbsp;<span style="font-size:11px;font-weight:400;color:var(--text-muted)">${mRows.length} urządzeń</span>
        </td>
      </tr>`;
      rowsHtml += mRows.map(r => fpRowHtml(r)).join('');
    }
  } else {
    rowsHtml = rows.map(r => fpRowHtml(r)).join('');
  }
  document.getElementById('fpBody').innerHTML = rowsHtml;
}

function fpRowHtml(r) {
  const paid      = (r.total_months||0) > 0;
  const gapBadge  = hasFpGap(r)
    ? `<span style="font-size:10px;color:var(--red);font-weight:600;margin-left:4px">⚠ przerwa</span>`
    : '';
  const stBadge = paid
    ? `<span class="badge paid"   title="Zarejestrowano co najmniej jedną płatność abonamentu">✓ Zapłacono</span>`
    : `<span class="badge unpaid" title="Brak jakiejkolwiek zarejestrowanej płatności — wymaga działania">✗ Brak płatności</span>`;
  const rowBg = paid ? '' : 'background:var(--red-light);';
  return `
    <tr id="fp-row-${esc(r.sn)}" style="cursor:pointer;${rowBg}" onclick="toggleFpExpand('${esc(r.sn)}')">
      <td style="text-align:center;font-size:13px;color:var(--text-muted)" id="fp-arrow-${esc(r.sn)}">▶</td>
      <td style="line-height:1.4">
        <span style="font-family:monospace;font-size:11px">${esc(r.sn)}</span>
        ${r.maszyna ? `<br><span style="font-size:10px;color:var(--text-muted)">${esc(r.maszyna)}</span>` : ''}
      </td>
      <td style="font-size:12px">${esc(r.firma||'—')}</td>
      <td>${repChips(r.handlowcy)}</td>
      <td>${fmtDate(r.prod_date)}</td>
      <td>${stBadge}${gapBadge}</td>
      <td style="font-size:12px;color:var(--text-muted)">${r.first_pay ? r.first_pay.slice(0,7) : '—'}</td>
      <td style="text-align:center;font-weight:600;color:${paid?'inherit':'var(--red)'}">${r.total_months||'0'}</td>
    </tr>
    <tr id="fp-expand-${esc(r.sn)}" style="display:none">
      <td colspan="7" style="padding:0">
        <div id="fp-detail-${esc(r.sn)}"
             style="padding:10px 16px 10px 48px;background:var(--bg-secondary);
                    border-bottom:0.5px solid var(--border)">
          <span style="color:var(--text-muted);font-size:12px">⏳ Ładowanie historii…</span>
        </div>
      </td>
    </tr>`;
}

// Generate sequential list of YYYY-MM strings from `from` to `to` inclusive
function monthRange(from, to) {
  const months = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2,'0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return months;
}

// Expand / collapse payment history for one device
async function toggleFpExpand(sn) {
  const expandRow = document.getElementById('fp-expand-' + sn);
  const arrow     = document.getElementById('fp-arrow-'  + sn);
  const detail    = document.getElementById('fp-detail-' + sn);
  if (!expandRow) return;

  const isOpen = expandRow.style.display !== 'none';
  if (isOpen) {
    expandRow.style.display = 'none';
    arrow.textContent = '▶';
    return;
  }

  expandRow.style.display = '';
  arrow.textContent = '▼';

  // Lazy load — only on first open
  if (detail.dataset.loaded) return;
  detail.dataset.loaded = '1';

  try {
    const resp = await fetch(`${API}/payments/${encodeURIComponent(sn)}`);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const pays = await resp.json();   // [{year_month, customer}, ...] sorted asc

    if (!pays.length) {
      detail.innerHTML = '<span style="color:var(--text-muted);font-size:12px">Brak rekordów płatności.</span>';
      return;
    }

    // Build full timeline: first paid month → current month
    const firstYM    = pays[0].year_month;
    const curYM      = nowYM();
    const paidSet    = new Map(pays.map(p => [p.year_month, p]));
    const allMonths  = monthRange(firstYM, curYM);

    // Count gaps (missing months in the middle — not counting current if unpaid)
    let gaps = 0;
    for (let i = 0; i < allMonths.length - 1; i++) {   // exclude last month (might just be delay)
      if (!paidSet.has(allMonths[i])) gaps++;
    }

    // Total amount across all paid months
    const totalAmt  = pays.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
    const anyAmt    = totalAmt > 0;
    const payCurr   = pays.find(p => p.currency)?.currency || '';

    const chips = allMonths.map(ym => {
      const p        = paidSet.get(ym);
      const isPaid   = !!p;
      const isFirst  = ym === firstYM;    // green anchor
      const customer = p?.customer || '';
      const amount   = parseFloat(p?.amount) || 0;
      const isLast   = ym === curYM;

      let bg, co, border, fw;
      if (!isPaid) {
        // Missing payment — red if past, muted if current month
        bg     = isLast ? 'transparent'        : 'var(--red-light)';
        co     = isLast ? 'var(--text-muted)'  : 'var(--red)';
        border = isLast ? 'var(--border-med)'  : 'var(--red)';
        fw     = '400';
      } else if (isFirst) {
        // First (anchor) payment — solid green
        bg = 'var(--green)'; co = '#fff'; border = 'var(--green)'; fw = '700';
      } else {
        // Normal paid month
        bg = 'var(--green-light)'; co = 'var(--green)'; border = 'var(--green)'; fw = '500';
      }

      // Tooltip: customer + amount
      const tipParts = [];
      if (customer) tipParts.push(customer);
      if (amount > 0) tipParts.push(fmtAmount(amount, p.currency || payCurr));
      const titleAttr = tipParts.length ? ` title="${esc(tipParts.join(' · '))}"` : '';

      const label = isPaid ? esc(ym) : `<s style="opacity:.6">${esc(ym)}</s>`;
      // Amount badge below month chip (if available)
      const amtBadge = (isPaid && amount > 0)
        ? `<div style="font-size:9px;text-align:center;margin-top:1px;opacity:.8">${fmtAmount(amount, p.currency || payCurr)}</div>`
        : '';
      return `<span${titleAttr} style="display:inline-flex;flex-direction:column;align-items:center;
              padding:2px 9px;border-radius:4px;font-size:11px;font-weight:${fw};
              background:${bg};color:${co};border:1px solid ${border};white-space:nowrap">
              ${label}${amtBadge}</span>`;
    }).join(' ');

    const customer = pays.find(p => p.customer)?.customer || '';
    const gapNote  = gaps > 0
      ? `<span style="color:var(--red);font-size:11px;font-weight:600">⚠ ${gaps} przerw${gaps===1?'a':gaps<5?'y':''}!</span>`
      : `<span style="color:var(--green);font-size:11px">✓ bez przerw</span>`;

    detail.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:6px">
        ${customer ? `<span style="font-size:12px;color:var(--text-muted)">Klient: <strong style="color:var(--text)">${esc(customer)}</strong></span>` : ''}
        <span style="font-size:12px;color:var(--text-muted)">${pays.length} / ${allMonths.length} mies. opłaconych</span>
        ${anyAmt ? `<span style="font-size:12px;font-weight:600;color:var(--green)">Σ ${fmtAmount(totalAmt, payCurr)}</span>` : ''}
        ${gapNote}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px">${chips}</div>`;
  } catch(e) {
    detail.innerHTML = `<span style="color:var(--red);font-size:12px">❌ Błąd: ${esc(e.message)}</span>`;
  }
}
