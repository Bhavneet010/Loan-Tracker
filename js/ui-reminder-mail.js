import { S } from "./state.js";
import { updateLoan } from "./db.js";
import { createNotification } from "./notifications.js";
import { esc, toast } from "./utils.js";
import { animateOverlayIn, animateOverlayOut } from "./animate.js";

/* Reminder mail tracking for pending / returned loans.
   Each loan carries `reminderMails`: [{ id, sentTo, sentAt, remarks, by, loggedAt }].
   Logging lives in its own bottom sheet so the loan edit card stays lean. */

const MAIL_TARGETS = ['Branch', 'Customer', 'Both'];

export function reminderMails(loan) {
  const list = Array.isArray(loan?.reminderMails) ? loan.reminderMails.filter(Boolean) : [];
  return [...list].sort((a, b) => (b.sentAt || '').localeCompare(a.sentAt || ''));
}

export function lastReminderMail(loan) {
  return reminderMails(loan)[0] || null;
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const [datePart, timePart = ''] = String(iso).split('T');
  const p = datePart.split('-');
  if (p.length !== 3) return iso;
  const date = `${p[2]}.${p[1]}.${p[0]}`;
  const [h = NaN, m = NaN] = timePart.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return date;
  const ampm = h >= 12 ? 'pm' : 'am';
  const hr = h % 12 || 12;
  return `${date}, ${hr}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function reminderSummary(loan) {
  const mails = reminderMails(loan);
  if (!mails.length) return '';
  const last = mails[0];
  const extra = mails.length > 1 ? ` · ${mails.length} sent` : '';
  return `${last.sentTo || 'Branch'} · ${fmtDateTime(last.sentAt)}${extra}`;
}

export function canTrackReminders(loan) {
  const status = loan?.status || 'pending';
  return status === 'pending' || status === 'returned';
}

function nowLocalDatetime() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function notifyReminderChange(id) {
  document.dispatchEvent(new CustomEvent('remindermailschange', { detail: { id } }));
  import("./ui-render.js").then(m => m.scheduleRender()).catch(() => {});
}

function entryRowHtml(loanId, entry) {
  const canDelete = S.isAdmin || entry.by === S.user;
  return `<div class="reminder-mail-row">
    <span class="decision-activity-icon reminder-mail-icon">&#9993;</span>
    <span class="reminder-mail-main">
      <b>To ${esc(entry.sentTo || 'Branch')}</b>
      <small>${esc(fmtDateTime(entry.sentAt))} · by ${esc(entry.by || '?')}</small>
      ${entry.remarks ? `<span class="reminder-mail-remarks">${esc(entry.remarks)}</span>` : ''}
    </span>
    ${canDelete ? `<button type="button" class="reminder-mail-del" title="Delete entry" onclick="deleteReminderMail('${esc(loanId)}','${esc(entry.id)}')">&#128465;</button>` : ''}
  </div>`;
}

function sheetBodyHtml(loan) {
  const mails = reminderMails(loan);
  const rows = mails.length
    ? mails.map(e => entryRowHtml(loan.id, e)).join('')
    : `<div class="decision-activity-empty">No reminder mail logged yet.</div>`;
  return `<div class="reminder-mail-form">
    <div class="reminder-mail-field">
      <small>Mail sent to</small>
      <div class="reminder-target-chips">
        ${MAIL_TARGETS.map((t, i) => `<button type="button" class="reminder-target-chip${i === 0 ? ' active' : ''}" data-mail-target="${t}">${t}</button>`).join('')}
      </div>
    </div>
    <div class="reminder-mail-field">
      <small>Sent on</small>
      <input type="datetime-local" data-reminder-sent-at value="${nowLocalDatetime()}" max="${nowLocalDatetime()}">
    </div>
    <div class="reminder-mail-field">
      <small>Mail remarks</small>
      <textarea data-reminder-remarks rows="2" placeholder="e.g. Asked branch to expedite pending documents"></textarea>
    </div>
    <button type="button" class="btn btn-primary-full" data-reminder-log>&#9993; Log Reminder Mail</button>
  </div>
  <div class="reminder-mail-history">
    <div class="reminder-mail-history-head">Mail history${mails.length ? ` · ${mails.length}` : ''}</div>
    <div class="reminder-mail-list">${rows}</div>
  </div>`;
}

function bindSheetBody(body, loan) {
  body.querySelectorAll('[data-mail-target]').forEach(chip => {
    chip.addEventListener('click', () => {
      body.querySelectorAll('[data-mail-target]').forEach(c => c.classList.toggle('active', c === chip));
    });
  });
  body.querySelector('[data-reminder-log]')?.addEventListener('click', async () => {
    const sentTo = body.querySelector('[data-mail-target].active')?.dataset.mailTarget || 'Branch';
    const sentAt = body.querySelector('[data-reminder-sent-at]')?.value || '';
    const remarks = (body.querySelector('[data-reminder-remarks]')?.value || '').trim();
    if (!sentAt) { toast('Pick the mail date & time'); return; }
    const entry = {
      id: 'rm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      sentTo,
      sentAt,
      remarks,
      by: S.user || '?',
      loggedAt: new Date().toISOString(),
    };
    const current = S.loans.find(x => x.id === loan.id) || loan;
    const next = [...(Array.isArray(current.reminderMails) ? current.reminderMails.filter(Boolean) : []), entry];
    try {
      await updateLoan(loan.id, { reminderMails: next });
      Object.assign(current, { reminderMails: next });
      if (current !== loan) loan.reminderMails = next;
      createNotification('reminder', current).catch(() => {});
      toast('Reminder mail logged ✓');
      renderSheetBody(loan);
      notifyReminderChange(loan.id);
    } catch (e) {
      toast('Error saving');
      console.error(e);
    }
  });
}

function renderSheetBody(loan) {
  const body = document.querySelector('.reminder-mail-overlay [data-reminder-body]');
  if (!body) return;
  body.innerHTML = sheetBodyHtml(loan);
  bindSheetBody(body, loan);
}

window.closeReminderMailSheet = function() {
  document.querySelectorAll('.reminder-mail-overlay').forEach(el => animateOverlayOut(el));
};

window.openReminderMailSheet = function(id) {
  const loan = S.loans.find(x => x.id === id);
  if (!loan) return;
  window.closeReminderMailSheet();
  const overlay = document.createElement('div');
  overlay.className = 'overlay reminder-mail-overlay';
  overlay.addEventListener('click', e => {
    if (e.target?.classList?.contains('reminder-mail-overlay')) window.closeReminderMailSheet();
  });
  overlay.innerHTML = `<div class="sheet decision-sheet reminder-mail-sheet" role="dialog" aria-modal="true" aria-label="Reminder mail">
    <div class="sheet-handle"></div>
    <div class="decision-title-row">
      <h2>Reminder Mail</h2>
      <button type="button" class="decision-mini-btn" onclick="closeReminderMailSheet()">Close</button>
    </div>
    <p class="decision-copy">${esc(loan.customerName || 'Loan account')} · ${esc(loan.branch || '')}</p>
    <div data-reminder-body></div>
  </div>`;
  document.body.appendChild(overlay); animateOverlayIn(overlay);
  renderSheetBody(loan);
};

window.deleteReminderMail = async function(loanId, entryId) {
  const loan = S.loans.find(x => x.id === loanId);
  if (!loan) return;
  const entry = (loan.reminderMails || []).find(e => e && e.id === entryId);
  if (!entry) return;
  if (!(S.isAdmin || entry.by === S.user)) { toast('Only ' + (entry.by || 'the logger') + ' or admin can delete this'); return; }
  if (!confirm('Delete this reminder mail entry?')) return;
  const next = (loan.reminderMails || []).filter(e => e && e.id !== entryId);
  try {
    await updateLoan(loanId, { reminderMails: next });
    loan.reminderMails = next;
    toast('Entry deleted');
    renderSheetBody(loan);
    notifyReminderChange(loanId);
  } catch (e) {
    toast('Error');
    console.error(e);
  }
};
