// ── WAIDS — Prowizje (commission system) ─────────────────────────────────────

const STATUS_LABELS_COMM = {
  W_TOKU:                'W toku',
  KWALIFIKUJE:           'Kwalifikuje',
  WYPLATA_ZATWIERDZONA:  'Zatwierdzona',
  WYPLACONA:             'Wypłacona',
  ANULOWANA:             'Anulowana',
};

const STATUS_COLORS_COMM = {
  W_TOKU:                { bg: 'var(--bg-secondary)', color: 'var(--text-muted)',  border: 'var(--border)' },
  KWALIFIKUJE:           { bg: '#eff6ff',             color: '#1d4ed8',            border: '#93c5fd' },
  WYPLATA_ZATWIERDZONA:  { bg: '#f0fdf4',             color: '#15803d',            border: '#86efac' },
  WYPLACONA:             { bg: '#dcfce7',             color: '#166534',            border: '#4ade80' },
  ANULOWANA:             { bg: '#fef2f2',             color: '#dc2626',            border: '#fca5a5' },
};

// state
let _commPeriods    = [];
let _commRates      = [];
let _commItems      = [];
let _commSummary    = [];
let _activePeriodId = null;
let _commView       = 'items';   // 'items' | 'summary'
let _selItems       = new Set();

// ── init ───────────────────────────────────────────────────────────────────

async function initCommissions() {
  await Promise.all([loadCommRates(), loadCommPeriods(), loadRepsForCommForm()]);
  renderCommRates();
  renderCommPeriods();
}

async function loadRepsForCommForm() {
  try {
    const r = await fetch(`${API}/reps`);
    if (!r.ok) return;
    const reps = await r.json();
    const sel = document.getElementById('crRepName');
    if (!sel) return;
    const cur = sel.value;
    const uniqueReps = [...new Set(reps.map(r => r.name))].sort();
    sel.innerHTML = '<option value="">(globalna – domyślna)</option>' +
      uniqueReps.map(name => `<option value="${esc(name)}" ${name === cur ? 'selected' : ''}>${esc(name)}</option>`).join('');
  } catch {}
}

// ── rates ──────────────────────────────────────────────────────────────────

async function loadCommRates() {
  try {
    const r = await fetch(`${API}/commission/rates`);
    if (!r.ok) return;
    const d = await r.json();
    _commRates = d.rates || [];
  } catch {}
}

function renderCommRates() {
  const isAdmin = currentUser?.is_admin;
  const el = document.getElementById('commRatesTable');
  if (!el) return;
  if (!_commRates.length) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">Brak zdefiniowanych stawek.</div>';
    return;
  }
  el.innerHTML = `<table class="data-table" style="font-size:12px">
    <thead><tr>
      <th>Handlowiec</th><th>Stawka %</th><th>Obowiązuje od</th><th>do</th><th>Uwagi</th>
      ${isAdmin ? '<th></th>' : ''}
    </tr></thead>
    <tbody>
      ${_commRates.map(r => `<tr>
        <td>${r.rep_name ? esc(r.rep_name) : '<em style="color:var(--text-muted)">Globalna (domyślna)</em>'}</td>
        <td style="font-weight:600">${r.pct}%</td>
        <td>${fmtDate(r.valid_from)}</td>
        <td>${r.valid_to ? fmtDate(r.valid_to) : '—'}</td>
        <td>${esc(r.note)}</td>
        ${isAdmin ? `<td><button class="ghost sm" onclick="deleteCommRate(${r.id})">✕</button></td>` : ''}
      </tr>`).join('')}
    </tbody>
  </table>`;
}

async function deleteCommRate(id) {
  if (!confirm('Usunąć tę stawkę?')) return;
  const r = await fetch(`${API}/commission/rates/${id}`, { method: 'DELETE' });
  if (r.ok) { await loadCommRates(); renderCommRates(); }
  else setMsg('commRatesMsg', 'Błąd usuwania stawki', 'error');
}

async function saveCommRate() {
  const repName  = document.getElementById('crRepName').value.trim();
  const pct      = parseFloat(document.getElementById('crPct').value || '0');
  const from     = document.getElementById('crFrom').value;
  const to       = document.getElementById('crTo').value;
  const note     = document.getElementById('crNote').value.trim();
  if (!from) { setMsg('commRatesMsg', 'Podaj datę obowiązywania od', 'error'); return; }
  if (isNaN(pct) || pct < 0 || pct > 100) { setMsg('commRatesMsg', 'Stawka musi być liczbą 0–100', 'error'); return; }
  const r = await fetch(`${API}/commission/rates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rep_name: repName, pct, valid_from: from, valid_to: to, note }),
  });
  if (r.ok) {
    document.getElementById('crRepName').selectedIndex = 0;
    document.getElementById('crPct').value     = '';
    document.getElementById('crFrom').value    = '';
    document.getElementById('crTo').value      = '';
    document.getElementById('crNote').value    = '';
    setMsg('commRatesMsg', 'Stawka zapisana', 'ok');
    await loadCommRates(); renderCommRates();
  } else {
    const d = await r.json().catch(() => ({}));
    setMsg('commRatesMsg', d.detail || 'Błąd zapisu', 'error');
  }
}

// ── periods ────────────────────────────────────────────────────────────────

async function loadCommPeriods() {
  try {
    const r = await fetch(`${API}/commission/periods`);
    if (!r.ok) return;
    const d = await r.json();
    _commPeriods = d.periods || [];
  } catch {}
}

function renderCommPeriods() {
  const isAdmin = currentUser?.is_admin;
  const el = document.getElementById('commPeriodsList');
  if (!el) return;
  if (!_commPeriods.length) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">Brak okresów rozliczeniowych.</div>';
    return;
  }
  el.innerHTML = _commPeriods.map(p => {
    const kw = p.qualifying || 0, tot = p.item_count || 0;
    const comm = parseFloat(p.total_commission || 0);
    return `<div class="comm-period-card ${_activePeriodId === p.id ? 'active' : ''}" onclick="selectCommPeriod(${p.id})">
      <div style="font-weight:600;font-size:13px;margin-bottom:3px">
        ${esc(p.name)} ${p.locked ? '<span style="font-size:10px;color:var(--text-muted);padding:2px 6px;border:0.5px solid var(--border);border-radius:99px">🔒</span>' : ''}
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">
        Kohorta: ${fmtDate(p.cohort_from)} – ${fmtDate(p.cohort_to)} &nbsp;·&nbsp;
        ${tot} urządzeń &nbsp;·&nbsp; ${kw} kwalifikuje &nbsp;·&nbsp; ${fmtPLN(comm)} prowizji
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px" onclick="event.stopPropagation()">
        ${isAdmin ? `
          <button class="primary sm" onclick="computeCommPeriod(${p.id})">⟳ Przelicz</button>
          <button class="ghost sm" onclick="exportCommPeriod(${p.id})">⬇ Excel</button>
          <button class="ghost sm" onclick="toggleCommLock(${p.id},${!p.locked})">${p.locked ? '🔓 Odblokuj' : '🔒 Zablokuj'}</button>
          <button class="ghost sm" onclick="deleteCommPeriod(${p.id})">✕ Usuń</button>
        ` : `
          <button class="ghost sm" onclick="exportCommPeriod(${p.id})">⬇ Excel</button>
        `}
      </div>
    </div>`;
  }).join('');
}

async function createCommPeriod() {
  const name = document.getElementById('cpName').value.trim();
  const from = document.getElementById('cpFrom').value;
  const to   = document.getElementById('cpTo').value;
  if (!name) { setMsg('commPeriodsMsg', 'Podaj nazwę okresu', 'error'); return; }
  if (!from || !to) { setMsg('commPeriodsMsg', 'Podaj zakres dat kohorty', 'error'); return; }
  if (from > to) { setMsg('commPeriodsMsg', 'Data "od" musi być wcześniejsza niż "do"', 'error'); return; }
  const r = await fetch(`${API}/commission/periods`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, cohort_from: from, cohort_to: to }),
  });
  if (r.ok) {
    const d = await r.json();
    setMsg('commPeriodsMsg', 'Okres utworzony', 'ok');
    document.getElementById('cpName').value = '';
    document.getElementById('cpFrom').value = '';
    document.getElementById('cpTo').value   = '';
    await loadCommPeriods(); renderCommPeriods();
    selectCommPeriod(d.period.id);
  } else {
    const d = await r.json().catch(() => ({}));
    setMsg('commPeriodsMsg', d.detail || 'Błąd tworzenia okresu', 'error');
  }
}

async function deleteCommPeriod(id) {
  if (!confirm('Usunąć ten okres? Zostaną usunięte wszystkie pozycje prowizji (poza wypłaconymi).')) return;
  const r = await fetch(`${API}/commission/periods/${id}`, { method: 'DELETE' });
  if (r.ok) {
    if (_activePeriodId === id) { _activePeriodId = null; renderCommItemsPanel([]); }
    await loadCommPeriods(); renderCommPeriods();
  } else {
    const d = await r.json().catch(() => ({}));
    alert(d.detail || 'Błąd usuwania okresu');
  }
}

async function computeCommPeriod(id) {
  setMsg('commPeriodsMsg', 'Przeliczanie…', '');
  const r = await fetch(`${API}/commission/periods/${id}/compute`, { method: 'POST' });
  const d = await r.json().catch(() => ({}));
  if (r.ok) {
    if (d.devices_in_cohort === 0) {
      setMsg('commPeriodsMsg',
        `Brak urządzeń z datą produkcji w podanym zakresie. Sprawdź czy urządzenia mają ustawioną datę produkcji (kolumna prod_date w imporcie).`, 'error');
    } else {
      setMsg('commPeriodsMsg',
        `Przeliczono: ${d.items_computed} pozycji (${d.devices_in_cohort} urządzeń w kohortcie) · ${d.qualifying} kwalifikuje · ${d.in_progress} w toku`, 'ok');
    }
    await loadCommPeriods(); renderCommPeriods();
    // auto-select and show items panel after compute
    _activePeriodId = id;
    document.getElementById('commItemsPanel').style.display = '';
    await loadAndRenderItems();
    document.getElementById('commItemsPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    setMsg('commPeriodsMsg', d.detail || 'Błąd przeliczania', 'error');
  }
}

async function toggleCommLock(id, locked) {
  const r = await fetch(`${API}/commission/periods/${id}/lock`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locked }),
  });
  if (r.ok) { await loadCommPeriods(); renderCommPeriods(); }
}

async function exportCommPeriod(id) {
  try {
    const r = await fetch(`${API}/commission/periods/${id}/export`);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(d.detail || `Błąd eksportu (${r.status})`);
      return;
    }
    const blob = await r.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.style.display = 'none';
    const cd   = r.headers.get('Content-Disposition') || '';
    const m    = cd.match(/filename="([^"]+)"/);
    a.download = m ? m[1] : `prowizje_${id}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) {
    alert('Błąd pobierania pliku: ' + e.message);
  }
}

async function selectCommPeriod(id) {
  _activePeriodId = id;
  _selItems.clear();
  renderCommPeriods();
  await loadAndRenderItems();
  document.getElementById('commItemsPanel').style.display = '';
}

// ── items ──────────────────────────────────────────────────────────────────

async function loadAndRenderItems() {
  if (!_activePeriodId) return;
  const [ir, sr] = await Promise.all([
    fetch(`${API}/commission/periods/${_activePeriodId}/items`),
    fetch(`${API}/commission/periods/${_activePeriodId}/summary`),
  ]);
  if (ir.ok) { const d = await ir.json(); _commItems = d.items || []; }
  if (sr.ok) { const d = await sr.json(); _commSummary = d.summary || []; }

  buildRepFilterOptions();
  if (_commView === 'summary') renderCommSummary();
  else renderCommItemsTable();
}

function switchCommView(v) {
  _commView = v;
  document.getElementById('btnViewItems').classList.toggle('primary', v === 'items');
  document.getElementById('btnViewSummary').classList.toggle('primary', v === 'summary');
  document.getElementById('btnViewItems').classList.toggle('ghost', v !== 'items');
  document.getElementById('btnViewSummary').classList.toggle('ghost', v !== 'summary');
  // swap table headers
  document.getElementById('commItemsHead').style.display = v === 'items' ? '' : 'none';
  document.getElementById('commSummaryHead').style.display = v === 'summary' ? '' : 'none';
  document.getElementById('commFiltersRow').style.display = v === 'items' ? '' : 'none';
  if (v === 'summary') renderCommSummary();
  else renderCommItemsTable();
}

function commStatusBadge(status) {
  const c = STATUS_COLORS_COMM[status] || {};
  const lbl = STATUS_LABELS_COMM[status] || status;
  return `<span style="font-size:10px;padding:2px 7px;border-radius:99px;
    background:${c.bg||'var(--bg-secondary)'};color:${c.color||'var(--text)'};
    border:0.5px solid ${c.border||'var(--border)'}">${lbl}</span>`;
}

function renderCommItemsTable() {
  const el = document.getElementById('commItemsBody');
  if (!el) return;
  const isAdmin = currentUser?.is_admin || currentUser?.can_view_commissions;
  const fRep    = document.getElementById('fCommRep')?.value    || '';
  const fStatus = document.getElementById('fCommStatus')?.value || '';
  const fAdv    = document.getElementById('fCommAdv')?.value    || '';
  const fYear   = document.getElementById('fCommYear')?.value   || '';

  let items = _commItems;
  if (fRep)    items = items.filter(i => i.rep_name === fRep);
  if (fStatus) items = items.filter(i => i.status === fStatus);
  if (fAdv === '1') items = items.filter(i => i.advance_flag);
  if (fAdv === '0') items = items.filter(i => !i.advance_flag);
  if (fYear)   items = items.filter(i => (i.month_12_ym || '').startsWith(fYear));

  document.getElementById('commItemsCount').textContent =
    `${items.length} pozycji`;

  if (!items.length) {
    el.innerHTML = '<tr><td colspan="12" style="text-align:center;color:var(--text-muted);padding:16px">Brak pozycji</td></tr>';
    return;
  }

  el.innerHTML = items.map(it => {
    const canAct = currentUser?.is_admin || currentUser?.can_view_commissions;
    const locked = it.status === 'WYPLACONA';
    const rok12  = it.month_12_ym ? it.month_12_ym.substring(0, 4) : '—';
    // Quick-action buttons shown per status
    const actions = canAct && !locked ? `
      ${it.status !== 'WYPLATA_ZATWIERDZONA' ? `<button class="ghost sm" style="font-size:10px;padding:2px 7px" onclick="changeItemStatus(${it.id},'WYPLATA_ZATWIERDZONA')" title="Zatwierdź do wypłaty">✓ Zatwierdź</button>` : ''}
      ${it.status !== 'WYPLACONA'            ? `<button class="ghost sm" style="font-size:10px;padding:2px 7px;color:#15803d" onclick="changeItemStatus(${it.id},'WYPLACONA')" title="Oznacz jako wypłaconą">💰 Wypłacono</button>` : ''}
      ${it.status !== 'W_TOKU'              ? `<button class="ghost sm" style="font-size:10px;padding:2px 7px" onclick="changeItemStatus(${it.id},'W_TOKU')" title="Cofnij do W toku">↺</button>` : ''}
    ` : (locked ? '<span style="font-size:10px;color:var(--text-muted)">🔒 Wypłacona</span>' : '');
    return `
    <tr class="${_selItems.has(it.id) ? 'row-selected' : ''}">
      <td><input type="checkbox" ${_selItems.has(it.id) ? 'checked' : ''}
           onchange="toggleItemSel(${it.id},this.checked)"></td>
      <td style="font-family:monospace;font-size:11px">${esc(it.sn)}</td>
      <td style="font-size:11px">${esc(it.firma)}</td>
      <td style="font-size:11px">${esc(it.rep_name || '—')}</td>
      <td>${fmtDate(it.prod_date)}</td>
      <td style="text-align:center">${it.months_paid}/12</td>
      <td>${it.month_12_ym ? fmtDate(it.month_12_ym) : '—'}</td>
      <td style="text-align:center;font-weight:600;font-size:12px">${rok12}</td>
      <td style="text-align:right">${fmtPLN(it.base_netto)}</td>
      <td style="text-align:right">${it.rate_pct}%</td>
      <td style="text-align:right;font-weight:600">${fmtPLN(it.commission_amt)}</td>
      <td>${commStatusBadge(it.status)}${it.advance_flag ? ' <span title="Płatność z góry">⬆</span>' : ''}</td>
      <td style="white-space:nowrap">${actions}</td>
    </tr>`;
  }).join('');

  updateBulkBar(items);
}

function updateBulkBar(items) {
  const bar = document.getElementById('commBulkBar');
  if (!bar) return;
  const selCount = items.filter(i => _selItems.has(i.id)).length;
  if (selCount > 0) {
    bar.style.display = 'flex';
    document.getElementById('commSelCount').textContent = `${selCount} zaznaczonych`;
  } else {
    bar.style.display = 'none';
  }
}

function toggleItemSel(id, checked) {
  if (checked) _selItems.add(id);
  else _selItems.delete(id);
  renderCommItemsTable();
}

function selectAllCommItems() {
  const fRep    = document.getElementById('fCommRep')?.value    || '';
  const fStatus = document.getElementById('fCommStatus')?.value || '';
  const fYear   = document.getElementById('fCommYear')?.value   || '';
  const fAdv    = document.getElementById('fCommAdv')?.value    || '';
  let items = _commItems;
  if (fRep)    items = items.filter(i => i.rep_name === fRep);
  if (fStatus) items = items.filter(i => i.status === fStatus);
  if (fYear)   items = items.filter(i => (i.month_12_ym || '').startsWith(fYear));
  if (fAdv === '1') items = items.filter(i => i.advance_flag);
  if (fAdv === '0') items = items.filter(i => !i.advance_flag);
  items.forEach(i => _selItems.add(i.id));
  renderCommItemsTable();
}

function deselectAllCommItems() {
  _selItems.clear();
  renderCommItemsTable();
}

async function bulkSetStatus(status) {
  if (!_selItems.size) return;
  const ids = [..._selItems];
  const note = document.getElementById('commBulkNote')?.value || '';
  const r = await fetch(`${API}/commission/periods/${_activePeriodId}/items/bulk-status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_ids: ids, status, note }),
  });
  const d = await r.json().catch(() => ({}));
  if (r.ok) {
    _selItems.clear();
    setMsg('commItemsMsg', `Zaktualizowano ${d.updated} pozycji`, 'ok');
    await loadAndRenderItems();
  } else {
    setMsg('commItemsMsg', d.detail || 'Błąd aktualizacji', 'error');
  }
}

async function changeItemStatus(itemId, newStatus) {
  const r = await fetch(`${API}/commission/items/${itemId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus }),
  });
  if (r.ok) {
    const idx = _commItems.findIndex(i => i.id === itemId);
    if (idx >= 0) _commItems[idx].status = newStatus;
    renderCommItemsTable();
    await loadCommPeriods(); renderCommPeriods();
  } else {
    const d = await r.json().catch(() => ({}));
    setMsg('commItemsMsg', d.detail || 'Błąd zmiany statusu', 'error');
    renderCommItemsTable();
  }
}

function renderCommSummary() {
  const el = document.getElementById('commItemsBody');
  if (!el) return;
  document.getElementById('commItemsCount').textContent = '';
  if (!_commSummary.length) {
    el.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:16px">Brak danych</td></tr>';
    return;
  }
  el.innerHTML = _commSummary.map(s => `<tr>
    <td colspan="2" style="font-weight:600">${esc(s.rep_name || '(bez handlowca)')}</td>
    <td style="text-align:center">${commStatusBadge('KWALIFIKUJE')} ${s.qualifying}</td>
    <td style="text-align:center">${commStatusBadge('W_TOKU')} ${s.in_progress}</td>
    <td style="text-align:center">${commStatusBadge('WYPLATA_ZATWIERDZONA')} ${s.approved}</td>
    <td style="text-align:center">${commStatusBadge('WYPLACONA')} ${s.paid_out}</td>
    <td style="text-align:right;font-weight:600">${fmtPLN(s.total_commission)}</td>
    <td style="text-align:right;color:#15803d;font-weight:600">${fmtPLN(s.paid_commission)}</td>
  </tr>`).join('');
}

function buildRepFilterOptions() {
  const reps = [...new Set(_commItems.map(i => i.rep_name))].sort();
  const sel = document.getElementById('fCommRep');
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">Wszyscy handlowcy</option>' +
      reps.map(r => `<option value="${esc(r)}" ${r === cur ? 'selected' : ''}>${esc(r || '(bez handlowca)')}</option>`).join('');
  }

  const years = [...new Set(_commItems.map(i => (i.month_12_ym || '').substring(0, 4)).filter(y => y))].sort();
  const ySel = document.getElementById('fCommYear');
  if (ySel) {
    const curY = ySel.value;
    ySel.innerHTML = '<option value="">Wszystkie lata</option>' +
      years.map(y => `<option value="${y}" ${y === curY ? 'selected' : ''}>${y}</option>`).join('');
  }
}

// called when items tab is activated
async function onTabCommissions() {
  await initCommissions();
}
