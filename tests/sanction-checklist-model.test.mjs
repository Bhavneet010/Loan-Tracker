import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_ITEMS, SECTIONS, amountWarning, ayLabel, bsStage, currentFy, fyLabel, fyStartYear,
  isProfileComplete, itemStatus, newChecklist, nextYear, summarize, visibleSections, yearOptions,
  yearProgress, yearRows,
} from "../js/sanction-checklist-model.js";

const profile = (overrides = {}) => ({
  ...newChecklist({ today: "2026-11-17" }),
  borrowerName: "Test",
  constitution: "proprietorship",
  facility: "CC",
  collateral: true,
  rented: false,
  ...overrides,
});
const byKey = Object.fromEntries(ALL_ITEMS.map(item => [item.key, item]));
const sectionIds = checklist => visibleSections(checklist).map(section => section.id);
const visibleKeys = checklist => visibleSections(checklist).flatMap(section => section.items.map(item => item.key));
const visibleNos = checklist => visibleSections(checklist).flatMap(section => section.items.map(item => item.no));
const withRows = (key, rows) => profile({ items: { [key]: { rows } } });

test("the template has unique keys and the expected sections", () => {
  assert.equal(new Set(ALL_ITEMS.map(item => item.key)).size, ALL_ITEMS.length);
  assert.deepEqual(SECTIONS.map(section => section.id), ["A", "B", "C", "D", "E", "F", "G"]);
  assert.equal(SECTIONS.find(section => section.id === "B").doneLabel, "Attached");
  assert.equal("applicationDate" in newChecklist(), false);
  assert.equal("cgtmse" in newChecklist(), false);
});

test("nothing shows until constitution, facility, collateral and premises are answered", () => {
  for (const missing of [{ constitution: "" }, { facility: "" }, { collateral: null }, { rented: null }]) {
    assert.deepEqual(visibleSections(profile(missing)), [], JSON.stringify(missing));
  }
  assert.equal(isProfileComplete(profile()), true);
});

test("rented premises decides the address proofs", () => {
  const address = checklist => visibleSections(checklist)[0].items.filter(item => item.group === "address");
  const owned = address(profile({ rented: false }));
  assert.deepEqual(owned.map(item => item.key), ["ownershipDoc", "utilityBill"]);
  const rented = address(profile({ rented: true }));
  assert.deepEqual(rented.map(item => item.key), ["rentAgreement", "landlordKyc", "utilityBill"]);
  // Proprietorship: 7 single items first, so the address group is 8.
  assert.deepEqual(owned.map(item => item.no), ["8a", "8b"]);
  assert.deepEqual(rented.map(item => item.no), ["8a", "8b", "8c"]);
});

test("no collateral (CGTMSE) hides CERSAI, legal search and the whole collateral section", () => {
  const without = visibleKeys(profile({ collateral: false }));
  for (const key of ["cersaiSearch", "legalSearch", "titleSearch", "valuation", "cgtmse"]) {
    assert.equal(without.includes(key), false, key);
  }
  const withCollateral = visibleKeys(profile({ collateral: true }));
  for (const key of ["cersaiSearch", "legalSearch", "titleSearch", "valuation", "cgtmse"]) {
    assert.equal(withCollateral.includes(key), true, key);
  }
});

test("facility decides the TL and CC sections; collateral decides section F", () => {
  assert.deepEqual(sectionIds(profile({ facility: "CC" })), ["A", "B", "C", "E", "F", "G"]);
  assert.deepEqual(sectionIds(profile({ facility: "TL" })), ["A", "B", "C", "D", "F", "G"]);
  assert.deepEqual(sectionIds(profile({ facility: "CCTL" })), ["A", "B", "C", "D", "E", "F", "G"]);
  assert.deepEqual(sectionIds(profile({ collateral: false })), ["A", "B", "C", "E", "G"]);
});

test("constitution decides entity PAN, firm/company and MCA21 items", () => {
  const proprietor = visibleKeys(profile({ constitution: "proprietorship" }));
  assert.equal(["panEntity", "constitutionDocs", "boardResolution", "mca21"].some(key => proprietor.includes(key)), false);
  const firm = visibleKeys(profile({ constitution: "partnership" }));
  assert.equal(["panEntity", "constitutionDocs", "boardResolution"].every(key => firm.includes(key)), true);
  assert.equal(firm.includes("mca21"), false);
  for (const constitution of ["company", "llp"]) {
    assert.equal(visibleKeys(profile({ constitution })).includes("mca21"), true, constitution);
  }
});

test("visible items are numbered one after another with no gaps", () => {
  const nos = visibleNos(profile({ constitution: "company", facility: "CCTL", collateral: true, rented: true }));
  assert.deepEqual(nos.slice(9, 14), ["10", "11a", "11b", "11c", "12"]);
  const plain = nos.filter(no => /^\d+$/.test(no)).map(Number);
  assert.deepEqual(plain, plain.map((_, i) => (i < 10 ? i + 1 : i + 2)));
});

test("ITR and balance sheet are separate questions with default years", () => {
  const c = profile();
  assert.equal(currentFy(c), 2026);
  assert.deepEqual(yearRows(c, byKey.itrYears).map(row => row.year), [2023, 2024, 2025]);
  assert.deepEqual(yearRows(c, byKey.balanceSheetYears).map(row => row.year), [2023, 2024, 2025, 2026, 2027]);
  assert.deepEqual([2025, 2026, 2027].map(year => bsStage(c, year)), ["Audited", "Provisional", "Projected"]);
  assert.equal(fyLabel(2023), "FY 23-24");
  assert.equal(ayLabel(2023), "AY 24-25");
  assert.equal(fyLabel(2099), "FY 99-00");
});

test("the reference date sets the financial year across the April rollover", () => {
  assert.equal(fyStartYear("2027-03-31"), 2026);
  assert.equal(fyStartYear("2027-04-01"), 2027);
  assert.equal(currentFy({ createdAt: "2027-05-02T10:00:00.000Z" }), 2027);
  assert.deepEqual(yearRows(newChecklist({ today: "2027-04-01" }), byKey.itrYears).map(row => row.year), [2024, 2025, 2026]);
});

test("years can be changed, added and deleted without duplicates", () => {
  const c = withRows("itrYears", [{ year: 2024, status: "received" }, { year: 2025, status: "pending" }]);
  // ITR years stop at the last completed FY; other rows' years are excluded.
  const options = yearOptions(c, byKey.itrYears, 2025);
  assert.equal(options[0], 2025);
  assert.equal(options.includes(2024), false);
  assert.equal(options.includes(2026), false);
  assert.equal(nextYear(c, byKey.itrYears), 2023);
  assert.equal(nextYear(profile(), byKey.balanceSheetYears), 2022);
  // Stored rows are sorted and bad entries dropped.
  const messy = withRows("itrYears", [{ year: 2025, status: "x" }, { year: "bad" }, { year: 2022, status: "na" }]);
  assert.deepEqual(yearRows(messy, byKey.itrYears), [{ year: 2022, status: "na" }, { year: 2025, status: "pending" }]);
});

test("a year question is done when no year is pending; all N/A or no years behave sensibly", () => {
  const item = byKey.itrYears;
  const partial = withRows("itrYears", [{ year: 2023, status: "received" }, { year: 2024, status: "na" }, { year: 2025, status: "pending" }]);
  assert.deepEqual(yearProgress(partial, item), { done: 1, na: 1, total: 2, count: 3 });
  assert.equal(itemStatus(partial, item), "pending");
  assert.equal(itemStatus(withRows("itrYears", [{ year: 2023, status: "received" }, { year: 2024, status: "na" }]), item), "received");
  assert.equal(itemStatus(withRows("itrYears", [{ year: 2023, status: "na" }]), item), "na");
  assert.equal(itemStatus(withRows("itrYears", []), item), "pending");
  assert.equal(itemStatus(profile(), item), "pending");
});

test("summary counts done, pending and N/A over visible items only", () => {
  const checklist = profile({
    constitution: "company",
    facility: "CCTL",
    collateral: true,
    rented: true,
    items: {
      loanApplication: { status: "received" },
      cicEntity: { status: "received" },
      activityLicence: { status: "na" },
      // N/A is not allowed on an "All" item; it counts as pending.
      udyam: { status: "na" },
    },
  });
  const sum = summarize(checklist);
  const visible = visibleKeys(checklist).length;
  assert.equal(visible, ALL_ITEMS.length - 1); // only the owned-premises proof is hidden
  assert.equal(sum.na, 1);
  assert.equal(sum.applicable, visible - 1);
  assert.equal(sum.received, 2);
  assert.equal(itemStatus(checklist, byKey.udyam), "pending");

  const hidden = profile({ facility: "CC", items: { projectReport: { status: "received" } } });
  assert.equal(summarize(hidden).received, 0);
  assert.equal(summarize(profile({ constitution: "" })).percent, 0);
});

test("amounts above ₹50 lakh warn but are allowed", () => {
  assert.equal(amountWarning(50), "");
  assert.equal(amountWarning(""), "");
  assert.match(amountWarning("50.01"), /above ₹50 lakh/);
});
