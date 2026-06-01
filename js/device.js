// ── WAIDS — device search tab ─────────────────────────────────────────────

async function searchBySN() {
  const sn = document.getElementById('snSearchInput').value.trim();
  if (!sn) { setMsg('msgSnSearch', '⚠ Wpisz numer seryjny.', 'err'); return; }

  setMsg('msgSnSearch', '⏳ Szukam…');
  const resultEl = document.getElementById('snSearchResult');
  resultEl.innerHTML = '';

  try {
    const r = await fetch(`${API}/payments/${encodeURIComponent(sn)}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const pays = await r.json();   // [{year_month, customer, amount, currency}, ...]

    // Find device info in loaded results (if available)
    const dev = results.find(d => d.sn === sn);

    setMsg('msgSnSearch', '');

    if (!pays.length && !dev) {
      resultEl.innerHTML = `<div class="section-card" style="color:var(--text-muted);font-size:13px">
        ❌ Brak urządzenia i płatności dla SN <strong>${esc(sn)}</strong> w bazie.</div>`;
      return;
    }

    const currency = pays.find(p => p.currency)?.currency || 'PLN';
    const total    = pays.reduce((s, p) => s + (p.amount || 0), 0);

    // Device info card
    let devHtml = '';
    if (dev) {
      const statusColors = {
        paid:'var(--green)', unpaid:'var(--red)', oem:'var(--gray)',
        excluded:'var(--amber)', only:'var(--amber)'
      };
      const statusLabel = {paid:'✅ Opłacone', unpaid:'❌ Brak opłaty', oem:'⚪ OEM',
                           excluded:'🚫 Wykluczone', only:'🟡 Tylko płatność'}[dev.status] || dev.status;
      const col = statusColors[dev.status] || 'var(--text-muted)';
      devHtml = `
        <div class="section-card" style="margin-bottom:1rem">
          <div class="section-title">Dane urządzenia</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:.6rem .8rem;font-size:13px">
            <div><span style="font-size:11px;color:var(--text-muted);display:block">Numer seryjny</span><strong>${esc(sn)}</strong></div>
            <div><span style="font-size:11px;color:var(--text-muted);display:block">Maszyna</span>${esc(dev.model || '—')}</div>
            <div><span style="font-size:11px;color:var(--text-muted);display:block">Typ</span>${esc(dev.device_type || '—')}</div>
            <div><span style="font-size:11px;color:var(--text-muted);display:block">Klient (płatności)</span>${esc(dev.customer || '—')}</div>
            <div><span style="font-size:11px;color:var(--text-muted);display:block">Firma (produkcja)</span>${esc(dev.firma || '—')}</div>
            <div><span style="font-size:11px;color:var(--text-muted);display:block">Data produkcji</span>${dev.prod_date ? dev.prod_date.slice(0,7) : '—'}</div>
            <div><span style="font-size:11px;color:var(--text-muted);display:block">Handlowiec</span>${esc(dev.sales_rep || '—')}</div>
            <div><span style="font-size:11px;color:var(--text-muted);display:block">Status</span><strong style="color:${col}">${statusLabel}</strong></div>
          </div>
        </div>`;
    } else {
      devHtml = `<div class="section-card" style="margin-bottom:1rem;font-size:12px;color:var(--text-muted)">
        ⚠ Urządzenie <strong>${esc(sn)}</strong> nie jest w bazie produkcji — widoczne tylko z płatności.</div>`;
    }

    // Payment history card
    let payHtml = '';
    if (pays.length) {
      const hasNetto  = pays.some(p => p.amount_netto  > 0);
      const hasBrutto = pays.some(p => p.amount_brutto > 0);
      const totalNetto  = pays.reduce((s,p) => s + (p.amount_netto  || 0), 0);
      const totalBrutto = pays.reduce((s,p) => s + (p.amount_brutto || 0), 0);

      const rows = pays.map(p => `
        <tr>
          <td style="font-size:12px;padding:7px 14px;font-weight:600">${esc(p.year_month)}</td>
          <td style="font-size:12px;padding:7px 14px;color:var(--text-muted)">${esc(p.customer || '—')}</td>
          <td style="font-size:12px;padding:7px 14px;text-align:right;font-weight:600;color:var(--green)">
            ${p.amount ? fmtAmount(p.amount, p.currency) : '—'}
          </td>
          ${hasNetto  ? `<td style="font-size:12px;padding:7px 14px;text-align:right;color:var(--text-muted)">${p.amount_netto  > 0 ? fmtAmount(p.amount_netto,  'PLN') : '—'}</td>` : ''}
          ${hasBrutto ? `<td style="font-size:12px;padding:7px 14px;text-align:right;color:var(--text-muted)">${p.amount_brutto > 0 ? fmtAmount(p.amount_brutto, 'PLN') : '—'}</td>` : ''}
        </tr>`).join('');

      const sumRow = `
        <tr style="border-top:1.5px solid var(--border-med);font-weight:700">
          <td style="padding:8px 14px;font-size:12px" colspan="2">Suma</td>
          <td style="padding:8px 14px;font-size:12px;text-align:right;color:var(--green)">${fmtAmount(total, currency)}</td>
          ${hasNetto  ? `<td style="padding:8px 14px;font-size:12px;text-align:right;color:var(--text-muted)">${fmtAmount(totalNetto,  'PLN')}</td>` : ''}
          ${hasBrutto ? `<td style="padding:8px 14px;font-size:12px;text-align:right;color:var(--text-muted)">${fmtAmount(totalBrutto, 'PLN')}</td>` : ''}
        </tr>`;

      payHtml = `
        <div class="section-card" style="padding:0;overflow:hidden">
          <div style="padding:1rem 1.5rem .75rem;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
            <div class="section-title" style="margin:0">Historia płatności</div>
            <span style="font-size:12px;color:var(--text-muted)">${pays.length} rekordów</span>
            <span style="font-size:13px;font-weight:700;color:var(--green);margin-left:auto">Σ ${fmtAmount(total, currency)}</span>
          </div>
          <div style="overflow-x:auto">
            <table style="min-width:400px">
              <thead><tr>
                <th style="text-align:left;padding:8px 14px">Miesiąc</th>
                <th style="text-align:left;padding:8px 14px">Klient</th>
                <th style="text-align:right;padding:8px 14px"
                    title="Kwota w walucie oryginalnej (ob_CenaWaluta)">Kwota (waluta)</th>
                ${hasNetto  ? '<th style="text-align:right;padding:8px 14px" title="Netto PLN (ob_CenaNetto)">Netto PLN</th>'   : ''}
                ${hasBrutto ? '<th style="text-align:right;padding:8px 14px" title="Brutto PLN (ob_WartBrutto)">Brutto PLN</th>' : ''}
              </tr></thead>
              <tbody>${rows}${sumRow}</tbody>
            </table>
          </div>
        </div>`;
    } else {
      payHtml = `<div class="section-card" style="color:var(--amber);font-size:13px">
        ⚠ Brak płatności w bazie dla urządzenia <strong>${esc(sn)}</strong>.</div>`;
    }

    resultEl.innerHTML = devHtml + payHtml;

  } catch(e) {
    setMsg('msgSnSearch', '❌ ' + e.message, 'err');
  }
}
