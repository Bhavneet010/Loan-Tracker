import { S } from "./state.js";
import { branchCode, computeRenewalStatus, isFreshCC, isRenewalDatesMissing, isStageTracked, todayStr } from "./utils.js";

function currentMonthKey() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 7);
}

export function effectiveOfficer(loan) {
  if (loan.manualOfficer && loan.manualOfficerMonth === currentMonthKey()) {
    return loan.manualOfficer;
  }
  const code = branchCode(loan.branch || '').trim();
  return (code && S.branchOfficers?.[code]) || loan.allocatedTo || 'Unassigned';
}

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
  // monthEndCleared loans already left the Sanctioned tab at cleanup; they only
  // live on in Critical Care until their disbursement is marked done.
  const freshSanctionedAll = fresh.filter(loan => loan.status === "sanctioned");
  const sanctioned = freshSanctionedAll.filter(loan => !loan.monthEndCleared);
  const returned = fresh.filter(loan => loan.status === "returned");
  const docPendingFresh = freshSanctionedAll.filter(
    loan => isStageTracked(loan.sanctionDate) && !loan.documentationDate
  );
  const disbPending = freshSanctionedAll.filter(
    loan => isStageTracked(loan.sanctionDate) && loan.documentationDate && !loan.disbursementDate
  );
  const sanctionedToday = sanctioned.filter(loan => loan.sanctionDate === day);
  const sanctionedThisMonth = sanctioned.filter(loan => (loan.sanctionDate || "").startsWith(thisMonth));
  const returnedThisMonth = returned.filter(loan => (loan.returnedDate || "").startsWith(thisMonth));
  const renewals = S.loans
    .filter(loan => loan.category === "SME" && loan.sanctionDate && !loan.isTermLoan)
    .map(loan => ({ ...loan, _rs: computeRenewalStatus(loan) }))
    .filter(loan => loan._rs);

  const renewalDoneThisMonth = renewals.filter(
    loan => (loan.renewedDate || "").startsWith(thisMonth) && !isFreshCC(loan)
  );
  const renewalDoneToday = renewalDoneThisMonth.filter(loan => loan.renewedDate === day);
  const docPendingRenewals = renewals.filter(
    loan => !isFreshCC(loan) && loan.renewedDate && isStageTracked(loan.renewedDate) && !loan.documentationDate
  );
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
    docPendingFresh,
    docPendingRenewals,
    disbPending,
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

  renewals.forEach(loan => ensure(effectiveOfficer(loan)).total++);
  dueSoon.forEach(loan => ensure(effectiveOfficer(loan)).due++);
  overdue.forEach(loan => ensure(effectiveOfficer(loan)).od++);

  return Array.from(byOfficer.values()).sort((a, b) =>
    (b.od - a.od) || (b.due - a.due) || (b.total - a.total) || a.officer.localeCompare(b.officer)
  );
}
