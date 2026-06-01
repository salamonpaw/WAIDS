// ── WAIDS — app shell: tab switching, status bar, changelog ──────────────

// ── Tab switching ──────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  event.currentTarget.classList.add('active');
  if (name === 'report')   loadReport();
  if (name === 'monitor')  loadMonitoringTab();
  if (name === 'firstpay') loadFirstPayTab();
  if (name === 'device')   { /* data loaded on demand via searchBySN() */ }
  if (name === 'revenue')  { loadRevenue(); loadSeasonality(); }
  if (name === 'config')   { loadConfig(); loadLicenseFees(); }
}

// ── DB status bar ──────────────────────────────────────────────────────────
async function refreshStatus() {
  // Fetch app version (fire-and-forget)
  fetch(`${API}/version`).then(r => r.ok ? r.json() : null).then(d => {
    if (d?.version) {
      const el = document.getElementById('appVersion');
      if (el) el.textContent = 'v' + d.version;
    }
  }).catch(() => {});
  // Fetch DB status
  try {
    const r = await fetch(`${API}/status`);
    if (!r.ok) throw 0;
    const d = await r.json();
    document.getElementById('dbDot').className = 'db-dot green';
    document.getElementById('dbDevices').textContent = `${d.devices} urządzeń w bazie`;
    const mp = document.getElementById('dbMonthsPill');
    if (d.months.length) {
      mp.style.display = 'flex';
      const range = d.months.length > 1
        ? `${d.months[0]} — ${d.months[d.months.length-1]} (${d.months.length} mies.)`
        : d.months[0];
      document.getElementById('dbMonths').textContent = '📅 ' + range;
    } else { mp.style.display = 'none'; }
  } catch {
    document.getElementById('dbDot').className = 'db-dot red';
    document.getElementById('dbDevices').textContent = 'Brak połączenia z API';
  }
}

// ── Changelog modal ────────────────────────────────────────────────────────
let _changelogLoaded = false;

async function showChangelog() {
  document.getElementById('changelogModal').showModal();
  if (_changelogLoaded) return;
  const pre = document.getElementById('changelogContent');
  pre.textContent = '⏳ Ładowanie…';
  try {
    const d = await (await fetch(`${API}/changelog`)).json();
    pre.textContent = d.content || 'Brak danych.';
    _changelogLoaded = true;
  } catch(e) { pre.textContent = '❌ Nie można załadować: '+e.message; }
}
