import { S } from "./state.js";
import { updateLoan, createLoan, removeLoan } from "./db.js";
import { createNotification } from "./notifications.js";
import { todayStr, showUndoToast, toast, esc, branchCode, fmtAmt, fmtDate, catCls, isFreshCC } from "./utils.js";
import { db } from "./config.js";
import { openOverlay, closeOverlay } from "./animate.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { effectiveOfficer } from "./derived.js";

const RECENT_BRANCHES_KEY = 'lpRecentBranches';
let duplicateDecisionResolve = null;

function getBranchSearchInput() {
  return document.getElementById('fBranchSearch');
}

function getBranchValueInput() {
  return document.getElementById('fBranch');
}

function getCategorySelect() {
  return document.getElementById('fCategory');
}

function setLoanTypeValue(type) {
  const value = type === 'TL' || type === 'CC_TL' ? type : 'CC';
  const radio = document.querySelector(`input[name="fLoanType"][value="${value}"]`);
  if (radio) radio.checked = true;
}

function getLoanTypeValue() {
  const checked = document.querySelector('input[name="fLoanType"]:checked');
  return checked ? checked.value : 'CC';
}

function loanTypeFromLoan(loan) {
  if (loan.loanType) return loan.loanType;
  return loan.isTermLoan ? 'TL' : 'CC';
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

function duplicateCardHtml(loan) {
  const status = (loan.status || 'pending').replace(/^\w/, c => c.toUpperCase());
  const amount = fmtAmt(loan.amount);
  const receiveDate = loan.receiveDate ? fmtDate(loan.receiveDate) : '';
  return `<div class="duplicate-card">
    <div class="duplicate-card-top">
      <div>
        <div class="duplicate-name">${esc(loan.customerName || '')}</div>
        <div class="duplicate-meta">${esc(loan.branch || '')}</div>
      </div>
      <div class="duplicate-amt"><span class="rs">&#8377;</span>${amount}L</div>
    </div>
    <div class="duplicate-tags">
      <span class="tag ${catCls(loan.category)}">${esc(loan.category || 'Loan')}</span>
      <span class="tag officer">${esc(effectiveOfficer(loan))}</span>
      <span class="tag date">${esc(status)}</span>
      ${receiveDate ? `<span class="tag date">Recd ${receiveDate}</span>` : ''}
    </div>
    <button type="button" class="btn btn-outline duplicate-open-btn" onclick="openDuplicateExisting('${loan.id}')">Open Existing</button>
  </div>`;
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

function renderCategoryChips(activeCategory = '') {
  const container = document.getElementById('categoryChips');
  if (!container) return;

  const categories = ['Agriculture', 'SME', 'Education'];
  container.innerHTML = categories.map(category => {
    const active = category === activeCategory ? ' active' : '';
    const chipClass = catCls(category) || '';
    return `<button type="button" class="category-chip ${chipClass}${active}" onclick="selectCategory('${category}')">${category}</button>`;
  }).join('');
}

function updateCategoryHint(category) {
  const hint = document.getElementById('categoryHint');
  if (!hint) return;
  if (category) {
    hint.style.display = 'none';
    hint.textContent = '';
    return;
  }
  hint.style.display = 'block';
  hint.textContent = 'Pick a category to continue.';
}

function setCategoryValue(category) {
  const select = getCategorySelect();
  if (select) select.value = category || '';
  renderCategoryChips(category || '');
  updateCategoryHint(category || '');
  window.toggleTermLoan(category || '');
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

function fillFormFromLoan(loan, { isEdit = false, mode = '' } = {}) {
  setCategoryValue(loan.category || '');
  const loanTypeGroup = document.getElementById('fLoanTypeGroup');
  if (loanTypeGroup) {
    loanTypeGroup.style.display = loan.category === 'SME' ? 'flex' : 'none';
    setLoanTypeValue(loanTypeFromLoan(loan));
  }

  const branchValue = matchBranchOption(loan.branch || '');
  setBranchValue(branchValue || loan.branch || '', { allowFallbackUser: !isEdit, rawText: loan.branch || '' });
  if (isEdit && (loan.allocatedTo || effectiveOfficer(loan) !== 'Unassigned')) {
    document.getElementById('fOfficer').value = effectiveOfficer(loan);
    updateAssignedOfficerHint(branchValue);
  }

  document.getElementById('fName').value = loan.customerName || '';
  document.getElementById('fAmount').value = loan.amount || '';
  const breCheckbox = document.getElementById('fBre');
  if (breCheckbox) breCheckbox.checked = !!loan.isBre;
  window.updateBreCheckbox();
  document.getElementById('fReceive').value = isEdit ? (loan.receiveDate || '') : todayStr();
  document.getElementById('fSanction').value = isEdit
    ? (mode === 'renewal-done' ? todayStr() : (loan.sanctionDate || loan.renewedDate || ''))
    : '';
  document.getElementById('fRemarks').value = loan.remarks || '';

  const renewalGroup = document.getElementById('fRenewalGroup');
  const limitExpiryGroup = document.getElementById('fLimitExpiryGroup');
  if (renewalGroup) renewalGroup.style.display = loan.category === 'SME' ? 'block' : 'none';
  if (limitExpiryGroup) limitExpiryGroup.style.display = loan.category === 'SME' ? 'block' : 'none';

  const renewalInput = document.getElementById('fRenewalDue');
  const limitExpiryInput = document.getElementById('fLimitExpiry');
  const hideRenewalDates = mode === 'renewal-done' || (isEdit && !!loan.renewedDate);
  if (renewalInput) renewalInput.value = hideRenewalDates ? '' : (loan.renewalDueDate || '');
  if (limitExpiryInput) limitExpiryInput.value = hideRenewalDates ? '' : (loan.limitExpiryDate || '');

  // Post-sanction stage dates (documentation → disbursement) are editable for
  // any sanctioned fresh SME loan while editing, including older loans that
  // predate stage tracking (their cards don't show the chips, so the form is
  // the only way to record these). Outside edit mode these fields stay hidden.
  const showStageDates = isEdit && mode !== 'renewal-done'
    && loan.category === 'SME' && isFreshCC(loan)
    && loan.status === 'sanctioned';
  const docGroup = document.getElementById('fDocumentationGroup');
  const disbGroup = document.getElementById('fDisbursementGroup');
  const docInput = document.getElementById('fDocumentation');
  const disbInput = document.getElementById('fDisbursement');
  if (docGroup) docGroup.style.display = showStageDates ? 'block' : 'none';
  if (disbGroup) disbGroup.style.display = showStageDates ? 'block' : 'none';
  if (docInput) docInput.value = showStageDates ? (loan.documentationDate || '') : '';
  if (disbInput) disbInput.value = showStageDates ? (loan.disbursementDate || '') : '';
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

function showDuplicateModal(matches) {
  const modal = document.getElementById('duplicateModal');
  const list = document.getElementById('duplicateList');
  if (!modal || !list) return Promise.resolve(false);

  list.innerHTML = matches.map(duplicateCardHtml).join('');
  openOverlay('duplicateModal');

  return new Promise(resolve => {
    duplicateDecisionResolve = resolve;
  });
}

async function confirmPotentialDuplicate({ id = '', customerName = '', branch = '' }) {
  const matches = getDuplicateMatches({ id, customerName, branch });
  if (!matches.length) return true;
  return showDuplicateModal(matches);
}

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

window.selectCategory = function(category) {
  setCategoryValue(category);
};

window.pickBranch = function(branch) {
  setBranchValue(branch, { allowFallbackUser: true, rawText: branch });
};

window.handleBranchSearch = function(branch) {
  setBranchValue(branch, { allowFallbackUser: true, rawText: branch });
};

window.closeDuplicateModal = function(saveAnyway) {
  closeOverlay('duplicateModal', () => {
    const resolve = duplicateDecisionResolve;
    duplicateDecisionResolve = null;
    if (resolve) resolve(!!saveAnyway);
  });
};

window.openDuplicateExisting = function(id) {
  window.closeDuplicateModal(false);
  const loan = S.loans.find(item => item.id === id);
  if (loan) window.openForm(loan, '', { entryMode: 'full' });
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
  setCategoryValue('');
  if (modeInput) modeInput.value = mode || '';
  const sanctionLabel = document.querySelector('#fSanctionGroup label');
  if (sanctionLabel) sanctionLabel.textContent = 'Sanction Date';

  document.getElementById('loanId').value = isEdit ? loan.id : '';
  document.getElementById('fReceive').value = todayStr();
  document.getElementById('fSanction').value = '';
  document.getElementById('fRenewalDue').value = '';
  document.getElementById('fLimitExpiry').value = '';
  document.getElementById('fDocumentation').value = '';
  document.getElementById('fDisbursement').value = '';
  document.getElementById('fDocumentationGroup').style.display = 'none';
  document.getElementById('fDisbursementGroup').style.display = 'none';
  document.getElementById('fRemarks').value = '';
  setBranchValue('', { allowFallbackUser: true, rawText: '' });

  if (prefills) {
    document.getElementById('formTitle').textContent = 'Duplicate Loan';
    fillFormFromLoan(prefills, { isEdit: false, mode });
  } else if (isEdit) {
    document.getElementById('formTitle').textContent = mode === 'renewal-done' ? 'Mark Renewal Done' : 'Edit Loan';
    fillFormFromLoan(loan, { isEdit: true, mode });
  } else {
    const isRenewalAddBack = mode === 'renewal-addback';
    if (isRenewalAddBack) {
      document.getElementById('formTitle').textContent = 'Add Back Renewal Account';
    } else {
      document.getElementById('formTitle').textContent = entryMode === 'quick' ? 'Quick Add Loan' : 'Add New Loan';
    }
    const loanTypeGroup = document.getElementById('fLoanTypeGroup');
    const renewalGroup = document.getElementById('fRenewalGroup');
    const limitExpiryGroup = document.getElementById('fLimitExpiryGroup');
    if (isRenewalAddBack) {
      if (loanTypeGroup) loanTypeGroup.style.display = 'flex';
      if (renewalGroup) renewalGroup.style.display = 'block';
      if (limitExpiryGroup) limitExpiryGroup.style.display = 'block';
      if (sanctionLabel) sanctionLabel.textContent = 'Original Sanction Date *';
      setCategoryValue('SME');
    } else {
      if (loanTypeGroup) loanTypeGroup.style.display = 'none';
      if (renewalGroup) renewalGroup.style.display = 'none';
      if (limitExpiryGroup) limitExpiryGroup.style.display = 'none';
    }
    setLoanTypeValue('CC');
    const breCheckbox = document.getElementById('fBre');
    if (breCheckbox) breCheckbox.checked = false;
    if (S.user && !S.isAdmin) document.getElementById('fOfficer').value = S.user;
    updateAssignedOfficerHint('');
  }

  const submitBtn = document.getElementById('formSubmitBtn');
  if (submitBtn) submitBtn.textContent = mode === 'renewal-addback' ? 'Add to Renewals' : 'Save Loan';

  const isRenewalDoneEdit = isEdit && !!loan?.renewedDate;
  if (mode === 'renewal-done' || isRenewalDoneEdit || mode === 'renewal-addback') {
    document.getElementById('fReceiveGroup').style.display = 'none';
    document.getElementById('fSanctionGroup').style.display = 'block';
  } else {
    document.getElementById('fReceiveGroup').style.display = '';
    document.getElementById('fSanctionGroup').style.display = isEdit && loan.status === 'sanctioned' ? 'block' : 'none';
  }

  if (entryMode === 'quick' && !prefills) {
    document.getElementById('categoryChips')?.querySelector('button')?.focus();
  } else if (mode === 'renewal') {
    const renewalInput = document.getElementById('fRenewalDue');
    if (renewalInput) {
      renewalInput.focus();
      renewalInput.classList.add('form-highlight');
      setTimeout(() => renewalInput.classList.remove('form-highlight'), 2000);
    }
  }

  openOverlay('formModal');
};

window.openQuickAdd = function(sourceId = null) {
  const sourceLoan = sourceId ? S.loans.find(x => x.id === sourceId) : null;
  window.openForm(null, '', {
    entryMode: 'quick',
    prefillLoan: sourceLoan || null
  });
};

window.openContextualAdd = function() {
  if (S.appMode === 'renewals') {
    window.openAddBackRenewal();
  } else {
    window.openQuickAdd();
  }
};

window.openAddBackRenewal = function() {
  if (!S.user) { if (window.showUserSelect) window.showUserSelect(); return; }
  window.openForm(null, 'renewal-addback', { entryMode: 'full' });
};

window.closeForm = function() {
  closeOverlay('formModal');
};

window.editLoan = id => {
  const l = S.loans.find(x => x.id === id);
  if (l) window.openForm(l, '', { entryMode: 'full' });
};

window.duplicateLoan = id => {
  const l = S.loans.find(x => x.id === id);
  if (l) window.openQuickAdd(id);
};

// BRE is a manual flag: it's only offered for SME loans above 10 lacs (the
// BRE sanctioning journey doesn't apply to smaller tickets). Whether such a
// loan actually went through BRE is still the user's call.
window.updateBreCheckbox = function() {
  const group = document.getElementById('fBreGroup');
  const checkbox = document.getElementById('fBre');
  if (!group || !checkbox) return;
  const isSme = (getCategorySelect()?.value || '') === 'SME';
  const amount = parseFloat(document.getElementById('fAmount')?.value);
  const eligible = isSme && amount > 10;
  group.style.display = eligible ? 'flex' : 'none';
  if (!eligible) checkbox.checked = false;
};

window.toggleTermLoan = function(cat) {
  const loanTypeGroup = document.getElementById('fLoanTypeGroup');
  const renewalGroup = document.getElementById('fRenewalGroup');
  const limitExpiryGroup = document.getElementById('fLimitExpiryGroup');
  if (loanTypeGroup) loanTypeGroup.style.display = cat === 'SME' ? 'flex' : 'none';
  if (renewalGroup) renewalGroup.style.display = cat === 'SME' ? 'block' : 'none';
  if (limitExpiryGroup) limitExpiryGroup.style.display = cat === 'SME' ? 'block' : 'none';
  window.updateBreCheckbox();
};

export { getBranchSearchInput, getBranchValueInput, getCategorySelect, setLoanTypeValue, getLoanTypeValue, loanTypeFromLoan, normalizeName, normalizeBranchText, recentBranches, saveRecentBranch, branchesForUser, branchLabel, duplicateCardHtml, populateFormOptions, renderCategoryChips, updateCategoryHint, setCategoryValue, matchBranchOption, assignedOfficerForBranch, setAdvancedFieldsVisible, setFormEntryMode, updateAssignedOfficerHint, updateBranchMatchHint, renderBranchQuickPicks, setBranchValue, fillFormFromLoan, getDuplicateMatches, showDuplicateModal, confirmPotentialDuplicate, RECENT_BRANCHES_KEY, duplicateDecisionResolve };
