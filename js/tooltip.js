// ── WAIDS — global ⓘ info tooltip ─────────────────────────────────────────
// Tooltip div (#infoTooltipPopup) is at the very end of <body> and is
// available when this script runs (scripts are at the end of <body>).
// Strategy: mouseover on any element — if it's an .info-icon show tooltip,
// otherwise hide it.  No mouseout needed (avoids false-fires on subpixel moves).
(function () {
  function tip() { return document.getElementById('infoTooltipPopup'); }

  function show(t, icon, e) {
    t.textContent = icon.dataset.info || '';
    position(t, e);
    t.classList.add('visible');
  }
  function hide(t) { t.classList.remove('visible'); }

  function position(t, e) {
    // Force a layout pass so offsetWidth/Height are accurate
    t.style.visibility = 'hidden';
    t.style.display    = 'block';
    const tw = t.offsetWidth  || 320;
    const th = t.offsetHeight || 100;
    t.style.visibility = '';
    t.style.display    = '';

    const margin = 14;
    let x = e.clientX + margin;
    let y = e.clientY + margin;
    if (x + tw > window.innerWidth  - 8) x = e.clientX - tw - margin;
    if (y + th > window.innerHeight - 8) y = e.clientY - th - margin;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    t.style.left = x + 'px';
    t.style.top  = y + 'px';
  }

  document.addEventListener('mouseover', e => {
    const t = tip(); if (!t) return;
    const icon = e.target.closest('.info-icon');
    if (icon) show(t, icon, e);
    else hide(t);
  });
  document.addEventListener('mousemove', e => {
    const t = tip();
    if (t && t.classList.contains('visible')) position(t, e);
  });
})();
