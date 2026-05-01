import { S } from "./state.js";
import { computeRenewalStatus, isFreshCC, isRenewalDatesMissing, todayStr } from "./utils.js";

let cache = null;
let cacheLoans = null;
let cacheDay = "";
let cacheSettingsKey = "";

export function sumAmount(loans) {
  return loans.reduce((sum, loan) => sum + (parseFloat(loan.amount) || 0), 0);
}

export function getLoanMetrics() {
  const day = todayStr();
  const settingsKey = S.officers.join("|");
  if (cache && cacheLoans === S.loans && cacheDay === day && cacheSettingsKey === settingsKey) return cache;

  cache = buildLoanMetricsForMonth(day.slice(0, 7), day);
  cacheLoans = S.loans;
  cacheDay = day;
  cacheSettingsKey = settingsKey;
  return cache;
}

export function getLoanMetricsForMonth(month, day = todayStr()) {
  return buildLoanMetricsForMonth(month || day.slice(0, 7), day);
}

function buildLoanMetricsForMonth(thisMonth, day) {
  const fresh = S.loans.filter(isFreshCC);
  const pending = fresh.filter(loan => loan.status === "pending");
  const sanctioned = fresh.filter(loan => loan.status === "sanctioned");
  const returned = fresh.filter(loan => loan.status === "returned");
  const sanctionedToday = sanctioned.filter(loan => loan.sanctionDate === day);
  const sanctionedThisMonth = sanctioned.filter(loan => (loan.sanctionDate || "").startsWith(thisMonth));
  const returnedThisMonth = returned.filter(loan => (loan.returnedDate || "").startsWith(thisMonth));
  const renewals = S.loans
    .filter(loan => loan.category === "SME" && loan.sanctionDate && !loan.isTermLoan)
    .map(loan => ({ ...loan, _rs: computeRenewalStatus(loan) }))
    .filter(loan => loan._rs);

  const renewalDoneThisMonth = renewals.filter(
    loan => loan.renewedDate && (loan.sanctionDate || "").startsWith(thisMonth) && !isFreshCC(loan)
  );
  const renewalDoneToday = renewalDoneThisMonth.filter(loan => loan.sanctionDate === day);
  const renewalDatesMissing = renewals.filter(isRenewalDatesMissing);
  const renewalDueSoon = renewals.filter(loan => loan._rs.status === "due-soon" && !loan.renewedDate);
  const renewalOverdue = renewals.filter(
    loan => (loan._rs.status === "pending-renewal" || loan._rs.status === "npa") && !loan.renewedDate
  );
  const urgentRenewals = renewals.filter(loan => loan._rs.status !== "active");
  const renewalOfficerRows = buildRenewalOfficerRows(renewals, renewalDueSoon, renewalOverdue);
  const renewalOfficerSummary = {
    activeOfficers: renewalOfficerRows.filter(row => row.total > 0).length,
    total: renewals.length,
    od: renewalOverdue.length,
    due: renewalDueSoon.length,
    rows: renewalOfficerRows,
  };

  return {
    day,
    thisMonth,
    fresh,
    pending,
    sanctioned,
    returned,
    returnedThisMonth,
    sanctionedToday,
    sanctionedThisMonth,
    renewals,
    renewalDoneThisMonth,
    renewalDoneToday,
    renewalDatesMissing,
    renewalDueSoon,
    renewalOverdue,
    urgentRenewals,
    renewalOfficerSummary,
  };
}

function buildRenewalOfficerRows(renewals, dueSoon, overdue) {
  const byOfficer = new Map();
  S.officers.forEach(officer => {
    byOfficer.set(officer, { officer, total: 0, od: 0, due: 0 });
  });

  const ensure = officer => {
    const key = officer || "Unassigned";
    if (!byOfficer.has(key)) byOfficer.set(key, { officer: key, total: 0, od: 0, due: 0 });
    return byOfficer.get(key);
  };

  renewals.forEach(loan => ensure(loan.allocatedTo).total++);
  dueSoon.forEach(loan => ensure(loan.allocatedTo).due++);
  overdue.forEach(loan => ensure(loan.allocatedTo).od++);

  return Array.from(byOfficer.values()).sort((a, b) =>
    (b.od - a.od) || (b.due - a.due) || (b.total - a.total) || a.officer.localeCompare(b.officer)
  );
}
