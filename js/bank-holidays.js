import { S } from "./state.js";

// dateStr is "YYYY-MM-DD"
function parseDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Sunday=0; 2nd Saturday = day 8-14; 4th Saturday = day 22-28
export function isWeekendHoliday(dateStr) {
  const d = parseDate(dateStr);
  const dow = d.getDay();
  if (dow === 0) return true;
  if (dow === 6) {
    const day = d.getDate();
    if ((day >= 8 && day <= 14) || (day >= 22 && day <= 28)) return true;
  }
  return false;
}

export function findCustomHoliday(dateStr) {
  return (S.bankHolidays || []).find(h => h.date === dateStr) || null;
}

export function isBankHoliday(dateStr) {
  return isWeekendHoliday(dateStr) || !!findCustomHoliday(dateStr);
}

// Reason: 'sunday' | 'saturday' | 'custom' | null
export function holidayReason(dateStr) {
  const d = parseDate(dateStr);
  const dow = d.getDay();
  if (dow === 0) return 'sunday';
  if (dow === 6) {
    const day = d.getDate();
    if ((day >= 8 && day <= 14) || (day >= 22 && day <= 28)) return 'saturday';
  }
  if (findCustomHoliday(dateStr)) return 'custom';
  return null;
}

export function countWorkingDaysInMonth(year, month) {
  const days = new Date(year, month + 1, 0).getDate();
  let n = 0;
  for (let day = 1; day <= days; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!isBankHoliday(dateStr)) n++;
  }
  return n;
}

// Working days where startStr < date <= endStr.
// Excludes the start date itself, includes the end date if it's a working day.
export function countWorkingDaysBetween(startStr, endStr) {
  if (!startStr || !endStr || startStr >= endStr) return 0;
  const cur = parseDate(startStr);
  const end = parseDate(endStr);
  cur.setDate(cur.getDate() + 1);
  let n = 0;
  while (cur <= end) {
    const dateStr = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
    if (!isBankHoliday(dateStr)) n++;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

// Working days remaining in (year, month) starting from today (inclusive).
// Past months return 0; future months return the full count.
export function countWorkingDaysLeft(year, month) {
  const now = new Date();
  const todayY = now.getFullYear();
  const todayM = now.getMonth();
  const todayD = now.getDate();
  // Past month
  if (year < todayY || (year === todayY && month < todayM)) return 0;
  const days = new Date(year, month + 1, 0).getDate();
  const startDay = (year === todayY && month === todayM) ? todayD : 1;
  let n = 0;
  for (let day = startDay; day <= days; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!isBankHoliday(dateStr)) n++;
  }
  return n;
}
