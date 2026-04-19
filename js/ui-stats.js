import { S } from "./state.js";
import { fmtAmt, todayStr, computeRenewalStatus, isFreshCC } from "./utils.js";

/* ── BADGES ── */
export function updateBadges() {
  const bPending = document.getElementById('b-pending');
  if (bPending) bPending.textContent = S.loans.filter(l => l.status === 'pending' && isFreshCC(l)).length;
  
  const bSanctioned = document.getElementById('b-sanctioned');
  if (bSanctioned) bSanctioned.textContent = S.loans.filter(l => l.status === 'sanctioned' && isFreshCC(l)).length;
  
  const bReturned = document.getElementById('b-returned');
  if (bReturned) bReturned.textContent = S.loans.filter(l => l.status === 'returned' && isFreshCC(l)).length;
  
  const urgent = S.loans.filter(l => {
    if (l.category !== 'SME' || !l.sanctionDate || l.isTermLoan) return false;
    const rs = computeRenewalStatus(l);
    return rs && rs.status !== 'active';
  }).length;
  
  const rnwEl = document.getElementById('b-renewals');
  if (rnwEl) rnwEl.textContent = urgent || '';
  
  const thisMonth = todayStr().slice(0, 7);
  const sme = S.loans
    .filter(l => l.category === 'SME' && l.sanctionDate && !l.isTermLoan)
    .map(l => ({ ...l, _rs: computeRenewalStatus(l) }))
    .filter(l => l._rs);
  
  const setB = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n || ''; };
  setB('b-rnw-done', sme.filter(l => (l.sanctionDate || '').startsWith(thisMonth) && !isFreshCC(l)).length);
  setB('b-rnw-due-soon', sme.filter(l => l._rs.status === 'due-soon').length);
  setB('b-rnw-overdue', sme.filter(l => l._rs.status === 'pending-renewal' || l._rs.status === 'npa').length);
  setB('b-rnw-all-cc', sme.length);
}

/* ── HERO STATS ── */
export function updateHero() {
  const sc = document.getElementById('statsScroll');
  if (!sc) return;

  if (S.appMode === 'renewals') {
    const thisMonth = todayStr().slice(0, 7);
    const monthName = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[parseInt(thisMonth.slice(5)) - 1];
    const sme = S.loans
      .filter(l => l.category === 'SME' && l.sanctionDate && !l.isTermLoan)
      .map(l => ({ ...l, _rs: computeRenewalStatus(l) }))
      .filter(l => l._rs);
    
    const done = sme.filter(l => (l.sanctionDate || '').startsWith(thisMonth) && !isFreshCC(l));
    const dueSoon = sme.filter(l => l._rs.status === 'due-soon');
    const overdue = sme.filter(l => l._rs.status === 'pending-renewal' || l._rs.status === 'npa');
    const allAccounts = sme;
    const amt = arr => arr.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
    
    const rnwStat = (tab, label, arr, gradCls, badge, badgeCls) => {
      const active = S.renewalTab === tab;
      return `<div class="stat rnw-stat-card ${gradCls} ${active ? 'stat-rnw-active' : ''}" onclick="setRenewalTab('${tab}')" style="cursor:pointer;">
        <div class="stat-l">${label}</div>
        <div class="stat-v">₹${fmtAmt(amt(arr))}L</div>
        <div class="stat-s">${arr.length} accounts</div>
        ${badge ? `<div class="stat-badge ${badgeCls || ''}">${badge}</div>` : ''}
      </div>`;
    };
    
    sc.classList.add('rnw-grid');
    sc.innerHTML = 
      rnwStat('done', `Renewals Done ${monthName}`, done, 'rnw-grad-green', '', '') +
      rnwStat('due-soon', 'Due Soon', dueSoon, 'rnw-grad-amber', dueSoon.length ? `${dueSoon.length} pending` : '', 'stat-badge-warn') +
      rnwStat('overdue', 'Overdue', overdue, 'rnw-grad-red', overdue.length ? 'Action needed' : '', 'stat-badge-danger') +
      rnwStat('all', 'All CC Accounts', allAccounts, 'rnw-grad-darkred', '', '');
    return;
  }
  
  sc.classList.remove('rnw-grid');
  const pending = S.loans.filter(l => l.status === 'pending' && isFreshCC(l));
  const sanctioned = S.loans.filter(l => l.status === 'sanctioned' && isFreshCC(l));
  const returned = S.loans.filter(l => l.status === 'returned' && isFreshCC(l));
  const pAmt = pending.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const sAmt = sanctioned.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const rAmt = returned.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  
  sc.innerHTML = `
    <div class="stat">
      <div class="stat-l">Pending</div>
      <div class="stat-v">₹${fmtAmt(pAmt)}L</div>
      <div class="stat-s">${pending.length} loans</div>
      ${pending.length ? `<div class="stat-badge">↗ Active</div>` : ''}
    </div>
    <div class="stat">
      <div class="stat-l">This Month</div>
      <div class="stat-v">₹${fmtAmt(sAmt)}L</div>
      <div class="stat-s">${sanctioned.length} sanctioned</div>
      <div class="stat-badge">Month total</div>
    </div>
    <div class="stat">
      <div class="stat-l">Returned</div>
      <div class="stat-v">₹${fmtAmt(rAmt)}L</div>
      <div class="stat-s">${returned.length} items</div>
    </div>`;
}
