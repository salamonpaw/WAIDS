// ── WAIDS — shared globals and utility functions ──────────────────────────
// Loaded first; all other modules depend on this.

const API = '/api';

// ── Global mutable state ──────────────────────────────────────────────────
let results     = [];
let filtered    = [];
let currentPage = 1;
let pageSize    = 100;
let selectedSNs = new Set();   // for bulk selection
let allFirms    = [];

// ── String escaping ───────────────────────────────────────────────────────
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ── Date formatting ───────────────────────────────────────────────────────
// YYYY-MM-DD → "DD.MM.YYYY"  |  YYYY-MM → "MM.YYYY"  |  '' → '—'
function fmtDate(d) {
  if (!d || d === '') return '—';
  const s = String(d);
  if (s.length >= 10 && s[4] === '-' && s[7] === '-') {
    const [y, mo, dy] = s.slice(0,10).split('-');
    return `${dy}.${mo}.${y}`;
  }
  if (s.length >= 7 && s[4] === '-') {
    const [y, mo] = s.slice(0,7).split('-');
    return `${mo}.${y}`;
  }
  return s.slice(0,7);
}

// ── Message display ───────────────────────────────────────────────────────
function setMsg(id, text, type='') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'msg' + (type ? ' '+type : '');
}

// ── Status / device-type labels ───────────────────────────────────────────
const STATUS_LABELS = {
  paid:'Opłacone', unpaid:'Brak opłaty',
  only:'Brak w prod.', excluded:'Wykluczone',
  showroom:'Showroom', oem:'OEM',
  licencja:'Licencja', inne:'Inne',
  suspended:'Zawieszone', stare:'Stare'
};
const DT_LABELS = { master:'Master', oem:'OEM', showroom:'Showroom', stare:'Stare', problematyczne:'Problematyczne', wycofany:'Wycofany' };

function statusBadge(s, isSuspended) {
  if (isSuspended) return `<span class="badge suspended">⏸ Zawieszone</span>`;
  return `<span class="badge ${s}">${STATUS_LABELS[s]||s}</span>`;
}

// ── Rep color chips ───────────────────────────────────────────────────────
const REP_PALETTE = [
  '#2563EB','#16a34a','#dc2626','#9333ea',
  '#d97706','#0891b2','#db2777','#059669','#7c3aed','#b45309',
];

let repColorMap = {}; // name → { color, initials }

function getInitials(name) {
  if (!name) return '?';
  const parts = name.split(/[\s\-]+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return parts.map(p => p[0].toUpperCase()).join('');
}

function buildRepColorMap(repSet) {
  repColorMap = {};
  [...repSet].sort().forEach((name, i) => {
    repColorMap[name] = {
      color:    REP_PALETTE[i % REP_PALETTE.length],
      initials: getInitials(name),
    };
  });
}

function repChip(name) {
  const info = repColorMap[name];
  if (!info) return `<span style="font-size:11px;color:var(--text-muted)">${esc(name)}</span>`;
  const c = info.color;
  return `<span class="rep-chip" style="background:${c}22;color:${c};border:1px solid ${c}55" title="${esc(name)}">${esc(info.initials)}</span>`;
}

function repChips(handlowcy) {
  if (!handlowcy) return '<span style="color:var(--text-muted)">—</span>';
  const names = handlowcy.split(', ').map(s => s.trim()).filter(Boolean);
  return names.map(repChip).join(' ');
}

function renderRepLegend() {
  const el = document.getElementById('repLegend');
  if (!el) return;
  const entries = Object.entries(repColorMap).sort((a,b) => a[0].localeCompare(b[0]));
  if (!entries.length) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.innerHTML = entries.map(([name, info]) => {
    const c = info.color;
    return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted)">
      <span class="rep-chip" style="background:${c}22;color:${c};border:1px solid ${c}55">${esc(info.initials)}</span>
      <span>${esc(name)}</span>
    </span>`;
  }).join('');
}

// ── Device type badge ─────────────────────────────────────────────────────
// dt = computed type, override = raw override value ('' = auto), showroomUntil = YYYY-MM
function dtBadge(dt, sn, override, showroomUntil='', isSuspended=false) {
  if (!dt) return '—';
  const suspBadge = isSuspended
    ? `<span class="dt-badge suspended" data-action="open-override" data-sn="${esc(sn)}" title="Zawieszenie opłat aktywne. Kliknij aby zarządzać.">⏸</span> `
    : '';
  if (dt === 'showroom') {
    const expired = showroomUntil && showroomUntil < nowYM();
    const cls = 'dt-badge showroom override-set' + (expired ? ' expired' : '');
    const untilTxt = showroomUntil ? ` do ${showroomUntil}` : '';
    const expiredTxt = expired ? ' ⚠ wygasł!' : '';
    const tip = `title="Showroom${untilTxt}${expiredTxt}. Kliknij aby zmienić."`;
    return suspBadge + `<span class="${cls}" data-action="open-override" data-sn="${esc(sn)}" ${tip}>🏪${untilTxt}${expiredTxt} ✏</span>`;
  }
  const cls  = override ? 'dt-badge ' + dt + ' override-set' : 'dt-badge ' + dt;
  const icon = override ? ' ✏' : ' ✎';
  const tip  = override
    ? `title="Ręcznie: ${DT_LABELS[override]||override}. Kliknij aby zmienić."`
    : `title="Auto-wykryty. Kliknij aby nadpisać."`;
  return suspBadge + `<span class="${cls}" data-action="open-override" data-sn="${esc(sn)}" ${tip}>${DT_LABELS[dt]||dt}${icon}</span>`;
}

// ── Summary computation ───────────────────────────────────────────────────
function computeSummary(data) {
  let paid=0, unpaid=0, only=0, excluded=0, oem=0, showroom=0, masterPaid=0, suspended=0, stare=0, problematyczne=0, wycofany=0;
  for (const r of data) {
    if (r.is_suspended)                    { suspended++;      continue; }
    if (r.status === 'stare')              { stare++;          continue; }
    if (r.status === 'problematyczne')     { problematyczne++; continue; }
    if (r.status === 'wycofany')           { wycofany++;       continue; }
    if      (r.status==='paid')     { paid++;     if (r.device_type==='master') masterPaid++; }
    else if (r.status==='unpaid')   unpaid++;
    else if (r.status==='only')     only++;
    else if (r.status==='excluded') excluded++;
    else if (r.status==='oem')      oem++;
    else if (r.status==='showroom') showroom++;
  }
  const noBill = oem + excluded + showroom;
  const pct = (masterPaid+unpaid) > 0 ? Math.round(masterPaid/(masterPaid+unpaid)*100) : 0;
  return { total:data.length, paid, unpaid, only, excluded, oem, showroom, suspended, stare, problematyczne, wycofany, noBill, masterPaid, pct };
}

function updateKpis(s) {
  document.getElementById('kpiTotal').textContent  = s.total;
  document.getElementById('kpiPaid').textContent   = s.paid;
  document.getElementById('kpiUnpaid').textContent = s.unpaid;
  document.getElementById('kpiNoBill').textContent = s.noBill;
  document.getElementById('kpiPct').textContent    = s.pct + '%';
}

// ── Date/time helpers ─────────────────────────────────────────────────────
function monthsDiff(fromYM, toYM) {
  if (!fromYM || !toYM) return null;
  const [fy, fm] = String(fromYM).slice(0,7).split('-').map(Number);
  const [ty, tm] = String(toYM).slice(0,7).split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

function nowYM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

// ── Currency formatters ───────────────────────────────────────────────────
function fmtAmount(amount, currency) {
  if (!amount || amount === 0) return '—';
  const fmt = new Intl.NumberFormat('pl-PL', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const sym = (!currency || currency === 'PLN') ? ' zł' : ` ${currency}`;
  return fmt.format(amount) + sym;
}

function fmtPLN(v) {
  if (!v) return '0 zł';
  return new Intl.NumberFormat('pl-PL', { style:'currency', currency:'PLN', maximumFractionDigits:0 }).format(v);
}
function fmtEUR(v) {
  if (!v) return '0 €';
  return new Intl.NumberFormat('pl-PL', { style:'currency', currency:'EUR', maximumFractionDigits:0 }).format(v);
}
function fmtNum(v) {
  return new Intl.NumberFormat('pl-PL', { maximumFractionDigits:0 }).format(v || 0);
}
