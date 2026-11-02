// ── WAIDS — authentication ────────────────────────────────────────────────

let currentUser = null;

// Intercept all API fetches to add token and handle 401
const _origFetch = window.fetch.bind(window);
window.fetch = async (url, opts = {}) => {
  const isAPI   = typeof url === 'string' && url.startsWith(API);
  const isLogin = isAPI && url.includes('/auth/login');
  if (isAPI && !isLogin) {
    const tok = localStorage.getItem('waids_token');
    if (tok) opts = { ...opts, headers: { ...(opts.headers||{}), 'Authorization': 'Bearer '+tok } };
  }
  const resp = await _origFetch(url, opts);
  if (resp.status === 401 && isAPI && !isLogin) {
    localStorage.removeItem('waids_token');
    currentUser = null;
    showLoginOverlay('Sesja wygasła — zaloguj się ponownie.');
  }
  return resp;
};

function showLoginOverlay(msg) {
  document.getElementById('loginOverlay').style.display = 'flex';
  document.getElementById('appBody').style.display = 'none';
  if (msg) {
    const el = document.getElementById('loginError');
    el.textContent = msg; el.style.display = 'block';
  }
}

function hideLoginOverlay() {
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('appBody').style.display = 'block';
}

async function doLogin() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl    = document.getElementById('loginError');
  errEl.style.display = 'none';
  if (!email || !password) { errEl.textContent='Podaj email i hasło.'; errEl.style.display='block'; return; }
  try {
    const r = await _origFetch(`${API}/auth/login`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({email, password}),
    });
    if (r.status >= 502 && r.status <= 504) { showServerDiagnostics(`Serwer API niedostępny (${r.status})`); return; }
    let d;
    try { d = await r.json(); }
    catch { showServerDiagnostics(`Nieprawidłowa odpowiedź serwera (${r.status})`); return; }
    if (!r.ok) throw new Error(d.detail || r.statusText);
    localStorage.setItem('waids_token', d.token);
    currentUser = d;
    document.getElementById('loginPassword').value = '';
    hideLoginOverlay();
    const uname = document.getElementById('userName');
    const uinfo = document.getElementById('userInfo');
    if (uname) uname.textContent = '👤 ' + (d.name || d.email);
    if (uinfo) uinfo.style.display = 'flex';
    refreshStatus();
    applyAdminTabs();
    if (d.is_admin) loadAdminUsers();
  } catch(e) {
    if (e instanceof TypeError) { showServerDiagnostics('Brak połączenia z serwerem'); return; }
    errEl.textContent = e.message; errEl.style.display = 'block';
  }
}

// ── Diagnostyka awarii (health.json generowany na VM przez ops/waids_health.py) ──

function _ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 90)    return `${Math.round(s)} s temu`;
  if (s < 5400)  return `${Math.round(s / 60)} min temu`;
  if (s < 172800) return `${Math.round(s / 3600)} godz. temu`;
  return `${Math.round(s / 86400)} dni temu`;
}

function _esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function _diagnose(h) {
  const out = [];   // [poziom, tekst]  poziom: bad | warn | ok
  const age = (Date.now() - new Date(h.generated_at)) / 1000;
  if (age > 180) out.push(['bad', `Diagnostyka nieaktualna (ostatnio ${_ago(h.generated_at)}) — VM lub cron nie działa`]);
  if (h.uptime_s < 3600) out.push(['warn', `VM uruchomiona ${_ago(h.boot_time)} — był restart (np. awaria zasilania / IT)`]);
  if (h.deploy_in_progress) out.push(['warn', 'Trwa wdrożenie (deploy.sh) — poczekaj kilka minut']);
  if (!h.docker?.active) out.push(['bad', `Usługa Docker nie działa (${_esc(h.docker?.status)})`]);
  const label = { waids_db: 'Baza danych (waids_db)', waids_backend: 'Backend (waids_backend)' };
  for (const c of h.containers || []) {
    const n = label[c.name] || c.name;
    if (!c.exists) { out.push(['bad', `${n}: kontener nie istnieje`]); continue; }
    if (c.running) {
      if (c.restart_count > 0) out.push(['warn', `${n}: działa, ale restartował się ${c.restart_count}×`]);
      continue;
    }
    let t = `${n}: ${_esc(c.status)}`;
    if (c.status === 'exited') t += ` (kod ${c.exit_code}) ${_ago(c.finished_at)}`;
    if (c.error) t += ` — ${_esc(c.error)}`;
    out.push(['bad', t]);
  }
  if (h.docker?.active && (h.containers || []).every(c => c.running) && !h.backend_http?.ok)
    out.push(['bad', 'Kontenery działają, ale backend nie odpowiada (może jeszcze startuje lub błąd w aplikacji)']);
  if (h.last_heal) out.push([h.last_heal.ok ? 'ok' : 'bad',
    `Automatyczna naprawa ${_ago(h.last_heal.at)}: ${h.last_heal.ok ? 'OK' : 'nieudana'}`]);
  if (h.disk?.free_gb < 2) out.push(['bad', `Mało miejsca na dysku: ${h.disk.free_gb} GB wolne`]);
  if (!out.some(([lvl]) => lvl === 'bad')) out.push(['ok', 'Wg diagnostyki VM wszystko działa — odśwież stronę za chwilę']);
  return out;
}

async function showServerDiagnostics(title) {
  const errEl = document.getElementById('loginError');
  errEl.style.display = 'block';
  errEl.innerHTML = `<b>⚠️ ${_esc(title)}</b><div style="margin-top:4px">Sprawdzam diagnostykę serwera…</div>`;
  let h = null;
  try {
    const r = await _origFetch(`/health.json?t=${Date.now()}`, { cache: 'no-store' });
    if (r.ok) h = await r.json();
  } catch {}
  if (!h || !h.generated_at) {
    errEl.innerHTML = `<b>⚠️ ${_esc(title)}</b><div style="margin-top:4px">` +
      (title.startsWith('Brak połączenia')
        ? 'VM wyłączona lub problem z siecią.'
        : 'Brak pliku diagnostycznego — uruchom <code>sudo ./deploy.sh</code> na VM.') + '</div>';
    return;
  }
  const icon = { bad: '❌', warn: '⚠️', ok: '✅' };
  const items = _diagnose(h).map(([lvl, t]) => `<li>${icon[lvl]} ${t}</li>`).join('');
  const logs = Object.entries(h.logs || {}).map(([n, l]) =>
    `<div style="font-weight:600;margin-top:6px">${_esc(n)}</div>` +
    `<pre style="white-space:pre-wrap;word-break:break-all;max-height:180px;overflow:auto;margin:2px 0 0;
                 font-size:10px;background:rgba(0,0,0,.05);padding:4px;border-radius:4px">${_esc(l) || '(brak)'}</pre>`
  ).join('');
  errEl.innerHTML =
    `<b>⚠️ ${_esc(title)}</b>` +
    `<ul style="margin:6px 0 0;padding-left:2px;list-style:none;display:flex;flex-direction:column;gap:3px">${items}</ul>` +
    `<div style="margin-top:6px;color:var(--text-muted);font-size:11px">${_esc(h.hostname)} · diagnostyka ${_ago(h.generated_at)}</div>` +
    `<details style="margin-top:4px;font-size:11px"><summary style="cursor:pointer">Szczegóły techniczne (logi)</summary>${logs}</details>`;
}

function doLogout() {
  localStorage.removeItem('waids_token');
  currentUser = null;
  applyAdminTabs();
  const uinfo = document.getElementById('userInfo');
  if (uinfo) uinfo.style.display = 'none';
  showLoginOverlay();
}

// On page load — check existing token
async function _initAuth() {
  const tok = localStorage.getItem('waids_token');
  if (tok) {
    try {
      const r = await _origFetch(`${API}/auth/me`, {
        headers: {'Authorization': 'Bearer ' + tok}
      });
      if (r.ok) {
        currentUser = await r.json();
        const uname = document.getElementById('userName');
        const uinfo = document.getElementById('userInfo');
        if (uname) uname.textContent = '👤 ' + (currentUser.name || currentUser.email);
        if (uinfo) uinfo.style.display = 'flex';
        hideLoginOverlay();
        refreshStatus();
        applyAdminTabs();
        if (currentUser.is_admin) loadAdminUsers();
        return;
      }
      if (r.status >= 500) {   // awaria serwera — nie wylogowuj, pokaż przyczynę
        showLoginOverlay();
        showServerDiagnostics(`Serwer API niedostępny (${r.status})`);
        return;
      }
    } catch {
      showLoginOverlay();
      showServerDiagnostics('Brak połączenia z serwerem');
      return;
    }
    localStorage.removeItem('waids_token');
  }
  showLoginOverlay();
}

// Scripts are at end of body — DOM is fully built, call directly
_initAuth();
