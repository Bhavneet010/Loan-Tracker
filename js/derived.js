import { S } from "./state.js";
import { branchCode, computeRenewalStatus, isFreshCC, isRenewalDatesMissing, isStageTracked, monthOf, todayStr } from "./utils.js";

function currentMonthKey() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 7);
}

// Manual allocations are month-scoped: pass a monthKey to resolve the officer
// as of that month (e.g. month-end snapshots), otherwise the current month is
// used and expired overrides fall back to the branch allocation.
export function effectiveOfficer(loan, monthKey = currentMonthKey()) {
  if (loan.manualOfficer && loan.manualOfficerMonth === monthKey) {
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
  // Documentation/disbursement stages are tracked for SME loans only
  const docPendingFresh = freshSanctionedAll.filter(
    loan => loan.category === "SME" && isStageTracked(loan.sanctionDate) && !loan.documentationDate
  );
  const disbPending = freshSanctionedAll.filter(
    loan => loan.category === "SME" && isStageTracked(loan.sanctionDate) && loan.documentationDate && !loan.disbursementDate
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
  // Renewals done that month-end cleanup has not swept yet, so an export taken
  // before cleanup still carries last month's work. A renewedDate alone is not
  // enough: cleanup clears it only for the accounts it sweeps, and the ones it
  // deliberately skips (integration or documentation pending) keep theirs for
  // good, which would drag long-cleaned months back into the count. Cleanup
  // stamps the month it ran for onto every loan it touches, so anything renewed
  // after the latest cleaned month is what is genuinely still awaiting cleanup.
  const lastCleanedMonth = lastMonthEndCleanedMonth();
  const renewalDonePendingCleanup = renewals.filter(
    loan =>
      loan.renewedDate &&
      !isFreshCC(loan) &&
      (monthOf(loan.renewedDate) > lastCleanedMonth || monthOf(loan.renewedDate) === thisMonth)
  );
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
    renewalDonePendingCleanup,
    renewalDatesMissing,
    renewalDueSoon,
    renewalOverdue,
    urgentRenewals,
    renewalOfficerSummary,
  };
}

// Cleanup writes the month it ran for onto the renewals it clears
// (monthEndClearedMonth) and onto the sanctions it carries forward
// (monthEndCleared), so the newest of those markers is the last month that was
// actually cleaned up.
function lastMonthEndCleanedMonth() {
  return S.loans.reduce((latest, loan) => {
    const marker = loan.monthEndClearedMonth || loan.monthEndCleared || "";
    return marker > latest ? marker : latest;
  }, "");
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
