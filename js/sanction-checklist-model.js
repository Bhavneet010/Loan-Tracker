// Pre-sanction checklists: one template for SME loans (up to ₹50 lakh) and
// one for education loans. A checklist's `type` picks the template; older
// checklists have no type and are SME.
//
// SME notes —
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

// Loans store the facility as CC / TL / CC_TL; the checklist uses CC / TL /
// CCTL. Map one to the other when a checklist is created from a loan.
export function facilityFromLoanType(loanType) {
  if (loanType === "TL") return "TL";
  if (loanType === "CC_TL" || loanType === "CCTL") return "CCTL";
  return "CC";
}

export const STATUSES = ["pending", "received", "na"];

// Applicability rules. Each maps a borrower profile to "does this item apply".
// `optional` items always show but may be marked N/A by the officer.
// A loan without collateral is covered under CGTMSE, so collateral-only
// checks (CERSAI, legal search, title, valuation) use the `collateral` rule.
const RULES = {
  all: { label: "All", applies: () => true },
  optional: { label: "If applicable", applies: () => true, allowNA: true },
  rented: { label: "Rented premises", applies: p => p.rented === true },
  firmOrCompany: {
    label: "Firm / Company",
    applies: p => p.constitution === "partnership" || p.constitution === "llp" || p.constitution === "company",
  },
  company: { label: "Company / LLP", applies: p => p.constitution === "company" || p.constitution === "llp" },
  tl: { label: "If TL", applies: p => p.facility === "TL" || p.facility === "CCTL" },
  cc: { label: "If CC", applies: p => p.facility === "CC" || p.facility === "CCTL" },
  collateral: { label: "If collateral", applies: p => p.collateral === true },
  // GST returns only make sense if the borrower is GST-registered.
  gstRegistered: { label: "If GST registered", applies: p => p.gstNA !== true },
  // Education loan rules (profile from eduProfileOf).
  abroad: { label: "Study abroad", applies: p => p.abroad === true },
  abroadOptional: { label: "Study abroad, if available", applies: p => p.abroad === true, allowNA: true },
  priorDegree: { label: "If degree done", applies: p => p.priorDegree === true },
  co1Salaried: { label: "Co-applicant 1 salaried", applies: p => p.co1Work === "salaried" },
  co1Self: { label: "Co-applicant 1 self-employed", applies: p => p.co1Work === "self" },
  co1Working: { label: "Co-applicant 1 working", applies: p => p.co1Work === "salaried" || p.co1Work === "self" },
  co2: { label: "Second co-applicant", applies: p => p.secondCo === true },
  co2Optional: { label: "Second co-applicant, if applicable", applies: p => p.secondCo === true, allowNA: true },
  co2Salaried: { label: "Co-applicant 2 salaried", applies: p => p.secondCo === true && p.co2Work === "salaried" },
  co2Self: { label: "Co-applicant 2 self-employed", applies: p => p.secondCo === true && p.co2Work === "self" },
  co2Working: {
    label: "Co-applicant 2 working",
    applies: p => p.secondCo === true && (p.co2Work === "salaried" || p.co2Work === "self"),
  },
  aboveEduLimit: { label: "Above ₹7.5 lakh", applies: p => p.aboveLimit === true },
  co2AboveEduLimit: { label: "Second co-applicant, above ₹7.5 lakh", applies: p => p.secondCo === true && p.aboveLimit === true },
};

// Section B documents are pulled and attached by the credit officer, not
// received from the borrower, so its "done" state reads "Attached".
//
// Items sharing a `group` are numbered as one question with a/b/c suffixes.
// For owned premises the utility bill alone is the address proof.
//
// A `label` may be a function of the profile, so questions about people
// name only those the constitution has (see peopleFor).
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
      { key: "photographs", rule: "all", label: p => `Photographs of ${peopleFor(p)}` },
      { key: "panEntity", rule: "firmOrCompany", label: "PAN of Entity" },
      { key: "panAadhaarPromoters", rule: "all", label: p => `PAN & Aadhaar of ${peopleFor(p)} (self-attested & OSV)` },
      { key: "constitutionDocs", rule: "firmOrCompany", label: p => `Constitution Docs – ${constitutionDocsFor(p)}` },
      { key: "boardResolution", rule: "firmOrCompany", label: p => authorityToBorrowFor(p) },
      { key: "udyam", rule: "all", label: "Udyam Registration Certificate" },
      { key: "gstRegistration", rule: "optional", label: "GST Registration Certificate" },
      { key: "tradeLicence", rule: "optional", label: "Shop & Establishment / Trade Licence" },
      { key: "activityLicence", rule: "optional", label: "Activity-specific Licence (FSSAI / Drug / Pollution NOC etc.)" },
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
      { key: "cicPromoters", rule: "all", label: p => `CIC Report – ${peopleFor(p)}` },
      { key: "mca21", rule: "company", label: "MCA21 Check (Directors, Charges)" },
      { key: "assetsLiabilities", rule: "all", label: p => `Assets & Liabilities Statement of ${peopleFor(p)}` },
    ],
  },
  {
    id: "C",
    title: "Financials",
    doneLabel: "Received",
    items: [
      { key: "itrYears", rule: "all", label: "ITR with Computation", years: "itr" },
      { key: "balanceSheetYears", rule: "all", label: "Balance Sheet & P&L with Schedules", years: "bs" },
      { key: "gstReturns", rule: "gstRegistered", label: "GST Returns (GSTR-3B & GSTR-1) – Last 12 Months" },
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
      // With collateral there is no CGTMSE cover, so the security section
      // asks for the CERSAI check instead (the key is kept so earlier ticks
      // carry over from when it sat under due diligence).
      { key: "cersaiSearch", rule: "collateral", label: "CERSAI Search (Property / Assets)" },
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

// ── Education loan template ──────────────────────────────────────────────
// Student plus one or two co-applicants (parent, in-law, sibling…). Item
// keys all start with "edu" so they never clash with SME keys; the two
// co-applicants have their own keys (eduCo1…, eduCo2…) so switching the
// second one off and on again keeps its ticks.

export const EDU_COLLATERAL_LIMIT_LAKH = 7.5;

export const RELATIONS = [
  { value: "parent", label: "Parent" },
  { value: "inLaw", label: "Parent-in-law" },
  { value: "brother", label: "Brother" },
  { value: "sister", label: "Sister" },
  { value: "other", label: "Other" },
];

export const WORK_TYPES = [
  { value: "salaried", label: "Salaried" },
  { value: "self", label: "Self-employed" },
  { value: "none", label: "Not working" },
];

// "auto" follows the amount; "yes" / "no" override it, since some institutes
// need collateral at a different limit.
export const COLLATERAL_MODES = [
  { value: "auto", label: "By amount" },
  { value: "yes", label: "Required" },
  { value: "no", label: "Not required" },
];

export const relationLabel = value => RELATIONS.find(opt => opt.value === value)?.label || "";
export const workLabel = value => WORK_TYPES.find(opt => opt.value === value)?.label || "";

// Assets & liabilities statements are needed above ₹7.5 lakh. This follows
// the amount alone (no override); with no amount entered it falls back to
// whether collateral was marked required.
export function aboveEduLimit(checklist) {
  const amount = parseAmountLakh(checklist?.amountLakh);
  return amount == null ? collateralRequired(checklist) : amount > EDU_COLLATERAL_LIMIT_LAKH;
}

// true / false, or null while it cannot be told (by amount, with no amount).
export function collateralRequired(checklist) {
  const mode = checklist?.collateralMode || "auto";
  if (mode === "yes") return true;
  if (mode === "no") return false;
  const amount = parseAmountLakh(checklist?.amountLakh);
  return amount == null ? null : amount > EDU_COLLATERAL_LIMIT_LAKH;
}

function coApplicantSection(n, id) {
  const key = name => `eduCo${n}${name}`;
  const rule = n === 1
    ? { all: "all", optional: "optional", salaried: "co1Salaried", self: "co1Self", working: "co1Working" }
    : { all: "co2", optional: "co2Optional", salaried: "co2Salaried", self: "co2Self", working: "co2Working" };
  return {
    id,
    title: p => {
      const relation = relationLabel(p[`co${n}Relation`]);
      return `Co-applicant ${n}${relation ? ` – ${relation}` : ""}`;
    },
    icon: "people",
    doneLabel: "Received",
    items: [
      { key: key("Photo"), rule: rule.all, label: "Photograph" },
      { key: key("PanAadhaar"), rule: rule.all, label: "PAN & Aadhaar (self-attested)" },
      { key: key("Relation"), rule: rule.optional, label: "Proof of Relationship with Student" },
      { key: key("SalarySlips"), rule: rule.salaried, label: "Salary Slips – Last 3 Months" },
      { key: key("Form16"), rule: rule.salaried, label: "Form 16 – Last 2 Years" },
      { key: key("Employment"), rule: rule.salaried, label: "Employment Proof (ID Card / Appointment Letter)" },
      { key: key("Itr"), rule: rule.self, label: "ITR with Computation", years: "itr" },
      { key: key("BusinessProof"), rule: rule.self, label: "Business Proof (GST / Udyam / Shop Licence)" },
      {
        key: key("Bank"),
        rule: rule.working,
        label: p => (p[`co${n}Work`] === "salaried"
          ? "Bank Statement (Salary Account) – Last 6 Months"
          : "Bank Statements – Last 12 Months"),
      },
      { key: key("OtherIncome"), rule: rule.optional, label: "Other Income / Property Documents" },
    ],
  };
}

export const EDU_SECTIONS = [
  {
    id: "A",
    title: "Student",
    icon: "student",
    doneLabel: "Received",
    items: [
      { key: "eduLoanApplication", rule: "all", label: "Loan Application Form (signed by Student & Co-applicants)" },
      { key: "eduVidyalaxmi", rule: "all", label: "PM-Vidyalaxmi Portal Application" },
      { key: "eduStudentPhoto", rule: "all", label: "Photograph of Student" },
      { key: "eduStudentPanAadhaar", rule: "all", label: "PAN & Aadhaar of Student (self-attested)" },
      { key: "eduStudentAddress", rule: "optional", label: "Address Proof of Student (if different from Aadhaar)" },
    ],
  },
  coApplicantSection(1, "B"),
  coApplicantSection(2, "C"),
  {
    id: "D",
    title: "Academics",
    icon: "book",
    doneLabel: "Received",
    items: [
      { key: "edu10th", rule: "all", label: "10th Marksheet & Passing Certificate" },
      { key: "edu12th", rule: "all", label: "12th Marksheet & Passing Certificate" },
      { key: "eduDegree", rule: "priorDegree", label: "Graduation / Other Degree – Marksheets & Certificate" },
      {
        key: "eduEntrance",
        rule: "optional",
        label: p => (p.abroad
          ? "Test Scorecard (GRE / GMAT / IELTS / TOEFL)"
          : "Entrance Exam Scorecard (JEE / NEET / CAT etc.)"),
      },
      { key: "eduGap", rule: "optional", label: "Gap Certificate / Affidavit for Gap in Studies" },
    ],
  },
  {
    id: "E",
    title: "Admission & Costs",
    icon: "school",
    doneLabel: "Received",
    items: [
      { key: "eduAdmission", rule: "all", label: "Admission / Offer Letter" },
      { key: "eduFeeStructure", rule: "all", label: "Detailed Fee Structure (from the Institute)" },
      { key: "eduFeeReceipts", rule: "optional", label: "Receipts of Fees Already Paid" },
      { key: "eduScholarship", rule: "optional", label: "Scholarship Letter" },
    ],
  },
  {
    id: "F",
    title: "Study Abroad",
    icon: "plane",
    doneLabel: "Received",
    items: [
      { key: "eduPassport", rule: "abroad", label: "Passport of Student" },
      { key: "eduI20", rule: "abroad", label: "I-20 / CAS / Confirmation of Enrolment" },
      { key: "eduFxCost", rule: "abroad", label: "Cost Sheet in INR (at current Exchange Rate)" },
      { key: "eduVisa", rule: "abroadOptional", label: "Student Visa (if already issued)" },
    ],
  },
  {
    id: "G",
    title: "Due Diligence Checks",
    icon: "search",
    doneLabel: "Attached",
    items: [
      { key: "eduCicStudent", rule: "all", label: "CIC Report – Student" },
      { key: "eduCicCo1", rule: "all", label: "CIC Report – Co-applicant 1" },
      { key: "eduCicCo2", rule: "co2", label: "CIC Report – Co-applicant 2" },
      { key: "eduResidenceVisit", rule: "all", label: "Pre-Sanction Visit Report – Residence (Geo-tagged Photos)" },
      { key: "eduWorkVisitCo1", rule: "co1Working", label: "Pre-Sanction Visit Report – Workplace of Co-applicant 1" },
      { key: "eduWorkVisitCo2", rule: "co2Working", label: "Pre-Sanction Visit Report – Workplace of Co-applicant 2" },
      { key: "eduAlStudent", rule: "aboveEduLimit", label: "Assets & Liabilities Statement – Student" },
      { key: "eduAlCo1", rule: "aboveEduLimit", label: "Assets & Liabilities Statement – Co-applicant 1" },
      { key: "eduAlCo2", rule: "co2AboveEduLimit", label: "Assets & Liabilities Statement – Co-applicant 2" },
    ],
  },
  {
    id: "H",
    title: "Security / Collateral",
    icon: "lock",
    doneLabel: "Received",
    items: [
      { key: "eduPropertyDocs", rule: "collateral", label: "Property Title Deeds & Chain Documents" },
      { key: "eduTitleSearch", rule: "collateral", label: "Title Search Report (Legal Opinion)" },
      { key: "eduValuation", rule: "collateral", label: "Valuation Report (Approved Valuer)" },
      { key: "eduCersai", rule: "collateral", label: "CERSAI Search (Property)" },
    ],
  },
];

export const EDU_ALL_ITEMS = EDU_SECTIONS.flatMap(section => section.items);

const yesNoOf = value => (value === true ? true : value === false ? false : null);

function eduProfileOf(checklist) {
  return {
    abroad: yesNoOf(checklist?.studyAbroad),
    priorDegree: yesNoOf(checklist?.priorDegree),
    co1Relation: checklist?.co1Relation || "",
    co1Work: checklist?.co1Work || "",
    secondCo: yesNoOf(checklist?.secondCoApplicant),
    co2Relation: checklist?.co2Relation || "",
    co2Work: checklist?.co2Work || "",
    collateral: collateralRequired(checklist),
    aboveLimit: aboveEduLimit(checklist),
  };
}

function eduProfileComplete(checklist) {
  const p = eduProfileOf(checklist);
  return p.abroad !== null && p.priorDegree !== null && Boolean(p.co1Relation) && Boolean(p.co1Work)
    && p.secondCo !== null && (p.secondCo === false || (Boolean(p.co2Relation) && Boolean(p.co2Work)))
    && p.collateral !== null;
}

function eduHiddenReasons(checklist) {
  const mode = checklist?.collateralMode || "auto";
  return {
    C: "no second co-applicant",
    F: "studying in India",
    H: mode === "no" ? "marked not required" : `up to ₹${EDU_COLLATERAL_LIMIT_LAKH} lakh`,
  };
}

// Short keyword per item, for the "pending docs" snippet on the loan card and
// the branch reminder mail. Keep them terse — a glanceable tag, not a sentence.
const SHORT = {
  loanApplication: "Loan form", photographs: "Photos", panEntity: "Entity PAN",
  panAadhaarPromoters: "KYC", constitutionDocs: "Constitution", boardResolution: "Board res.",
  udyam: "Udyam", gstRegistration: "GST cert", tradeLicence: "Trade lic.",
  activityLicence: "Activity lic.", rentAgreement: "Address proof", landlordKyc: "Address proof",
  utilityBill: "Address proof", cicEntity: "CIBIL (entity)", cicPromoters: "CIBIL",
  mca21: "MCA21", assetsLiabilities: "Assets/Liab.", itrYears: "ITR",
  balanceSheetYears: "B/S", gstReturns: "GST returns", bankStatements: "Bank stmt",
  quotation: "Quotation", projectReport: "Project rep.", meansOfFinance: "Margin proof",
  stockStatement: "Stock stmt", debtorsCreditors: "Debtors list", titleSearch: "Title search",
  valuation: "Valuation", cersaiSearch: "CERSAI", unitVisit: "Unit visit", anyOther: "Other",
  // Education loans
  eduLoanApplication: "Loan form", eduVidyalaxmi: "Vidyalaxmi", eduStudentPhoto: "Student photo",
  eduStudentPanAadhaar: "Student KYC", eduStudentAddress: "Student address",
  eduCo1Photo: "Co-app photo", eduCo1PanAadhaar: "Co-app KYC", eduCo1Relation: "Relation proof",
  eduCo1SalarySlips: "Salary slips", eduCo1Form16: "Form 16", eduCo1Employment: "Job proof",
  eduCo1Itr: "Co-app ITR", eduCo1BusinessProof: "Business proof", eduCo1Bank: "Co-app bank stmt",
  eduCo1OtherIncome: "Other income",
  eduCo2Photo: "Co-app 2 photo", eduCo2PanAadhaar: "Co-app 2 KYC", eduCo2Relation: "Co-app 2 relation",
  eduCo2SalarySlips: "Co-app 2 slips", eduCo2Form16: "Co-app 2 Form 16", eduCo2Employment: "Co-app 2 job proof",
  eduCo2Itr: "Co-app 2 ITR", eduCo2BusinessProof: "Co-app 2 business", eduCo2Bank: "Co-app 2 bank stmt",
  eduCo2OtherIncome: "Co-app 2 other income",
  edu10th: "10th", edu12th: "12th", eduDegree: "Degree", eduEntrance: "Scorecard", eduGap: "Gap cert.",
  eduAdmission: "Admission letter", eduFeeStructure: "Fee structure", eduFeeReceipts: "Fee receipts",
  eduScholarship: "Scholarship", eduPassport: "Passport", eduI20: "I-20/CAS", eduFxCost: "Cost sheet",
  eduVisa: "Visa", eduCicStudent: "CIBIL (student)", eduCicCo1: "CIBIL (co-app)", eduCicCo2: "CIBIL (co-app 2)",
  eduResidenceVisit: "Residence visit", eduWorkVisitCo1: "Workplace visit", eduWorkVisitCo2: "Co-app 2 workplace visit",
  eduAlStudent: "Student Assets/Liab.", eduAlCo1: "Co-app Assets/Liab.", eduAlCo2: "Co-app 2 Assets/Liab.",
  eduPropertyDocs: "Property docs", eduTitleSearch: "Title search", eduValuation: "Valuation", eduCersai: "CERSAI",
};
export const shortTag = key => SHORT[key] || key;

// Pending items in display order. `branch` marks items the branch/borrower
// supplies (so a branch reminder can list them); Section B is pulled by the
// credit officer ("Attached"), so those are not the branch's to chase.
export function pendingItems(checklist) {
  const out = [];
  for (const section of visibleSections(checklist)) {
    const branch = (section.doneLabel || "Received") !== "Attached";
    for (const item of section.items) {
      if (itemStatus(checklist, item) !== "pending") continue;
      out.push({ key: item.key, short: shortTag(item.key), branch });
    }
  }
  return out;
}

// De-duplicated short tags of the pending items (e.g. the three address proofs
// collapse to one "Address proof"). `branchOnly` keeps just the branch's docs.
export function pendingTags(checklist, { branchOnly = false } = {}) {
  const seen = new Set();
  const tags = [];
  for (const item of pendingItems(checklist)) {
    if (branchOnly && !item.branch) continue;
    if (seen.has(item.short)) continue;
    seen.add(item.short);
    tags.push(item.short);
  }
  return tags;
}

export const ruleLabel = rule => RULES[rule]?.label || rule;
export const allowsNA = item => Boolean(RULES[item.rule]?.allowNA);
// Who the KYC questions are about, by constitution.
const PEOPLE = {
  proprietorship: "Proprietor & Guarantors",
  partnership: "Partners & Guarantors",
  llp: "Designated Partners & Guarantors",
  company: "Directors & Guarantors",
};
export function peopleFor(profile) {
  return PEOPLE[profile?.constitution] || "Proprietor / Partners / Directors & Guarantors";
}

// Constitution documents and the authority to borrow, by constitution.
const CONSTITUTION_DOCS = {
  partnership: "Partnership Deed",
  llp: "LLP Agreement & Certificate of Incorporation",
  company: "MOA, AOA & Certificate of Incorporation",
};
const AUTHORITY_TO_BORROW = {
  partnership: "Partners' Authority Letter to borrow",
  llp: "Partners' Resolution / Authority Letter to borrow",
  company: "Board Resolution to borrow",
};
export function constitutionDocsFor(profile) {
  return CONSTITUTION_DOCS[profile?.constitution] || "Partnership Deed / LLP Agreement / MOA-AOA & Cert. of Incorporation";
}
export function authorityToBorrowFor(profile) {
  return AUTHORITY_TO_BORROW[profile?.constitution] || "Board Resolution / Partners' Authority Letter to borrow";
}

// Labels are resolved for the profile by visibleSections; this also copes
// with a raw template item.
export const itemLabel = (item, profile) => (typeof item.label === "function" ? item.label(profile || {}) : item.label);
export const sectionTitle = (section, profile) => (typeof section.title === "function" ? section.title(profile || {}) : section.title);

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

const yesNo = yesNoOf;

export const LOAN_TYPES = [
  { value: "sme", label: "SME" },
  { value: "education", label: "Education" },
];

// Checklists made before education loans existed have no type: they are SME.
export const checklistType = checklist => (checklist?.type === "education" ? "education" : "sme");
export const isEducation = checklist => checklistType(checklist) === "education";
export const sectionsFor = checklist => (isEducation(checklist) ? EDU_SECTIONS : SECTIONS);
export const allItemsFor = checklist => (isEducation(checklist) ? EDU_ALL_ITEMS : ALL_ITEMS);

// Whole sections that are hidden, with the reason, for the note under the
// checklist and in the PDF.
export function hiddenSections(checklist, sections = visibleSections(checklist)) {
  const reasons = isEducation(checklist) ? eduHiddenReasons(checklist) : HIDDEN_SECTION_REASONS;
  const shown = new Set(sections.map(section => section.id));
  // Plain title: a hidden co-applicant's old relation would only confuse.
  return Object.keys(reasons)
    .filter(id => !shown.has(id))
    .map(id => ({
      id,
      title: sectionTitle(sectionsFor(checklist).find(section => section.id === id), {}),
      reason: reasons[id],
    }));
}

export function profileOf(checklist) {
  if (isEducation(checklist)) return eduProfileOf(checklist);
  return {
    constitution: checklist?.constitution || "",
    facility: checklist?.facility || "",
    collateral: yesNo(checklist?.collateral),
    rented: yesNo(checklist?.rented),
    // An answer inside the checklist that hides another question.
    gstNA: checklist?.items?.gstRegistration?.status === "na",
  };
}

// The items cannot be worked out until every profile question is answered.
export function isProfileComplete(checklist) {
  if (isEducation(checklist)) return eduProfileComplete(checklist);
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
  return numberSections(sectionsFor(checklist)
    .map(section => ({
      ...section,
      title: sectionTitle(section, profile),
      items: section.items
        .filter(item => itemApplies(item, profile))
        .map(item => ({ ...item, label: itemLabel(item, profile) })),
    }))
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

export function newChecklist({ today, user, type } = {}) {
  if (type === "education") return newEducationChecklist({ today, user });
  const now = new Date().toISOString();
  return {
    type: "sme",
    templateVersion: TEMPLATE_VERSION,
    borrowerName: "",
    facility: "",
    amountLakh: null,
    // Set when the checklist is created from a pending SME loan; null for a
    // standalone checklist made from the admin menu.
    loanId: null,
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

// Education checklists keep the student's name in `borrowerName`, so the
// admin list and the loan link work the same for both types.
export function newEducationChecklist({ today, user } = {}) {
  const now = new Date().toISOString();
  return {
    type: "education",
    templateVersion: TEMPLATE_VERSION,
    borrowerName: "",
    course: "",
    amountLakh: null,
    loanId: null,
    referenceDate: today || now.slice(0, 10),
    studyAbroad: null,
    priorDegree: null,
    co1Relation: "",
    co1Work: "",
    secondCoApplicant: null,
    co2Relation: "",
    co2Work: "",
    collateralMode: "auto",
    items: {},
    createdAt: now,
    createdBy: user || "",
    updatedAt: now,
    updatedBy: user || "",
  };
}

// ── Report (what the PDF export prints) ──────────────────────────────────
// Only the items that apply are listed, in the same order and numbering as
// on screen. Year-wise questions carry one line per financial year.

const STATUS_WORD = { received: null, pending: "Pending", na: "N/A" };

export function checklistReport(checklist) {
  const sections = visibleSections(checklist);
  return {
    summary: summarize(checklist, sections),
    hidden: hiddenSections(checklist, sections),
    sections: sections.map(section => {
      const doneLabel = section.doneLabel || "Received";
      const word = status => STATUS_WORD[status] || doneLabel;
      const sum = sectionSummary(checklist, section);
      return {
        id: section.id,
        title: section.title,
        doneLabel,
        received: sum.received,
        applicable: sum.applicable,
        rows: section.items.map(item => {
          const status = itemStatus(checklist, item);
          const row = {
            no: item.no,
            label: item.label,
            status,
            statusLabel: word(status),
            remark: checklist?.items?.[item.key]?.remark || "",
          };
          if (item.years) {
            const progress = yearProgress(checklist, item);
            row.statusLabel = status === "pending" ? `${progress.done}/${progress.total}` : word(status);
            row.years = yearRows(checklist, item).map(entry => ({
              label: `${fyLabel(entry.year)}${item.years === "itr" ? ` (${ayLabel(entry.year)})` : ` – ${bsStage(checklist, entry.year)}`}`,
              status: entry.status,
              statusLabel: word(entry.status),
            }));
          }
          return row;
        }),
      };
    }),
  };
}
