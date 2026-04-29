import { S } from "./state.js";
import { getLoanMetrics, sumAmount } from "./derived.js";
import { esc, fmtAmt, fmtDate, initials, officerColor, branchCode, daysPending } from "./utils.js";

export function renderTasks(c) {
  const metrics = getLoanMetrics();
  const groups = buildTaskGroups(metrics);
  const total = groups.overdueLoans.length + groups.dueSoon.length + groups.overdueRenewals.length + groups.datesMissing.length;

  if (total === 0) {
    c.innerHTML = `<div class="tasks-all-clear">
      <div class="tasks-clear-icon">✅</div>
      <div class="tasks-clear-title">All clear!</div>
      <div class="tasks-clear-sub">No pending action items right now.</div>
    </div>`;
    return;
  }

  c.innerHTML = `
    <div class="tasks-header">
      <div class="tasks-title">Today's Tasks</div>
      <div class="tasks-subtitle">${total} item${total !== 1 ? 's' : ''} need${total === 1 ? 's' : ''} attention</div>
    </div>
    ${taskSectionHtml('Overdue Pending', '⏳', 'amber', groups.overdueLoans, 'loan')}
    ${taskSectionHtml('Renewals Due Soon', '⏰', 'amber', groups.dueSoon, 'renewal')}
    ${taskSectionHtml('Overdue Renewals', '⚠', 'red', groups.overdueRenewals, 'renewal')}
    ${taskSectionHtml('Missing Dates', '📋', 'purple', groups.datesMissing, 'renewal')}
  `;
}

export function getTaskCounts(metrics) {
  const groups = buildTaskGroups(metrics);
  return groups.overdueLoans.length + groups.dueSoon.length + groups.overdueRenewals.length + groups.datesMissing.length;
}

function buildTaskGroups(metrics) {
  const isVisible = l => S.isAdmin || l.allocatedTo === S.user;
  return {
    overdueLoans: metrics.pending.filter(l => isVisible(l) && daysPending(l.receiveDate) > 7),
    dueSoon: metrics.renewalDueSoon.filter(l => isVisible(l) && !l.renewedDate),
    overdueRenewals: metrics.renewalOverdue.filter(l => isVisible(l) && !l.renewedDate),
    datesMissing: metrics.renewalDatesMissing.filter(isVisible),
  };
}

function taskSectionHtml(title, icon, urgency, items, type) {
  if (!items.length) return '';
  const cls = `tasks-section tasks-section--${urgency}`;
  const rows = items.map(l => type === 'loan' ? taskLoanItemHtml(l) : taskRenewalItemHtml(l)).join('');
  return `<div class="${cls}">
    <div class="tasks-sec-head">
      <span class="tasks-sec-icon">${icon}</span>
      <span class="tasks-sec-title">${title}</span>
      <span class="tasks-sec-count tasks-sec-count--${urgency}">${items.length}</span>
    </div>
    ${rows}
  </div>`;
}

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
