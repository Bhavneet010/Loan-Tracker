import { S, saveSettings } from "./state.js";

// Import from new specialized modules
import { updateBadges, updateHero } from "./ui-stats.js";
import { renderPending, renderSanctioned, renderReturned } from "./ui-tabs-loans.js";
import { renderRenewals, updateRenewalMainContent } from "./ui-tabs-renewals.js";
import { renderTasks } from "./ui-tasks.js";
import { animateContent } from "./animate.js";
import { holidayReason, findCustomHoliday } from "./bank-holidays.js";

let renderQueued = false;

export function render() {
  document.body.classList.toggle('tasks-mode', S.appMode === 'tasks');
  document.body.classList.toggle('fresh-mode', S.appMode === 'fresh');
  document.body.classList.toggle('renewals-mode', S.appMode === 'renewals');
  if (!S.user) {
    if (typeof window.showUserSelect === 'function') window.showUserSelect();
    return;
  }
  updateHero();
  updateBadges();

  const sw = document.getElementById('searchWrap');
  if (sw) sw.style.display = S.appMode === 'fresh' ? '' : 'none';
  const c = document.getElementById('content');
  if (!c) return;

  renderCurrentContent(c);
}

function renderCurrentContent(c) {
  if (S.appMode === 'renewals') { renderRenewals(c); animateContent('renewals', S.renewalTab); return; }
  if (S.appMode === 'tasks') { renderTasks(c); animateContent('tasks', S.taskView); return; }

  if (S.tab === 'pending') renderPending(c);
  else if (S.tab === 'sanctioned') renderSanctioned(c);
  else if (S.tab === 'returned') renderReturned(c);
  animateContent('fresh', S.tab);
}

export function renderContentOnly() {
  if (!S.user) {
    if (typeof window.showUserSelect === 'function') window.showUserSelect();
    return;
  }
  const c = document.getElementById('content');
  if (!c) return;
  renderCurrentContent(c);
}

export function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

// Expose render globally so other modules can trigger refreshes without a circular import
window.render = render;
window.renderContentOnly = renderContentOnly;
window.scheduleRender = scheduleRender;

/* ── WINDOW ACTION WRAPPERS ── */
export const toggleFsMenu = function(which) { S.openPop = S.openPop === which ? null : which; render(); };
window.toggleFsMenu = toggleFsMenu;
window.setFilter = function(k, v) { S.filter[k] = v; render(); };
window.setSort = function(f, d) { if (f) S.sort.field = f; if (d) S.sort.dir = d; render(); };
window.setRenewalFilter = function(k, v) {
  S.renewalFilter[k] = S.renewalFilter[k] === v ? 'All' : v;
  if (k === 'status' && S.renewalFilter.status === 'DueSoon') {
    S.renewalTab = 'all';
    S.renewalView = 'list';
    S.calendarOpenDay = null;
  }
  render();
};
window.setRenewalSort = function(f, d) { if (f) S.renewalSort.field = f; if (d) S.renewalSort.dir = d; render(); };
window.setRenewalTab = function(t) {
  if (S.renewalTab === t && S.renewalView === 'list') return;
  S.renewalTab = t;
  S.renewalView = 'list';
  S.calendarOpenDay = null;
  S.openPop = null;
  updateHero();
  updateRenewalMainContent();
};
window.setRenewalOfficer = function(officer) {
  S.renewalFilter.officer = S.renewalFilter.officer === officer ? 'All' : officer;
  S.openPop = null;
  render();
};

window.toggleRenewalOfficers = function() {
  S.renewalOfficersExpanded = !S.renewalOfficersExpanded;
  render();
};

window.toggleRenewalNpa = function(show) {
  S.renewalShowNpa = !!show;
  render();
};

window.setRenewalView = function(v) {
  S.renewalView = v;
  S.openPop = null;
  if (v !== 'calendar') S.calendarOpenDay = null;
  render();
};
window.calendarNavMonth = function(delta) {
  if (!S.calendarState) return;
  let { year, month } = S.calendarState;
  month += delta;
  if (month > 11) { month = 0; year++; }
  if (month < 0)  { month = 11; year--; }
  S.calendarState = { year, month };
  render();
};
let _calNavTimer = null;

// Replaces only the calendar content pane — avoids full-page re-render
function refreshCalendarOnly() {
  const pane = document.querySelector('.rnw-content');
  if (!pane) { render(); return; }
  pane.innerHTML = buildCalendarViewHtml();
}

function slideCalMbar(bar, key) {
  if (!key || !bar) return false;
  const items = bar.querySelectorAll('.cal-mbar-item');
  let idx = -1;
  items.forEach((el, i) => { if (el.dataset.key === key) idx = i; });
  if (idx < 0) return false;
  bar.style.setProperty('--active-idx', idx);
  items.forEach((el, i) => el.classList.toggle('cal-mbar-item--active', i === idx));
  return true;
}

function applyCalMbarKey(bar, key) {
  if (!key) return;
  const [y, m] = key.split('-').map(Number);
  if (S.calendarState?.year === y && S.calendarState?.month === m - 1) return;
  if (!slideCalMbar(bar, key)) return;
  S.calendarState = { year: y, month: m - 1 };
  clearTimeout(_calNavTimer);
  _calNavTimer = setTimeout(refreshCalendarOnly, 310);
}

window.toggleCalMbarExpand = function() {
  if (!S.isAdmin) return;
  S.calendarBarExpanded = !S.calendarBarExpanded;
  render();
};

window.calendarNavToMonth = function(year, month) {
  S.calendarState = { year, month };
  render();
};

/* ── CALENDAR BAR DRAG-TO-SLIDE ── */
(function attachCalendarSliderDrag() {
  let dragStartX = null;
  let dragging = false;
  const THRESHOLD = 6;

  function getKeyAtX(bar, x) {
    const rect = bar.getBoundingClientRect();
    const n = parseInt(bar.style.getPropertyValue('--item-count')) || 0;
    if (!n) return null;
    const ratio = Math.max(0, Math.min(0.9999, (x - rect.left) / rect.width));
    return bar.querySelectorAll('.cal-mbar-item')[Math.floor(ratio * n)]?.dataset?.key || null;
  }

  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('#cal-mbar')) return;
    dragStartX = e.clientX;
    dragging = false;
  });

  document.addEventListener('pointermove', e => {
    if (dragStartX === null) return;
    if (!dragging && Math.abs(e.clientX - dragStartX) > THRESHOLD) dragging = true;
    if (!dragging) return;
    const bar = document.getElementById('cal-mbar');
    if (bar) applyCalMbarKey(bar, getKeyAtX(bar, e.clientX));
  });

  document.addEventListener('pointerup', e => {
    if (dragging) {
      const bar = document.getElementById('cal-mbar');
      if (bar) {
        applyCalMbarKey(bar, getKeyAtX(bar, e.clientX));
        clearTimeout(_calNavTimer);
        refreshCalendarOnly();
      }
    }
    dragStartX = null;
    dragging = false;
  });

  document.addEventListener('pointercancel', () => { dragStartX = null; dragging = false; });
})();
window.toggleCalendarDay = function(dateStr) {
  S.calendarOpenDay = S.calendarOpenDay === dateStr ? null : dateStr;
  render();
};

window.addBankHoliday = function(dateStr) {
  if (!S.isAdmin) return;
  if (holidayReason(dateStr) && holidayReason(dateStr) !== 'custom') return;
  const existing = findCustomHoliday(dateStr);
  const promptMsg = existing
    ? `Edit holiday label for ${dateStr}:`
    : `Mark ${dateStr} as bank holiday.\nOptional label (e.g. Buddha Purnima):`;
  const label = window.prompt(promptMsg, existing?.label || '');
  if (label === null) return;
  const trimmed = label.trim();
  const list = (S.bankHolidays || []).filter(h => h.date !== dateStr);
  list.push({ date: dateStr, label: trimmed });
  list.sort((a, b) => a.date.localeCompare(b.date));
  S.bankHolidays = list;
  saveSettings();
  render();
};

window.removeBankHoliday = function(dateStr) {
  if (!S.isAdmin) return;
  if (!findCustomHoliday(dateStr)) return;
  if (!window.confirm(`Remove bank holiday on ${dateStr}?`)) return;
  S.bankHolidays = (S.bankHolidays || []).filter(h => h.date !== dateStr);
  saveSettings();
  render();
};

/* ── CALENDAR LONG-PRESS (admin: add holiday) ── */
(function attachCalendarLongPress() {
  const LONG_PRESS_MS = 500;
  let timer = null;
  let suppressClick = false;
  let pressedDate = null;

  function clearTimer() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function start(e) {
    if (!S.isAdmin) return;
    const cell = e.target.closest('.cal-cell[data-date]');
    if (!cell) return;
    const dateStr = cell.dataset.date;
    const reason = holidayReason(dateStr);
    // Auto holidays (Sunday/2nd-4th Sat) cannot be customised
    if (reason === 'sunday' || reason === 'saturday') return;
    pressedDate = dateStr;
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      suppressClick = true;
      if (navigator.vibrate) { try { navigator.vibrate(20); } catch {} }
      window.addBankHoliday(pressedDate);
    }, LONG_PRESS_MS);
  }

  function cancel() {
    clearTimer();
    pressedDate = null;
  }

  document.addEventListener('pointerdown', start);
  document.addEventListener('pointerup', cancel);
  document.addEventListener('pointercancel', cancel);
  document.addEventListener('pointerleave', cancel);
  document.addEventListener('pointermove', e => {
    if (!timer) return;
    // Cancel long-press on noticeable movement (scrolling)
    if (Math.abs(e.movementX) > 4 || Math.abs(e.movementY) > 4) cancel();
  });
  // Suppress the click that follows a long-press so detail panel doesn't open
  document.addEventListener('click', e => {
    if (suppressClick) {
      suppressClick = false;
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
})();

window.setTaskCategory = function(cat) {
  S.taskCategory = cat;
  S.taskView = S.isAdmin ? 'officers' : 'detail';
  S.taskOfficer = S.isAdmin ? null : S.user;
  render();
};
window.setTaskOfficer = function(officer) { S.taskOfficer = officer; S.taskView = 'detail'; render(); };
window.taskBack = function() {
  if (S.taskView === 'detail') {
    if (S.isAdmin) { S.taskView = 'officers'; S.taskOfficer = null; }
    else { S.taskView = 'overview'; S.taskCategory = null; }
  } else if (S.taskView === 'officers') { S.taskView = 'overview'; S.taskCategory = null; }
  render();
};

// Export specifically for importer.js
export { renderSettingsList } from "./ui-settings.js";
export { updateBadges, updateHero };
