import { S } from "./state.js";
import { addDays, dateParts, dateStrOf, daysInMonth, istDateParts, toDateStr } from "./ist-date.js";

// Sunday=0; 2nd Saturday = day 8-14; 4th Saturday = day 22-28
export function isWeekendHoliday(dateStr) {
  const parts = dateParts(dateStr);
  if (!parts) return false;
  if (parts.weekday === 0) return true;
  if (parts.weekday === 6) {
    if ((parts.day >= 8 && parts.day <= 14) || (parts.day >= 22 && parts.day <= 28)) return true;
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
  const parts = dateParts(dateStr);
  if (!parts) return null;
  if (parts.weekday === 0) return 'sunday';
  if (parts.weekday === 6) {
    if ((parts.day >= 8 && parts.day <= 14) || (parts.day >= 22 && parts.day <= 28)) return 'saturday';
  }
  if (findCustomHoliday(dateStr)) return 'custom';
  return null;
}

// Working days where startStr < date <= endStr.
// Excludes the start date itself, includes the end date if it's a working day.
export function countWorkingDaysBetween(startStr, endStr) {
  const start = toDateStr(startStr);
  const end = toDateStr(endStr);
  if (!start || !end || start >= end) return 0;
  let cur = addDays(start, 1);
  let n = 0;
  // `cur &&` stops the walk rather than looping forever if a date ever becomes
  // unreadable mid-range.
  while (cur && cur <= end) {
    if (!isBankHoliday(cur)) n++;
    cur = addDays(cur, 1);
  }
  return n;
}

// Working days remaining in (year, month) starting from today (inclusive).
// Past months return 0; future months return the full count. "Today" is the
// IST date, so the count drops at 00:00 IST like every other countdown.
export function countWorkingDaysLeft(year, month) {
  const today = istDateParts();
  // Past month
  if (year < today.year || (year === today.year && month < today.month)) return 0;
  const days = daysInMonth(year, month);
  const startDay = (year === today.year && month === today.month) ? today.day : 1;
  let n = 0;
  for (let day = startDay; day <= days; day++) {
    if (!isBankHoliday(dateStrOf(year, month, day))) n++;
  }
  return n;
}
