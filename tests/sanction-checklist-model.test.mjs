import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_ITEMS, SECTIONS, amountWarning, fyContext, fyLabel, isProfileComplete, itemLabel,
  itemStatus, newChecklist, summarize, visibleSections,
} from "../js/sanction-checklist-model.js";

const profile = (overrides = {}) => ({
  ...newChecklist({ applicationDate: "2026-11-16" }),
  borrowerName: "Test",
  constitution: "proprietorship",
  facility: "CC",
  collateral: false,
  ...overrides,
});
const sectionIds = checklist => visibleSections(checklist).map(section => section.id);
const visibleSrs = checklist => visibleSections(checklist).flatMap(section => section.items.map(item => item.sr));

test("the template matches the 38-item paper checklist with unique keys", () => {
  assert.equal(ALL_ITEMS.length, 38);
  assert.deepEqual(ALL_ITEMS.map(item => item.sr), Array.from({ length: 38 }, (_, i) => i + 1));
  assert.equal(new Set(ALL_ITEMS.map(item => item.key)).size, 38);
  assert.deepEqual(SECTIONS.map(section => section.id), ["A", "B", "C", "D", "E", "F", "G"]);
});

test("nothing shows until constitution, facility and collateral are answered", () => {
  assert.deepEqual(visibleSections(profile({ constitution: "" })), []);
  assert.deepEqual(visibleSections(profile({ facility: "" })), []);
  assert.deepEqual(visibleSections(profile({ collateral: null })), []);
  assert.equal(isProfileComplete(profile()), true);
});

test("facility decides the TL and CC sections", () => {
  assert.deepEqual(sectionIds(profile({ facility: "CC" })), ["A", "B", "C", "E", "F", "G"]);
  assert.deepEqual(sectionIds(profile({ facility: "TL" })), ["A", "B", "C", "D", "F", "G"]);
  assert.deepEqual(sectionIds(profile({ facility: "CCTL" })), ["A", "B", "C", "D", "E", "F", "G"]);
});

test("collateral decides title search and valuation; CGTMSE always shows", () => {
  const without = visibleSrs(profile({ collateral: false }));
  const withCollateral = visibleSrs(profile({ collateral: true }));
  assert.equal(without.includes(34) || without.includes(35), false);
  assert.equal(without.includes(36), true);
  assert.equal(withCollateral.includes(34) && withCollateral.includes(35), true);
});

test("constitution decides firm/company and MCA21 items", () => {
  const proprietor = visibleSrs(profile({ constitution: "proprietorship" }));
  assert.equal([5, 6, 15].some(sr => proprietor.includes(sr)), false);
  const firm = visibleSrs(profile({ constitution: "partnership" }));
  assert.equal(firm.includes(5) && firm.includes(6), true);
  assert.equal(firm.includes(15), false);
  for (const constitution of ["company", "llp"]) {
    const srs = visibleSrs(profile({ constitution }));
    assert.equal([5, 6, 15].every(sr => srs.includes(sr)), true, constitution);
  }
});

test("financial years follow the application date across the April rollover", () => {
  assert.deepEqual(fyContext("2026-11-16"), { audited: [2023, 2024, 2025], provisional: 2026, projected: 2027 });
  assert.deepEqual(fyContext("2027-03-31"), { audited: [2023, 2024, 2025], provisional: 2026, projected: 2027 });
  assert.deepEqual(fyContext("2027-04-01"), { audited: [2024, 2025, 2026], provisional: 2027, projected: 2028 });
  assert.equal(fyContext(""), null);
  assert.equal(fyLabel(2023, true), "FY 23-24 (AY 24-25)");
  assert.equal(fyLabel(2099), "FY 99-00");

  const byKey = Object.fromEntries(ALL_ITEMS.map(item => [item.key, item]));
  assert.equal(itemLabel(byKey.itrY1, "2026-11-16"), "ITR with Computation – FY 23-24 (AY 24-25)");
  assert.equal(itemLabel(byKey.bsY3, "2026-11-16"), "Balance Sheet & P&L with Schedules – FY 25-26 (Audited)");
  assert.equal(itemLabel(byKey.bsProvisional, "2026-11-16"), "Balance Sheet & P&L – FY 26-27 (Provisional / Estimated)");
  assert.equal(itemLabel(byKey.bsProjected, "2026-11-16"), "Balance Sheet & P&L – FY 27-28 (Projected)");
});

test("summary counts received, pending and N/A over visible items only", () => {
  const checklist = profile({
    constitution: "company",
    facility: "CCTL",
    collateral: true,
    items: {
      loanApplication: { status: "received" },
      panEntity: { status: "received" },
      activityLicence: { status: "na" },
      taxAudit: { status: "na" },
      // N/A is not allowed on an "All" item; it counts as pending.
      udyam: { status: "na" },
    },
  });
  const sum = summarize(checklist);
  assert.equal(sum.na, 2);
  assert.equal(sum.applicable, 36);
  assert.equal(sum.received, 2);
  assert.equal(sum.pending, 34);
  assert.equal(sum.percent, 5.6);

  const byKey = Object.fromEntries(ALL_ITEMS.map(item => [item.key, item]));
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
