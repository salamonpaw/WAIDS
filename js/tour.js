// ── WAIDS — przewodnik po aplikacji (driver.js) ────────────────────────────
// Tura dla każdej zakładki, odpalana automatycznie przy pierwszym wejściu
// (zapamiętane w localStorage, nie powtarza się) + ręcznie przyciskiem „❓ Pomoc”
// w nagłówku dla aktualnie otwartej zakładki.
//
// Treść kroków (selektor/tytuł/opis) jest pobierana z backendu (GET /tours) —
// edytowalna w Konfiguracja → Przewodnik (tylko Admin), nie na sztywno w kodzie.
//
// Elementy spoza DOM bieżącej zakładki są pomijane (np. gdy użytkownik nie ma
// uprawnienia do panelu admina) — _driverSteps() filtruje po querySelector
// i offsetParent (widoczność).

let _currentTabName  = 'import';
let _tourStepsCache  = null;    // {tab_name: [{id, selector, title, description}, ...]}
let _tourLoadPromise = null;

function _ensureToursLoaded() {
  if (_tourStepsCache) return Promise.resolve(_tourStepsCache);
  if (_tourLoadPromise) return _tourLoadPromise;
  _tourLoadPromise = fetch(`${API}/tours`)
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(d => { _tourStepsCache = d; return d; })
    .catch(() => {
      // NIE zapisujemy porażki do _tourStepsCache — np. przejściowy błąd sieci
      // albo backend jeszcze wstaje po restarcie (deploy.sh czeka na niego do 60s).
      // Gdyby zapisać {}, to jest "prawdziwe" (truthy) i funkcja nigdy więcej nie
      // spróbuje ponownie w tej sesji przeglądarki — tura zostałaby wyłączona do
      // ręcznego przeładowania strony. Zamiast tego oddajemy pustą turę TERAZ,
      // ale kolejne wywołanie (następna zakładka, kolejna próba) spróbuje od nowa.
      return {};
    })
    .finally(() => { _tourLoadPromise = null; });
  return _tourLoadPromise;
}

function invalidateTourCache() { _tourStepsCache = null; _tourLoadPromise = null; }

function _driverSteps(tabName) {
  const scope = document.getElementById('tab-' + tabName);
  if (!scope || !_tourStepsCache) return [];
  const steps = _tourStepsCache[tabName] || [];
  // Selektory jak '.section-title' czy 'h2' powtarzają się na wielu zakładkach —
  // szukamy TYLKO wewnątrz panelu tej zakładki (scope.querySelector, nie document),
  // i przekazujemy do driver.js już rozwiązany element, nie string selektora.
  // Pomija kroki których element nie istnieje, jest ukryty (display:none — np. panel
  // admina widoczny tylko dla is_admin), LUB ma nieprawidłowy selektor — treść jest
  // teraz edytowalna przez Admina, więc błędny selektor nie może wysypać całej tury.
  const out = [];
  for (const s of steps) {
    let el = null;
    try { el = scope.querySelector(s.selector); } catch { /* nieprawidłowy selektor — pomiń */ }
    if (el && el.offsetParent !== null) {
      out.push({ element: el, popover: { title: s.title, description: s.description } });
    }
  }
  return out;
}

async function startTour(tabName, interactive) {
  if (typeof driver === 'undefined') return;   // CDN nie wczytał się (np. brak internetu)
  await _ensureToursLoaded();
  const steps = _driverSteps(tabName);
  if (!steps.length) {
    if (interactive) alert('Brak jeszcze kroków przewodnika dla tej zakładki — dodaj je w Konfiguracja → Przewodnik.');
    return;
  }
  const driverObj = driver.js.driver({
    showProgress: true,
    nextBtnText: 'Dalej →',
    prevBtnText: '← Wstecz',
    doneBtnText: 'Gotowe',
    progressText: '{{current}} / {{total}}',
    steps,
  });
  driverObj.drive();
}

function startTourForCurrentTab() {
  startTour(_currentTabName, true);
}

let _suppressAutoTour = false;   // patrz pickTourStepElement() — switchTab() programowy w trakcie wskazywania elementu nie powinien odpalać prawdziwej tury ani oznaczać jej jako "widzianą"

async function maybeAutoStartTour(tabName) {
  _currentTabName = tabName;
  if (_suppressAutoTour) return;
  const key = 'waids_tour_seen_' + tabName;
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, '1');
  await _ensureToursLoaded();
  // Mały odstęp — niech zakładka zdąży się pokazać (animacje/layout) zanim driver.js
  // zmierzy pozycje elementów.
  setTimeout(() => startTour(tabName), 400);
}

// ══════════════════════════════════════════════════════════════════════════
// Edytor przewodnika (Konfiguracja → Przewodnik, tylko Admin)
// ══════════════════════════════════════════════════════════════════════════

const TOUR_TAB_LABELS = {
  import: '⬆ Import', report: '📊 Raport', monitor: '📈 Monitoring',
  firstpay: '🆕 Nowe płatności', device: '🔍 Urządzenie', revenue: '💰 Wyliczenia',
  bonus: '🆕 Pierwsze IDS', commissions: '💸 Prowizje', pricing: '📈 Pricing',
  segmentation: '🎯 Segmentacja', arrears: '⚠ Zaległości', sales: '📦 Zakupy',
  config: '⚙ Konfiguracja',
};

let _tourAdminTab   = 'import';   // którą zakładkę edytujemy w panelu admina
let _tourEditingId  = null;       // id kroku w modalu (null = nowy)
let _tourReturnTab  = null;       // zakładka do której wrócić po trybie "wskaż element"

function initTourAdminPanel() {
  const section = document.getElementById('tourAdminSection');
  if (section) section.style.display = 'block';
  const sel = document.getElementById('tourAdminTabSelect');
  if (sel && !sel.options.length) {
    sel.innerHTML = Object.entries(TOUR_TAB_LABELS)
      .map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    sel.value = _tourAdminTab;
  }
  renderTourAdminList();
}

async function onTourAdminTabChange() {
  _tourAdminTab = document.getElementById('tourAdminTabSelect').value;
  renderTourAdminList();
}

async function renderTourAdminList() {
  const tbody = document.getElementById('tourAdminListBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">⏳</td></tr>';
  invalidateTourCache();
  await _ensureToursLoaded();
  const steps = (_tourStepsCache && _tourStepsCache[_tourAdminTab]) || [];
  if (!steps.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:1rem">Brak kroków — dodaj pierwszy.</td></tr>';
    return;
  }
  tbody.innerHTML = steps.map((s, i) => `<tr>
    <td style="font-size:11px;font-family:monospace;color:var(--text-muted)">${esc(s.selector)}</td>
    <td><b>${esc(s.title)}</b></td>
    <td style="font-size:12px;color:var(--text-muted);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.description)}</td>
    <td style="white-space:nowrap">
      <button class="ghost sm" onclick="moveTourStep(${i},-1)" ${i === 0 ? 'disabled' : ''} title="Przesuń wyżej">↑</button>
      <button class="ghost sm" onclick="moveTourStep(${i},1)" ${i === steps.length - 1 ? 'disabled' : ''} title="Przesuń niżej">↓</button>
      <button class="ghost sm" onclick="openTourStepModal(${s.id})">✏</button>
      <button class="ghost sm" onclick="deleteTourStepRow(${s.id})">✕</button>
    </td>
  </tr>`).join('');
}

let _tourMoveBusy = false;   // blokuje kolejny klik ↑/↓ dopóki poprzedni nie dokończy roundtripu

async function moveTourStep(index, dir) {
  if (_tourMoveBusy) return;   // dwa szybkie kliki liczone z tej samej (nieodświeżonej) tablicy nadpisałyby się wzajemnie
  _tourMoveBusy = true;
  try {
    const steps = [..._tourStepsCache[_tourAdminTab]];
    const j = index + dir;
    if (j < 0 || j >= steps.length) return;
    [steps[index], steps[j]] = [steps[j], steps[index]];
    const orderedIds = steps.map(s => s.id);
    const r = await fetch(`${API}/tours/${_tourAdminTab}/reorder`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ordered_ids: orderedIds }),
    });
    if (!r.ok) throw new Error((await r.json()).detail || 'Błąd zmiany kolejności');
    await renderTourAdminList();
  } catch (e) {
    alert('Błąd: ' + e.message);
  } finally {
    _tourMoveBusy = false;
  }
}

function openTourStepModal(id) {
  const modal = document.getElementById('tourStepModal');
  document.getElementById('tourStepModalMsg').textContent = '';
  _tourEditingId = id || null;
  if (id) {
    const s = ((_tourStepsCache && _tourStepsCache[_tourAdminTab]) || []).find(x => x.id === id);
    if (!s) return;
    document.getElementById('tourStepModalTitle').textContent = 'Edytuj krok';
    document.getElementById('tourStepSelector').value    = s.selector;
    document.getElementById('tourStepTitle').value        = s.title;
    document.getElementById('tourStepDescription').value  = s.description;
  } else {
    document.getElementById('tourStepModalTitle').textContent = 'Nowy krok';
    document.getElementById('tourStepSelector').value    = '';
    document.getElementById('tourStepTitle').value        = '';
    document.getElementById('tourStepDescription').value  = '';
  }
  modal.showModal();
}

async function saveTourStep() {
  const selector    = document.getElementById('tourStepSelector').value.trim();
  const title       = document.getElementById('tourStepTitle').value.trim();
  const description = document.getElementById('tourStepDescription').value.trim();
  const msgEl = document.getElementById('tourStepModalMsg');
  if (!selector || !title) { msgEl.textContent = 'Podaj selektor i tytuł.'; msgEl.className = 'msg err'; return; }
  try {
    const url    = _tourEditingId ? `${API}/tours/steps/${_tourEditingId}` : `${API}/tours/${_tourAdminTab}/steps`;
    const method = _tourEditingId ? 'PATCH' : 'POST';
    const r = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector, title, description }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || 'Błąd zapisu');
    document.getElementById('tourStepModal').close();
    await renderTourAdminList();
  } catch (e) {
    msgEl.textContent = '❌ ' + e.message; msgEl.className = 'msg err';
  }
}

async function deleteTourStepRow(id) {
  if (!confirm('Usunąć ten krok przewodnika?')) return;
  try {
    const r = await fetch(`${API}/tours/steps/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json()).detail || 'Błąd usuwania');
    await renderTourAdminList();
  } catch (e) { alert('Błąd: ' + e.message); }
}

// ── "Wskaż element" — tryb wyboru selektora klikiem na prawdziwym ekranie ──

function _computeSelector(el, scope) {
  if (el.id) return '#' + CSS.escape(el.id);
  for (const cls of el.classList) {
    const sel = '.' + CSS.escape(cls);
    try { if (scope.querySelectorAll(sel).length === 1) return sel; } catch { /* ignoruj */ }
  }
  let path = [];
  let node = el;
  while (node && node !== scope && node.nodeType === 1 && node !== document.body) {
    let part = node.tagName.toLowerCase();
    if (node.id) { path.unshift('#' + CSS.escape(node.id)); break; }
    const parent = node.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    }
    path.unshift(part);
    const candidate = path.join(' > ');
    try { if (scope.querySelectorAll(candidate).length === 1) return candidate; } catch { /* ignoruj */ }
    node = parent;
  }
  return path.join(' > ') || el.tagName.toLowerCase();
}

function pickTourStepElement() {
  const scope = document.getElementById('tab-' + _tourAdminTab);
  if (!scope) { alert('Nieznana zakładka.'); return; }

  document.getElementById('tourStepModal').close();
  _tourReturnTab = 'config';
  _suppressAutoTour = true;
  switchTab(_tourAdminTab, true);

  const banner = document.createElement('div');
  banner.id = 'tourPickerBanner';
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#1F77B4;' +
    'color:#fff;text-align:center;padding:8px 16px;font-size:13px;font-weight:600;' +
    'box-shadow:0 2px 8px rgba(0,0,0,.3)';
  banner.textContent = '🎯 Kliknij element, który ma być podświetlony w tym kroku — Esc, żeby anulować';
  document.body.appendChild(banner);

  const hl = document.createElement('div');
  hl.id = 'tourPickerHighlight';
  hl.style.cssText = 'position:fixed;pointer-events:none;z-index:99998;border:2px solid #1F77B4;' +
    'background:rgba(31,119,180,.15);border-radius:4px;display:none';
  document.body.appendChild(hl);

  function elAt(e) {
    hl.style.display = 'none';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    hl.style.display = 'block';
    return el;
  }
  function onMove(e) {
    const el = elAt(e);
    if (!el || el === banner) { hl.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    hl.style.left = r.left + 'px'; hl.style.top = r.top + 'px';
    hl.style.width = r.width + 'px'; hl.style.height = r.height + 'px';
  }
  function finish(selector) {
    cleanup();
    switchTab(_tourReturnTab, true);
    _suppressAutoTour = false;   // koniec roundtripu — dalsze zwykłe przełączenia zakładek znów normalne
    // Celowo NIE wołamy tu openTourStepModal(_tourEditingId) ponownie — dwa powody:
    // 1) wyzerowałoby tytuł/opis, które admin już wpisał przed kliknięciem "Wskaż",
    //    bo dla nowego kroku (id=null) ta funkcja czyści formularz od zera;
    // 2) switchTab() wyżej odpala initTourAdminPanel() -> renderTourAdminList(),
    //    która asynchronicznie invaliduje i na nowo ładuje _tourStepsCache — więc
    //    w tym miejscu cache bywa chwilowo `null`, a openTourStepModal(id) dla
    //    EDYTOWANEGO kroku rzuciłby wyjątkiem na _tourStepsCache[_tourAdminTab].
    // .close() nie czyści wartości pól — ten sam dialog po prostu pokazujemy
    // ponownie z tym, co w nim już było, i dopisujemy tylko selektor. Komunikat
    // błędu z ewentualnej wcześniejszej nieudanej próby zapisu czyścimy ręcznie —
    // openTourStepModal() robi to normalnie, ale celowo go tu nie wołamy (wyżej).
    document.getElementById('tourStepModalMsg').textContent = '';
    document.getElementById('tourStepModal').showModal();
    if (selector) document.getElementById('tourStepSelector').value = selector;
  }
  function onClick(e) {
    e.preventDefault(); e.stopPropagation();
    const el = elAt(e);
    if (!el || el === banner) return;
    if (!scope.contains(el)) {
      // np. nagłówek appki czy przycisk "❓ Pomoc" nad paskiem — selektor liczony
      // względem scope i tak by się tam nigdy nie dopasował, więc nie przyjmujemy
      // kliknięcia, tylko prosimy o inne (bez przerywania trybu wskazywania).
      const prev = banner.textContent;
      banner.textContent = '⚠️ To poza tą zakładką — kliknij element wewnątrz jej zawartości.';
      setTimeout(() => { banner.textContent = prev; }, 1500);
      return;
    }
    finish(_computeSelector(el, scope));
  }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); finish(null); } }
  function cleanup() {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    banner.remove(); hl.remove();
  }

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
}
