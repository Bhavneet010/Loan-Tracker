import { S } from "./state.js";
import { effectiveOfficer } from "./derived.js";
import { todayStr, esc, fmtAmt, fmtDate, catCls, daysPending, computeRenewalStatus, timeAgo } from "./utils.js";
import { animateOverlayIn, animateOverlayOut } from "./animate.js";
import { matchBranchOption, assignedOfficerForBranch, normalizeName } from "./ui-forms.js";
import { reminderSummary, canTrackReminders } from "./ui-reminder-mail.js";

/* SHARED UI HELPERS */
export function accountAmount(loan) {
  return `<span class="rs">&#8377;</span>${fmtAmt(loan.amount)}<span> L</span>`;
}

export function cloneLoanDraft(loan) {
  return {
    allocatedTo: effectiveOfficer(loan) === 'Unassigned' ? (loan.allocatedTo || '') : effectiveOfficer(loan),
    category: loan.category || '',
    branch: loan.branch || '',
    customerName: loan.customerName || '',
    amount: loan.amount ?? '',
    acNumber: loan.acNumber || '',
    receiveDate: loan.receiveDate || todayStr(),
    sanctionDate: loan.sanctionDate || '',
    returnedDate: loan.returnedDate || '',
    renewedDate: loan.renewedDate || '',
    renewalDueDate: loan.renewalDueDate || '',
    limitExpiryDate: loan.limitExpiryDate || '',
    renewalDatesPending: !!loan.renewalDatesPending,
    renewalDueDatePending: loan.renewalDueDatePending === true,
    limitExpiryDatePending: loan.limitExpiryDatePending === true,
    nextRenewalDueDate: loan.renewedDate && loan.renewalDueDateEntered === true ? (loan.renewalDueDate || '') : '',
    nextLimitExpiryDate: loan.renewedDate && loan.limitExpiryDateEntered === true ? (loan.limitExpiryDate || '') : '',
    remarks: loan.remarks || '',
    renewalNotPossible: !!loan.renewalNotPossible,
    renewalNotPossibleRemarks: loan.renewalNotPossibleRemarks || '',
    loanType: loan.loanType || (loan.isTermLoan ? 'TL' : 'CC'),
    isBre: !!loan.isBre,
  };
}

export function loanFromDraft(base, draft, status = base.status || 'pending') {
  const loan = {
    ...base,
    ...draft,
    status,
    customerName: normalizeName(draft.customerName),
    amount: parseFloat(draft.amount) || 0,
  };
  if (status === 'sanctioned') loan.sanctionDate = draft.sanctionDate || base.sanctionDate || todayStr();
  if (status === 'returned') {
    loan.returnedDate = draft.returnedDate || base.returnedDate || todayStr();
    loan.remarks = draft.remarks || '';
  }
  return loan;
}

/* UI COMPONENTS */
function accountLine(label, value, tone = '') {
  if (!value) return '';
  const cls = tone ? ` decision-account-line--${esc(tone)}` : '';
  const mark = tone ? '<span class="decision-account-alert">!</span>' : '';
  return `<div class="decision-account-line${cls}"><small>${esc(label)}</small><b>${esc(value)}</b>${mark}</div>`;
}

// One tappable line instead of extra form fields: the full reminder-mail log
// (sent to, date & time, remarks, history) lives in its own sheet.
function reminderMailLine(loan) {
  if (!loan.id || !canTrackReminders(loan)) return '';
  const summary = reminderSummary(loan);
  return `<div class="decision-account-line decision-account-line--tap" onclick="openReminderMailSheet('${esc(loan.id)}')" title="Reminder mail log">
    <small>Mail Sent</small>
    <b class="${summary ? '' : 'decision-line-muted'}">${esc(summary || 'None yet — tap to log')}</b>
    <span class="decision-line-chev">&rsaquo;</span>
  </div>`;
}

function loanDecisionLines(loan) {
  const rows = [
    accountLine('Branch', loan.branch),
    accountLine('Officer', effectiveOfficer(loan)),
    accountLine('Received', fmtDate(loan.receiveDate)),
  ];
  if (loan.category === 'SME') {
    rows.push(accountLine('Renewal Due', fmtDate(loan.renewalDueDate)));
    rows.push(accountLine('Limit Expiry', fmtDate(loan.limitExpiryDate)));
  }
  if ((loan.status || 'pending') === 'pending') {
    const days = daysPending(loan.receiveDate);
    rows.push(accountLine('Ageing', `${days} ${days === 1 ? 'day' : 'days'}`, days > 7 ? 'alert' : ''));
    rows.push(accountLine('Remarks', loan.remarks || 'No remarks added'));
  }
  if (loan.status === 'sanctioned') rows.push(accountLine('Sanction Date', fmtDate(loan.sanctionDate)));
  if (loan.status === 'returned') {
    rows.push(accountLine('Return Date', fmtDate(loan.returnedDate), 'alert'));
    rows.push(accountLine('Remarks', loan.remarks || 'No remarks added', 'alert'));
  }
  rows.push(reminderMailLine(loan));
  return rows.join('');
}

function previewLoanStatus(loan, status, remarks = '') {
  const preview = { ...loan, status };
  if (status === 'sanctioned') preview.sanctionDate = loan.sanctionDate || todayStr();
  if (status === 'returned') {
    preview.returnedDate = loan.returnedDate || todayStr();
    preview.remarks = remarks;
  }
  return preview;
}

function inlineSelect(options, value) {
  return options.map(opt => {
    const val = typeof opt === 'string' ? opt : opt.value;
    const label = typeof opt === 'string' ? opt : opt.label;
    return `<option value="${esc(val)}" ${val === value ? 'selected' : ''}>${esc(label)}</option>`;
  }).join('');
}

function inlineAccountEditLine(label, html, tone = '') {
  const cls = tone ? ` decision-account-line--${esc(tone)}` : '';
  return `<div class="decision-account-line decision-account-line--edit${cls}">
    <small>${esc(label)}</small>
    <span class="decision-edit-control">${html}</span>
    <span></span>
  </div>`;
}

const CATEGORY_OPTIONS = [
  { value: '', label: 'Category' },
  { value: 'Agriculture', label: 'Agriculture' },
  { value: 'SME', label: 'SME' },
  { value: 'Education', label: 'Education' },
];

const LOAN_TYPE_OPTIONS = [
  { value: 'CC', label: 'CC' },
  { value: 'TL', label: 'Term Loan' },
  { value: 'CC_TL', label: 'CC + TL' },
];

function loanTypeLabel(loan) {
  const type = loan.loanType || (loan.isTermLoan ? 'TL' : 'CC');
  return type === 'TL' ? 'TL' : type === 'CC_TL' ? 'CC+TL' : 'CC';
}

function categoryBadgeHtml(loan) {
  const label = loan.category === 'SME' ? `${loan.category} · ${loanTypeLabel(loan)}` : (loan.category || 'Loan');
  return `<span class="tag decision-category-badge ${catCls(loan.category)}" title="${esc(label)}">${esc(label)}</span>${loan.category === 'SME' && loan.isBre ? '<span class="bre-badge-pill">BRE</span>' : ''}`;
}

function renewalStatusLineHtml(loan, rs) {
  if (loan.renewedDate) return accountLine('Sanction Date', fmtDate(loan.renewedDate || loan.sanctionDate));
  if (rs?.status === 'pending-renewal') return accountLine('Status', `${rs.daysOverdue} days overdue${rs.daysUntilNpa >= 0 ? ` • ${rs.daysUntilNpa} days to NPA` : ''}`, 'alert');
  if (rs?.status === 'due-soon') return accountLine('Status', `Due in ${rs.daysUntilDue} days`, 'warn');
  if (rs?.status === 'npa') return accountLine('Status', `${rs.daysOverdue} days overdue • NPA`, 'alert');
  return '';
}

function renewalDateAccountLine(label, loan, key, fallback = '') {
  const pendingKey = key === 'renewalDueDate' ? 'renewalDueDatePending' : 'limitExpiryDatePending';
  const enteredKey = key === 'renewalDueDate' ? 'renewalDueDateEntered' : 'limitExpiryDateEntered';
  const missingNextDate = !!loan.renewedDate && loan[enteredKey] !== true;
  if (missingNextDate) return accountLine(label, '-', 'warn');
  return accountLine(label, fmtDate(loan[key] || fallback));
}

function inlineRenewalEditHtml(draft, stagedRenewal, rs) {
  const isSme = draft.category === 'SME';
  const breEligible = isSme && parseFloat(draft.amount) > 10;
  const officerOptions = [{ value: '', label: 'Select officer' }, ...S.officers.map(o => ({ value: o, label: o }))];
  const branchOptions = [{ value: '', label: 'Select branch' }, ...S.branches.map(b => ({ value: b, label: b }))];
  const preview = { ...draft, renewedDate: stagedRenewal === 'renewed' ? (draft.sanctionDate || draft.renewedDate || todayStr()) : '' };
  return `<div class="decision-account-card decision-account-card--editing">
    <div class="decision-account-main">
      <div class="decision-name-row decision-name-row--edit">
        <label class="decision-name decision-name--edit" title="Customer Name">
          <input data-draft="customerName" type="text" value="${esc(draft.customerName)}" autocomplete="off">
        </label>
        <select class="decision-category-select ${catCls(draft.category)}" aria-label="Category" data-draft="category">${inlineSelect(CATEGORY_OPTIONS, draft.category)}</select>
        <label class="decision-amount decision-amount--edit" title="Amount (L)">
          <input data-draft="amount" type="number" step="0.01" min="0" value="${esc(draft.amount)}">
        </label>
      </div>
      <div class="decision-account-lines decision-account-lines--edit">
        ${inlineAccountEditLine('Branch', `<select aria-label="Branch" data-draft="branch">${inlineSelect(branchOptions, matchBranchOption(draft.branch) || draft.branch)}</select>`)}
        ${inlineAccountEditLine('Officer', `<select aria-label="Officer" data-draft="allocatedTo">${inlineSelect(officerOptions, draft.allocatedTo)}</select>`)}
        ${isSme ? inlineAccountEditLine('Loan Facility', `<select aria-label="Loan Facility" data-draft="loanType">${inlineSelect(LOAN_TYPE_OPTIONS, draft.loanType)}</select>`) : ''}
        ${breEligible ? inlineAccountEditLine('BRE', `<input aria-label="Sanctioned through BRE" type="checkbox" data-draft="isBre" ${draft.isBre ? 'checked' : ''} style="width:18px;height:18px;">`) : ''}
        ${inlineAccountEditLine('A/C No.', `<input aria-label="Account Number" data-draft="acNumber" type="text" inputmode="numeric" value="${esc(draft.acNumber)}" placeholder="Account number">`)}
        ${inlineAccountEditLine('Renewal Due', `<input aria-label="Renewal Due Date" data-draft="nextRenewalDueDate" type="date" value="${esc(draft.nextRenewalDueDate)}">`, !draft.nextRenewalDueDate && stagedRenewal === 'renewed' ? 'warn' : '')}
        ${inlineAccountEditLine('Limit Expiry', `<input aria-label="Limit Expiry Date" data-draft="nextLimitExpiryDate" type="date" value="${esc(draft.nextLimitExpiryDate)}">`, !draft.nextLimitExpiryDate && stagedRenewal === 'renewed' ? 'warn' : '')}
        ${stagedRenewal === 'renewed' ? inlineAccountEditLine('Sanction Date', `<input aria-label="Sanction Date" data-draft="sanctionDate" type="date" value="${esc(draft.sanctionDate || todayStr())}">`) : renewalStatusLineHtml(preview, rs)}
      </div>
    </div>
  </div>`;
}

function inlineEditHtml(draft, status) {
  const isSme = draft.category === 'SME';
  const showRenewalDue = isSme && !!draft.renewalDueDate;
  const showLimitExpiry = isSme && !!draft.limitExpiryDate;
  const breEligible = isSme && parseFloat(draft.amount) > 10;
  const officerOptions = [{ value: '', label: 'Select officer' }, ...S.officers.map(o => ({ value: o, label: o }))];
  const branchOptions = [{ value: '', label: 'Select branch' }, ...S.branches.map(b => ({ value: b, label: b }))];
  return `<div class="decision-account-card decision-account-card--editing">
    <div class="decision-account-main">
      <div class="decision-name-row decision-name-row--edit">
        <label class="decision-name decision-name--edit" title="Customer Name">
          <input data-draft="customerName" type="text" value="${esc(draft.customerName)}" autocomplete="off">
        </label>
        <select class="decision-category-select ${catCls(draft.category)}" aria-label="Category" data-draft="category">${inlineSelect(CATEGORY_OPTIONS, draft.category)}</select>
        <label class="decision-amount decision-amount--edit" title="Amount (L)">
          <input data-draft="amount" type="number" step="0.01" min="0" value="${esc(draft.amount)}">
        </label>
      </div>
      <div class="decision-account-lines decision-account-lines--edit">
        ${inlineAccountEditLine('Branch', `<select aria-label="Branch" data-draft="branch">${inlineSelect(branchOptions, matchBranchOption(draft.branch) || draft.branch)}</select>`)}
        ${inlineAccountEditLine('Officer', `<select aria-label="Officer" data-draft="allocatedTo">${inlineSelect(officerOptions, draft.allocatedTo)}</select>`)}
        ${isSme ? inlineAccountEditLine('Loan Facility', `<select aria-label="Loan Facility" data-draft="loanType">${inlineSelect(LOAN_TYPE_OPTIONS, draft.loanType)}</select>`) : ''}
        ${breEligible ? inlineAccountEditLine('BRE', `<input aria-label="Sanctioned through BRE" type="checkbox" data-draft="isBre" ${draft.isBre ? 'checked' : ''} style="width:18px;height:18px;">`) : ''}
        ${inlineAccountEditLine('Received', `<input aria-label="Receive Date" data-draft="receiveDate" type="date" value="${esc(draft.receiveDate)}">`)}
        ${status === 'sanctioned' ? inlineAccountEditLine('Sanction Date', `<input data-draft="sanctionDate" type="date" value="${esc(draft.sanctionDate || todayStr())}">`) : ''}
        ${status === 'returned' ? inlineAccountEditLine('Return Date', `<input aria-label="Return Date" data-draft="returnedDate" type="date" value="${esc(draft.returnedDate || todayStr())}">`, 'alert') : ''}
        ${showRenewalDue ? inlineAccountEditLine('Renewal Due', `<input aria-label="Renewal Due Date" data-draft="renewalDueDate" type="date" value="${esc(draft.renewalDueDate)}">`) : ''}
        ${showLimitExpiry ? inlineAccountEditLine('Limit Expiry', `<input aria-label="Limit Expiry Date" data-draft="limitExpiryDate" type="date" value="${esc(draft.limitExpiryDate)}">`) : ''}
        ${status === 'pending' ? accountLine('Ageing', `${daysPending(draft.receiveDate)} ${daysPending(draft.receiveDate) === 1 ? 'day' : 'days'}`, daysPending(draft.receiveDate) > 7 ? 'alert' : '') : ''}
        ${status === 'pending' || status === 'returned' ? inlineAccountEditLine('Remarks', `<textarea aria-label="Remarks" data-draft="remarks" rows="2" placeholder="Additional notes">${esc(draft.remarks)}</textarea>`, status === 'returned' ? 'alert' : '') : ''}
      </div>
    </div>
  </div>`;
}

function updateDraftFromControl(draft, control) {
  const key = control.dataset.draft;
  if (!key) return;
  const value = control.type === 'checkbox' ? control.checked : control.value;
  if (key === 'category') {
    draft.category = value;
    if (value !== 'SME') {
      draft.loanType = 'CC';
      draft.isBre = false;
    }
    return;
  }
  draft[key] = value;
  if (key === 'branch') {
    const branch = matchBranchOption(value) || value;
    draft.branch = branch;
    const officer = assignedOfficerForBranch(branch);
    if (officer) draft.allocatedTo = officer;
  }
}

function bindInlineDraftControls(container, draft, onStructuralChange) {
  container.querySelectorAll('[data-draft]').forEach(control => {
    const structural = ['branch', 'category', 'amount'].includes(control.dataset.draft);
    const update = () => updateDraftFromControl(draft, control);
    control.addEventListener('input', () => {
      if (control.tagName !== 'SELECT' && control.type !== 'checkbox') update();
    });
    control.addEventListener('change', () => {
      update();
      if (structural) onStructuralChange?.();
    });
  });
}

function loanAccountCardHtml(loan, linesHtml) {
  return `<div class="decision-account-card">
    <div class="decision-account-main">
      <div class="decision-name-row">
        <div class="decision-name-wrap">
          <div class="decision-name">${esc(loan.customerName)}</div>
          ${categoryBadgeHtml(loan)}
        </div>
        <div class="decision-amount">${accountAmount(loan)}</div>
      </div>
      <div class="decision-account-lines">${linesHtml}</div>
    </div>
  </div>`;
}

function renewalDecisionLines(loan, rs) {
  const rows = [
    accountLine('Branch', loan.branch),
    accountLine('Officer', effectiveOfficer(loan)),
    accountLine('A/C No.', loan.acNumber),
    renewalDateAccountLine('Renewal Due', loan, 'renewalDueDate', rs?.dueDateStr),
    renewalDateAccountLine('Limit Expiry', loan, 'limitExpiryDate'),
  ];
  if (loan.renewedDate) rows.push(accountLine('Sanction Date', fmtDate(loan.renewedDate || loan.sanctionDate)));
  else if (rs?.status === 'pending-renewal') rows.push(accountLine('Status', `${rs.daysOverdue} days overdue${rs.daysUntilNpa >= 0 ? ` • ${rs.daysUntilNpa} days to NPA` : ''}`, 'alert'));
  else if (rs?.status === 'due-soon') rows.push(accountLine('Status', `Due in ${rs.daysUntilDue} days`, 'warn'));
  else if (rs?.status === 'npa') rows.push(accountLine('Status', `${rs.daysOverdue} days overdue • NPA`, 'alert'));
  if (!loan.renewedDate && loan.renewalNotPossible) {
    rows.push(accountLine('Renewal', 'Not possible', 'alert'));
    rows.push(accountLine('Reason', loan.renewalNotPossibleRemarks || 'No reason recorded', 'alert'));
  }
  return rows.join('');
}

function activityRowsHtml(loanId) {
  const entries = S.notifications.filter(n => n.loanId === loanId).slice(0, 12);
  if (!entries.length) {
    return `<div class="decision-activity-empty">No activity recorded yet.</div>`;
  }
  const icons = { added: '+', sanctioned: '&#10003;', returned: '&#8617;', edited: '&#9998;', reminder: '&#9993;' };
  const labels = { added: 'Added', sanctioned: 'Sanctioned', returned: 'Returned', edited: 'Updated', reminder: 'Reminder mail' };
  return entries.map(n => `<div class="decision-activity-row">
    <span class="decision-activity-icon decision-activity-${esc(n.type)}">${icons[n.type] || '•'}</span>
    <span class="decision-activity-main">
      <b>${labels[n.type] || esc(n.type)}</b>
      <small>by ${esc(n.by || '?')}</small>
    </span>
    <span class="decision-activity-time">${timeAgo(n.timestamp)}</span>
  </div>`).join('');
}

function closeOnBackdrop(e) {
  if (e.target?.classList?.contains('decision-overlay')) window.closeDecisionSheet();
}

function optionLeft(options, value) {
  const idx = Math.max(0, options.findIndex(o => o.value === value));
  if (options.length === 2) return idx === 0 ? 25 : 75;
  return [16.67, 50, 83.33][idx] || 50;
}

function sliderHtml(options, selected, type) {
  const cols = `repeat(${options.length},1fr)`;
  return `<div class="decision-slider decision-slider--${type}" data-type="${esc(type)}" data-selected="${esc(selected)}" style="--decision-cols:${cols};--thumb-left:${optionLeft(options, selected)}%;">
    <div class="decision-slider-labels">
      ${options.map(o => `<button type="button" class="${o.value}" data-decision-value="${esc(o.value)}">${esc(o.label)}</button>`).join('')}
    </div>
    <button type="button" class="decision-slider-thumb" data-decision-thumb><span>&lsaquo;</span><b>${esc(options.find(o => o.value === selected)?.label || '')}</b><span>&rsaquo;</span></button>
  </div>`;
}

function setDecisionSelected(overlay, value, opts = {}) {
  const slider = overlay.querySelector('.decision-slider');
  if (!slider) return;
  const options = [...slider.querySelectorAll('[data-decision-value]')].map(btn => ({ value: btn.dataset.decisionValue, label: btn.textContent.trim() }));
  const selected = options.find(o => o.value === value) || options[0];
  slider.dataset.selected = selected.value;
  slider.classList.remove('decision-slider--selected-returned', 'decision-slider--selected-pending', 'decision-slider--selected-sanctioned', 'decision-slider--selected-renewed');
  slider.classList.add(`decision-slider--selected-${selected.value}`);
  if (opts.snap !== false) slider.style.setProperty('--thumb-left', `${optionLeft(options, selected.value)}%`);
  const thumbLabel = slider.querySelector('[data-decision-thumb] b');
  if (thumbLabel) thumbLabel.textContent = selected.label;
  slider.querySelectorAll('[data-decision-value]').forEach(btn => btn.classList.toggle('active', btn.dataset.decisionValue === selected.value));
  overlay.querySelector('.decision-return-note')?.classList.toggle('show', selected.value === 'returned');
  if (opts.emit !== false) {
    slider.dispatchEvent(new CustomEvent('decisionchange', { bubbles: true, detail: { value: selected.value } }));
  }
}

function updateLoanDecisionView(overlay, loan, status) {
  const pill = overlay.querySelector('.decision-status-pill');
  if (pill) {
    pill.className = `decision-status-pill decision-status-pill--${status}`;
    pill.textContent = status[0].toUpperCase() + status.slice(1);
  }
  const lines = overlay.querySelector('.decision-account-lines');
  if (lines) lines.innerHTML = loanDecisionLines(loan);
}

function updateDecisionStatusPill(overlay, status) {
  const pill = overlay.querySelector('.decision-status-pill');
  if (!pill) return;
  pill.className = `decision-status-pill decision-status-pill--${status}`;
  pill.textContent = status[0].toUpperCase() + status.slice(1);
}

export function initDecisionSheet(overlay, options, selected) {
  setDecisionSelected(overlay, selected, { emit: false });
  overlay.addEventListener('click', e => {
    const btn = e.target.closest('[data-decision-value]');
    if (btn) setDecisionSelected(overlay, btn.dataset.decisionValue);
  });
  const slider = overlay.querySelector('.decision-slider');
  const thumb = overlay.querySelector('[data-decision-thumb]');
  if (!slider || !thumb) return;
  const positionFromPointer = clientX => {
    const rect = slider.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return { ratio, percent: ratio * 100 };
  };
  const dragTo = clientX => {
    const { ratio, percent } = positionFromPointer(clientX);
    const min = options.length === 2 ? 25 : 16.67;
    const max = options.length === 2 ? 75 : 83.33;
    slider.style.setProperty('--thumb-left', `${Math.max(min, Math.min(max, percent))}%`);
    const idx = Math.max(0, Math.min(options.length - 1, Math.round(ratio * (options.length - 1))));
    setDecisionSelected(overlay, options[idx].value, { snap: false });
  };
  const settle = clientX => {
    const { ratio } = positionFromPointer(clientX);
    const idx = Math.max(0, Math.min(options.length - 1, Math.round(ratio * (options.length - 1))));
    setDecisionSelected(overlay, options[idx].value);
  };
  thumb.addEventListener('pointerdown', e => {
    thumb.setPointerCapture(e.pointerId);
    thumb.dataset.dragging = '1';
    slider.classList.add('dragging');
    dragTo(e.clientX);
  });
  thumb.addEventListener('pointermove', e => {
    if (thumb.dataset.dragging === '1') dragTo(e.clientX);
  });
  thumb.addEventListener('pointerup', e => {
    thumb.dataset.dragging = '';
    slider.classList.remove('dragging');
    settle(e.clientX);
  });
  thumb.addEventListener('pointercancel', () => {
    thumb.dataset.dragging = '';
    slider.classList.remove('dragging');
    setDecisionSelected(overlay, slider.dataset.selected);
  });
}

window.closeDecisionSheet = function() {
  document.querySelectorAll('.decision-overlay').forEach(el => animateOverlayOut(el));
};

window.closeDecisionActivity = function() {
  document.querySelectorAll('.decision-activity-overlay').forEach(el => animateOverlayOut(el));
};

window.openDecisionActivity = function(id) {
  const loan = S.loans.find(x => x.id === id);
  if (!loan) return;
  window.closeDecisionActivity();
  const overlay = document.createElement('div');
  overlay.className = 'overlay decision-activity-overlay';
  overlay.addEventListener('click', e => {
    if (e.target?.classList?.contains('decision-activity-overlay')) window.closeDecisionActivity();
  });
  overlay.innerHTML = `<div class="sheet decision-sheet decision-activity-sheet" role="dialog" aria-modal="true" aria-label="Activity">
    <div class="sheet-handle"></div>
    <div class="decision-title-row">
      <h2>Activity</h2>
      <button type="button" class="decision-mini-btn" onclick="closeDecisionActivity()">Close</button>
    </div>
    <p class="decision-copy">${esc(loan.customerName || 'Loan account')}</p>
    <div class="decision-activity-list">${activityRowsHtml(id)}</div>
  </div>`;
  document.body.appendChild(overlay); animateOverlayIn(overlay);
};

window.openLoanDecisionSheet = function(id, preferredStatus = null) {
  const loan = S.loans.find(x => x.id === id);
  if (!loan) return;
  window.closeDecisionSheet();
  const current = loan.status || 'pending';
  let stagedStatus = preferredStatus || current;
  let editMode = false;
  const draft = cloneLoanDraft(loan);
  const options = [
    { value: 'returned', label: 'Return' },
    { value: 'pending', label: 'Pending' },
    { value: 'sanctioned', label: 'Sanction' },
  ];
  const overlay = document.createElement('div');
  overlay.className = 'overlay decision-overlay';
  overlay.addEventListener('click', closeOnBackdrop);
  overlay.innerHTML = `<div class="sheet decision-sheet" role="dialog" aria-modal="true" aria-label="Loan status">
    <div class="sheet-handle"></div>
    <div class="decision-title-row">
      <h2>Loan status</h2>
      <span class="decision-title-actions">
        <button type="button" class="decision-mini-btn" onclick="openDecisionActivity('${esc(id)}')">Activity</button>
        ${S.isAdmin ? `<button type="button" class="decision-icon-btn decision-icon-btn--danger" title="Delete loan" onclick="closeDecisionSheet();deleteLoan('${esc(id)}')">&#128465;</button>` : ''}
        <button type="button" class="decision-icon-btn" title="Edit loan" data-decision-edit>&#9998;</button>
      </span>
    </div>
    <div data-decision-card></div>
    <div class="decision-outcome-block">
      ${sliderHtml(options, stagedStatus, 'loan')}
    </div>
    <div class="decision-action-row">
      <button type="button" class="btn btn-cancel-full" onclick="closeDecisionSheet()">Cancel</button>
      <button type="button" class="btn btn-primary-full" data-decision-save>Save</button>
    </div>
  </div>`;
  document.body.appendChild(overlay); animateOverlayIn(overlay);
  initDecisionSheet(overlay, options, stagedStatus);
  const card = overlay.querySelector('[data-decision-card]');
  const editBtn = overlay.querySelector('[data-decision-edit]');
  const renderCard = () => {
    const preview = previewLoanStatus(loanFromDraft(loan, draft, stagedStatus), stagedStatus, draft.remarks);
    if (editMode) {
      card.innerHTML = inlineEditHtml(draft, stagedStatus);
      bindInlineDraftControls(card, draft, renderCard);
    } else {
      card.innerHTML = loanAccountCardHtml(preview, loanDecisionLines(preview));
      bindInlineDraftControls(card, draft, () => {});
    }
    editBtn?.classList.toggle('active', editMode);
    editBtn?.setAttribute('aria-pressed', editMode ? 'true' : 'false');
    if (editMode) updateDecisionStatusPill(overlay, stagedStatus);
    else updateLoanDecisionView(overlay, preview, stagedStatus);
    setDecisionSelected(overlay, stagedStatus, { emit: false });
  };
  editBtn?.addEventListener('click', () => {
    editMode = !editMode;
    renderCard();
  });
  const onReminderChange = e => {
    if (!overlay.isConnected) { document.removeEventListener('remindermailschange', onReminderChange); return; }
    if (e.detail?.id === id) renderCard();
  };
  document.addEventListener('remindermailschange', onReminderChange);
  overlay.addEventListener('decisionchange', e => {
    stagedStatus = e.detail?.value || stagedStatus;
    if (overlay.querySelector('.decision-slider.dragging')) {
      updateDecisionStatusPill(overlay, stagedStatus);
      return;
    }
    renderCard();
  });
  renderCard();
  overlay.querySelector('[data-decision-save]')?.addEventListener('click', async () => {
    // This will be handled by loan-actions.js via an imported function
    import("./loan-actions.js").then(module => {
      module.saveInlineLoan(loan, draft, stagedStatus).then(saved => {
        if (saved) window.closeDecisionSheet();
      });
    });
  });
};

window.openRenewalDecisionSheet = function(id) {
  const loan = S.loans.find(x => x.id === id);
  if (!loan) return;
  window.closeDecisionSheet();
  const current = loan.renewedDate ? 'renewed' : 'pending';
  let stagedRenewal = current;
  let editMode = false;
  let renewalDateInitialized = current === 'renewed';
  const draft = cloneLoanDraft(loan);
  const options = [
    { value: 'pending', label: 'Pending' },
    { value: 'renewed', label: 'Renewed' },
  ];
  const overlay = document.createElement('div');
  overlay.className = 'overlay decision-overlay';
  overlay.addEventListener('click', closeOnBackdrop);
  overlay.innerHTML = `<div class="sheet decision-sheet" role="dialog" aria-modal="true" aria-label="Renewal status">
    <div class="sheet-handle"></div>
    <div class="decision-title-row">
      <h2>Renewal status</h2>
      <span class="decision-title-actions">
        <button type="button" class="decision-mini-btn" onclick="openDecisionActivity('${esc(id)}')">Activity</button>
        ${S.isAdmin ? `<button type="button" class="decision-icon-btn decision-icon-btn--danger" title="Delete loan" onclick="closeDecisionSheet();deleteLoan('${esc(id)}')">&#128465;</button>` : ''}
        <button type="button" class="decision-icon-btn" title="Edit loan" data-decision-edit>&#9998;</button>
      </span>
    </div>
    <div data-decision-card></div>
    <div class="decision-outcome-block">
      ${sliderHtml(options, current, 'renewal')}
    </div>
    <div class="decision-rnp-block" data-rnp-block style="${current === 'renewed' ? 'display:none;' : ''}">
      <label class="decision-rnp-toggle">
        <input type="checkbox" data-rnp-checkbox ${draft.renewalNotPossible ? 'checked' : ''}>
        <span>Renewal not possible</span>
      </label>
      <textarea data-rnp-remarks rows="2" placeholder="Reason (unit closed, account under litigation, etc.)" style="${draft.renewalNotPossible ? '' : 'display:none;'}">${esc(draft.renewalNotPossibleRemarks)}</textarea>
    </div>
    <div class="decision-action-row">
      <button type="button" class="btn btn-cancel-full" onclick="closeDecisionSheet()">Cancel</button>
      <button type="button" class="btn btn-primary-full" data-decision-save>Save</button>
    </div>
  </div>`;
  document.body.appendChild(overlay); animateOverlayIn(overlay);
  initDecisionSheet(overlay, options, current);
  const card = overlay.querySelector('[data-decision-card]');
  const editBtn = overlay.querySelector('[data-decision-edit]');
  const pill = overlay.querySelector('.decision-status-pill');
  const rnpBlock = overlay.querySelector('[data-rnp-block]');
  const rnpCheckbox = overlay.querySelector('[data-rnp-checkbox]');
  const rnpRemarks = overlay.querySelector('[data-rnp-remarks]');
  const renderCard = () => {
    const preview = loanFromDraft(loan, draft, loan.status || 'pending');
    const renewalDate = draft.sanctionDate || draft.renewedDate || todayStr();
    preview.renewedDate = stagedRenewal === 'renewed' ? renewalDate : '';
    if (stagedRenewal === 'renewed') preview.sanctionDate = renewalDate;
    const previewRs = computeRenewalStatus(preview);
    if (editMode) {
      card.innerHTML = inlineRenewalEditHtml(draft, stagedRenewal, previewRs);
      bindInlineDraftControls(card, draft, renderCard);
    } else {
      card.innerHTML = loanAccountCardHtml(preview, renewalDecisionLines(preview, previewRs));
    }
    if (pill) pill.textContent = stagedRenewal === 'renewed' ? 'Renewed' : (previewRs?.status === 'pending-renewal' ? 'Overdue' : previewRs?.status === 'due-soon' ? 'Due Soon' : previewRs?.status === 'npa' ? 'NPA' : 'Pending');
    editBtn?.classList.toggle('active', editMode);
    editBtn?.setAttribute('aria-pressed', editMode ? 'true' : 'false');
    if (rnpBlock) rnpBlock.style.display = stagedRenewal === 'renewed' ? 'none' : '';
    setDecisionSelected(overlay, stagedRenewal, { emit: false });
  };
  editBtn?.addEventListener('click', () => {
    editMode = !editMode;
    renderCard();
  });
  rnpCheckbox?.addEventListener('change', () => {
    draft.renewalNotPossible = rnpCheckbox.checked;
    if (rnpRemarks) {
      rnpRemarks.style.display = rnpCheckbox.checked ? '' : 'none';
      if (rnpCheckbox.checked) rnpRemarks.focus();
    }
    renderCard();
  });
  rnpRemarks?.addEventListener('input', () => {
    draft.renewalNotPossibleRemarks = rnpRemarks.value;
  });
  overlay.addEventListener('decisionchange', e => {
    const newStaged = e.detail?.value || stagedRenewal;
    if (newStaged === 'renewed' && stagedRenewal !== 'renewed') {
      if (!renewalDateInitialized) {
        draft.sanctionDate = todayStr();
        draft.renewedDate = todayStr();
        renewalDateInitialized = true;
      }
    }
    stagedRenewal = newStaged;
    if (overlay.querySelector('.decision-slider.dragging')) {
      if (pill) pill.textContent = stagedRenewal === 'renewed' ? 'Renewed' : 'Pending';
      return;
    }
    renderCard();
  });
  renderCard();
  overlay.querySelector('[data-decision-save]')?.addEventListener('click', async () => {
    // This will be handled by loan-actions.js via an imported function
    import("./loan-actions.js").then(module => {
      module.saveInlineLoan(loan, draft, loan.status || 'pending', { renewalState: stagedRenewal }).then(saved => {
        if (saved) window.closeDecisionSheet();
      });
    });
  });
};
