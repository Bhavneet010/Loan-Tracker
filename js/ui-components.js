import { esc, fmtDate, fmtAmt, catCls, daysPending, initials, officerColor, branchCode, computeRenewalStatus, isRenewalDatesMissing, timeAgo } from "./utils.js";
import { S } from "./state.js";
import { effectiveOfficer } from "./derived.js";
import { reminderMails, reminderSummary, canTrackReminders } from "./ui-reminder-mail.js";

function reminderMailNote(loan) {
  if (!canTrackReminders(loan) || !reminderMails(loan).length) return '';
  const last = reminderMails(loan)[0];
  return `<div class="lc-reminder" onclick="openReminderMailSheet('${loan.id}')" title="Reminder mail log">&#9993; Reminder mail: ${esc(reminderSummary(loan))}${last.remarks ? ` — ${esc(last.remarks)}` : ''}</div>`;
}

export function loanCard(loan, actions, variant = '') {
  const remarks = loan.remarks ? `<div class="lc-remarks">&#128221; ${esc(loan.remarks)}</div>` : '';
  const sanctTag = loan.sanctionDate ? `<span class="tag tag-sanctioned">${fmtDate(loan.sanctionDate)}</span>` : '';
  const retTag = loan.returnedDate ? `<span class="tag tag-returned">${fmtDate(loan.returnedDate)}</span>` : '';
  const days = loan.status === 'pending' ? daysPending(loan.receiveDate) : 0;
  const overdueTag = days > 7 ? `<span class="tag overdue">&#9888; ${days}d</span>` : '';
  const cls = `${variant} ${days > 7 && loan.status === 'pending' ? 'overdue' : ''}`.trim();
  
  return `
    <div class="loan-card ${cls}">
      <div class="lc-top">
        <div class="lc-left">
          <div class="lc-name">${esc(loan.customerName)}</div>
          <div class="lc-branch">${esc(loan.branch || '')}</div>
        </div>
        <div class="lc-amount"><span class="rs">&#8377;</span>${fmtAmt(loan.amount)}<span class="u"> L</span></div>
      </div>
      <div class="lc-tags">
        <span class="tag ${catCls(loan.category)}">${esc(loan.category)}</span>
        <span class="tag officer">${esc(effectiveOfficer(loan))}</span>
        <span class="tag date">Recd ${fmtDate(loan.receiveDate)}</span>
        ${overdueTag}${sanctTag}${retTag}
      </div>
      ${remarks}
      ${reminderMailNote(loan)}
      <div class="lc-actions">${actions}</div>
    </div>`;
}

export function compactLoanItem(loan, actions, itemCls = '', cardVariant = '', idx = 0) {
  const overdueTag = itemCls.includes('overdue') ? `<span class="tag overdue">&#9888; ${daysPending(loan.receiveDate)}d</span>` : '';
  const mailCount = canTrackReminders(loan) ? reminderMails(loan).length : 0;
  const mailTag = mailCount ? `<span class="tag tag-mail" title="${mailCount} reminder mail${mailCount > 1 ? 's' : ''} sent">&#9993;${mailCount > 1 ? ' ' + mailCount : ''}</span>` : '';
  const cls = [`cat-${catCls(loan.category) || 'none'}`, `status-${loan.status || 'pending'}`, itemCls].filter(Boolean).join(' ');

  return `<div class="loan-item ${cls}" id="li-${loan.id}" style="--i:${idx}">
    <div class="loan-row" onclick="openLoanDecisionSheet('${loan.id}')">
      <div class="lr-info">
        <span class="lr-av" style="background:${officerColor(effectiveOfficer(loan)).bg};">${initials(effectiveOfficer(loan))}</span>
        <span class="lr-bcode">${esc(branchCode(loan.branch))}</span>
        <span class="lr-name">${esc(loan.customerName || '')}</span>
      </div>
      <div class="lr-meta">
        ${mailTag}
        ${overdueTag}
        <span class="lr-amount"><span class="rs">&#8377;</span>${fmtAmt(loan.amount)}L</span>
        <span class="lr-chev">&rsaquo;</span>
      </div>
    </div>
    <div class="loan-detail">
      <div class="loan-collapse" onclick="toggleExpand('${loan.id}')">&#9650; collapse</div>
      ${loanCard(loan, actions, cardVariant)}
      ${auditTrailHtml(loan.id)}
    </div>
  </div>`;
}

export function emptyState(icon, msg, sub) {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><div class="empty-msg">${msg}</div><div class="empty-sub">${sub}</div></div>`;
}

export function renewalBadge(rs) {
  if (!rs) return { label: '', cls: '' };
  return {
    'active': { label: 'Active', cls: 'rnw-chip-active' },
    'due-soon': { label: `Due in ${rs.daysUntilDue}d`, cls: 'rnw-chip-due-soon' },
    'pending-renewal': { label: `${rs.daysOverdue}d OD`, cls: 'rnw-chip-pending' },
    'npa': { label: 'NPA', cls: 'rnw-chip-npa' },
  }[rs.status] || { label: '', cls: '' };
}

export function renewalItemHtml(loan, rs, idx = 0) {
  const sm = renewalBadge(rs);
  const datesMissing = isRenewalDatesMissing(loan);
  const statusCls = loan.renewedDate
    ? (datesMissing ? 'rnw-s-dates-missing' : 'rnw-s-done')
    : ({ active: 'rnw-s-active', 'due-soon': 'rnw-s-due-soon', 'pending-renewal': 'rnw-s-pending', npa: 'rnw-s-npa' }[rs.status] || '');
  
  // Only show npaChip if not already marked as NPA by status badge to avoid duplication
  const npaChip = (rs.status !== 'npa' && rs.daysUntilNpa <= 30 && rs.daysUntilNpa > 0)
    ? `<span class="tag rnw-chip-npa-cd">${rs.daysUntilNpa}d to NPA</span>`
    : '';
  const oldDueChip = datesMissing ? `<span class="tag rnw-chip-pending">${sm.label}</span>` : '';
  const rnpActive = !loan.renewedDate && loan.renewalNotPossible === true;
  const rnpChip = rnpActive ? `<span class="tag rnw-chip-rnp">Not Possible</span>` : '';

  const itemId = 'rnw-' + loan.id;
  
  return `<div class="loan-item ${statusCls}" id="li-${itemId}" style="--i:${idx}">
    <div class="loan-row" onclick="openRenewalDecisionSheet('${loan.id}')">
      <div class="lr-info">
        <span class="lr-av" style="background:${officerColor(effectiveOfficer(loan)).bg};">${initials(effectiveOfficer(loan))}</span>
        <span class="lr-bcode">${esc(branchCode(loan.branch))}</span>
        <span class="lr-name">${esc(loan.customerName || '')} ${loan.acNumber ? `<span class="ac-sub">A/C: ${esc(loan.acNumber)}</span>` : ''}</span>
      </div>
      <div class="lr-meta">
        ${rnpChip}
        ${loan.renewedDate ? '' : `<span class="tag ${sm.cls}">${sm.label}</span>`}
        ${oldDueChip}
        <span class="lr-amount"><span class="rs">&#8377;</span>${fmtAmt(loan.amount)}L</span>
        <span class="lr-chev">&rsaquo;</span>
      </div>
    </div>
    <div class="loan-detail">
      <div class="rnw-expanded-card">
        <div class="lc-top">
          <div class="lc-left">
            <div class="lc-name">${esc(loan.customerName)}</div>
            <div class="lc-branch">${esc(loan.branch || '')} ${loan.acNumber ? ` • A/C: ${esc(loan.acNumber)}` : ''}</div>
          </div>
          <div class="lc-amount"><span class="rs">&#8377;</span>${fmtAmt(loan.amount)}<span class="u"> L</span></div>
        </div>
        <div class="rnw-tags-group">
          <div class="tag-row">
            <span class="tag sme">SME CC</span>
            <span class="tag officer">${esc(effectiveOfficer(loan))}</span>
          </div>
          <div class="tag-row status-row">
            <span class="tag date">Due ${fmtDate(loan.renewalDueDate || rs.dueDateStr)}</span>
            ${loan.limitExpiryDate ? `<span class="tag date">Exp ${fmtDate(loan.limitExpiryDate)}</span>` : ''}
            ${loan.renewedDate ? '' : `<span class="tag ${sm.cls}">${sm.label}</span>`}
            ${loan.renewedDate && datesMissing ? `<span class="tag ${sm.cls}">${sm.label}</span>` : ''}
            ${npaChip}
            ${rnpChip}
          </div>
        </div>
        ${datesMissing ? `<div class="rnw-date-warning">New limit expiry date and next renewal due date are pending. Old due warning is retained until the next due date is entered.</div>` : ''}
        ${(loan.remarks || (rnpActive && loan.renewalNotPossibleRemarks)) ? `<div class="lc-remarks">&#128221; ${esc(loan.remarks || loan.renewalNotPossibleRemarks)}</div>` : ''}
        <div class="rnw-action-group">
          <button class="btn btn-rnw-done" onclick="openRenewalDecisionSheet('${loan.id}')">
            &#9850; Renewal Status
          </button>
          <div class="rnw-sub-actions">
            <button class="btn btn-edit-icon" onclick="editLoan('${loan.id}')" title="Edit">&#9998;</button>
            ${S.isAdmin ? `<button class="btn btn-del-icon" onclick="${S.renewalTab === 'done' ? `undoRenewalDone('${loan.id}')` : `deleteLoan('${loan.id}')`}" title="${S.renewalTab === 'done' ? 'Undo Renewal Done' : 'Delete'}">&#128465;</button>` : ''}
          </div>
        </div>
        ${auditTrailHtml(loan.id)}
        <div class="loan-collapse" onclick="toggleExpand('${itemId}')">&#9650; hide details</div>
      </div>
    </div>
  </div>`;
}

function auditTrailHtml(loanId) {
  const entries = S.notifications.filter(n => n.loanId === loanId).slice(0, 10);
  if (!entries.length) return '';
  const icons = { added: '&#10133;', sanctioned: '&#10003;', returned: '&#8617;', edited: '&#9998;', reminder: '&#9993;' };
  const labels = { added: 'Added', sanctioned: 'Sanctioned', returned: 'Returned', edited: 'Updated', reminder: 'Reminder mail' };
  const rows = entries.map(n => `
    <div class="audit-row">
      <span class="audit-icon audit-${esc(n.type)}">${icons[n.type] || '•'}</span>
      <span class="audit-text">
        <span class="audit-action">${labels[n.type] || esc(n.type)}</span>
        <span class="audit-by">by ${esc(n.by || '?')}</span>
      </span>
      <span class="audit-time">${timeAgo(n.timestamp)}</span>
    </div>`).join('');
  return `<div class="audit-trail"><div class="audit-head">Activity</div>${rows}</div>`;
}
