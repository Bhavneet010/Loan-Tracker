import { S } from "./state.js";
import { getLoanMetrics, sumAmount } from "./derived.js";
import { fmtAmt } from "./utils.js";
import { getTaskCounts } from "./ui-tasks.js";

let lastHeroKey = '';
let heroSwapTimer = null;

function setHeroStats(sc, key, html, configure) {
  const sameView = lastHeroKey === key;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  sc.querySelectorAll('.stats-layer').forEach(layer => layer.remove());
  const oldHtml = sc.innerHTML;
  const oldWasRenewalGrid = sc.classList.contains('rnw-grid');

  configure();

  if (!lastHeroKey || sameView || reduceMotion) {
    sc.classList.remove('stats-transitioning');
    sc.innerHTML = html;
    lastHeroKey = key;
    return;
  }

  const oldLayer = document.createElement('div');
  oldLayer.className = `stats-layer${oldWasRenewalGrid ? ' rnw-grid' : ''}`;
  oldLayer.innerHTML = oldHtml;

  sc.innerHTML = html;
  sc.appendChild(oldLayer);
  sc.classList.remove('stats-transitioning');
  void sc.offsetWidth;
  sc.classList.add('stats-transitioning');

  clearTimeout(heroSwapTimer);
  heroSwapTimer = setTimeout(() => {
    oldLayer.remove();
    sc.classList.remove('stats-transitioning');
  }, 420);

  lastHeroKey = key;
}

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
    sc.classList.remove('stats-transitioning');
    sc.innerHTML = '';
    lastHeroKey = 'tasks';
    const bTasks = document.getElementById('b-tasks');
    if (bTasks) bTasks.textContent = getTaskCounts(metrics) || '';
    return;
  }

  if (S.appMode === 'renewals') {
    sc.style.display = '';
    const monthName = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[parseInt(metrics.thisMonth.slice(5)) - 1];

    const rnwStat = (tab, label, arr, gradCls) => {
      const active = S.renewalTab === tab;
      return `<div class="stat rnw-stat-card ${gradCls} ${active ? 'stat-rnw-active' : ''}" onclick="setRenewalTab('${tab}')" style="cursor:pointer;">
        <div class="rnw-stat-copy">
          <div class="stat-l">${label}</div>
          <div class="stat-v">&#8377;${fmtAmt(sumAmount(arr))}L</div>
        </div>
        <div class="rnw-stat-count" aria-label="${arr.length} accounts">${arr.length}</div>
      </div>`;
    };

    const html =
      rnwStat('done', `Renewals Done ${monthName}`, metrics.renewalDoneThisMonth, 'rnw-grad-green') +
      rnwStat('due-soon', 'Due Soon', metrics.renewalDueSoon, 'rnw-grad-amber') +
      rnwStat('overdue', 'Overdue', metrics.renewalOverdue, 'rnw-grad-red') +
      rnwStat('all', 'All CC Accounts', metrics.renewals, '');
    setHeroStats(sc, `renewals:${S.renewalTab}`, html, () => {
      sc.classList.add('rnw-grid');
    });
    return;
  }

  sc.style.display = '';
  const gradMap = { pending: 'stat-grad-pending', sanctioned: 'stat-grad-sanctioned', returned: 'stat-grad-returned' };
  const freshStat = (tab, label, arr, subtitle, badge = '') => {
    const active = S.tab === tab;
    const gradCls = gradMap[tab] || '';
    return `<button type="button" class="stat fresh-stat-card ${gradCls} ${active ? 'stat-fresh-active' : ''}" onclick="setFreshTab('${tab}')" aria-pressed="${active}">
      <div class="stat-l">${label}</div>
      <div class="stat-v">&#8377;${fmtAmt(sumAmount(arr))}L</div>
      <div class="stat-s">${subtitle}</div>
      ${badge ? `<div class="stat-badge">${badge}</div>` : ''}
    </button>`;
  };

  const html =
    freshStat('pending', 'Pending', metrics.pending, `${metrics.pending.length} loans`, metrics.pending.length ? '&nearr; Active' : '') +
    freshStat('sanctioned', 'This Month', metrics.sanctionedThisMonth, `${metrics.sanctionedThisMonth.length} sanctioned`, 'Month total') +
    freshStat('returned', 'Returned', metrics.returned, `${metrics.returned.length} items`);
  setHeroStats(sc, `fresh:${S.tab}`, html, () => {
    sc.classList.remove('rnw-grid');
  });
}
