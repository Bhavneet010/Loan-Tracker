import { S } from "./state.js";
import { updateLoan, createLoan, removeLoan } from "./db.js";
import { createNotification } from "./notifications.js";
import { todayStr, showUndoToast, toast, esc, branchCode, fmtAmt, fmtDate, catCls, daysPending, computeRenewalStatus, timeAgo } from "./utils.js";
import { db } from "./config.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { animateOverlayIn, animateOverlayOut } from "./animate.js";

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
  if (status === 'returned') data.returnedDate = draft.returnedDate || base.returnedDate || todayStr();

  if (draft.category === 'SME') {
    data.isTermLoan = !!draft.isTermLoan;
    const isImported = (base && base.isImported) || (base?.id && base.id.startsWith('import_sme_csv_'));
    data.isFreshCC = !isImported;
    if (isImported) data.isImported = true;
    else data.manuallyCreated = true;
    if (renewalState !== 'renewed') {
      data.renewalDueDate = draft.renewalDueDate || '';
      data.limitExpiryDate = draft.limitExpiryDate || '';
      if (data.renewalDueDate && data.limitExpiryDate) data.renewalDatesPending = false;
    }
  } else {
    data.isTermLoan = false;
  }

  if (renewalState === 'renewed') {
    const completionDate = draft.renewedDate || draft.sanctionDate || todayStr();
    const nextRenewalDue = draft.nextRenewalDueDate || '';
    const nextLimitExpiry = draft.nextLimitExpiryDate || '';
    data.sanctionDate = completionDate;
    data.renewedDate = completionDate;
    if (nextRenewalDue) data.renewalDueDate = nextRenewalDue;
    if (nextLimitExpiry) data.limitExpiryDate = nextLimitExpiry;
    data.renewalDueDatePending = !nextRenewalDue;
    data.limitExpiryDatePending = !nextLimitExpiry;
    data.renewalDueDateEntered = !!nextRenewalDue;
    data.limitExpiryDateEntered = !!nextLimitExpiry;
    data.renewalDatesPending = !(nextRenewalDue && nextLimitExpiry);
  } else if (renewalState === 'pending') {
    data.renewedDate = '';
    data.renewalDueDatePending = false;
    data.limitExpiryDatePending = false;
    data.renewalDueDateEntered = false;
    data.limitExpiryDateEntered = false;
    data.renewalDatesPending = false;
  }

  return { data, duplicateCheck: { id: base.id, customerName, branch } };
}

export async function saveInlineLoan(base, draft, status, opts = {}) {
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
    const isRenewalAddBack = mode === 'renewal-addback';
    if (isRenewalAddBack) {
      data.isFreshCC = false;
      data.manuallyCreated = true;
      data.status = 'sanctioned';
    } else if (!isImported) {
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
      data.renewalDueDatePending = !hasRenewalDue;
      data.limitExpiryDatePending = !hasLimitExpiry;
      data.renewalDueDateEntered = hasRenewalDue;
      data.limitExpiryDateEntered = hasLimitExpiry;
      if (hasRenewalDue) data.renewalDueDate = renewalInput.value;
      if (hasLimitExpiry) data.limitExpiryDate = limitExpiryInput.value;
    } else if (isRenewalDoneEdit) {
      if (renewalInput && renewalInput.value) data.renewalDueDate = renewalInput.value;
      if (limitExpiryInput && limitExpiryInput.value) data.limitExpiryDate = limitExpiryInput.value;
      const finalRenewalDue = data.renewalDueDate || existingLoan.renewalDueDate;
      const finalLimitExpiry = data.limitExpiryDate || existingLoan.limitExpiryDate;
      if (data.renewalDueDate) data.renewalDueDatePending = false;
      if (data.limitExpiryDate) data.limitExpiryDatePending = false;
      if (data.renewalDueDate) data.renewalDueDateEntered = true;
      if (data.limitExpiryDate) data.limitExpiryDateEntered = true;
      if (finalRenewalDue && finalLimitExpiry) data.renewalDatesPending = false;
    } else {
      data.renewalDueDate = (renewalInput && renewalInput.value) ? renewalInput.value : '';
      data.limitExpiryDate = (limitExpiryInput && limitExpiryInput.value) ? limitExpiryInput.value : '';
      if (id && data.renewalDueDate && data.limitExpiryDate) data.renewalDatesPending = false;
    }
  }

  const sanctionDate = document.getElementById('fSanction').value;
  if (sanctionDate) data.sanctionDate = sanctionDate;
  else if (mode === 'renewal-addback') data.sanctionDate = todayStr();
  if (mode === 'renewal-done' && sanctionDate) data.renewedDate = sanctionDate;

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
