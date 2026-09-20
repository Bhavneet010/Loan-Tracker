import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const helperSource = await readFile(
  new URL("../js/renewal-attribution.js", import.meta.url),
  "utf8",
);
const { renewalAccountOfficer } = await import(
  `data:text/javascript;base64,${Buffer.from(helperSource).toString("base64")}`
);

const MONTH = "2026-09";

test("an account without an override belongs to its branch officer", () => {
  const loan = { allocatedTo: "Nikita", branch: "686 : NAHAN" };
  assert.equal(renewalAccountOfficer(loan, "Anil Kumar", MONTH), "Anil Kumar");
});

test("an override for this month holds while that renewal is still pending", () => {
  const loan = {
    allocatedTo: "Nikita",
    manualOfficer: "Nikita",
    manualOfficerMonth: MONTH,
  };
  assert.equal(renewalAccountOfficer(loan, "Anil Kumar", MONTH), "Nikita");
});

test("the account returns to the branch officer once that renewal is done", () => {
  const loan = {
    allocatedTo: "Nikita",
    manualOfficer: "Nikita",
    manualOfficerMonth: MONTH,
    renewedDate: "2026-09-12",
  };
  assert.equal(renewalAccountOfficer(loan, "Anil Kumar", MONTH), "Anil Kumar");
});

test("a renewedDate from an earlier cycle leaves this month's override standing", () => {
  const loan = {
    allocatedTo: "Nikita",
    manualOfficer: "Nikita",
    manualOfficerMonth: MONTH,
    renewedDate: "2026-05-04",
  };
  assert.equal(renewalAccountOfficer(loan, "Anil Kumar", MONTH), "Nikita");
});

test("an override from an earlier month no longer holds the account", () => {
  const loan = {
    allocatedTo: "Nikita",
    manualOfficer: "Nikita",
    manualOfficerMonth: "2026-08",
  };
  assert.equal(renewalAccountOfficer(loan, "Anil Kumar", MONTH), "Anil Kumar");
});

test("an unallocated branch falls back to the officer on the account", () => {
  const loan = { allocatedTo: "Nikita", branch: "9999 : NEW BRANCH" };
  assert.equal(renewalAccountOfficer(loan, "", MONTH), "Nikita");
});

test("a spent override still names the officer when nothing else does", () => {
  const loan = {
    manualOfficer: "Nikita",
    manualOfficerMonth: MONTH,
    renewedDate: "2026-09-12",
  };
  assert.equal(renewalAccountOfficer(loan, "", MONTH), "Nikita");
});

test("an account with no officer at all reads as unassigned", () => {
  assert.equal(renewalAccountOfficer({}, "", MONTH), "Unassigned");
  assert.equal(renewalAccountOfficer(null, "", MONTH), "Unassigned");
});
