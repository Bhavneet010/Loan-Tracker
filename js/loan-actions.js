import { S } from "./state.js";
import { updateLoan, createLoan, removeLoan } from "./db.js";
import { createNotification } from "./notifications.js";
import { todayStr, showUndoToast, toast, esc, branchCode } from "./utils.js";
import { db } from "./config.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const RECENT_BRANCHES_KEY = 'lpRecentBranches';

function getBranchSearchInput() {
  return document.getElementById('fBranchSearch');
}

function getBranchValueInput() {
  return document.getElementById('fBranch');
}

function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function normalizeBranchText(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

function recentBranches() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_BRANCHES_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveRecentBranch(branch) {
  const normalized = matchBranchOption(branch);
  if (!normalized) return;
  const next = [normalized, ...recentBranches().filter(item => item !== normalized)].slice(0, 5);
  localStorage.setItem(RECENT_BRANCHES_KEY, JSON.stringify(next));
}

function branchesForUser(user = S.user) {
  if (!user || S.isAdmin) return [];
  return S.branches.filter(branch => assignedOfficerForBranch(branch) === user);
}

function branchLabel(branch) {
  const normalized = matchBranchOption(branch);
  const code = branchCode(normalized);
  const name = normalized.includes(':') ? normalized.split(':').slice(1).join(':').trim() : normalized;
  return code ? `${code} · ${name}` : normalized;
}

function populateFormOptions() {
  const officerSelect = document.getElementById('fOfficer');
  const branchOptions = document.getElementById('branchOptions');
  if (officerSelect) {
    officerSelect.innerHTML = '<option value="">Select officer</option>' + S.officers.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
  }
  if (branchOptions) {
    branchOptions.innerHTML = S.branches.map(branch => `<option value="${esc(branch)}"></option>`).join('');
  }
}

function matchBranchOption(branch) {
  const raw = normalizeBranchText(branch);
  if (!raw) return '';
  if (S.branches.includes(raw)) return raw;

  const lower = raw.toLowerCase();
  const compact = lower.replace(/\s+/g, ' ');
  const code = branchCode(raw).trim();

  if (code) {
    const byCode = S.branches.find(item => branchCode(item).trim() === code);
    if (byCode) return byCode;
  }

  const exactName = S.branches.find(item => {
    const itemName = item.split(':').slice(1).join(':').trim().toLowerCase();
    return itemName === compact;
  });
  if (exactName) return exactName;

  const partialMatches = S.branches.filter(item => item.toLowerCase().includes(compact));
  if (partialMatches.length === 1) return partialMatches[0];

  return '';
}

function assignedOfficerForBranch(branch) {
  const code = branchCode(branch).trim();
  return S.branchOfficers[code] || '';
}

function setAdvancedFieldsVisible(visible) {
  const advanced = document.getElementById('advancedFields');
  const toggleBtn = document.getElementById('toggleAdvancedBtn');
  if (advanced) advanced.style.display = visible ? 'block' : 'none';
  if (toggleBtn) toggleBtn.textContent = visible ? 'Hide Extra Details' : 'Add More Details';
}

function setFormEntryMode(mode, opts = {}) {
  const entryMode = document.getElementById('entryMode');
  const intro = document.getElementById('formIntro');
  const officerGroup = document.getElementById('fOfficerGroup');
  const toggleBtn = document.getElementById('toggleAdvancedBtn');

  if (entryMode) entryMode.value = mode;

  if (mode === 'quick') {
    if (officerGroup) officerGroup.style.display = 'none';
    if (toggleBtn) toggleBtn.style.display = 'block';
    setAdvancedFieldsVisible(false);
    if (intro) {
      intro.style.display = 'block';
      intro.textContent = opts.duplicateSource
        ? 'Duplicating a previous loan. The main details are prefilled, and you can expand if you want more fields.'
        : 'Quick Add keeps this to the main details. Extra fields are still available if you need them.';
    }
  } else {
    if (officerGroup) officerGroup.style.display = '';
    if (toggleBtn) toggleBtn.style.display = 'none';
    setAdvancedFieldsVisible(true);
    if (intro) {
      intro.style.display = 'none';
      intro.textContent = '';
    }
  }
}

function updateAssignedOfficerHint(branch) {
  const hint = document.getElementById('assignedOfficerHint');
  const officer = document.getElementById('fOfficer')?.value || '';
  if (!hint) return;

  if (!branch) {
    hint.style.display = 'none';
    hint.textContent = '';
    hint.classList.remove('warn');
    return;
  }

  hint.style.display = 'block';
  if (officer) {
    hint.textContent = `Assigned to ${officer}`;
    hint.classList.remove('warn');
  } else {
    hint.textContent = 'No officer assigned for this branch yet. Expand details to choose one manually.';
    hint.classList.add('warn');
  }
}

function updateBranchMatchHint(rawValue, matchedBranch) {
  const hint = document.getElementById('branchMatchHint');
  if (!hint) return;

  const value = normalizeBranchText(rawValue);
  if (!value) {
    hint.style.display = 'none';
    hint.textContent = '';
    hint.classList.remove('warn');
    return;
  }

  hint.style.display = 'block';
  if (matchedBranch) {
    hint.textContent = `Using ${branchLabel(matchedBranch)}`;
    hint.classList.remove('warn');
  } else {
    hint.textContent = 'Pick a suggested branch or type the full code/name so it can be matched.';
    hint.classList.add('warn');
  }
}

function renderBranchQuickPicks(activeBranch = '') {
  const container = document.getElementById('branchQuickPicks');
  if (!container) return;

  const picks = [
    ...branchesForUser(),
    ...recentBranches(),
    ...S.branches.slice(0, 3)
  ].filter((branch, index, list) => branch && list.indexOf(branch) === index).slice(0, 6);

  if (!picks.length) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  container.style.display = 'flex';
  container.innerHTML = picks.map(branch => {
    const active = branch === activeBranch ? ' active' : '';
    return `<button type="button" class="branch-chip${active}" onclick="pickBranch('${esc(branch)}')">${esc(branchLabel(branch))}</button>`;
  }).join('');
}

function setBranchValue(branch, { allowFallbackUser = true, rawText = '' } = {}) {
  const branchInput = getBranchSearchInput();
  const branchValueInput = getBranchValueInput();
  const normalized = matchBranchOption(branch || rawText);
  const officerSelect = document.getElementById('fOfficer');

  if (branchValueInput) branchValueInput.value = normalized;
  if (branchInput) branchInput.value = normalized || normalizeBranchText(rawText);

  if (normalized && officerSelect) {
    const assigned = assignedOfficerForBranch(normalized);
    if (assigned) officerSelect.value = assigned;
    else if (allowFallbackUser && S.user && !S.isAdmin) officerSelect.value = S.user;
    else if (!officerSelect.value) officerSelect.value = '';
  }

  updateBranchMatchHint(branchInput?.value || rawText, normalized);
  updateAssignedOfficerHint(normalized);
  renderBranchQuickPicks(normalized);
}

function applyBranchAssignment(branch, { allowFallbackUser = true } = {}) {
  setBranchValue(branch, { allowFallbackUser, rawText: branch });
}

function fillFormFromLoan(loan, { isEdit = false, mode = '' } = {}) {
  document.getElementById('fCategory').value = loan.category || '';
  const termLoanGroup = document.getElementById('fTermLoanGroup');
  const termLoanCheckbox = document.getElementById('fTermLoan');
  if (termLoanGroup && termLoanCheckbox) {
    termLoanGroup.style.display = loan.category === 'SME' ? 'flex' : 'none';
    termLoanCheckbox.checked = !!loan.isTermLoan;
  }

  const branchValue = matchBranchOption(loan.branch || '');
  setBranchValue(branchValue || loan.branch || '', { allowFallbackUser: !isEdit, rawText: loan.branch || '' });
  if (isEdit && loan.allocatedTo) {
    document.getElementById('fOfficer').value = loan.allocatedTo;
    updateAssignedOfficerHint(branchValue);
  }

  document.getElementById('fName').value = loan.customerName || '';
  document.getElementById('fAmount').value = loan.amount || '';
  document.getElementById('fReceive').value = isEdit ? (loan.receiveDate || '') : todayStr();
  document.getElementById('fSanction').value = isEdit ? (loan.sanctionDate || '') : '';
  document.getElementById('fRemarks').value = loan.remarks || '';

  const renewalGroup = document.getElementById('fRenewalGroup');
  const limitExpiryGroup = document.getElementById('fLimitExpiryGroup');
  if (renewalGroup) renewalGroup.style.display = loan.category === 'SME' ? 'block' : 'none';
  if (limitExpiryGroup) limitExpiryGroup.style.display = loan.category === 'SME' ? 'block' : 'none';

  const renewalInput = document.getElementById('fRenewalDue');
  const limitExpiryInput = document.getElementById('fLimitExpiry');
  if (renewalInput) renewalInput.value = mode === 'renewal-done' ? '' : (loan.renewalDueDate || '');
  if (limitExpiryInput) limitExpiryInput.value = mode === 'renewal-done' ? '' : (loan.limitExpiryDate || '');
}

function getDuplicateMatches({ id = '', customerName = '', branch = '' }) {
  const normalizedName = normalizeName(customerName);
  const branchValue = matchBranchOption(branch);
  const branchKey = branchCode(branchValue).trim();
  if (!normalizedName || !branchKey) return [];

  return S.loans.filter(loan => {
    if (!loan || loan.id === id) return false;
    return normalizeName(loan.customerName) === normalizedName
      && branchCode(matchBranchOption(loan.branch)).trim() === branchKey;
  });
}

function confirmPotentialDuplicate({ id = '', customerName = '', branch = '' }) {
  const matches = getDuplicateMatches({ id, customerName, branch });
  if (!matches.length) return true;

  const summary = matches.slice(0, 3).map(loan =>
    `• ${loan.status || 'pending'} | ${loan.category || 'Loan'} | ${loan.allocatedTo || 'Unassigned'}`
  ).join('\n');
  const extra = matches.length > 3 ? `\n…and ${matches.length - 3} more.` : '';
  return confirm(
    `A loan with the same customer name and branch already exists.\n\n${summary}${extra}\n\nDo you still want to save this loan?`
  );
}

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

window.toggleAdvancedFields = function(force) {
  const advanced = document.getElementById('advancedFields');
  const visible = typeof force === 'boolean'
    ? force
    : !(advanced && advanced.style.display !== 'none');
  setAdvancedFieldsVisible(visible);

  const entryMode = document.getElementById('entryMode')?.value || 'full';
  const officerGroup = document.getElementById('fOfficerGroup');
  if (officerGroup) officerGroup.style.display = (entryMode === 'quick' && !visible) ? 'none' : '';
};

window.pickBranch = function(branch) {
  setBranchValue(branch, { allowFallbackUser: true, rawText: branch });
};

window.handleBranchSearch = function(branch) {
  setBranchValue(branch, { allowFallbackUser: true, rawText: branch });
};

window.openForm = function(loan = null, mode = null, options = {}) {
  if (!S.user) { if (window.showUserSelect) window.showUserSelect(); return; }

  const prefills = options.prefillLoan || null;
  const isEdit = !!loan && !prefills;
  const entryMode = options.entryMode || (isEdit || mode === 'renewal-done' ? 'full' : 'quick');

  const modeInput = document.getElementById('formMode');
  const form = document.getElementById('loanForm');
  if (form) form.reset();
  populateFormOptions();
  renderBranchQuickPicks('');
  setFormEntryMode(entryMode, { duplicateSource: !!prefills });
  if (modeInput) modeInput.value = mode || '';

  document.getElementById('loanId').value = isEdit ? loan.id : '';
  document.getElementById('fReceive').value = todayStr();
  document.getElementById('fSanction').value = '';
  document.getElementById('fRenewalDue').value = '';
  document.getElementById('fLimitExpiry').value = '';
  document.getElementById('fRemarks').value = '';
  setBranchValue('', { allowFallbackUser: true, rawText: '' });

  if (prefills) {
    document.getElementById('formTitle').textContent = 'Duplicate Loan';
    fillFormFromLoan(prefills, { isEdit: false, mode });
  } else if (isEdit) {
    document.getElementById('formTitle').textContent = mode === 'renewal-done' ? 'Mark Renewal Done' : 'Edit Loan';
    fillFormFromLoan(loan, { isEdit: true, mode });
  } else {
    document.getElementById('formTitle').textContent = entryMode === 'quick' ? 'Quick Add Loan' : 'Add New Loan';
    const termLoanGroup = document.getElementById('fTermLoanGroup');
    const renewalGroup = document.getElementById('fRenewalGroup');
    const limitExpiryGroup = document.getElementById('fLimitExpiryGroup');
    const termLoanCheckbox = document.getElementById('fTermLoan');
    if (termLoanGroup) termLoanGroup.style.display = 'none';
    if (renewalGroup) renewalGroup.style.display = 'none';
    if (limitExpiryGroup) limitExpiryGroup.style.display = 'none';
    if (termLoanCheckbox) termLoanCheckbox.checked = false;
    if (S.user && !S.isAdmin) document.getElementById('fOfficer').value = S.user;
    updateAssignedOfficerHint('');
  }

  if (mode === 'renewal-done') {
    document.getElementById('fReceiveGroup').style.display = 'none';
    document.getElementById('fSanctionGroup').style.display = 'none';
  } else {
    document.getElementById('fReceiveGroup').style.display = '';
    document.getElementById('fSanctionGroup').style.display = isEdit && loan.status === 'sanctioned' ? 'block' : 'none';
  }

  if (entryMode === 'quick' && !prefills) {
    const input = getBranchSearchInput();
    if (input) input.focus();
  } else if (mode === 'renewal') {
    const renewalInput = document.getElementById('fRenewalDue');
    if (renewalInput) {
      renewalInput.focus();
      renewalInput.classList.add('form-highlight');
      setTimeout(() => renewalInput.classList.remove('form-highlight'), 2000);
    }
  }

  document.getElementById('formModal').style.display = 'flex';
};

window.openQuickAdd = function(sourceId = null) {
  const sourceLoan = sourceId ? S.loans.find(x => x.id === sourceId) : null;
  window.openForm(null, '', {
    entryMode: 'quick',
    prefillLoan: sourceLoan || null
  });
};

window.closeForm = function() {
  document.getElementById('formModal').style.display = 'none';
};

window.editLoan = id => {
  const l = S.loans.find(x => x.id === id);
  if (l) window.openForm(l, '', { entryMode: 'full' });
};

window.duplicateLoan = id => {
  const l = S.loans.find(x => x.id === id);
  if (l) window.openQuickAdd(id);
};

window.toggleTermLoan = function(cat) {
  const termLoanGroup = document.getElementById('fTermLoanGroup');
  const renewalGroup = document.getElementById('fRenewalGroup');
  const limitExpiryGroup = document.getElementById('fLimitExpiryGroup');
  if (termLoanGroup) termLoanGroup.style.display = cat === 'SME' ? 'flex' : 'none';
  if (renewalGroup) renewalGroup.style.display = cat === 'SME' ? 'block' : 'none';
  if (limitExpiryGroup) limitExpiryGroup.style.display = cat === 'SME' ? 'block' : 'none';
};

window.saveLoan = async function(e) {
  e.preventDefault();

  const id = document.getElementById('loanId').value;
  const mode = document.getElementById('formMode')?.value || '';
  const cat = document.getElementById('fCategory').value;
  const branchSearch = getBranchSearchInput()?.value || '';
  const branch = getBranchValueInput()?.value || matchBranchOption(branchSearch);
  const assignedOfficer = assignedOfficerForBranch(branch);
  const selectedOfficer = document.getElementById('fOfficer').value || assignedOfficer || (S.user && !S.isAdmin ? S.user : '');
  const receiveDate = document.getElementById('fReceive').value || todayStr();
  const customerName = normalizeName(document.getElementById('fName').value);

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

  if (!confirmPotentialDuplicate({ id, customerName, branch })) return;

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
