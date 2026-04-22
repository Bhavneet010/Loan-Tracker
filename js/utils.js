export const todayStr = () => { 
  const d = new Date(); 
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); 
  return d.toISOString().slice(0, 10); 
};

export const fmtDate = s => { 
  if (!s) return ''; 
  const p = s.split('-'); 
  if (p.length !== 3) return s;
  return `${p[2]}.${p[1]}.${p[0]}`; 
};

export const fmtShortDate = s => { 
  if (!s) return ''; 
  const [, m, d] = s.split('-'); 
  return `${parseInt(d)} ${'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[parseInt(m) - 1]}`; 
};

export const branchCode = s => (s || '').split(' ')[0] || '';
export const shortCat = s => ({ 'Agriculture': 'Agri', 'Education': 'Edu' }[s] || s);
export const fmtAmt = v => (parseFloat(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const esc = s => s == null ? '' : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const initials = n => (n || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
export const catCls = c => ({ Agriculture: 'agri', SME: 'sme', Education: 'edu' }[c] || '');

export const OFFICER_PALETTE = [
  { bg: 'linear-gradient(135deg,#7B6FD4,#5A4EAF)' },
  { bg: 'linear-gradient(135deg,#10B981,#047857)' },
  { bg: 'linear-gradient(135deg,#F59E0B,#B45309)' },
  { bg: 'linear-gradient(135deg,#EC4899,#BE185D)' },
  { bg: 'linear-gradient(135deg,#0EA5E9,#0369A1)' },
  { bg: 'linear-gradient(135deg,#8B5CF6,#5B21B6)' }
];

export const officerColor = n => {
  const s = String(n || ''); 
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return OFFICER_PALETTE[h % OFFICER_PALETTE.length];
};

export function toast(msg) {
  document.querySelectorAll('.toast').forEach(e => e.remove());
  const t = document.createElement('div'); 
  t.className = 'toast'; 
  t.textContent = msg;
  document.body.appendChild(t); 
  setTimeout(() => t.remove(), 2600);
}

export const daysPending = d => !d ? 0 : Math.floor((Date.now() - new Date(d).getTime()) / 86400000);

export function isFreshCC(loan) {
  if (loan.isFreshCC === true) return true;
  if (loan.isFreshCC === false) return false;
  if (loan.id && String(loan.id).startsWith('import_sme_csv_')) return false;
  const isImported = loan.source && String(loan.source).includes('import');
  return !isImported;
}

export function computeRenewalStatus(loan) {
  if (!loan.sanctionDate && !loan.limitExpiryDate) return null;
  const now = Date.now();
  let msDue, msStart;

  if (loan.renewalDueDate) {
    msDue = new Date(loan.renewalDueDate).getTime();
    msStart = msDue - 365 * 86400000;
  } else if (loan.limitExpiryDate) {
    msDue = new Date(loan.limitExpiryDate).getTime();
    msStart = msDue - 365 * 86400000;
  } else if (loan.sanctionDate) {
    msStart = new Date(loan.sanctionDate).getTime();
    msDue = msStart + 365 * 86400000;
  } else {
    return null;
  }

  if (isNaN(msDue) || isNaN(msStart)) return null;

  const daysSinceSanction = Math.floor((now - msStart) / 86400000);
  const msNpa = msDue + 181 * 86400000;
  const dueDateStr = new Date(msDue).toISOString().slice(0, 10);
  const npaDateStr = new Date(msNpa).toISOString().slice(0, 10);
  const daysToDue = Math.floor((msDue - now) / 86400000);
  
  let status, daysUntilDue = 0, daysOverdue = 0, daysUntilNpa = 0;
  
  if (daysToDue > 30) {
    status = 'active'; daysUntilDue = daysToDue; daysUntilNpa = daysToDue + 181;
  } else if (daysToDue >= 0) {
    status = 'due-soon'; daysUntilDue = daysToDue; daysUntilNpa = daysToDue + 181;
  } else if (daysToDue > -181) {
    status = 'pending-renewal'; daysOverdue = -daysToDue; daysUntilNpa = 181 + daysToDue;
  } else {
    status = 'npa'; daysOverdue = -daysToDue;
  }
  return { status, daysSinceSanction, daysUntilDue, daysOverdue, daysUntilNpa, dueDateStr, npaDateStr };
}

export function isRenewalDatesMissing(loan) {
  return !!loan.renewedDate && (
    loan.renewalDatesPending === true ||
    !loan.renewalDueDate ||
    !loan.limitExpiryDate
  );
}

export function showUndoToast(msg, undoFn) {
  document.querySelectorAll('.toast').forEach(e => e.remove());
  const t = document.createElement('div'); t.className = 'toast toast-undo';
  const sp = document.createElement('span'); sp.textContent = msg;
  const btn = document.createElement('button'); btn.className = 'undo-btn'; btn.textContent = 'Undo';
  btn.onclick = async () => { clearTimeout(t._timer); t.remove(); await undoFn(); };
  t.appendChild(sp); t.appendChild(btn);
  document.body.appendChild(t);
  t._timer = setTimeout(() => t.remove(), 4500);
}

export function slugifyId(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
}
