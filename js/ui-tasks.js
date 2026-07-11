import { S } from "./state.js";
import { getLoanMetrics, sumAmount, effectiveOfficer } from "./derived.js";
import { esc, fmtAmt, initials, officerColor, branchCode, daysPending, isFreshCC } from "./utils.js";
import { countWorkingDaysLeft } from "./bank-holidays.js";

const CATEGORY_META = {
  overdueLoans:    { title: 'Overdue Pending',    icon: '&#8987;', urgency: 'amber', type: 'loan' },
  dueSoon:         { title: 'Renewals Due Soon',   icon: '&#9200;', urgency: 'amber', type: 'renewal' },
  overdueRenewals: { title: 'Overdue Renewals',    icon: '&#9888;',  urgency: 'red',   type: 'renewal' },
  datesMissing:    { title: 'Integration Pending',  icon: '&#128203;', urgency: 'purple', type: 'renewal' },
};

const targetsCelebratedMonths = new Set();

const CRITICAL_META = {
  npa15:        { title: 'NPA in 15 days',     short: 'NPA IN 15D',   tone: 'red' },
  datesMissing: { title: 'Integration Pending', short: 'INTEGRATION',  tone: 'purple' },
  docPending:   { title: 'Documentation Pending', short: 'DOCUMENTATION', tone: 'blue' },
  disbPending:  { title: 'Disbursement Pending',  short: 'DISBURSEMENT', tone: 'blue' },
};

// Post-sanction stage queues: rows carry a quick "mark done" action and can
// mix fresh loans with renewal accounts (documentation stage only).
const isStageKey = key => key === 'docPending' || key === 'disbPending';

// "Renewal not possible" accounts stay listed (greyed, sorted last) as a reminder
// in case renewal becomes possible again, but are excluded from counts and totals
// until they actually turn NPA — after that they are treated like any NPA account.
const isRnpDeferred = l => l.renewalNotPossible === true && !l.renewedDate && l._rs?.status !== 'npa';
const countableCritical = items => items.filter(l => !isRnpDeferred(l));

/* ── ENTRY POINT ── */
export function renderTasks(c) {
  const metrics = getLoanMetrics();
  if (S.taskView === 'officers') renderTaskOfficers(c, metrics);
  else if (S.taskView === 'detail') renderTaskDetail(c, metrics);
  else renderTaskOverview(c, metrics);
}

export function getTaskCounts(metrics) {
  const critical = buildCriticalCare(metrics);
  return Object.values(critical).reduce((sum, items) => sum + countableCritical(items).length, 0);
}

/* ── DATA HELPER ── */
function buildCategoryItems(metrics, category, officer) {
  const base = {
    overdueLoans:    metrics.pending.filter(l => daysPending(l.receiveDate) > 7),
    dueSoon:         metrics.renewalDueSoon.filter(l => !l.renewedDate),
    overdueRenewals: metrics.renewalOverdue.filter(l => !l.renewedDate),
    datesMissing:    metrics.renewalDatesMissing,
  }[category] || [];

  if (officer === 'All') return S.isAdmin ? base : base.filter(l => effectiveOfficer(l) === S.user);
  if (officer)           return base.filter(l => effectiveOfficer(l) === officer);
  return S.isAdmin ? base : base.filter(l => effectiveOfficer(l) === S.user);
}

/* ── LEVEL 1: OVERVIEW ── */
function renderTaskOverview(c, metrics) {
  const critical = buildCriticalCare(metrics);
  const activeKey = CRITICAL_META[S.taskCategory] ? S.taskCategory : pickDefaultCritical(critical);
  const activeItems = sortCriticalItems(activeKey, critical[activeKey] || []);

  const allCriticalItems = countableCritical(Object.values(critical).flat());
  const totalAccounts = allCriticalItems.length;
  const totalAtRisk = sumAmount(allCriticalItems);

  c.innerHTML = `
    ${performerBoardHtml(metrics)}
    ${renewalTargetsHtml(metrics)}
    <section class="task-care">
      <div class="task-care-head">
        <span class="task-care-icon" aria-hidden="true">&#9888;</span>
        <div class="task-care-headline">
          <div class="task-care-title">Critical Care</div>
          <div class="task-care-sub">${totalAccounts} account${totalAccounts === 1 ? '' : 's'} · <span class="rs">&#8377;</span>${fmtAmt(totalAtRisk)}L at risk</div>
        </div>
        ${totalAccounts ? '<span class="task-care-urgent">URGENT</span>' : ''}
      </div>
      <div class="task-critical-tabs">
        ${Object.keys(CRITICAL_META).map(key => criticalTabHtml(key, critical[key], activeKey === key)).join('')}
      </div>
      <div class="task-critical-detail task-critical-detail--${CRITICAL_META[activeKey].tone}">
        ${criticalRowsHtml(activeKey, activeItems)}
      </div>
    </section>
  `;
}

function buildCriticalCare(metrics) {
  const visible = l => S.isAdmin || effectiveOfficer(l) === S.user;
  return {
    npa15: metrics.renewalOverdue
      .filter(l => visible(l) && !l.renewedDate && l._rs?.status === 'pending-renewal' && l._rs.daysUntilNpa >= 0 && l._rs.daysUntilNpa <= 15),
    datesMissing: metrics.renewalDatesMissing
      .filter(visible),
    docPending: [...metrics.docPendingFresh, ...metrics.docPendingRenewals].filter(visible),
    disbPending: metrics.disbPending.filter(visible),
  };
}

function pickDefaultCritical(critical) {
  return Object.keys(CRITICAL_META).find(key => countableCritical(critical[key]).length) || 'npa15';
}

function criticalTabHtml(key, items, active) {
  const meta = CRITICAL_META[key];
  const countable = countableCritical(items);
  const total = sumAmount(countable);
  return `<button type="button" data-critical-key="${key}" class="task-critical-tab task-critical-tab--${meta.tone} ${active ? 'active' : ''}" onclick="toggleCriticalCare('${key}')" aria-expanded="${active}">
      <span class="task-critical-title">${meta.short}</span>
      <span class="task-critical-stats">
        <span class="task-critical-count">${countable.length}</span>
        <span class="task-critical-sub"><span class="rs">&#8377;</span>${fmtAmt(total)}L</span>
      </span>
    </button>`;
}

function criticalRowsHtml(key, items) {
  if (!items.length) return `<div class="task-critical-empty">All clear in this bucket.</div>`;
  const total = items.length;
  const expanded = !!S.taskCriticalExpanded?.[key];
  const shown = expanded ? items : items.slice(0, 5);
  const sort = S.taskCriticalSort?.[key] || { field: 'urgency', dir: 'desc' };
  return `<div class="task-critical-rows">
    <div class="task-critical-sort">
      <span>Sorted by ${criticalSortLabel(key, sort.field)}</span>
      <span class="task-sort-icon">&#8645;</span>
    </div>
    <div class="task-critical-table-head">
      ${criticalHeadCell(key, 'branch', 'Branch', sort)}
      ${criticalHeadCell(key, 'borrower', 'Borrower', sort)}
      ${key === 'datesMissing' ? '' : criticalHeadCell(key, 'status', key === 'npa15' ? 'Status' : 'Days', sort)}
      ${criticalHeadCell(key, 'amount', 'Amt', sort)}
      ${criticalHeadCell(key, 'officer', 'Officer', sort)}
      ${isStageKey(key) ? '<span></span>' : ''}
    </div>
    ${shown.map(loan => criticalLoanRowHtml(key, loan)).join('')}
    ${items.length > 5 && !expanded ? `<button type="button" class="task-critical-more" onclick="expandCriticalCare('${key}')">View all ${total} accounts &#8250;</button>` : ''}
    ${items.length > 5 && expanded ? `<button type="button" class="task-critical-more task-critical-collapse" onclick="collapseCriticalCare('${key}')">Collapse to 5 accounts &#8963;</button>` : ''}
  </div>`;
}

function criticalSortLabel(key, field) {
  if (field === 'branch') return 'branch';
  if (field === 'borrower') return 'borrower';
  if (field === 'amount') return 'amount';
  if (field === 'officer') return 'officer';
  if (field === 'status') return 'status';
  return 'urgency';
}

function criticalHeadCell(key, field, label, sort) {
  const active = sort.field === field;
  const arrow = active ? (sort.dir === 'asc' ? '↑' : '↓') : '';
  return `<button type="button" class="task-critical-head-btn ${active ? 'active' : ''}" onclick="sortCriticalCare('${key}','${field}')">${label}${arrow ? ` <span>${arrow}</span>` : ''}</button>`;
}

function sortCriticalItems(key, items) {
  const sort = S.taskCriticalSort?.[key] || { field: 'urgency', dir: 'desc' };
  const dir = sort.dir === 'asc' ? 1 : -1;
  const sorted = [...items].sort((a, b) => {
    if (sort.field === 'urgency') return defaultCriticalCompare(key, a, b);
    const av = criticalSortValue(key, a, sort.field);
    const bv = criticalSortValue(key, b, sort.field);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return defaultCriticalCompare(key, a, b);
  });
  // Uncounted "renewal not possible" reminders always sit below the real accounts
  return [...sorted.filter(l => !isRnpDeferred(l)), ...sorted.filter(isRnpDeferred)];
}

function defaultCriticalCompare(key, a, b) {
  if (key === 'npa15') return (a._rs?.daysUntilNpa ?? 999) - (b._rs?.daysUntilNpa ?? 999) || ((parseFloat(b.amount) || 0) - (parseFloat(a.amount) || 0));
  return ((parseFloat(b.amount) || 0) - (parseFloat(a.amount) || 0)) || (a.customerName || '').localeCompare(b.customerName || '');
}

function criticalSortValue(key, loan, field) {
  if (field === 'branch') return branchCode(loan.branch);
  if (field === 'borrower') return (loan.customerName || '').toLowerCase();
  if (field === 'amount') return parseFloat(loan.amount) || 0;
  if (field === 'officer') return effectiveOfficer(loan).toLowerCase();
  if (field === 'status') {
    if (key === 'npa15') return loan._rs?.daysUntilNpa ?? 999;
    if (isStageKey(key)) return daysPending(isFreshCC(loan) ? loan.sanctionDate : loan.renewedDate);
    return (loan.customerName || '').toLowerCase();
  }
  return '';
}

function criticalLoanRowHtml(key, loan) {
  const isMissing = key === 'datesMissing';
  const stage = isStageKey(key);
  const rnp = isRnpDeferred(loan);
  const stageDays = stage ? daysPending(isFreshCC(loan) ? loan.sanctionDate : loan.renewedDate) : 0;
  const status = key === 'npa15'
    ? `${loan._rs?.daysUntilNpa ?? 0}d to NPA`
    : stage
      ? `${stageDays}d since ${isFreshCC(loan) ? 'sanction' : 'renewal'}`
      : `${daysPending(loan.receiveDate)}d pending`;
  const statusShort = key === 'npa15'
    ? `${loan._rs?.daysUntilNpa ?? 0}d`
    : stage
      ? `${stageDays}d`
      : `${daysPending(loan.receiveDate)}`;
  const sheetCall = stage && isFreshCC(loan)
    ? `openLoanDecisionSheet('${loan.id}')`
    : `openRenewalDecisionSheet('${loan.id}')`;
  const markStage = key === 'docPending' ? 'documentation' : 'disbursement';
  const markBtn = stage
    ? `<button type="button" class="task-stage-mark" onclick="event.stopPropagation();markLoanStage('${loan.id}','${markStage}')" title="Mark ${markStage} done">&#10003;</button>`
    : '';
  const rnpTitle = rnp ? ` title="Renewal not possible${loan.renewalNotPossibleRemarks ? ` — ${esc(loan.renewalNotPossibleRemarks)}` : ''} (not counted)"` : '';
  return `<div class="task-critical-row${rnp ? ' task-critical-row--rnp' : ''}"${rnpTitle} onclick="${sheetCall}">
    <span class="task-branch-chip">${esc(branchCode(loan.branch))}</span>
    <span class="task-critical-name">${esc(loan.customerName)}${rnp ? ' <span class="task-rnp-mark">NP</span>' : ''}</span>
    ${isMissing ? '' : `<span class="task-critical-days" title="${esc(status)}">${esc(statusShort)}</span>`}
    <span class="task-critical-amt"><span class="rs">&#8377;</span>${fmtAmt(loan.amount)}L</span>
    <span class="task-officer-mini" style="background:${officerColor(effectiveOfficer(loan)).bg};">${initials(effectiveOfficer(loan))}</span>
    ${markBtn}
  </div>`;
}

function performerBoardHtml(metrics) {
  const freshBest = bestOfficer(metrics.sanctionedThisMonth);
  const renewalBest = bestOfficer(metrics.renewalDoneThisMonth);
  return `<section class="task-performer-block" aria-label="Best performers">
    <div class="task-performer-head">
      <div><span class="task-performer-spark">&#10024;</span><b>Best Performer</b></div>
      <span>This month</span>
    </div>
    <div class="task-performer-grid">
      ${performerCardHtml('Fresh sanctions', freshBest, 'fresh')}
      ${performerCardHtml('Renewals done', renewalBest, 'renewal')}
    </div>
  </section>`;
}

function bestOfficer(loans) {
  const rows = new Map();
  S.officers.forEach(officer => rows.set(officer, { officer, count: 0, amount: 0 }));
  loans.forEach(loan => {
    const officer = effectiveOfficer(loan);
    if (!rows.has(officer)) rows.set(officer, { officer, count: 0, amount: 0 });
    const row = rows.get(officer);
    row.count++;
    row.amount += parseFloat(loan.amount) || 0;
  });
  return Array.from(rows.values()).sort((a, b) => (b.amount - a.amount) || (b.count - a.count) || a.officer.localeCompare(b.officer))[0] || { officer: 'No data', count: 0, amount: 0 };
}

function performerCardHtml(label, row, type) {
  const empty = row.count === 0;
  const name = empty ? 'No entries yet' : row.officer;
  const photo = !empty && S.officerPhotos?.[row.officer];
  const avHtml = empty
    ? `<span class="task-performer-av">&ndash;</span>`
    : photo
      ? `<img class="task-performer-av task-performer-av--photo" src="${photo}" alt="${esc(initials(row.officer))}">`
      : `<span class="task-performer-av">${initials(row.officer)}</span>`;
  return `<div class="task-performer task-performer--${type}">
    ${avHtml}
    <div class="task-performer-copy">
      <div class="task-performer-title">${label}</div>
      <div class="task-performer-name">${esc(name)}</div>
      <div class="task-performer-amount"><span class="rs">&#8377;</span>${fmtAmt(row.amount)}L</div>
    </div>
  </div>`;
}

function renewalTargetsHtml(metrics) {
  const doneByOfficer = countByOfficer(metrics.renewalDoneThisMonth);
  const monthTargets = S.renewalTargets?.[metrics.thisMonth] || {};
  const officers = S.officers.map(officer => {
    const done = doneByOfficer.get(officer) || 0;
    const target = Math.max(0, Number(monthTargets[officer]) || 0);
    const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
    const bg = officerColor(officer).bg;
    const solid = (bg.match(/#[0-9a-f]{3,8}/i) || ['#7c6ee0'])[0];
    return { officer, done, target, pct, color: bg, solid };
  });

  const monthDate = metrics.thisMonth ? new Date(`${metrics.thisMonth}-01T00:00:00`) : new Date();
  const monthName = monthDate.toLocaleString('en-US', { month: 'long' });
  const daysLeft = countWorkingDaysLeft(monthDate.getFullYear(), monthDate.getMonth());

  const leader = [...officers]
    .filter(o => o.done > 0 && o.target > 0)
    .sort((a, b) => (b.pct - a.pct) || (b.done - a.done) || a.officer.localeCompare(b.officer))[0];
  // Wait for real renewal-progress data before picking a "least renewal" tile —
  // otherwise every officer reads as 0/0 on first paint (loans stream in async)
  // and the outline lands on an arbitrary alphabetical pick instead of the real one.
  const leastRenewal = S.loans.length ? [...officers]
    .filter(o => o.target > 0)
    .sort((a, b) => (a.pct - b.pct) || (a.done - b.done) || a.officer.localeCompare(b.officer))[0] : null;

  let celebrate = false;
  if (leader && !targetsCelebratedMonths.has(metrics.thisMonth)) {
    celebrate = true;
    targetsCelebratedMonths.add(metrics.thisMonth);
  }

  const tiles = officers.map(({ officer, done, target, pct, solid }, idx) => {
    const isLeader = !!leader && officer === leader.officer;
    const isLeastRenewal = !!leastRenewal && officer === leastRenewal.officer && !isLeader;
    const cls = `targets-tile${isLeader ? ' targets-tile--leader' : ''}${isLeastRenewal ? ' targets-tile--least-renewal' : ''}${isLeader && celebrate ? ' targets-tile--celebrate' : ''}`;
    const crown = isLeader ? '<span class="targets-tile-crown" aria-hidden="true">&#128081;</span>' : '';
    const sparkles = isLeader
      ? '<span class="targets-tile-sparkles" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>'
      : '';
    const click = isLeader ? ' onclick="replayTargetLeaderCelebration(this)" role="button" tabindex="0"' : '';
    return `<div class="${cls}"${click}>
      ${crown}
      ${sparkles}
      <div class="targets-tile-head">
        <span class="targets-tile-name">${esc(officer)}</span>
      </div>
      <div class="targets-tile-donut" data-idx="${idx}">
        ${donutSvg(pct, solid, 48, 8)}
        <span class="targets-tile-num">${done}</span>
      </div>
      <div class="targets-tile-target">of ${target}</div>
    </div>`;
  }).join('');

  return `<section class="task-targets task-targets--v1">
    <div class="task-section-head task-target-title-row">
      <div class="task-target-month">Renewal Target · ${monthName}</div>
      <div class="task-target-daysleft">${daysLeft} working day${daysLeft !== 1 ? 's' : ''} left</div>
    </div>
    <div class="targets-tile-grid">${tiles}</div>
  </section>`;
}

function donutSvg(pct, color, size = 60, stroke = 8) {
  const c = size / 2;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const safe = Math.max(0, Math.min(100, pct));
  const off = circ * (1 - safe / 100);
  return `<svg class="task-donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(107,95,191,0.14)" stroke-width="${stroke}"></circle>
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 ${c} ${c})"></circle>
  </svg>`;
}

function countByOfficer(loans) {
  const map = new Map();
  loans.forEach(loan => {
    const officer = effectiveOfficer(loan);
    map.set(officer, (map.get(officer) || 0) + 1);
  });
  return map;
}

/* ── LEVEL 2: OFFICER PICKER ── */
function renderTaskOfficers(c, metrics) {
  const meta = CATEGORY_META[S.taskCategory];
  if (!meta) { S.taskView = 'overview'; renderTaskOverview(c, metrics); return; }

  const allItems = buildCategoryItems(metrics, S.taskCategory, 'All');
  const totalAmt = sumAmount(allItems);

  const officerChips = S.officers.map(officer => {
    const items = buildCategoryItems(metrics, S.taskCategory, officer);
    if (!items.length) return '';
    return `
      <div class="task-officer-chip" onclick="setTaskOfficer('${esc(officer)}')">
        <span class="lr-av" style="background:${officerColor(officer).bg};">${initials(officer)}</span>
        <span class="task-oc-label">${esc(officer)}</span>
        <span class="task-oc-count">${items.length}</span>
      </div>`;
  }).join('');

  c.innerHTML = `
    <div class="task-drill-head">
      <button class="task-back-btn" onclick="taskBack()">&larr; Back</button>
      <span class="task-drill-title">${meta.icon} ${meta.title}</span>
    </div>
    <div class="task-drill-summary"><span class="rs">&#8377;</span>${fmtAmt(totalAmt)}L · ${allItems.length} item${allItems.length !== 1 ? 's' : ''} total</div>
    <div class="task-officer-grid">
      <div class="task-officer-chip task-officer-chip--all" onclick="setTaskOfficer('All')">
        <span class="task-oc-all-av">All</span>
        <span class="task-oc-label">All Officers</span>
        <span class="task-oc-count">${allItems.length}</span>
      </div>
      ${officerChips}
    </div>`;
}

/* ── LEVEL 3: DETAIL LIST ── */
function renderTaskDetail(c, metrics) {
  const meta = CATEGORY_META[S.taskCategory];
  if (!meta) { S.taskView = 'overview'; renderTaskOverview(c, metrics); return; }

  const items = buildCategoryItems(metrics, S.taskCategory, S.taskOfficer);
  const officerLabel = S.taskOfficer === 'All' ? 'All Officers' : (S.taskOfficer || 'All');

  const rows = items.length === 0
    ? `<div class="task-empty">No items found for ${esc(officerLabel)}.</div>`
    : items.map(l => meta.type === 'loan' ? taskLoanItemHtml(l) : taskRenewalItemHtml(l)).join('');

  c.innerHTML = `
    <div class="task-drill-head">
      <button class="task-back-btn" onclick="taskBack()">&larr; Back</button>
      <span class="task-drill-title">${meta.icon} ${meta.title}</span>
    </div>
    <div class="task-drill-summary">${esc(officerLabel)} · ${items.length} item${items.length !== 1 ? 's' : ''}</div>
    <div class="task-detail-list">${rows}</div>`;
}

/* ── ITEM TEMPLATES ── */
function taskLoanItemHtml(loan) {
  const days = daysPending(loan.receiveDate);
  return `<div class="task-item">
    <div class="task-item-info">
      <span class="lr-av" style="background:${officerColor(effectiveOfficer(loan)).bg};">${initials(effectiveOfficer(loan))}</span>
      <span class="task-bcode">${esc(branchCode(loan.branch))}</span>
      <span class="task-name">${esc(loan.customerName)}</span>
      <span class="task-meta"><span class="rs">&#8377;</span>${fmtAmt(loan.amount)}L · ${days}d</span>
    </div>
    <div class="task-actions">
      <button class="btn btn-sanction btn-sm" onclick="sanctionLoan('${loan.id}')">&#10003; Sanction</button>
      <button class="btn btn-return btn-sm" onclick="returnLoan('${loan.id}')">&#8617;</button>
    </div>
  </div>`;
}

function taskRenewalItemHtml(loan) {
  const rs = loan._rs;
  if (!rs) return '';
  const statusLabel = rs.status === 'npa' ? 'NPA'
    : rs.status === 'pending-renewal' ? `${rs.daysOverdue}d OD`
    : rs.status === 'due-soon' ? `Due ${rs.daysUntilDue}d`
    : 'Integration pending';
  const statusCls = rs.status === 'npa' ? 'rnw-chip-npa'
    : rs.status === 'pending-renewal' ? 'rnw-chip-pending'
    : 'rnw-chip-due-soon';
  return `<div class="task-item">
    <div class="task-item-info">
      <span class="lr-av" style="background:${officerColor(effectiveOfficer(loan)).bg};">${initials(effectiveOfficer(loan))}</span>
      <span class="task-bcode">${esc(branchCode(loan.branch))}</span>
      <span class="task-name">${esc(loan.customerName)}</span>
      <span class="tag ${statusCls} task-status-tag">${statusLabel}</span>
    </div>
    <div class="task-actions">
      <button class="btn btn-rnw-done btn-sm" onclick="markRenewalDone('${loan.id}')">&#9850; Done</button>
      <button class="btn btn-edit-icon btn-sm" onclick="editLoan('${loan.id}')">&#9998;</button>
    </div>
  </div>`;
}

window.replayTargetLeaderCelebration = function(tile) {
  if (!tile) return;
  tile.classList.remove('targets-tile--celebrate');
  void tile.offsetWidth;
  tile.classList.add('targets-tile--celebrate');
};

window.toggleCriticalCare = function(key) {
  if (!CRITICAL_META[key]) return;
  if (S.taskCategory === key) return;
  S.taskCategory = key;
  S.taskView = 'overview';

  const careSection = document.querySelector('.task-care');
  const oldDetail = careSection?.querySelector('.task-critical-detail');
  if (!careSection || !oldDetail) { window.render?.(); return; }

  const metrics = getLoanMetrics();
  const critical = buildCriticalCare(metrics);
  const items = sortCriticalItems(key, critical[key] || []);
  const tone = CRITICAL_META[key].tone;

  careSection.querySelectorAll('.task-critical-tab').forEach(tab => {
    const isActive = tab.dataset.criticalKey === key;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-expanded', isActive);
  });

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `<div class="task-critical-detail task-critical-detail--${tone}">${criticalRowsHtml(key, items)}</div>`;
  const newDetail = wrapper.firstElementChild;

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion || oldDetail.classList.contains('task-critical-detail--leaving')) {
    oldDetail.replaceWith(newDetail);
    return;
  }

  oldDetail.classList.add('task-critical-detail--leaving');
  let swapped = false;
  const doSwap = () => {
    if (swapped) return;
    swapped = true;
    if (oldDetail.parentNode) oldDetail.replaceWith(newDetail);
  };
  oldDetail.addEventListener('animationend', doSwap, { once: true });
  setTimeout(doSwap, 220);
};

window.expandCriticalCare = function(key) {
  S.taskCriticalExpanded = { ...(S.taskCriticalExpanded || {}), [key]: true };
  S.taskCategory = key;
  window.render?.();
};

window.collapseCriticalCare = function(key) {
  S.taskCriticalExpanded = { ...(S.taskCriticalExpanded || {}), [key]: false };
  S.taskCategory = key;
  window.render?.();
};

window.sortCriticalCare = function(key, field) {
  const cur = S.taskCriticalSort?.[key] || { field: 'urgency', dir: 'desc' };
  const numeric = field === 'status' || field === 'amount';
  const nextDir = cur.field === field ? (cur.dir === 'asc' ? 'desc' : 'asc') : (numeric ? 'desc' : 'asc');
  S.taskCriticalSort = { ...(S.taskCriticalSort || {}), [key]: { field, dir: nextDir } };
  S.taskCategory = key;
  window.render?.();
};
