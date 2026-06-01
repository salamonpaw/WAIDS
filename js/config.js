// ── WAIDS — config tab ────────────────────────────────────────────────────

async function loadConfig() {
  await Promise.all([loadExclusions(), loadReps(), loadOverridesList(), loadFirmConfigs()]);
  if (currentUser?.is_admin) loadAdminUsers();
  // Populate firm autocomplete AFTER firmConfigs loaded (_firmConfigData available)
  loadMergeFirmaLists();
  loadMergeHistory();
  loadFirmsList();
}

// ── Firm config table ──────────────────────────────────────────────────────
const FIRM_TYPE_LABELS = { ids:'IDS', licencja:'Licencja', oem:'OEM', inne:'Inne' };
const CYCLE_LABELS     = { monthly:'miesięczny', quarterly:'kwartalny',
                           annual:'roczny', once:'jednorazowy', '':'—' };

async function loadFirmConfigs() {
  try {
    const data = await (await fetch(`${API}/firm-configs`)).json();
    _firmConfigData = data;
    renderFirmConfigTable(data);
  } catch(e) {
    setMsg('msgFirmImport', '❌ Błąd ładowania konfiguracji firm: ' + e.message, 'err');
  }
}

function renderFirmConfigTable(configs) {
  const tbody = document.getElementById('firmConfigList');
  if (!configs.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:1rem">Brak skonfigurowanych firm — pobierz Excel, uzupełnij i wgraj.</td></tr>';
    return;
  }
  tbody.innerHTML = configs.map(c => {
    const typeBadge = `<span class="badge ${c.firm_type}">${FIRM_TYPE_LABELS[c.firm_type]||c.firm_type}</span>`;
    const cycle     = CYCLE_LABELS[c.cycle] || c.cycle || '—';
    const amount    = c.expected_amount > 0 ? fmtAmount(c.expected_amount, c.currency) : '—';
    return `<tr>
      <td style="font-weight:500">${esc(c.firma)}</td>
      <td>${typeBadge}</td>
      <td style="font-size:12px;color:var(--text-muted)">${cycle}</td>
      <td style="text-align:right;font-size:12px">${amount}</td>
      <td><button class="ghost sm" onclick="openFirmConfigModal('${esc(c.firma)}')" title="Edytuj konfigurację firmy">✎</button></td>
      <td><button class="ghost sm" onclick="deleteFirmConfig('${esc(c.firma)}')" title="Usuń konfigurację tej firmy">✕</button></td>
    </tr>`;
  }).join('');
}

async function deleteFirmConfig(firma) {
  if (!confirm(`Usunąć konfigurację firmy „${firma}"?`)) return;
  try {
    const r = await fetch(`${API}/firm-configs/${encodeURIComponent(firma)}`, {method:'DELETE'});
    if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
    await loadFirmConfigs();
  } catch(e) { alert('Błąd: ' + e.message); }
}

function openFirmConfigModal(firma) {
  const cfg = _firmConfigData.find(c => c.firma === firma)
    || {firma, firm_type:'ids', cycle:'', expected_amount:0, currency:'PLN'};
  document.getElementById('fcmFirmaLabel').textContent = firma;
  document.getElementById('firmConfigModal').dataset.firma = firma;
  document.getElementById('fcmType').value     = cfg.firm_type || 'ids';
  document.getElementById('fcmCycle').value    = cfg.cycle || '';
  document.getElementById('fcmAmount').value   = cfg.expected_amount > 0 ? cfg.expected_amount : '';
  document.getElementById('fcmCurrency').value = cfg.currency || 'PLN';
  const showLic = ['licencja', 'ids'].includes(cfg.firm_type || 'ids');
  document.getElementById('fcmLicFields').style.display = showLic ? '' : 'none';
  document.getElementById('firmConfigModal').showModal();
}

async function saveFirmConfigModal() {
  const modal = document.getElementById('firmConfigModal');
  const firma = modal.dataset.firma;
  const body  = {
    firm_type:       document.getElementById('fcmType').value,
    cycle:           document.getElementById('fcmCycle').value,
    expected_amount: parseFloat(document.getElementById('fcmAmount').value) || 0,
    currency:        document.getElementById('fcmCurrency').value,
  };
  try {
    const r = await fetch(`${API}/firm-configs/${encodeURIComponent(firma)}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
    modal.close();
    setMsg('msgFirmImport', `✓ Zapisano konfigurację firmy „${firma}".`, 'ok');
    await loadFirmConfigs();
  } catch(e) { alert('Błąd zapisu: ' + e.message); }
}

// Show/hide licence fields when firm type changes in modal
document.getElementById('fcmType').addEventListener('change', function() {
  const showLic = ['licencja', 'ids'].includes(this.value);
  document.getElementById('fcmLicFields').style.display = showLic ? '' : 'none';
});

async function downloadFirmsExcel() {
  try {
    const r = await fetch(`${API}/firms/export`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'firmy_konfiguracja.xlsx';
    a.click();
  } catch(e) { alert('Błąd pobierania: ' + e.message); }
}

async function uploadFirmsExcel(input) {
  const file = input.files[0];
  if (!file) return;
  const mode = document.querySelector('input[name="importMode"]:checked')?.value || 'supplement';
  setMsg('msgFirmImport', '⏳ Importuję…');
  const form = new FormData();
  form.append('file', file);
  form.append('mode', mode);
  try {
    const r = await fetch(`${API}/firms/import`, {method:'POST', body:form});
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || r.statusText);
    const errNote = d.errors?.length ? ` ⚠ ${d.errors.length} błędów (otwórz konsolę)` : '';
    if (d.errors?.length) console.warn('Błędy importu firm:', d.errors);
    setMsg('msgFirmImport',
      `✓ Przetworzono ${d.firms_processed} firm. Zaktualizowano: ${d.updated_config} konfiguracji, ${d.updated_reps} przypisań.${errNote}`,
      'ok');
    await loadFirmConfigs();
    await loadReps();
  } catch(e) { setMsg('msgFirmImport', '❌ ' + e.message, 'err'); }
  input.value = '';
}

// ── Overrides list ─────────────────────────────────────────────────────────
async function loadOverridesList() {
  try {
    const data = await (await fetch(`${API}/devices/overrides`)).json();
    const tbody = document.getElementById('overridesList');
    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:1rem">Brak ręcznych nadpisań</td></tr>';
      return;
    }
    const LIMIT = 10;
    const renderRows = (items) => items.map(d => `<tr>
      <td style="font-family:monospace;font-size:11px;white-space:nowrap">${esc(d.sn)}<button class="copy-sn" onclick="copySN('${esc(d.sn)}')" title="Kopiuj SN">⎘</button></td>
      <td>${esc(d.firma||'—')}</td>
      <td>${esc(d.maszyna||'—')}</td>
      <td><span class="dt-badge ${d.device_type_override}">${DT_LABELS[d.device_type_override]||d.device_type_override}</span></td>
      <td><button class="ghost sm" data-action="override-reset" data-sn="${esc(d.sn)}" style="color:var(--text-muted)">↺ Reset</button></td>
    </tr>`).join('');

    if (data.length <= LIMIT) {
      tbody.innerHTML = renderRows(data);
    } else {
      tbody.innerHTML = renderRows(data.slice(0, LIMIT)) +
        `<tr id="overridesExpandRow">
          <td colspan="5" style="text-align:center;padding:.75rem">
            <button class="ghost sm" onclick="expandOverrides(${JSON.stringify(data).replace(/"/g,'&quot;')})">
              ▼ Pokaż wszystkie ${data.length} nadpisań
            </button>
          </td>
        </tr>`;
    }
  } catch(e) { setMsg('msgOverrides','❌ '+e.message,'err'); }
}

function expandOverrides(data) {
  const tbody = document.getElementById('overridesList');
  tbody.innerHTML = data.map(d => `<tr>
    <td style="font-family:monospace;font-size:11px;white-space:nowrap">${esc(d.sn)}<button class="copy-sn" onclick="copySN('${esc(d.sn)}')" title="Kopiuj SN">⎘</button></td>
    <td>${esc(d.firma||'—')}</td>
    <td>${esc(d.maszyna||'—')}</td>
    <td><span class="dt-badge ${d.device_type_override}">${DT_LABELS[d.device_type_override]||d.device_type_override}</span></td>
    <td><button class="ghost sm" data-action="override-reset" data-sn="${esc(d.sn)}" style="color:var(--text-muted)">↺ Reset</button></td>
  </tr>`).join('') +
  `<tr><td colspan="5" style="text-align:center;padding:.75rem">
    <button class="ghost sm" onclick="loadOverridesList()">▲ Zwiń</button>
  </td></tr>`;
}

document.getElementById('overridesList').addEventListener('click', async e => {
  const btn = e.target.closest('[data-action="override-reset"]');
  if (!btn) return;
  const sn = btn.dataset.sn;
  if (!confirm(`Zresetować nadpisanie dla SN ${sn}?`)) return;
  try {
    await fetch(`${API}/devices/${encodeURIComponent(sn)}/type`, {
      method: 'PATCH', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({device_type: ''})
    });
    setMsg('msgOverrides', `✓ Reset SN ${sn}.`, 'ok');
    loadOverridesList();
  } catch(e) { setMsg('msgOverrides','❌ '+e.message,'err'); }
});

// ── Exclusions ─────────────────────────────────────────────────────────────
async function loadExclusions() {
  try {
    const data = await (await fetch(`${API}/exclusions`)).json();
    renderExclusions(data);
  } catch(e) { setMsg('msgExc','❌ Błąd ładowania: '+e.message,'err'); }
}

function renderExclusions(exclusions) {
  const tbody = document.getElementById('exclusionsList');
  if (!exclusions.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:1rem">Brak wykluczeń</td></tr>';
    return;
  }
  tbody.innerHTML = exclusions.map(e => `<tr>
    <td><strong>${esc(e.firma)}</strong></td>
    <td style="color:var(--text-muted)">${esc(e.reason||'—')}</td>
    <td><button class="danger sm" data-action="exc-remove" data-firma="${esc(e.firma)}">Usuń</button></td>
  </tr>`).join('');
}

document.getElementById('exclusionsList').addEventListener('click', e => {
  const btn = e.target.closest('[data-action="exc-remove"]');
  if (btn) removeExclusion(btn.dataset.firma);
});

async function addExclusion() {
  const firma  = document.getElementById('newExcFirma').value.trim();
  const reason = document.getElementById('newExcReason').value.trim();
  if (!firma) { setMsg('msgExc','⚠ Podaj nazwę firmy.','err'); return; }
  try {
    const r = await fetch(`${API}/exclusions`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({firma, reason})
    });
    if (!r.ok) throw new Error((await r.json()).detail);
    document.getElementById('newExcFirma').value  = '';
    document.getElementById('newExcReason').value = '';
    setMsg('msgExc', `✓ Dodano „${firma}".`, 'ok');
    loadExclusions();
  } catch(e) { setMsg('msgExc','❌ '+e.message,'err'); }
}

async function removeExclusion(firma) {
  if (!confirm(`Usunąć „${firma}" z wykluczeń?`)) return;
  try {
    await fetch(`${API}/exclusions?firma=${encodeURIComponent(firma)}`, {method:'DELETE'});
    setMsg('msgExc', `✓ Usunięto „${firma}".`, 'ok');
    loadExclusions();
  } catch(e) { setMsg('msgExc','❌ '+e.message,'err'); }
}

// ── Reps ───────────────────────────────────────────────────────────────────
async function loadReps() {
  try {
    const [repsRes, firmsRes] = await Promise.all([fetch(`${API}/reps`), fetch(`${API}/reps/firms`)]);
    const reps  = await repsRes.json();
    const fdata = await firmsRes.json();
    allFirms = fdata.firms || [];
    const dl = document.getElementById('firmsSuggestions');
    dl.innerHTML = allFirms.map(f=>`<option value="${esc(f)}">`).join('');
    renderReps(reps);
  } catch(e) { setMsg('msgReps','❌ Błąd ładowania: '+e.message,'err'); }
}

function renderReps(reps) {
  const container = document.getElementById('repsList');
  if (!reps.length) { container.innerHTML='<div style="color:var(--text-muted)">Brak handlowców</div>'; return; }
  container.innerHTML = reps.map(rep => {
    const avail = allFirms.filter(f => !rep.firms.includes(f));
    return `<div class="rep-card">
      <div class="rep-header">
        <span class="rep-name" style="background:${repColorMap[rep.name]?.color||'#888'}22;
              border-left:3px solid ${repColorMap[rep.name]?.color||'#888'};
              padding:2px 8px 2px 6px;border-radius:4px">
          👤 ${esc(rep.name)}
        </span>
        <div class="rep-add" style="display:flex;gap:6px;align-items:center;margin-left:auto">
          <select id="firmAdd_${rep.id}">
            <option value="">Dodaj firmę…</option>
            ${avail.map(f=>`<option value="${esc(f)}">${esc(f)}</option>`).join('')}
          </select>
          <button class="sm primary" data-action="rep-firm-add" data-rep-id="${rep.id}">+ Dodaj</button>
        </div>
        <button class="sm ghost" data-action="rep-delete" data-rep-id="${rep.id}" data-rep-name="${esc(rep.name)}"
                title="Usuń handlowca z systemu (usuwa wszystkie przypisania)"
                style="color:var(--text-muted);font-size:11px;margin-left:8px;border-color:var(--border)">🗑 Usuń</button>
      </div>
      <div class="firm-tags">
        ${rep.firms.length
          ? rep.firms.map(f=>{
              const c = repColorMap[rep.name]?.color||'var(--border-med)';
              return `<span class="firm-tag" style="border-color:${c};background:${c}18">
                ${esc(f)}
                <button class="tag-remove" data-action="rep-firm-remove" data-rep-id="${rep.id}" data-firma="${esc(f)}" title="Usuń przypisanie">×</button>
              </span>`;
            }).join('')
          : '<span style="color:var(--text-muted);font-size:11px">Brak przypisanych firm</span>'}
      </div>
    </div>`;
  }).join('');
}

document.getElementById('repsList').addEventListener('click', e => {
  const rmBtn  = e.target.closest('[data-action="rep-firm-remove"]');
  if (rmBtn) { removeFirmFromRep(+rmBtn.dataset.repId, rmBtn.dataset.firma); return; }
  const addBtn = e.target.closest('[data-action="rep-firm-add"]');
  if (addBtn) {
    const sel = document.getElementById(`firmAdd_${addBtn.dataset.repId}`);
    if (sel?.value) addFirmToRep(+addBtn.dataset.repId, sel.value);
    return;
  }
  const delBtn = e.target.closest('[data-action="rep-delete"]');
  if (delBtn) { deleteSalesRep(+delBtn.dataset.repId, delBtn.dataset.repName); return; }
});

async function addFirmToRep(repId, firma) {
  try {
    const r = await fetch(`${API}/reps/${repId}/firms`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({firma})
    });
    if (!r.ok) throw new Error((await r.json()).detail);
    setMsg('msgReps', `✓ Przypisano „${firma}".`, 'ok');
    loadReps();
  } catch(e) { setMsg('msgReps','❌ '+e.message,'err'); }
}

async function removeFirmFromRep(repId, firma) {
  try {
    await fetch(`${API}/reps/${repId}/firms?firma=${encodeURIComponent(firma)}`, {method:'DELETE'});
    setMsg('msgReps', `✓ Odpięto „${firma}".`, 'ok');
    loadReps();
  } catch(e) { setMsg('msgReps','❌ '+e.message,'err'); }
}

async function addSalesRep() {
  const inp  = document.getElementById('newRepName');
  const name = inp.value.trim();
  if (!name) { setMsg('msgReps', '⚠ Wpisz imię i nazwisko handlowca.', 'err'); return; }
  try {
    const r = await fetch(`${API}/sales-reps`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name}),
    });
    if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
    inp.value = '';
    setMsg('msgReps', `✓ Dodano handlowca „${name}".`, 'ok');
    await loadReps();
  } catch(e) { setMsg('msgReps', '❌ ' + e.message, 'err'); }
}

async function deleteSalesRep(repId, repName) {
  if (!confirm(`Usunąć handlowca „${repName}"?\nWszystkie przypisania firm zostaną usunięte.`)) return;
  try {
    const r = await fetch(`${API}/sales-reps/${repId}`, {method: 'DELETE'});
    if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
    setMsg('msgReps', `✓ Usunięto handlowca „${repName}".`, 'ok');
    await loadReps();
  } catch(e) { setMsg('msgReps', '❌ ' + e.message, 'err'); }
}

// ── Admin users ────────────────────────────────────────────────────────────
async function loadAdminUsers() {
  const section = document.getElementById('adminUsersSection');
  if (section) section.style.display = 'block';
  try {
    const data = await (await fetch(`${API}/admin/users`)).json();
    renderAdminUsers(data);
  } catch(e) { setMsg('msgAdminUsers','❌ '+e.message,'err'); }
}

function renderAdminUsers(users) {
  const tbody = document.getElementById('adminUsersList');
  if (!tbody) return;
  tbody.innerHTML = users.map(u => `<tr>
    <td style="font-size:12px">${esc(u.email)}</td>
    <td style="font-size:12px">${esc(u.name)}</td>
    <td>${u.is_admin ? '<span class="badge paid">Admin</span>' : '<span class="badge" style="background:var(--gray-light)">User</span>'}</td>
    <td>${u.is_active ? '<span class="badge paid">Aktywny</span>' : '<span class="badge unpaid">Nieaktywny</span>'}</td>
    <td>
      <button class="ghost sm" onclick="adminToggleActive(${u.id},${!u.is_active})" title="${u.is_active?'Dezaktywuj':'Aktywuj'}">
        ${u.is_active ? '🔒 Dezaktywuj' : '🔓 Aktywuj'}
      </button>
      <button class="ghost sm" onclick="adminResetPassword(${u.id})" title="Resetuj hasło">🔑 Hasło</button>
    </td>
  </tr>`).join('');
}

async function adminToggleActive(uid, active) {
  if (!confirm(active ? `Aktywować użytkownika?` : `Dezaktywować użytkownika? Utraci dostęp.`)) return;
  try {
    await fetch(`${API}/admin/users/${uid}/set-active`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({active})
    });
    await loadAdminUsers();
  } catch(e) { alert('Błąd: '+e.message); }
}

async function adminResetPassword(uid) {
  const pwd = prompt('Podaj nowe hasło (min. 6 znaków):');
  if (!pwd || pwd.length < 6) { if(pwd !== null) alert('Za krótkie hasło.'); return; }
  try {
    const r = await fetch(`${API}/admin/users/${uid}/set-password`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password:pwd})
    });
    if (!r.ok) throw new Error((await r.json()).detail);
    alert('✓ Hasło zmienione.');
  } catch(e) { alert('Błąd: '+e.message); }
}

async function adminAddUser() {
  const email    = document.getElementById('newUserEmail').value.trim();
  const name     = document.getElementById('newUserName').value.trim();
  const password = document.getElementById('newUserPassword').value;
  const is_admin = document.getElementById('newUserAdmin').checked;
  if (!email || !password) { setMsg('msgAdminUsers','⚠ Podaj email i hasło.','err'); return; }
  if (password.length < 6) { setMsg('msgAdminUsers','⚠ Hasło min. 6 znaków.','err'); return; }
  try {
    const r = await fetch(`${API}/admin/users`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({email, name: name||email, password, is_admin})
    });
    if (!r.ok) throw new Error((await r.json()).detail);
    document.getElementById('newUserEmail').value    = '';
    document.getElementById('newUserName').value     = '';
    document.getElementById('newUserPassword').value = '';
    document.getElementById('newUserAdmin').checked  = false;
    setMsg('msgAdminUsers',`✓ Dodano użytkownika ${email}.`,'ok');
    await loadAdminUsers();
  } catch(e) { setMsg('msgAdminUsers','❌ '+e.message,'err'); }
}

// ── License fees ───────────────────────────────────────────────────────────
let _licenseFees = [];
let _lfEditId    = null;

async function loadLicenseFees() {
  try {
    _licenseFees = await (await fetch(`${API}/license-fees`)).json();
  } catch(e) { _licenseFees = []; }
  renderLicenseFeesTable();
}

function renderLicenseFeesTable() {
  const tbody = document.getElementById('licenseFeesBody');
  if (!tbody) return;
  if (!_licenseFees.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:1.5rem">Brak wpisów — dodaj pierwszą opłatę licencyjną powyżej.</td></tr>';
    return;
  }
  const fmt = v => v ? new Intl.NumberFormat('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v) : '—';
  tbody.innerHTML = _licenseFees.map(f => `<tr>
    <td><strong>${f.firma}</strong></td>
    <td style="text-align:right">${fmt(f.amount)}</td>
    <td>${f.currency}</td>
    <td>${f.date_from || '—'}</td>
    <td>${f.date_to || '<span style="color:var(--green)">bieżąca ∞</span>'}</td>
    <td style="color:var(--text-muted)">${f.note || ''}</td>
    <td style="text-align:right">
      <button style="font-size:11px;padding:2px 7px;border-radius:4px;border:0.5px solid var(--border-med);cursor:pointer;margin-right:4px"
              onclick="editLicenseFee(${f.id})">✎</button>
      <button class="danger" style="font-size:11px;padding:2px 7px;border-radius:4px;cursor:pointer"
              onclick="deleteLicenseFee(${f.id},'${f.firma.replace(/'/g,"\\'")}')">✕</button>
    </td>
  </tr>`).join('');
}

function editLicenseFee(id) {
  const f = _licenseFees.find(x => x.id === id);
  if (!f) return;
  _lfEditId = id;
  document.getElementById('lfFirma').value    = f.firma;
  document.getElementById('lfAmount').value   = f.amount;
  document.getElementById('lfCurrency').value = f.currency || 'PLN';
  document.getElementById('lfDateFrom').value = f.date_from || '';
  document.getElementById('lfDateTo').value   = f.date_to   || '';
  document.getElementById('lfNote').value     = f.note      || '';
  document.getElementById('lfFirma').scrollIntoView({ behavior:'smooth', block:'center' });
  setMsg('msgLicenseFees','Wypełniono formularz edycji. Zmień dane i kliknij Zapisz.');
}

async function saveLicenseFee() {
  const firma    = document.getElementById('lfFirma').value.trim();
  const amount   = parseFloat(document.getElementById('lfAmount').value) || 0;
  const currency = document.getElementById('lfCurrency').value;
  const dateFrom = document.getElementById('lfDateFrom').value;
  const dateTo   = document.getElementById('lfDateTo').value;
  const note     = document.getElementById('lfNote').value.trim();

  if (!firma)    { setMsg('msgLicenseFees','Podaj nazwę firmy','err'); return; }
  if (amount<=0) { setMsg('msgLicenseFees','Kwota musi być > 0','err'); return; }

  const url    = _lfEditId ? `${API}/license-fees/${_lfEditId}` : `${API}/license-fees`;
  const method = _lfEditId ? 'PUT' : 'POST';

  try {
    const r = await fetch(url, { method, headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ firma, amount, currency, date_from:dateFrom, date_to:dateTo, note }) });
    if (!r.ok) { const e = await r.json(); throw new Error(e.detail||r.status); }
    setMsg('msgLicenseFees', _lfEditId ? 'Zaktualizowano.' : 'Dodano.','ok');
    _lfEditId = null;
    ['lfFirma','lfAmount','lfDateFrom','lfDateTo','lfNote'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('lfCurrency').value = 'PLN';
    await loadLicenseFees();
  } catch(e) { setMsg('msgLicenseFees','Błąd: '+e.message,'err'); }
}

async function deleteLicenseFee(id, firma) {
  if (!confirm(`Usunąć wpis licencyjny dla „${firma}"?`)) return;
  try {
    const r = await fetch(`${API}/license-fees/${id}`, { method:'DELETE' });
    if (!r.ok) throw new Error(r.status);
    await loadLicenseFees();
    setMsg('msgLicenseFees','Usunięto.','ok');
  } catch(e) { setMsg('msgLicenseFees','Błąd: '+e.message,'err'); }
}

// ── Company merge ──────────────────────────────────────────────────────────
let _allFirmsForMerge = [];
let _mergeFirmSet     = [];

async function loadMergeFirmaLists() {
  // Build a comprehensive list of ALL firm names from every available source:
  // 1. results[] (already loaded analyze data) — most complete, no extra fetch
  // 2. /api/reps/firms — all unique firma values from devices table
  // 3. _firmConfigData — firms already configured
  const firmSet = new Set();

  // Source 1: already-loaded device results (free, most comprehensive)
  if (results && results.length) {
    results.forEach(r => { if (r.firma) firmSet.add(r.firma); });
  }

  // Source 2: dedicated firms endpoint (always fetched, works even before report loads)
  try {
    const data = await (await fetch(`${API}/reps/firms`)).json();
    (data.firms || []).filter(Boolean).forEach(f => firmSet.add(f));
  } catch(e) { /* ignore, use what we have */ }

  // Source 3: firm config data (firms explicitly configured)
  if (_firmConfigData && _firmConfigData.length) {
    _firmConfigData.forEach(f => { if (f.firma) firmSet.add(f.firma); });
  }

  _allFirmsForMerge = [...firmSet].sort((a, b) => a.localeCompare(b, 'pl'));

  _refreshMergeDatalist();
}

function _refreshMergeDatalist() {
  const opts = _allFirmsForMerge.map(f => `<option value="${esc(f)}">`).join('');
  ['mergeFirmaList', 'mergeFirmaList2', 'lfFirmaList', 'firmsSuggestions'].forEach(id => {
    const dl = document.getElementById(id);
    if (dl) dl.innerHTML = opts;
  });
}

function mergeAddFirm() {
  const inp = document.getElementById('mergeAddInput');
  const val = inp?.value.trim();
  if (!val) return;

  // Case-insensitive duplicate check
  if (_mergeFirmSet.some(f => f.toLowerCase() === val.toLowerCase())) {
    inp.value = '';
    return;
  }

  // Warn if firm not found in DB (might be a typo)
  const knownExact = _allFirmsForMerge.includes(val);
  const knownCI    = !knownExact && _allFirmsForMerge.some(f => f.toLowerCase() === val.toLowerCase());
  if (knownCI) {
    // Use exact casing from DB
    const exact = _allFirmsForMerge.find(f => f.toLowerCase() === val.toLowerCase());
    _mergeFirmSet.push(exact);
  } else {
    _mergeFirmSet.push(val);
    if (!knownExact && _allFirmsForMerge.length > 0) {
      setMsg('msgMerge', `⚠ Firma „${val}" nie istnieje w bazie — sprawdź pisownię.`, 'err');
    }
  }
  inp.value = '';
  renderMergeChips();
}

function mergeRemoveFirm(idx) {
  _mergeFirmSet.splice(idx, 1);
  renderMergeChips();
}

function renderMergeChips() {
  const container = document.getElementById('mergeFirmChips');
  const btn = document.getElementById('mergeDoBtn');
  if (!container) return;

  // Flag firms not found in DB with red border
  container.innerHTML = _mergeFirmSet.map((f, i) => {
    const unknown = _allFirmsForMerge.length > 0 && !_allFirmsForMerge.includes(f);
    const borderCol = unknown ? 'var(--red)' : 'var(--border-med)';
    const titleAttr = unknown ? ` title="⚠ Firma nie istnieje w bazie produkcji"` : '';
    return `<span${titleAttr} style="display:inline-flex;align-items:center;gap:5px;
                 background:var(--bg-secondary);border:0.5px solid ${borderCol};
                 border-radius:99px;padding:3px 10px 3px 12px;font-size:12px;font-weight:500">
      ${unknown ? '⚠ ' : ''}${esc(f)}
      <button onclick="mergeRemoveFirm(${i})"
              style="width:16px;height:16px;border-radius:50%;border:none;background:var(--border-med);
                     color:var(--text);cursor:pointer;font-size:10px;display:flex;align-items:center;
                     justify-content:center;flex-shrink:0">✕</button>
    </span>`;
  }).join('');

  const canMerge = _mergeFirmSet.length >= 2;
  if (btn) {
    btn.disabled = !canMerge;
    btn.style.opacity      = canMerge ? '1' : '0.35';
    btn.style.pointerEvents = canMerge ? 'auto' : 'none';
  }
}

function openMergeDialog() {
  if (_mergeFirmSet.length < 2) return;
  const info      = document.getElementById('mergeDialogInfo');
  const nameInput = document.getElementById('mergeTargetName');
  if (info) info.innerHTML = `Firmy do scalenia:<br>
    ${_mergeFirmSet.map(f => `<strong>${esc(f)}</strong>`).join(' + ')}<br>
    <span style="color:var(--amber);font-size:11px">Wszystkie dane zostaną przeniesione na docelową nazwę. Operacja nieodwracalna.</span>`;
  if (nameInput) {
    nameInput.value = _mergeFirmSet[0];
    const dl2 = document.getElementById('mergeFirmaList2');
    if (dl2) dl2.innerHTML = _mergeFirmSet.map(f => `<option value="${esc(f)}">`).join('');
  }
  document.getElementById('mergeDialog').showModal();
}

async function executeMerge() {
  const target = document.getElementById('mergeTargetName')?.value.trim();
  if (!target) { setMsg('msgMerge','Podaj docelową nazwę firmy','err'); return; }

  const sources = _mergeFirmSet.filter(f => f !== target);
  if (!sources.length) { setMsg('msgMerge','Docelowa nazwa musi różnić się od źródeł','err'); return; }

  document.getElementById('mergeDialog').close();

  let totalDevices = 0, totalReps = 0, errors = [];
  for (const src of sources) {
    try {
      const r = await fetch(`${API}/firms/merge`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ source: src, target })
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.detail || r.status); }
      const d = await r.json();
      totalDevices += (d.affected?.devices || 0);
      totalReps    += (d.affected?.firm_reps || 0);
    } catch(e) { errors.push(`${src}: ${e.message}`); }
  }

  if (errors.length) {
    setMsg('msgMerge', '⚠️ Błędy: ' + errors.join('; '), 'err');
  } else {
    setMsg('msgMerge',
      `✅ Scalono ${sources.length} firm w „${target}". Urządzeń: ${totalDevices}, handlowców: ${totalReps}`,
      'ok');
  }

  _mergeFirmSet = [];
  renderMergeChips();
  await loadMergeFirmaLists();
  loadMergeHistory();
  if (document.getElementById('tab-config').classList.contains('active')) loadConfig();
}

// ── Merge history ───────────────────────────────────────────────────────────
async function loadMergeHistory() {
  const tbody = document.getElementById('mergeHistoryBody');
  const empty = document.getElementById('mergeHistoryEmpty');
  const table = document.getElementById('mergeHistoryTable');
  if (!tbody) return;
  try {
    const d = await (await fetch(`${API}/firms/merges`)).json();
    const rows = d.merges || [];
    if (!rows.length) {
      tbody.innerHTML = '';
      if (empty) empty.style.display = '';
      if (table) table.style.display = 'none';
      return;
    }
    if (empty) empty.style.display = 'none';
    if (table) table.style.display = '';
    tbody.innerHTML = rows.map(r => `
      <tr style="border-bottom:1px solid var(--border-light)">
        <td style="padding:5px 8px;color:var(--text-muted);white-space:nowrap">${esc(r.merged_at)}</td>
        <td style="padding:5px 8px;color:var(--danger)">${esc(r.source)}</td>
        <td style="padding:5px 4px;text-align:center;color:var(--text-muted)">→</td>
        <td style="padding:5px 8px;font-weight:600">${esc(r.target)}</td>
        <td style="padding:5px 8px;text-align:right;color:var(--text-muted)">${r.devices_affected}</td>
      </tr>`).join('');
  } catch(e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="color:var(--danger);padding:6px 8px">Błąd ładowania historii</td></tr>`;
    if (table) table.style.display = '';
    if (empty) empty.style.display = 'none';
  }
}

// ── Firms list ──────────────────────────────────────────────────────────────
let _firmsListData = [];

async function loadFirmsList() {
  const wrap = document.getElementById('firmsListWrap');
  if (!wrap) return;
  try {
    const d = await (await fetch(`${API}/firms/stats`)).json();
    _firmsListData = d.firms || [];
    renderFirmsList('');
  } catch(e) {
    wrap.innerHTML = `<span style="color:var(--danger);font-size:12px">Błąd ładowania</span>`;
  }
}

function renderFirmsList(filter) {
  const wrap = document.getElementById('firmsListWrap');
  if (!wrap) return;
  const q = filter.toLowerCase().trim();
  const rows = q ? _firmsListData.filter(f => f.firma.toLowerCase().includes(q)) : _firmsListData;
  if (!rows.length) {
    wrap.innerHTML = `<span style="color:var(--text-muted);font-size:12px">Brak wyników.</span>`;
    return;
  }
  wrap.innerHTML = `<table style="width:100%;font-size:12px;border-collapse:collapse">
    <thead><tr style="color:var(--text-muted);border-bottom:1px solid var(--border-light)">
      <th style="text-align:left;padding:4px 8px;font-weight:500">Firma</th>
      <th style="text-align:right;padding:4px 8px;font-weight:500">Urządzeń</th>
    </tr></thead>
    <tbody>${rows.map(f => `
      <tr style="border-bottom:1px solid var(--border-light)">
        <td style="padding:5px 8px">${esc(f.firma)}</td>
        <td style="padding:5px 8px;text-align:right;color:var(--text-muted)">${f.devices}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  <div style="margin-top:6px;font-size:11px;color:var(--text-muted)">
    Łącznie: ${rows.length} firm, ${rows.reduce((s,f)=>s+f.devices,0)} urządzeń
  </div>`;
}
