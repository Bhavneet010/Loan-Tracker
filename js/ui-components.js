import { esc, fmtDate, fmtAmt, catCls, daysPending, initials, officerColor, branchCode, computeRenewalStatus, isRenewalDatesMissing } from "./utils.js";
import { S } from "./state.js";

export function loanCard(loan, actions, variant = '') {
  const remarks = loan.remarks ? `<div class="lc-remarks">📝 ${esc(loan.remarks)}</div>` : '';
  const sanctTag = loan.sanctionDate ? `<span class="tag date">✓ ${fmtDate(loan.sanctionDate)}</span>` : '';
  const retTag = loan.returnedDate ? `<span class="tag date">↩ ${fmtDate(loan.returnedDate)}</span>` : '';
  const days = loan.status === 'pending' ? daysPending(loan.receiveDate) : 0;
  const overdueTag = days > 7 ? `<span class="tag overdue">⚠ ${days}d</span>` : '';
  const cls = `${variant} ${days > 7 && loan.status === 'pending' ? 'overdue' : ''}`.trim();
  
  return `
    <div class="loan-card ${cls}">
      <div class="lc-top">
        <div class="lc-left">
          <div class="lc-name">${esc(loan.customerName)}</div>
          <div class="lc-branch">${esc(loan.branch || '')}</div>
        </div>
        <div class="lc-amount">₹${fmtAmt(loan.amount)}<span class="u"> L</span></div>
      </div>
      <div class="lc-tags">
        <span class="tag ${catCls(loan.category)}">${esc(loan.category)}</span>
        <span class="tag officer">${esc(loan.allocatedTo)}</span>
        <span class="tag date">Recd ${fmtDate(loan.receiveDate)}</span>
        ${overdueTag}${sanctTag}${retTag}
      </div>
      ${remarks}
      <div class="lc-actions">${actions}</div>
    </div>`;
}

export function compactLoanItem(loan, actions, itemCls = '', cardVariant = '') {
  const overdueTag = itemCls.includes('overdue') ? `<span class="tag overdue">⚠ ${daysPending(loan.receiveDate)}d</span>` : '';
  const cls = [`cat-${catCls(loan.category) || 'none'}`, `status-${loan.status || 'pending'}`, itemCls].filter(Boolean).join(' ');
  
  return `<div class="loan-item ${cls}" id="li-${loan.id}">
    <div class="loan-row" onclick="toggleExpand('${loan.id}')">
      <div class="lr-info">
        <span class="lr-av" style="background:${officerColor(loan.allocatedTo).bg};">${initials(loan.allocatedTo)}</span>
        <span class="lr-bcode">${esc(branchCode(loan.branch))}</span>
        <span class="lr-name">${esc(loan.customerName || '')}</span>
      </div>
      <div class="lr-meta">
        ${overdueTag}
        <span class="lr-amount">₹${fmtAmt(loan.amount)}L</span>
        <span class="lr-chev">›</span>
      </div>
    </div>
    <div class="loan-detail">
      <div class="loan-collapse" onclick="toggleExpand('${loan.id}')">▲ collapse</div>
      ${loanCard(loan, actions, cardVariant)}
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

export function renewalItemHtml(loan, rs) {
  const sm = renewalBadge(rs);
  const datesMissing = isRenewalDatesMissing(loan);
  const statusCls = loan.renewedDate
    ? 'rnw-s-done'
    : ({ active: 'rnw-s-active', 'due-soon': 'rnw-s-due-soon', 'pending-renewal': 'rnw-s-pending', npa: 'rnw-s-npa' }[rs.status] || '');
  
  // Only show npaChip if not already marked as NPA by status badge to avoid duplication
  const npaChip = (rs.status !== 'npa' && rs.daysUntilNpa <= 30 && rs.daysUntilNpa > 0)
    ? `<span class="tag rnw-chip-npa-cd">${rs.daysUntilNpa}d to NPA</span>`
    : '';
  const doneChip = loan.renewedDate ? '<span class="tag rnw-chip-done">Done</span>' : '';
  const missingChip = datesMissing ? '<span class="tag rnw-chip-dates-missing">Dates pending</span>' : '';
  const oldDueChip = datesMissing ? `<span class="tag rnw-chip-pending">${sm.label}</span>` : '';
    
  const itemId = 'rnw-' + loan.id;
  
  return `<div class="loan-item ${statusCls}" id="li-${itemId}">
    <div class="loan-row" onclick="toggleExpand('${itemId}')">
      <div class="lr-info">
        <span class="lr-av" style="background:${officerColor(loan.allocatedTo).bg};">${initials(loan.allocatedTo)}</span>
        <span class="lr-bcode">${esc(branchCode(loan.branch))}</span>
        <span class="lr-name">${esc(loan.customerName || '')} ${loan.acNumber ? `<span class="ac-sub">A/C: ${esc(loan.acNumber)}</span>` : ''}</span>
      </div>
      <div class="lr-meta">
        ${doneChip || `<span class="tag ${sm.cls}">${sm.label}</span>`}
        ${missingChip}
        ${oldDueChip}
        <span class="lr-amount">₹${fmtAmt(loan.amount)}L</span>
        <span class="lr-chev">›</span>
      </div>
    </div>
    <div class="loan-detail">
      <div class="rnw-expanded-card">
        <div class="lc-top">
          <div class="lc-left">
            <div class="lc-name">${esc(loan.customerName)}</div>
            <div class="lc-branch">${esc(loan.branch || '')} ${loan.acNumber ? ` • A/C: ${esc(loan.acNumber)}` : ''}</div>
          </div>
          <div class="lc-amount">₹${fmtAmt(loan.amount)}<span class="u"> L</span></div>
        </div>
        <div class="rnw-tags-group">
          <div class="tag-row">
            <span class="tag sme">SME CC</span>
            <span class="tag officer">${esc(loan.allocatedTo)}</span>
          </div>
          <div class="tag-row status-row">
            <span class="tag date">Due ${fmtDate(loan.renewalDueDate || rs.dueDateStr)}</span>
            ${loan.limitExpiryDate ? `<span class="tag date">Exp ${fmtDate(loan.limitExpiryDate)}</span>` : ''}
            ${doneChip || `<span class="tag ${sm.cls}">${sm.label}</span>`}
            ${missingChip}
            ${loan.renewedDate && datesMissing ? `<span class="tag ${sm.cls}">${sm.label}</span>` : ''}
            ${npaChip}
          </div>
        </div>
        ${datesMissing ? `<div class="rnw-date-warning">New limit expiry date and next renewal due date are pending. Old due warning is retained until the next due date is entered.</div>` : ''}
        ${loan.remarks ? `<div class="lc-remarks">📝 ${esc(loan.remarks)}</div>` : ''}
        <div class="rnw-action-group">
          <button class="btn btn-rnw-done" onclick="markRenewalDone('${loan.id}')">
            ♻ Renewal Done
          </button>
          <div class="rnw-sub-actions">
            <button class="btn btn-edit-icon" onclick="editLoan('${loan.id}')" title="Edit">✎</button>
            ${S.isAdmin ? `<button class="btn btn-del-icon" onclick="${S.renewalTab === 'done' ? `undoRenewalDone('${loan.id}')` : `deleteLoan('${loan.id}')`}" title="${S.renewalTab === 'done' ? 'Undo Renewal Done' : 'Delete'}">🗑</button>` : ''}
          </div>
        </div>
        <div class="loan-collapse" onclick="toggleExpand('${itemId}')">▲ hide details</div>
      </div>
    </div>
  </div>`;
}
