// ── WAIDS — monitoring tab ────────────────────────────────────────────────

async function loadMonitoringTab() {
  if (!results.length) {
    setMsg('msgMonitor', '⏳ Ładuję dane z bazy…');
    try {
      const r = await fetch(`${API}/analyze`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      results = (await r.json()).results;
      setMsg('msgMonitor', '');
    } catch(e) {
      setMsg('msgMonitor', '❌ Brak połączenia z API', 'err');
      return;
    }
  }
  const inp = document.getElementById('monProdFrom');
  if (!inp.value) {
    const d = new Date(); d.setMonth(d.getMonth() - 6);
    inp.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }
  const monFirma   = document.getElementById('monFirma');
  const prevFirma  = monFirma.value;
  const firms = [...new Set(
    results.filter(r => r.device_type === 'master' && r.firma).map(r => r.firma)
  )].sort((a,b) => a.localeCompare(b));
  monFirma.innerHTML = '<option value="">Wszyscy klienci</option>' +
    firms.map(f => `<option value="${esc(f)}"${f===prevFirma?' selected':''}>${esc(f)}</option>`).join('');
  renderMonitoring();
}

function monStatus(r, curYM) {
  if (r.status === 'excluded') return 'excluded';
  if (!r.total_months) return 'never';
  return monthsDiff(r.last_pay?.slice(0,7), curYM) <= 2 ? 'active' : 'lapsed';
}

function renderMonitoring() {
  const prodFrom    = document.getElementById('monProdFrom').value;
  const firmaFilter = document.getElementById('monFirma')?.value || '';
  if (!prodFrom) { setMsg('msgMonitor','⚠ Wybierz datę.','err'); return; }
  if (!results.length) { loadMonitoringTab(); return; }

  const curYM = nowYM();
  let masters = results.filter(r =>
    r.device_type === 'master' && r.prod_date && r.prod_date.slice(0,7) >= prodFrom
  );
  if (firmaFilter) masters = masters.filter(r => r.firma === firmaFilter);
  if (document.getElementById('monIdsOnly')?.checked)
    masters = masters.filter(r => !r.firm_type || r.firm_type === 'ids');

  const contentEl = document.getElementById('monitorContent');
  if (!masters.length) {
    contentEl.innerHTML = `<div class="empty-state"><div class="es-icon">🔍</div>
      <p>Brak masterów wyprodukowanych od <strong>${prodFrom}</strong>.</p></div>`;
    setMsg('msgMonitor','Brak danych dla wybranego okresu','err');
    return;
  }

  const groups = {};
  for (const r of masters) {
    const m = r.prod_date.slice(0,7);
    if (!groups[m]) groups[m] = [];
    groups[m].push(r);
  }
  const sortedMonths = Object.keys(groups).sort().reverse();
  const latestMonth  = sortedMonths[0];

  const totalActive   = masters.filter(r => monStatus(r,curYM)==='active').length;
  const totalLapsed   = masters.filter(r => monStatus(r,curYM)==='lapsed').length;
  const totalNever    = masters.filter(r => monStatus(r,curYM)==='never').length;
  const totalExcluded = masters.filter(r => monStatus(r,curYM)==='excluded').length;
  const totalBilling  = masters.length - totalExcluded;

  let html = `
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:.25rem 0 1rem">
      <span style="font-size:13px;color:var(--text-muted)">
        <strong>${totalBilling}</strong> masterów (abonament) · <strong>${sortedMonths.length}</strong> miesięcy produkcji
      </span>
      <span class="badge paid">  ${totalActive} aktywnych</span>
      <span class="badge only">  ${totalLapsed} z przerwą</span>
      <span class="badge unpaid">${totalNever} bez opłat</span>
      ${totalExcluded ? `<span class="badge excluded">${totalExcluded} wykluczone</span>` : ''}
    </div>`;

  for (const month of sortedMonths) {
    const devices = groups[month];
    const mSince  = monthsDiff(month, curYM) ?? 0;

    const active  = devices.filter(r => monStatus(r,curYM)==='active');
    const lapsed  = devices.filter(r => monStatus(r,curYM)==='lapsed');
    const never   = devices.filter(r => monStatus(r,curYM)==='never');
    const excl    = devices.filter(r => monStatus(r,curYM)==='excluded');
    const billing = devices.filter(r => monStatus(r,curYM)!=='excluded');
    const everPaid = billing.filter(r => r.total_months > 0);

    const delays  = everPaid
      .map(r => monthsDiff(r.prod_date?.slice(0,7), r.first_pay?.slice(0,7)))
      .filter(d => d !== null && d >= 0);
    const avgDelay = delays.length
      ? (delays.reduce((a,b)=>a+b,0)/delays.length).toFixed(1) : '—';

    const paidPct = billing.length ? Math.round(everPaid.length / billing.length * 100) : 0;
    const gid     = month.replace('-','_');
    const isOpen  = month === latestMonth;
    const pBadge  = paidPct >= 80 ? 'paid' : paidPct >= 40 ? 'only' : 'unpaid';

    html += `
      <div class="section-card" style="padding:0;overflow:hidden;margin-bottom:.75rem">
        <div data-action="toggle-mon-group" data-group-id="${gid}"
             style="padding:.75rem 1.25rem;background:var(--bg-secondary);display:flex;align-items:center;
                    gap:1rem;flex-wrap:wrap;cursor:pointer;user-select:none">
          <strong style="font-size:14px;min-width:76px">📅 ${month}</strong>
          <span style="font-size:12px;color:var(--text-muted)" title="Liczba miesięcy od daty produkcji tych urządzeń do dziś">${mSince} mies. w polu</span>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            ${billing.length ? `<span class="badge ${pBadge}" title="Urządzenia z co najmniej jedną płatnością ÷ wszystkie podlegające abonamentowi (bez OEM i wykluczonych)&#10;${everPaid.length} z ${billing.length} opłaciło abonament = ${paidPct}%">${everPaid.length}/${billing.length} płaci (${paidPct}%)</span>` : ''}
            ${active.length  ? `<span class="badge paid"     style="font-size:10px" title="Aktywne — opłaciły bieżący lub poprzedni miesiąc abonamentu">${active.length} aktywnych</span>`:''}
            ${lapsed.length  ? `<span class="badge only"     style="font-size:10px" title="Z przerwą — kiedyś płaciły abonament, ale nie w ostatnim/bieżącym miesiącu">${lapsed.length} z przerwą</span>`:''}
            ${never.length   ? `<span class="badge unpaid"   style="font-size:10px" title="Bez opłat — nigdy nie zarejestrowano żadnej płatności abonamentu">${never.length} bez opłat</span>`:''}
            ${excl.length    ? `<span class="badge excluded" style="font-size:10px" title="Wykluczone — firma ręcznie wykluczona z abonamentu lub typ urządzenia to OEM">${excl.length} wykluczone</span>`:''}
          </div>
          <span style="font-size:11px;color:var(--text-muted)" title="Średnia liczba miesięcy między datą produkcji a pierwszą płatnością abonamentu&#10;(tylko urządzenia, które kiedykolwiek zapłaciły; niżej = lepiej)">
            śr. opóźn. startu: <strong>${avgDelay}</strong> mies.
          </span>
          <span class="toggle-arrow" style="margin-left:auto;font-size:13px;color:var(--text-muted)">${isOpen?'▼':'▶'}</span>
        </div>
        <div id="mgb_${gid}" style="display:${isOpen?'block':'none'};overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:820px">
            <thead>
              <tr style="background:var(--bg-tertiary)">
                ${[
                  ['SN',            'Numer seryjny urządzenia z pliku produkcji'],
                  ['Maszyna',       'Model urządzenia z pliku produkcji'],
                  ['Firma',         'Firma z pliku produkcji — u której zainstalowano urządzenie'],
                  ['Handlowiec',    'Handlowcy przypisani do tej firmy w Konfiguracji'],
                  ['Mies. w polu',  'Liczba miesięcy od daty produkcji do dziś\n(ile miesięcy urządzenie jest w terenie)'],
                  ['Pierws. opłata','Miesiąc pierwszej zarejestrowanej płatności abonamentu\n— może być wcześniejszy lub późniejszy niż data produkcji'],
                  ['Opóźn. startu', 'Różnica między datą produkcji a pierwszą płatnością\n• "w mies. produkcji" = zapłacono w tym samym miesiącu co produkcja\n• +N mies. = N miesięcy opóźnienia startu abonamentu\n• Zielony ≤2 | Pomarańczowy ≤4 | Czerwony >4'],
                  ['Opłat',         'Całkowita liczba miesięcy, za które zarejestrowano płatność abonamentu'],
                  ['Pokrycie',      'Opłat ÷ Mies. w polu × 100%\n— ile procent miesięcy od daty produkcji zostało opłaconych\n• Zielony ≥80% | Pomarańczowy ≥40% | Czerwony <40%'],
                  ['Status',        'Aktywny — opłacił bieżący lub poprzedni miesiąc\nPrzerwa — kiedyś płacił, ale nie ostatnio\nBez opłat — nigdy nie zarejestrowano płatności\nWykluczone — firma wykluczona z abonamentu lub typ OEM'],
                ].map(([h,tip])=>`<th title="${tip.replace(/\n/g,'&#10;').replace(/"/g,'&quot;')}" style="padding:8px 12px;text-align:left;font-size:11px;font-weight:600;
                                      text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);
                                      border-bottom:0.5px solid var(--border);white-space:nowrap;cursor:help">${h}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${devices
                .slice()
                .sort((a,b) => {
                  const o = {never:0,lapsed:1,active:2,excluded:3};
                  return o[monStatus(a,curYM)] - o[monStatus(b,curYM)];
                })
                .map(r => monRow(r, mSince, curYM))
                .join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  contentEl.innerHTML = html;
  const clientInfo = firmaFilter ? ` · klient: ${firmaFilter}` : '';
  setMsg('msgMonitor', `${masters.length} masterów od ${prodFrom}${clientInfo}`, 'ok');
}

function monRow(r, mSince, curYM) {
  const st       = monStatus(r, curYM);
  const delay    = r.first_pay
    ? monthsDiff(r.prod_date?.slice(0,7), r.first_pay.slice(0,7))
    : null;
  const coverage = (r.total_months && mSince > 0)
    ? Math.min(100, Math.round(r.total_months / mSince * 100)) : 0;

  const SC = {
    active:   { badge:'paid',     label:'Aktywny'    },
    lapsed:   { badge:'only',     label:'Przerwa'    },
    never:    { badge:'unpaid',   label:'Bez opłat'  },
    excluded: { badge:'excluded', label:'Wykluczone' },
  };

  const isExcluded = (st === 'excluded');
  let delayTxt, delayColor;
  if (isExcluded)       { delayTxt = '—';                        delayColor = 'var(--text-muted)'; }
  else if (delay===null){ delayTxt = '—';                        delayColor = 'var(--text-muted)'; }
  else if (delay <= 0)  { delayTxt = 'w mies. produkcji';        delayColor = 'var(--green)'; }
  else if (delay <= 2)  { delayTxt = `+${delay} mies.`;          delayColor = 'var(--green)'; }
  else if (delay <= 4)  { delayTxt = `+${delay} mies.`;          delayColor = 'var(--amber)'; }
  else                  { delayTxt = `+${delay} mies. ⚠`;       delayColor = 'var(--red)'; }

  const covColor = coverage >= 80 ? 'var(--green)' : coverage >= 40 ? 'var(--amber)' : 'var(--red)';
  const covBar = isExcluded
    ? `<span style="font-size:11px;color:var(--text-muted)">—</span>`
    : `<div style="display:flex;align-items:center;gap:7px">
        <div style="width:52px;height:5px;background:var(--bg-tertiary);border-radius:3px;overflow:hidden;flex-shrink:0">
          <div style="width:${coverage}%;height:100%;background:${covColor}"></div>
        </div>
        <span style="font-size:11px;color:${covColor};font-weight:600">${coverage}%</span>
      </div>`;

  const rowStyle = isExcluded
    ? 'border-bottom:0.5px solid var(--border);opacity:.6'
    : 'border-bottom:0.5px solid var(--border)';

  return `<tr style="${rowStyle}">
    <td style="padding:7px 12px;font-family:monospace;font-size:11px">${esc(r.sn)}</td>
    <td style="padding:7px 12px">${esc(r.maszyna||'—')}</td>
    <td style="padding:7px 12px">${esc(r.firma||'—')}</td>
    <td style="padding:7px 12px">${repChips(r.handlowcy)}</td>
    <td style="padding:7px 12px;text-align:center;font-weight:600">${mSince}</td>
    <td style="padding:7px 12px">${isExcluded ? '<span style="color:var(--text-muted)">—</span>' : r.first_pay
      ? `<strong>${r.first_pay.slice(0,7)}</strong>`
      : '<span style="color:var(--red)">—</span>'}</td>
    <td style="padding:7px 12px;font-size:11px;color:${delayColor}">${delayTxt}</td>
    <td style="padding:7px 12px;text-align:center;font-weight:600;color:${r.total_months?'inherit':'var(--text-muted)'}">${r.total_months||0}</td>
    <td style="padding:7px 12px">${covBar}</td>
    <td style="padding:7px 12px"><span class="badge ${SC[st].badge}">${SC[st].label}</span></td>
  </tr>`;
}

// Toggle group expand/collapse
document.getElementById('monitorContent').addEventListener('click', e => {
  const hdr = e.target.closest('[data-action="toggle-mon-group"]');
  if (!hdr) return;
  const body  = document.getElementById('mgb_' + hdr.dataset.groupId);
  const arrow = hdr.querySelector('.toggle-arrow');
  if (!body) return;
  const opening = body.style.display === 'none';
  body.style.display = opening ? 'block' : 'none';
  if (arrow) arrow.textContent = opening ? '▼' : '▶';
});
