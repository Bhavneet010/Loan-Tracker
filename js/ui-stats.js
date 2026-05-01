import { S } from "./state.js";
import { getLoanMetrics, sumAmount } from "./derived.js";
import { fmtAmt } from "./utils.js";
import { getTaskCounts } from "./ui-tasks.js";

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
    const taskCount = getTaskCounts(metrics);
    bTasks.textContent = taskCount || '';
  }
}

/* HERO STATS */
export function updateHero() {
  const sc = document.getElementById('statsScroll');
  if (!sc) return;
  const metrics = getLoanMetrics();

  if (S.appMode === 'tasks') {
    sc.style.display = 'none';
    sc.classList.remove('rnw-grid');
    sc.innerHTML = '';
    const bTasks = document.getElementById('b-tasks');
    if (bTasks) bTasks.textContent = getTaskCounts(metrics) || '';
    return;
  }

  if (S.appMode === 'renewals') {
    sc.style.display = '';
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
  
  sc.style.display = '';
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
