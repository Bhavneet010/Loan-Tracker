import { S } from "./state.js";
import { getLoanMetrics, sumAmount, effectiveOfficer } from "./derived.js";
import { esc, fmtAmt, initials, officerColor, branchCode, todayStr } from "./utils.js";
import { emptyState, renewalItemHtml } from "./ui-components.js";
import { searchMatch } from "./ui-logic.js";
import { buildCalendarViewHtml } from "./ui-calendar.js";

export function renderRenewals(c) {
  const metrics = getLoanMetrics();
  const enriched = metrics.renewals;
  let tabFiltered = enriched;
  if (S.renewalTab === 'done') tabFiltered = metrics.renewalDoneThisMonth;
  else if (S.renewalTab === 'dates-missing') tabFiltered = metrics.renewalDatesMissing;
  else if (S.renewalTab === 'due-soon') tabFiltered = metrics.renewalDueSoon;
  else if (S.renewalTab === 'overdue') tabFiltered = metrics.renewalOverdue;
  const canToggleNpa = ['due-soon', 'overdue', 'all'].includes(S.renewalTab) || S.renewalView === 'calendar';
  if (canToggleNpa && !S.renewalShowNpa) tabFiltered = tabFiltered.filter(l => l._rs?.status !== 'npa');

  const sl = { daysFromSanction: 'Days', amount: 'Amount', officer: 'Officer', branch: 'Branch' };
  const dir = S.renewalSort.dir === 'asc' ? 1 : -1;
  let sorted = [...applyRenewalFilters(tabFiltered)].sort((a, b) => {
    let av, bv;
    if (S.renewalSort.field === 'daysFromSanction') { av = a._rs.daysSinceSanction; bv = b._rs.daysSinceSanction; }
    else if (S.renewalSort.field === 'amount') { av = parseFloat(a.amount) || 0; bv = parseFloat(b.amount) || 0; }
    else if (S.renewalSort.field === 'officer') { av = effectiveOfficer(a).toLowerCase(); bv = effectiveOfficer(b).toLowerCase(); }
    else if (S.renewalSort.field === 'branch') { av = (a.branch || '').toLowerCase(); bv = (b.branch || '').toLowerCase(); }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  }).filter(searchMatch);

  const total = sumAmount(sorted);
  let tabMeta = {
    'dates-missing': { title: 'Integration Pending', empty: '!', msg: 'No completed renewals need integration updates' },
    'done': { title: 'Done This Month', empty: '&#9850;', msg: 'No SME renewals completed this month' },
    'due-soon': { title: 'Due for Renewal Soon', empty: '&#9200;', msg: 'No accounts due within 30 days' },
    'overdue': { title: 'Renewal Overdue', empty: '!', msg: 'No overdue renewal accounts' },
    'all': { title: 'All CC Accounts', empty: '&#128203;', msg: 'No CC accounts found' },
  }[S.renewalTab] || { title: 'SME CC Renewals', empty: '&#9850;', msg: 'No renewals found' };
  if (S.renewalFilter.status === 'DueSoon') {
    tabMeta = { title: 'Due Soon Accounts', empty: '&#9200;', msg: 'No accounts due within 30 days' };
  }

  const fc = (S.renewalFilter.officer !== 'All' ? 1 : 0) +
    (S.renewalFilter.branch !== 'All' ? 1 : 0) +
    (S.renewalFilter.completion !== 'All' ? 1 : 0) +
    (S.renewalFilter.status && S.renewalFilter.status !== 'All' ? 1 : 0) +
    (S.renewalFilter.today ? 1 : 0);
  const radio = (name, opts, cur) => opts.map(o => `<label><input type="radio" name="rnw_${name}" value="${esc(o.v)}" ${cur === o.v ? 'checked' : ''} onchange="${name === 'sortField' ? `setRenewalSort('${esc(o.v)}',null)` : name === 'sortDir' ? `setRenewalSort(null,'${esc(o.v)}')` : `setRenewalFilter('${name}','${esc(o.v)}')`}">${esc(o.label)}</label>`).join('');

  const filterStyle = S.openPop === 'rnwFilter' ? '' : 'display:none;';
  const sortStyle = S.openPop === 'rnwSort' ? '' : 'display:none;';
  const todayNum = parseInt(todayStr().slice(8, 10), 10);
  const sortDirGlyph = S.renewalSort.dir === 'asc' ? '&#8593;' : '&#8595;';
  const sortTitle = `Sort by ${(sl[S.renewalSort.field] || 'Days').toLowerCase()}, ${S.renewalSort.dir === 'asc' ? 'ascending' : 'descending'}`;

  const filterIcon = `<svg class="rnw-tbicon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3h11l-4.25 5.1v4.4l-2.5 1.25V8.1z"/></svg>`;
  const sortIcon = `<svg class="rnw-tbicon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13V3M5 3 2.5 5.5M5 3l2.5 2.5"/><path d="M11 3v10m0 0 2.5-2.5M11 13l-2.5-2.5"/></svg>`;

  const fsBar = `<div class="fs-bar rnw-toolbar" onclick="event.stopPropagation();">
    <div class="rnw-tb-scroll">
      <div class="rnw-tb-group">
        <button type="button" data-renewal-view="calendar" class="rnw-tbtn rnw-tbtn--text ${S.renewalView === 'calendar' ? 'active' : ''}" onclick="event.stopPropagation();setRenewalView('calendar')">Calendar</button>
        <button type="button" data-renewal-view="list" class="rnw-tbtn rnw-tbtn--text ${S.renewalView === 'list' ? 'active' : ''}" onclick="event.stopPropagation();setRenewalView('list')">List</button>
      </div>
      <span class="rnw-tb-sep"></span>
      <div class="rnw-tb-group">
        <button class="rnw-tbtn ${fc ? 'active' : ''} ${S.openPop === 'rnwFilter' ? 'open' : ''}" onclick="event.stopPropagation();toggleFsMenu('rnwFilter')" title="Filter">${filterIcon}${fc ? `<span class="rnw-tbtn-badge">${fc}</span>` : ''}</button>
        <button class="rnw-tbtn ${S.openPop === 'rnwSort' ? 'open' : ''}" onclick="event.stopPropagation();toggleFsMenu('rnwSort')" title="${sortTitle}">${sortIcon}<span class="rnw-tbtn-dir">${sortDirGlyph}</span></button>
      </div>
      <span class="rnw-tb-sep"></span>
      <button class="rnw-tbtn${S.renewalFilter.today ? ' active' : ''}" onclick="event.stopPropagation();toggleRenewalToday()" title="Jump to today">
        <span class="cal-mini"><span class="cal-mini-num">${todayNum}</span></span>
      </button>
      ${canToggleNpa ? `<span class="rnw-tb-sep"></span>
      <button class="rnw-tbtn${S.renewalShowNpa ? ' active' : ''}" onclick="event.stopPropagation();toggleRenewalNpa(${!S.renewalShowNpa})" title="Show NPA accounts">NPA</button>` : ''}
      ${S.isAdmin && S.renewalView === 'calendar' ? `<span class="rnw-tb-sep"></span>
      <button class="rnw-tbtn${S.calendarBarExpanded ? ' active' : ''}" onclick="event.stopPropagation();toggleCalMbarExpand()" title="${S.calendarBarExpanded ? 'Combined view' : 'View by officer'}">&#8801;</button>` : ''}
    </div>
    <div class="fs-pop" style="${filterStyle}">
      <h4>Status</h4>${radio('status', [{ v: 'All', label: 'All statuses' }, { v: 'DueSoon', label: 'Due soon accounts' }], S.renewalFilter.status || 'All')}
      <hr>
      <h4>Completion</h4>${radio('completion', [{ v: 'All', label: 'All renewals' }, { v: 'DatesMissing', label: 'Integration pending' }, { v: 'Complete', label: 'Integration complete' }], S.renewalFilter.completion)}
      <hr><h4>Officer</h4>${radio('officer', [{ v: 'All', label: 'All officers' }, ...(S.user && !S.isAdmin ? [{ v: 'Mine', label: 'Just me' }] : []), ...S.officers.map(o => ({ v: o, label: o }))], S.renewalFilter.officer)}
      <hr><h4>Branch</h4>${radio('branch', [{ v: 'All', label: 'All branches' }, ...S.branches.map(b => ({ v: b, label: b }))], S.renewalFilter.branch)}
    </div>
    <div class="fs-pop fs-pop-right" style="${sortStyle}">
      <h4>Sort by</h4>${radio('sortField', [{ v: 'daysFromSanction', label: 'Days' }, { v: 'amount', label: 'Amount' }, { v: 'officer', label: 'Officer' }, { v: 'branch', label: 'Branch' }], S.renewalSort.field)}
      <hr><h4>Direction</h4>${radio('sortDir', [{ v: 'desc', label: 'Descending' }, { v: 'asc', label: 'Ascending' }], S.renewalSort.dir)}
    </div>
  </div>`;

  const officerViewer = renewalOfficerViewerHtml(buildVisibleRenewalOfficerSummary(metrics));
  const searchBar = `<div class="rnw-search-wrap"><input type="text" class="search-inp rnw-search-inp" placeholder="Search account or branch" value="${esc(S.search)}" oninput="handleRenewalSearch(this.value)"></div>`;
  const list = sorted.length === 0 ? emptyState(tabMeta.empty, tabMeta.title, tabMeta.msg) : sorted.map((l, i) => renewalItemHtml(l, l._rs, i)).join('');
  const listContent = `<div class="sec-head rnw-list-head"><div class="sec-title">${tabMeta.title}</div><div class="sec-right"><div class="sec-count">${sorted.length} · <span class="rs">&#8377;</span>${fmtAmt(total)} L</div><button class="sec-collapse-btn" onclick="collapseAll()" style="display:none">&#9650; collapse all</button></div></div>${list}`;
  const mainContent = S.renewalView === 'calendar' ? buildCalendarViewHtml(metrics) : listContent;
  c.innerHTML = `<div class="rnw-page-chrome">${officerViewer}${searchBar}${fsBar}</div><div class="rnw-content">${mainContent}</div>`;
}

export function updateRenewalMainContent({ transition = true } = {}) {
  const content = document.querySelector('.rnw-content');
  if (!content) {
    window.render?.();
    return;
  }

  syncRenewalChromeState();

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const replaceContent = () => {
    content.innerHTML = buildRenewalMainContent();
    content.classList.remove('content-leaving', 'content-enter');
    if (!reduceMotion) {
      void content.offsetWidth;
      content.classList.add('content-enter');
    }
  };

  if (!transition || reduceMotion) {
    replaceContent();
    return;
  }

  if (content.classList.contains('content-leaving')) {
    setTimeout(replaceContent, 120);
    return;
  }

  content.classList.remove('content-enter');
  content.classList.add('content-leaving');

  let swapped = false;
  const swap = () => {
    if (swapped) return;
    swapped = true;
    replaceContent();
  };

  content.addEventListener('animationend', swap, { once: true });
  setTimeout(swap, 210);
}

function syncRenewalChromeState() {
  document.querySelectorAll('.rnw-toolbar [data-renewal-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.renewalView === S.renewalView);
  });
}

window.handleRenewalSearch = function(v) {
  S.search = v.toLowerCase().trim();
  const content = document.querySelector('.rnw-content');
  if (S.appMode !== 'renewals' || !content) {
    window.render();
    return;
  }
  content.innerHTML = buildRenewalMainContent();
};

function buildRenewalMainContent(metrics = getLoanMetrics()) {
  return S.renewalView === 'calendar' ? buildCalendarViewHtml(metrics) : buildRenewalListContent(metrics);
}

function buildRenewalListContent(metrics) {
  const enriched = metrics.renewals;
  let tabFiltered = enriched;
  if (S.renewalTab === 'done') tabFiltered = metrics.renewalDoneThisMonth;
  else if (S.renewalTab === 'dates-missing') tabFiltered = metrics.renewalDatesMissing;
  else if (S.renewalTab === 'due-soon') tabFiltered = metrics.renewalDueSoon;
  else if (S.renewalTab === 'overdue') tabFiltered = metrics.renewalOverdue;

  const canToggleNpa = ['due-soon', 'overdue', 'all'].includes(S.renewalTab) || S.renewalView === 'calendar';
  if (canToggleNpa && !S.renewalShowNpa) tabFiltered = tabFiltered.filter(l => l._rs?.status !== 'npa');

  const dir = S.renewalSort.dir === 'asc' ? 1 : -1;
  const sorted = [...applyRenewalFilters(tabFiltered)].sort((a, b) => {
    let av, bv;
    if (S.renewalSort.field === 'daysFromSanction') { av = a._rs.daysSinceSanction; bv = b._rs.daysSinceSanction; }
    else if (S.renewalSort.field === 'amount') { av = parseFloat(a.amount) || 0; bv = parseFloat(b.amount) || 0; }
    else if (S.renewalSort.field === 'officer') { av = effectiveOfficer(a).toLowerCase(); bv = effectiveOfficer(b).toLowerCase(); }
    else if (S.renewalSort.field === 'branch') { av = (a.branch || '').toLowerCase(); bv = (b.branch || '').toLowerCase(); }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  }).filter(searchMatch);

  const total = sumAmount(sorted);
  let tabMeta = {
    'dates-missing': { title: 'Integration Pending', empty: '!', msg: 'No completed renewals need integration updates' },
    'done': { title: 'Done This Month', empty: '&#9850;', msg: 'No SME renewals completed this month' },
    'due-soon': { title: 'Due for Renewal Soon', empty: '&#9200;', msg: 'No accounts due within 30 days' },
    'overdue': { title: 'Renewal Overdue', empty: '!', msg: 'No overdue renewal accounts' },
    'all': { title: 'All CC Accounts', empty: '&#128203;', msg: 'No CC accounts found' },
  }[S.renewalTab] || { title: 'SME CC Renewals', empty: '&#9850;', msg: 'No renewals found' };
  if (S.renewalFilter.status === 'DueSoon') {
    tabMeta = { title: 'Due Soon Accounts', empty: '&#9200;', msg: 'No accounts due within 30 days' };
  }

  const list = sorted.length === 0 ? emptyState(tabMeta.empty, tabMeta.title, tabMeta.msg) : sorted.map((l, i) => renewalItemHtml(l, l._rs, i)).join('');
  return `<div class="sec-head rnw-list-head"><div class="sec-title">${tabMeta.title}</div><div class="sec-right"><div class="sec-count">${sorted.length} · <span class="rs">&#8377;</span>${fmtAmt(total)} L</div><button class="sec-collapse-btn" onclick="collapseAll()" style="display:none">&#9650; collapse all</button></div></div>${list}`;
}

export function applyRenewalFilters(enriched) {
  let out = enriched;
  if (S.renewalFilter.status === 'DueSoon') out = out.filter(l => l._rs?.status === 'due-soon' && !l.renewedDate);
  if (S.renewalFilter.officer === 'Mine' && S.user) out = out.filter(l => effectiveOfficer(l) === S.user);
  else if (S.renewalFilter.officer !== 'All' && S.renewalFilter.officer !== 'Mine') out = out.filter(l => effectiveOfficer(l) === S.renewalFilter.officer);
  if (S.renewalFilter.branch !== 'All') {
    const filterCode = branchCode(S.renewalFilter.branch);
    out = out.filter(l => branchCode(l.branch) === filterCode);
  }
  if (S.renewalFilter.completion === 'DatesMissing') out = out.filter(hasMissingRenewalDates);
  else if (S.renewalFilter.completion === 'Complete') out = out.filter(l => !l.renewedDate || !hasMissingRenewalDates(l));
  if (S.renewalFilter.today) out = out.filter(l => l.renewedDate === todayStr());
  return out;
}

function hasMissingRenewalDates(loan) {
  return !!loan.renewedDate && (loan.renewalDatesPending === true || !loan.renewalDueDate || !loan.limitExpiryDate);
}

function buildVisibleRenewalOfficerSummary(metrics) {
  const includeLoan = loan => S.renewalShowNpa || loan._rs?.status !== 'npa';
  const includeRoleLoan = loan => S.isAdmin || effectiveOfficer(loan) === S.user;
  const renewals = metrics.renewals.filter(includeLoan).filter(includeRoleLoan);
  const dueSoon = metrics.renewalDueSoon.filter(includeLoan).filter(includeRoleLoan);
  const overdue = metrics.renewalOverdue.filter(includeLoan).filter(includeRoleLoan);
  const rowsByOfficer = new Map();

  const summaryOfficers = S.isAdmin ? S.officers : [S.user].filter(Boolean);
  summaryOfficers.forEach(officer => {
    rowsByOfficer.set(officer, { officer, total: 0, od: 0, due: 0 });
  });

  const ensure = officer => {
    const key = officer || 'Unassigned';
    if (!rowsByOfficer.has(key)) rowsByOfficer.set(key, { officer: key, total: 0, od: 0, due: 0 });
    return rowsByOfficer.get(key);
  };

  renewals.forEach(loan => ensure(effectiveOfficer(loan)).total++);
  dueSoon.forEach(loan => ensure(effectiveOfficer(loan)).due++);
  overdue.forEach(loan => ensure(effectiveOfficer(loan)).od++);

  const rows = Array.from(rowsByOfficer.values()).sort((a, b) =>
    (b.od - a.od) || (b.due - a.due) || (b.total - a.total) || a.officer.localeCompare(b.officer)
  );

  return {
    activeOfficers: rows.filter(row => row.total > 0).length,
    total: renewals.length,
    od: overdue.length,
    due: dueSoon.length,
    rows,
  };
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
      <div class="rnw-officer-title"><span>&#128101;</span><span><b>Officers</b><small>${summary.activeOfficers} active</small></span></div>
      <div><b>${summary.total}</b><small>Total</small></div>
      <div class="rnw-officer-od"><b>${summary.od}</b><small>OD</small></div>
      <div class="rnw-officer-due"><b>${summary.due}</b><small>Due</small></div>
      <div class="rnw-officer-caret">${expanded ? '&#9650;' : '&#9660;'}</div>
    </button>
    ${expanded ? `<div class="rnw-officer-table">
      <div class="rnw-officer-head"><span>Officer</span><span>Total</span><span>OD</span><span>Due</span></div>
      ${rows}
    </div>` : ''}
  </section>`;
}
