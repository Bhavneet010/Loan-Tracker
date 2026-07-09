import { S } from "./state.js";
import { esc, todayStr } from "./utils.js";
import { effectiveOfficer } from "./derived.js";

/* ── SHARED UI UTILITIES ── */
export function searchMatch(l) {
  if (!S.search) return true;
  return (l.customerName || '').toLowerCase().includes(S.search)
    || (l.branch || '').toLowerCase().includes(S.search)
    || effectiveOfficer(l).toLowerCase().includes(S.search);
}

export function applyFilters(loans) {
  let out = loans;
  if (S.filter.category !== 'All') out = out.filter(l => l.category === S.filter.category);
  if (S.filter.officer === 'Mine' && S.user) out = out.filter(l => effectiveOfficer(l) === S.user);
  else if (S.filter.officer !== 'All' && S.filter.officer !== 'Mine') out = out.filter(l => effectiveOfficer(l) === S.filter.officer);
  if (S.filter.today) {
    const today = todayStr();
    const dateKey = S.tab === 'sanctioned' ? 'sanctionDate' : S.tab === 'returned' ? 'returnedDate' : 'receiveDate';
    out = out.filter(l => l[dateKey] === today);
  }
  return out;
}

export function applySort(loans) {
  const dir = S.sort.dir === 'asc' ? 1 : -1;
  const field = S.sort.field;
  const dateKey = S.tab === 'sanctioned' ? 'sanctionDate' : S.tab === 'returned' ? 'returnedDate' : 'receiveDate';
  
  return [...loans].sort((a, b) => {
    let av, bv;
    if (field === 'date') { av = a[dateKey] || ''; bv = b[dateKey] || ''; }
    else if (field === 'amount') { av = parseFloat(a.amount) || 0; bv = parseFloat(b.amount) || 0; }
    else if (field === 'officer') { av = effectiveOfficer(a).toLowerCase(); bv = effectiveOfficer(b).toLowerCase(); }
    else if (field === 'category') { av = a.category || ''; bv = b.category || ''; }
    if (av < bv) return -1 * dir; if (av > bv) return 1 * dir; return 0;
  });
}

const SORT_LABELS = { date: 'Date', amount: 'Amount', officer: 'Officer', category: 'Category' };

const flFilterIcon = `<svg class="fl-tbicon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3h11l-4.25 5.1v4.4l-2.5 1.25V8.1z"/></svg>`;
const flSortIcon = `<svg class="fl-tbicon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13V3M5 3 2.5 5.5M5 3l2.5 2.5"/><path d="M11 3v10m0 0 2.5-2.5M11 13l-2.5-2.5"/></svg>`;
const flGroupIcon = `<svg class="fl-tbicon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2 2.5 5 8 8l5.5-3z"/><path d="m2.5 8 5.5 3 5.5-3"/><path d="m2.5 11 5.5 3 5.5-3"/></svg>`;

export function filterSortBarHtml() {
  const fc = (S.filter.category !== 'All' ? 1 : 0) + (S.filter.officer !== 'All' ? 1 : 0) + (S.filter.today ? 1 : 0);
  const sortDirGlyph = S.sort.dir === 'asc' ? '&#8593;' : '&#8595;';
  const sortTitle = `Sort by ${(SORT_LABELS[S.sort.field] || 'Date').toLowerCase()}, ${S.sort.dir === 'asc' ? 'ascending' : 'descending'}`;
  const officerOpts = [
    { v: 'All', label: 'All officers' },
    ...(S.user && !S.isAdmin ? [{ v: 'Mine', label: 'Just me' }] : []),
    ...S.officers.map(o => ({ v: o, label: o }))
  ];
  const catOpts = [
    { v: 'All', label: 'All categories' },
    { v: 'Agriculture', label: 'Agriculture' },
    { v: 'SME', label: 'SME' },
    { v: 'Education', label: 'Education' }
  ];
  const sortFields = [
    { v: 'date', label: `${S.tab === 'sanctioned' ? 'Sanction' : S.tab === 'returned' ? 'Return' : 'Receive'} date` },
    { v: 'amount', label: 'Amount' },
    { v: 'officer', label: 'Officer' },
    { v: 'category', label: 'Category' }
  ];
  const groupOpts = [
    { v: 'officer', label: 'Officer' },
    { v: 'category', label: 'Category' }
  ];

  const radio = (name, opts, current) => opts.map(o =>
    `<label><input type="radio" name="${name}" value="${esc(o.v)}" ${current === o.v ? 'checked' : ''} onchange="${name === 'sortField' ? `setSort('${o.v}',null)` : name === 'sortDir' ? `setSort(null,'${o.v}')` : name === 'groupMode' ? `setFreshGroupMode('${o.v}')` : `setFilter('${name}','${esc(o.v)}')`}">${esc(o.label)}</label>`
  ).join('');

  const filterStyle = S.openPop === 'filter' ? '' : 'display:none;';
  const sortStyle = S.openPop === 'sort' ? '' : 'display:none;';
  const groupStyle = S.openPop === 'group' ? '' : 'display:none;';
  const groupTitle = `Group loans by ${S.freshGroupMode === 'category' ? 'category' : 'officer'}`;

  return `<div class="fs-bar fl-toolbar" onclick="event.stopPropagation();">
    <div class="fl-tb-scroll">
      <button class="fl-tbtn ${fc ? 'active' : ''} ${S.openPop === 'filter' ? 'open' : ''}" onclick="event.stopPropagation();toggleFsMenu('filter')" title="Filter">${flFilterIcon}${fc ? `<span class="fl-tbtn-badge">${fc}</span>` : ''}</button>
      <span class="fl-tb-sep"></span>
      <button class="fl-tbtn ${S.openPop === 'sort' ? 'open' : ''}" onclick="event.stopPropagation();toggleFsMenu('sort')" title="${sortTitle}">${flSortIcon}<span class="fl-tbtn-dir">${sortDirGlyph}</span></button>
      ${S.isAdmin ? `<span class="fl-tb-sep"></span>
      <button class="fl-tbtn ${S.freshGroupMode === 'category' ? 'active' : ''} ${S.openPop === 'group' ? 'open' : ''}" onclick="event.stopPropagation();toggleFsMenu('group')" title="${groupTitle}">${flGroupIcon}</button>` : ''}
      <span class="fl-tb-sep"></span>
      <button class="fl-tbtn fl-tbtn--text${S.filter.today ? ' active' : ''}" onclick="event.stopPropagation();toggleFreshToday()">Today</button>
    </div>
    <div class="fs-pop" id="fsFilterPop" style="${filterStyle}">
      <h4>Category</h4>${radio('category', catOpts, S.filter.category)}
      <hr>
      <h4>Officer</h4>${radio('officer', officerOpts, S.filter.officer)}
    </div>
    <div class="fs-pop" id="fsSortPop" style="${sortStyle}">
      <h4>Sort by</h4>${radio('sortField', sortFields, S.sort.field)}
      <hr>
      <h4>Direction</h4>${radio('sortDir', [{ v: 'desc', label: 'Descending' }, { v: 'asc', label: 'Ascending' }], S.sort.dir)}
    </div>
    ${S.isAdmin ? `<div class="fs-pop" id="fsGroupPop" style="${groupStyle}">
      <h4>Group by</h4>${radio('groupMode', groupOpts, S.freshGroupMode)}
    </div>` : ''}
  </div>`;
}
