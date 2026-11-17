// Pre-sanction checklist for SME loans (up to ₹50 lakh).
// Template v3: no application date; rented premises decides the address
// proofs; no collateral means CGTMSE cover; ITR and balance sheet are two
// year-wise questions whose years can be edited. Item numbers are not
// stored: they are assigned in order to the visible items (numberSections).
//
// Pure data + rules, no DOM or Firestore, so it can be unit-tested. The
// screen lives in sanction-checklist.js. Item keys are stored in Firestore,
// so never rename or reuse a key; add new ones and bump TEMPLATE_VERSION.

export const TEMPLATE_VERSION = 3;
export const AMOUNT_WARN_LAKH = 50;

export const CONSTITUTIONS = [
  { value: "proprietorship", label: "Proprietorship" },
  { value: "partnership", label: "Partnership Firm" },
  { value: "llp", label: "LLP" },
  { value: "company", label: "Company" },
];

export const FACILITIES = [
  { value: "CC", label: "Cash Credit (CC)" },
  { value: "TL", label: "Term Loan (TL)" },
  { value: "CCTL", label: "CC + TL" },
];

export const STATUSES = ["pending", "received", "na"];

// Applicability rules. Each maps a borrower profile to "does this item apply".
// `optional` items always show but may be marked N/A by the officer.
// A loan without collateral is covered under CGTMSE, so collateral-only
// checks (CERSAI, legal search, title, valuation) use the `collateral` rule.
const RULES = {
  all: { label: "All", applies: () => true },
  optional: { label: "If applicable", applies: () => true, allowNA: true },
  owned: { label: "Owned premises", applies: p => p.rented === false },
  rented: { label: "Rented premises", applies: p => p.rented === true },
  firmOrCompany: {
    label: "Firm / Company",
    applies: p => p.constitution === "partnership" || p.constitution === "llp" || p.constitution === "company",
  },
  company: { label: "Company / LLP", applies: p => p.constitution === "company" || p.constitution === "llp" },
  tl: { label: "If TL", applies: p => p.facility === "TL" || p.facility === "CCTL" },
  cc: { label: "If CC", applies: p => p.facility === "CC" || p.facility === "CCTL" },
  collateral: { label: "If collateral", applies: p => p.collateral === true },
};

// Section B documents are pulled and attached by the credit officer, not
// received from the borrower, so its "done" state reads "Attached".
//
// Items sharing a `group` are numbered as one question with a/b/c suffixes.
//
// An item with `years` is a year-wise question shown as a small table: each
// row is a financial year with its own Pending / Received / N/A. The rows
// start from the defaults below; the officer can type a different year,
// delete rows, and "+ Add year" continues the sequence from the latest
// year. The question is done when no row is pending.
export const SECTIONS = [
  {
    id: "A",
    title: "Borrower & Constitution",
    doneLabel: "Received",
    items: [
      { key: "loanApplication", rule: "all", label: "Loan Application Form (duly filled & signed)" },
      { key: "photographs", rule: "all", label: "Photographs of Proprietor / Partners / Directors / Guarantors" },
      { key: "panEntity", rule: "firmOrCompany", label: "PAN of Entity" },
      { key: "panAadhaarPromoters", rule: "all", label: "PAN & Aadhaar of Proprietor / Partners / Directors / Guarantors (self-attested & OSV)" },
      { key: "constitutionDocs", rule: "firmOrCompany", label: "Constitution Docs – Partnership Deed / LLP Agreement / MOA-AOA & Cert. of Incorporation" },
      { key: "boardResolution", rule: "firmOrCompany", label: "Board Resolution / Partners' Authority Letter to borrow" },
      { key: "udyam", rule: "all", label: "Udyam Registration Certificate" },
      { key: "gstRegistration", rule: "optional", label: "GST Registration Certificate" },
      { key: "tradeLicence", rule: "optional", label: "Shop & Establishment / Trade Licence" },
      { key: "activityLicence", rule: "optional", label: "Activity-specific Licence (FSSAI / Drug / Pollution NOC etc.)" },
      { key: "ownershipDoc", group: "address", rule: "owned", label: "Business Address Proof – Ownership Document" },
      { key: "rentAgreement", group: "address", rule: "rented", label: "Business Address Proof – Rent Agreement" },
      { key: "landlordKyc", group: "address", rule: "rented", label: "Business Address Proof – Landlord KYC" },
      { key: "utilityBill", group: "address", rule: "all", label: "Business Address Proof – Utility Bill" },
    ],
  },
  {
    id: "B",
    title: "Due Diligence Checks",
    doneLabel: "Attached",
    items: [
      { key: "cicEntity", rule: "all", label: "CIC Report – Entity (Commercial CIBIL / CMR Rank)" },
      { key: "cicPromoters", rule: "all", label: "CIC Report – All Promoters & Guarantors" },
      { key: "cersaiSearch", rule: "collateral", label: "CERSAI Search (Property / Assets)" },
      { key: "mca21", rule: "company", label: "MCA21 Check (Directors, Charges)" },
      { key: "legalSearch", rule: "collateral", label: "Litigation / Legal Search" },
      { key: "assetsLiabilities", rule: "all", label: "Assets & Liabilities Statement of Promoters & Guarantors" },
    ],
  },
  {
    id: "C",
    title: "Financials",
    doneLabel: "Received",
    items: [
      { key: "itrYears", rule: "all", label: "ITR with Computation", years: "itr" },
      { key: "balanceSheetYears", rule: "all", label: "Balance Sheet & P&L with Schedules", years: "bs" },
      { key: "gstReturns", rule: "all", label: "GST Returns (GSTR-3B & GSTR-1) – Last 12 Months" },
      { key: "bankStatements", rule: "all", label: "Bank Statements of All Accounts – Last 12 Months" },
    ],
  },
  {
    id: "D",
    title: "Term Loan Specific",
    doneLabel: "Received",
    items: [
      { key: "quotation", rule: "tl", label: "Quotation from Authorised Dealer (Supplier GST verified)" },
      { key: "projectReport", rule: "tl", label: "Project Report" },
      { key: "meansOfFinance", rule: "tl", label: "Means of Finance & Proof of Promoter Margin" },
    ],
  },
  {
    id: "E",
    title: "Cash Credit Specific",
    doneLabel: "Received",
    items: [
      { key: "stockStatement", rule: "cc", label: "Latest Stock Statement" },
      { key: "debtorsCreditors", rule: "cc", label: "Age-wise List of Debtors & Creditors" },
    ],
  },
  {
    id: "F",
    title: "Security / Collateral",
    doneLabel: "Received",
    items: [
      { key: "titleSearch", rule: "collateral", label: "Title Search Report (Legal Opinion)" },
      { key: "valuation", rule: "collateral", label: "Valuation Report (Approved Valuer)" },
      { key: "cgtmse", rule: "collateral", label: "CGTMSE Eligibility & Coverage" },
    ],
  },
  {
    id: "G",
    title: "Appraisal & Inspection",
    doneLabel: "Received",
    items: [
      { key: "unitVisit", rule: "all", label: "Pre-Sanction Unit Visit Report (Geo-tagged Photos)" },
      { key: "anyOther", rule: "optional", label: "Any Other (Specify in Remarks)" },
    ],
  },
];

// Why a whole section can be hidden, for the note under the checklist.
export const HIDDEN_SECTION_REASONS = { D: "no Term Loan", E: "no Cash Credit", F: "no collateral – CGTMSE" };

export const ALL_ITEMS = SECTIONS.flatMap(section => section.items);

export const ruleLabel = rule => RULES[rule]?.label || rule;
export const allowsNA = item => Boolean(RULES[item.rule]?.allowNA);
export const itemLabel = item => item.label;

// ── Financial years ──────────────────────────────────────────────────────
// Indian FY runs April–March; a FY is identified by its starting year.
// The checklist's reference date (the day it was started) fixes the current
// FY N: the three completed years N-3..N-1 are audited, N is provisional and
// N+1 is projected.

export function fyStartYear(dateStr) {
  const match = /^(\d{4})-(\d{2})-\d{2}/.exec(dateStr || "");
  if (!match) return null;
  const year = Number(match[1]);
  return Number(match[2]) >= 4 ? year : year - 1;
}

const yy = year => String(((year % 100) + 100) % 100).padStart(2, "0");

export function fyLabel(startYear) {
  return startYear == null ? "FY —" : `FY ${yy(startYear)}-${yy(startYear + 1)}`;
}

export const ayLabel = startYear => `AY ${yy(startYear + 1)}-${yy(startYear + 2)}`;

// Older checklists have no referenceDate; fall back to when they were made.
export function currentFy(checklist) {
  return fyStartYear(checklist?.referenceDate) ?? fyStartYear(checklist?.createdAt) ?? fyStartYear(new Date().toISOString());
}

// Audited / Provisional / Projected follows from the year itself.
export function bsStage(checklist, year) {
  const current = currentFy(checklist);
  if (year < current) return "Audited";
  return year === current ? "Provisional" : "Projected";
}

function defaultYears(item, checklist) {
  const current = currentFy(checklist);
  return item.years === "itr"
    ? [current - 3, current - 2, current - 1]
    : [current - 3, current - 2, current - 1, current, current + 1];
}

const normalizeStatus = value => (value === "received" || value === "na" ? value : "pending");

// Rows as stored, or the default years until the officer changes anything.
export function yearRows(checklist, item) {
  const stored = checklist?.items?.[item.key]?.rows;
  const rows = Array.isArray(stored)
    ? stored.filter(row => Number.isInteger(row?.year)).map(row => ({ year: row.year, status: normalizeStatus(row.status) }))
    : defaultYears(item, checklist).map(year => ({ year, status: "pending" }));
  return rows.sort((a, b) => a.year - b.year);
}

// The year "+ Add year" inserts: the one after the latest row, so added
// years follow on in sequence. With no rows it starts from the defaults.
export function nextYear(checklist, item) {
  const rows = yearRows(checklist, item);
  return rows.length ? rows[rows.length - 1].year + 1 : defaultYears(item, checklist)[0];
}

// Shown in the year box, e.g. 2023 → "2023-24".
export const fyInput = startYear => `${startYear}-${yy(startYear + 1)}`;

// Reads a typed financial year: "2023-24", "23-24", "FY 2023-2024",
// "2023/24" or just "2023". Returns the starting year, or null if unclear.
export function parseFy(text) {
  const match = /^\s*(?:FY\s*)?(\d{2}|\d{4})(?:\s*[-/]\s*(\d{2}|\d{4}))?\s*$/i.exec(text || "");
  if (!match) return null;
  const short = Number(match[1]);
  // Two digits: 90–99 are the 1990s, anything else this century.
  const start = match[1].length === 4 ? short : short >= 90 ? 1900 + short : 2000 + short;
  if (start < 1990 || start > 2100) return null;
  if (match[2] != null) {
    const end = Number(match[2]);
    const ok = match[2].length === 2 ? end === (start + 1) % 100 : end === start + 1;
    if (!ok) return null;
  }
  return start;
}

// `total` excludes N/A rows, so "done/total" reads like the main summary.
export function yearProgress(checklist, item) {
  const rows = yearRows(checklist, item);
  const done = rows.filter(row => row.status === "received").length;
  const na = rows.filter(row => row.status === "na").length;
  return { done, na, total: rows.length - na, count: rows.length };
}

// ── Profile & visibility ─────────────────────────────────────────────────

const yesNo = value => (value === true ? true : value === false ? false : null);

export function profileOf(checklist) {
  return {
    constitution: checklist?.constitution || "",
    facility: checklist?.facility || "",
    collateral: yesNo(checklist?.collateral),
    rented: yesNo(checklist?.rented),
  };
}

// The items cannot be worked out until every profile question is answered.
export function isProfileComplete(checklist) {
  const p = profileOf(checklist);
  return Boolean(p.constitution) && Boolean(p.facility) && p.collateral !== null && p.rented !== null;
}

export function itemApplies(item, profile) {
  const rule = RULES[item.rule];
  return rule ? rule.applies(profile) : false;
}

// Sections with no applicable item are dropped entirely.
export function visibleSections(checklist) {
  if (!isProfileComplete(checklist)) return [];
  const profile = profileOf(checklist);
  return numberSections(SECTIONS
    .map(section => ({ ...section, items: section.items.filter(item => itemApplies(item, profile)) }))
    .filter(section => section.items.length > 0));
}

// Numbers the visible items 1, 2, 3… with no gaps. Visible items of a group
// share one number with a, b, c suffixes (no suffix if only one is visible).
export function numberSections(sections) {
  let counter = 0;
  let lastGroup = null;
  return sections.map(section => {
    const items = section.items.map((item, index) => {
      if (!item.group) { lastGroup = null; return { ...item, no: String(++counter) }; }
      if (item.group !== lastGroup) { counter += 1; lastGroup = item.group; }
      const members = section.items.filter(other => other.group === item.group);
      if (members.length === 1) return { ...item, no: String(counter) };
      const position = members.indexOf(section.items[index]);
      return { ...item, no: `${counter}${String.fromCharCode(97 + position)}` };
    });
    return { ...section, items };
  });
}

// ── Status & summary ─────────────────────────────────────────────────────

export function itemStatus(checklist, item) {
  if (item.years) {
    const { done, total, count } = yearProgress(checklist, item);
    if (count === 0) return "pending"; // every year deleted: still needs one
    if (total === 0) return "na";
    return done === total ? "received" : "pending";
  }
  const status = checklist?.items?.[item.key]?.status;
  if (status === "received") return "received";
  if (status === "na" && allowsNA(item)) return "na";
  return "pending";
}

export function summarize(checklist, sections = visibleSections(checklist)) {
  let applicable = 0;
  let received = 0;
  let na = 0;
  for (const section of sections) {
    for (const item of section.items) {
      const status = itemStatus(checklist, item);
      if (status === "na") { na += 1; continue; }
      applicable += 1;
      if (status === "received") received += 1;
    }
  }
  const pending = applicable - received;
  const percent = applicable ? Math.round((received / applicable) * 1000) / 10 : 0;
  return { applicable, received, pending, na, percent };
}

export function sectionSummary(checklist, section) {
  return summarize(checklist, [section]);
}

export function parseAmountLakh(value) {
  const amount = Number.parseFloat(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function amountWarning(value) {
  const amount = parseAmountLakh(value);
  return amount != null && amount > AMOUNT_WARN_LAKH
    ? `Amount is above ₹${AMOUNT_WARN_LAKH} lakh. This checklist is meant for SME loans up to ₹${AMOUNT_WARN_LAKH} lakh.`
    : "";
}

export function newChecklist({ today, user } = {}) {
  const now = new Date().toISOString();
  return {
    templateVersion: TEMPLATE_VERSION,
    borrowerName: "",
    facility: "",
    amountLakh: null,
    referenceDate: today || now.slice(0, 10),
    constitution: "",
    collateral: null,
    rented: null,
    items: {},
    createdAt: now,
    createdBy: user || "",
    updatedAt: now,
    updatedBy: user || "",
  };
}
