import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { db } from "./config.js";
import { S, saveSettings } from "./state.js";
import { todayStr, slugifyId, toast, isFreshCC } from "./utils.js";
import { ts } from "./db.js";
import { renderSettingsList } from "./ui-settings.js";

export async function importReturnsFromUrl(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load ' + url);
  const payload = await res.json();
  const period = payload.period || 'unknown';
  const defaultDate = payload.returnedDate || todayStr();
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  let added = 0, skipped = 0;
  for (const e of entries) {
    const returnedDate = e.returnedDate || defaultDate;
    const receiveDate = e.receiveDate || returnedDate;
    const id = `import_returns_${period}_${slugifyId(e.customerName)}`.replace(/-/g, '');
    const existing = await getDoc(doc(db, 'loans', id));
    if (existing.exists()) {
      if (existing.data().isFreshCC === undefined) await updateDoc(doc(db, 'loans', id), { isFreshCC: true, ...ts() });
      skipped++; continue;
    }
    await setDoc(doc(db, 'loans', id), {
      allocatedTo: e.allocatedTo,
      category: e.category,
      branch: e.branch,
      customerName: (e.customerName || '').toUpperCase(),
      amount: parseFloat(e.amount) || 0,
      receiveDate, returnedDate,
      remarks: e.remarks || '',
      status: 'returned',
      isFreshCC: true,
      createdAt: new Date().toISOString(),
      createdBy: S.user || 'import',
      source: `import:returns:${period}`,
      ...ts()
    });
    added++;
  }
  return { added, skipped, total: entries.length, label: payload.label || period };
}

window.importMonthlyReturns = async function () {
  if (!S.isAdmin) { toast('Admin only'); return; }
  const url = 'data/returns-2026-04.json';
  if (!confirm('Import April 2026 returns into Firestore? Existing entries (matched by customer) will be skipped.')) return;
  const btn = document.getElementById('importReturnsBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Importing...'; }
  try {
    const r = await importReturnsFromUrl(url);
    toast(`${r.label}: ${r.added} added, ${r.skipped} skipped`);
  } catch (e) { console.error(e); toast('Import failed'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '📥 Import April 2026 returns'; } }
};

window.triggerCsvUpload = function () {
  if (!S.isAdmin) { toast('Admin only'); return; }
  const f = document.getElementById('csvFileInput');
  if (f) { f.value = ''; f.click(); }
};

window.handleCsvUpload = function (e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function (ev) {
    try {
      const text = ev.target.result;
      const rows = text.split('\n').filter(Boolean);
      if (rows.length < 2) { toast('Empty CSV'); return; }
      const header = rows[0].split(',').map(c => c.toUpperCase().trim());
      let added = 0, skipped = 0;
      const btn = document.getElementById('importCsvBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'Importing...'; }
      
      for (let i = 1; i < rows.length; i++) {
        let cols = [];
        let cur = '', inQuote = false;
        for (let j = 0; j < rows[i].length; j++) {
          const c = rows[i][j];
          if (c === '"' && rows[i][j + 1] === '"') { cur += '"'; j++; }
          else if (c === '"') inQuote = !inQuote;
          else if (c === ',' && !inQuote) { cols.push(cur); cur = ''; }
          else cur += c;
        }
        cols.push(cur);
        cols = cols.map(c => c.trim());
        let obj = { allocatedTo: '' };
        const parseDate = (dStr) => {
          if (!dStr) return '';
          let s = dStr.trim();
          if (s.match(/^\d{2}-\d{2}-\d{4}$/)) {
            const p = s.split('-'); return `${p[2]}-${p[1]}-${p[0]}`;
          } else if (s.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
            const p = s.split('/'); return `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
          }
          return s;
        };
        header.forEach((h, idx) => {
          const val = cols[idx] || '';
          if (h === 'HOME BRANCH') obj.branch = val;
          else if (h === 'AC NUMBER') obj.acNumber = val;
          else if (h === 'CUSTOMER NAME') obj.customerName = val;
          else if (h === 'LIMIT') obj.amount = Number(((parseFloat(val.replace(/[^0-9.]/g, '')) || 0) / 100000).toFixed(2));
          else if (h === 'LMT EXPY DT') obj.limitExpiryDate = parseDate(val);
          else if (h === 'RENEWAL DATE') obj.renewalDueDate = parseDate(val);
        });
        if (!obj.customerName) continue;
        if (obj.branch && S.branchOfficers && S.branchOfficers[obj.branch]) {
          obj.allocatedTo = S.branchOfficers[obj.branch];
        }
        const baseDate = obj.limitExpiryDate || obj.renewalDueDate || '';
        const id = ('import_sme_csv_' + slugifyId(obj.customerName)).replace(/-/g, '');
        const existingDoc = await getDoc(doc(db, 'loans', id));
        if (existingDoc.exists()) { skipped++; continue; }
        await setDoc(doc(db, 'loans', id), {
          allocatedTo: obj.allocatedTo || '',
          category: 'SME', branch: obj.branch || '',
          acNumber: obj.acNumber || '',
          customerName: obj.customerName.toUpperCase(),
          amount: obj.amount || 0,
          limitExpiryDate: obj.limitExpiryDate || '',
          renewalDueDate: obj.renewalDueDate || '',
          receiveDate: baseDate,
          sanctionDate: baseDate,
          remarks: '',
          status: 'sanctioned',
          isFreshCC: false,
          isImported: true,
          createdAt: new Date().toISOString(), createdBy: S.user || 'import',
          source: 'import:sme_renewal:csv', ...ts()
        });
        added++;
      }
      toast(`CSV Import: ${added} added, ${skipped} skipped`);
      if (btn) { btn.disabled = false; btn.textContent = '📥 Upload CSV (CC Accounts)'; }
    } catch (err) {
      console.error(err); toast('Error parsing CSV');
      if (btn) { btn.disabled = false; btn.textContent = '📥 Upload CSV (CC Accounts)'; }
    }
  };
  reader.readAsText(file);
};

window.clearAllSmeRenewals = async function () {
  if (!S.isAdmin) { toast('Admin only'); return; }
  if (!confirm('Are you absolutely sure you want to delete ALL SME CC Renewal data? This cannot be undone!')) return;
  try {
    const btn = document.getElementById('clearRenewalsBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Wiping Data...'; }
    const snap = await getDocs(query(collection(db, 'loans')));
    let deletedCount = 0;
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      if (data.category === 'SME' && !isFreshCC(data)) {
        await deleteDoc(doc(db, 'loans', docSnap.id));
        deletedCount++;
      }
    }
    toast(`Successfully wiped ${deletedCount} SME CC records!`);
  } catch (e) { console.error(e); toast('Error clearing data'); }
  finally {
    const btn = document.getElementById('clearRenewalsBtn');
    if (btn) { btn.disabled = false; btn.textContent = '🗑️ Clear All SME Renewals Data'; }
  }
};

window.wipeSanctionedFreshLoans = async function () {
  if (!S.isAdmin) { toast('Admin only'); return; }
  if (!confirm('This will PERMANENTLY delete ALL manual (Fresh) Sanctioned loans. You will have to re-enter them. Are you sure?')) return;
  try {
    const btn = document.getElementById('wipeFreshBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Wiping Fresh Data...'; }
    const snap = await getDocs(query(collection(db, 'loans')));
    let deletedCount = 0;
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const id = docSnap.id;
      if (isFreshCC({ ...data, id }) && data.status === 'sanctioned') {
        await deleteDoc(doc(db, 'loans', id));
        deletedCount++;
      }
    }
    toast(`Successfully wiped ${deletedCount} fresh sanctioned records!`);
    window.render();
  } catch (e) { console.error(e); toast('Error wiping data'); }
  finally {
    const btn = document.getElementById('wipeFreshBtn');
    if (btn) { btn.disabled = false; btn.textContent = '🗑️ Wipe All Sanctioned Fresh Loans'; }
  }
};

async function importSanctionedFromUrl(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load ' + url);
  const payload = await res.json();
  const period = payload.period || 'unknown';
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  let added = 0, skipped = 0;
  for (const e of entries) {
    const id = `import_sanctioned_${period}_${slugifyId(e.customerName)}`.replace(/-/g, '');
    const existing = await getDoc(doc(db, 'loans', id));
    if (existing.exists()) { skipped++; continue; }
    await setDoc(doc(db, 'loans', id), {
      allocatedTo: e.allocatedTo,
      category: e.category || 'Agriculture',
      branch: e.branch,
      customerName: (e.customerName || '').toUpperCase(),
      amount: parseFloat(e.amount) || 0,
      receiveDate: e.receiveDate || '',
      sanctionDate: e.sanctionDate || '',
      remarks: e.remarks || '',
      status: 'sanctioned',
      isFreshCC: true,
      manuallyCreated: false,
      createdAt: new Date().toISOString(),
      createdBy: S.user || 'import',
      source: `import:sanctioned:${period}`,
      ...ts()
    });
    added++;
  }
  return { added, skipped, total: entries.length, label: payload.label || period };
}

window.importMonthlySanctioned = async function () {
  if (!S.isAdmin) { toast('Admin only'); return; }
  const url = 'data/sanctioned-2026-04.json';
  if (!confirm('Import April 2026 sanctioned loans into Firestore? Existing entries (matched by customer) will be skipped.')) return;
  const btn = document.getElementById('importSanctionedBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Importing...'; }
  try {
    const r = await importSanctionedFromUrl(url);
    toast(`${r.label}: ${r.added} added, ${r.skipped} skipped`);
  } catch (e) { console.error(e); toast('Import failed'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '📥 Import April 2026 sanctioned'; } }
};
