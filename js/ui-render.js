import { S } from "./state.js";

// Import from new specialized modules
import { updateBadges, updateHero } from "./ui-stats.js";
import { renderPending, renderSanctioned, renderReturned } from "./ui-tabs-loans.js";
import { renderRenewals } from "./ui-tabs-renewals.js";
import { renderTasks } from "./ui-tasks.js";

let renderQueued = false;

export function render() {
  if (!S.user) { 
    if (typeof window.showUserSelect === 'function') window.showUserSelect(); 
    return; 
  }
  document.body.classList.toggle('tasks-mode', S.appMode === 'tasks');
  document.body.classList.toggle('fresh-mode', S.appMode === 'fresh');
  updateHero();
  updateBadges();
  
  const sw = document.getElementById('searchWrap');
  if (sw) sw.style.display = S.appMode === 'tasks' ? 'none' : '';
  const c = document.getElementById('content');
  if (!c) return;

  if (S.appMode === 'renewals') { renderRenewals(c); return; }
  if (S.appMode === 'tasks') { renderTasks(c); return; }

  if (S.tab === 'pending') renderPending(c);
  else if (S.tab === 'sanctioned') renderSanctioned(c);
  else if (S.tab === 'returned') renderReturned(c);
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
window.scheduleRender = scheduleRender;

/* ── WINDOW ACTION WRAPPERS ── */
export const toggleFsMenu = function(which) { S.openPop = S.openPop === which ? null : which; render(); };
window.toggleFsMenu = toggleFsMenu;
window.setFilter = function(k, v) { S.filter[k] = v; render(); };
window.setSort = function(f, d) { if (f) S.sort.field = f; if (d) S.sort.dir = d; render(); };
window.setRenewalFilter = function(k, v) { S.renewalFilter[k] = S.renewalFilter[k] === v ? 'All' : v; render(); };
window.setRenewalSort = function(f, d) { if (f) S.renewalSort.field = f; if (d) S.renewalSort.dir = d; render(); };
window.setRenewalTab = function(t) { S.renewalTab = t; S.openPop = null; render(); };
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

window.setRenewalView = function(v) { S.renewalView = v; render(); };
window.calendarNavMonth = function(delta) {
  if (!S.calendarState) return;
  let { year, month } = S.calendarState;
  month += delta;
  if (month > 11) { month = 0; year++; }
  if (month < 0)  { month = 11; year--; }
  S.calendarState = { year, month };
  render();
};
window.toggleCalendarDay = function(dateStr) {
  S.calendarOpenDay = S.calendarOpenDay === dateStr ? null : dateStr;
  render();
};

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
