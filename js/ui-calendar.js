import { S } from "./state.js";
import { getLoanMetrics } from "./derived.js";
import { esc, fmtAmt, initials, officerColor, branchCode } from "./utils.js";
import { searchMatch } from "./ui-logic.js";
import { holidayReason, findCustomHoliday, countWorkingDaysLeft } from "./bank-holidays.js";

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['M','T','W','T','F','S','S'];

export function buildCalendarViewHtml(metrics = getLoanMetrics()) {
  if (!S.calendarState) {
    const now = new Date();
    S.calendarState = { year: now.getFullYear(), month: now.getMonth() };
  }
  const renewals = getFilteredRenewals(metrics);
  const { year, month } = S.calendarState;
  const calData = buildCalendarData(renewals, year, month);
  return calendarHtml(calData, year, month);
}

export function renderCalendar(c) {
  c.innerHTML = buildCalendarViewHtml();
}

function getFilteredRenewals(metrics) {
  let out = metrics.renewals.filter(l => !l.renewedDate);
  if (S.renewalFilter.status === 'DueSoon') out = out.filter(l => l._rs?.status === 'due-soon');
  if (!S.isAdmin) out = out.filter(l => l.allocatedTo === S.user);
  else if (S.renewalFilter.officer !== 'All' && S.renewalFilter.officer !== 'Mine') out = out.filter(l => l.allocatedTo === S.renewalFilter.officer);
  if (S.renewalFilter.branch !== 'All') {
    const filterCode = branchCode(S.renewalFilter.branch);
    out = out.filter(l => branchCode(l.branch) === filterCode);
  }
  if (!S.renewalShowNpa) out = out.filter(l => l._rs?.status !== 'npa');
  out = out.filter(searchMatch);
  return out;
}

function buildCalendarData(renewals, year, month) {
  const map = new Map();
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  renewals.forEach(loan => {
    const rs = loan._rs;
    if (!rs || !rs.npaDateStr) return;
    if (!rs.npaDateStr.startsWith(monthStr)) return;
    if (!map.has(rs.npaDateStr)) map.set(rs.npaDateStr, { loans: [], urgency: 'active' });
    const entry = map.get(rs.npaDateStr);
    entry.loans.push(loan);
    if (rs.status === 'npa') entry.urgency = 'overdue';
    else if ((rs.daysUntilNpa || 0) <= 30 && entry.urgency !== 'overdue') entry.urgency = 'due-soon';
  });
  return map;
}

function calendarHtml(calData, year, month) {
  const today = new Date().toISOString().slice(0, 10);
  const firstDay = new Date(year, month, 1).getDay();
  // Convert Sunday=0 to Monday=0 offset
  const offset = (firstDay + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalItems = [...calData.values()].reduce((s, e) => s + e.loans.length, 0);

  const dowHeaders = DAYS.map(d => `<div class="cal-dow">${d}</div>`).join('');
  const emptyCells = Array(offset).fill('<div class="cal-cell cal-cell--empty"></div>').join('');

  const cells = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const entry = calData.get(dateStr);
    const isToday = dateStr === today;
    const isPast = dateStr < today;
    const hReason = holidayReason(dateStr);
    const customHoliday = hReason === 'custom' ? findCustomHoliday(dateStr) : null;
    let cls = 'cal-cell';
    if (isToday) cls += ' cal-cell--today';
    if (entry) {
      cls += entry.urgency === 'overdue' ? ' cal-cell--overdue' : entry.urgency === 'due-soon' ? ' cal-cell--soon' : ' cal-cell--active-has';
    } else if (isPast) {
      cls += ' cal-cell--past';
    }
    if (hReason) cls += ' cal-cell--holiday';
    if (hReason === 'custom') cls += ' cal-cell--holiday-custom';
    const isOpen = S.calendarOpenDay === dateStr;
    if (isOpen) cls += ' cal-cell--open';
    const tappable = !!entry || S.isAdmin || !!hReason;
    const titleAttr = customHoliday?.label ? ` title="${esc(customHoliday.label)}"` : (hReason === 'sunday' ? ' title="Sunday"' : hReason === 'saturday' ? ' title="2nd/4th Saturday"' : '');
    cells.push(`<div class="${cls}" data-date="${dateStr}"${tappable ? ` onclick="toggleCalendarDay('${dateStr}')"` : ''}${titleAttr}>
      <span class="cal-day-num">${day}</span>
      ${entry ? `<span class="cal-count">${entry.loans.length}</span>` : (hReason ? `<span class="cal-holiday-mark">H</span>` : '')}
    </div>`);
  }

  const detailHtml = S.calendarOpenDay
    ? dayDetailHtml(S.calendarOpenDay, calData.get(S.calendarOpenDay))
    : '';

  const monthTotal = [...calData.values()].reduce((s, e) => s + e.loans.length, 0);
  const workingDays = countWorkingDaysLeft(year, month);

  return `
    <div class="cal-wrap">
      <div class="cal-nav">
        <button class="cal-nav-btn" onclick="calendarNavMonth(-1)">&lsaquo;</button>
        <span class="cal-month-label">${MONTHS[month]} ${year}</span>
        <div class="cal-nav-actions">
          <button class="cal-nav-btn" onclick="calendarNavMonth(1)">&rsaquo;</button>
        </div>
      </div>
      <div class="cal-month-meta">
        ${monthTotal > 0 ? `<span class="cal-month-count">${monthTotal} NPA date${monthTotal !== 1 ? 's' : ''}</span>` : '<span class="cal-month-count cal-month-count--empty">No NPA dates</span>'}
        <span class="cal-month-sep">·</span>
        <span class="cal-working-days">${workingDays} working day${workingDays !== 1 ? 's' : ''} left</span>
      </div>
      <div class="cal-legend">
        <span class="cal-dot cal-dot--overdue"></span>NPA
        <span class="cal-dot cal-dot--soon"></span>NPA within 30d
        <span class="cal-dot cal-dot--active"></span>Future NPA
        <span class="cal-dot cal-dot--holiday"></span>Holiday
      </div>
      <div class="cal-grid">
        ${dowHeaders}
        ${emptyCells}
        ${cells.join('')}
      </div>
      ${detailHtml}
    </div>`;
}

function dayDetailHtml(dateStr, entry) {
  const [, m, d] = dateStr.split('-');
  const label = `${parseInt(d)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m) - 1]}`;
  const hReason = holidayReason(dateStr);
  const customHoliday = hReason === 'custom' ? findCustomHoliday(dateStr) : null;
  const loanItems = entry ? entry.loans.map(loan => {
    const rs = loan._rs;
    const statusCls = rs.status === 'npa' ? 'rnw-chip-npa' : rs.status === 'pending-renewal' ? 'rnw-chip-pending' : rs.status === 'due-soon' ? 'rnw-chip-due-soon' : 'rnw-chip-active';
    const statusLabel = rs.status === 'npa' ? 'NPA' : `${rs.daysUntilNpa}d to NPA`;
    return `<div class="cal-detail-item">
      <span class="lr-av" style="background:${officerColor(loan.allocatedTo).bg};">${initials(loan.allocatedTo)}</span>
      <span class="cal-name">${esc(loan.customerName)}</span>
      <span class="cal-bcode">${esc(branchCode(loan.branch))}</span>
      <span class="cal-amt"><span class="rs">&#8377;</span>${fmtAmt(loan.amount)}L</span>
      <span class="tag ${statusCls}">${statusLabel}</span>
    </div>`;
  }).join('') : '';

  let holidayBlock = '';
  if (hReason === 'sunday' || hReason === 'saturday') {
    const txt = hReason === 'sunday' ? 'Sunday — Bank holiday' : '2nd / 4th Saturday — Bank holiday';
    holidayBlock = `<div class="cal-holiday-row cal-holiday-row--auto">${txt}</div>`;
  } else if (hReason === 'custom') {
    const lbl = customHoliday?.label ? esc(customHoliday.label) : 'Bank holiday';
    const removeBtn = S.isAdmin ? `<button class="cal-holiday-remove" onclick="removeBankHoliday('${dateStr}')">Remove</button>` : '';
    holidayBlock = `<div class="cal-holiday-row cal-holiday-row--custom"><span class="cal-holiday-label">${lbl}</span>${removeBtn}</div>`;
  } else if (S.isAdmin && !entry) {
    holidayBlock = `<div class="cal-holiday-row cal-holiday-row--add"><button class="cal-holiday-add" onclick="addBankHoliday('${dateStr}')">+ Mark as bank holiday</button></div>`;
  }

  let head;
  if (entry) {
    head = `NPA date ${label} · ${entry.loans.length} renewal${entry.loans.length !== 1 ? 's' : ''}`;
  } else if (hReason) {
    head = `${label} · Holiday`;
  } else {
    head = label;
  }

  if (!entry && !holidayBlock) return '';

  return `<div class="cal-day-detail">
    <div class="cal-detail-head">${head}</div>
    ${holidayBlock}
    ${loanItems}
  </div>`;
}
