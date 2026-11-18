import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_ITEMS, SECTIONS, amountWarning, ayLabel, bsStage, currentFy, fyLabel, fyStartYear,
  allowsNA, checklistReport, fyInput, isProfileComplete, itemStatus, newChecklist, nextYear, parseFy, summarize,
  visibleSections, yearProgress, yearRows,
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
  // Owned premises: the utility bill alone is the address proof.
  assert.deepEqual(owned.map(item => item.key), ["utilityBill"]);
  const rented = address(profile({ rented: true }));
  assert.deepEqual(rented.map(item => item.key), ["rentAgreement", "landlordKyc", "utilityBill"]);
  // Proprietorship: 7 single items first, so the address group is 8.
  assert.deepEqual(owned.map(item => item.no), ["8"]);
  assert.deepEqual(rented.map(item => item.no), ["8a", "8b", "8c"]);
});

test("photo and PAN/Aadhaar questions name only the people the constitution has", () => {
  const labels = constitution => {
    const items = visibleSections(profile({ constitution }))[0].items;
    return [items.find(item => item.key === "photographs").label, items.find(item => item.key === "panAadhaarPromoters").label];
  };
  assert.deepEqual(labels("proprietorship"), ["Photographs of Proprietor & Guarantors", "PAN & Aadhaar of Proprietor & Guarantors (self-attested & OSV)"]);
  assert.equal(labels("partnership")[0], "Photographs of Partners & Guarantors");
  assert.equal(labels("llp")[1], "PAN & Aadhaar of Designated Partners & Guarantors (self-attested & OSV)");
  assert.equal(labels("company")[0], "Photographs of Directors & Guarantors");
  // The PDF report uses the same wording.
  const report = checklistReport(profile({ constitution: "company" }));
  assert.equal(report.sections[0].rows.find(row => row.label.startsWith("Photographs")).label, "Photographs of Directors & Guarantors");
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

test("typed financial years are understood in the usual formats", () => {
  for (const text of ["2023-24", "23-24", "FY 23-24", "fy2023-2024", "2023/24", " 2023 ", "23"]) {
    assert.equal(parseFy(text), 2023, text);
  }
  assert.equal(parseFy("99-00"), 1999);
  assert.equal(parseFy("09-10"), 2009);
  for (const text of ["", "abc", "2023-25", "2023-2025", "23-2", "1800-01", "2023-24-25"]) {
    assert.equal(parseFy(text), null, text);
  }
  assert.equal(fyInput(2023), "2023-24");
  assert.equal(fyInput(1999), "1999-00");
});

test("added years follow on in sequence from the latest year", () => {
  assert.equal(nextYear(profile(), byKey.itrYears), 2026);
  assert.equal(nextYear(profile(), byKey.balanceSheetYears), 2028);
  const c = withRows("itrYears", [{ year: 2019, status: "received" }, { year: 2020, status: "pending" }]);
  assert.equal(nextYear(c, byKey.itrYears), 2021);
  // With every row deleted it starts again from the first default year.
  assert.equal(nextYear(withRows("itrYears", []), byKey.itrYears), 2023);
  // Stored rows are sorted and bad entries dropped.
  const messy = withRows("itrYears", [{ year: 2025, status: "x" }, { year: "bad" }, { year: 2022, status: "na" }]);
  assert.deepEqual(yearRows(messy, byKey.itrYears), [{ year: 2022, status: "na" }, { year: 2025, status: "pending" }]);
});

test("GST registration and trade licence allow N/A; assets & liabilities is a due diligence item", () => {
  assert.equal(allowsNA(byKey.gstRegistration), true);
  assert.equal(allowsNA(byKey.tradeLicence), true);
  assert.equal(itemStatus(profile({ items: { gstRegistration: { status: "na" } } }), byKey.gstRegistration), "na");
  const due = visibleSections(profile()).find(section => section.id === "B").items.map(item => item.key);
  assert.equal(due.at(-1), "assetsLiabilities");
  assert.equal(byKey.netWorth, undefined);
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
  assert.equal(visible, ALL_ITEMS.length); // company + CC/TL + collateral + rented: everything applies
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

test("the PDF report lists only applicable items with their status words and years", () => {
  const checklist = profile({
    facility: "TL",
    collateral: false,
    rented: true,
    items: {
      loanApplication: { status: "received", remark: "Signed copy on file" },
      activityLicence: { status: "na" },
      cicEntity: { status: "received" },
      itrYears: { rows: [{ year: 2023, status: "received" }, { year: 2024, status: "na" }, { year: 2025, status: "pending" }] },
    },
  });
  const report = checklistReport(checklist);
  assert.deepEqual(report.sections.map(section => section.id), ["A", "B", "C", "D", "G"]);
  assert.deepEqual(report.hidden.map(entry => entry.id), ["E", "F"]);
  const [a, b, c] = report.sections;
  assert.deepEqual(a.rows[0], { no: "1", label: byKey.loanApplication.label, status: "received", statusLabel: "Received", remark: "Signed copy on file" });
  assert.equal(a.rows.some(row => typeof row.label !== "string"), false);
  assert.equal(a.rows.find(row => row.label.includes("Activity")).statusLabel, "N/A");
  assert.equal(b.rows[0].statusLabel, "Attached");
  assert.equal(b.rows[1].statusLabel, "Pending");
  const itr = c.rows.find(row => row.years && row.label.startsWith("ITR"));
  assert.equal(itr.statusLabel, "1/2");
  assert.deepEqual(itr.years.map(entry => [entry.label, entry.statusLabel]), [
    ["FY 23-24 (AY 24-25)", "Received"],
    ["FY 24-25 (AY 25-26)", "N/A"],
    ["FY 25-26 (AY 26-27)", "Pending"],
  ]);
  const bs = c.rows.find(row => row.years && row.label.startsWith("Balance"));
  assert.equal(bs.years.at(-1).label, "FY 27-28 – Projected");
  assert.equal(report.summary.received, 2); // ITR still has a pending year
});
