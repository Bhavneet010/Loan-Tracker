import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../js/calendar-export-model.js", import.meta.url), "utf8");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const {
  buildMultiMonthExportFilename,
  buildRenewalMonthSections,
  normalizeMonthKeys,
} = await import(moduleUrl);

test("month keys are validated, deduplicated, and sorted chronologically", () => {
  assert.deepEqual(
    normalizeMonthKeys(["2027-01", "bad", "2026-12", "2027-01", "2026-02", null]),
    ["2026-02", "2026-12", "2027-01"],
  );
  assert.deepEqual(normalizeMonthKeys(null), []);
});

test("selected months become chronological sections including empty months", () => {
  const sections = buildRenewalMonthSections([
    { id: "later", _rs: { npaDateStr: "2026-10-20", status: "pending-renewal" } },
    { id: "normal", _rs: { npaDateStr: "2026-10-03", status: "pending-renewal" } },
    { id: "rnp", renewalNotPossible: true, _rs: { npaDateStr: "2026-10-01", status: "due-soon" } },
    { id: "npa", renewalNotPossible: true, _rs: { npaDateStr: "2026-12-01", status: "npa" } },
    { id: "outside", _rs: { npaDateStr: "2027-01-01", status: "active" } },
  ], ["2026-12", "2026-11", "2026-10"]);

  assert.deepEqual(sections.map(section => section.key), ["2026-10", "2026-11", "2026-12"]);
  assert.deepEqual(sections[0].loans.map(loan => loan.id), ["normal", "later"]);
  assert.deepEqual(sections[0].rnpLoans.map(loan => loan.id), ["rnp"]);
  assert.deepEqual(sections[1].loans, []);
  assert.deepEqual(sections[1].rnpLoans, []);
  assert.deepEqual(sections[2].loans.map(loan => loan.id), ["npa"]);
  assert.deepEqual(sections[2].rnpLoans, []);
});

test("short same-year selections list their months in the filename", () => {
  assert.equal(
    buildMultiMonthExportFilename(["2026-12", "2026-08", "2026-10"], "xlsx"),
    "nirnay-pending-renewals-aug-oct-dec-2026.xlsx",
  );
});

test("cross-year and long selections use range filenames", () => {
  assert.equal(
    buildMultiMonthExportFilename(["2027-02", "2026-08", "2026-10"], "pdf"),
    "nirnay-pending-renewals-aug-2026-to-feb-2027-3-months.pdf",
  );
  assert.equal(
    buildMultiMonthExportFilename(["2026-05", "2026-01", "2026-03", "2026-04", "2026-02"], "xlsx"),
    "nirnay-pending-renewals-jan-2026-to-may-2026-5-months.xlsx",
  );
});

test("filenames reject empty selections and unsupported formats", () => {
  assert.throws(() => buildMultiMonthExportFilename([], "xlsx"), TypeError);
  assert.throws(() => buildMultiMonthExportFilename(["2026-08"], "csv"), TypeError);
});
