// Which officer a renewal account belongs to for its NEXT renewal.
//
// A month-scoped manual officer (manualOfficer + manualOfficerMonth) marks the
// officer who took a renewal on outside their own branch. That covers the
// renewal they are handling — once it is done the account is the branch
// officer's again, so the next cycle is never counted against whoever happened
// to renew it last. The completed renewal itself stays credited to the officer
// who did it through effectiveOfficer(), which the done-this-month, month-end
// and performance views use.
export function renewalAccountOfficer(loan, branchOfficer, monthKey) {
  const l = loan || {};
  const override = l.manualOfficer && l.manualOfficerMonth === monthKey ? l.manualOfficer : '';
  if (override && !isOverrideSpent(l)) return override;
  return renewalBranchOwner(l, branchOfficer);
}

// The officer the branch itself is allocated to, ignoring any override: the
// officer breakdown counts every account against its branch, whoever is
// covering a renewal on it this month.
export function renewalBranchOwner(loan, branchOfficer) {
  const l = loan || {};
  return branchOfficer || l.allocatedTo || l.manualOfficer || 'Unassigned';
}

// The override is spent once the renewal it was set for has been completed.
// A renewedDate left over from an earlier cycle (integration still pending)
// predates the override, so it leaves the override standing.
function isOverrideSpent(loan) {
  if (!loan.renewedDate) return false;
  return String(loan.renewedDate).slice(0, 7) >= String(loan.manualOfficerMonth || '');
}
