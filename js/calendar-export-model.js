export const CALENDAR_MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTH_KEY_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function normalizeMonthKeys(monthKeys) {
  if (!Array.isArray(monthKeys)) return [];
  return [...new Set(
    monthKeys.filter(key => typeof key === "string" && MONTH_KEY_PATTERN.test(key)),
  )].sort();
}

export function buildRenewalMonthSections(renewals, monthKeys) {
  const sections = normalizeMonthKeys(monthKeys).map(key => {
    const [year, monthNumber] = key.split("-").map(Number);
    return {
      key,
      year,
      month: monthNumber - 1,
      monthName: CALENDAR_MONTH_NAMES[monthNumber - 1],
      loans: [],
      rnpLoans: [],
    };
  });
  const sectionsByKey = new Map(sections.map(section => [section.key, section]));

  (Array.isArray(renewals) ? renewals : []).forEach(loan => {
    const key = loan?._rs?.npaDateStr?.slice(0, 7);
    const section = sectionsByKey.get(key);
    if (!section) return;
    const deferred = loan.renewalNotPossible === true && loan._rs?.status !== "npa";
    (deferred ? section.rnpLoans : section.loans).push(loan);
  });

  const byNpaDate = (a, b) => (a?._rs?.npaDateStr || "").localeCompare(b?._rs?.npaDateStr || "");
  sections.forEach(section => {
    section.loans.sort(byNpaDate);
    section.rnpLoans.sort(byNpaDate);
  });

  return sections;
}

export function buildMultiMonthExportFilename(monthKeys, extension) {
  const keys = normalizeMonthKeys(monthKeys);
  if (!keys.length) throw new TypeError("At least one valid month is required");
  if (extension !== "xlsx" && extension !== "pdf") {
    throw new TypeError("Unsupported export extension");
  }

  const tokens = keys.map(key => {
    const [year, monthNumber] = key.split("-").map(Number);
    return {
      year,
      month: CALENDAR_MONTH_NAMES[monthNumber - 1].slice(0, 3).toLowerCase(),
    };
  });
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  const sameYear = tokens.every(token => token.year === first.year);
  const descriptor = sameYear && tokens.length <= 4
    ? `${tokens.map(token => token.month).join("-")}-${first.year}`
    : `${first.month}-${first.year}-to-${last.month}-${last.year}-${tokens.length}-months`;

  return `nirnay-pending-renewals-${descriptor}.${extension}`;
}
