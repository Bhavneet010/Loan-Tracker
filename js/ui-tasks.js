import { S } from "./state.js";
import { getLoanMetrics, sumAmount } from "./derived.js";
import { esc, fmtAmt, initials, officerColor, branchCode, daysPending } from "./utils.js";

const CATEGORY_META = {
  overdueLoans:    { title: 'Overdue Pending',    icon: '⏳', urgency: 'amber', type: 'loan' },
  dueSoon:         { title: 'Renewals Due Soon',   icon: '⏰', urgency: 'amber', type: 'renewal' },
  overdueRenewals: { title: 'Overdue Renewals',    icon: '⚠',  urgency: 'red',   type: 'renewal' },
  datesMissing:    { title: 'Missing Dates',        icon: '📋', urgency: 'purple', type: 'renewal' },
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
  const cards = Object.entries(CATEGORY_META).map(([key, meta]) => {
    const items = buildCategoryItems(metrics, key, null);
    const total = sumAmount(items);
    const n = items.length;
    if (n === 0) return `
      <div class="task-ov-card task-ov-card--empty">
        <div class="task-ov-icon">${meta.icon}</div>
        <div class="task-ov-body">
          <div class="task-ov-title">${meta.title}</div>
          <div class="task-ov-none">All clear</div>
        </div>
        <div class="task-ov-arrow task-ov-arrow--clear">✓</div>
      </div>`;
    return `
      <div class="task-ov-card task-ov-card--${meta.urgency}" onclick="setTaskCategory('${key}')">
        <div class="task-ov-icon">${meta.icon}</div>
        <div class="task-ov-body">
          <div class="task-ov-title">${meta.title}</div>
          <div class="task-ov-count">${n}</div>
          <div class="task-ov-amt">₹${fmtAmt(total)}L · ${n} item${n !== 1 ? 's' : ''}</div>
        </div>
        <div class="task-ov-arrow">›</div>
      </div>`;
  }).join('');

  const allClear = Object.keys(CATEGORY_META).every(k => buildCategoryItems(metrics, k, null).length === 0);

  c.innerHTML = `
    <div class="tasks-header">
      <div class="tasks-title">Today's Tasks</div>
      <div class="tasks-subtitle">${allClear ? 'Nothing pending — all clear!' : 'Tap a category to view details'}</div>
    </div>
    <div class="task-ov-list">${cards}</div>`;
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
