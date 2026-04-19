import { S } from "./state.js";
import { esc } from "./utils.js";
import { renderNotifications } from "./notifications.js";

// Import from new specialized modules
import { updateBadges, updateHero } from "./ui-stats.js";
import { renderPending, renderSanctioned, renderReturned } from "./ui-tabs-loans.js";
import { renderRenewals } from "./ui-tabs-renewals.js";

// Import shared logic
import { searchMatch, applyFilters, applySort, filterSortBarHtml } from "./ui-logic.js";

/* ── RENDER MAIN ── */
export function render() {
  if (!S.user) { 
    if (typeof window.showUserSelect === 'function') window.showUserSelect(); 
    return; 
  }
  updateHero();
  updateBadges(); // Ensure badges are updated too
  
  const sw = document.getElementById('searchWrap');
  if (sw) sw.style.display = (S.tab === 'notifs') ? 'none' : '';
  const c = document.getElementById('content');
  if (!c) return;

  if (S.appMode === 'renewals') { renderRenewals(c); return; }
  
  if (S.tab === 'pending') renderPending(c);
  else if (S.tab === 'sanctioned') renderSanctioned(c);
  else if (S.tab === 'returned') renderReturned(c);
  else if (S.tab === 'notifs') renderNotifications(c);
}

// Expose render globally so other modules can trigger refreshes without a circular import
window.render = render;

/* ── WINDOW ACTION WRAPPERS ── */
export const toggleFsMenu = function(which) { S.openPop = S.openPop === which ? null : which; render(); };
window.toggleFsMenu = toggleFsMenu;
window.setFilter = function(k, v) { S.filter[k] = v; render(); };
window.setSort = function(f, d) { if (f) S.sort.field = f; if (d) S.sort.dir = d; render(); };
window.setRenewalFilter = function(k, v) { S.renewalFilter[k] = S.renewalFilter[k] === v ? 'All' : v; render(); };
window.setRenewalSort = function(f, d) { if (f) S.renewalSort.field = f; if (d) S.renewalSort.dir = d; render(); };
window.setRenewalTab = function(t) { S.renewalTab = t; S.openPop = null; render(); };

// Export specifically for importer.js
export { renderSettingsList } from "./ui-settings.js";
export { updateBadges, updateHero };
