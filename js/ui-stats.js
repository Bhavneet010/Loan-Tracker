import { S } from "./state.js";
import { getLoanMetrics, sumAmount } from "./derived.js";
import { fmtAmt, daysPending } from "./utils.js";

/* BADGES */
export function updateBadges() {
  const metrics = getLoanMetrics();
  const bPending = document.getElementById('b-pending');
  if (bPending) bPending.textContent = metrics.pending.length;
  
  const bSanctioned = document.getElementById('b-sanctioned');
  if (bSanctioned) bSanctioned.textContent = metrics.sanctioned.length;
  
  const bReturned = document.getElementById('b-returned');
  if (bReturned) bReturned.textContent = metrics.returned.length;
  
  const rnwEl = document.getElementById('b-renewals');
  if (rnwEl) rnwEl.textContent = metrics.urgentRenewals.length || '';

  const setB = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n || ''; };
  setB('b-rnw-done', metrics.renewalDoneThisMonth.length);
  setB('b-rnw-due-soon', metrics.renewalDueSoon.length);
  setB('b-rnw-overdue', metrics.renewalOverdue.length);
  setB('b-rnw-all-cc', metrics.renewals.length);

  const bTasks = document.getElementById('b-tasks');
  if (bTasks) {
    const isVisible = l => S.isAdmin || l.allocatedTo === S.user;
    const taskCount =
      metrics.pending.filter(l => isVisible(l) && daysPending(l.receiveDate) > 7).length +
      metrics.renewalDueSoon.filter(l => isVisible(l) && !l.renewedDate).length +
      metrics.renewalOverdue.filter(l => isVisible(l) && !l.renewedDate).length +
      metrics.renewalDatesMissing.filter(isVisible).length;
    bTasks.textContent = taskCount || '';
  }
}

/* HERO STATS */
export function updateHero() {
  const sc = document.getElementById('statsScroll');
  if (!sc) return;
  const metrics = getLoanMetrics();

  if (S.appMode === 'tasks') {
    const isVisible = l => S.isAdmin || l.allocatedTo === S.user;
    const overdueLoans = metrics.pending.filter(l => isVisible(l) && daysPending(l.receiveDate) > 7);
    const dueSoon = metrics.renewalDueSoon.filter(l => isVisible(l) && !l.renewedDate);
    const overdueRenewals = metrics.renewalOverdue.filter(l => isVisible(l) && !l.renewedDate);
    const datesMissing = metrics.renewalDatesMissing.filter(isVisible);
    const taskStat = (label, arr, cls) =>
      `<div class="stat tasks-stat-card tasks-stat--${cls}">
        <div class="stat-l">${label}</div>
        <div class="stat-v tasks-stat-num">${arr.length}</div>
        <div class="stat-s">₹${fmtAmt(sumAmount(arr))}L</div>
      </div>`;
    sc.classList.remove('rnw-grid');
    sc.innerHTML =
      taskStat('⏳ Overdue Loans', overdueLoans, 'amber') +
      taskStat('⏰ Due Soon', dueSoon, 'amber') +
      taskStat('⚠ Overdue Rnw', overdueRenewals, 'red') +
      taskStat('📋 Missing Dates', datesMissing, 'purple');
    return;
  }

  if (S.appMode === 'renewals') {
    const monthName = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[parseInt(metrics.thisMonth.slice(5)) - 1];
    
    const rnwStat = (tab, label, arr, gradCls, badge, badgeCls) => {
      const active = S.renewalTab === tab;
      return `<div class="stat rnw-stat-card ${gradCls} ${active ? 'stat-rnw-active' : ''}" onclick="setRenewalTab('${tab}')" style="cursor:pointer;">
        <div class="stat-l">${label}</div>
        <div class="stat-v">&#8377;${fmtAmt(sumAmount(arr))}L</div>
        <div class="stat-s">${arr.length} accounts</div>
        ${badge ? `<div class="stat-badge ${badgeCls || ''}">${badge}</div>` : ''}
      </div>`;
    };
    
    sc.classList.add('rnw-grid');
    sc.innerHTML = 
      rnwStat('done', `Renewals Done ${monthName}`, metrics.renewalDoneThisMonth, 'rnw-grad-green', '', '') +
      rnwStat('due-soon', 'Due Soon', metrics.renewalDueSoon, 'rnw-grad-amber', metrics.renewalDueSoon.length ? `${metrics.renewalDueSoon.length} pending` : '', 'stat-badge-warn') +
      rnwStat('overdue', 'Overdue', metrics.renewalOverdue, 'rnw-grad-red', metrics.renewalOverdue.length ? 'Action needed' : '', 'stat-badge-danger') +
      rnwStat('all', 'All CC Accounts', metrics.renewals, '', '', '');
    return;
  }
  
  sc.classList.remove('rnw-grid');
  const freshStat = (tab, label, arr, subtitle, badge = '') => {
    const active = S.tab === tab;
    return `<button type="button" class="stat fresh-stat-card ${active ? 'stat-fresh-active' : ''}" onclick="setFreshTab('${tab}')" aria-pressed="${active}">
      <div class="stat-l">${label}</div>
      <div class="stat-v">&#8377;${fmtAmt(sumAmount(arr))}L</div>
      <div class="stat-s">${subtitle}</div>
      ${badge ? `<div class="stat-badge">${badge}</div>` : ''}
    </button>`;
  };
  
  sc.innerHTML =
    freshStat('pending', 'Pending', metrics.pending, `${metrics.pending.length} loans`, metrics.pending.length ? '&nearr; Active' : '') +
    freshStat('sanctioned', 'This Month', metrics.sanctionedThisMonth, `${metrics.sanctionedThisMonth.length} sanctioned`, 'Month total') +
    freshStat('returned', 'Returned', metrics.returned, `${metrics.returned.length} items`);
}
