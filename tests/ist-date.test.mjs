import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const moduleSource = await readFile(
  new URL("../js/ist-date.js", import.meta.url),
  "utf8",
);
const {
  addDays,
  dateParts,
  dateStrOf,
  dayDiff,
  daysInMonth,
  formatDateStr,
  istDateParts,
  istDateStr,
  istDateTimeStr,
  istMonthStr,
  msUntilNextIstMidnight,
  toDateStr,
} = await import(
  `data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`
);

// An instant expressed as IST wall-clock time.
function ist(dateStr, hour = 0, minute = 0) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d, hour, minute) - 330 * 60000;
}

// Run a body with the process pretending to sit in another timezone.
function withTimeZone(zone, body) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    return body();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

const AWAY_ZONES = ["UTC", "America/Los_Angeles", "Pacific/Auckland"];

test("the date turns over at midnight IST, not at midnight UTC", () => {
  assert.equal(istDateStr(ist("2026-09-20", 23, 59)), "2026-09-20");
  assert.equal(istDateStr(ist("2026-09-21", 0, 0)), "2026-09-21");
  // 05:30 IST is 00:00 UTC — the moment the old timestamp arithmetic used to
  // flip a renewal's status, hours after its countdown had already moved.
  assert.equal(istDateStr(ist("2026-09-21", 5, 29)), "2026-09-21");
  assert.equal(istDateStr(ist("2026-09-21", 5, 31)), "2026-09-21");
  assert.equal(istDateStr(ist("2026-09-21", 23, 59)), "2026-09-21");
});

test("today does not move with the device timezone", () => {
  // 02:00 IST on the 21st: still the 20th in UTC and in Los Angeles, already
  // well into the 21st in Auckland.
  const earlyMorning = ist("2026-09-21", 2, 0);
  for (const zone of AWAY_ZONES) {
    withTimeZone(zone, () => {
      assert.equal(istDateStr(earlyMorning), "2026-09-21", zone);
      assert.equal(istMonthStr(earlyMorning), "2026-09", zone);
      assert.deepEqual(istDateParts(earlyMorning), { year: 2026, month: 8, day: 21 }, zone);
    });
  }
});

test("a datetime-local value reads the IST clock", () => {
  assert.equal(istDateTimeStr(ist("2026-09-21", 14, 45)), "2026-09-21T14:45");
});

test("the countdown to the next IST midnight matches the IST clock", () => {
  assert.equal(msUntilNextIstMidnight(ist("2026-09-21", 23, 0)), 60 * 60 * 1000);
  assert.equal(msUntilNextIstMidnight(ist("2026-09-21", 0, 0)), 24 * 60 * 60 * 1000);
  const oneMinuteBefore = ist("2026-09-22", 0, 0) - 60000;
  assert.equal(msUntilNextIstMidnight(oneMinuteBefore), 60000);
});

test("calendar dates shift by whole days across month and year ends", () => {
  assert.equal(addDays("2026-09-21", 181), "2027-03-21");
  assert.equal(addDays("2026-09-21", -365), "2025-09-21");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29", "2028 is a leap year");
  assert.equal(addDays("2027-02-28", 1), "2027-03-01");
  assert.equal(addDays("", 1), "");
});

test("day differences are whole days in both directions", () => {
  assert.equal(dayDiff("2026-09-21", "2026-09-21"), 0);
  assert.equal(dayDiff("2026-09-21", "2026-09-22"), 1);
  assert.equal(dayDiff("2026-09-22", "2026-09-21"), -1);
  assert.equal(dayDiff("2026-09-21", "2027-03-21"), 181);
});

test("date arithmetic ignores the device timezone", () => {
  for (const zone of AWAY_ZONES) {
    withTimeZone(zone, () => {
      assert.equal(addDays("2026-09-21", 181), "2027-03-21", zone);
      assert.equal(dayDiff("2026-09-21", "2027-03-21"), 181, zone);
      assert.equal(dateParts("2026-09-21").weekday, 1, `${zone}: 21 Sep 2026 is a Monday`);
      // The day number is the point: a timezone-shifted format would read 20 or 22.
      assert.equal(formatDateStr("2026-09-21", { day: "numeric" }), "21", zone);
    });
  }
});

test("a calendar date's fields are read off the date itself", () => {
  assert.deepEqual(dateParts("2026-09-21"), { year: 2026, month: 8, day: 21, weekday: 1 });
  assert.equal(dateParts("2026-09-20").weekday, 0, "20 Sep 2026 is a Sunday");
  assert.equal(dateParts(""), null);
  assert.equal(dateStrOf(2026, 8, 1), "2026-09-01");
  assert.equal(daysInMonth(2026, 1), 28);
  assert.equal(daysInMonth(2028, 1), 29);
});

test("stored values normalize to a calendar date", () => {
  assert.equal(toDateStr("2026-09-21"), "2026-09-21");
  // A timestamp is an instant, so it resolves to the IST day it fell on: this
  // one is still 20 Sep in UTC.
  assert.equal(toDateStr("2026-09-20T20:30:00.000Z"), "2026-09-21");
  assert.equal(toDateStr(""), "");
  assert.equal(toDateStr("not a date"), "");
});
