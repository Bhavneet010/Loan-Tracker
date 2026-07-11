import { countWorkingDaysBetween } from "./bank-holidays.js";
import { animateOverlayIn, animateOverlayOut } from "./animate.js";

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

export const monthOf = d => (d || '').slice(0, 7);

// Documentation/disbursement stage tracking applies to loans sanctioned (or
// renewals done) from this month onward. Older records are treated as complete
// so month-end cleanup keeps its original behavior for them.
export const STAGE_TRACKING_START_MONTH = '2026-07';

export const isStageTracked = date => monthOf(date) >= STAGE_TRACKING_START_MONTH;

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

/* Flat marker-style palette used while the sketchnote theme is active.
   Gradients would clash with the hand-drawn flat aesthetic. */
export const OFFICER_PALETTE_SKETCH = [
  { bg: '#E85D5D' }, /* coral */
  { bg: '#5BC2A8' }, /* mint */
  { bg: '#FFD55C' }, /* sunshine yellow */
  { bg: '#6BA8D9' }, /* sky blue */
  { bg: '#F08FB0' }, /* dusty pink */
  { bg: '#9D87C7' }  /* lilac */
];

export const officerColor = n => {
  const s = String(n || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const isSketch = typeof document !== 'undefined'
    && document.body
    && document.body.classList.contains('theme-sketchnote');
  const palette = isSketch ? OFFICER_PALETTE_SKETCH : OFFICER_PALETTE;
  return palette[h % palette.length];
};

export function toast(msg) {
  document.querySelectorAll('.toast').forEach(e => e.remove());
  const t = document.createElement('div'); 
  t.className = 'toast'; 
  t.textContent = msg;
  document.body.appendChild(t); 
  setTimeout(() => t.remove(), 2600);
}

// In-app replacement for window.confirm(): a small centered modal in the
// app's design language. Resolves true on confirm, false on cancel/dismiss.
export function appConfirm({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel' } = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'overlay center confirm-overlay';
    overlay.innerHTML = `<div class="modal-box confirm-box" role="alertdialog" aria-modal="true" aria-label="${esc(title)}">
      <h2>${esc(title)}</h2>
      ${message ? `<p>${esc(message)}</p>` : ''}
      <div class="confirm-actions">
        <button type="button" class="btn btn-cancel-full" data-confirm-cancel>${esc(cancelLabel)}</button>
        <button type="button" class="btn btn-primary-full" data-confirm-ok>${esc(confirmLabel)}</button>
      </div>
    </div>`;
    let settled = false;
    const done = val => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey);
      animateOverlayOut(overlay, () => resolve(val));
    };
    const onKey = e => { if (e.key === 'Escape') done(false); };
    overlay.addEventListener('click', e => { if (e.target === overlay) done(false); });
    overlay.querySelector('[data-confirm-cancel]').addEventListener('click', () => done(false));
    overlay.querySelector('[data-confirm-ok]').addEventListener('click', () => done(true));
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    animateOverlayIn(overlay);
  });
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
  // Working days from today (exclusive) to NPA date (inclusive). Skips Sundays,
  // 2nd/4th Saturdays, and admin-marked bank holidays.
  const npaCountdown = countWorkingDaysBetween(todayStr(), npaDateStr);

  let status, daysUntilDue = 0, daysOverdue = 0, daysUntilNpa = 0;

  if (daysToDue > 30) {
    status = 'active'; daysUntilDue = daysToDue; daysUntilNpa = npaCountdown;
  } else if (daysToDue >= 0) {
    status = 'due-soon'; daysUntilDue = daysToDue; daysUntilNpa = npaCountdown;
  } else if (now < msNpa) {
    // Use timestamp comparison, not daysToDue > -181, so Math.floor can't
    // prematurely flip status to npa on the last partial day before NPA.
    status = 'pending-renewal'; daysOverdue = -daysToDue; daysUntilNpa = npaCountdown;
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

export function timeAgo(ts) {
  if (!ts) return '';
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
