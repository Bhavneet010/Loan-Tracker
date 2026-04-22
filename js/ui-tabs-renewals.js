import { S } from "./state.js";
import { getLoanMetrics, sumAmount } from "./derived.js";
import { esc, fmtAmt, initials, officerColor } from "./utils.js";
import { emptyState, renewalItemHtml } from "./ui-components.js";
import { searchMatch } from "./ui-logic.js";

export function renderRenewals(c) {
  const metrics = getLoanMetrics();
  const enriched = metrics.renewals;
  let tabFiltered = enriched;
  if (S.renewalTab === 'done') tabFiltered = metrics.renewalDoneThisMonth;
  else if (S.renewalTab === 'dates-missing') tabFiltered = metrics.renewalDatesMissing;
  else if (S.renewalTab === 'due-soon') tabFiltered = metrics.renewalDueSoon;
  else if (S.renewalTab === 'overdue') tabFiltered = metrics.renewalOverdue;
  const canToggleNpa = ['due-soon', 'overdue', 'all'].includes(S.renewalTab);
  if (canToggleNpa && !S.renewalShowNpa) tabFiltered = tabFiltered.filter(l => l._rs?.status !== 'npa');
  
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
  
  const total = sumAmount(sorted);
  const tabMeta = {
    'dates-missing': { title: 'Renewal Dates Missing', empty: '!', msg: 'No completed renewals need date updates' },
    'done': { title: 'Done This Month', empty: '♻', msg: 'No SME renewals completed this month' },
    'due-soon': { title: 'Due for Renewal Soon', empty: '⏰', msg: 'No accounts due within 30 days' },
    'overdue': { title: 'Renewal Overdue', empty: '⚠', msg: 'No overdue renewal accounts' },
    'all': { title: 'All CC Accounts', empty: '📋', msg: 'No CC accounts found' },
  }[S.renewalTab] || { title: 'SME CC Renewals', empty: '♻', msg: 'No renewals found' };
  
  const fc = (S.renewalFilter.officer !== 'All' ? 1 : 0) + (S.renewalFilter.branch !== 'All' ? 1 : 0) + (S.renewalFilter.completion !== 'All' ? 1 : 0);
  const sortLabel = `${sl[S.renewalSort.field] || 'Days'} ${S.renewalSort.dir === 'asc' ? '↑' : '↓'}`;
  
  const radio = (name, opts, cur) => opts.map(o => `<label><input type="radio" name="rnw_${name}" value="${esc(o.v)}" ${cur === o.v ? 'checked' : ''} onchange="${name === 'sortField' ? `setRenewalSort('${esc(o.v)}',null)` : name === 'sortDir' ? `setRenewalSort(null,'${esc(o.v)}')` : `setRenewalFilter('${name}','${esc(o.v)}')`}">${esc(o.label)}</label>`).join('');
  
  const filterStyle = S.openPop === 'rnwFilter' ? '' : 'display:none;';
  const sortStyle = S.openPop === 'rnwSort' ? '' : 'display:none;';
  
  const fsBar = `<div class="fs-bar" onclick="event.stopPropagation();">
    <button class="fs-btn ${fc ? 'active' : ''} ${S.openPop === 'rnwFilter' ? 'open' : ''}" onclick="event.stopPropagation();toggleFsMenu('rnwFilter')">⚲ Filter<span class="fs-badge">${fc || ''}</span></button>
    <button class="fs-btn ${S.openPop === 'rnwSort' ? 'open' : ''}" onclick="event.stopPropagation();toggleFsMenu('rnwSort')">↕ Sort <span class="fs-label">${sortLabel}</span></button>
    ${canToggleNpa ? `<label class="rnw-npa-toggle" title="Show NPA accounts">
      <input type="checkbox" ${S.renewalShowNpa ? 'checked' : ''} onchange="toggleRenewalNpa(this.checked)">
      <span>Show NPA</span>
    </label>` : ''}
    <div class="fs-pop" style="${filterStyle}">
      <h4>Completion</h4>${radio('completion', [{ v: 'All', label: 'All renewals' }, { v: 'DatesMissing', label: 'Dates missing' }, { v: 'Complete', label: 'Dates complete' }], S.renewalFilter.completion)}
      <hr><h4>Officer</h4>${radio('officer', [{ v: 'All', label: 'All officers' }, ...(S.user && !S.isAdmin ? [{ v: 'Mine', label: 'Just me' }] : []), ...S.officers.map(o => ({ v: o, label: o }))], S.renewalFilter.officer)}
      <hr><h4>Branch</h4>${radio('branch', [{ v: 'All', label: 'All branches' }, ...S.branches.map(b => ({ v: b, label: b }))], S.renewalFilter.branch)}
    </div>
    <div class="fs-pop fs-pop-right" style="${sortStyle}">
      <h4>Sort by</h4>${radio('sortField', [{ v: 'daysFromSanction', label: 'Days' }, { v: 'amount', label: 'Amount' }, { v: 'officer', label: 'Officer' }, { v: 'branch', label: 'Branch' }], S.renewalSort.field)}
      <hr><h4>Direction</h4>${radio('sortDir', [{ v: 'desc', label: 'Descending' }, { v: 'asc', label: 'Ascending' }], S.renewalSort.dir)}
    </div>
  </div>`;

  const officerViewer = renewalOfficerViewerHtml(metrics.renewalOfficerSummary);
  const list = sorted.length === 0 ? emptyState(tabMeta.empty, tabMeta.title, tabMeta.msg) : sorted.map(l => renewalItemHtml(l, l._rs)).join('');
  c.innerHTML = `${officerViewer}${fsBar}<div class="sec-head"><div class="sec-title">${tabMeta.title}</div><div class="sec-count">${sorted.length} · ₹${fmtAmt(total)} L</div></div>${list}`;
}

export function applyRenewalFilters(enriched) {
  let out = enriched;
  if (S.renewalFilter.officer === 'Mine' && S.user) out = out.filter(l => l.allocatedTo === S.user);
  else if (S.renewalFilter.officer !== 'All' && S.renewalFilter.officer !== 'Mine') out = out.filter(l => l.allocatedTo === S.renewalFilter.officer);
  if (S.renewalFilter.branch !== 'All') out = out.filter(l => l.branch === S.renewalFilter.branch);
  if (S.renewalFilter.completion === 'DatesMissing') out = out.filter(hasMissingRenewalDates);
  else if (S.renewalFilter.completion === 'Complete') out = out.filter(l => !l.renewedDate || !hasMissingRenewalDates(l));
  return out;
}

function hasMissingRenewalDates(loan) {
  return !!loan.renewedDate && (loan.renewalDatesPending === true || !loan.renewalDueDate || !loan.limitExpiryDate);
}

function renewalOfficerViewerHtml(summary) {
  const selected = S.renewalFilter.officer;
  const expanded = S.renewalOfficersExpanded;
  const rows = expanded ? summary.rows.map(row => {
    const active = selected === row.officer;
    return `<button class="rnw-officer-row ${active ? 'active' : ''}" onclick="setRenewalOfficer('${esc(row.officer)}')" type="button">
      <span class="rnw-officer-name">
        <span class="rnw-officer-av" style="background:${officerColor(row.officer).bg};">${initials(row.officer)}</span>
        <span>${esc(row.officer)}</span>
      </span>
      <span>${row.total}</span>
      <span class="rnw-officer-od">${row.od}</span>
      <span class="rnw-officer-due">${row.due}</span>
    </button>`;
  }).join('') : '';

  return `<section class="rnw-officer-card ${expanded ? '' : 'collapsed'}" aria-label="Renewal officer summary">
    <button class="rnw-officer-summary" onclick="toggleRenewalOfficers()" type="button" aria-expanded="${expanded}">
      <div class="rnw-officer-title"><span>👥</span><span><b>Officers</b><small>${summary.activeOfficers} active</small></span></div>
      <div><b>${summary.total}</b><small>Total</small></div>
      <div class="rnw-officer-od"><b>${summary.od}</b><small>OD</small></div>
      <div class="rnw-officer-due"><b>${summary.due}</b><small>Due</small></div>
      <div class="rnw-officer-caret">${expanded ? '⌃' : '⌄'}</div>
    </button>
    ${expanded ? `<div class="rnw-officer-table">
      <div class="rnw-officer-head"><span>Officer</span><span>Total</span><span>OD</span><span>Due</span></div>
      ${rows}
    </div>` : ''}
  </section>`;
}
