// Pre-sanction checklist for SME loans (up to ₹50 lakh).
// Template v2: 11 split into three parts, ITR and financial statements
// merged into one year-wise question. Item numbers are not stored: they are
// assigned in order to the visible items (see numberSections).
//
// Pure data + rules, no DOM or Firestore, so it can be unit-tested. The
// screen lives in sanction-checklist.js. Item keys are stored in Firestore,
// so never rename or reuse a key; add new ones and bump TEMPLATE_VERSION.

export const TEMPLATE_VERSION = 2;
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
const RULES = {
  all: { label: "All", applies: () => true },
  optional: { label: "If applicable", applies: () => true, allowNA: true },
  rented: { label: "If rented", applies: () => true, allowNA: true },
  firmOrCompany: {
    label: "Firm / Company",
    applies: p => p.constitution === "partnership" || p.constitution === "llp" || p.constitution === "company",
  },
  company: { label: "Company / LLP", applies: p => p.constitution === "company" || p.constitution === "llp" },
  tl: { label: "If TL", applies: p => p.facility === "TL" || p.facility === "CCTL" },
  cc: { label: "If CC", applies: p => p.facility === "CC" || p.facility === "CCTL" },
  collateral: { label: "If collateral", applies: p => p.collateral === true },
  // Not needed for a collateral-free loan covered under CGTMSE.
  notCgtmseClean: { label: "Unless CGTMSE", applies: p => !(p.collateral === false && p.cgtmse === true) },
};

// Section B documents are pulled and attached by the credit officer, not
// received from the borrower, so its "done" state reads "Attached".
//
// Items sharing a `group` are numbered as one question with a/b/c suffixes.
//
// An item with `parts` is a year-wise question: each part is Pending,
// Received or N/A, and the question is done when no part is pending. Parts
// are keyed by financial-year start so they survive a change of date.
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
      { key: "gstRegistration", rule: "all", label: "GST Registration Certificate" },
      { key: "tradeLicence", rule: "all", label: "Shop & Establishment / Trade Licence" },
      { key: "activityLicence", rule: "optional", label: "Activity-specific Licence (FSSAI / Drug / Pollution NOC etc.)" },
      { key: "addressOwnership", group: "address", rule: "all", label: "Business Address Proof – Ownership Document / Rent Agreement" },
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
      { key: "cersaiSearch", rule: "notCgtmseClean", label: "CERSAI Search (Property / Assets)" },
      { key: "mca21", rule: "company", label: "MCA21 Check (Directors, Charges)" },
      { key: "legalSearch", rule: "notCgtmseClean", label: "Litigation / Legal Search" },
      { key: "netWorth", rule: "all", label: "Net Worth Statement of Promoters & Guarantors" },
    ],
  },
  {
    id: "C",
    title: "Financials",
    doneLabel: "Received",
    items: [
      { key: "financialStatements", rule: "all", label: "ITR & Financial Statements (year-wise)", parts: financialParts },
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
export const HIDDEN_SECTION_REASONS = { D: "no Term Loan", E: "no Cash Credit", F: "no collateral" };

export const ALL_ITEMS = SECTIONS.flatMap(section => section.items);

export const ruleLabel = rule => RULES[rule]?.label || rule;
export const allowsNA = item => Boolean(RULES[item.rule]?.allowNA);

// ── Financial years ──────────────────────────────────────────────────────
// Indian FY runs April–March; a FY is identified by its starting year.
// For an application dated in FY N: provisional = N, projected = N+1,
// audited = the three completed years N-3, N-2, N-1.

export function fyStartYear(dateStr) {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(dateStr || "");
  if (!match) return null;
  const year = Number(match[1]);
  return Number(match[2]) >= 4 ? year : year - 1;
}

export function fyContext(dateStr) {
  const current = fyStartYear(dateStr);
  if (current == null) return null;
  return {
    audited: [current - 3, current - 2, current - 1],
    provisional: current,
    projected: current + 1,
  };
}

const yy = year => String(year % 100).padStart(2, "0");

export function fyLabel(startYear, withAssessmentYear = false) {
  if (startYear == null) return "FY —";
  const fy = `FY ${yy(startYear)}-${yy(startYear + 1)}`;
  return withAssessmentYear ? `${fy} (AY ${yy(startYear + 1)}-${yy(startYear + 2)})` : fy;
}

export function itemLabel(item) {
  return item.label;
}

// Year-wise parts of the ITR & financial statements question:
// ITRs for the three completed years, audited statements for the same three,
// plus provisional (current FY) and projected (next FY) statements.
function financialParts(fy) {
  const parts = [];
  for (const year of fy.audited) {
    parts.push({ key: `itr:${year}`, doc: "itr", year, stage: "Audited" });
    parts.push({ key: `bs:${year}`, doc: "bs", year, stage: "Audited" });
  }
  parts.push({ key: `bs:${fy.provisional}`, doc: "bs", year: fy.provisional, stage: "Provisional" });
  parts.push({ key: `bs:${fy.projected}`, doc: "bs", year: fy.projected, stage: "Projected" });
  return parts;
}

export function itemParts(item, applicationDate) {
  if (!item.parts) return [];
  const fy = fyContext(applicationDate);
  return fy ? item.parts(fy) : [];
}

// Rows for the year-wise grid: one per financial year, oldest first.
export function financialRows(item, applicationDate) {
  const rows = new Map();
  for (const part of itemParts(item, applicationDate)) {
    if (!rows.has(part.year)) rows.set(part.year, { year: part.year, stage: part.stage, itr: null, bs: null });
    rows.get(part.year)[part.doc] = part;
  }
  return [...rows.values()];
}

// `true` is how template v2 first stored a ticked part.
export function partState(checklist, item, partKey) {
  const value = checklist?.items?.[item.key]?.parts?.[partKey];
  if (value === "received" || value === true) return "received";
  if (value === "na") return "na";
  return "pending";
}

// `total` excludes N/A parts, so "done/total" reads like the main summary.
export function partProgress(checklist, item) {
  const parts = itemParts(item, checklist?.applicationDate);
  let done = 0;
  let na = 0;
  for (const part of parts) {
    const state = partState(checklist, item, part.key);
    if (state === "received") done += 1;
    else if (state === "na") na += 1;
  }
  return { done, na, total: parts.length - na, count: parts.length };
}

// ── Profile & visibility ─────────────────────────────────────────────────

export function profileOf(checklist) {
  return {
    constitution: checklist?.constitution || "",
    facility: checklist?.facility || "",
    collateral: checklist?.collateral === true ? true : checklist?.collateral === false ? false : null,
    cgtmse: checklist?.cgtmse === true ? true : checklist?.cgtmse === false ? false : null,
  };
}

// The items cannot be worked out until every profile question is answered.
export function isProfileComplete(checklist) {
  const p = profileOf(checklist);
  if (!p.constitution || !p.facility || p.collateral === null) return false;
  // CGTMSE cover is only asked when there is no collateral.
  return p.collateral === true || p.cgtmse !== null;
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
  if (item.parts) {
    const { done, total, count } = partProgress(checklist, item);
    if (count === 0) return "pending";
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

export function newChecklist({ applicationDate, user } = {}) {
  const now = new Date().toISOString();
  return {
    templateVersion: TEMPLATE_VERSION,
    borrowerName: "",
    facility: "",
    amountLakh: null,
    applicationDate: applicationDate || "",
    constitution: "",
    collateral: null,
    cgtmse: null,
    items: {},
    createdAt: now,
    createdBy: user || "",
    updatedAt: now,
    updatedBy: user || "",
  };
}
