import { S } from "./state.js";
import { esc } from "./utils.js";

/* ── SHARED UI UTILITIES ── */
export function searchMatch(l) {
  if (!S.search) return true;
  return (l.customerName || '').toLowerCase().includes(S.search)
    || (l.branch || '').toLowerCase().includes(S.search)
    || (l.allocatedTo || '').toLowerCase().includes(S.search);
}

export function applyFilters(loans) {
  let out = loans;
  if (S.filter.category !== 'All') out = out.filter(l => l.category === S.filter.category);
  if (S.filter.officer === 'Mine' && S.user) out = out.filter(l => l.allocatedTo === S.user);
  else if (S.filter.officer !== 'All' && S.filter.officer !== 'Mine') out = out.filter(l => l.allocatedTo === S.filter.officer);
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
    else if (field === 'officer') { av = (a.allocatedTo || '').toLowerCase(); bv = (b.allocatedTo || '').toLowerCase(); }
    else if (field === 'category') { av = a.category || ''; bv = b.category || ''; }
    if (av < bv) return -1 * dir; if (av > bv) return 1 * dir; return 0;
  });
}

const SORT_LABELS = { date: 'Date', amount: 'Amount', officer: 'Officer', category: 'Category' };

export function filterSortBarHtml() {
  const fc = (S.filter.category !== 'All' ? 1 : 0) + (S.filter.officer !== 'All' ? 1 : 0);
  const sortLabel = `${SORT_LABELS[S.sort.field] || 'Date'} ${S.sort.dir === 'asc' ? '↑' : '↓'}`;
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
  
  const radio = (name, opts, current) => opts.map(o =>
    `<label><input type="radio" name="${name}" value="${esc(o.v)}" ${current === o.v ? 'checked' : ''} onchange="${name === 'sortField' ? `setSort('${o.v}',null)` : name === 'sortDir' ? `setSort(null,'${o.v}')` : `setFilter('${name}','${esc(o.v)}')`}">${esc(o.label)}</label>`
  ).join('');
  
  const filterStyle = S.openPop === 'filter' ? '' : 'display:none;';
  const sortStyle = S.openPop === 'sort' ? '' : 'display:none;';
  
  return `<div class="fs-bar" onclick="event.stopPropagation();">
    <button class="fs-btn ${fc ? 'active' : ''} ${S.openPop === 'filter' ? 'open' : ''}" onclick="event.stopPropagation();toggleFsMenu('filter')">⚲ Filter<span class="fs-badge">${fc || ''}</span></button>
    <button class="fs-btn ${S.openPop === 'sort' ? 'open' : ''}" onclick="event.stopPropagation();toggleFsMenu('sort')">↕ Sort <span class="fs-label">${sortLabel}</span></button>
    <div class="fs-pop" id="fsFilterPop" style="${filterStyle}">
      <h4>Category</h4>${radio('category', catOpts, S.filter.category)}
      <hr>
      <h4>Officer</h4>${radio('officer', officerOpts, S.filter.officer)}
    </div>
    <div class="fs-pop fs-pop-right" id="fsSortPop" style="${sortStyle}">
      <h4>Sort by</h4>${radio('sortField', sortFields, S.sort.field)}
      <hr>
      <h4>Direction</h4>${radio('sortDir', [{ v: 'desc', label: 'Descending' }, { v: 'asc', label: 'Ascending' }], S.sort.dir)}
    </div>
  </div>`;
}
