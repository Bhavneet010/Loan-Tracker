import { S } from "./state.js";
import { updateLoan, createLoan, removeLoan } from "./db.js";
import { createNotification } from "./notifications.js";
import { todayStr, showUndoToast, toast, esc, branchCode, fmtAmt, fmtDate, catCls } from "./utils.js";
import { db } from "./config.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

import { getBranchSearchInput, getBranchValueInput, getCategorySelect, normalizeName, normalizeBranchText, recentBranches, saveRecentBranch, branchesForUser, branchLabel, duplicateCardHtml, populateFormOptions, renderCategoryChips, updateCategoryHint, setCategoryValue, matchBranchOption, assignedOfficerForBranch, setAdvancedFieldsVisible, setFormEntryMode, updateAssignedOfficerHint, updateBranchMatchHint, renderBranchQuickPicks, setBranchValue, fillFormFromLoan, getDuplicateMatches, showDuplicateModal, confirmPotentialDuplicate, RECENT_BRANCHES_KEY, duplicateDecisionResolve } from "./ui-forms.js";

/* CORE LOAN ACTIONS */
window.sanctionLoan = async function(id) {
  const l = S.loans.find(x => x.id === id); if (!l) return;
  if (!confirm(`Sanction loan for ${l.customerName}?`)) return;
  try {
    await updateLoan(id, { status: 'sanctioned', sanctionDate: todayStr() });
    createNotification('sanctioned', { ...l, status: 'sanctioned' }).catch(() => {});
    toast('Sanctioned ✓');
  } catch (e) { toast('Error'); }
};

window.returnLoan = async function(id) {
  const l = S.loans.find(x => x.id === id); if (!l) return;
  const reason = prompt(`Reason for returning ${l.customerName}?`, l.remarks || '');
  if (reason === null) return;
  try {
    await updateLoan(id, { status: 'returned', remarks: reason, returnedDate: todayStr() });
    createNotification('returned', { ...l, status: 'returned' }).catch(() => {});
    toast('Marked as returned');
  } catch (e) { toast('Error'); }
};

window.moveToPending = async function(id) {
  const l = S.loans.find(x => x.id === id); if (!l) return;
  if (!confirm(`Move ${l.customerName} back to Pending?`)) return;
  try {
    await updateLoan(id, { status: 'pending' });
    toast('Moved to pending');
  } catch (e) { toast('Error'); }
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
    if (mode === 'renewal-done') {
      const hasRenewalDue = !!(renewalInput && renewalInput.value);
      const hasLimitExpiry = !!(limitExpiryInput && limitExpiryInput.value);
      data.renewedDate = todayStr();
      data.renewalDatesPending = !(hasRenewalDue && hasLimitExpiry);
      if (hasRenewalDue) data.renewalDueDate = renewalInput.value;
      if (hasLimitExpiry) data.limitExpiryDate = limitExpiryInput.value;
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
