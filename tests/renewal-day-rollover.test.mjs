import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// utils.js reaches Firestore settings through state.js and the DOM through
// animate.js, neither of which computeRenewalStatus touches. Stub those two and
// load the real utils.js, bank-holidays.js and ist-date.js on top.
const STUBS = {
  "state.js": "export const S = { bankHolidays: [] };",
  "animate.js": "export const animateOverlayIn = () => {};\nexport const animateOverlayOut = (_, done) => done?.();",
};

const built = new Map();

async function moduleUrl(file) {
  if (built.has(file)) return built.get(file);
  let source = STUBS[file]
    ?? await readFile(new URL(`../js/${file}`, import.meta.url), "utf8");
  const deps = new Set(
    [...source.matchAll(/from\s+"\.\/([\w-]+\.js)"/g)].map(match => match[1]),
  );
  for (const dep of deps) {
    source = source.replaceAll(`"./${dep}"`, JSON.stringify(await moduleUrl(dep)));
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  built.set(file, url);
  return url;
}

const { computeRenewalStatus, todayStr } = await import(await moduleUrl("utils.js"));

const DUE = "2026-09-21";
const NPA = "2027-03-22"; // 182 days after the due date
const LOAN = { sanctionDate: "2025-09-21", renewalDueDate: DUE };

// An instant expressed as IST wall-clock time.
function ist(dateStr, hour = 0, minute = 0) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d, hour, minute) - 330 * 60000;
}

// Run a reader with the clock held at one instant.
function at(nowMs, read) {
  const realNow = Date.now;
  Date.now = () => nowMs;
  try {
    return read();
  } finally {
    Date.now = realNow;
  }
}

// Evaluate the loan as it would be seen at one instant.
const statusAt = (nowMs, loan = LOAN) => at(nowMs, () => computeRenewalStatus(loan));

// Every distinct result the loan shows over one IST day, sampled across each
// hour and around the half-hour where the old UTC boundary used to land.
function resultsAcrossDay(dateStr) {
  const seen = new Set();
  for (let hour = 0; hour < 24; hour++) {
    for (const minute of [0, 29, 30, 31, 59]) {
      seen.add(JSON.stringify(statusAt(ist(dateStr, hour, minute))));
    }
  }
  return [...seen];
}

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

test("an account reads the same all day and changes only at midnight IST", () => {
  // The regression this guards: the NPA countdown used local calendar dates
  // while the status used UTC timestamps, so the two moved 5h30m apart and an
  // account read differently at 05:00 and at 06:00 on the same day.
  // Before the fix each of these days read three different ways: the status
  // and the overdue count stepped at 05:30 IST (00:00 UTC) while the countdown
  // had already stepped at midnight.
  for (const day of ["2026-09-20", DUE, "2026-09-22", "2027-03-21", NPA]) {
    assert.deepEqual(resultsAcrossDay(day).length, 1, `${day} changed mid-day`);
  }

  const dueDay = statusAt(ist(DUE, 12));
  const dayAfter = statusAt(ist("2026-09-22", 12));
  assert.notDeepEqual(dueDay, dayAfter, "the account should move on at midnight");
});

test("an account is due for the whole due date and overdue from the next day", () => {
  const dayBefore = statusAt(ist("2026-09-20", 23, 59));
  assert.equal(dayBefore.status, "due-soon");
  assert.equal(dayBefore.daysUntilDue, 1);

  for (const hour of [0, 5, 6, 23]) {
    const onDueDate = statusAt(ist(DUE, hour));
    assert.equal(onDueDate.status, "due-soon", `${hour}:00 on the due date`);
    assert.equal(onDueDate.daysUntilDue, 0, `${hour}:00 on the due date`);
    assert.equal(onDueDate.daysOverdue, 0, `${hour}:00 on the due date`);
  }

  const dayAfter = statusAt(ist("2026-09-22", 0, 1));
  assert.equal(dayAfter.status, "pending-renewal");
  assert.equal(dayAfter.daysOverdue, 1);
});

test("an account turns NPA at the start of its NPA date", () => {
  assert.equal(statusAt(ist(DUE, 12)).npaDateStr, NPA);
  assert.equal(statusAt(ist(DUE, 12)).lastPendingDateStr, "2027-03-21", "day 181 on the calendar");

  // Day 181 past the due date is still pending renewal; NPA starts on day 182.
  const dayBefore = statusAt(ist("2027-03-21", 23, 59));
  assert.equal(dayBefore.status, "pending-renewal");
  assert.equal(dayBefore.daysOverdue, 181);

  for (const hour of [0, 5, 6, 23]) {
    assert.equal(statusAt(ist(NPA, hour)).status, "npa", `${hour}:00 on the NPA date`);
  }
});

test("the NPA countdown falls by a day at a time and never goes backwards", () => {
  // Sampled over the last fortnight before NPA, where holidays make the
  // working-day count flat on some days but never rising.
  let previous = Infinity;
  for (let offset = 14; offset >= 1; offset--) {
    const day = new Date(Date.UTC(2027, 2, 22) - offset * 86400000)
      .toISOString()
      .slice(0, 10);
    const { status, daysUntilNpa } = statusAt(ist(day, 9));
    assert.equal(status, "pending-renewal", day);
    assert.ok(daysUntilNpa <= previous, `${day}: countdown rose to ${daysUntilNpa}`);
    assert.ok(daysUntilNpa >= 0, `${day}: countdown went negative`);
    previous = daysUntilNpa;
  }
  assert.equal(statusAt(ist("2027-03-21", 9)).daysUntilNpa, 0, "day 181 is the last pending day");
  assert.equal(statusAt(ist("2027-03-19", 9)).daysUntilNpa, 1, "day 180 has one working day left");
});

test("the same instant reads the same on a device set to any timezone", () => {
  const instants = [ist(DUE, 2), ist(DUE, 12), ist(DUE, 23, 30), ist("2027-03-21", 21)];
  const expected = instants.map(now => statusAt(now));
  for (const zone of ["UTC", "America/Los_Angeles", "Pacific/Auckland", "Asia/Kolkata"]) {
    withTimeZone(zone, () => {
      assert.equal(at(instants[0], todayStr), DUE, `${zone}: today`);
      instants.forEach((now, i) => {
        assert.deepEqual(statusAt(now), expected[i], `${zone} at instant ${i}`);
      });
    });
  }
});
