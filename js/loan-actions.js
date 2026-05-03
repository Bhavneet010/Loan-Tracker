import { S } from "./state.js";
import { updateLoan, createLoan, removeLoan } from "./db.js";
import { createNotification } from "./notifications.js";
import { todayStr, showUndoToast, toast, esc, branchCode, fmtAmt, fmtDate, catCls, daysPending, computeRenewalStatus, timeAgo } from "./utils.js";
import { db } from "./config.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

import { getBranchSearchInput, getBranchValueInput, getCategorySelect, normalizeName, normalizeBranchText, recentBranches, saveRecentBranch, branchesForUser, branchLabel, duplicateCardHtml, populateFormOptions, renderCategoryChips, updateCategoryHint, setCategoryValue, matchBranchOption, assignedOfficerForBranch, setAdvancedFieldsVisible, setFormEntryMode, updateAssignedOfficerHint, updateBranchMatchHint, renderBranchQuickPicks, setBranchValue, fillFormFromLoan, getDuplicateMatches, showDuplicateModal, confirmPotentialDuplicate, RECENT_BRANCHES_KEY, duplicateDecisionResolve } from "./ui-forms.js";

/* CORE LOAN ACTIONS */
window.sanctionLoan = async function(id) {
  window.openLoanDecisionSheet(id, 'sanctioned');
};

window.returnLoan = async function(id) {
  window.openLoanDecisionSheet(id, 'returned');
};

window.moveToPending = async function(id) {
  window.openLoanDecisionSheet(id, 'pending');
};

async function applyLoanStatus(id, nextStatus, remarks = '') {
  const l = S.loans.find(x => x.id === id);
  if (!l || !nextStatus) return null;
  const data = { status: nextStatus };
  if (nextStatus === 'sanctioned') {
    data.sanctionDate = l.sanctionDate || todayStr();
  } else if (nextStatus === 'returned') {
    data.returnedDate = l.returnedDate || todayStr();
    data.remarks = remarks.trim();
  }
  const noStatusChange = nextStatus === l.status;
  const noRemarkChange = nextStatus !== 'returned' || (data.remarks || '') === (l.remarks || '');
  if (noStatusChange && noRemarkChange) return null;
  try {
    await updateLoan(id, data);
    if (nextStatus === 'sanctioned') createNotification('sanctioned', { ...l, ...data }).catch(() => {});
    else if (nextStatus === 'returned') createNotification('returned', { ...l, ...data }).catch(() => {});
    toast(nextStatus === 'sanctioned' ? 'Sanctioned ✓' : nextStatus === 'returned' ? 'Marked as returned' : 'Moved to pending');
    Object.assign(l, data);
    return data;
  } catch (e) {
    toast('Error');
    console.error(e);
    return null;
  }
}

async function applyRenewalStatus(id, renewed) {
  const l = S.loans.find(x => x.id === id);
  if (!l) return false;
  if (renewed) {
    window.closeDecisionSheet();
    window.openForm({ ...l, renewedDate: l.renewedDate || todayStr() }, 'renewal-done', { entryMode: 'full' });
    return true;
  }
  try {
    await updateLoan(id, { renewedDate: '', renewalDatesPending: false });
    toast('Renewal moved to pending');
    return true;
  } catch (e) {
    toast('Error');
    console.error(e);
    return false;
  }
}

function buildInlineSaveData(base, draft, status, { renewalState = null } = {}) {
  const branch = matchBranchOption(draft.branch);
  const assignedOfficer = assignedOfficerForBranch(branch);
  const selectedOfficer = draft.allocatedTo || assignedOfficer || (S.user && !S.isAdmin ? S.user : '');
  const customerName = normalizeName(draft.customerName);
  if (!draft.category) return { error: 'Pick a category first' };
  if (!branch) return { error: 'Pick a valid branch first' };
  if (!selectedOfficer) return { error: 'Select or assign an officer first' };
  if (!customerName) return { error: 'Customer name is required' };
  if (!(parseFloat(draft.amount) > 0)) return { error: 'Enter a valid amount' };

  const data = {
    allocatedTo: selectedOfficer,
    category: draft.category,
    branch,
    customerName,
    amount: parseFloat(draft.amount),
    receiveDate: draft.receiveDate || todayStr(),
    remarks: (draft.remarks || '').trim(),
  };
  if (draft.acNumber !== undefined) data.acNumber = (draft.acNumber || '').trim();

  if (status) data.status = status;
  if (status === 'sanctioned') data.sanctionDate = draft.sanctionDate || base.sanctionDate || todayStr();
  else if (draft.sanctionDate) data.sanctionDate = draft.sanctionDate;
  if (status === 'returned') data.returnedDate = base.returnedDate || todayStr();

  if (draft.category === 'SME') {
    data.isTermLoan = !!draft.isTermLoan;
    const isImported = (base && base.isImported) || (base?.id && base.id.startsWith('import_sme_csv_'));
    data.isFreshCC = !isImported;
    if (isImported) data.isImported = true;
    else data.manuallyCreated = true;
    data.renewalDueDate = draft.renewalDueDate || '';
    data.limitExpiryDate = draft.limitExpiryDate || '';
    if (data.renewalDueDate && data.limitExpiryDate) data.renewalDatesPending = false;
  } else {
    data.isTermLoan = false;
  }

  if (renewalState === 'renewed') {
    data.renewedDate = draft.renewedDate || base.renewedDate || todayStr();
    data.renewalDatesPending = !(draft.renewalDueDate && draft.limitExpiryDate);
  } else if (renewalState === 'pending') {
    data.renewedDate = '';
    data.renewalDatesPending = false;
  }

  return { data, duplicateCheck: { id: base.id, customerName, branch } };
}

async function saveInlineLoan(base, draft, status, opts = {}) {
  const built = buildInlineSaveData(base, draft, status, opts);
  if (built.error) {
    toast(built.error);
    return false;
  }
  if (!await confirmPotentialDuplicate(built.duplicateCheck)) return false;
  try {
    await updateLoan(base.id, built.data);
    createNotification('edited', { ...built.data, id: base.id }).catch(() => {});
    if (status && status !== base.status) {
      if (status === 'sanctioned') createNotification('sanctioned', { ...base, ...built.data }).catch(() => {});
      if (status === 'returned') createNotification('returned', { ...base, ...built.data }).catch(() => {});
    }
    Object.assign(base, built.data);
    saveRecentBranch(built.data.branch);
    toast('Loan updated ✓');
    return true;
  } catch (e) {
    toast('Error saving');
    console.error(e);
    return false;
  }
}

function accountAmount(loan) {
  return `₹${fmtAmt(loan.amount)}<span> L</span>`;
}

function cloneLoanDraft(loan) {
  return {
    allocatedTo: loan.allocatedTo || '',
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
    remarks: loan.remarks || '',
    isTermLoan: !!loan.isTermLoan,
  };
}

function loanFromDraft(base, draft, status = base.status || 'pending') {
  const loan = {
    ...base,
    ...draft,
    status,
    customerName: normalizeName(draft.customerName),
    amount: parseFloat(draft.amount) || 0,
  };
  if (status === 'sanctioned') loan.sanctionDate = draft.sanctionDate || base.sanctionDate || todayStr();
  if (status === 'returned') {
    loan.returnedDate = base.returnedDate || todayStr();
    loan.remarks = draft.remarks || '';
  }
  return loan;
}

function accountLine(label, value, tone = '') {
  if (!value) return '';
  const cls = tone ? ` decision-account-line--${esc(tone)}` : '';
  const mark = tone ? '<span class="decision-account-alert">!</span>' : '';
  return `<div class="decision-account-line${cls}"><small>${esc(label)}</small><b>${esc(value)}</b>${mark}</div>`;
}

function loanDecisionLines(loan) {
  const rows = [
    accountLine('Branch', loan.branch),
    accountLine('Officer', loan.allocatedTo),
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

function inlineField(label, html, cls = '') {
  return `<label class="decision-edit-field ${cls}"><small>${esc(label)}</small>${html}</label>`;
}

function inlineAccountEditLine(label, html, tone = '') {
  const cls = tone ? ` decision-account-line--${esc(tone)}` : '';
  return `<div class="decision-account-line decision-account-line--edit${cls}">
    <small>${esc(label)}</small>
    <span class="decision-edit-control">${html}</span>
    <span></span>
  </div>`;
}

function categoryModeValue(loan) {
  if (loan.category === 'SME' && loan.isTermLoan) return 'SME_TERM';
  return loan.category || '';
}

function categoryBadgeHtml(loan) {
  const label = loan.category === 'SME' && loan.isTermLoan ? 'SME TL' : (loan.category || 'Loan');
  return `<span class="decision-category-badge ${catCls(loan.category)}" title="${esc(label)}">${esc(label)}</span>`;
}

function renewalStatusLineHtml(loan, rs) {
  if (loan.renewedDate) return accountLine('Renewed Date', fmtDate(loan.renewedDate));
  if (rs?.status === 'pending-renewal') return accountLine('Status', `${rs.daysOverdue} days overdue${rs.daysUntilNpa >= 0 ? ` • ${rs.daysUntilNpa} days to NPA` : ''}`, 'alert');
  if (rs?.status === 'due-soon') return accountLine('Status', `Due in ${rs.daysUntilDue} days`, 'warn');
  if (rs?.status === 'npa') return accountLine('Status', `${rs.daysOverdue} days overdue • NPA`, 'alert');
  return '';
}

function inlineRenewalEditHtml(draft, stagedRenewal, rs) {
  const categoryOptions = [
    { value: '', label: 'Category' },
    { value: 'Agriculture', label: 'Agriculture' },
    { value: 'SME', label: 'SME' },
    { value: 'SME_TERM', label: 'SME Term Loan' },
    { value: 'Education', label: 'Education' },
  ];
  const officerOptions = [{ value: '', label: 'Select officer' }, ...S.officers.map(o => ({ value: o, label: o }))];
  const branchOptions = [{ value: '', label: 'Select branch' }, ...S.branches.map(b => ({ value: b, label: b }))];
  const preview = { ...draft, renewedDate: stagedRenewal === 'renewed' ? (draft.renewedDate || todayStr()) : '' };
  return `<div class="decision-account-card decision-account-card--editing">
    <div class="decision-account-main">
      <div class="decision-name-row decision-name-row--edit">
        <label class="decision-name decision-name--edit" title="Customer Name">
          <input data-draft="customerName" type="text" value="${esc(draft.customerName)}" autocomplete="off">
        </label>
        <select class="decision-category-select ${catCls(draft.category)}" aria-label="Category" data-draft="categoryMode">${inlineSelect(categoryOptions, categoryModeValue(draft))}</select>
        <label class="decision-amount decision-amount--edit" title="Amount (L)">
          <input data-draft="amount" type="number" step="0.01" min="0" value="${esc(draft.amount)}">
        </label>
      </div>
      <div class="decision-account-lines decision-account-lines--edit">
        ${inlineAccountEditLine('Branch', `<select aria-label="Branch" data-draft="branch">${inlineSelect(branchOptions, matchBranchOption(draft.branch) || draft.branch)}</select>`)}
        ${inlineAccountEditLine('Officer', `<select aria-label="Officer" data-draft="allocatedTo">${inlineSelect(officerOptions, draft.allocatedTo)}</select>`)}
        ${inlineAccountEditLine('A/C No.', `<input aria-label="Account Number" data-draft="acNumber" type="text" inputmode="numeric" value="${esc(draft.acNumber)}" placeholder="Account number">`)}
        ${inlineAccountEditLine('Renewal Due', `<input aria-label="Renewal Due Date" data-draft="renewalDueDate" type="date" value="${esc(draft.renewalDueDate)}">`)}
        ${inlineAccountEditLine('Limit Expiry', `<input aria-label="Limit Expiry Date" data-draft="limitExpiryDate" type="date" value="${esc(draft.limitExpiryDate)}">`)}
        ${stagedRenewal === 'renewed' ? inlineAccountEditLine('Renewed Date', `<input aria-label="Renewed Date" data-draft="renewedDate" type="date" value="${esc(draft.renewedDate || todayStr())}">`) : renewalStatusLineHtml(preview, rs)}
      </div>
    </div>
  </div>`;
}

function inlineEditHtml(draft, status, { renewal = false } = {}) {
  const isSme = draft.category === 'SME';
  const showRenewalDue = isSme && !!draft.renewalDueDate;
  const showLimitExpiry = isSme && !!draft.limitExpiryDate;
  const categoryOptions = [
    { value: '', label: 'Category' },
    { value: 'Agriculture', label: 'Agriculture' },
    { value: 'SME', label: 'SME' },
    { value: 'SME_TERM', label: 'SME Term Loan' },
    { value: 'Education', label: 'Education' },
  ];
  const officerOptions = [{ value: '', label: 'Select officer' }, ...S.officers.map(o => ({ value: o, label: o }))];
  const branchOptions = [{ value: '', label: 'Select branch' }, ...S.branches.map(b => ({ value: b, label: b }))];
  return `<div class="decision-account-card decision-account-card--editing">
    <div class="decision-account-main">
      <div class="decision-name-row decision-name-row--edit">
        <label class="decision-name decision-name--edit" title="Customer Name">
          <input data-draft="customerName" type="text" value="${esc(draft.customerName)}" autocomplete="off">
        </label>
        <select class="decision-category-select ${catCls(draft.category)}" aria-label="Category" data-draft="categoryMode">${inlineSelect(categoryOptions, categoryModeValue(draft))}</select>
        <label class="decision-amount decision-amount--edit" title="Amount (L)">
          <input data-draft="amount" type="number" step="0.01" min="0" value="${esc(draft.amount)}">
        </label>
      </div>
      <div class="decision-account-lines decision-account-lines--edit">
        ${inlineAccountEditLine('Branch', `<select aria-label="Branch" data-draft="branch">${inlineSelect(branchOptions, matchBranchOption(draft.branch) || draft.branch)}</select>`)}
        ${inlineAccountEditLine('Officer', `<select aria-label="Officer" data-draft="allocatedTo">${inlineSelect(officerOptions, draft.allocatedTo)}</select>`)}
        ${inlineAccountEditLine('Received', `<input aria-label="Receive Date" data-draft="receiveDate" type="date" value="${esc(draft.receiveDate)}">`)}
        ${status === 'sanctioned' ? inlineAccountEditLine('Sanction Date', `<input data-draft="sanctionDate" type="date" value="${esc(draft.sanctionDate || todayStr())}">`) : ''}
        ${status === 'returned' ? inlineAccountEditLine('Return Date', `<span class="decision-edit-static">${esc(fmtDate(draft.returnedDate || todayStr()))}</span>`, 'alert') : ''}
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
  if (key === 'categoryMode') {
    draft.category = value === 'SME_TERM' ? 'SME' : value;
    draft.isTermLoan = value === 'SME_TERM';
    return;
  }
  draft[key] = value;
  if (key === 'branch') {
    const branch = matchBranchOption(value) || value;
    draft.branch = branch;
    const officer = assignedOfficerForBranch(branch);
    if (officer) draft.allocatedTo = officer;
  }
  if (key === 'category' && value !== 'SME') {
    draft.isTermLoan = false;
  }
}

function bindInlineDraftControls(container, draft, onStructuralChange) {
  container.querySelectorAll('[data-draft]').forEach(control => {
    const structural = ['branch', 'category', 'categoryMode'].includes(control.dataset.draft);
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
    accountLine('Officer', loan.allocatedTo),
    accountLine('A/C No.', loan.acNumber),
    accountLine('Renewal Due', fmtDate(loan.renewalDueDate || rs?.dueDateStr)),
    accountLine('Limit Expiry', fmtDate(loan.limitExpiryDate)),
  ];
  if (loan.renewedDate) rows.push(accountLine('Renewed Date', fmtDate(loan.renewedDate)));
  else if (rs?.status === 'pending-renewal') rows.push(accountLine('Status', `${rs.daysOverdue} days overdue${rs.daysUntilNpa >= 0 ? ` • ${rs.daysUntilNpa} days to NPA` : ''}`, 'alert'));
  else if (rs?.status === 'due-soon') rows.push(accountLine('Status', `Due in ${rs.daysUntilDue} days`, 'warn'));
  else if (rs?.status === 'npa') rows.push(accountLine('Status', `${rs.daysOverdue} days overdue • NPA`, 'alert'));
  return rows.join('');
}

function activityRowsHtml(loanId) {
  const entries = S.notifications.filter(n => n.loanId === loanId).slice(0, 12);
  if (!entries.length) {
    return `<div class="decision-activity-empty">No activity recorded yet.</div>`;
  }
  const icons = { added: '+', sanctioned: '✓', returned: '↩', edited: '✎' };
  const labels = { added: 'Added', sanctioned: 'Sanctioned', returned: 'Returned', edited: 'Updated' };
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
    <button type="button" class="decision-slider-thumb" data-decision-thumb><span>‹</span><b>${esc(options.find(o => o.value === selected)?.label || '')}</b><span>›</span></button>
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

function initDecisionSheet(overlay, options, selected) {
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
  document.querySelectorAll('.decision-overlay').forEach(el => el.remove());
};

window.closeDecisionActivity = function() {
  document.querySelectorAll('.decision-activity-overlay').forEach(el => el.remove());
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
  document.body.appendChild(overlay);
};

function legacyOpenLoanDecisionSheet(id, preferredStatus = null) {
  const loan = S.loans.find(x => x.id === id);
  if (!loan) return;
  window.closeDecisionSheet();
  const current = loan.status || 'pending';
  let stagedStatus = preferredStatus || current;
  const selected = preferredStatus || current;
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
        <button type="button" class="decision-icon-btn" title="Edit loan" onclick="closeDecisionSheet();editLoan('${esc(id)}')">✎</button>
        <span class="decision-status-pill decision-status-pill--${esc(current)}">${esc(current[0].toUpperCase() + current.slice(1))}</span>
      </span>
    </div>
    <p class="decision-copy">Review the account before changing its status.</p>
    <div class="decision-account-card">
      <div class="decision-account-main">
        <div class="decision-name-row">
          <div class="decision-name">${esc(loan.customerName)}</div>
          <div class="decision-amount">${accountAmount(loan)}</div>
        </div>
        <div class="decision-account-lines">${loanDecisionLines(loan)}</div>
      </div>
    </div>
    <label class="decision-return-note">
      <span>Return remarks</span>
      <textarea id="decisionReturnRemarks" rows="2" placeholder="Reason for return">${esc(loan.remarks || '')}</textarea>
    </label>
    <div class="decision-outcome-block">
      ${sliderHtml(options, selected, 'loan')}
    </div>
    <div class="decision-action-row">
      <button type="button" class="btn btn-cancel-full" onclick="closeDecisionSheet()">Cancel</button>
      <button type="button" class="btn btn-primary-full" data-decision-save>Save</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  initDecisionSheet(overlay, options, selected);
  const updatePreview = () => {
    const remarks = overlay.querySelector('#decisionReturnRemarks')?.value || '';
    const preview = previewLoanStatus(loan, stagedStatus, remarks);
    updateLoanDecisionView(overlay, preview, stagedStatus);
  };
  overlay.addEventListener('decisionchange', e => {
    stagedStatus = e.detail?.value || stagedStatus;
    updatePreview();
  });
  overlay.querySelector('#decisionReturnRemarks')?.addEventListener('input', updatePreview);
  updatePreview();
  overlay.querySelector('[data-decision-save]')?.addEventListener('click', async () => {
    const remarks = overlay.querySelector('#decisionReturnRemarks')?.value || '';
    await applyLoanStatus(id, stagedStatus, remarks);
    window.closeDecisionSheet();
  });
};

function legacyOpenRenewalDecisionSheet(id) {
  const loan = S.loans.find(x => x.id === id);
  if (!loan) return;
  window.closeDecisionSheet();
  const rs = computeRenewalStatus(loan);
  const current = loan.renewedDate ? 'renewed' : 'pending';
  let stagedRenewal = current;
  const options = [
    { value: 'pending', label: 'Pending' },
    { value: 'renewed', label: 'Renewed' },
  ];
  const statusLabel = loan.renewedDate ? 'Renewed' : (rs?.status === 'pending-renewal' ? 'Overdue' : rs?.status === 'due-soon' ? 'Due Soon' : rs?.status === 'npa' ? 'NPA' : 'Pending');
  const overlay = document.createElement('div');
  overlay.className = 'overlay decision-overlay';
  overlay.addEventListener('click', closeOnBackdrop);
  overlay.innerHTML = `<div class="sheet decision-sheet" role="dialog" aria-modal="true" aria-label="Renewal status">
    <div class="sheet-handle"></div>
    <div class="decision-title-row">
      <h2>Renewal status</h2>
      <span class="decision-title-actions">
        <button type="button" class="decision-mini-btn" onclick="openDecisionActivity('${esc(id)}')">Activity</button>
        <button type="button" class="decision-icon-btn" title="Edit loan" onclick="closeDecisionSheet();editLoan('${esc(id)}')">✎</button>
        <span class="decision-status-pill decision-status-pill--renewal">${esc(statusLabel)}</span>
      </span>
    </div>
    <p class="decision-copy">Review the account before updating the renewal status.</p>
    <div class="decision-account-card">
      <div class="decision-account-main">
        <div class="decision-name-row">
          <div class="decision-name">${esc(loan.customerName)}</div>
          <div class="decision-amount">${accountAmount(loan)}</div>
        </div>
        <div class="decision-account-lines">${renewalDecisionLines(loan, rs)}</div>
      </div>
    </div>
    <div class="decision-outcome-block">
      ${sliderHtml(options, current, 'renewal')}
    </div>
    <div class="decision-action-row">
      <button type="button" class="btn btn-cancel-full" onclick="closeDecisionSheet()">Cancel</button>
      <button type="button" class="btn btn-primary-full" data-decision-save>Save</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  initDecisionSheet(overlay, options, current);
  overlay.addEventListener('decisionchange', e => {
    stagedRenewal = e.detail?.value || stagedRenewal;
  });
  overlay.querySelector('[data-decision-save]')?.addEventListener('click', async () => {
    if (stagedRenewal !== current) {
      const changed = await applyRenewalStatus(id, stagedRenewal === 'renewed');
      if (changed && stagedRenewal !== 'renewed') window.closeDecisionSheet();
    }
    else window.closeDecisionSheet();
  });
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
        <button type="button" class="decision-icon-btn" title="Edit loan" data-decision-edit>&#9998;</button>
        <span class="decision-status-pill decision-status-pill--${esc(current)}">${esc(current[0].toUpperCase() + current.slice(1))}</span>
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
  document.body.appendChild(overlay);
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
  overlay.addEventListener('decisionchange', e => {
    stagedStatus = e.detail?.value || stagedStatus;
    renderCard();
  });
  renderCard();
  overlay.querySelector('[data-decision-save]')?.addEventListener('click', async () => {
    const saved = await saveInlineLoan(loan, draft, stagedStatus);
    if (saved) window.closeDecisionSheet();
  });
};

window.openRenewalDecisionSheet = function(id) {
  const loan = S.loans.find(x => x.id === id);
  if (!loan) return;
  window.closeDecisionSheet();
  const current = loan.renewedDate ? 'renewed' : 'pending';
  let stagedRenewal = current;
  let editMode = false;
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
        <button type="button" class="decision-icon-btn" title="Edit loan" data-decision-edit>&#9998;</button>
        <span class="decision-status-pill decision-status-pill--renewal">Pending</span>
      </span>
    </div>
    <div data-decision-card></div>
    <div class="decision-outcome-block">
      ${sliderHtml(options, current, 'renewal')}
    </div>
    <div class="decision-action-row">
      <button type="button" class="btn btn-cancel-full" onclick="closeDecisionSheet()">Cancel</button>
      <button type="button" class="btn btn-primary-full" data-decision-save>Save</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  initDecisionSheet(overlay, options, current);
  const card = overlay.querySelector('[data-decision-card]');
  const editBtn = overlay.querySelector('[data-decision-edit]');
  const pill = overlay.querySelector('.decision-status-pill');
  const renderCard = () => {
    const preview = loanFromDraft(loan, draft, loan.status || 'pending');
    preview.renewedDate = stagedRenewal === 'renewed' ? (loan.renewedDate || todayStr()) : '';
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
    setDecisionSelected(overlay, stagedRenewal, { emit: false });
  };
  editBtn?.addEventListener('click', () => {
    editMode = !editMode;
    renderCard();
  });
  overlay.addEventListener('decisionchange', e => {
    stagedRenewal = e.detail?.value || stagedRenewal;
    renderCard();
  });
  renderCard();
  overlay.querySelector('[data-decision-save]')?.addEventListener('click', async () => {
    const saved = await saveInlineLoan(loan, draft, loan.status || 'pending', { renewalState: stagedRenewal });
    if (saved) window.closeDecisionSheet();
  });
};

window.deleteLoan = async function(id) {
  if (!S.isAdmin) { toast('Admin only'); return; }
  const l = S.loans.find(x => x.id === id); if (!l) return;
  try {
    const snapshot = { ...l, id };
    await removeLoan(id);
    showUndoToast(`Deleted ${l.customerName}`, async () => {
      await setDoc(doc(db, 'loans', snapshot.id), snapshot);
      toast('Loan restored ✓');
    });
  } catch (e) { toast('Error'); }
};

window.saveLoan = async function(e) {
  e.preventDefault();

  const id = document.getElementById('loanId').value;
  const mode = document.getElementById('formMode')?.value || '';
  const cat = getCategorySelect()?.value || '';
  const branchSearch = getBranchSearchInput()?.value || '';
  const branch = getBranchValueInput()?.value || matchBranchOption(branchSearch);
  const assignedOfficer = assignedOfficerForBranch(branch);
  const selectedOfficer = document.getElementById('fOfficer').value || assignedOfficer || (S.user && !S.isAdmin ? S.user : '');
  const receiveDate = document.getElementById('fReceive').value || todayStr();
  const customerName = normalizeName(document.getElementById('fName').value);

  if (!cat) {
    updateCategoryHint('');
    toast('Pick a category first');
    return;
  }

  if (!branch) {
    toast('Pick a valid branch first');
    getBranchSearchInput()?.focus();
    return;
  }

  if (!selectedOfficer) {
    toast('Select or assign an officer first');
    window.toggleAdvancedFields(true);
    return;
  }

  if (!await confirmPotentialDuplicate({ id, customerName, branch })) return;

  let termLoan = false;
  if (cat === 'SME') {
    const termLoanCheckbox = document.getElementById('fTermLoan');
    termLoan = termLoanCheckbox ? termLoanCheckbox.checked : false;
  }

  const data = {
    allocatedTo: selectedOfficer,
    category: cat,
    branch,
    customerName,
    amount: parseFloat(document.getElementById('fAmount').value),
    receiveDate,
    remarks: document.getElementById('fRemarks').value.trim()
  };

  if (cat === 'SME') {
    data.isTermLoan = termLoan;
    const existing = id ? S.loans.find(x => x.id === id) : null;
    const isImported = (existing && existing.isImported) || (id && id.startsWith('import_sme_csv_'));
    if (!isImported) {
      data.isFreshCC = true;
      data.manuallyCreated = true;
    } else {
      data.isFreshCC = false;
      data.isImported = true;
    }

    const renewalInput = document.getElementById('fRenewalDue');
    const limitExpiryInput = document.getElementById('fLimitExpiry');
    const existingLoan = id ? S.loans.find(x => x.id === id) : null;
    const isRenewalDoneEdit = !!(existingLoan?.renewedDate) && mode !== 'renewal-done';
    if (mode === 'renewal-done') {
      const hasRenewalDue = !!(renewalInput && renewalInput.value);
      const hasLimitExpiry = !!(limitExpiryInput && limitExpiryInput.value);
      data.renewedDate = todayStr();
      data.renewalDatesPending = !(hasRenewalDue && hasLimitExpiry);
      if (hasRenewalDue) data.renewalDueDate = renewalInput.value;
      if (hasLimitExpiry) data.limitExpiryDate = limitExpiryInput.value;
    } else if (isRenewalDoneEdit) {
      if (renewalInput && renewalInput.value) data.renewalDueDate = renewalInput.value;
      if (limitExpiryInput && limitExpiryInput.value) data.limitExpiryDate = limitExpiryInput.value;
      const finalRenewalDue = data.renewalDueDate || existingLoan.renewalDueDate;
      const finalLimitExpiry = data.limitExpiryDate || existingLoan.limitExpiryDate;
      if (finalRenewalDue && finalLimitExpiry) data.renewalDatesPending = false;
    } else {
      data.renewalDueDate = (renewalInput && renewalInput.value) ? renewalInput.value : '';
      data.limitExpiryDate = (limitExpiryInput && limitExpiryInput.value) ? limitExpiryInput.value : '';
      if (id && data.renewalDueDate && data.limitExpiryDate) data.renewalDatesPending = false;
    }
  }

  const sanctionDate = document.getElementById('fSanction').value;
  if (sanctionDate) data.sanctionDate = sanctionDate;

  try {
    if (id) {
      await updateLoan(id, data);
      createNotification('edited', { ...data, id }).catch(() => {});
      toast('Loan updated ✓');
    } else {
      const nid = await createLoan(data);
      createNotification('added', { ...data, id: nid }).catch(() => {});
      toast('Loan added ✓');
    }
    saveRecentBranch(branch);
    window.closeForm();
  } catch (err) {
    toast('Error saving');
    console.error(err);
  }
};

window.markRenewalDone = async function(id) {
  const l = S.loans.find(x => x.id === id); if (!l) return;
  window.openForm({ ...l, renewedDate: l.renewedDate || todayStr() }, 'renewal-done', { entryMode: 'full' });
};

window.undoRenewalDone = async function(id) {
  const l = S.loans.find(x => x.id === id); if (!l) return;
  if (!confirm(`Undo renewal for ${l.customerName}? It will return to overdue/due-soon.`)) return;
  try {
    await updateLoan(id, { renewedDate: '', renewalDatesPending: false });
    toast('Renewal undone');
  } catch (e) { toast('Error'); }
};
