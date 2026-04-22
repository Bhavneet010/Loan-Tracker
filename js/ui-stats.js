import { S } from "./state.js";
import { getLoanMetrics, sumAmount } from "./derived.js";
import { fmtAmt } from "./utils.js";

/* ── BADGES ── */
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
}

/* ── HERO STATS ── */
export function updateHero() {
  const sc = document.getElementById('statsScroll');
  if (!sc) return;
  const metrics = getLoanMetrics();

  if (S.appMode === 'renewals') {
    const monthName = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[parseInt(metrics.thisMonth.slice(5)) - 1];
    
    const rnwStat = (tab, label, arr, gradCls, badge, badgeCls) => {
      const active = S.renewalTab === tab;
      return `<div class="stat rnw-stat-card ${gradCls} ${active ? 'stat-rnw-active' : ''}" onclick="setRenewalTab('${tab}')" style="cursor:pointer;">
        <div class="stat-l">${label}</div>
        <div class="stat-v">₹${fmtAmt(sumAmount(arr))}L</div>
        <div class="stat-s">${arr.length} accounts</div>
        ${badge ? `<div class="stat-badge ${badgeCls || ''}">${badge}</div>` : ''}
      </div>`;
    };
    
    sc.classList.add('rnw-grid');
    sc.innerHTML = 
      rnwStat('done', `Renewals Done ${monthName}`, metrics.renewalDoneThisMonth, 'rnw-grad-green', '', '') +
      rnwStat('dates-missing', 'Dates Missing', metrics.renewalDatesMissing, 'rnw-grad-amber', metrics.renewalDatesMissing.length ? 'Update needed' : '', 'stat-badge-warn') +
      rnwStat('due-soon', 'Due Soon', metrics.renewalDueSoon, 'rnw-grad-amber', metrics.renewalDueSoon.length ? `${metrics.renewalDueSoon.length} pending` : '', 'stat-badge-warn') +
      rnwStat('overdue', 'Overdue', metrics.renewalOverdue, 'rnw-grad-red', metrics.renewalOverdue.length ? 'Action needed' : '', 'stat-badge-danger') +
      rnwStat('all', 'All CC Accounts', metrics.renewals, 'rnw-grad-darkred', '', '');
    return;
  }
  
  sc.classList.remove('rnw-grid');
  
  sc.innerHTML = `
    <div class="stat">
      <div class="stat-l">Pending</div>
      <div class="stat-v">₹${fmtAmt(sumAmount(metrics.pending))}L</div>
      <div class="stat-s">${metrics.pending.length} loans</div>
      ${metrics.pending.length ? `<div class="stat-badge">↗ Active</div>` : ''}
    </div>
    <div class="stat">
      <div class="stat-l">This Month</div>
      <div class="stat-v">₹${fmtAmt(sumAmount(metrics.sanctionedThisMonth))}L</div>
      <div class="stat-s">${metrics.sanctionedThisMonth.length} sanctioned</div>
      <div class="stat-badge">Month total</div>
    </div>
    <div class="stat">
      <div class="stat-l">Returned</div>
      <div class="stat-v">₹${fmtAmt(sumAmount(metrics.returned))}L</div>
      <div class="stat-s">${metrics.returned.length} items</div>
    </div>`;
}
