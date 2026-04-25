import { S } from "./state.js";
import { getLoanMetrics, sumAmount } from "./derived.js";
import { catCls, esc, fmtAmt, fmtDate, shortCat, toast } from "./utils.js";
import { monthDays, trendBuckets, groupAmountByBucket, buildOfficerTotals, buildTrendDatasets, buildLeaderboardRows, summaryRows, reportCell, metricBox, trendTable, performerTable, summaryTable, loanOfficer, loansForOfficer, totalMetric, metricHtml, statusRank, renewalUrgencyValue, sortRenewalRisk, riskWatchForOfficer, detailOfficerNames, officerPdfData, freshLoanLine, renewalLoanLine, riskStatusText, compactBranch, pdfSection, coverOfficerRow, CATS, TREND_COLORS, amountOf, PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT, html2canvasLoadPromise, jsPdfLoadPromise } from "./performance-utils.js";

function coverMetricHtml(label, loans, tone, iconSvg) {
  const total = totalMetric(loans);
  return `<div class="pdf-metric-v2 ${tone}">
    <div class="pdf-metric-v2-icon">${iconSvg}</div>
    <div class="pdf-metric-v2-body">
      <span>${esc(label)}</span>
      <strong>${esc(total.count)}</strong>
      <small>Rs ${esc(fmtAmt(total.amount))}L</small>
    </div>
  </div>`;
}

const METRIC_ICONS = {
  sanctioned: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
  pending: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  returned: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`,
  renewals: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
  dueSoon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  overdue: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
};

function buildDonutChartSvg(rows, totalRiskWatch) {
  const COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];
  const cx = 80, cy = 80, R = 60, r = 38;
  let cumAngle = -90;
  const slices = [];
  const labels = [];

  rows.forEach((row, i) => {
    const count = row.riskWatch.loans.length;
    if (!count) return;
    const pct = count / Math.max(1, totalRiskWatch);
    const angle = pct * 360;
    const startRad = (cumAngle * Math.PI) / 180;
    const endRad = ((cumAngle + angle) * Math.PI) / 180;
    const midRad = ((cumAngle + angle / 2) * Math.PI) / 180;
    const largeArc = angle > 180 ? 1 : 0;

    const x1o = cx + R * Math.cos(startRad), y1o = cy + R * Math.sin(startRad);
    const x2o = cx + R * Math.cos(endRad), y2o = cy + R * Math.sin(endRad);
    const x1i = cx + r * Math.cos(endRad), y1i = cy + r * Math.sin(endRad);
    const x2i = cx + r * Math.cos(startRad), y2i = cy + r * Math.sin(startRad);

    const color = COLORS[i % COLORS.length];
    slices.push(`<path d="M${x1o},${y1o} A${R},${R} 0 ${largeArc},1 ${x2o},${y2o} L${x1i},${y1i} A${r},${r} 0 ${largeArc},0 ${x2i},${y2i} Z" fill="${color}"/>`);

    const labelR = R + 14;
    const lx = cx + labelR * Math.cos(midRad);
    const ly = cy + labelR * Math.sin(midRad);
    const anchor = Math.cos(midRad) >= 0 ? 'start' : 'end';
    labels.push(`<text x="${lx}" y="${ly}" text-anchor="${anchor}" font-size="8" font-weight="850" fill="#333">${esc(row.name)}</text>`);
    labels.push(`<text x="${lx}" y="${ly + 10}" text-anchor="${anchor}" font-size="8" font-weight="900" fill="${color}">${esc(count)}</text>`);

    cumAngle += angle;
  });

  const legendY = 175;
  const legendItems = rows.filter(r => r.riskWatch.loans.length > 0).map((row, i) => {
    const color = COLORS[i % COLORS.length];
    const y = legendY + i * 14;
    return `<circle cx="30" cy="${y}" r="4" fill="${color}"/>
      <text x="38" y="${y + 3}" font-size="8.5" font-weight="800" fill="#444">${esc(row.name)}</text>
      <text x="140" y="${y + 3}" font-size="8.5" font-weight="900" fill="#222" text-anchor="end">${esc(row.riskWatch.loans.length)}</text>`;
  });

  return `<svg width="160" height="${legendY + rows.filter(r => r.riskWatch.loans.length > 0).length * 14 + 8}" viewBox="0 0 160 ${legendY + rows.filter(r => r.riskWatch.loans.length > 0).length * 14 + 8}" xmlns="http://www.w3.org/2000/svg">
    <text x="80" y="12" text-anchor="middle" font-size="10" font-weight="950" fill="#1E293B">Risk-Watch Rows</text>
    <g transform="translate(0,20)">${slices.join('')}${labels.join('')}
      <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="24" font-weight="950" fill="#1E293B">${esc(totalRiskWatch)}</text>
      <text x="${cx}" y="${cy + 10}" text-anchor="middle" font-size="8" font-weight="800" fill="#64748B">TOTAL</text>
    </g>
    ${legendItems.join('')}
  </svg>`;
}

function buildBarChartSvg(rows, dateLabel) {
  const COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];
  const categories = ['Sanctioned', 'Renewals Done', 'Risk Watch'];
  const getData = (row, cat) => {
    if (cat === 'Sanctioned') return row.sanctioned.length;
    if (cat === 'Renewals Done') return row.renewalsDone.length;
    if (cat === 'Risk Watch') return row.riskWatch.loans.length;
    return 0;
  };

  const maxVal = Math.max(1, ...rows.flatMap(row => categories.map(cat => getData(row, cat))));
  const chartW = 340, chartH = 160, padL = 30, padB = 30, padT = 30;
  const groupW = (chartW - padL) / categories.length;
  const barW = Math.min(24, (groupW - 20) / rows.length);

  const gridLines = [];
  const step = Math.ceil(maxVal / 4);
  for (let v = 0; v <= maxVal + step; v += step || 1) {
    const y = padT + chartH - (v / (maxVal + step)) * chartH;
    gridLines.push(`<line x1="${padL}" y1="${y}" x2="${padL + chartW - padL}" y2="${y}" stroke="#E2E8F0" stroke-width="0.5"/>`);
    gridLines.push(`<text x="${padL - 4}" y="${y + 3}" text-anchor="end" font-size="7" fill="#94A3B8">${v}</text>`);
  }

  const bars = [];
  categories.forEach((cat, ci) => {
    const gx = padL + ci * groupW + groupW / 2;
    bars.push(`<text x="${gx}" y="${padT + chartH + 14}" text-anchor="middle" font-size="7.5" font-weight="800" fill="#475569">${cat}</text>`);
    rows.forEach((row, ri) => {
      const val = getData(row, cat);
      const bh = (val / (maxVal + step)) * chartH;
      const bx = gx - (rows.length * barW) / 2 + ri * barW + 1;
      const by = padT + chartH - bh;
      const color = COLORS[ri % COLORS.length];
      bars.push(`<rect x="${bx}" y="${by}" width="${barW - 2}" height="${bh}" rx="2" fill="${color}"/>`);
      if (val > 0) bars.push(`<text x="${bx + (barW - 2) / 2}" y="${by - 3}" text-anchor="middle" font-size="7" font-weight="900" fill="${color}">${val}</text>`);
    });
  });

  const legendX = padL + 10;
  const legendItems = rows.map((row, i) => {
    const x = legendX + i * 70;
    const color = COLORS[i % COLORS.length];
    return `<rect x="${x}" y="4" width="8" height="8" rx="2" fill="${color}"/>
      <text x="${x + 11}" y="11" font-size="7.5" font-weight="800" fill="#475569">${esc(row.name)}</text>`;
  });

  const shortDate = dateLabel;

  return `<svg width="${chartW}" height="${padT + chartH + padB + 10}" viewBox="0 0 ${chartW} ${padT + chartH + padB + 10}" xmlns="http://www.w3.org/2000/svg">
    <text x="4" y="14" font-size="11" font-weight="950" fill="#1E293B">Officer Key Metrics Comparison</text>
    <text x="4" y="24" font-size="7" font-weight="700" fill="#94A3B8">Sanctioned, Renewals Done and Risk Watch | ${esc(shortDate)}</text>
    ${legendItems.join('')}
    ${gridLines.join('')}
    ${bars.join('')}
  </svg>`;
}

function buildKeyInsightsSvg(rows) {
  const sanctionedLeader = [...rows].sort((a, b) => b.sanctioned.length - a.sanctioned.length)[0];
  const renewalLeader = [...rows].sort((a, b) => b.renewalsDone.length - a.renewalsDone.length)[0];
  const riskLeader = [...rows].sort((a, b) => b.riskWatch.loans.length - a.riskWatch.loans.length)[0];

  const insightH = 50;
  const totalH = 20 + 3 * insightH + 60;

  const insights = [
    { icon: '📊', label: 'Highest Sanctioned:', name: sanctionedLeader?.name || '—', value: sanctionedLeader?.sanctioned.length || 0, bg: '#ECFDF5', border: '#A7F3D0', color: '#047857' },
    { icon: '🔄', label: 'Renewal Lead:', name: renewalLeader?.name || '—', value: renewalLeader?.renewalsDone.length || 0, bg: '#FFF7ED', border: '#FED7AA', color: '#C2410C' },
    { icon: '⚡', label: 'Risk Watch Lead:', name: riskLeader?.name || '—', value: riskLeader?.riskWatch.loans.length || 0, bg: '#EFF6FF', border: '#BFDBFE', color: '#1D4ED8' },
  ];

  const cards = insights.map((ins, i) => {
    const y = 22 + i * insightH;
    return `<rect x="4" y="${y}" width="142" height="${insightH - 6}" rx="8" fill="${ins.bg}" stroke="${ins.border}" stroke-width="1"/>
      <text x="16" y="${y + 16}" font-size="8" font-weight="800" fill="#64748B">${ins.label}</text>
      <text x="16" y="${y + 30}" font-size="12" font-weight="950" fill="${ins.color}">${esc(ins.name)} ${esc(ins.value)}</text>`;
  });

  const tipY = 22 + 3 * insightH + 4;

  return `<svg width="150" height="${totalH}" viewBox="0 0 150 ${totalH}" xmlns="http://www.w3.org/2000/svg">
    <text x="75" y="14" text-anchor="middle" font-size="10" font-weight="950" fill="#1E293B">Key Insights</text>
    ${cards.join('')}
    <rect x="4" y="${tipY}" width="142" height="40" rx="8" fill="#F8FAFC" stroke="#E2E8F0" stroke-width="1"/>
    <text x="14" y="${tipY + 14}" font-size="6.5" font-weight="700" fill="#64748B">Focus on returned and risk</text>
    <text x="14" y="${tipY + 22}" font-size="6.5" font-weight="700" fill="#64748B">watch accounts to reduce</text>
    <text x="14" y="${tipY + 30}" font-size="6.5" font-weight="700" fill="#64748B">potential losses and improve</text>
    <text x="14" y="${tipY + 38}" font-size="6.5" font-weight="700" fill="#64748B">renewal outcomes.</text>
  </svg>`;
}

function coverOfficerRowV2(row) {
  const riskTone = row.riskWatch.npaRiskCount ? 'danger' : row.riskWatch.loans.length ? 'warn' : 'calm';
  const metrics = [
    { label: 'SANCTIONED', count: row.sanctioned.length, amount: sumAmount(row.sanctioned), tone: 'good' },
    { label: 'PENDING', count: row.pending.length, amount: sumAmount(row.pending), tone: 'warn' },
    { label: 'RETURNED', count: row.returned.length, amount: sumAmount(row.returned), tone: 'soft-danger' },
    { label: 'RENEWALS DONE', count: row.renewalsDone.length, amount: sumAmount(row.renewalsDone), tone: 'blue' },
    { label: 'RISK WATCH', count: row.riskWatch.loans.length, amount: sumAmount(row.riskWatch.loans), tone: riskTone },
  ];

  const metricCells = metrics.map(m => `
    <div class="pdf-cv2-metric ${m.tone}">
      <span>${esc(m.label)}</span>
      <strong>${esc(m.count)}</strong>
      <small>Rs ${esc(fmtAmt(m.amount))}L</small>
    </div>`).join('');

  return `<div class="pdf-cv2-row">
    <div class="pdf-cv2-officer">
      <div class="pdf-cv2-avatar">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>
      </div>
      <div>
        <strong>${esc(row.name)}</strong>
        <span>${esc(row.riskWatch.mode)}</span>
      </div>
    </div>
    <div class="pdf-cv2-metrics">${metricCells}</div>
  </div>`;
}

function buildDetailedSnapshotPdfHtml() {
  const metrics = getLoanMetrics();
  const rows = officerPdfData(metrics);
  const generatedAt = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  const dateLabel = new Date(`${metrics.day}T12:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const totalNpaRisk = rows.reduce((sum, row) => sum + row.riskWatch.npaRiskCount, 0);
  const totalRiskWatch = rows.reduce((sum, row) => sum + row.riskWatch.loans.length, 0);
  const officerPartCounts = rows.map(row => paginateOfficerPdfSections(row).length);
  const totalGlobalPages = 1 + officerPartCounts.reduce((sum, n) => sum + n, 0);
  const ctx = { runningPage: 2, totalGlobalPages };

  const donutSvg = buildDonutChartSvg(rows, totalRiskWatch);
  const barChartSvg = buildBarChartSvg(rows, dateLabel);
  const keyInsightsSvg = buildKeyInsightsSvg(rows);

  return `<div class="pdf-report">
    <style>${detailedSnapshotPdfCss()}</style>
    <section class="pdf-page pdf-cover-page">
      <header class="pdf-brand-row">
        <div>
          <div class="pdf-brand">Nirnay</div>
          <div class="pdf-tagline">DECISIONS | DELIVERED</div>
        </div>
        <div class="pdf-date">${esc(dateLabel)}</div>
      </header>
      <div class="pdf-cover-hero">
        <div>
          <h1>Granular Performance Matrix</h1>
          <p>Account wise Performance data of all Officers</p>
        </div>
        <div class="pdf-risk-badge">
          <span>NPA RISK</span>
          <strong>${esc(totalNpaRisk)}</strong>
          <small>${esc(totalRiskWatch)} RISK-WATCH ROWS</small>
        </div>
      </div>
      <div class="pdf-cover-metrics-v2">
        ${coverMetricHtml("Sanctioned MTD", metrics.sanctionedThisMonth, "good", METRIC_ICONS.sanctioned)}
        ${coverMetricHtml("Pending", metrics.pending, "warn", METRIC_ICONS.pending)}
        ${coverMetricHtml("Returned", metrics.returned, "soft-danger", METRIC_ICONS.returned)}
        ${coverMetricHtml("Renewals Done", metrics.renewalDoneThisMonth, "blue", METRIC_ICONS.renewals)}
        ${coverMetricHtml("Due Soon", metrics.renewalDueSoon, "warn-alt", METRIC_ICONS.dueSoon)}
        ${coverMetricHtml("Overdue / NPA", metrics.renewalOverdue, "danger", METRIC_ICONS.overdue)}
      </div>
      <div class="pdf-cover-body-grid">
        <div class="pdf-cover-officers-col">
          ${rows.map(coverOfficerRowV2).join("")}
        </div>
        <div class="pdf-cover-donut-col">
          ${donutSvg}
        </div>
      </div>
      <div class="pdf-cover-bottom-grid">
        <div class="pdf-cover-bar-col">
          ${barChartSvg}
        </div>
        <div class="pdf-cover-insights-col">
          ${keyInsightsSvg}
        </div>
      </div>
      <footer class="pdf-footer">
        <span class="pdf-footer-brand"><span class="pdf-footer-logo">न</span>Nirnay Loan Tracker</span>
        <span class="pdf-footer-meta">Generated ${esc(generatedAt)} · ${esc(S.user || "Admin")} · AMCC Paonta Sahib</span>
        <span class="pdf-footer-page">Page 1 of ${esc(totalGlobalPages)}${totalGlobalPages > 1 ? `<small>Continued on next page</small>` : ""}</span>
      </footer>
    </section>
    ${rows.map((row, index) => buildOfficerPdfPages(row, index + 1, rows.length, dateLabel, ctx)).join("")}
  </div>`;
}

const CAT_TAG={Agriculture:'A',SME:'S',Education:'E'};
function catTag(loan){const l=CAT_TAG[loan.category]||'?';return `<span class="cat-tag cat-${l}">${l}</span>`;}

function miniFreshRow(loan, dateValue, index) {
  const dateText = fmtDate(dateValue) || "-";
  return `<tr>
    <td class="mini-num">${esc(index)}</td>
    <td class="mini-customer"><strong>${catTag(loan)}${esc(loan.customerName || "Unnamed")}</strong></td>
    <td class="mini-branch">${esc(compactBranch(loan.branch))}</td>
    <td class="mini-amount">${esc(fmtAmt(loan.amount))}</td>
    <td class="mini-date">${esc(dateText)}</td>
  </tr>`;
}

function miniRiskRow(loan, index) {
  const rs = loan._rs || {};
  const daysToNpa = rs.daysUntilNpa != null ? rs.daysUntilNpa : '-';
  return `<tr class="risk-${esc(rs.status || "done")}">
    <td class="mini-num">${esc(index)}</td>
    <td class="mini-customer"><strong>${catTag(loan)}${esc(loan.customerName || "Unnamed")}</strong></td>
    <td class="mini-branch">${esc(compactBranch(loan.branch))}</td>
    <td class="mini-amount">${esc(fmtAmt(loan.amount))}</td>
    <td class="mini-date mini-days">${esc(daysToNpa)}</td>
  </tr>`;
}
function miniRenewalDoneRow(loan, index) {
  const dateText = fmtDate(loan.renewedDate) || "-";
  return `<tr>
    <td class="mini-num">${esc(index)}</td>
    <td class="mini-customer"><strong>${catTag(loan)}${esc(loan.customerName || "Unnamed")}</strong></td>
    <td class="mini-branch">${esc(compactBranch(loan.branch))}</td>
    <td class="mini-amount">${esc(fmtAmt(loan.amount))}</td>
    <td class="mini-date">${esc(dateText)}</td>
  </tr>`;
}
function sortByDateAsc(loans, key) { return [...loans].sort((a, b) => (a[key]||'').localeCompare(b[key]||'')); }
function sortByDaysToNpaAsc(loans) { return [...loans].sort((a, b) => (a._rs?.daysUntilNpa??9999)-(b._rs?.daysUntilNpa??9999)); }

function buildOfficerPdfSections(row) {
  return [
    {
      title: "Risk Watch",
      loans: sortByDaysToNpaAsc(row.riskWatch.loans),
      renderer: (loan, index) => miniRiskRow(loan, index),
      tone: row.riskWatch.npaRiskCount ? "danger" : "warn",
      sub: row.riskWatch.mode,
      dateHeader: "Days to NPA",
    },
    {
      title: "Pending",
      loans: sortByDateAsc(row.pending, 'receiveDate'),
      renderer: (loan, index) => miniFreshRow(loan, loan.receiveDate, index),
      tone: "warn",
      sub: "Current fresh pipeline",
      dateHeader: "Recd Date",
    },
    {
      title: "Sanctioned",
      loans: sortByDateAsc(row.sanctioned, 'sanctionDate'),
      renderer: (loan, index) => miniFreshRow(loan, loan.sanctionDate, index),
      tone: "good",
      sub: "Month-to-date fresh sanctions",
      dateHeader: "Sanctioned Date",
    },
    {
      title: "Returned",
      loans: sortByDateAsc(row.returned, 'returnedDate'),
      renderer: (loan, index) => miniFreshRow(loan, loan.returnedDate, index),
      tone: "soft-danger",
      sub: "Fresh cases needing rework",
      dateHeader: "Returned Date",
    },
    {
      title: "Renewals Done",
      loans: sortByDateAsc(row.renewalsDone, 'renewedDate'),
      renderer: (loan, index) => miniRenewalDoneRow(loan, index),
      tone: "blue",
      sub: "Month-to-date completions",
      dateHeader: "Renewed Date",
    },
  ];
}

function paginateOfficerPdfSections(row) {
  const source = buildOfficerPdfSections(row).map(section => ({
    ...section,
    cursor: 0,
    emittedEmpty: false,
  }));
  const pages = [];
  const firstPageUnits = 40;
  const continuationUnits = 48;
  const sectionBaseUnits = 2;

  while (source.some(section => section.cursor < section.loans.length || (!section.loans.length && !section.emittedEmpty))) {
    const chunks = [];
    let unitsLeft = pages.length ? continuationUnits : firstPageUnits;

    for (const section of source) {
      if (unitsLeft <= sectionBaseUnits) break;
      if (!section.loans.length) {
        if (section.emittedEmpty) continue;
        chunks.push({ ...section, pageLoans: [], continuedBefore: false, continuedAfter: false });
        section.emittedEmpty = true;
        unitsLeft -= sectionBaseUnits;
        continue;
      }
      if (section.cursor >= section.loans.length) continue;

      const start = section.cursor;
      const maxRows = Math.max(2, (unitsLeft - sectionBaseUnits) * 2);
      const end = Math.min(section.loans.length, start + maxRows);
      const rowsUsed = end - start;
      chunks.push({
        ...section,
        pageLoans: section.loans.slice(start, end),
        continuedBefore: start > 0,
        continuedAfter: end < section.loans.length,
        start,
        end,
      });
      section.cursor = end;
      unitsLeft -= sectionBaseUnits + Math.ceil(rowsUsed / 2);
    }

    if (!chunks.length) {
      const section = source.find(item => item.cursor < item.loans.length);
      chunks.push({
        ...section,
        pageLoans: section.loans.slice(section.cursor, section.cursor + 2),
        continuedBefore: section.cursor > 0,
        continuedAfter: section.cursor + 2 < section.loans.length,
        start: section.cursor,
        end: Math.min(section.cursor + 2, section.loans.length),
      });
      section.cursor += 2;
    }

    pages.push(chunks);
    if (pages.length > 40) break;
  }

  return pages.length ? pages : [[]];
}

function compactPdfSection(section) {
  const visible = section.pageLoans || [];
  const total = section.loans.length;
  const range = total && visible.length
    ? `${(section.start || 0) + 1}-${section.end || visible.length} of ${total}`
    : `${total} item${total === 1 ? "" : "s"}`;
  const title = section.continuedBefore ? `${section.title} continued` : section.title;
  const sub = section.continuedAfter ? `${section.sub} - continues next page` : section.sub;
  return `<section class="pdf-section ${section.tone}">
    <div class="pdf-section-head">
      <h3>${esc(title)}</h3>
      <span>${esc(range)}${sub ? ` · ${esc(sub)}` : ""}</span>
    </div>
    <div class="pdf-loan-list">
      ${visible.length ? visible.map(section.renderer).join("") : '<div class="pdf-empty">No accounts in this section</div>'}
    </div>
  </section>`;
}

function compactPdfSectionV2(section) {
  const visible = section.pageLoans || [];
  const total = section.loans.length;
  const range = total && visible.length
    ? `${(section.start || 0) + 1}-${section.end || visible.length} of ${total}`
    : `${total} item${total === 1 ? "" : "s"}`;
  const title = section.continuedBefore ? `${section.title} continued` : section.title;
  const sub = section.continuedAfter ? `${section.sub} - continued on next page` : section.sub;
  const start = section.start || 0;
  const dateHeader = section.dateHeader || "Key Date";

  const head = `<thead><tr>
    <th class="mini-num">#</th>
    <th class="mini-customer">Customer</th>
    <th class="mini-branch">Br</th>
    <th class="mini-amount">Rs L</th>
    <th class="mini-date">${esc(dateHeader)}</th>
  </tr></thead>`;

  let body;
  if (!visible.length) {
    body = `<table class="pdf-mini-table mini-only">${head}<tbody><tr class="mini-empty"><td colspan="5">No accounts in this section</td></tr></tbody></table>`;
  } else if (visible.length === 1) {
    const row = section.renderer(visible[0], start + 1);
    body = `<table class="pdf-mini-table mini-only">${head}<tbody>${row}</tbody></table>`;
  } else {
    const leftCount = Math.ceil(visible.length / 2);
    const leftRows = visible.slice(0, leftCount).map((loan, i) => section.renderer(loan, start + i + 1)).join("");
    const rightSlice = visible.slice(leftCount);
    const rightRows = rightSlice.map((loan, i) => section.renderer(loan, start + leftCount + i + 1)).join("")
      + (rightSlice.length < leftCount ? '<tr class="mini-blank"><td colspan="5">&nbsp;</td></tr>' : "");
    body = `<table class="pdf-mini-table">${head}<tbody>${leftRows}</tbody></table>` +
           `<table class="pdf-mini-table">${head}<tbody>${rightRows}</tbody></table>`;
  }

  return `<section class="pdf-section pdf-section-cards tone-${section.tone}${visible.length <= 1 ? " is-single" : ""}">
    <header class="pdf-section-band">
      <h3>${esc(title)}</h3>
      <span>${esc(range)}${sub ? ` · ${esc(sub)}` : ""}</span>
    </header>
    <div class="pdf-section-body">${body}</div>
  </section>`;
}

function buildOfficerPdfPages(row, pageNo, totalPages, dateLabel, ctx) {
  const pages = paginateOfficerPdfSections(row);
  return pages.map((sections, index) => {
    const globalPageNo = ctx.runningPage++;
    const isLastOfficerPart = index === pages.length - 1;
    const isLastOfficer = pageNo === totalPages;
    const continuedAfter = !(isLastOfficerPart && isLastOfficer);
    return buildCompactOfficerPdfPageV2(row, pageNo, totalPages, dateLabel, sections, index + 1, pages.length, {
      globalPageNo,
      totalGlobalPages: ctx.totalGlobalPages,
      continuedAfter,
    });
  }).join("");
}

function buildCompactOfficerPdfPage(row, pageNo, totalPages, dateLabel, sections, partNo, totalParts) {
  const metricStrip = `
    ${metricHtml("Sanctioned", row.sanctioned, "good")}
    ${metricHtml("Pending", row.pending, "warn")}
    ${metricHtml("Returned", row.returned, "soft-danger")}
    ${metricHtml("Renewals Done", row.renewalsDone, "good")}
    ${metricHtml("Risk Watch", row.riskWatch.loans, row.riskWatch.npaRiskCount ? "danger" : "warn")}
  `;
  const partLabel = totalParts > 1 ? ` - Part ${partNo} of ${totalParts}` : "";
  const officerCode = `OFF-${String(pageNo).padStart(3, "0")}`;
  const continued = partNo < totalParts;
  return `<section class="pdf-page pdf-officer-page ${partNo > 1 ? "is-continuation" : ""}">
    <header class="pdf-officer-head">
      <div>
        <span class="pdf-kicker">Officer ${esc(pageNo)} of ${esc(totalPages)}${esc(partLabel)}</span>
        <h2>${esc(row.name)}</h2>
        <p>${esc(dateLabel)} · ${esc(partNo > 1 ? "continued details" : "section cards detail")}</p>
      </div>
      <div class="pdf-officer-total">
        <strong>${esc(row.totalWork)}</strong>
        <span>total rows</span>
      </div>
    </header>
    ${partNo === 1 ? `<div class="pdf-officer-metrics">${metricStrip}</div>` : ""}
    <div class="pdf-detail-stack">
      ${sections.map(compactPdfSectionV2).join("")}
    </div>
    <footer class="pdf-footer">
      <span>Detailed Snapshot · ${esc(row.name)}${esc(partLabel)}</span>
      <span>Nirnay</span>
    </footer>
  </section>`;
}

function buildCompactOfficerPdfPageV2(row, pageNo, totalPages, dateLabel, sections, partNo, totalParts, paging) {
  const metricStrip = `
    ${metricHtml("Risk Watch", row.riskWatch.loans, row.riskWatch.npaRiskCount ? "danger" : "warn")}
    ${metricHtml("Pending", row.pending, "warn")}
    ${metricHtml("Sanctioned", row.sanctioned, "good")}
    ${metricHtml("Returned", row.returned, "soft-danger")}
    ${metricHtml("Renewals Done", row.renewalsDone, "blue")}
  `;
  const partLabel = totalParts > 1 ? ` - Part ${partNo} of ${totalParts}` : "";
  const officerCode = `OFF-${String(pageNo).padStart(3, "0")}`;
  const isContinuation = partNo > 1;
  const { globalPageNo, totalGlobalPages, continuedAfter } = paging || {};
  return `<section class="pdf-page pdf-officer-page ${isContinuation ? "is-continuation" : ""}">
    <header class="pdf-officer-head">
      <div class="pdf-officer-brand">
        <span class="pdf-mini-logo">न</span>
        <div>
          <strong>Nirnay</strong>
          <small>Loan Tracker</small>
        </div>
      </div>
      <div class="pdf-officer-report-title">
        <strong>Officer Detailed Snapshot</strong>
        <span>${esc(dateLabel)}</span>
      </div>
    </header>
    <div class="pdf-officer-title-row">
      <div>
        <span class="pdf-kicker">Officer ${esc(pageNo)} of ${esc(totalPages)}${esc(partLabel)}</span>
        <h2>Officer: ${esc(row.name)}</h2>
      </div>
      ${isContinuation ? "" : `<div class="pdf-officer-code">Officer Code: ${esc(officerCode)}</div>`}
    </div>
    ${partNo === 1 ? `<div class="pdf-officer-metrics">${metricStrip}</div>` : ""}
    <div class="pdf-detail-stack">
      ${sections.map(compactPdfSectionV2).join("")}
    </div>
    <footer class="pdf-footer">
      <span class="pdf-footer-brand"><span class="pdf-footer-logo">न</span>Nirnay Loan Tracker</span>
      <span class="pdf-footer-meta">All amounts in Rs Lakhs</span>
      <span class="pdf-footer-page">Page ${esc(globalPageNo)} of ${esc(totalGlobalPages)}${continuedAfter ? `<small>Continued on next page</small>` : ""}</span>
    </footer>
  </section>`;
}

function buildOfficerPdfPage(row, pageNo, totalPages, dateLabel) {
  const metricStrip = `
    ${metricHtml("Pending", row.pending, "warn")}
    ${metricHtml("Sanctioned", row.sanctioned, "good")}
    ${metricHtml("Returned", row.returned, "soft-danger")}
    ${metricHtml("Renewals Done", row.renewalsDone, "good")}
    ${metricHtml("Risk Watch", row.riskWatch.loans, row.riskWatch.npaRiskCount ? "danger" : "warn")}
  `;
  return `<section class="pdf-page pdf-officer-page">
    <header class="pdf-officer-head">
      <div>
        <span class="pdf-kicker">Officer ${esc(pageNo)} of ${esc(totalPages)}</span>
        <h2>${esc(row.name)}</h2>
        <p>${esc(dateLabel)} · ${esc(row.riskWatch.mode)}</p>
      </div>
      <div class="pdf-officer-total">
        <strong>${esc(row.totalWork)}</strong>
        <span>total rows</span>
      </div>
    </header>
    <div class="pdf-officer-metrics">${metricStrip}</div>
    <div class="pdf-detail-grid">
      ${pdfSection("Risk Watch", row.riskWatch.loans, loan => renewalLoanLine(loan, "risk"), row.riskWatch.npaRiskCount ? "danger" : "warn", row.riskWatch.mode)}
      ${pdfSection("Pending", row.pending, loan => freshLoanLine(loan, "Recd", loan.receiveDate), "warn")}
      ${pdfSection("Sanctioned", row.sanctioned, loan => freshLoanLine(loan, "Sanctioned", loan.sanctionDate), "good")}
      ${pdfSection("Returned", row.returned, loan => freshLoanLine(loan, "Returned", loan.returnedDate), "soft-danger")}
      ${pdfSection("Renewals Done", row.renewalsDone, loan => renewalLoanLine(loan, "done"), "good")}
    </div>
    <footer class="pdf-footer">
      <span>Detailed Snapshot · ${esc(row.name)}</span>
      <span>Nirnay</span>
    </footer>
  </section>`;
}

function detailedSnapshotPdfCss() {
  return `
    .pdf-report{width:${PDF_PAGE_WIDTH}px;background:#EDE8F4;color:#15122D;font-family:'Outfit','Inter','Segoe UI',Arial,sans-serif}
    .pdf-page{width:${PDF_PAGE_WIDTH}px;height:${PDF_PAGE_HEIGHT}px;position:relative;overflow:hidden;background:#FBFAF7;padding:30px 30px 36px;box-sizing:border-box}
    .pdf-page + .pdf-page{margin-top:20px}
    .pdf-cover-page{background:#FBFAF7}
    .pdf-cover-page::before{content:"";position:absolute;left:0;right:0;top:0;height:140px;background:linear-gradient(180deg,#F1ECFB 0%,rgba(241,236,251,0) 100%);pointer-events:none}
    .pdf-cover-page > *{position:relative}
    .pdf-brand-row,.pdf-officer-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}
    .pdf-brand{font-size:30px;font-weight:950;letter-spacing:-0.04em}
    .pdf-tagline,.pdf-kicker{font-size:10px;font-weight:950;letter-spacing:.16em;text-transform:uppercase;color:#6B5FBF}
    .pdf-date{font-size:14px;font-weight:900;color:#4A4467}
    .pdf-cover-hero{display:grid;grid-template-columns:1fr 150px;gap:18px;margin-top:30px;align-items:stretch}
    .pdf-cover-hero h1{margin:8px 0 8px;font-size:44px;line-height:.94;letter-spacing:-.06em}
    .pdf-cover-hero p{margin:0;color:#5F5A78;font-size:15px;line-height:1.45;max-width:440px}
    .pdf-risk-badge{border-radius:24px;background:linear-gradient(150deg,#7F1D1D,#F59E0B);color:#fff;padding:18px;text-align:center;box-shadow:0 18px 36px rgba(127,29,29,.18)}
    .pdf-risk-badge span,.pdf-risk-badge small{display:block;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.12em;opacity:.82}
    .pdf-risk-badge strong{display:block;font-size:46px;line-height:1;margin:10px 0 6px}
    .pdf-cover-metrics-v2{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin:18px 0 14px}
    .pdf-metric-v2{display:flex;align-items:center;gap:8px;border-radius:12px;padding:8px 10px;background:#F4F1FB;border:1px solid rgba(107,95,191,.10);min-width:0}
    .pdf-metric-v2-icon{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;background:#fff;flex-shrink:0}
    .pdf-metric-v2-body{min-width:0}
    .pdf-metric-v2-body span{display:block;font-size:7px;font-weight:950;letter-spacing:.08em;text-transform:uppercase;color:#756F91;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pdf-metric-v2-body strong{display:block;font-size:20px;line-height:1;margin-top:2px}
    .pdf-metric-v2-body small{display:block;margin-top:2px;font-size:8px;font-weight:850;color:#4D4868;white-space:nowrap}
    .pdf-metric-v2.good{background:#ECFDF5;border-color:#A7F3D0;color:#047857}
    .pdf-metric-v2.good .pdf-metric-v2-icon{background:#D1FAE5;color:#047857}
    .pdf-metric-v2.warn{background:#FFF7ED;border-color:#FED7AA;color:#C2410C}
    .pdf-metric-v2.warn .pdf-metric-v2-icon{background:#FFEDD5;color:#C2410C}
    .pdf-metric-v2.warn-alt{background:#FFFBEB;border-color:#FDE68A;color:#92400E}
    .pdf-metric-v2.warn-alt .pdf-metric-v2-icon{background:#FEF3C7;color:#92400E}
    .pdf-metric-v2.danger{background:#FEF2F2;border-color:#FECACA;color:#B91C1C}
    .pdf-metric-v2.danger .pdf-metric-v2-icon{background:#FEE2E2;color:#B91C1C}
    .pdf-metric-v2.soft-danger{background:#FFF1F2;border-color:#FFE1E5;color:#DC2626}
    .pdf-metric-v2.soft-danger .pdf-metric-v2-icon{background:#FFE4E6;color:#DC2626}
    .pdf-metric-v2.blue{background:#EFF6FF;border-color:#BFDBFE;color:#1D4ED8}
    .pdf-metric-v2.blue .pdf-metric-v2-icon{background:#DBEAFE;color:#1D4ED8}
    .pdf-metric-v2.good strong,.pdf-metric-v2.warn strong,.pdf-metric-v2.warn-alt strong,.pdf-metric-v2.danger strong,.pdf-metric-v2.soft-danger strong,.pdf-metric-v2.blue strong{color:inherit}

    .pdf-cover-body-grid{display:grid;grid-template-columns:1fr 180px;gap:14px;margin:10px 0 10px}
    .pdf-cover-officers-col{display:flex;flex-direction:column;gap:7px}
    .pdf-cover-donut-col{display:flex;align-items:flex-start;justify-content:center;padding:6px 0}

    .pdf-cv2-row{display:grid;grid-template-columns:140px 1fr;gap:8px;align-items:center;background:#fff;border:1px solid rgba(35,25,70,.08);border-radius:12px;padding:8px 10px;box-shadow:0 4px 10px rgba(45,35,85,.035)}
    .pdf-cv2-officer{display:flex;align-items:center;gap:8px}
    .pdf-cv2-avatar{display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:#F1F5F9;flex-shrink:0}
    .pdf-cv2-officer strong{display:block;font-size:13px;font-weight:950;color:#1E293B;line-height:1.15}
    .pdf-cv2-officer span{display:block;margin-top:2px;font-size:7px;font-weight:900;color:#8B5E00;text-transform:uppercase;letter-spacing:.06em;line-height:1.1}
    .pdf-cv2-metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:5px}
    .pdf-cv2-metric{border-radius:8px;padding:6px 7px;background:#F4F1FB;border:1px solid rgba(107,95,191,.10);min-width:0}
    .pdf-cv2-metric span{display:block;font-size:6.5px;font-weight:950;letter-spacing:.06em;text-transform:uppercase;color:#756F91;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pdf-cv2-metric strong{display:block;font-size:17px;line-height:1;margin-top:1px}
    .pdf-cv2-metric small{display:block;margin-top:1px;font-size:7.5px;font-weight:850;color:#4D4868;white-space:nowrap}
    .pdf-cv2-metric.good{background:#ECFDF5;border-color:#A7F3D0;color:#047857}
    .pdf-cv2-metric.warn{background:#FFF7ED;border-color:#FED7AA;color:#C2410C}
    .pdf-cv2-metric.danger{background:#FEF2F2;border-color:#FECACA;color:#B91C1C}
    .pdf-cv2-metric.soft-danger{background:#FFF1F2;border-color:#FFE1E5;color:#DC2626}
    .pdf-cv2-metric.blue{background:#EFF6FF;border-color:#BFDBFE;color:#1D4ED8}
    .pdf-cv2-metric.calm{background:#F8FAFC;border-color:#E2E8F0;color:#475569}
    .pdf-cv2-metric.good strong,.pdf-cv2-metric.warn strong,.pdf-cv2-metric.danger strong,.pdf-cv2-metric.soft-danger strong,.pdf-cv2-metric.blue strong,.pdf-cv2-metric.calm strong{color:inherit}

    .pdf-cover-bottom-grid{display:grid;grid-template-columns:1fr 170px;gap:14px;margin:8px 0 0;background:#fff;border:1px solid rgba(35,25,70,.08);border-radius:14px;padding:14px;box-shadow:0 4px 12px rgba(45,35,85,.035)}

    .pdf-cover-metrics{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin:24px 0 18px}
    .pdf-cover-table{display:flex;flex-direction:column;gap:9px}
    .pdf-cover-row{display:grid;grid-template-columns:1.24fr repeat(5,1fr);gap:7px;align-items:stretch;background:#fff;border:1px solid rgba(35,25,70,.08);border-radius:14px;padding:8px;box-shadow:0 6px 14px rgba(45,35,85,.04)}
    .pdf-cover-officer{padding:8px 10px}
    .pdf-cover-officer strong{display:block;font-size:18px}
    .pdf-cover-officer span{display:block;margin-top:4px;font-size:9px;font-weight:900;color:#8B5E00;text-transform:uppercase;letter-spacing:.08em}
    .pdf-metric{min-width:0;border-radius:12px;background:#F4F1FB;border:1px solid rgba(107,95,191,.10);padding:9px 10px}
    .pdf-metric span{display:block;font-size:8px;font-weight:950;letter-spacing:.08em;text-transform:uppercase;color:#756F91;white-space:nowrap}
    .pdf-metric strong{display:block;font-size:22px;line-height:1;margin-top:3px}
    .pdf-metric small{display:block;margin-top:3px;font-size:9px;font-weight:850;color:#4D4868;white-space:nowrap}
    .pdf-metric.good{background:#ECFDF5;border-color:#A7F3D0;color:#047857}
    .pdf-metric.warn{background:#FFF7ED;border-color:#FED7AA;color:#C2410C}
    .pdf-metric.danger{background:#FEF2F2;border-color:#FECACA;color:#B91C1C}
    .pdf-metric.soft-danger{background:#FFF1F2;border-color:#FFE1E5;color:#DC2626}
    .pdf-metric.blue{background:#EFF6FF;border-color:#BFDBFE;color:#1D4ED8}
    .pdf-metric.calm{background:#F8FAFC;border-color:#E2E8F0;color:#475569}
    .pdf-metric.good strong,.pdf-metric.warn strong,.pdf-metric.danger strong,.pdf-metric.soft-danger strong,.pdf-metric.blue strong{color:inherit}

    .pdf-officer-page{background:#FFFFFF;padding:26px 28px 36px}
    .pdf-officer-head{align-items:center}
    .pdf-officer-brand{display:flex;align-items:center;gap:10px}
    .pdf-mini-logo{display:grid;place-items:center;width:36px;height:36px;border-radius:9px;background:#13234C;color:#fff;font-size:22px;font-weight:950}
    .pdf-officer-brand strong{display:block;font-size:20px;line-height:1;color:#0B173F}
    .pdf-officer-brand small{display:block;margin-top:3px;font-size:10px;font-weight:900;color:#0F766E}
    .pdf-officer-report-title{text-align:right}
    .pdf-officer-report-title strong{display:block;font-size:12px;font-weight:950;color:#0B173F;letter-spacing:.04em;text-transform:uppercase}
    .pdf-officer-report-title span{display:block;margin-top:5px;font-size:12px;font-weight:800;color:#615B7C}
    .pdf-officer-title-row{display:flex;justify-content:space-between;align-items:end;gap:18px;margin:20px 0 14px}
    .pdf-officer-title-row .pdf-kicker{display:block;margin-bottom:6px}
    .pdf-officer-title-row h2{margin:0;font-size:30px;line-height:1;letter-spacing:-.04em;color:#102151}
    .pdf-officer-code{font-size:11px;font-weight:850;color:#615B7C;white-space:nowrap}
    .pdf-officer-metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;margin:0 0 14px}
    .pdf-officer-metrics .pdf-metric{border-radius:9px;padding:9px 10px;min-height:54px}
    .pdf-officer-metrics .pdf-metric span{font-size:8px;white-space:normal}
    .pdf-officer-metrics .pdf-metric strong{font-size:20px}
    .pdf-officer-metrics .pdf-metric small{font-size:8.4px;white-space:normal}
    .pdf-officer-page.is-continuation .pdf-officer-title-row h2{font-size:24px}
    .pdf-officer-page.is-continuation .pdf-officer-title-row{margin-bottom:14px}
    .pdf-officer-page.is-continuation .pdf-officer-metrics{display:none}

    .pdf-detail-stack{display:flex;flex-direction:column;gap:9px}
    .pdf-section.pdf-section-cards{background:#fff;border:1px solid rgba(35,25,70,.10);border-radius:10px;overflow:hidden;box-shadow:0 6px 16px rgba(25,18,52,.035)}
    .pdf-section-band{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 12px;background:#F8FAFC;border-bottom:1px solid rgba(35,25,70,.08)}
    .pdf-section-band h3{margin:0;font-size:13px;line-height:1;color:#102151}
    .pdf-section-band span{font-size:9px;font-weight:850;color:#5F5A78;text-align:right;line-height:1.2;max-width:60%}
    .pdf-section-cards.tone-good .pdf-section-band{background:#DCFCE7;color:#047857}
    .pdf-section-cards.tone-good .pdf-section-band h3{color:#047857}
    .pdf-section-cards.tone-warn .pdf-section-band{background:#FFF1E5;color:#C2410C}
    .pdf-section-cards.tone-warn .pdf-section-band h3{color:#C2410C}
    .pdf-section-cards.tone-danger .pdf-section-band{background:#FEE2E2;color:#B91C1C}
    .pdf-section-cards.tone-danger .pdf-section-band h3{color:#B91C1C}
    .pdf-section-cards.tone-soft-danger .pdf-section-band{background:#FEE7EA;color:#DC2626}
    .pdf-section-cards.tone-soft-danger .pdf-section-band h3{color:#DC2626}
    .pdf-section-cards.tone-blue .pdf-section-band{background:#DBEAFE;color:#1D4ED8}
    .pdf-section-cards.tone-blue .pdf-section-band h3{color:#1D4ED8}

    .pdf-section-body{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:6px 12px 8px}
    .pdf-section-cards.is-single .pdf-section-body{grid-template-columns:1fr}

    .pdf-mini-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8.6px;color:#15122D}
    .pdf-mini-table thead th{padding:5px 4px 4px;border-bottom:1px solid rgba(35,25,70,.10);font-size:7px;font-weight:950;text-transform:uppercase;letter-spacing:.06em;color:#515A75;text-align:left;background:transparent}
    .pdf-mini-table thead th.mini-amount,.pdf-mini-table thead th.mini-date{text-align:right}
    .pdf-mini-table tbody td{padding:5px 4px;vertical-align:top;border-bottom:1px solid rgba(35,25,70,.06);line-height:1.18}
    .pdf-mini-table tbody tr:last-child td{border-bottom:0}
    .pdf-mini-table tbody tr.mini-blank td{visibility:hidden;border-bottom:0}
    .pdf-mini-table tbody tr.mini-empty td{text-align:center;color:#8D88A6;font-size:9px;font-weight:850;padding:14px 6px;background:#FAF9FE;border-bottom:0}
    .pdf-mini-table th.mini-num,.pdf-mini-table td.mini-num{width:16px;color:#4B5270;font-weight:950;font-size:7.6px;text-align:right;padding-right:4px}
    .pdf-mini-table th.mini-customer,.pdf-mini-table td.mini-customer{width:auto}
    .pdf-mini-table th.mini-branch,.pdf-mini-table td.mini-branch{width:40px;font-size:7.4px;font-weight:820;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center}
    .pdf-mini-table th.mini-amount,.pdf-mini-table td.mini-amount{width:40px;font-size:8.4px;font-weight:950;color:#111B42;text-align:right;white-space:nowrap}
    .pdf-mini-table th.mini-date,.pdf-mini-table td.mini-date{width:70px;font-size:7.4px;font-weight:820;color:#475569;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pdf-mini-table td.mini-customer strong{display:block;font-size:9px;line-height:1.15;color:#111B42;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:900}
    .pdf-mini-table td.mini-date.mini-days{font-size:9px;font-weight:950;color:#B91C1C;text-align:center}
    .cat-tag{display:inline-block;font-size:6.5px;font-weight:950;padding:1px 3px;border-radius:3px;margin-right:3px;vertical-align:middle;letter-spacing:.04em;color:#fff}
    .cat-tag.cat-A{background:#047857}
    .cat-tag.cat-S{background:#1D4ED8}
    .cat-tag.cat-E{background:#9333EA}

    .pdf-footer{position:absolute;left:28px;right:28px;bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:14px;color:#8983A1;font-size:9px;font-weight:850}
    .pdf-footer-brand{display:flex;align-items:center;gap:6px;color:#0B173F;font-weight:900}
    .pdf-footer-logo{display:grid;place-items:center;width:14px;height:14px;border-radius:4px;background:#13234C;color:#fff;font-size:9px;font-weight:950}
    .pdf-footer-meta{color:#615B7C;text-align:center;flex:1}
    .pdf-footer-page{display:flex;flex-direction:column;align-items:flex-end;gap:2px;color:#102151;font-weight:900}
    .pdf-footer-page small{display:block;font-size:8px;font-weight:800;color:#8983A1;letter-spacing:.04em;text-transform:none}
  `;
}


export { buildDetailedSnapshotPdfHtml, miniFreshRow, miniRiskRow, miniRenewalDoneRow, buildOfficerPdfSections, paginateOfficerPdfSections, compactPdfSection, compactPdfSectionV2, buildOfficerPdfPages, buildCompactOfficerPdfPage, buildCompactOfficerPdfPageV2, buildOfficerPdfPage, detailedSnapshotPdfCss };
