import { S } from "./state.js";
import { todayStr, computeRenewalStatus, isFreshCC, esc, fmtAmt } from "./utils.js";
import { emptyState, renewalItemHtml } from "./ui-components.js";
import { searchMatch, toggleFsMenu } from "./ui-render.js";

export function renderRenewals(c) {
  const enriched = S.loans
    .filter(l => l.category === 'SME' && l.sanctionDate && !l.isTermLoan)
    .map(l => ({ ...l, _rs: computeRenewalStatus(l) }))
    .filter(l => l._rs);
    
  const thisMonth = todayStr().slice(0, 7);
  let tabFiltered = enriched;
  if (S.renewalTab === 'done') tabFiltered = enriched.filter(l => (l.sanctionDate || '').startsWith(thisMonth) && !isFreshCC(l));
  else if (S.renewalTab === 'due-soon') tabFiltered = enriched.filter(l => l._rs.status === 'due-soon');
  else if (S.renewalTab === 'overdue') tabFiltered = enriched.filter(l => l._rs.status === 'pending-renewal' || l._rs.status === 'npa');
  
  const sl = { daysFromSanction: 'Days', amount: 'Amount', officer: 'Officer', branch: 'Branch' };
  const dir = S.renewalSort.dir === 'asc' ? 1 : -1;
  let sorted = [...applyRenewalFilters(tabFiltered)].sort((a, b) => {
    let av, bv;
    if (S.renewalSort.field === 'daysFromSanction') { av = a._rs.daysSinceSanction; bv = b._rs.daysSinceSanction; }
    else if (S.renewalSort.field === 'amount') { av = parseFloat(a.amount) || 0; bv = parseFloat(b.amount) || 0; }
    else if (S.renewalSort.field === 'officer') { av = (a.allocatedTo || '').toLowerCase(); bv = (b.allocatedTo || '').toLowerCase(); }
    else if (S.renewalSort.field === 'branch') { av = (a.branch || '').toLowerCase(); bv = (b.branch || '').toLowerCase(); }
    if (av < bv) return -1 * dir; if (av > bv) return 1 * dir; return 0;
  }).filter(searchMatch);
  
  const total = sorted.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const tabMeta = {
    'done': { title: 'Done This Month', empty: '♻', msg: 'No SME renewals completed this month' },
    'due-soon': { title: 'Due for Renewal Soon', empty: '⏰', msg: 'No accounts due within 30 days' },
    'overdue': { title: 'Renewal Overdue', empty: '⚠', msg: 'No overdue renewal accounts' },
    'all': { title: 'All CC Accounts', empty: '📋', msg: 'No CC accounts found' },
  }[S.renewalTab] || { title: 'SME CC Renewals', empty: '♻', msg: 'No renewals found' };
  
  const fc = (S.renewalFilter.officer !== 'All' ? 1 : 0) + (S.renewalFilter.branch !== 'All' ? 1 : 0);
  const sortLabel = `${sl[S.renewalSort.field] || 'Days'} ${S.renewalSort.dir === 'asc' ? '↑' : '↓'}`;
  
  const radio = (name, opts, cur) => opts.map(o => `<label><input type="radio" name="rnw_${name}" value="${esc(o.v)}" ${cur === o.v ? 'checked' : ''} onchange="${name === 'sortField' ? `setRenewalSort('${esc(o.v)}',null)` : name === 'sortDir' ? `setRenewalSort(null,'${esc(o.v)}')` : `setRenewalFilter('${name}','${esc(o.v)}')`}">${esc(o.label)}</label>`).join('');
  
  const filterStyle = S.openPop === 'rnwFilter' ? '' : 'display:none;';
  const sortStyle = S.openPop === 'rnwSort' ? '' : 'display:none;';
  
  const fsBar = `<div class="fs-bar" onclick="event.stopPropagation();">
    <button class="fs-btn ${fc ? 'active' : ''} ${S.openPop === 'rnwFilter' ? 'open' : ''}" onclick="event.stopPropagation();toggleFsMenu('rnwFilter')">⚲ Filter<span class="fs-badge">${fc || ''}</span></button>
    <button class="fs-btn ${S.openPop === 'rnwSort' ? 'open' : ''}" onclick="event.stopPropagation();toggleFsMenu('rnwSort')">↕ Sort <span class="fs-label">${sortLabel}</span></button>
    <div class="fs-pop" style="${filterStyle}">
      <h4>Officer</h4>${radio('officer', [{ v: 'All', label: 'All officers' }, ...(S.user && !S.isAdmin ? [{ v: 'Mine', label: 'Just me' }] : []), ...S.officers.map(o => ({ v: o, label: o }))], S.renewalFilter.officer)}
      <hr><h4>Branch</h4>${radio('branch', [{ v: 'All', label: 'All branches' }, ...S.branches.map(b => ({ v: b, label: b }))], S.renewalFilter.branch)}
    </div>
    <div class="fs-pop fs-pop-right" style="${sortStyle}">
      <h4>Sort by</h4>${radio('sortField', [{ v: 'daysFromSanction', label: 'Days' }, { v: 'amount', label: 'Amount' }, { v: 'officer', label: 'Officer' }, { v: 'branch', label: 'Branch' }], S.renewalSort.field)}
      <hr><h4>Direction</h4>${radio('sortDir', [{ v: 'desc', label: 'Descending' }, { v: 'asc', label: 'Ascending' }], S.renewalSort.dir)}
    </div>
  </div>`;

  const list = sorted.length === 0 ? emptyState(tabMeta.empty, tabMeta.title, tabMeta.msg) : sorted.map(l => renewalItemHtml(l, l._rs)).join('');
  c.innerHTML = `${fsBar}<div class="sec-head"><div class="sec-title">${tabMeta.title}</div><div class="sec-count">${sorted.length} · ₹${fmtAmt(total)} L</div></div>${list}`;
}

export function applyRenewalFilters(enriched) {
  let out = enriched;
  if (S.renewalFilter.officer === 'Mine' && S.user) out = out.filter(l => l.allocatedTo === S.user);
  else if (S.renewalFilter.officer !== 'All' && S.renewalFilter.officer !== 'Mine') out = out.filter(l => l.allocatedTo === S.renewalFilter.officer);
  if (S.renewalFilter.branch !== 'All') out = out.filter(l => l.branch === S.renewalFilter.branch);
  return out;
}
