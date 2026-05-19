import { S } from "./state.js";
import { getLoanMetrics, sumAmount } from "./derived.js";
import { fmtAmt } from "./utils.js";
import { getTaskCounts } from "./ui-tasks.js";

let lastHeroMode = '';
let lastHeroSelection = '';
let heroLeaveTimer = null;
let heroEnterTimer = null;

function setHeroStats(sc, mode, selection, html, configure) {
  const modeChanged = lastHeroMode && lastHeroMode !== mode;
  const selectionChanged = lastHeroMode === mode && lastHeroSelection && lastHeroSelection !== selection;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const animateMode = modeChanged && !reduceMotion && mode !== 'tasks' && lastHeroMode !== 'tasks';

  // No-op refresh (snapshot tick during/after a mode switch). If an exit or
  // entrance is in flight, leave the DOM alone so the cascade can finish; the
  // next render will pick up any data delta.
  if (!modeChanged && !selectionChanged) {
    if (!sc.classList.contains('stats-mode-leave') && !sc.classList.contains('stats-mode-enter')) {
      configure();
      if (sc.innerHTML !== html) sc.innerHTML = html;
    }
    lastHeroMode = mode;
    lastHeroSelection = selection;
    return;
  }

  clearTimeout(heroLeaveTimer);
  clearTimeout(heroEnterTimer);
  sc.classList.remove('stats-mode-enter');

  const enter = () => {
    sc.classList.remove('stats-mode-leave');
    if (animateMode) {
      void sc.offsetWidth;
      sc.classList.add('stats-mode-enter');
      heroEnterTimer = setTimeout(() => sc.classList.remove('stats-mode-enter'), 460);
    }
  };

  if (animateMode && sc.children.length > 0) {
    // Fade container out, swap behind the curtain, then cascade the new cards in.
    sc.classList.add('stats-mode-leave');
    heroLeaveTimer = setTimeout(() => {
      configure();
      sc.innerHTML = html;
      enter();
    }, 170);
  } else {
    configure();
    sc.innerHTML = html;
    enter();
    if (selectionChanged && !reduceMotion) {
      const active = sc.querySelector('.stat-fresh-active,.stat-rnw-active');
      if (active) {
        active.classList.add('stat-selected-enter');
        heroEnterTimer = setTimeout(() => active.classList.remove('stat-selected-enter'), 430);
      }
    }
  }

  lastHeroMode = mode;
  lastHeroSelection = selection;
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
    sc.classList.remove('stats-mode-leave', 'stats-mode-enter');
    sc.innerHTML = '';
    lastHeroMode = 'tasks';
    lastHeroSelection = 'tasks';
    const bTasks = document.getElementById('b-tasks');
    if (bTasks) bTasks.textContent = getTaskCounts(metrics) || '';
    return;
  }

  if (S.appMode === 'renewals') {
    sc.style.display = '';
    if (S.renewalTab === 'due-soon') {
      S.renewalTab = 'all';
      S.renewalFilter.status = 'DueSoon';
    }
    const monthName = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[parseInt(metrics.thisMonth.slice(5)) - 1];

    const rnwStat = (tab, label, arr, gradCls, subtitle) => {
      const active = S.renewalTab === tab;
      return `<div class="stat rnw-stat-card ${gradCls} ${active ? 'stat-rnw-active' : ''}" onclick="setRenewalTab('${tab}')" style="cursor:pointer;">
        <div class="stat-l">${label}</div>
        <div class="stat-v"><span class="rs">&#8377;</span>${fmtAmt(sumAmount(arr))}L</div>
        <div class="stat-s">${subtitle || `${arr.length} accounts`}</div>
      </div>`;
    };

    const html =
      rnwStat('done', `Done ${monthName}`, metrics.renewalDoneThisMonth, 'rnw-grad-green', `${metrics.renewalDoneThisMonth.length} done`) +
      rnwStat('overdue', 'Overdue', metrics.renewalOverdue, 'rnw-grad-red', `${metrics.renewalOverdue.length} accounts`) +
      rnwStat('all', 'All CC', metrics.renewals, '', `${metrics.renewals.length} accounts`);
    setHeroStats(sc, 'renewals', S.renewalTab, html, () => {
      sc.classList.add('rnw-grid');
    });
    return;
  }

  sc.style.display = '';
  const gradMap = { pending: 'stat-grad-pending', sanctioned: 'stat-grad-sanctioned', returned: 'stat-grad-returned' };
  const freshStat = (tab, label, arr, subtitle) => {
    const active = S.tab === tab;
    const gradCls = gradMap[tab] || '';
    return `<button type="button" class="stat fresh-stat-card ${gradCls} ${active ? 'stat-fresh-active' : ''}" onclick="setFreshTab('${tab}')" aria-pressed="${active}">
      <div class="stat-l">${label}</div>
      <div class="stat-v"><span class="rs">&#8377;</span>${fmtAmt(sumAmount(arr))}L</div>
      <div class="stat-s">${subtitle}</div>
    </button>`;
  };

  const html =
    freshStat('pending', 'Pending', metrics.pending, `${metrics.pending.length} loans`) +
    freshStat('sanctioned', 'This Month', metrics.sanctionedThisMonth, `${metrics.sanctionedThisMonth.length} sanctioned`) +
    freshStat('returned', 'Returned', metrics.returned, `${metrics.returned.length} items`);
  setHeroStats(sc, 'fresh', S.tab, html, () => {
    sc.classList.remove('rnw-grid');
  });
}
