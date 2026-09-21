// Nirnay tracks one business day: the branch's day in India. Every "today",
// every day rollover and every calendar-day difference in the app is anchored
// here instead of to the device clock, so an NPA countdown, a renewal status
// and a month cutoff all turn over at the same instant — 00:00 IST — whatever
// timezone the phone or laptop showing them happens to be set to.
//
// India has observed no daylight saving since 1945, so a fixed UTC+05:30
// offset is exact and no timezone database is needed.
export const IST_OFFSET_MINUTES = 330;

// For Intl formatters rendering a timestamp — an instant, with a time of day —
// on the branch's clock. Calendar dates go through formatDateStr() instead.
export const IST_TIME_ZONE = 'Asia/Kolkata';

const MS_PER_MINUTE = 60000;
const MS_PER_DAY = 86400000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// The IST wall clock for an instant, carried in a Date whose UTC fields hold
// the IST values — so getUTC*() and toISOString() both read out IST.
function istClock(now) {
  return new Date(now + IST_OFFSET_MINUTES * MS_PER_MINUTE);
}

// Midnight UTC for a "YYYY-MM-DD" calendar date. A stored date is a calendar
// date, never an instant: "2026-09-21" means that day for every reader, so it
// is pinned to a fixed point that no local-time accessor can shift a day
// either way.
function utcMidnightOf(dateStr) {
  return Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10));
}

// Today's IST calendar date as "YYYY-MM-DD".
export function istDateStr(now = Date.now()) {
  return istClock(now).toISOString().slice(0, 10);
}

// The current IST month as "YYYY-MM".
export function istMonthStr(now = Date.now()) {
  return istDateStr(now).slice(0, 7);
}

// "YYYY-MM-DDTHH:MM" in IST, the value format <input type="datetime-local">
// expects.
export function istDateTimeStr(now = Date.now()) {
  return istClock(now).toISOString().slice(0, 16);
}

// Today in IST as { year, month (0-based), day }, for the Date-based calendar
// and month pickers.
export function istDateParts(now = Date.now()) {
  const clock = istClock(now);
  return { year: clock.getUTCFullYear(), month: clock.getUTCMonth(), day: clock.getUTCDate() };
}

// Milliseconds from now to the next 00:00 IST.
export function msUntilNextIstMidnight(now = Date.now()) {
  const sinceMidnight = (now + IST_OFFSET_MINUTES * MS_PER_MINUTE) % MS_PER_DAY;
  return MS_PER_DAY - ((sinceMidnight + MS_PER_DAY) % MS_PER_DAY);
}

// Normalize a stored value to "YYYY-MM-DD". Date-only values are already a
// calendar date and pass through untouched; a full timestamp is an instant, so
// it resolves to the IST day it fell on. Returns "" for anything unreadable.
export function toDateStr(value) {
  if (!value) return '';
  const s = String(value);
  if (DATE_ONLY.test(s)) return s;
  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? '' : istDateStr(parsed.getTime());
}

// A calendar date shifted by whole days, e.g. addDays('2026-09-21', 181).
export function addDays(dateStr, days) {
  const base = toDateStr(dateStr);
  if (!base) return '';
  return new Date(utcMidnightOf(base) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

// Calendar days from one date to another; negative when `toStr` is the earlier
// of the two. Whole days by construction, so no rounding rule decides whether
// a countdown has ticked over.
export function dayDiff(fromStr, toStr) {
  const from = toDateStr(fromStr);
  const to = toDateStr(toStr);
  if (!from || !to) return 0;
  return Math.round((utcMidnightOf(to) - utcMidnightOf(from)) / MS_PER_DAY);
}

// A calendar date's fields, read without touching the device timezone.
// weekday is 0 for Sunday, matching Date.prototype.getDay().
export function dateParts(dateStr) {
  const date = toDateStr(dateStr);
  if (!date) return null;
  const d = new Date(utcMidnightOf(date));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
  };
}

// Days in a month, as { year, month (0-based) }.
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

// "YYYY-MM-DD" from calendar fields, with month 0-based to match Date.
export function dateStrOf(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Render a "YYYY-MM-DD" calendar date through Intl without a timezone shifting
// it onto the day before or after.
export function formatDateStr(dateStr, options, locale = 'en-IN') {
  const parts = dateParts(dateStr);
  if (!parts) return '';
  return new Date(Date.UTC(parts.year, parts.month, parts.day))
    .toLocaleDateString(locale, { ...options, timeZone: 'UTC' });
}
