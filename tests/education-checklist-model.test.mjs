import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_ITEMS, EDU_ALL_ITEMS, EDU_COLLATERAL_LIMIT_LAKH, EDU_SECTIONS, allowsNA, checklistReport, checklistType,
  collateralRequired, isProfileComplete, itemStatus, newChecklist, pendingItems, pendingTags, shortTag,
  summarize, visibleSections, yearRows,
} from "../js/sanction-checklist-model.js";

// The PDF module sets up its jsPDF loader against `document` on load.
globalThis.document ??= { head: {}, createElement: () => ({}) };
const { checklistPdfDetails, checklistPdfFilename } = await import("../js/sanction-checklist-pdf.js");

const edu = (overrides = {}) => ({
  ...newChecklist({ today: "2026-11-24", type: "education" }),
  borrowerName: "Riya",
  amountLakh: 6,
  studyAbroad: false,
  priorDegree: false,
  co1Relation: "parent",
  co1Work: "salaried",
  secondCoApplicant: false,
  ...overrides,
});
const byKey = Object.fromEntries(EDU_ALL_ITEMS.map(item => [item.key, item]));
const sectionIds = checklist => visibleSections(checklist).map(section => section.id);
const keys = checklist => visibleSections(checklist).flatMap(section => section.items.map(item => item.key));

test("education template: unique keys, no clash with SME, a short tag for every item", () => {
  const eduKeys = EDU_ALL_ITEMS.map(item => item.key);
  assert.equal(new Set(eduKeys).size, eduKeys.length);
  const sme = new Set(ALL_ITEMS.map(item => item.key));
  assert.equal(eduKeys.some(key => sme.has(key)), false);
  assert.ok(eduKeys.every(key => key.startsWith("edu")));
  for (const key of eduKeys) assert.notEqual(shortTag(key), key, key);
  assert.deepEqual(EDU_SECTIONS.map(section => section.id), ["A", "B", "C", "D", "E", "F", "G", "H"]);
});

test("checklists with no type are SME; new ones carry their type", () => {
  assert.equal(checklistType({}), "sme");
  assert.equal(checklistType({ type: "education" }), "education");
  assert.equal(newChecklist().type, "sme");
  assert.equal(newChecklist({ type: "education" }).collateralMode, "auto");
});

test("collateral follows the amount, and the override wins", () => {
  assert.equal(collateralRequired(edu({ amountLakh: EDU_COLLATERAL_LIMIT_LAKH })), false);
  assert.equal(collateralRequired(edu({ amountLakh: 7.51 })), true);
  assert.equal(collateralRequired(edu({ amountLakh: null })), null);
  assert.equal(collateralRequired(edu({ amountLakh: 4, collateralMode: "yes" })), true);
  assert.equal(collateralRequired(edu({ amountLakh: 40, collateralMode: "no" })), false);
  assert.equal(collateralRequired(edu({ amountLakh: null, collateralMode: "yes" })), true);
  assert.equal(sectionIds(edu({ amountLakh: 6 })).includes("H"), false);
  assert.equal(sectionIds(edu({ amountLakh: 20 })).includes("H"), true);
  assert.equal(sectionIds(edu({ amountLakh: 4, collateralMode: "yes" })).includes("H"), true);
  // Why H is missing, for the note and the PDF.
  assert.equal(checklistReport(edu()).hidden.find(entry => entry.id === "H").reason, "up to ₹7.5 lakh");
  assert.equal(checklistReport(edu({ amountLakh: 40, collateralMode: "no" })).hidden.find(entry => entry.id === "H").reason, "marked not required");
});

test("nothing shows until the education questions are answered", () => {
  assert.equal(isProfileComplete(edu()), true);
  const missing = [
    { studyAbroad: null }, { priorDegree: null }, { co1Relation: "" }, { co1Work: "" }, { secondCoApplicant: null },
    { secondCoApplicant: true }, { secondCoApplicant: true, co2Relation: "brother" }, { amountLakh: null },
  ];
  for (const change of missing) assert.deepEqual(visibleSections(edu(change)), [], JSON.stringify(change));
  // With collateral set by hand the amount is not needed to decide it.
  assert.equal(isProfileComplete(edu({ amountLakh: null, collateralMode: "no" })), true);
  assert.equal(isProfileComplete(edu({ secondCoApplicant: true, co2Relation: "brother", co2Work: "none" })), true);
});

test("second co-applicant adds its section and CIBIL; switching off keeps its ticks", () => {
  assert.deepEqual(sectionIds(edu()), ["A", "B", "D", "E", "G"]);
  const two = edu({ secondCoApplicant: true, co2Relation: "sister", co2Work: "self", items: { eduCo2Photo: { status: "received" } } });
  assert.deepEqual(sectionIds(two), ["A", "B", "C", "D", "E", "G"]);
  assert.ok(keys(two).includes("eduCicCo2"));
  assert.equal(visibleSections(two).find(section => section.id === "C").title, "Co-applicant 2 – Sister");
  assert.equal(summarize(two).received, 1);
  const off = { ...two, secondCoApplicant: false };
  assert.equal(summarize(off).received, 0);
  assert.equal(off.items.eduCo2Photo.status, "received");
  assert.equal(summarize({ ...off, secondCoApplicant: true }).received, 1);
});

test("co-applicant work decides the income documents", () => {
  const income = work => visibleSections(edu({ co1Work: work })).find(section => section.id === "B").items.map(item => item.key);
  assert.deepEqual(income("salaried"), [
    "eduCo1Photo", "eduCo1PanAadhaar", "eduCo1Relation", "eduCo1SalarySlips", "eduCo1Form16", "eduCo1Employment", "eduCo1Bank", "eduCo1OtherIncome",
  ]);
  assert.deepEqual(income("self"), [
    "eduCo1Photo", "eduCo1PanAadhaar", "eduCo1Relation", "eduCo1Itr", "eduCo1BusinessProof", "eduCo1Bank", "eduCo1OtherIncome",
  ]);
  assert.deepEqual(income("none"), ["eduCo1Photo", "eduCo1PanAadhaar", "eduCo1Relation", "eduCo1OtherIncome"]);
  const bank = work => visibleSections(edu({ co1Work: work })).flatMap(section => section.items).find(item => item.key === "eduCo1Bank").label;
  assert.match(bank("salaried"), /6 Months/);
  assert.match(bank("self"), /12 Months/);
  assert.equal(visibleSections(edu()).find(section => section.id === "B").title, "Co-applicant 1 – Parent");
  // Self-employed ITR is a year-wise question with three default years.
  assert.deepEqual(yearRows(edu({ co1Work: "self" }), byKey.eduCo1Itr).map(row => row.year), [2023, 2024, 2025]);
});

test("study abroad adds passport, I-20/CAS, cost sheet and visa; scorecard wording follows", () => {
  assert.deepEqual(visibleSections(edu({ studyAbroad: true })).find(section => section.id === "F").items.map(item => item.key),
    ["eduPassport", "eduI20", "eduFxCost", "eduVisa"]);
  assert.equal(allowsNA(byKey.eduVisa), true);
  assert.equal(allowsNA(byKey.eduPassport), false);
  const scorecard = abroad => visibleSections(edu({ studyAbroad: abroad })).flatMap(section => section.items).find(item => item.key === "eduEntrance").label;
  assert.match(scorecard(true), /GRE/);
  assert.match(scorecard(false), /JEE/);
});

test("degree, gap certificate, scholarship and other income are where expected", () => {
  assert.equal(keys(edu()).includes("eduDegree"), false);
  assert.equal(keys(edu({ priorDegree: true })).includes("eduDegree"), true);
  for (const key of ["eduGap", "eduScholarship", "eduCo1OtherIncome", "eduFeeReceipts"]) {
    assert.ok(keys(edu()).includes(key), key);
    assert.equal(allowsNA(byKey[key]), true, key);
  }
  for (const key of ["eduVidyalaxmi", "eduAdmission", "eduFeeStructure", "edu10th", "edu12th"]) {
    assert.ok(keys(edu()).includes(key), key);
    assert.equal(allowsNA(byKey[key]), false, key);
  }
  assert.equal(itemStatus(edu({ items: { eduGap: { status: "na" } } }), byKey.eduGap), "na");
});

test("pending tags: CIBIL checks are not the branch's to send", () => {
  const checklist = edu({ secondCoApplicant: true, co2Relation: "brother", co2Work: "salaried" });
  const items = pendingItems(checklist);
  assert.equal(items.find(item => item.key === "eduCicStudent").branch, false);
  assert.equal(items.find(item => item.key === "eduAdmission").branch, true);
  const branch = pendingTags(checklist, { branchOnly: true });
  assert.ok(branch.includes("Admission letter"));
  assert.ok(branch.includes("Co-app 2 KYC"));
  assert.equal(branch.some(tag => tag.startsWith("CIBIL")), false);
});

test("PDF details and filename follow the type", () => {
  const checklist = edu({ amountLakh: 20, studyAbroad: true, secondCoApplicant: true, co2Relation: "inLaw", co2Work: "none", course: "MS, TU Munich" });
  const details = Object.fromEntries(checklistPdfDetails(checklist));
  assert.equal(details.Student, "Riya");
  assert.equal(details.Study, "Abroad");
  assert.equal(details["Co-applicant 1"], "Parent (Salaried)");
  assert.equal(details["Co-applicant 2"], "Parent-in-law (Not working)");
  assert.match(details.Collateral, /^Required - by amount/);
  assert.match(checklistPdfDetails(edu({ collateralMode: "yes" })).find(([label]) => label === "Collateral")[1], /overridden/);
  assert.equal(checklistPdfFilename(checklist, "2026-11-24"), "education-loan-checklist-riya-2026-11-24.pdf");
  assert.equal(checklistPdfFilename({ borrowerName: "Sharma Traders" }, "2026-11-24"), "pre-sanction-checklist-sharma-traders-2026-11-24.pdf");
  assert.equal(checklistPdfDetails({ borrowerName: "X" })[0][0], "Borrower");
});
