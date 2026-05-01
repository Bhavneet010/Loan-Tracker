import { S } from "./state.js";
import { getLoanMetrics } from "./derived.js";
import { esc, fmtAmt, initials, officerColor, branchCode } from "./utils.js";

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['M','T','W','T','F','S','S'];

export function renderCalendar(c) {
  if (!S.calendarState) {
    const now = new Date();
    S.calendarState = { year: now.getFullYear(), month: now.getMonth() };
  }
  const metrics = getLoanMetrics();
  const renewals = getFilteredRenewals(metrics);
  const { year, month } = S.calendarState;
  const calData = buildCalendarData(renewals, year, month);
  c.innerHTML = calendarHtml(calData, year, month);
}

function getFilteredRenewals(metrics) {
  let out = metrics.renewals.filter(l => !l.renewedDate);
  return S.isAdmin ? out : out.filter(l => l.allocatedTo === S.user);
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
    let cls = 'cal-cell';
    if (isToday) cls += ' cal-cell--today';
    if (entry) {
      cls += entry.urgency === 'overdue' ? ' cal-cell--overdue' : entry.urgency === 'due-soon' ? ' cal-cell--soon' : ' cal-cell--active-has';
    } else if (isPast) {
      cls += ' cal-cell--past';
    }
    const isOpen = S.calendarOpenDay === dateStr;
    if (isOpen) cls += ' cal-cell--open';
    cells.push(`<div class="${cls}"${entry ? ` onclick="toggleCalendarDay('${dateStr}')"` : ''}>
      <span class="cal-day-num">${day}</span>
      ${entry ? `<span class="cal-count">${entry.loans.length}</span>` : ''}
    </div>`);
  }

  const detailHtml = S.calendarOpenDay && calData.has(S.calendarOpenDay)
    ? dayDetailHtml(S.calendarOpenDay, calData.get(S.calendarOpenDay))
    : '';

  const monthTotal = [...calData.values()].reduce((s, e) => s + e.loans.length, 0);

  return `
    <div class="cal-wrap">
      <div class="cal-nav">
        <button class="cal-nav-btn" onclick="calendarNavMonth(-1)">‹</button>
        <span class="cal-month-label">${MONTHS[month]} ${year}</span>
        <div class="cal-nav-actions">
          <button class="cal-nav-btn" onclick="calendarNavMonth(1)">›</button>
          <button class="cal-list-btn" onclick="setRenewalView('list')">List</button>
        </div>
      </div>
      ${monthTotal > 0 ? `<div class="cal-month-count">${monthTotal} NPA date${monthTotal !== 1 ? 's' : ''} this month</div>` : '<div class="cal-month-count cal-month-count--empty">No NPA dates this month</div>'}
      <div class="cal-legend">
        <span class="cal-dot cal-dot--overdue"></span>NPA
        <span class="cal-dot cal-dot--soon"></span>NPA within 30d
        <span class="cal-dot cal-dot--active"></span>Future NPA
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
  const items = entry.loans.map(loan => {
    const rs = loan._rs;
    const statusCls = rs.status === 'npa' ? 'rnw-chip-npa' : rs.status === 'pending-renewal' ? 'rnw-chip-pending' : rs.status === 'due-soon' ? 'rnw-chip-due-soon' : 'rnw-chip-active';
    const statusLabel = rs.status === 'npa' ? 'NPA' : `${rs.daysUntilNpa}d to NPA`;
    return `<div class="cal-detail-item">
      <span class="lr-av" style="background:${officerColor(loan.allocatedTo).bg};">${initials(loan.allocatedTo)}</span>
      <span class="cal-name">${esc(loan.customerName)}</span>
      <span class="cal-bcode">${esc(branchCode(loan.branch))}</span>
      <span class="cal-amt">₹${fmtAmt(loan.amount)}L</span>
      <span class="tag ${statusCls}">${statusLabel}</span>
    </div>`;
  }).join('');
  return `<div class="cal-day-detail">
    <div class="cal-detail-head">NPA date ${label} · ${entry.loans.length} renewal${entry.loans.length !== 1 ? 's' : ''}</div>
    ${items}
  </div>`;
}
