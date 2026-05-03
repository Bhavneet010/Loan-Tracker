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
  if (!l || !nextStatus || nextStatus === l.status) return;
  const data = { status: nextStatus };
  if (nextStatus === 'sanctioned') {
    data.sanctionDate = l.sanctionDate || todayStr();
  } else if (nextStatus === 'returned') {
    data.returnedDate = l.returnedDate || todayStr();
    data.remarks = remarks.trim();
  }
  try {
    await updateLoan(id, data);
    if (nextStatus === 'sanctioned') createNotification('sanctioned', { ...l, ...data }).catch(() => {});
    else if (nextStatus === 'returned') createNotification('returned', { ...l, ...data }).catch(() => {});
    toast(nextStatus === 'sanctioned' ? 'Sanctioned ✓' : nextStatus === 'returned' ? 'Marked as returned' : 'Moved to pending');
  } catch (e) {
    toast('Error');
    console.error(e);
  }
}

async function applyRenewalStatus(id, renewed) {
  const l = S.loans.find(x => x.id === id);
  if (!l) return;
  if (renewed) {
    window.closeDecisionSheet();
    window.openForm({ ...l, renewedDate: l.renewedDate || todayStr() }, 'renewal-done', { entryMode: 'full' });
    return;
  }
  try {
    await updateLoan(id, { renewedDate: '', renewalDatesPending: false });
    toast('Renewal moved to pending');
  } catch (e) {
    toast('Error');
    console.error(e);
  }
}

function accountAmount(loan) {
  return `₹${fmtAmt(loan.amount)}<span> L</span>`;
}

function accountLine(label, value) {
  if (!value) return '';
  return `<div class="decision-account-line"><small>${esc(label)}</small><b>${esc(value)}</b></div>`;
}

function loanDecisionLines(loan) {
  const rows = [
    accountLine('Branch', loan.branch),
    accountLine('Officer', loan.allocatedTo),
    accountLine('Received', fmtDate(loan.receiveDate)),
  ];
  if ((loan.status || 'pending') === 'pending') {
    const days = daysPending(loan.receiveDate);
    rows.push(accountLine('Ageing', `${days} ${days === 1 ? 'day' : 'days'}`));
  }
  if (loan.status === 'sanctioned') rows.push(accountLine('Sanction Date', fmtDate(loan.sanctionDate)));
  if (loan.status === 'returned') {
    rows.push(accountLine('Return Date', fmtDate(loan.returnedDate)));
    rows.push(accountLine('Remarks', loan.remarks || 'No remarks added'));
  }
  return rows.join('');
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
  else if (rs?.status === 'pending-renewal') rows.push(accountLine('Status', `${rs.daysOverdue} days overdue${rs.daysUntilNpa >= 0 ? ` • ${rs.daysUntilNpa} days to NPA` : ''}`));
  else if (rs?.status === 'due-soon') rows.push(accountLine('Status', `Due in ${rs.daysUntilDue} days`));
  else if (rs?.status === 'npa') rows.push(accountLine('Status', `${rs.daysOverdue} days overdue • NPA`));
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

function setDecisionSelected(overlay, value) {
  const slider = overlay.querySelector('.decision-slider');
  if (!slider) return;
  const options = [...slider.querySelectorAll('[data-decision-value]')].map(btn => ({ value: btn.dataset.decisionValue, label: btn.textContent.trim() }));
  const selected = options.find(o => o.value === value) || options[0];
  slider.dataset.selected = selected.value;
  slider.style.setProperty('--thumb-left', `${optionLeft(options, selected.value)}%`);
  const thumbLabel = slider.querySelector('[data-decision-thumb] b');
  if (thumbLabel) thumbLabel.textContent = selected.label;
  slider.querySelectorAll('[data-decision-value]').forEach(btn => btn.classList.toggle('active', btn.dataset.decisionValue === selected.value));
  overlay.querySelector('.decision-return-note')?.classList.toggle('show', selected.value === 'returned');
}

function initDecisionSheet(overlay, options, selected) {
  setDecisionSelected(overlay, selected);
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
    const { percent } = positionFromPointer(clientX);
    const min = options.length === 2 ? 25 : 16.67;
    const max = options.length === 2 ? 75 : 83.33;
    slider.style.setProperty('--thumb-left', `${Math.max(min, Math.min(max, percent))}%`);
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

window.openLoanDecisionSheet = function(id, preferredStatus = null) {
  const loan = S.loans.find(x => x.id === id);
  if (!loan) return;
  window.closeDecisionSheet();
  const current = loan.status || 'pending';
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
      <button type="button" class="btn btn-outline" onclick="closeDecisionSheet();editLoan('${esc(id)}')">Edit loan</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  initDecisionSheet(overlay, options, selected);
  overlay.querySelector('[data-decision-thumb]')?.addEventListener('pointerup', async () => {
    const next = overlay.querySelector('.decision-slider')?.dataset.selected;
    if (!next || next === current) return;
    const remarks = overlay.querySelector('#decisionReturnRemarks')?.value || '';
    window.closeDecisionSheet();
    await applyLoanStatus(id, next, remarks);
  });
};

window.openRenewalDecisionSheet = function(id) {
  const loan = S.loans.find(x => x.id === id);
  if (!loan) return;
  window.closeDecisionSheet();
  const rs = computeRenewalStatus(loan);
  const current = loan.renewedDate ? 'renewed' : 'pending';
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
      <button type="button" class="btn btn-outline" onclick="closeDecisionSheet();editLoan('${esc(id)}')">Edit loan</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  initDecisionSheet(overlay, options, current);
  overlay.querySelector('[data-decision-thumb]')?.addEventListener('pointerup', async () => {
    const next = overlay.querySelector('.decision-slider')?.dataset.selected;
    if (!next || next === current) return;
    await applyRenewalStatus(id, next === 'renewed');
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
