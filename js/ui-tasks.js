import { S } from "./state.js";
import { getLoanMetrics, sumAmount } from "./derived.js";
import { esc, fmtAmt, initials, officerColor, branchCode, daysPending } from "./utils.js";

const CATEGORY_META = {
  overdueLoans:    { title: 'Overdue Pending',    icon: '⏳', urgency: 'amber', type: 'loan' },
  dueSoon:         { title: 'Renewals Due Soon',   icon: '⏰', urgency: 'amber', type: 'renewal' },
  overdueRenewals: { title: 'Overdue Renewals',    icon: '⚠',  urgency: 'red',   type: 'renewal' },
  datesMissing:    { title: 'Missing Dates',        icon: '📋', urgency: 'purple', type: 'renewal' },
};

const CRITICAL_META = {
  npa15:        { title: 'NPA in 15 days',   tone: 'red' },
  pending10:    { title: 'Pending >10 days', tone: 'amber' },
  datesMissing: { title: 'Dates missing',    tone: 'purple' },
};

/* ── ENTRY POINT ── */
export function renderTasks(c) {
  const metrics = getLoanMetrics();
  if (S.taskView === 'officers') renderTaskOfficers(c, metrics);
  else if (S.taskView === 'detail') renderTaskDetail(c, metrics);
  else renderTaskOverview(c, metrics);
}

export function getTaskCounts(metrics) {
  return Object.keys(CATEGORY_META).reduce((sum, cat) =>
    sum + buildCategoryItems(metrics, cat, null).length, 0);
}

/* ── DATA HELPER ── */
function buildCategoryItems(metrics, category, officer) {
  const base = {
    overdueLoans:    metrics.pending.filter(l => daysPending(l.receiveDate) > 7),
    dueSoon:         metrics.renewalDueSoon.filter(l => !l.renewedDate),
    overdueRenewals: metrics.renewalOverdue.filter(l => !l.renewedDate),
    datesMissing:    metrics.renewalDatesMissing,
  }[category] || [];

  if (officer === 'All') return S.isAdmin ? base : base.filter(l => l.allocatedTo === S.user);
  if (officer)           return base.filter(l => l.allocatedTo === officer);
  return S.isAdmin ? base : base.filter(l => l.allocatedTo === S.user);
}

/* ── LEVEL 1: OVERVIEW ── */
function renderTaskOverview(c, metrics) {
  const critical = buildCriticalCare(metrics);
  const activeKey = CRITICAL_META[S.taskCategory] ? S.taskCategory : pickDefaultCritical(critical);
  const activeItems = critical[activeKey] || [];

  c.innerHTML = `
    ${performerBoardHtml(metrics)}
    <section class="task-care">
      <div class="task-care-head">
        <div>
          <div class="task-care-title">Critical Care</div>
          <div class="task-care-sub">Highest risk accounts first</div>
        </div>
        <div class="task-care-info">i</div>
      </div>
      <div class="task-critical-tabs">
        ${Object.keys(CRITICAL_META).map(key => criticalTabHtml(key, critical[key], activeKey === key)).join('')}
      </div>
      <div class="task-critical-detail task-critical-detail--${CRITICAL_META[activeKey].tone}">
        ${criticalRowsHtml(activeKey, activeItems)}
      </div>
    </section>
    ${renewalTargetsHtml(metrics)}
  `;
}

function buildCriticalCare(metrics) {
  const visible = l => S.isAdmin || l.allocatedTo === S.user;
  return {
    npa15: metrics.renewalOverdue
      .filter(l => visible(l) && !l.renewedDate && l._rs?.status === 'pending-renewal' && l._rs.daysUntilNpa >= 0 && l._rs.daysUntilNpa <= 15)
      .sort((a, b) => (a._rs.daysUntilNpa - b._rs.daysUntilNpa) || ((parseFloat(b.amount) || 0) - (parseFloat(a.amount) || 0))),
    pending10: metrics.pending
      .filter(l => visible(l) && daysPending(l.receiveDate) > 10)
      .sort((a, b) => daysPending(b.receiveDate) - daysPending(a.receiveDate) || ((parseFloat(b.amount) || 0) - (parseFloat(a.amount) || 0))),
    datesMissing: metrics.renewalDatesMissing
      .filter(visible)
      .sort((a, b) => ((parseFloat(b.amount) || 0) - (parseFloat(a.amount) || 0)) || (a.customerName || '').localeCompare(b.customerName || '')),
  };
}

function pickDefaultCritical(critical) {
  return Object.keys(CRITICAL_META).find(key => critical[key].length) || 'npa15';
}

function criticalTabHtml(key, items, active) {
  const meta = CRITICAL_META[key];
  const total = sumAmount(items);
  return `<button type="button" class="task-critical-tab task-critical-tab--${meta.tone} ${active ? 'active' : ''}" onclick="toggleCriticalCare('${key}')" aria-expanded="${active}">
      <span class="task-critical-mark"></span>
      <span class="task-critical-copy">
        <span class="task-critical-title">${meta.title}</span>
        <span class="task-critical-count">${items.length}</span>
        <span class="task-critical-sub">&#8377;${fmtAmt(total)}L</span>
      </span>
      <span class="task-critical-chevron">${active ? '&#8963;' : '&#8250;'}</span>
    </button>`;
}

function criticalRowsHtml(key, items) {
  if (!items.length) return `<div class="task-critical-empty">All clear in this bucket.</div>`;
  const total = items.length;
  return `<div class="task-critical-rows">
    <div class="task-critical-sort">
      <span>Sorted by urgency</span>
      <span class="task-sort-icon">&#8645;</span>
    </div>
    <div class="task-critical-table-head">
      <span>Branch</span><span>Borrower</span><span>${key === 'pending10' ? 'Days' : 'Status'}</span><span>Amt</span><span>Officer</span>
    </div>
    ${items.slice(0, 5).map(loan => criticalLoanRowHtml(key, loan)).join('')}
    ${items.length > 5 ? `<button type="button" class="task-critical-more">View all ${total} accounts &#8250;</button>` : ''}
  </div>`;
}

function criticalLoanRowHtml(key, loan) {
  const status = key === 'npa15'
    ? `${loan._rs?.daysUntilNpa ?? 0}d to NPA`
    : key === 'pending10'
      ? `${daysPending(loan.receiveDate)}d pending`
      : 'Dates missing';
  const statusShort = key === 'npa15'
    ? `${loan._rs?.daysUntilNpa ?? 0}d`
    : key === 'pending10'
      ? `${daysPending(loan.receiveDate)}`
      : 'Miss';
  return `<div class="task-critical-row" onclick="editLoan('${loan.id}')">
    <span class="task-branch-chip">${esc(branchCode(loan.branch))}</span>
    <span class="task-critical-name">${esc(loan.customerName)}</span>
    <span class="task-critical-days" title="${esc(status)}">${esc(statusShort)}</span>
    <span class="task-critical-amt">&#8377;${fmtAmt(loan.amount)}L</span>
    <span class="task-officer-mini" style="background:${officerColor(loan.allocatedTo).bg};">${initials(loan.allocatedTo)}</span>
  </div>`;
}

function performerBoardHtml(metrics) {
  const freshBest = bestOfficer(metrics.sanctionedThisMonth);
  const renewalBest = bestOfficer(metrics.renewalDoneThisMonth);
  return `<section class="task-performer-block" aria-label="Best performers">
    <div class="task-performer-head">
      <div><span class="task-performer-spark">✦</span><b>Best Performer</b></div>
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
    const officer = loan.allocatedTo || 'Unassigned';
    if (!rows.has(officer)) rows.set(officer, { officer, count: 0, amount: 0 });
    const row = rows.get(officer);
    row.count++;
    row.amount += parseFloat(loan.amount) || 0;
  });
  return Array.from(rows.values()).sort((a, b) => (b.count - a.count) || (b.amount - a.amount) || a.officer.localeCompare(b.officer))[0] || { officer: 'No data', count: 0, amount: 0 };
}

function performerCardHtml(label, row, type) {
  const empty = row.count === 0;
  const name = empty ? 'No entries yet' : row.officer;
  return `<div class="task-performer task-performer--${type}">
    <div class="task-performer-copy">
      <div class="task-performer-title">${label}</div>
      <div class="task-performer-line">
        <span class="task-performer-av" style="background:${officerColor(row.officer).bg};">${initials(row.officer)}</span>
        <span>
          <b>${esc(name)}</b>
          <small>${row.count} ${type === 'fresh' ? 'loans sanctioned' : 'renewals'}</small>
        </span>
      </div>
      <div class="task-performer-amount">&#8377;${fmtAmt(row.amount)}L</div>
    </div>
  </div>`;
}

function renewalTargetsHtml(metrics) {
  const doneByOfficer = countByOfficer(metrics.renewalDoneThisMonth);
  const openByOfficer = countByOfficer([...metrics.renewalDueSoon, ...metrics.renewalOverdue]);
  const rows = S.officers.map(officer => {
    const done = doneByOfficer.get(officer) || 0;
    const open = openByOfficer.get(officer) || 0;
    const target = Math.max(done + open, done, 1);
    const pct = Math.min(100, Math.round((done / target) * 100));
    return `<div class="task-target-row">
      <div class="task-target-person">
        <span class="lr-av" style="background:${officerColor(officer).bg};">${initials(officer)}</span>
        <span>${esc(officer)}</span>
      </div>
      <div class="task-target-bar"><span style="width:${pct}%"></span></div>
      <div class="task-target-score">${done}/${target}</div>
    </div>`;
  }).join('');

  return `<section class="task-targets">
    <div class="task-section-head">
      <div>
        <div class="task-kicker">Renewal Targets</div>
        <div class="task-section-title">This month by officer</div>
      </div>
      <span class="task-section-pill">Done / target</span>
    </div>
    <div class="task-target-list">${rows}</div>
  </section>`;
}

function countByOfficer(loans) {
  const map = new Map();
  loans.forEach(loan => {
    const officer = loan.allocatedTo || 'Unassigned';
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
      <button class="task-back-btn" onclick="taskBack()">← Back</button>
      <span class="task-drill-title">${meta.icon} ${meta.title}</span>
    </div>
    <div class="task-drill-summary">₹${fmtAmt(totalAmt)}L · ${allItems.length} item${allItems.length !== 1 ? 's' : ''} total</div>
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
      <button class="task-back-btn" onclick="taskBack()">← Back</button>
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
      <span class="lr-av" style="background:${officerColor(loan.allocatedTo).bg};">${initials(loan.allocatedTo)}</span>
      <span class="task-bcode">${esc(branchCode(loan.branch))}</span>
      <span class="task-name">${esc(loan.customerName)}</span>
      <span class="task-meta">₹${fmtAmt(loan.amount)}L · ${days}d</span>
    </div>
    <div class="task-actions">
      <button class="btn btn-sanction btn-sm" onclick="sanctionLoan('${loan.id}')">✓ Sanction</button>
      <button class="btn btn-return btn-sm" onclick="returnLoan('${loan.id}')">↩</button>
    </div>
  </div>`;
}

function taskRenewalItemHtml(loan) {
  const rs = loan._rs;
  if (!rs) return '';
  const statusLabel = rs.status === 'npa' ? 'NPA'
    : rs.status === 'pending-renewal' ? `${rs.daysOverdue}d OD`
    : rs.status === 'due-soon' ? `Due ${rs.daysUntilDue}d`
    : 'Missing dates';
  const statusCls = rs.status === 'npa' ? 'rnw-chip-npa'
    : rs.status === 'pending-renewal' ? 'rnw-chip-pending'
    : 'rnw-chip-due-soon';
  return `<div class="task-item">
    <div class="task-item-info">
      <span class="lr-av" style="background:${officerColor(loan.allocatedTo).bg};">${initials(loan.allocatedTo)}</span>
      <span class="task-bcode">${esc(branchCode(loan.branch))}</span>
      <span class="task-name">${esc(loan.customerName)}</span>
      <span class="tag ${statusCls} task-status-tag">${statusLabel}</span>
    </div>
    <div class="task-actions">
      <button class="btn btn-rnw-done btn-sm" onclick="markRenewalDone('${loan.id}')">♻ Done</button>
      <button class="btn btn-edit-icon btn-sm" onclick="editLoan('${loan.id}')">✎</button>
    </div>
  </div>`;
}

window.toggleCriticalCare = function(key) {
  S.taskCategory = key;
  S.taskView = 'overview';
  window.render?.();
};
