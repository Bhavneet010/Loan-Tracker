import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_ITEMS, SECTIONS, amountWarning, financialRows, fyContext, fyLabel, isProfileComplete,
  itemParts, itemStatus, newChecklist, partProgress, summarize, visibleSections,
} from "../js/sanction-checklist-model.js";

const profile = (overrides = {}) => ({
  ...newChecklist({ applicationDate: "2026-11-16" }),
  borrowerName: "Test",
  constitution: "proprietorship",
  facility: "CC",
  collateral: true,
  cgtmse: null,
  ...overrides,
});
const byKey = Object.fromEntries(ALL_ITEMS.map(item => [item.key, item]));
const sectionIds = checklist => visibleSections(checklist).map(section => section.id);
const visibleKeys = checklist => visibleSections(checklist).flatMap(section => section.items.map(item => item.key));

test("the template has unique keys and numbers 1–30 with 11a–11c", () => {
  assert.equal(new Set(ALL_ITEMS.map(item => item.key)).size, ALL_ITEMS.length);
  const srs = ALL_ITEMS.map(item => item.sr);
  assert.deepEqual(srs.slice(10, 13), ["11a", "11b", "11c"]);
  assert.equal(srs.at(-1), "30");
  assert.equal(ALL_ITEMS.length, 32);
  assert.deepEqual(SECTIONS.map(section => section.id), ["A", "B", "C", "D", "E", "F", "G"]);
  assert.equal(SECTIONS.find(section => section.id === "B").doneLabel, "Attached");
});

test("removed items are gone and net worth moved to due diligence", () => {
  assert.equal(byKey.taxAudit, undefined);
  assert.equal(byKey.addressProof, undefined);
  const due = SECTIONS.find(section => section.id === "B").items.map(item => item.key);
  assert.equal(due.includes("netWorth"), true);
});

test("nothing shows until the profile is answered; CGTMSE is asked only without collateral", () => {
  assert.deepEqual(visibleSections(profile({ constitution: "" })), []);
  assert.deepEqual(visibleSections(profile({ facility: "" })), []);
  assert.deepEqual(visibleSections(profile({ collateral: null })), []);
  assert.equal(isProfileComplete(profile({ collateral: true, cgtmse: null })), true);
  assert.equal(isProfileComplete(profile({ collateral: false, cgtmse: null })), false);
  assert.equal(isProfileComplete(profile({ collateral: false, cgtmse: false })), true);
});

test("facility decides the TL and CC sections; collateral decides section F", () => {
  assert.deepEqual(sectionIds(profile({ facility: "CC" })), ["A", "B", "C", "E", "F", "G"]);
  assert.deepEqual(sectionIds(profile({ facility: "TL" })), ["A", "B", "C", "D", "F", "G"]);
  assert.deepEqual(sectionIds(profile({ facility: "CCTL" })), ["A", "B", "C", "D", "E", "F", "G"]);
  assert.deepEqual(sectionIds(profile({ collateral: false, cgtmse: true })), ["A", "B", "C", "E", "G"]);
  assert.deepEqual(
    visibleSections(profile()).find(section => section.id === "F").items.map(item => item.key),
    ["titleSearch", "valuation", "cgtmse"],
  );
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

test("CERSAI and legal search are hidden only for collateral-free CGTMSE loans", () => {
  const searches = ["cersaiSearch", "legalSearch"];
  const has = checklist => searches.map(key => visibleKeys(checklist).includes(key));
  assert.deepEqual(has(profile({ collateral: false, cgtmse: true })), [false, false]);
  assert.deepEqual(has(profile({ collateral: false, cgtmse: false })), [true, true]);
  assert.deepEqual(has(profile({ collateral: true, cgtmse: true })), [true, true]);
});

test("financial years follow the application date across the April rollover", () => {
  assert.deepEqual(fyContext("2026-11-16"), { audited: [2023, 2024, 2025], provisional: 2026, projected: 2027 });
  assert.deepEqual(fyContext("2027-03-31"), { audited: [2023, 2024, 2025], provisional: 2026, projected: 2027 });
  assert.deepEqual(fyContext("2027-04-01"), { audited: [2024, 2025, 2026], provisional: 2027, projected: 2028 });
  assert.equal(fyContext(""), null);
  assert.equal(fyLabel(2023, true), "FY 23-24 (AY 24-25)");
  assert.equal(fyLabel(2099), "FY 99-00");
});

test("the year-wise question lists 3 ITRs and 5 statements, done only when all are ticked", () => {
  const item = byKey.financialStatements;
  assert.equal(itemParts(item, "").length, 0);
  const rows = financialRows(item, "2026-11-16");
  assert.deepEqual(rows.map(row => [row.year, row.stage, Boolean(row.itr), Boolean(row.bs)]), [
    [2023, "Audited", true, true],
    [2024, "Audited", true, true],
    [2025, "Audited", true, true],
    [2026, "Provisional", false, true],
    [2027, "Projected", false, true],
  ]);

  const keys = itemParts(item, "2026-11-16").map(part => part.key);
  const partial = profile({ items: { financialStatements: { parts: { "itr:2023": true, "bs:2023": true } } } });
  assert.deepEqual(partProgress(partial, item), { done: 2, total: 8 });
  assert.equal(itemStatus(partial, item), "pending");

  const all = profile({ items: { financialStatements: { parts: Object.fromEntries(keys.map(key => [key, true])) } } });
  assert.equal(itemStatus(all, item), "received");
  // A later application date moves the years, so earlier ticks no longer complete it.
  assert.equal(itemStatus({ ...all, applicationDate: "2027-05-01" }, item), "pending");
});

test("summary counts done, pending and N/A over visible items only", () => {
  const checklist = profile({
    constitution: "company",
    facility: "CCTL",
    collateral: true,
    items: {
      loanApplication: { status: "received" },
      cicEntity: { status: "received" },
      activityLicence: { status: "na" },
      landlordKyc: { status: "na" },
      // N/A is not allowed on an "All" item; it counts as pending.
      udyam: { status: "na" },
    },
  });
  const sum = summarize(checklist);
  const visible = visibleKeys(checklist).length;
  assert.equal(visible, ALL_ITEMS.length); // company + CC/TL + collateral: everything applies
  assert.equal(sum.na, 2);
  assert.equal(sum.applicable, visible - 2);
  assert.equal(sum.received, 2);
  assert.equal(itemStatus(checklist, byKey.udyam), "pending");

  // Hidden items never count, even if they were marked before the profile changed.
  const hidden = profile({ facility: "CC", items: { projectReport: { status: "received" } } });
  assert.equal(summarize(hidden).received, 0);
  assert.equal(summarize(profile({ constitution: "" })).percent, 0);
});

test("amounts above ₹50 lakh warn but are allowed", () => {
  assert.equal(amountWarning(50), "");
  assert.equal(amountWarning(""), "");
  assert.match(amountWarning("50.01"), /above ₹50 lakh/);
});
