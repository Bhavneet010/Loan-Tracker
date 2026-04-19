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

window.openForm = function(loan = null) {
  if (!S.user) { if (window.showUserSelect) window.showUserSelect(); return; }
  document.getElementById('fOfficer').innerHTML = '<option value="">Select officer</option>' + S.officers.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
  document.getElementById('fBranch').innerHTML = '<option value="">Select branch</option>' + S.branches.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
  if (loan) {
    document.getElementById('formTitle').textContent = 'Edit Loan';
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
      if (rd) rd.value = loan.renewalDueDate || '';
    }

    document.getElementById('fBranch').value = loan.branch || '';
    document.getElementById('fName').value = loan.customerName || '';
    document.getElementById('fAmount').value = loan.amount || '';
    document.getElementById('fReceive').value = loan.receiveDate || '';
    document.getElementById('fSanction').value = loan.sanctionDate || '';
    document.getElementById('fRemarks').value = loan.remarks || '';
    document.getElementById('fSanctionGroup').style.display = loan.status === 'sanctioned' ? 'block' : 'none';
    
    if (arguments[1] === true) { // isRenewal flag
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
    document.getElementById('fSanctionGroup').style.display = 'none';
    const tg = document.getElementById('fTermLoanGroup'), tc = document.getElementById('fTermLoan');
    if (tg && tc) { tg.style.display = 'none'; tc.checked = false; }
    if (S.user && !S.isAdmin) document.getElementById('fOfficer').value = S.user;
  }
  document.getElementById('formModal').style.display = 'flex';
};

window.closeForm = () => document.getElementById('formModal').style.display = 'none';
window.editLoan = id => { const l = S.loans.find(x => x.id === id); if (l) window.openForm(l); };

window.toggleTermLoan = function(cat) {
  const el = document.getElementById('fTermLoanGroup');
  if (el) el.style.display = cat === 'SME' ? 'flex' : 'none';
};

window.saveLoan = async function(e) {
  e.preventDefault();
  const id = document.getElementById('loanId').value;
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
    if (rd && rd.value) data.renewalDueDate = rd.value;
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
  if (!confirm(`Mark renewal done for ${l.customerName}?`)) return;
  try {
    await updateLoan(id, { renewedDate: todayStr() });
    toast('Renewal marked done ✓');
  } catch (e) { toast('Error'); }
};
