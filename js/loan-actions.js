import { S } from "./state.js";
import { updateLoan, createLoan, removeLoan } from "./db.js";
import { createNotification } from "./notifications.js";
import { todayStr, showUndoToast, toast, esc } from "./utils.js";
import { db } from "./config.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

/* ── CORE LOAN ACTIONS ── */
window.sanctionLoan = async function(id) {
  const l = S.loans.find(x => x.id === id); if (!l) return;
  if (!confirm(`Sanction loan for ${l.customerName}?`)) return;
  try {
    await updateLoan(id, { status: 'sanctioned', sanctionDate: todayStr() });
    createNotification('sanctioned', { ...l, status: 'sanctioned' }).catch(() => { });
    toast('Sanctioned ✓');
  } catch (e) { toast('Error'); }
};

window.returnLoan = async function(id) {
  const l = S.loans.find(x => x.id === id); if (!l) return;
  const reason = prompt(`Reason for returning ${l.customerName}?`, l.remarks || '');
  if (reason === null) return;
  try {
    await updateLoan(id, { status: 'returned', remarks: reason, returnedDate: todayStr() });
    createNotification('returned', { ...l, status: 'returned' }).catch(() => { });
    toast('Marked as returned');
  } catch (e) { toast('Error'); }
};

window.moveToPending = async function(id) {
  const l = S.loans.find(x => x.id === id); if (!l) return;
  if (!confirm(`Move ${l.customerName} back to Pending?`)) return;
  try { await updateLoan(id, { status: 'pending' }); toast('Moved to pending'); }
  catch (e) { toast('Error'); }
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

window.openForm = function(loan = null, mode = null) {
  if (!S.user) { if (window.showUserSelect) window.showUserSelect(); return; }
  document.getElementById('fOfficer').innerHTML = '<option value="">Select officer</option>' + S.officers.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
  document.getElementById('fBranch').innerHTML = '<option value="">Select branch</option>' + S.branches.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
  const modeInput = document.getElementById('formMode');
  if (modeInput) modeInput.value = mode || '';
  if (loan) {
    document.getElementById('formTitle').textContent = mode === 'renewal-done' ? 'Mark Renewal Done' : 'Edit Loan';
    document.getElementById('loanId').value = loan.id;
    document.getElementById('fOfficer').value = loan.allocatedTo || '';
    document.getElementById('fCategory').value = loan.category || '';
    const tg = document.getElementById('fTermLoanGroup'), tc = document.getElementById('fTermLoan');
    if (tg && tc) { tg.style.display = loan.category === 'SME' ? 'flex' : 'none'; tc.checked = !!loan.isTermLoan; }

    // Renewal Group
    const rg = document.getElementById('fRenewalGroup');
    if (rg) {
      rg.style.display = loan.category === 'SME' ? 'block' : 'none';
      const rd = document.getElementById('fRenewalDue');
      if (rd) rd.value = mode === 'renewal-done' ? '' : (loan.renewalDueDate || '');
    }
    // Limit Expiry Group
    const leg = document.getElementById('fLimitExpiryGroup');
    if (leg) {
      leg.style.display = loan.category === 'SME' ? 'block' : 'none';
      const le = document.getElementById('fLimitExpiry');
      if (le) le.value = mode === 'renewal-done' ? '' : (loan.limitExpiryDate || '');
    }

    // Branch: try exact match first, then code-prefix match for imported loans
    const branchSel = document.getElementById('fBranch');
    branchSel.value = loan.branch || '';
    if (!branchSel.value && loan.branch) {
      const code = String(loan.branch).trim().split(/\s*[:]/)[0].trim();
      const match = S.branches.find(b => b.split(/\s*[:]/)[0].trim() === code);
      if (match) branchSel.value = match;
    }

    document.getElementById('fName').value = loan.customerName || '';
    document.getElementById('fAmount').value = loan.amount || '';
    document.getElementById('fReceive').value = loan.receiveDate || '';
    document.getElementById('fSanction').value = loan.sanctionDate || '';
    document.getElementById('fRemarks').value = loan.remarks || '';

    // Show/hide date groups based on mode
    if (mode === 'renewal-done') {
      document.getElementById('fReceiveGroup').style.display = 'none';
      document.getElementById('fSanctionGroup').style.display = 'none';
      const rd = document.getElementById('fRenewalDue');
      const le = document.getElementById('fLimitExpiry');
      if (rd) rd.placeholder = 'Optional - enter official next due date';
      if (le) le.placeholder = 'Optional - enter official new expiry date';
    } else {
      document.getElementById('fReceiveGroup').style.display = '';
      document.getElementById('fSanctionGroup').style.display = loan.status === 'sanctioned' ? 'block' : 'none';
    }

    if (mode === 'renewal') {
      const rd = document.getElementById('fRenewalDue');
      if (rd) {
        rd.focus();
        rd.classList.add('form-highlight');
        setTimeout(() => rd.classList.remove('form-highlight'), 2000);
      }
    }
  } else {
    const form = document.getElementById('loanForm'); if (form) form.reset();
    document.getElementById('formTitle').textContent = 'Add New Loan';
    document.getElementById('loanId').value = '';
    document.getElementById('fReceive').value = todayStr();
    document.getElementById('fReceiveGroup').style.display = '';
    document.getElementById('fSanctionGroup').style.display = 'none';
    const tg = document.getElementById('fTermLoanGroup'), tc = document.getElementById('fTermLoan');
    if (tg && tc) { tg.style.display = 'none'; tc.checked = false; }
    const rg = document.getElementById('fRenewalGroup'); if (rg) rg.style.display = 'none';
    const leg = document.getElementById('fLimitExpiryGroup'); if (leg) leg.style.display = 'none';
    if (S.user && !S.isAdmin) document.getElementById('fOfficer').value = S.user;
  }
  document.getElementById('formModal').style.display = 'flex';
};

window.closeForm = () => document.getElementById('formModal').style.display = 'none';
window.editLoan = id => { const l = S.loans.find(x => x.id === id); if (l) window.openForm(l); };

window.toggleTermLoan = function(cat) {
  const tg = document.getElementById('fTermLoanGroup');
  if (tg) tg.style.display = cat === 'SME' ? 'flex' : 'none';
  const rg = document.getElementById('fRenewalGroup');
  if (rg) rg.style.display = cat === 'SME' ? 'block' : 'none';
  const leg = document.getElementById('fLimitExpiryGroup');
  if (leg) leg.style.display = cat === 'SME' ? 'block' : 'none';
};

window.saveLoan = async function(e) {
  e.preventDefault();
  const id = document.getElementById('loanId').value;
  const mode = document.getElementById('formMode')?.value || '';
  const cat = document.getElementById('fCategory').value;
  let termLoan = false;
  if (cat === 'SME') { const tc = document.getElementById('fTermLoan'); termLoan = tc ? tc.checked : false; }
  
  const data = {
    allocatedTo: document.getElementById('fOfficer').value,
    category: cat, branch: document.getElementById('fBranch').value,
    customerName: document.getElementById('fName').value.trim().toUpperCase(),
    amount: parseFloat(document.getElementById('fAmount').value),
    receiveDate: document.getElementById('fReceive').value,
    remarks: document.getElementById('fRemarks').value.trim()
  };
  
  if (cat === 'SME') {
    data.isTermLoan = termLoan;
    const existing = id ? S.loans.find(x => x.id === id) : null;
    const isImported = (existing && existing.isImported) || (id && id.startsWith('import_sme_csv_'));
    if (!isImported) { data.isFreshCC = true; data.manuallyCreated = true; }
    else { data.isFreshCC = false; data.isImported = true; }

    const rd = document.getElementById('fRenewalDue');
    const le = document.getElementById('fLimitExpiry');
    if (mode === 'renewal-done') {
      const hasRenewalDue = !!(rd && rd.value);
      const hasLimitExpiry = !!(le && le.value);
      data.renewedDate = todayStr();
      data.renewalDatesPending = !(hasRenewalDue && hasLimitExpiry);
      if (hasRenewalDue) data.renewalDueDate = rd.value;
      if (hasLimitExpiry) data.limitExpiryDate = le.value;
    } else {
      data.renewalDueDate = (rd && rd.value) ? rd.value : '';
      data.limitExpiryDate = (le && le.value) ? le.value : '';
      if (id && data.renewalDueDate && data.limitExpiryDate) data.renewalDatesPending = false;
    }
  }
  const sd = document.getElementById('fSanction').value;
  if (sd) data.sanctionDate = sd;
  
  try {
    if (id) {
      await updateLoan(id, data);
      createNotification('edited', { ...data, id }).catch(() => { });
      toast('Loan updated ✓');
    } else {
      const nid = await createLoan(data);
      createNotification('added', { ...data, id: nid }).catch(() => { });
      toast('Loan added ✓');
    }
    window.closeForm();
  } catch (err) { toast('Error saving'); console.error(err); }
};

window.markRenewalDone = async function(id) {
  const l = S.loans.find(x => x.id === id); if (!l) return;
  window.openForm({ ...l, renewedDate: l.renewedDate || todayStr() }, 'renewal-done');
};

window.undoRenewalDone = async function(id) {
  const l = S.loans.find(x => x.id === id); if (!l) return;
  if (!confirm(`Undo renewal for ${l.customerName}? It will return to overdue/due-soon.`)) return;
  try {
    await updateLoan(id, { renewedDate: '', renewalDatesPending: false });
    toast('Renewal undone');
  } catch (e) { toast('Error'); }
};
