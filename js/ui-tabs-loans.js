import { S } from "./state.js";
import { fmtAmt, isFreshCC, daysPending } from "./utils.js";
import { emptyState, compactLoanItem } from "./ui-components.js";
import { applyFilters, applySort, searchMatch, filterSortBarHtml } from "./ui-logic.js";

export function renderPending(c) {
  let loans = applyFilters(S.loans.filter(l => l.status === 'pending' && isFreshCC(l) && searchMatch(l)));
  loans = applySort(loans);
  const total = loans.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const cards = loans.length === 0
    ? emptyState('📭', 'No pending loans', 'Tap + to add a new loan')
    : loans.map(l => {
      const days = daysPending(l.receiveDate);
      const actions = `<button class="btn btn-sanction" onclick="sanctionLoan('${l.id}')">✓ Sanction</button>
        <button class="btn btn-return" onclick="returnLoan('${l.id}')">↩ Return</button>
        <button class="btn btn-more" onclick="editLoan('${l.id}')">✎</button>
        ${S.isAdmin ? `<button class="btn btn-danger" onclick="deleteLoan('${l.id}')">🗑</button>` : ''}`;
      return compactLoanItem(l, actions, days > 7 ? 'overdue' : '');
    }).join('');
    
  c.innerHTML = `${filterSortBarHtml()}<div class="sec-head"><div class="sec-title">Pending Loans</div><div class="sec-count">${loans.length} · ₹${fmtAmt(total)} L</div></div>${cards}`;
}

export function renderSanctioned(c) {
  let loans = applyFilters(S.loans.filter(l => l.status === 'sanctioned' && isFreshCC(l) && searchMatch(l)));
  loans = applySort(loans);
  const total = loans.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const cards = loans.length === 0
    ? emptyState('🎉', 'No sanctioned loans yet', 'Sanction pending loans to see them here')
    : loans.map(l => {
      const actions = `<button class="btn btn-return" onclick="moveToPending('${l.id}')">↩ Pending</button>
        <button class="btn btn-more" onclick="editLoan('${l.id}')">✎</button>
        ${S.isAdmin ? `<button class="btn btn-danger" onclick="deleteLoan('${l.id}')">🗑</button>` : ''}`;
      return compactLoanItem(l, actions, '', 'sanctioned');
    }).join('');
    
  c.innerHTML = `${filterSortBarHtml()}<div class="sec-head"><div class="sec-title">Sanctioned Loans</div><div class="sec-count">${loans.length} · ₹${fmtAmt(total)} L</div></div>${cards}`;
}

export function renderReturned(c) {
  let loans = applyFilters(S.loans.filter(l => l.status === 'returned' && isFreshCC(l) && searchMatch(l)));
  loans = applySort(loans);
  const total = loans.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const cards = loans.length === 0
    ? emptyState('📋', 'No returned loans', 'Returned loans will appear here')
    : loans.map(l => {
      const actions = `<button class="btn btn-sanction" onclick="sanctionLoan('${l.id}')">✓ Sanction</button>
        <button class="btn btn-return" onclick="moveToPending('${l.id}')">↩ Pending</button>
        <button class="btn btn-more" onclick="editLoan('${l.id}')">✎</button>
        ${S.isAdmin ? `<button class="btn btn-danger" onclick="deleteLoan('${l.id}')">🗑</button>` : ''}`;
      return compactLoanItem(l, actions, '', 'returned');
    }).join('');
    
  c.innerHTML = `${filterSortBarHtml()}<div class="sec-head"><div class="sec-title">Returned Loans</div><div class="sec-count">${loans.length} · ₹${fmtAmt(total)} L</div></div>${cards}`;
}
