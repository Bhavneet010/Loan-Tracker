import { S } from "./state.js";
import { computeRenewalStatus, isFreshCC, todayStr } from "./utils.js";

let cache = null;
let cacheLoans = null;
let cacheDay = "";

export function sumAmount(loans) {
  return loans.reduce((sum, loan) => sum + (parseFloat(loan.amount) || 0), 0);
}

export function getLoanMetrics() {
  const day = todayStr();
  if (cache && cacheLoans === S.loans && cacheDay === day) return cache;

  const thisMonth = day.slice(0, 7);
  const fresh = S.loans.filter(isFreshCC);
  const pending = fresh.filter(loan => loan.status === "pending");
  const sanctioned = fresh.filter(loan => loan.status === "sanctioned");
  const returned = fresh.filter(loan => loan.status === "returned");
  const sanctionedToday = sanctioned.filter(loan => loan.sanctionDate === day);
  const sanctionedThisMonth = sanctioned.filter(loan => (loan.sanctionDate || "").startsWith(thisMonth));
  const renewals = S.loans
    .filter(loan => loan.category === "SME" && loan.sanctionDate && !loan.isTermLoan)
    .map(loan => ({ ...loan, _rs: computeRenewalStatus(loan) }))
    .filter(loan => loan._rs);

  const renewalDoneThisMonth = renewals.filter(
    loan => (loan.renewedDate || "").startsWith(thisMonth) && !isFreshCC(loan)
  );
  const renewalDueSoon = renewals.filter(loan => loan._rs.status === "due-soon" && !loan.renewedDate);
  const renewalOverdue = renewals.filter(
    loan => (loan._rs.status === "pending-renewal" || loan._rs.status === "npa") && !loan.renewedDate
  );
  const urgentRenewals = renewals.filter(loan => loan._rs.status !== "active");

  cache = {
    day,
    thisMonth,
    fresh,
    pending,
    sanctioned,
    returned,
    sanctionedToday,
    sanctionedThisMonth,
    renewals,
    renewalDoneThisMonth,
    renewalDueSoon,
    renewalOverdue,
    urgentRenewals,
  };
  cacheLoans = S.loans;
  cacheDay = day;
  return cache;
}
