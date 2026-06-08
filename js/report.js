// ── WAIDS — report tab ────────────────────────────────────────────────────

// Chart instances (report tab)
let pieChart  = null, barChart = null, repChart = null, typeChart = null;
let _pieMap   = [];   // status values per slice
let _repMap   = [];   // rep names per bar
let _typeMap  = [];   // device_type values per bar
let _barMap   = [];   // prod_date month values per bar

let _firmConfigData = [];   // current firm config rows (for modal pre-fill)
let _revenueData    = [];   // current monthly revenue rows (for CSV export)

// ── Silent background refresh (bez resetowania filtrów/stron) ─────────────
async function _refreshReportData() {
  try {
    const r = await fetch(`${API}/analyze`);
    if (!r.ok) return;
    const data = await r.json();
    results = data.results;
    onFilterChange();
  } catch(e) {}
}

// ── Load report ────────────────────────────────────────────────────────────
async function loadReport() {
  setMsg('msgReport', '⏳ Ładuję z bazy…');
  document.getElementById('dashboard').style.display  = 'none';
  document.getElementById('emptyState').style.display = 'block';
  try {
    const r = await fetch(`${API}/analyze`);
    if (!r.ok) { const e=await r.json(); throw new Error(e.detail||r.statusText); }
    const data = await r.json();
    if (!data.results.length) { setMsg('msgReport','⚠ Baza pusta — najpierw zaimportuj dane.','err'); return; }
    results = data.results;
    populateFilters();
    clearFilters(false);
    document.getElementById('dashboard').style.display  = 'block';
    document.getElementById('emptyState').style.display = 'none';
    onFilterChange();
    setMsg('msgReport', `✓ ${data.results.length} urządzeń`, 'ok');
    document.getElementById('revenueSection').style.display = 'block';
    _revenueData = [];
  } catch(e) {
    setMsg('msgReport', e.message.includes('fetch')
      ? '❌ Brak połączenia z API — uruchom backend.' : '❌ '+e.message, 'err');
  }
}

// ── Populate filter dropdowns ──────────────────────────────────────────────
function populateFilters() {
  const customers = [...new Set(results.map(r=>r.customer).filter(Boolean))].sort();
  const operators  = [...new Set(results.map(r=>r.operator).filter(Boolean))].sort();
  const repSet = new Set();
  results.forEach(r => { if(r.handlowcy) r.handlowcy.split(', ').forEach(h=>repSet.add(h.trim())); });
  buildRepColorMap(repSet);
  renderRepLegend();
  const reps = [...repSet].sort();

  document.getElementById('fCustomer').innerHTML =
    '<option value="">Wszyscy klienci</option>'+customers.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  document.getElementById('fOperator').innerHTML =
    '<option value="">Wszyscy operatorzy</option>'+operators.map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join('');
  document.getElementById('fRep').innerHTML =
    '<option value="">Wszyscy handlowcy</option>'+reps.map(h=>`<option value="${esc(h)}">${esc(h)}</option>`).join('');
}

// ── Filter & update everything ─────────────────────────────────────────────
function onFilterChange() {
  const q       = document.getElementById('fSearch').value.trim().toLowerCase();
  const st      = document.getElementById('fStatus').value;
  const dt      = document.getElementById('fDeviceType').value;
  const ft      = document.getElementById('fFirmType').value;
  const rep     = document.getElementById('fRep').value;
  const cu      = document.getElementById('fCustomer').value;
  const op      = document.getElementById('fOperator').value;
  const df      = document.getElementById('fDateFrom').value;
  const dto     = document.getElementById('fDateTo').value;
  const overdue = document.getElementById('fOverdue').value;
  const curYM   = nowYM();

  filtered = results.filter(r => {
    if (q) {
      // Normalizacja SN: cyfry bez prefiksu i wiodących zer
      // → "SN001028732" i "1028732" i "001028732" trafią na to samo
      const snDigits = (r.sn || '').replace(/\D/g, '').replace(/^0+/, '');
      const qDigits  = q.replace(/\D/g, '').replace(/^0+/, '');
      const hay = [r.sn, snDigits, r.firma, r.maszyna, r.customer, r.operator, r.handlowcy]
                    .join(' ').toLowerCase();
      const matchHay    = hay.includes(q);
      const matchDigits = qDigits.length >= 3 && snDigits && snDigits.includes(qDigits);
      if (!matchHay && !matchDigits) return false;
    }
    if (st === 'suspended') { if (!r.is_suspended) return false; }
    else if (st && r.status !== st) return false;
    if (dt  && r.device_type !== dt) return false;
    if (ft  && (r.firm_type || 'ids') !== ft) return false;
    if (rep && !r.handlowcy.includes(rep)) return false;
    if (cu  && r.customer !== cu) return false;
    if (op  && r.operator !== op) return false;
    if (df  && r.prod_date && r.prod_date.slice(0,7) < df)  return false;
    if (dto && r.prod_date && r.prod_date.slice(0,7) > dto) return false;
    if (overdue) {
      const threshold = parseInt(overdue);
      if (r.device_type !== 'master') return false;
      if (r.status === 'oem' || r.status === 'excluded' || r.status === 'only') return false;
      const ref = (r.last_pay && r.last_pay !== '') ? r.last_pay.slice(0,7)
                : (r.prod_date && r.prod_date !== '') ? r.prod_date.slice(0,7)
                : null;
      if (!ref) return false;
      const gap = monthsDiff(ref, curYM);
      if (gap === null || gap < threshold) return false;
    }
    return true;
  });

  ['fSearch','fStatus','fDeviceType','fFirmType','fRep','fCustomer','fOperator','fDateFrom','fDateTo','fOverdue'].forEach(id => {
    const el = document.getElementById(id);
    el.classList.toggle('filter-active', !!el.value);
  });

  const s = computeSummary(filtered);
  updateKpis(s);
  renderPie(filtered, s);
  renderBar(filtered);
  renderRepChart(filtered);
  renderTypeChart(filtered);
  currentPage = 1;
  renderTable(filtered);
  document.getElementById('rowCount').textContent =
    `Wyniki: ${filtered.length} z ${results.length} urządzeń`;
}

function clearFilters(reapply = true) {
  ['fSearch','fStatus','fDeviceType','fFirmType','fRep','fCustomer','fOperator','fDateFrom','fDateTo','fOverdue'].forEach(id => {
    const el = document.getElementById(id);
    el.value = '';
    el.classList.remove('filter-active');
  });
  if (reapply) onFilterChange();
}

// ── Chart click helper ─────────────────────────────────────────────────────
function makeClickHandler(mapRef, selectId, scrollToTable=true) {
  return (evt, elements) => {
    if (!elements.length) return;
    const val = mapRef[elements[0].index];
    if (val === undefined) return;
    const sel = document.getElementById(selectId);
    sel.value = sel.value === String(val) ? '' : String(val);
    onFilterChange();
    if (scrollToTable) {
      setTimeout(() => document.getElementById('tableWrap')
        .scrollIntoView({behavior:'smooth', block:'nearest'}), 80);
    }
  };
}

// ── Pie chart ──────────────────────────────────────────────────────────────
function renderPie(data, s) {
  const entries = [
    { label:'Opłacone',    status:'paid',      val:s.paid,      color:'#1D9E75' },
    { label:'Brak opłaty', status:'unpaid',    val:s.unpaid,    color:'#E24B4A' },
    { label:'Zawieszone',  status:'suspended', val:s.suspended, color:'#3B82F6' },
    { label:'Bez opłat',   status:'free',      val:s.free,      color:'#0e7490' },
    { label:'Brak w prod.',status:'only',      val:s.only,      color:'#BA7517' },
    { label:'OEM',         status:'oem',       val:s.oem,       color:'#9ca3af' },
    { label:'Wykluczone',  status:'excluded',  val:s.excluded,  color:'#2563EB' },
    { label:'Stare',       status:'stare',     val:s.stare||0,  color:'#d1d5db' },
  ].filter(e => e.val > 0);
  _pieMap = entries.map(e => e.status);

  document.getElementById('pieLegend').innerHTML = entries.map(e =>
    `<span><span class="leg-sq" style="background:${e.color}"></span>${e.label}: ${e.val}</span>`
  ).join('');

  if (pieChart) pieChart.destroy();
  pieChart = new Chart(document.getElementById('chartPie'), {
    type: 'doughnut',
    data: { labels: entries.map(e=>e.label),
            datasets: [{ data: entries.map(e=>e.val), backgroundColor: entries.map(e=>e.color), borderWidth:0 }] },
    options: {
      responsive:true, maintainAspectRatio:false,
      onClick: makeClickHandler(_pieMap, 'fStatus'),
      onHover: (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer':'default'; },
      plugins: {
        legend: { display:false },
        tooltip: { callbacks: { label: ctx => {
          const sum = ctx.dataset.data.reduce((a,b)=>a+b,0);
          return `${ctx.label}: ${ctx.raw} (${Math.round(ctx.raw/sum*100)}%)`;
        }}}
      }
    }
  });
}

// ── Copy SN to clipboard ───────────────────────────────────────────────────
function copySN(sn) {
  const flashBtn = () => {
    const btns = document.querySelectorAll('.copy-sn');
    for (const b of btns) {
      if (b.dataset.sn === sn) {
        const orig = b.textContent;
        b.textContent = '✓'; b.style.color='var(--green)'; b.style.opacity='1';
        setTimeout(()=>{ b.textContent=orig; b.style.color=''; b.style.opacity=''; }, 900);
        break;
      }
    }
  };
  const fallback = () => {
    const el = document.createElement('textarea');
    el.value = sn;
    el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(el);
    el.focus(); el.select();
    try { document.execCommand('copy'); flashBtn(); } catch(e) {}
    document.body.removeChild(el);
  };
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(sn).then(flashBtn).catch(fallback);
  } else {
    fallback();
  }
}

// ── Global nav date range ──────────────────────────────────────────────────
let _navDatePopupOpen = false;

function toggleNavDatePopup(evt) {
  evt?.stopPropagation();
  const popup = document.getElementById('navDatePopup');
  _navDatePopupOpen = !_navDatePopupOpen;
  popup.classList.toggle('open', _navDatePopupOpen);
  if (_navDatePopupOpen) {
    const btn = evt?.currentTarget || evt?.target;
    if (btn) {
      const rect = btn.getBoundingClientRect();
      popup.style.top  = (rect.bottom + 6) + 'px';
      popup.style.left = Math.min(rect.left, window.innerWidth - 280) + 'px';
    }
  }
}

document.addEventListener('click', e => {
  if (_navDatePopupOpen && !document.getElementById('navDatePopup').contains(e.target)) {
    _navDatePopupOpen = false;
    document.getElementById('navDatePopup').classList.remove('open');
  }
});

function applyNavDate() {
  const from = document.getElementById('navDateFrom').value;
  const to   = document.getElementById('navDateTo').value;
  if (!from && !to) return;
  const df = document.getElementById('fDateFrom');
  const dt = document.getElementById('fDateTo');
  if (df) df.value = from;
  if (dt) dt.value = to;
  const pill = document.getElementById('navDateRange');
  const lbl  = document.getElementById('navDateLabel');
  lbl.textContent = (from||'…') + ' — ' + (to||'…');
  pill.classList.add('active');
  _navDatePopupOpen = false;
  document.getElementById('navDatePopup').classList.remove('open');
  if (document.getElementById('tab-report').classList.contains('active')) onFilterChange();
}

function clearNavDate() {
  document.getElementById('navDateFrom').value = '';
  document.getElementById('navDateTo').value   = '';
  document.getElementById('navDateRange').classList.remove('active');
  _navDatePopupOpen = false;
  document.getElementById('navDatePopup').classList.remove('open');
  const df = document.getElementById('fDateFrom');
  const dt = document.getElementById('fDateTo');
  if (df) df.value = '';
  if (dt) dt.value = '';
  if (document.getElementById('tab-report').classList.contains('active')) onFilterChange();
}

// ── Bar chart year filter + expand ─────────────────────────────────────────
let _barYear     = '';
let _barExpanded = false;
let _barAllData  = null;

function buildYearPills(data) {
  const years = [...new Set(
    data.filter(r=>r.prod_date).map(r=>String(r.prod_date).slice(0,4))
  )].sort();
  const pills = document.getElementById('yearPills');
  if (!pills) return;
  pills.innerHTML = [''].concat(years).map(y => `
    <button class="year-pill${_barYear===y?' active':''}"
            onclick="setBarYear('${y}')">${y||'Wszystkie'}</button>`).join('');
}

function setBarYear(y) {
  _barYear = y;
  if (_barAllData) renderBar(_barAllData);
}

function toggleBarExpand() {
  _barExpanded = !_barExpanded;
  const card = document.getElementById('barChartCard');
  const wrap = document.getElementById('barChartWrap');
  const btn  = document.getElementById('barExpandBtn');
  if (_barExpanded) {
    card.style.gridColumn = '1 / -1';
    card.style.order = '-1';
    wrap.style.height = '420px';
    btn.textContent = '⤡ Zwiń';
  } else {
    card.style.removeProperty('grid-column');
    card.style.removeProperty('order');
    wrap.style.height = '200px';
    btn.textContent = '⤢ Rozwiń';
  }
  setTimeout(() => { if (_barAllData) renderBar(_barAllData); }, 80);
}

// ── Bar chart: by prod month ───────────────────────────────────────────────
function renderBar(data) {
  _barAllData = data;
  buildYearPills(data);

  const mm = {};
  for (const r of data) {
    if (r.status==='oem'||r.status==='excluded') continue;
    const ym = r.prod_date ? String(r.prod_date).slice(0,7) : null;
    if (!ym) continue;
    if (_barYear && !ym.startsWith(_barYear)) continue;
    if (!mm[ym]) mm[ym] = {paid:0, unpaid:0};
    if (r.status==='paid')   mm[ym].paid++;
    if (r.status==='unpaid') mm[ym].unpaid++;
  }
  const labels = Object.keys(mm).sort();
  _barMap = labels;

  const wrap = document.getElementById('barChartWrap');
  if (wrap) wrap.style.height = (_barExpanded ? '380' : '200') + 'px';

  if (barChart) barChart.destroy();
  barChart = new Chart(document.getElementById('chartBar'), {
    type:'bar',
    data: { labels,
      datasets: [
        { label:'Opłacone',    data:labels.map(l=>mm[l].paid),   backgroundColor:'#1D9E75', borderRadius:3 },
        { label:'Brak opłaty', data:labels.map(l=>mm[l].unpaid), backgroundColor:'#E24B4A', borderRadius:3 }
      ]},
    options: {
      responsive:true, maintainAspectRatio:false,
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const month = _barMap[elements[0].index];
        if (!month || month==='Brak') return;
        const df = document.getElementById('fDateFrom');
        const dt = document.getElementById('fDateTo');
        if (df.value === month && dt.value === month) {
          df.value = ''; dt.value = '';
        } else {
          df.value = month; dt.value = month;
        }
        onFilterChange();
        setTimeout(()=>document.getElementById('tableWrap').scrollIntoView({behavior:'smooth',block:'nearest'}),80);
      },
      onHover: (evt, els) => { evt.native.target.style.cursor = els.length?'pointer':'default'; },
      scales: {
        x: { stacked:true, ticks:{ autoSkip:true, maxRotation:45, font:{size:10} } },
        y: { stacked:true, beginAtZero:true, ticks:{ stepSize:1 } }
      },
      plugins: { legend:{ display:false } }
    }
  });
}

// ── Bar chart: by rep ──────────────────────────────────────────────────────
function renderRepChart(data) {
  const repData = {};
  for (const r of data) {
    if (r.status!=='paid' && r.status!=='unpaid') continue;
    const reps = r.handlowcy
      ? r.handlowcy.split(', ').map(s=>s.trim()).filter(Boolean)
      : ['Nieprzypisany'];
    for (const rep of reps) {
      if (!repData[rep]) repData[rep] = {paid:0, unpaid:0};
      if (r.status==='paid')   repData[rep].paid++;
      if (r.status==='unpaid') repData[rep].unpaid++;
    }
  }
  const labels = Object.keys(repData).sort();
  _repMap = labels;

  if (repChart) repChart.destroy();
  repChart = new Chart(document.getElementById('chartRep'), {
    type:'bar',
    data: { labels,
      datasets: [
        { label:'Opłacone',    data:labels.map(l=>repData[l].paid),   backgroundColor:'#1D9E75', borderRadius:3 },
        { label:'Brak opłaty', data:labels.map(l=>repData[l].unpaid), backgroundColor:'#E24B4A', borderRadius:3 }
      ]},
    options: {
      responsive:true, maintainAspectRatio:false, indexAxis:'y',
      onClick: makeClickHandler(_repMap, 'fRep'),
      onHover: (evt, els) => { evt.native.target.style.cursor = els.length?'pointer':'default'; },
      scales: {
        x: { stacked:true, beginAtZero:true },
        y: { stacked:true, ticks:{ font:{size:11} } }
      },
      plugins: { legend:{ display:false } }
    }
  });
}

// ── Bar chart: by device type ──────────────────────────────────────────────
function renderTypeChart(data) {
  const types  = ['master','slave','oem','stare',''];
  const labels = { master:'Master', slave:'Slave', oem:'OEM', stare:'Stare', '':'Nieznany' };
  const colors = { master:'#BA7517', slave:'#2563EB', oem:'#9ca3af', stare:'#d1d5db', '':'#e5e7eb' };

  const counts = {};
  for (const r of data) {
    const dt = r.device_type||'';
    if (!counts[dt]) counts[dt] = {paid:0, unpaid:0, other:0};
    if (r.status==='paid')        counts[dt].paid++;
    else if (r.status==='unpaid') counts[dt].unpaid++;
    else                          counts[dt].other++;
  }

  const used = types.filter(t => counts[t] && (counts[t].paid+counts[t].unpaid+counts[t].other)>0);
  _typeMap = used;

  document.getElementById('typeLegend').innerHTML = used.map(t =>
    `<span><span class="leg-sq" style="background:${colors[t]}"></span>${labels[t]}: ${
      (counts[t]?.paid||0)+(counts[t]?.unpaid||0)+(counts[t]?.other||0)
    }</span>`
  ).join('');

  if (typeChart) typeChart.destroy();
  typeChart = new Chart(document.getElementById('chartType'), {
    type:'bar',
    data: { labels: used.map(t=>labels[t]),
      datasets: [
        { label:'Opłacone',    data:used.map(t=>counts[t]?.paid||0),   backgroundColor:'#1D9E75', borderRadius:3 },
        { label:'Brak opłaty', data:used.map(t=>counts[t]?.unpaid||0), backgroundColor:'#E24B4A', borderRadius:3 },
        { label:'Pozostałe',   data:used.map(t=>counts[t]?.other||0),  backgroundColor:'#9ca3af', borderRadius:3 }
      ]},
    options: {
      responsive:true, maintainAspectRatio:false,
      onClick: makeClickHandler(_typeMap, 'fDeviceType'),
      onHover: (evt, els) => { evt.native.target.style.cursor = els.length?'pointer':'default'; },
      scales: {
        x: { stacked:true, ticks:{ font:{size:11} } },
        y: { stacked:true, beginAtZero:true }
      },
      plugins: { legend:{ display:false } }
    }
  });
}

// ── Render table (with pagination) ────────────────────────────────────────
function renderTable(data) {
  const tbody  = document.getElementById('tableBody');
  const total  = data.length;
  const pages  = Math.max(1, Math.ceil(total / pageSize));
  if (currentPage > pages) currentPage = pages;

  const start = (currentPage - 1) * pageSize;
  const end   = Math.min(start + pageSize, total);
  const slice = data.slice(start, end);

  if (!total) {
    tbody.innerHTML = '<tr><td colspan="15" style="text-align:center;padding:2rem;color:var(--text-muted)">Brak wyników</td></tr>';
  } else {
    tbody.innerHTML = slice.map(r => {
      const checked = selectedSNs.has(r.sn) ? ' checked' : '';
      const comment = r.comment || '';
      const commentCell = comment
        ? `<td class="comment-cell has-comment" title="${esc(comment)}">${esc(comment.slice(0,30))}${comment.length>30?'…':''}</td>`
        : `<td class="comment-cell" title="Brak komentarza">—</td>`;
      const amountVal = parseFloat(r.total_amount) || 0;
      const amountCell = amountVal > 0
        ? `<td style="text-align:right;font-size:12px;font-weight:600;color:var(--green);white-space:nowrap">${fmtAmount(amountVal, r.currency)}</td>`
        : `<td style="text-align:right;color:var(--text-muted);font-size:11px">—</td>`;
      return `<tr>
        <td style="text-align:center;padding:6px 8px">
          <input type="checkbox" data-sn="${esc(r.sn)}"${checked}
                 onclick="toggleRowSelect(event,'${esc(r.sn)}')"
                 style="width:14px;height:14px;cursor:pointer">
        </td>
        <td>${statusBadge(r.status, r.is_suspended)}</td>
        <td>${dtBadge(r.device_type, r.sn, r.type_override||'', r.showroom_until||'', r.is_suspended)}</td>
        <td style="font-family:monospace;font-size:11px;white-space:nowrap">${esc(r.sn)}<button class="copy-sn" data-sn="${esc(r.sn)}" onclick="copySN('${esc(r.sn)}')" title="Kopiuj SN">⎘</button></td>
        <td>${esc(r.customer||'—')}</td>
        <td>${esc(r.firma||'—')}</td>
        <td>${esc(r.maszyna||'—')}</td>
        <td>${repChips(r.handlowcy)}</td>
        <td>${esc(r.operator||'—')}</td>
        <td>${fmtDate(r.prod_date)}</td>
        <td>${fmtDate(r.first_pay)}</td>
        <td>${fmtDate(r.last_pay)}</td>
        <td style="font-weight:600">${r.total_months||'—'}</td>
        ${amountCell}
        ${commentCell}
      </tr>`;
    }).join('');
  }

  const pgInfo = document.getElementById('pgInfo');
  const pgPrev = document.getElementById('pgPrev');
  const pgNext = document.getElementById('pgNext');
  if (total > 0) {
    pgInfo.textContent = `Strona ${currentPage} z ${pages}  (${start+1}–${end} z ${total})`;
  } else {
    pgInfo.textContent = '';
  }
  pgPrev.disabled = (currentPage <= 1);
  pgNext.disabled = (currentPage >= pages);
  document.getElementById('paginationBar').style.display = 'flex';
}

// ── Bulk selection ──────────────────────────────────────────────────────────
function toggleRowSelect(evt, sn) {
  evt.stopPropagation();
  if (evt.target.checked) selectedSNs.add(sn);
  else selectedSNs.delete(sn);
  updateBulkBar();
}

function toggleSelectAll(checked) {
  const slice = filtered.slice((currentPage-1)*pageSize, currentPage*pageSize);
  slice.forEach(r => checked ? selectedSNs.add(r.sn) : selectedSNs.delete(r.sn));
  document.querySelectorAll('#tableBody input[type=checkbox]').forEach(cb => {
    cb.checked = checked;
  });
  updateBulkBar();
}

function clearSelection() {
  selectedSNs.clear();
  document.querySelectorAll('#tableBody input[type=checkbox]').forEach(cb => cb.checked = false);
  const chkAll = document.getElementById('chkAll');
  if (chkAll) chkAll.checked = false;
  updateBulkBar();
}

function updateBulkBar() {
  const bar = document.getElementById('bulkBar');
  const cnt = selectedSNs.size;
  document.getElementById('bulkCount').textContent = cnt;
  bar.classList.toggle('active', cnt > 0);
  // pokaż przyciski edycji tylko gdy użytkownik ma uprawnienia
  const canEdit = currentUser?.is_admin || currentUser?.can_edit_devices;
  ['bulkEditSep','bulkBtnFirma','bulkBtnOper','bulkBtnSusp'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = canEdit ? '' : 'none';
  });
  // ukryj przyciski zmiany typu tylko dla zalogowanych bez uprawnień
  ['bulkBtnMaster','bulkBtnOem','bulkBtnStare','bulkBtnAuto'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = canEdit ? '' : 'none';
  });
}

async function bulkChangeType(dtype) {
  if (!selectedSNs.size) return;
  const typeLabels = { master:'Master', oem:'OEM', stare:'Stare', '':'Auto (reset)' };
  const label = typeLabels[dtype] ?? dtype;
  if (!confirm(`Zmienić typ na „${label}" dla ${selectedSNs.size} urządzeń?`)) return;
  try {
    const r = await fetch(`${API}/devices/bulk`, {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({sns: [...selectedSNs], device_type: dtype}),
    });
    if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
    const d = await r.json();
    clearSelection();
    await loadReport();
    alert(`Zaktualizowano ${d.updated} urządzeń.`);
  } catch(e) { alert('Błąd: ' + e.message); }
}

let _bulkInputField = '';   // 'firma' | 'operator'

function bulkShowInput(field) {
  bulkHideSuspend();   // zamknij wiersz zawieszenia jeśli otwarty
  _bulkInputField = field;
  const label = field === 'firma' ? '🏢 Nowy operator (firma prod.):' : '👤 Nowy BOK:';
  document.getElementById('bulkInputLabel').textContent = label;
  document.getElementById('bulkInputVal').value = '';
  const row = document.getElementById('bulkInputRow');
  row.style.display = 'flex';
  setTimeout(() => document.getElementById('bulkInputVal').focus(), 50);
}

function bulkHideInput() {
  document.getElementById('bulkInputRow').style.display = 'none';
  _bulkInputField = '';
}

async function bulkApplyInput() {
  if (!_bulkInputField || !selectedSNs.size) return;
  const val = document.getElementById('bulkInputVal').value.trim();
  const body = { sns: [...selectedSNs] };
  body[_bulkInputField] = val;
  try {
    const r = await fetch(`${API}/devices/bulk`, {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
    const d = await r.json();
    bulkHideInput();
    clearSelection();
    await loadReport();
  } catch(e) { alert('Błąd: ' + e.message); }
}

// ── Bulk suspension ──────────────────────────────────────────────────────────

function bulkShowSuspend() {
  bulkHideInput();   // zamknij wiersz tekstowy jeśli otwarty
  const row = document.getElementById('bulkSuspendRow');
  row.style.display = 'flex';
  setTimeout(() => document.getElementById('bulkSuspFrom').focus(), 50);
}

function bulkHideSuspend() {
  const row = document.getElementById('bulkSuspendRow');
  if (!row) return;
  row.style.display = 'none';
  document.getElementById('bulkSuspFrom').value  = '';
  document.getElementById('bulkSuspTo').value    = '';
  document.getElementById('bulkSuspNote').value  = '';
}

async function bulkApplySuspend() {
  const df   = document.getElementById('bulkSuspFrom').value;
  const dt   = document.getElementById('bulkSuspTo').value;
  const note = document.getElementById('bulkSuspNote').value.trim();
  if (!df || !dt) { alert('Wybierz zakres miesięcy zawieszenia.'); return; }
  if (df > dt)    { alert('Data od nie może być późniejsza niż data do.'); return; }
  if (!selectedSNs.size) return;
  const n = selectedSNs.size;
  if (!confirm(`Zawiesić abonament od ${df} do ${dt} dla ${n} urządzeń?`)) return;
  try {
    const r = await fetch(`${API}/devices/bulk-suspensions`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({sns: [...selectedSNs], date_from: df, date_to: dt, note}),
    });
    if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
    const d = await r.json();
    bulkHideSuspend();
    clearSelection();
    await _refreshReportData();
    alert(`Zawieszono abonament dla ${d.suspended} urządzeń.`);
  } catch(e) { alert('Błąd: ' + e.message); }
}

// ── Comment save ────────────────────────────────────────────────────────────
async function saveComment() {
  const sn      = document.getElementById('ovSN').textContent;
  const comment = document.getElementById('ovComment').value.trim();
  if (!sn || sn === '—') return;
  try {
    const r = await fetch(`${API}/devices/${encodeURIComponent(sn)}/comment`, {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({comment}),
    });
    if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
    document.getElementById('overrideModal').close();
    await loadReport();
  } catch(e) { alert('Błąd zapisu komentarza: ' + e.message); }
}

function goPage(delta) {
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  currentPage = Math.max(1, Math.min(pages, currentPage + delta));
  renderTable(filtered);
  document.getElementById('tableWrap').scrollIntoView({behavior:'smooth', block:'nearest'});
}

function onPageSizeChange() {
  const v = parseInt(document.getElementById('pgSize').value) || 100;
  pageSize = Math.max(10, Math.min(5000, v));
  document.getElementById('pgSize').value = pageSize;
  currentPage = 1;
  renderTable(filtered);
}

// ── CSV / XLSX exports ─────────────────────────────────────────────────────
const ST_EXP = { paid:'Oplacone', unpaid:'Brak oplaty', free:'Bez oplat',
                 only:'Brak w prod.', excluded:'Wykluczone', oem:'OEM' };
const DT_EXP = { master:'Master', slave:'Slave', oem:'OEM' };

function exportCSV() {
  const rows = [['Status','Typ','Numer seryjny','Klient','Firma prod.','Maszyna',
                 'Handlowcy','Operator','Data produkcji','Pierwsza oplata','Ostatnia oplata','Miesiace','Kwota','Waluta']];
  for (const r of filtered)
    rows.push([ST_EXP[r.status]||r.status, DT_EXP[r.device_type]||r.device_type||'',
               r.sn, r.customer, r.firma, r.maszyna, r.handlowcy, r.operator,
               fmtDate(r.prod_date), fmtDate(r.first_pay), fmtDate(r.last_pay),
               r.total_months||'', parseFloat(r.total_amount)||'', r.currency||'']);
  const csv  = rows.map(r=>r.map(c=>'"'+String(c||'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
  const blob = new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='raport_abonamentow.csv'; a.click();
}

function exportXLSX() {
  const rows = filtered.map(r => ({
    'Status':          ST_EXP[r.status]||r.status,
    'Typ':             DT_EXP[r.device_type]||r.device_type||'',
    'Numer seryjny':   r.sn,
    'Klient':          r.customer||'',
    'Firma produkcji': r.firma||'',
    'Maszyna':         r.maszyna||'',
    'Handlowcy':       r.handlowcy||'',
    'Operator':        r.operator||'',
    'Data produkcji':  fmtDate(r.prod_date),
    'Pierwsza oplata': fmtDate(r.first_pay),
    'Ostatnia oplata': fmtDate(r.last_pay),
    'Miesiace':        r.total_months||'',
    'Kwota':           parseFloat(r.total_amount)||0,
    'Waluta':          r.currency||'',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [14,10,16,22,22,14,24,14,14,14,14,10,14,8].map(wch=>({wch}));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Raport');
  XLSX.writeFile(wb, 'raport_abonamentow.xlsx');
}

// ── Device type override ───────────────────────────────────────────────────
// Click on dt-badge in table → open override dialog
document.getElementById('tableBody').addEventListener('click', e => {
  const badge = e.target.closest('[data-action="open-override"]');
  if (badge) openOverrideModal(badge.dataset.sn);
});

let _overrideSN = '';

function toggleShowroomPicker() {
  const row = document.getElementById('ovShowroomRow');
  const open = row.style.display !== 'none';
  row.style.display = open ? 'none' : 'block';
  document.getElementById('ovBtnShowroom').style.borderColor = open ? '' : 'var(--teal)';
}

function openOverrideModal(sn) {
  _overrideSN = sn;
  const r = results.find(x => x.sn === sn);
  document.getElementById('ovSN').textContent      = sn;
  document.getElementById('ovMaszyna').textContent = r?.maszyna || '—';

  const autoType = (r?.maszyna||'').toUpperCase().includes('OEM') ? 'oem' : 'master';
  const cur      = r?.type_override || '';
  const curUntil = r?.showroom_until || '';
  document.getElementById('ovCurrentInfo').textContent =
    cur === 'showroom'
      ? `Obecny: Showroom do ${curUntil || '?'}`
      : cur ? `Obecny: ręczne → ${DT_LABELS[cur]||cur}` : `Obecny: auto → ${DT_LABELS[autoType]||autoType}`;

  document.getElementById('ovBtnMaster').style.borderColor   = cur==='master'   ? 'var(--amber)' : '';
  document.getElementById('ovBtnOem').style.borderColor      = cur==='oem'      ? 'var(--gray)'  : '';
  document.getElementById('ovBtnAuto').style.borderColor     = cur===''         ? 'var(--green)' : '';
  document.getElementById('ovBtnShowroom').style.borderColor = cur==='showroom' ? 'var(--teal)'  : '';
  document.getElementById('ovBtnStare').style.borderColor    = cur==='stare'    ? '#9ca3af'      : '';

  const pickerRow = document.getElementById('ovShowroomRow');
  pickerRow.style.display = cur === 'showroom' ? 'block' : 'none';
  document.getElementById('ovShowroomUntil').value = curUntil || '';
  document.getElementById('ovComment').value = r?.comment || '';
  loadSuspensionsInModal(sn);
  document.getElementById('overrideModal').showModal();
}

async function applyOverride(deviceType) {
  const modal = document.getElementById('overrideModal');
  let showroomUntil = '';
  if (deviceType === 'showroom') {
    showroomUntil = document.getElementById('ovShowroomUntil').value;
    if (!showroomUntil) { alert('Wybierz datę zwolnienia z abonamentu.'); return; }
  }
  try {
    const r = await fetch(`${API}/devices/${encodeURIComponent(_overrideSN)}/type`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({device_type: deviceType, showroom_until: showroomUntil})
    });
    if (!r.ok) throw new Error((await r.json()).detail);
    modal.close();
    const rec = results.find(x => x.sn === _overrideSN);
    if (rec) {
      rec.type_override  = deviceType;
      rec.showroom_until = showroomUntil;
      rec.device_type    = deviceType || ((rec.maszyna||'').toUpperCase().includes('OEM') ? 'oem' : 'master');
      if (rec.device_type === 'oem') {
        rec.status = 'oem';
      } else if (rec.device_type === 'showroom') {
        rec.status = 'showroom';
      } else if (rec.device_type === 'stare') {
        rec.status = 'stare';
      } else if (rec.status === 'oem' || rec.status === 'showroom' || rec.status === 'stare') {
        rec.status = rec.total_months > 0 ? 'paid' : 'unpaid';
      }
    }
    onFilterChange();
  } catch(e) { alert('Błąd: ' + e.message); }
}

// ── Suspension management (override modal) ─────────────────────────────────

async function loadSuspensionsInModal(sn) {
  const wrap = document.getElementById('ovSuspWrap');
  if (!wrap) return;
  wrap.innerHTML = '<span style="color:var(--text-muted);font-size:12px">⏳…</span>';
  try {
    const d = await (await fetch(`${API}/devices/${encodeURIComponent(sn)}/suspensions`)).json();
    const items = d.suspensions || [];
    if (!items.length) {
      wrap.innerHTML = '<span style="color:var(--text-muted);font-size:12px">Brak zawieszonych okresów.</span>';
      return;
    }
    wrap.innerHTML = items.map(s => `
      <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border-light)">
        <span style="font-size:12px;font-family:monospace">${esc(s.date_from)} – ${esc(s.date_to)}</span>
        ${s.note ? `<span style="font-size:11px;color:var(--text-muted)">${esc(s.note)}</span>` : ''}
        <button onclick="deleteSuspension(${s.id},'device')"
                style="margin-left:auto;background:none;border:none;color:var(--danger);cursor:pointer;font-size:14px"
                title="Usuń">✕</button>
      </div>`).join('');
  } catch(e) {
    wrap.innerHTML = `<span style="color:var(--danger);font-size:12px">Błąd: ${e.message}</span>`;
  }
}

async function addSuspension() {
  const df  = document.getElementById('ovSuspFrom').value;
  const dt2 = document.getElementById('ovSuspTo').value;
  const note = document.getElementById('ovSuspNote').value.trim();
  if (!df || !dt2) { alert('Wybierz zakres miesięcy zawieszenia.'); return; }
  if (df > dt2) { alert('Data od nie może być późniejsza niż data do.'); return; }
  try {
    const r = await fetch(`${API}/devices/${encodeURIComponent(_overrideSN)}/suspensions`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({date_from: df, date_to: dt2, note})
    });
    if (!r.ok) throw new Error((await r.json()).detail);
    document.getElementById('ovSuspFrom').value = '';
    document.getElementById('ovSuspTo').value = '';
    document.getElementById('ovSuspNote').value = '';
    await loadSuspensionsInModal(_overrideSN);
    // Odśwież dane raportu żeby badge był aktualny
    await _refreshReportData();
  } catch(e) { alert('Błąd: ' + e.message); }
}

async function deleteSuspension(id, type) {
  if (!confirm('Usunąć ten okres zawieszenia?')) return;
  try {
    const r = await fetch(`${API}/suspensions/${type}/${id}`, {method: 'DELETE'});
    if (!r.ok) throw new Error((await r.json()).detail);
    await loadSuspensionsInModal(_overrideSN);
    await _refreshReportData();
  } catch(e) { alert('Błąd: ' + e.message); }
}

// ── Revenue monthly section (inside report tab) ────────────────────────────
function toggleRevenueSection() {
  const body  = document.getElementById('revenueBody');
  const arrow = document.getElementById('revenueArrow');
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  arrow.textContent  = isOpen ? '▶' : '▼';
  if (!isOpen && !_revenueData.length) loadMonthlyRevenue();
}

async function loadMonthlyRevenue() {
  const tbody = document.getElementById('revenueList');
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:1rem">⏳ Ładowanie…</td></tr>';
  try {
    const data = await (await fetch(`${API}/payments/monthly-revenue`)).json();
    _revenueData = data;
    renderRevenueTable(data);
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:var(--red);padding:1rem">❌ ${esc(e.message)}</td></tr>`;
  }
}

function renderRevenueTable(data) {
  const tbody = document.getElementById('revenueList');
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:1rem">Brak danych o płatnościach z kwotami.</td></tr>';
    return;
  }
  const totals = {};
  for (const row of data) {
    const c = row.currency || 'PLN';
    totals[c] = (totals[c] || 0) + parseFloat(row.total || 0);
  }
  let html = data.map(row => {
    const total = parseFloat(row.total || 0);
    const curr  = row.currency || 'PLN';
    return `<tr>
      <td style="font-family:monospace;font-size:12px;padding:6px 12px">${esc(row.year_month)}</td>
      <td style="text-align:center;font-size:12px;padding:6px 12px">${row.devices}</td>
      <td style="font-size:12px;color:var(--text-muted);padding:6px 12px">${esc(curr)}</td>
      <td style="text-align:right;font-weight:600;color:var(--green);padding:6px 12px">${fmtAmount(total, curr)}</td>
    </tr>`;
  }).join('');
  html += `<tr><td colspan="4" style="border-top:1.5px solid var(--border-med);padding:2px 0"></td></tr>`;
  for (const [curr, sum] of Object.entries(totals)) {
    html += `<tr style="background:var(--bg-secondary)">
      <td colspan="2" style="font-size:12px;font-weight:700;padding:7px 12px">Łącznie</td>
      <td style="font-size:12px;color:var(--text-muted);padding:7px 12px">${esc(curr)}</td>
      <td style="text-align:right;font-weight:700;font-size:13px;color:var(--green);padding:7px 12px">${fmtAmount(sum, curr)}</td>
    </tr>`;
  }
  tbody.innerHTML = html;
}

function exportRevenueCSV() {
  if (!_revenueData.length) {
    alert('Brak danych do eksportu. Kliknij sekcję „💰 Przychody miesięczne" aby załadować dane.');
    return;
  }
  const lines = ['Miesiąc,Urządzenia,Waluta,Suma'];
  for (const row of _revenueData) {
    lines.push(`${row.year_month},${row.devices},${row.currency || 'PLN'},${parseFloat(row.total||0).toFixed(2)}`);
  }
  const blob = new Blob(['﻿' + lines.join('\n')], {type: 'text/csv;charset=utf-8'});
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'przychody_miesieczne.csv';
  a.click();
}
