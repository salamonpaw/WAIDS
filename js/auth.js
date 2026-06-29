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
    const d = await r.json();
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
    errEl.textContent = e.message; errEl.style.display = 'block';
  }
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
    } catch {}
    localStorage.removeItem('waids_token');
  }
  showLoginOverlay();
}

// Scripts are at end of body — DOM is fully built, call directly
_initAuth();
