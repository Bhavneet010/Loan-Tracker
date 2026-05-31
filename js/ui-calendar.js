import { S } from "./state.js";
import { getLoanMetrics, effectiveOfficer } from "./derived.js";
import { esc, fmtAmt, initials, officerColor, branchCode } from "./utils.js";
import { searchMatch } from "./ui-logic.js";
import { holidayReason, findCustomHoliday, countWorkingDaysLeft } from "./bank-holidays.js";

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['M','T','W','T','F','S','S'];

export function buildCalendarViewHtml(metrics = getLoanMetrics()) {
  const renewals = getFilteredRenewals(metrics);
  if (!S.calendarState) {
    const now = new Date();
    S.calendarState = findFirstRenewalMonth(renewals) || { year: now.getFullYear(), month: now.getMonth() };
  }
  const { year, month } = S.calendarState;
  const calData = buildCalendarData(renewals, year, month);
  return calendarHtml(calData, year, month, renewals);
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

function findFirstRenewalMonth(renewals) {
  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const months = new Set();
  renewals.forEach(loan => {
    const rs = loan._rs;
    if (rs?.npaDateStr && rs.status !== 'active') months.add(rs.npaDateStr.slice(0, 7));
  });
  if (!months.size) return null;
  const sorted = Array.from(months).sort();
  const fromNow = sorted.filter(m => m >= currentKey);
  if (!fromNow.length) return null;
  const [y, m] = fromNow[0].split('-').map(Number);
  return { year: y, month: m - 1 };
}

function buildMonthBarHtml(renewals, currentYear, currentMonth) {
  const monthMap = new Map();
  renewals.forEach(loan => {
    const rs = loan._rs;
    if (!rs?.npaDateStr || rs.status === 'active') return;
    const key = rs.npaDateStr.slice(0, 7);
    monthMap.set(key, (monthMap.get(key) || 0) + 1);
  });
  if (!monthMap.size) return '';

  if (S.isAdmin && S.calendarBarExpanded) {
    const currentKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
    return `<div class="cal-mbar-wrap">${buildOfficerPillsHtml(renewals, currentKey)}</div>`;
  }

  const currentKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
  const sorted = Array.from(monthMap.entries()).sort(([a], [b]) => a.localeCompare(b));

  let displayed = sorted;
  if (sorted.length > 7) {
    const idx = sorted.findIndex(([k]) => k === currentKey);
    const center = idx >= 0 ? idx : Math.max(0, sorted.findIndex(([k]) => k >= currentKey));
    const start = Math.max(0, Math.min(center - 3, sorted.length - 7));
    displayed = sorted.slice(start, start + 7);
  }

  const activeIdx = displayed.findIndex(([k]) => k === currentKey);

  const items = displayed.map(([key, count]) => {
    const [y, m] = key.split('-').map(Number);
    const isActive = key === currentKey;
    return `<button class="cal-mbar-item${isActive ? ' cal-mbar-item--active' : ''}" data-key="${key}" onclick="calendarNavToMonth(${y},${m - 1})">${MONTHS[m - 1].slice(0, 3)} <span class="cal-mbar-ct">${count}</span></button>`;
  }).join('');

  const noActiveCls = activeIdx < 0 ? ' cal-mbar--no-active' : '';
  const pill = `<div class="cal-mbar${noActiveCls}" id="cal-mbar" style="--active-idx:${Math.max(0, activeIdx)};--item-count:${displayed.length}"><div class="cal-mbar-thumb"></div>${items}</div>`;
  return `<div class="cal-mbar-wrap">${pill}</div>`;
}

function buildOfficerPillsHtml(renewals, currentKey) {
  const officerMap = new Map();
  renewals.forEach(loan => {
    const rs = loan._rs;
    if (!rs?.npaDateStr || rs.status === 'active') return;
    const officer = effectiveOfficer(loan);
    const key = rs.npaDateStr.slice(0, 7);
    if (!officerMap.has(officer)) officerMap.set(officer, new Map());
    officerMap.get(officer).set(key, (officerMap.get(officer).get(key) || 0) + 1);
  });
  if (!officerMap.size) return '<div class="cal-mbar-officers"></div>';

  const rows = Array.from(officerMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([officer, mMap]) => {
      const sorted = Array.from(mMap.entries()).sort(([a], [b]) => a.localeCompare(b));
      const activeIdx = sorted.findIndex(([k]) => k === currentKey);
      const items = sorted.map(([key, count]) => {
        const [y, m] = key.split('-').map(Number);
        const isActive = key === currentKey;
        return `<button class="cal-mbar-item${isActive ? ' cal-mbar-item--active' : ''}" data-key="${key}" onclick="calendarNavToMonth(${y},${m - 1})">${MONTHS[m - 1].slice(0, 3)} <span class="cal-mbar-ct">${count}</span></button>`;
      }).join('');
      const noActiveCls = activeIdx < 0 ? ' cal-mbar--no-active' : '';
      const col = officerColor(officer);
      return `<div class="cal-mbar-officer-row">
        <span class="cal-mbar-av" style="background:${col.bg};color:${col.text};">${initials(officer)}</span>
        <div class="cal-mbar cal-mbar--officer${noActiveCls}" style="--active-idx:${Math.max(0, activeIdx)};--item-count:${sorted.length}"><div class="cal-mbar-thumb"></div>${items}</div>
      </div>`;
    }).join('');

  return `<div class="cal-mbar-officers">${rows}</div>`;
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

function calendarHtml(calData, year, month, renewals) {
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

  const monthBar = buildMonthBarHtml(renewals, year, month);

  return `
    <div class="cal-wrap">
      ${monthBar}
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
