import { S } from "./state.js";
import { getLoanMetrics, sumAmount, effectiveOfficer } from "./derived.js";
import { fmtAmt, daysPending, esc, officerColor, initials, catCls } from "./utils.js";
import { emptyState, compactLoanItem } from "./ui-components.js";
import { applyFilters, applySort, searchMatch, filterSortBarHtml } from "./ui-logic.js";

function copyAction(id) {
  return `<button class="btn btn-outline" onclick="duplicateLoan('${id}')">Copy</button>`;
}

function statusAction(id) {
  return `<button class="btn btn-sanction" onclick="openLoanDecisionSheet('${id}')">Status</button>`;
}

function freshGroupMode() {
  return S.isAdmin ? S.freshGroupMode : 'category';
}

function freshGroupToggleHtml() {
  if (!S.isAdmin) return '';
  const m = S.freshGroupMode;
  return `<div class="fresh-group-toggle" role="group" aria-label="Group loans by" onclick="event.stopPropagation();">
    <button type="button" class="${m === 'officer' ? 'active' : ''}" onclick="setFreshGroupMode('officer')">Officer</button>
    <button type="button" class="${m === 'category' ? 'active' : ''}" onclick="setFreshGroupMode('category')">Category</button>
  </div>`;
}

function buildFreshGroups(loans) {
  const mode = freshGroupMode();
  const order = mode === 'category'
    ? ['SME', 'Agriculture', 'Education']
    : [...S.officers, 'Unassigned'];
  const keyOf = mode === 'category'
    ? l => (order.includes(l.category) ? l.category : 'Other')
    : l => effectiveOfficer(l);

  const map = new Map();
  loans.forEach(l => {
    const key = keyOf(l);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(l);
  });
  const keys = [...order.filter(k => map.has(k)), ...[...map.keys()].filter(k => !order.includes(k))];
  return keys.map(key => {
    let groupLoans = map.get(key);
    if (mode === 'category') {
      groupLoans = [...groupLoans].sort((a, b) => effectiveOfficer(a).localeCompare(effectiveOfficer(b)));
    }
    return { key, loans: groupLoans };
  });
}

function freshGroupsHtml(loans, itemHtml) {
  const mode = freshGroupMode();
  let idx = 0;
  return buildFreshGroups(loans).map(({ key, loans: groupLoans }) => {
    const stored = S.freshGroupCollapsed?.[key];
    const collapsed = stored !== undefined ? !!stored : S.isAdmin;
    const total = sumAmount(groupLoans);
    const marker = mode === 'category'
      ? `<span class="grp-dot ${catCls(key) || 'none'}"></span>`
      : `<span class="grp-av" style="background:${officerColor(key).bg};">${initials(key)}</span>`;
    const items = groupLoans.map(l => itemHtml(l, idx++)).join('');
    return `<div class="loan-group ${collapsed ? 'collapsed' : ''}">
      <button type="button" class="loan-group-head" onclick="toggleFreshGroup('${esc(key)}')" aria-expanded="${!collapsed}">
        ${marker}<span class="loan-group-title">${esc(key)}</span>
        <span class="loan-group-count">${groupLoans.length} · <span class="rs">&#8377;</span>${fmtAmt(total)} L</span>
        <span class="loan-group-caret">${collapsed ? '&#9660;' : '&#9650;'}</span>
      </button>
      <div class="loan-group-body">${items}</div>
    </div>`;
  }).join('');
}

export function renderPending(c) {
  let loans = applyFilters(getLoanMetrics().pending.filter(searchMatch));
  loans = applySort(loans);
  const total = sumAmount(loans);
  const cards = loans.length === 0
    ? emptyState('&#128237;', 'No pending loans', 'Tap + to add a new loan')
    : freshGroupsHtml(loans, (l, idx) => {
      const days = daysPending(l.receiveDate);
      const actions = `${statusAction(l.id)}
        ${copyAction(l.id)}
        <button class="btn btn-more" onclick="editLoan('${l.id}')">&#9998;</button>
        ${S.isAdmin ? `<button class="btn btn-danger" onclick="deleteLoan('${l.id}')">&#128465;</button>` : ''}`;
      return compactLoanItem(l, actions, days > 7 ? 'overdue' : '', '', idx);
    });

  c.innerHTML = `${filterSortBarHtml()}<div class="sec-head"><div class="sec-title">Pending Loans</div><div class="sec-right">${freshGroupToggleHtml()}<div class="sec-count">${loans.length} · <span class="rs">&#8377;</span>${fmtAmt(total)} L</div><button class="sec-collapse-btn" onclick="collapseAll()" style="display:none">&#9650; collapse all</button></div></div>${cards}`;
}

export function renderSanctioned(c) {
  let loans = applyFilters(getLoanMetrics().sanctioned.filter(searchMatch));
  loans = applySort(loans);
  const total = sumAmount(loans);
  const cards = loans.length === 0
    ? emptyState('&#127881;', 'No sanctioned loans yet', 'Sanction pending loans to see them here')
    : freshGroupsHtml(loans, (l, idx) => {
      const actions = `${statusAction(l.id)}
        ${copyAction(l.id)}
        <button class="btn btn-more" onclick="editLoan('${l.id}')">&#9998;</button>
        ${S.isAdmin ? `<button class="btn btn-danger" onclick="deleteLoan('${l.id}')">&#128465;</button>` : ''}`;
      return compactLoanItem(l, actions, '', 'sanctioned', idx);
    });

  c.innerHTML = `${filterSortBarHtml()}<div class="sec-head"><div class="sec-title">Sanctioned Loans</div><div class="sec-right">${freshGroupToggleHtml()}<div class="sec-count">${loans.length} · <span class="rs">&#8377;</span>${fmtAmt(total)} L</div><button class="sec-collapse-btn" onclick="collapseAll()" style="display:none">&#9650; collapse all</button></div></div>${cards}`;
}

export function renderReturned(c) {
  let loans = applyFilters(getLoanMetrics().returned.filter(searchMatch));
  loans = applySort(loans);
  const total = sumAmount(loans);
  const cards = loans.length === 0
    ? emptyState('&#128203;', 'No returned loans', 'Returned loans will appear here')
    : freshGroupsHtml(loans, (l, idx) => {
      const actions = `${statusAction(l.id)}
        ${copyAction(l.id)}
        <button class="btn btn-more" onclick="editLoan('${l.id}')">&#9998;</button>
        ${S.isAdmin ? `<button class="btn btn-danger" onclick="deleteLoan('${l.id}')">&#128465;</button>` : ''}`;
      return compactLoanItem(l, actions, '', 'returned', idx);
    });

  c.innerHTML = `${filterSortBarHtml()}<div class="sec-head"><div class="sec-title">Returned Loans</div><div class="sec-right">${freshGroupToggleHtml()}<div class="sec-count">${loans.length} · <span class="rs">&#8377;</span>${fmtAmt(total)} L</div><button class="sec-collapse-btn" onclick="collapseAll()" style="display:none">&#9650; collapse all</button></div></div>${cards}`;
}
