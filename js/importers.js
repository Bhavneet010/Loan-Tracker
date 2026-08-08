import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { db } from "./config.js";
import { S } from "./state.js";
import { slugifyId, toast, isFreshCC } from "./utils.js";
import { ts } from "./db.js";

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
    const btn = document.getElementById('importCsvBtn');
    try {
      const text = String(ev.target.result).replace(/^\uFEFF/, '');
      const rows = text.split(/\r?\n/).filter(r => r.trim());
      if (rows.length < 2) { toast('Empty CSV'); return; }

      const parseLine = (line) => {
        let cols = [], cur = '', inQuote = false;
        for (let j = 0; j < line.length; j++) {
          const c = line[j];
          if (c === '"' && line[j + 1] === '"') { cur += '"'; j++; }
          else if (c === '"') inQuote = !inQuote;
          else if (c === ',' && !inQuote) { cols.push(cur); cur = ''; }
          else cur += c;
        }
        cols.push(cur);
        return cols.map(c => c.trim());
      };

      const ALIASES = {
        branch: ['HOME BRANCH', 'BRANCH', 'BRANCH CODE', 'BRANCH NAME', 'SOL ID'],
        acNumber: ['AC NUMBER', 'A/C NUMBER', 'A/C NO', 'AC NO', 'ACCOUNT NUMBER', 'ACCOUNT NO', 'ACCT NO'],
        customerName: ['CUSTOMER NAME', 'CUST NAME', 'CUSTOMER', 'BORROWER NAME', 'PARTY NAME', 'NAME'],
        amount: ['LIMIT', 'SANCTION LIMIT', 'SANCTIONED LIMIT', 'SANC LIMIT', 'LIMIT AMOUNT', 'LIMIT AMT'],
        limitExpiryDate: ['LMT EXPY DT', 'LIMIT EXPIRY DATE', 'LIMIT EXPIRY', 'LMT EXP DT', 'EXPIRY DATE', 'EXPY DT'],
        renewalDueDate: ['RENEWAL DATE', 'RENEWAL DUE DATE', 'RENEWAL DUE', 'NEXT RENEWAL DATE']
      };
      const fieldFor = (h) => Object.keys(ALIASES).find(f => ALIASES[f].includes(h)) || null;

      // Bank exports often carry report-title lines above the real header row
      // — scan the first few lines for the one holding a customer-name column.
      let headerIdx = -1, colMap = null;
      for (let i = 0; i < Math.min(rows.length, 10) && headerIdx < 0; i++) {
        const cells = parseLine(rows[i]).map(c => c.toUpperCase().replace(/\s+/g, ' ').trim());
        const map = {};
        cells.forEach((h, idx) => { const f = fieldFor(h); if (f && map[f] === undefined) map[f] = idx; });
        if (map.customerName !== undefined) { headerIdx = i; colMap = map; }
      }
      if (headerIdx < 0) {
        const found = parseLine(rows[0]).filter(Boolean).slice(0, 8).join(', ');
        toast(`CSV not recognised — no customer name column found. First row reads: ${found}`);
        return;
      }

      let added = 0, updated = 0, renewedUntouched = 0, unchanged = 0, noName = 0;
      if (btn) { btn.disabled = true; btn.textContent = 'Importing...'; }
      const createdIds = new Set();
      const normAc = v => String(v || '').replace(/\D/g, '');
      const isRenewalAccount = l => l.category === 'SME' && !isFreshCC(l);
      const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
      const parseDate = (dStr) => {
        if (!dStr) return '';
        const s = dStr.trim();
        let m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
        if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{2}|\d{4})$/);
        if (m && MONTHS[m[2].toUpperCase()]) {
          return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${MONTHS[m[2].toUpperCase()]}-${m[1].padStart(2, '0')}`;
        }
        return s;
      };

      for (let i = headerIdx + 1; i < rows.length; i++) {
        const cols = parseLine(rows[i]);
        const get = f => colMap[f] === undefined ? '' : (cols[colMap[f]] || '');
        let obj = { allocatedTo: '' };
        obj.branch = get('branch');
        obj.acNumber = get('acNumber');
        obj.customerName = get('customerName');
        obj.amount = Number(((parseFloat(get('amount').replace(/[^0-9.]/g, '')) || 0) / 100000).toFixed(2));
        obj.limitExpiryDate = parseDate(get('limitExpiryDate'));
        obj.renewalDueDate = parseDate(get('renewalDueDate'));
        if (!obj.customerName) { noName++; continue; }
        // Branch column may hold "2413" or "2413 : MAJRA" — officer map is keyed by code
        const brKey = (obj.branch.match(/\d+/) || [])[0];
        if (S.branchOfficers && (S.branchOfficers[obj.branch] || (brKey && S.branchOfficers[brKey]))) {
          obj.allocatedTo = S.branchOfficers[obj.branch] || S.branchOfficers[brKey];
        }
        const baseDate = obj.limitExpiryDate || obj.renewalDueDate || '';
        const id = ('import_sme_csv_' + slugifyId(obj.customerName)).replace(/-/g, '');

        // Match existing renewal accounts by import id, then account number,
        // then customer name, so manually-added accounts get updated instead
        // of duplicated.
        let existing = S.loanMap.get(id) || null;
        if (!existing && normAc(obj.acNumber)) {
          existing = S.loans.find(l => isRenewalAccount(l) && normAc(l.acNumber) === normAc(obj.acNumber)) || null;
        }
        if (!existing) {
          const name = obj.customerName.toUpperCase();
          existing = S.loans.find(l => isRenewalAccount(l) && (l.customerName || '').toUpperCase() === name) || null;
        }
        if (!existing && createdIds.has(id)) { unchanged++; continue; }
        if (!existing) {
          const snap = await getDoc(doc(db, 'loans', id));
          if (snap.exists()) existing = { id, ...snap.data() };
        }

        if (existing) {
          // Renewal already done: leave the account completely untouched so
          // the renewed/documentation/integration state is never disturbed.
          if (existing.renewedDate) { renewedUntouched++; continue; }
          const data = {};
          if (obj.limitExpiryDate && obj.limitExpiryDate !== existing.limitExpiryDate) data.limitExpiryDate = obj.limitExpiryDate;
          if (obj.renewalDueDate && obj.renewalDueDate !== existing.renewalDueDate) data.renewalDueDate = obj.renewalDueDate;
          if (obj.amount && obj.amount !== existing.amount) data.amount = obj.amount;
          if (obj.acNumber && !existing.acNumber) data.acNumber = obj.acNumber;
          if (Object.keys(data).length) {
            await updateDoc(doc(db, 'loans', existing.id), { ...data, ...ts() });
            updated++;
          } else unchanged++;
          continue;
        }

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
        createdIds.add(id);
        added++;
      }
      const parts = [`${added} added`, `${updated} updated`];
      if (renewedUntouched) parts.push(`${renewedUntouched} renewed (untouched)`);
      if (unchanged) parts.push(`${unchanged} unchanged`);
      if (noName) parts.push(`${noName} rows without name skipped`);
      toast(`CSV Import: ${parts.join(', ')}`);
    } catch (err) {
      console.error(err); toast('Error parsing CSV');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '📥 Upload CSV'; }
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
