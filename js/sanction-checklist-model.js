// Pre-sanction checklist for SME loans (up to ₹50 lakh).
//
// Pure data + rules, no DOM or Firestore, so it can be unit-tested. The
// screen lives in sanction-checklist.js. Item keys are stored in Firestore,
// so never rename or reuse a key; add new ones and bump TEMPLATE_VERSION.

export const TEMPLATE_VERSION = 1;
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
  firmOrCompany: {
    label: "Firm / Company",
    applies: p => p.constitution === "partnership" || p.constitution === "llp" || p.constitution === "company",
  },
  company: { label: "Company / LLP", applies: p => p.constitution === "company" || p.constitution === "llp" },
  tl: { label: "If TL", applies: p => p.facility === "TL" || p.facility === "CCTL" },
  cc: { label: "If CC", applies: p => p.facility === "CC" || p.facility === "CCTL" },
  collateral: { label: "If collateral", applies: p => p.collateral === true },
};

// `label` may be a function of the financial-year context (see fyContext).
export const SECTIONS = [
  {
    id: "A",
    title: "Borrower & Constitution",
    items: [
      { sr: 1, key: "loanApplication", rule: "all", label: "Loan Application Form (duly filled & signed)" },
      { sr: 2, key: "photographs", rule: "all", label: "Photographs of Proprietor / Partners / Directors / Guarantors" },
      { sr: 3, key: "panEntity", rule: "all", label: "PAN of Entity" },
      { sr: 4, key: "panAadhaarPromoters", rule: "all", label: "PAN & Aadhaar of Proprietor / Partners / Directors / Guarantors (self-attested & OSV)" },
      { sr: 5, key: "constitutionDocs", rule: "firmOrCompany", label: "Constitution Docs – Partnership Deed / LLP Agreement / MOA-AOA & Cert. of Incorporation" },
      { sr: 6, key: "boardResolution", rule: "firmOrCompany", label: "Board Resolution / Partners' Authority Letter to borrow" },
      { sr: 7, key: "udyam", rule: "all", label: "Udyam Registration Certificate" },
      { sr: 8, key: "gstRegistration", rule: "all", label: "GST Registration Certificate" },
      { sr: 9, key: "tradeLicence", rule: "all", label: "Shop & Establishment / Trade Licence" },
      { sr: 10, key: "activityLicence", rule: "optional", label: "Activity-specific Licence (FSSAI / Drug / Pollution NOC etc.)" },
      { sr: 11, key: "addressProof", rule: "all", label: "Business Address Proof – Ownership Doc / Rent Agreement + Landlord KYC + Utility Bill" },
    ],
  },
  {
    id: "B",
    title: "Due Diligence Checks",
    items: [
      { sr: 12, key: "cicEntity", rule: "all", label: "CIC Report – Entity (Commercial CIBIL / CMR Rank)" },
      { sr: 13, key: "cicPromoters", rule: "all", label: "CIC Report – All Promoters & Guarantors" },
      { sr: 14, key: "cersaiSearch", rule: "all", label: "CERSAI Search (Property / Assets)" },
      { sr: 15, key: "mca21", rule: "company", label: "MCA21 Check (Directors, Charges)" },
      { sr: 16, key: "legalSearch", rule: "all", label: "Litigation / Legal Search" },
    ],
  },
  {
    id: "C",
    title: "Financials",
    items: [
      { sr: 17, key: "itrY1", rule: "all", label: fy => `ITR with Computation – ${fyLabel(fy.audited[0], true)}` },
      { sr: 18, key: "itrY2", rule: "all", label: fy => `ITR with Computation – ${fyLabel(fy.audited[1], true)}` },
      { sr: 19, key: "itrY3", rule: "all", label: fy => `ITR with Computation – ${fyLabel(fy.audited[2], true)}` },
      { sr: 20, key: "bsY1", rule: "all", label: fy => `Balance Sheet & P&L with Schedules – ${fyLabel(fy.audited[0])} (Audited)` },
      { sr: 21, key: "bsY2", rule: "all", label: fy => `Balance Sheet & P&L with Schedules – ${fyLabel(fy.audited[1])} (Audited)` },
      { sr: 22, key: "bsY3", rule: "all", label: fy => `Balance Sheet & P&L with Schedules – ${fyLabel(fy.audited[2])} (Audited)` },
      { sr: 23, key: "bsProvisional", rule: "all", label: fy => `Balance Sheet & P&L – ${fyLabel(fy.provisional)} (Provisional / Estimated)` },
      { sr: 24, key: "bsProjected", rule: "all", label: fy => `Balance Sheet & P&L – ${fyLabel(fy.projected)} (Projected)` },
      { sr: 25, key: "taxAudit", rule: "optional", label: "Tax Audit Report (Form 3CD)" },
      { sr: 26, key: "gstReturns", rule: "all", label: "GST Returns (GSTR-3B & GSTR-1) – Last 12 Months" },
      { sr: 27, key: "bankStatements", rule: "all", label: "Bank Statements of All Accounts – Last 12 Months" },
      { sr: 28, key: "netWorth", rule: "all", label: "Net Worth Statement of Promoters & Guarantors" },
    ],
  },
  {
    id: "D",
    title: "Term Loan Specific",
    items: [
      { sr: 29, key: "quotation", rule: "tl", label: "Quotation from Authorised Dealer (Supplier GST verified)" },
      { sr: 30, key: "projectReport", rule: "tl", label: "Project Report" },
      { sr: 31, key: "meansOfFinance", rule: "tl", label: "Means of Finance & Proof of Promoter Margin" },
    ],
  },
  {
    id: "E",
    title: "Cash Credit Specific",
    items: [
      { sr: 32, key: "stockStatement", rule: "cc", label: "Latest Stock Statement" },
      { sr: 33, key: "debtorsCreditors", rule: "cc", label: "Age-wise List of Debtors & Creditors" },
    ],
  },
  {
    id: "F",
    title: "Security / Collateral",
    items: [
      { sr: 34, key: "titleSearch", rule: "collateral", label: "Title Search Report (Legal Opinion)" },
      { sr: 35, key: "valuation", rule: "collateral", label: "Valuation Report (Approved Valuer)" },
      { sr: 36, key: "cgtmse", rule: "all", label: "CGTMSE Eligibility & Coverage (Collateral-free up to ₹10 lakh for MSE)" },
    ],
  },
  {
    id: "G",
    title: "Appraisal & Inspection",
    items: [
      { sr: 37, key: "unitVisit", rule: "all", label: "Pre-Sanction Unit Visit Report (Geo-tagged Photos)" },
      { sr: 38, key: "anyOther", rule: "optional", label: "Any Other (Specify in Remarks)" },
    ],
  },
];

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

export function itemLabel(item, applicationDate) {
  if (typeof item.label !== "function") return item.label;
  const fy = fyContext(applicationDate) || { audited: [null, null, null], provisional: null, projected: null };
  return item.label(fy);
}

// ── Profile & visibility ─────────────────────────────────────────────────

export function profileOf(checklist) {
  return {
    constitution: checklist?.constitution || "",
    facility: checklist?.facility || "",
    collateral: checklist?.collateral === true ? true : checklist?.collateral === false ? false : null,
  };
}

// The items cannot be worked out until every profile question is answered.
export function isProfileComplete(checklist) {
  const p = profileOf(checklist);
  return Boolean(p.constitution) && Boolean(p.facility) && p.collateral !== null;
}

export function itemApplies(item, profile) {
  const rule = RULES[item.rule];
  return rule ? rule.applies(profile) : false;
}

// Sections with no applicable item are dropped entirely.
export function visibleSections(checklist) {
  if (!isProfileComplete(checklist)) return [];
  const profile = profileOf(checklist);
  return SECTIONS
    .map(section => ({ ...section, items: section.items.filter(item => itemApplies(item, profile)) }))
    .filter(section => section.items.length > 0);
}

// ── Status & summary ─────────────────────────────────────────────────────

export function itemStatus(checklist, item) {
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
    items: {},
    createdAt: now,
    createdBy: user || "",
    updatedAt: now,
    updatedBy: user || "",
  };
}
