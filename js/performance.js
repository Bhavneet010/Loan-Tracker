import { S } from "./state.js";
import { getLoanMetrics, sumAmount } from "./derived.js";
import { catCls, esc, fmtAmt, fmtDate, shortCat, toast } from "./utils.js";

let html2canvasLoadPromise = null;
let jsPdfLoadPromise = null;

const CATS = ["Agriculture", "SME", "Education"];
const TREND_COLORS = {
  fresh: "#6B5FBF",
  renewal: "#10B981",
  officerA: "#6B5FBF",
  officerB: "#F59E0B",
  officerC: "#EC4899",
  officerD: "#0EA5E9",
};

const amountOf = loan => parseFloat(loan.amount) || 0;

function monthDays(month) {
  const [year, mon] = month.split("-").map(Number);
  const count = new Date(year, mon, 0).getDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

function trendBuckets(month, scale) {
  const days = monthDays(month);
  if (scale === "daily") {
    return {
      label: `${days.length} days`,
      labels: days.map(date => date.slice(8)),
      indexByDate: new Map(days.map((date, index) => [date, index])),
    };
  }

  const ranges = [];
  for (let start = 1; start <= days.length; start += 7) {
    const end = Math.min(start + 6, days.length);
    ranges.push({ start, end, label: start === end ? `${start}` : `${start}-${end}` });
  }
  const indexByDate = new Map();
  days.forEach(date => {
    const day = Number(date.slice(8));
    indexByDate.set(date, Math.floor((day - 1) / 7));
  });
  return {
    label: "weekly",
    labels: ranges.map((range, index) => `W${index + 1} ${range.label}`),
    indexByDate,
  };
}

function groupAmountByBucket(loans, dateKey, buckets) {
  const totals = buckets.labels.map(() => 0);
  loans.forEach(loan => {
    const date = loan[dateKey] || "";
    const index = buckets.indexByDate.get(date);
    if (index !== undefined) totals[index] += amountOf(loan);
  });
  return totals;
}

function buildOfficerTotals(loans) {
  const byOfficer = new Map();
  S.officers.forEach(officer => byOfficer.set(officer, { name: officer, total: 0 }));
  loans.forEach(loan => {
    const name = loan.allocatedTo || "Unassigned";
    if (!byOfficer.has(name)) byOfficer.set(name, { name, total: 0 });
    byOfficer.get(name).total += amountOf(loan);
  });
  return Array.from(byOfficer.values())
    .filter(row => row.total > 0)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

function buildTrendDatasets(metrics, buckets, mode = "all") {
  const freshMonth = metrics.sanctionedThisMonth;
  const renewalMonth = metrics.renewalDoneThisMonth;

  if (mode === "all") {
    return {
      labels: buckets.labels,
      datasets: [
        {
          label: "Fresh sanctions",
          data: groupAmountByBucket(freshMonth, "sanctionDate", buckets),
          borderColor: TREND_COLORS.fresh,
          backgroundColor: TREND_COLORS.fresh,
          labelMode: "anchors",
          tension: 0.32,
        },
        {
          label: "Renewals done",
          data: groupAmountByBucket(renewalMonth, "renewedDate", buckets),
          borderColor: TREND_COLORS.renewal,
          backgroundColor: TREND_COLORS.renewal,
          labelMode: "anchors",
          tension: 0.32,
        },
      ],
    };
  }

  const source = mode === "fresh-officers" ? freshMonth : renewalMonth;
  const dateKey = mode === "fresh-officers" ? "sanctionDate" : "renewedDate";
  const palette = [TREND_COLORS.officerA, TREND_COLORS.officerB, TREND_COLORS.officerC, TREND_COLORS.officerD];

  return {
    labels: buckets.labels,
    datasets: buildOfficerTotals(source).slice(0, 3).map((row, index) => ({
      label: row.name,
      data: groupAmountByBucket(source.filter(loan => (loan.allocatedTo || "Unassigned") === row.name), dateKey, buckets),
      borderColor: palette[index % palette.length],
      backgroundColor: palette[index % palette.length],
      labelMode: "end",
      tension: 0.32,
    })),
  };
}

function buildLeaderboardRows(loans, kind) {
  const byOfficer = new Map();
  S.officers.forEach(officer => byOfficer.set(officer, {
    name: officer,
    total: 0,
    count: 0,
    cats: Object.fromEntries(CATS.map(cat => [cat, { count: 0, amount: 0 }])),
    due: 0,
    od: 0,
  }));

  const ensure = name => {
    const key = name || "Unassigned";
    if (!byOfficer.has(key)) byOfficer.set(key, {
      name: key,
      total: 0,
      count: 0,
      cats: Object.fromEntries(CATS.map(cat => [cat, { count: 0, amount: 0 }])),
      due: 0,
      od: 0,
    });
    return byOfficer.get(key);
  };

  loans.forEach(loan => {
    const row = ensure(loan.allocatedTo);
    const amount = amountOf(loan);
    row.total += amount;
    row.count++;
    if (row.cats[loan.category]) {
      row.cats[loan.category].count++;
      row.cats[loan.category].amount += amount;
    }
    if (kind === "renewal" && loan._rs) {
      if (loan._rs.status === "due-soon" && !loan.renewedDate) row.due++;
      if ((loan._rs.status === "pending-renewal" || loan._rs.status === "npa") && !loan.renewedDate) row.od++;
    }
  });

  const ranked = Array.from(byOfficer.values())
    .sort((a, b) => b.total - a.total || b.count - a.count || a.name.localeCompare(b.name));
  const max = ranked.length ? ranked[0].total : 1;
  return ranked.map((row, index) => ({ ...row, rank: index + 1, pct: max > 0 ? Math.round(row.total / max * 100) : 0 }));
}

function summaryRows(loans) {
  const rows = S.officers.map(officer => ({
    officer,
    total: 0,
    count: 0,
    cats: Object.fromEntries(CATS.map(cat => [cat, { count: 0, amount: 0 }])),
  }));
  const byOfficer = new Map(rows.map(row => [row.officer, row]));
  const ensure = officer => {
    const key = officer || "Unassigned";
    if (!byOfficer.has(key)) {
      const row = { officer: key, total: 0, count: 0, cats: Object.fromEntries(CATS.map(cat => [cat, { count: 0, amount: 0 }])) };
      byOfficer.set(key, row);
      rows.push(row);
    }
    return byOfficer.get(key);
  };

  loans.forEach(loan => {
    const row = ensure(loan.allocatedTo);
    const amount = amountOf(loan);
    row.total += amount;
    row.count++;
    if (row.cats[loan.category]) {
      row.cats[loan.category].count++;
      row.cats[loan.category].amount += amount;
    }
  });

  return rows;
}

function reportCell(value, cls = "") {
  return `<td${cls ? ` class="${cls}"` : ""}>${esc(value)}</td>`;
}

function metricBox(label, value, sub, cls = "") {
  return `<div class="snap-metric ${cls}"><span>${esc(label)}</span><b>${esc(value)}</b><small>${esc(sub)}</small></div>`;
}

function trendTable(metrics, scale, mode) {
  const buckets = trendBuckets(metrics.thisMonth, scale);
  const trend = buildTrendDatasets(metrics, buckets, mode);
  const modeTitle = {
    all: "All Sanctions",
    "fresh-officers": "Fresh Officers",
    "renewal-officers": "Renewal Officers",
  }[mode];
  const head = `<tr><th>Series</th>${trend.labels.map(label => `<th>${esc(label)}</th>`).join("")}<th>Total</th></tr>`;
  const rows = trend.datasets.map(dataset => {
    const total = dataset.data.reduce((sum, value) => sum + (Number(value) || 0), 0);
    return `<tr><th>${esc(dataset.label)}</th>${dataset.data.map(value => reportCell(`Rs ${fmtAmt(value)}L`, "num")).join("")}${reportCell(`Rs ${fmtAmt(total)}L`, "num strong")}</tr>`;
  }).join("");
  return `<section class="snap-section"><h2>${esc(modeTitle)} - ${scale === "weekly" ? "Weekly" : "Daily"} Trend</h2><table>${head}${rows || '<tr><td colspan="2">No trend data</td></tr>'}</table></section>`;
}

function performerTable(title, rows, kind) {
  const body = rows.map(row => {
    const detail = kind === "renewal"
      ? `Done ${row.count}; Due ${row.due}; OD ${row.od}`
      : CATS.map(cat => {
        const item = row.cats[cat];
        return `${shortCat(cat)} ${item.count} / Rs ${fmtAmt(item.amount)}L`;
      }).join("; ");
    return `<tr>
      ${reportCell(row.rank)}
      ${reportCell(row.name)}
      ${reportCell(detail)}
      ${reportCell(`Rs ${fmtAmt(row.total)}L`, "num strong")}
    </tr>`;
  }).join("");
  return `<section class="snap-section"><h2>${esc(title)}</h2><table><tr><th>Rank</th><th>Officer</th><th>Details</th><th>Total</th></tr>${body || '<tr><td colspan="4">No data</td></tr>'}</table></section>`;
}

function summaryTable(title, loans) {
  const rows = summaryRows(loans);
  const body = rows.map(row => `<tr>
    ${reportCell(row.officer)}
    ${reportCell(row.count, "num")}
    ${CATS.map(cat => {
      const item = row.cats[cat];
      return reportCell(`${item.count} / Rs ${fmtAmt(item.amount)}L`, "num");
    }).join("")}
    ${reportCell(`Rs ${fmtAmt(row.total)}L`, "num strong")}
  </tr>`).join("");
  return `<section class="snap-section"><h2>${esc(title)}</h2><table><tr><th>Officer</th><th>Count</th><th>Agri</th><th>SME</th><th>Edu</th><th>Total</th></tr>${body}</table></section>`;
}

const PDF_PAGE_WIDTH = 794;
const PDF_PAGE_HEIGHT = 1123;

function loanOfficer(loan) {
  return loan.allocatedTo || "Unassigned";
}

function loansForOfficer(loans, officer) {
  return loans.filter(loan => loanOfficer(loan) === officer);
}

function totalMetric(loans) {
  return { count: loans.length, amount: sumAmount(loans) };
}

function metricHtml(label, loans, tone = "") {
  const total = totalMetric(loans);
  return `<div class="pdf-metric ${tone}">
    <span>${esc(label)}</span>
    <strong>${esc(total.count)}</strong>
    <small>Rs ${esc(fmtAmt(total.amount))}L</small>
  </div>`;
}

function statusRank(status) {
  return { npa: 0, "pending-renewal": 1, "due-soon": 2, active: 3 }[status] ?? 4;
}

function renewalUrgencyValue(loan) {
  const rs = loan._rs || {};
  if (rs.status === "npa") return -100000 - (rs.daysOverdue || 0);
  if (rs.status === "pending-renewal") return -10000 + (rs.daysUntilNpa || 999);
  if (rs.status === "due-soon") return rs.daysUntilDue ?? 999;
  return rs.daysUntilDue ?? 9999;
}

function sortRenewalRisk(loans) {
  return [...loans].sort((a, b) =>
    statusRank(a._rs?.status) - statusRank(b._rs?.status) ||
    renewalUrgencyValue(a) - renewalUrgencyValue(b) ||
    (a.customerName || "").localeCompare(b.customerName || "")
  );
}

function riskWatchForOfficer(metrics, officer) {
  const unrenewed = loansForOfficer(metrics.renewals, officer).filter(loan => !loan.renewedDate);
  const npaRisk = sortRenewalRisk(unrenewed.filter(loan => {
    const days = Number(loan._rs?.daysUntilNpa) || 0;
    return days > 0 && days <= 30;
  }));
  const nextDue = sortRenewalRisk(unrenewed).slice(0, 5);
  const useNpaRisk = npaRisk.length > nextDue.length;
  return {
    mode: useNpaRisk ? "NPA risk in next 30 days" : "Next renewals due",
    loans: useNpaRisk ? npaRisk : nextDue,
    npaRiskCount: npaRisk.length,
    nextDueCount: nextDue.length,
  };
}

function detailOfficerNames(metrics) {
  const seen = new Set(S.officers);
  const extra = [];
  [
    metrics.pending,
    metrics.sanctionedThisMonth,
    metrics.returned,
    metrics.renewalDoneThisMonth,
    metrics.renewals,
  ].flat().forEach(loan => {
    const name = loanOfficer(loan);
    if (!seen.has(name)) {
      seen.add(name);
      extra.push(name);
    }
  });
  return [...S.officers, ...extra];
}

function officerPdfData(metrics) {
  return detailOfficerNames(metrics).map(name => {
    const pending = loansForOfficer(metrics.pending, name);
    const sanctioned = loansForOfficer(metrics.sanctionedThisMonth, name);
    const returned = loansForOfficer(metrics.returned, name);
    const renewalsDone = loansForOfficer(metrics.renewalDoneThisMonth, name);
    const riskWatch = riskWatchForOfficer(metrics, name);
    return {
      name,
      pending,
      sanctioned,
      returned,
      renewalsDone,
      riskWatch,
      totalWork: pending.length + sanctioned.length + returned.length + renewalsDone.length + riskWatch.loans.length,
    };
  }).sort((a, b) =>
    b.riskWatch.npaRiskCount - a.riskWatch.npaRiskCount ||
    b.pending.length - a.pending.length ||
    b.sanctioned.length - a.sanctioned.length ||
    a.name.localeCompare(b.name)
  );
}

function freshLoanLine(loan, dateLabel, dateValue) {
  return `<div class="pdf-loan-row">
    <div class="pdf-loan-customer">
      <strong>${esc(loan.customerName || "Unnamed customer")}</strong>
      <span>${esc(loan.branch || "No branch")} · ${esc(loan.category || "Loan")}</span>
    </div>
    <div class="pdf-loan-branch">${esc(loan.branch || "No branch")}</div>
    <div class="pdf-loan-amount">Rs ${esc(fmtAmt(loan.amount))}L</div>
    <div class="pdf-loan-date">${esc(dateLabel)} ${esc(fmtDate(dateValue) || "-")}</div>
  </div>`;
}

function renewalLoanLine(loan, mode = "done") {
  const rs = loan._rs || {};
  const status = mode === "done"
    ? `Renewed ${fmtDate(loan.renewedDate) || "-"}`
    : riskStatusText(loan);
  const ac = loan.acNumber ? ` · A/C ${esc(loan.acNumber)}` : "";
  const remarks = loan.remarks ? `<div class="pdf-loan-remarks">${esc(loan.remarks)}</div>` : "";
  return `<div class="pdf-loan-row risk-${esc(rs.status || "done")}">
    <div class="pdf-loan-main">
      <strong>${esc(loan.customerName || "Unnamed customer")}</strong>
      <span>${esc(loan.branch || "No branch")}${ac}</span>
      <span>Due ${esc(fmtDate(loan.renewalDueDate || rs.dueDateStr) || "-")} · Exp ${esc(fmtDate(loan.limitExpiryDate) || "-")}</span>
      ${remarks}
    </div>
    <div class="pdf-loan-side">
      <b>Rs ${esc(fmtAmt(loan.amount))}L</b>
      <span>${esc(status)}</span>
    </div>
  </div>`;
}

function riskStatusText(loan) {
  const rs = loan._rs || {};
  if (rs.status === "npa") return "NPA";
  if (rs.status === "pending-renewal") return `${rs.daysOverdue || 0}d OD · ${rs.daysUntilNpa || 0}d to NPA`;
  if (rs.status === "due-soon") return `Due in ${rs.daysUntilDue || 0}d · ${rs.daysUntilNpa || 0}d to NPA`;
  return `${rs.daysUntilDue || 0}d to due`;
}

function compactBranch(branch) {
  const value = branch || "No branch";
  return value.split(":")[0].trim() || value;
}

function pdfSection(title, loans, renderer, tone = "", sub = "") {
  return `<section class="pdf-section ${tone}">
    <div class="pdf-section-head">
      <h3>${esc(title)}</h3>
      <span>${esc(loans.length)} item${loans.length === 1 ? "" : "s"}${sub ? ` · ${esc(sub)}` : ""}</span>
    </div>
    <div class="pdf-loan-list">
      ${loans.length ? loans.map(renderer).join("") : '<div class="pdf-empty">No accounts in this section</div>'}
    </div>
  </section>`;
}

function coverOfficerRow(row) {
  const riskTone = row.riskWatch.npaRiskCount ? "danger" : row.riskWatch.loans.length ? "warn" : "calm";
  return `<div class="pdf-cover-row">
    <div class="pdf-cover-officer">
      <strong>${esc(row.name)}</strong>
      <span>${esc(row.riskWatch.mode)}</span>
    </div>
    <div>${metricHtml("Sanctioned", row.sanctioned, "good")}</div>
    <div>${metricHtml("Pending", row.pending, "warn")}</div>
    <div>${metricHtml("Returned", row.returned, "soft-danger")}</div>
    <div>${metricHtml("Renewals Done", row.renewalsDone, "blue")}</div>
    <div>${metricHtml("Risk Watch", row.riskWatch.loans, riskTone)}</div>
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

  return `<div class="pdf-report">
    <style>${detailedSnapshotPdfCss()}</style>
    <section class="pdf-page pdf-cover-page">
      <header class="pdf-brand-row">
        <div>
          <div class="pdf-brand">Nirnay</div>
          <div class="pdf-tagline">Decisions | Delivered</div>
        </div>
        <div class="pdf-date">${esc(dateLabel)}</div>
      </header>
      <div class="pdf-cover-hero">
        <div>
          <span class="pdf-kicker">Detailed Performance Snapshot</span>
          <h1>Risk First Officer Review</h1>
          <p>Officer-wise workload, completed work, and renewal risk watch for immediate sharing.</p>
        </div>
        <div class="pdf-risk-badge">
          <span>NPA Risk</span>
          <strong>${esc(totalNpaRisk)}</strong>
          <small>${esc(totalRiskWatch)} risk-watch rows</small>
        </div>
      </div>
      <div class="pdf-cover-metrics">
        ${metricHtml("Sanctioned MTD", metrics.sanctionedThisMonth, "good")}
        ${metricHtml("Pending", metrics.pending, "warn")}
        ${metricHtml("Returned", metrics.returned, "soft-danger")}
        ${metricHtml("Renewals Done", metrics.renewalDoneThisMonth, "blue")}
        ${metricHtml("Due Soon", metrics.renewalDueSoon, "warn")}
        ${metricHtml("Overdue / NPA", metrics.renewalOverdue, "danger")}
      </div>
      <div class="pdf-cover-table">
        ${rows.map(coverOfficerRow).join("")}
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

function miniFreshRow(loan, dateLabel, dateValue, index) {
  const dateText = `${dateLabel} ${fmtDate(dateValue) || "-"}`.trim();
  return `<tr>
    <td class="mini-num">${esc(index)}</td>
    <td class="mini-customer"><strong>${esc(loan.customerName || "Unnamed customer")}</strong><small>${esc(loan.category || "Loan")}</small></td>
    <td class="mini-branch">${esc(compactBranch(loan.branch))}</td>
    <td class="mini-amount">${esc(fmtAmt(loan.amount))}</td>
    <td class="mini-date">${esc(dateText)}</td>
  </tr>`;
}

function miniRenewalRow(loan, mode = "done", index) {
  const rs = loan._rs || {};
  const status = mode === "done"
    ? `Renewed ${fmtDate(loan.renewedDate) || "-"}`
    : riskStatusText(loan);
  const ac = loan.acNumber ? `A/C ${loan.acNumber}` : "No A/C";
  return `<tr class="risk-${esc(rs.status || "done")}">
    <td class="mini-num">${esc(index)}</td>
    <td class="mini-customer"><strong>${esc(loan.customerName || "Unnamed customer")}</strong><small>${esc(ac)}</small></td>
    <td class="mini-branch">${esc(compactBranch(loan.branch))}</td>
    <td class="mini-amount">${esc(fmtAmt(loan.amount))}</td>
    <td class="mini-date">${esc(status)}</td>
  </tr>`;
}

function buildOfficerPdfSections(row) {
  return [
    {
      title: "Risk Watch",
      loans: row.riskWatch.loans,
      renderer: (loan, index) => miniRenewalRow(loan, "risk", index),
      tone: row.riskWatch.npaRiskCount ? "danger" : "warn",
      sub: row.riskWatch.mode,
    },
    {
      title: "Pending",
      loans: row.pending,
      renderer: (loan, index) => miniFreshRow(loan, "Recd", loan.receiveDate, index),
      tone: "warn",
      sub: "Current fresh pipeline",
    },
    {
      title: "Sanctioned",
      loans: row.sanctioned,
      renderer: (loan, index) => miniFreshRow(loan, "Sanctioned", loan.sanctionDate, index),
      tone: "good",
      sub: "Month-to-date fresh sanctions",
    },
    {
      title: "Returned",
      loans: row.returned,
      renderer: (loan, index) => miniFreshRow(loan, "Returned", loan.returnedDate, index),
      tone: "soft-danger",
      sub: "Fresh cases needing rework",
    },
    {
      title: "Renewals Done",
      loans: row.renewalsDone,
      renderer: (loan, index) => miniRenewalRow(loan, "done", index),
      tone: "blue",
      sub: "Month-to-date completions",
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
  const firstPageUnits = 29;
  const continuationUnits = 36;
  const sectionBaseUnits = 3;

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

  const head = `<thead><tr>
    <th class="mini-num">#</th>
    <th class="mini-customer">Customer</th>
    <th class="mini-branch">Branch</th>
    <th class="mini-amount">Rs L</th>
    <th class="mini-date">Key Date</th>
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
    .pdf-mini-table th.mini-num,.pdf-mini-table td.mini-num{width:18px;color:#4B5270;font-weight:950;font-size:7.6px;text-align:right;padding-right:6px}
    .pdf-mini-table th.mini-customer,.pdf-mini-table td.mini-customer{width:auto}
    .pdf-mini-table th.mini-branch,.pdf-mini-table td.mini-branch{width:78px;font-size:7.4px;font-weight:820;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pdf-mini-table th.mini-amount,.pdf-mini-table td.mini-amount{width:46px;font-size:8.4px;font-weight:950;color:#111B42;text-align:right;white-space:nowrap}
    .pdf-mini-table th.mini-date,.pdf-mini-table td.mini-date{width:90px;font-size:7.4px;font-weight:820;color:#475569;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pdf-mini-table td.mini-customer strong{display:block;font-size:9px;line-height:1.1;color:#111B42;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:900}
    .pdf-mini-table td.mini-customer small{display:block;margin-top:1px;font-size:7.2px;font-weight:850;color:#64748B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.04em;text-transform:uppercase}

    .pdf-footer{position:absolute;left:28px;right:28px;bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:14px;color:#8983A1;font-size:9px;font-weight:850}
    .pdf-footer-brand{display:flex;align-items:center;gap:6px;color:#0B173F;font-weight:900}
    .pdf-footer-logo{display:grid;place-items:center;width:14px;height:14px;border-radius:4px;background:#13234C;color:#fff;font-size:9px;font-weight:950}
    .pdf-footer-meta{color:#615B7C;text-align:center;flex:1}
    .pdf-footer-page{display:flex;flex-direction:column;align-items:flex-end;gap:2px;color:#102151;font-weight:900}
    .pdf-footer-page small{display:block;font-size:8px;font-weight:800;color:#8983A1;letter-spacing:.04em;text-transform:none}
  `;
}

function ensureHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve();
  if (html2canvasLoadPromise) return html2canvasLoadPromise;
  html2canvasLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return html2canvasLoadPromise;
}

function ensureJsPdf() {
  if (window.jspdf?.jsPDF) return Promise.resolve();
  if (jsPdfLoadPromise) return jsPdfLoadPromise;
  jsPdfLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
    script.async = true;
    script.onload = () => window.jspdf?.jsPDF ? resolve() : reject(new Error("jsPDF did not load"));
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return jsPdfLoadPromise;
}

function ensureImageLoaded(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = resolve;
    img.onerror = reject;
    img.src = src;
    if (img.complete) resolve();
  });
}

const DAILY_SNAPSHOT = {
  label: "Daily Snapshot",
  title: "Ribbon Sheet",
  description: "One-page share view using the final readable portrait layout.",
  className: "report-mockup-a",
};
const SNAPSHOT_BG_ASSETS = ["assets/snapshot/top-performer-bg.png"];

function officerNamesFromMetrics(metrics) {
  const seen = new Set(S.officers);
  const extra = [];
  [
    metrics.sanctionedThisMonth,
    metrics.pending,
    metrics.returned,
    metrics.sanctionedToday,
    metrics.renewals,
    metrics.renewalDoneThisMonth,
  ].flat().forEach(loan => {
    const name = loan.allocatedTo || "Unassigned";
    if (!seen.has(name)) {
      seen.add(name);
      extra.push(name);
    }
  });
  return [...S.officers, ...extra];
}

function emptyCatTotals() {
  return Object.fromEntries(CATS.map(cat => [cat, { count: 0, amount: 0 }]));
}

function buildOfficerCategoryRows(loans, officerNames) {
  const rows = officerNames.map(name => ({
    name,
    cats: emptyCatTotals(),
    total: { count: 0, amount: 0 },
  }));
  const byOfficer = new Map(rows.map(row => [row.name, row]));

  loans.forEach(loan => {
    const name = loan.allocatedTo || "Unassigned";
    if (!byOfficer.has(name)) {
      const row = { name, cats: emptyCatTotals(), total: { count: 0, amount: 0 } };
      rows.push(row);
      byOfficer.set(name, row);
    }
    const row = byOfficer.get(name);
    const amount = amountOf(loan);
    if (row.cats[loan.category]) {
      row.cats[loan.category].count++;
      row.cats[loan.category].amount += amount;
    }
    row.total.count++;
    row.total.amount += amount;
  });

  return rows;
}

function buildOfficerRenewalRows(metrics, officerNames) {
  const queueLoans = metrics.renewals.filter(loan => !loan.renewedDate && loan._rs?.status === "pending-renewal");
  const todayDone = metrics.renewalDoneThisMonth.filter(loan => loan.renewedDate === metrics.day);
  const rows = officerNames.map(name => ({
    name,
    queue: { count: 0, amount: 0 },
    monthDone: { count: 0, amount: 0 },
    todayDone: { count: 0, amount: 0 },
  }));
  const byOfficer = new Map(rows.map(row => [row.name, row]));

  const addTo = (loans, key) => {
    loans.forEach(loan => {
      const name = loan.allocatedTo || "Unassigned";
      if (!byOfficer.has(name)) {
        const row = {
          name,
          queue: { count: 0, amount: 0 },
          monthDone: { count: 0, amount: 0 },
          todayDone: { count: 0, amount: 0 },
        };
        rows.push(row);
        byOfficer.set(name, row);
      }
      const row = byOfficer.get(name);
      row[key].count++;
      row[key].amount += amountOf(loan);
    });
  };

  addTo(queueLoans, "queue");
  addTo(metrics.renewalDoneThisMonth, "monthDone");
  addTo(todayDone, "todayDone");
  return rows;
}

function buildCategoryTotal(rows) {
  return rows.reduce((total, row) => {
    CATS.forEach(cat => {
      total.cats[cat].count += row.cats[cat].count;
      total.cats[cat].amount += row.cats[cat].amount;
    });
    total.total.count += row.total.count;
    total.total.amount += row.total.amount;
    return total;
  }, { name: "Total", cats: emptyCatTotals(), total: { count: 0, amount: 0 } });
}

function buildRenewalTotal(rows) {
  return rows.reduce((total, row) => {
    total.queue.count += row.queue.count;
    total.queue.amount += row.queue.amount;
    total.monthDone.count += row.monthDone.count;
    total.monthDone.amount += row.monthDone.amount;
    total.todayDone.count += row.todayDone.count;
    total.todayDone.amount += row.todayDone.amount;
    return total;
  }, {
    name: "Total",
    queue: { count: 0, amount: 0 },
    monthDone: { count: 0, amount: 0 },
    todayDone: { count: 0, amount: 0 },
  });
}

function dualMetricCell(count, amount) {
  return `<div class="report-dual-metric">
    <strong>${esc(count)}</strong>
    <span>Rs ${esc(fmtAmt(amount))}L</span>
  </div>`;
}

function renderCategorySection(section) {
  const rows = [...section.rows, section.total];
  return `<section class="report-block tone-${section.tone}">
    <div class="report-block-head">
      <div>
        <div class="report-block-kicker">${esc(section.title)}</div>
        <h4>${esc(section.subtitle)}</h4>
      </div>
      <div class="report-block-summary">
        <strong>${esc(section.total.total.count)}</strong>
        <span>Rs ${esc(fmtAmt(section.total.total.amount))}L</span>
      </div>
    </div>
    <table class="report-matrix-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Agriculture</th>
          <th>SME</th>
          <th>Education</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(row => `<tr class="${row.name === "Total" ? "is-total" : ""}">
          <th>${esc(row.name)}</th>
          ${CATS.map(cat => `<td>${dualMetricCell(row.cats[cat].count, row.cats[cat].amount)}</td>`).join("")}
          <td>${dualMetricCell(row.total.count, row.total.amount)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </section>`;
}

function renderRenewalSection(section) {
  const rows = [...section.rows, section.total];
  return `<section class="report-block tone-${section.tone}">
    <div class="report-block-head">
      <div>
        <div class="report-block-kicker">${esc(section.title)}</div>
        <h4>${esc(section.subtitle)}</h4>
      </div>
      <div class="report-block-summary">
        <strong>${esc(section.total.monthDone.count)}</strong>
        <span>Rs ${esc(fmtAmt(section.total.monthDone.amount))}L done</span>
      </div>
    </div>
    <table class="report-matrix-table report-matrix-table-renewals">
      <thead>
        <tr>
          <th>Name</th>
          <th>Open Queue</th>
          <th>Month Done</th>
          <th>Done Today</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(row => `<tr class="${row.name === "Total" ? "is-total" : ""}">
          <th>${esc(row.name)}</th>
          <td>${dualMetricCell(row.queue.count, row.queue.amount)}</td>
          <td>${dualMetricCell(row.monthDone.count, row.monthDone.amount)}</td>
          <td>${dualMetricCell(row.todayDone.count, row.todayDone.amount)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </section>`;
}

function buildReportMockupData() {
  const metrics = getLoanMetrics();
  const officerNames = officerNamesFromMetrics(metrics);
  const dateLabel = new Date(`${metrics.day}T12:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const dailyRows = buildOfficerCategoryRows(metrics.sanctionedToday, officerNames);
  const categorySections = [
    {
      key: "sanctioned",
      title: "Sanctioned",
      subtitle: "Month-to-date fresh sanctions",
      tone: "green",
      rows: buildOfficerCategoryRows(metrics.sanctionedThisMonth, officerNames),
    },
    {
      key: "pending",
      title: "Pending",
      subtitle: "Current fresh pipeline",
      tone: "red",
      rows: buildOfficerCategoryRows(metrics.pending, officerNames),
    },
    {
      key: "returned",
      title: "Returned",
      subtitle: "Returned fresh cases needing rework",
      tone: "amber",
      rows: buildOfficerCategoryRows(metrics.returned, officerNames),
    },
    {
      key: "daily",
      title: "Daily Reporting",
      subtitle: `Fresh sanctions for ${dateLabel}`,
      tone: "violet",
      rows: dailyRows,
    },
  ].map(section => ({ ...section, total: buildCategoryTotal(section.rows) }));

  const renewalRows = buildOfficerRenewalRows(metrics, officerNames);
  const sanctionedRows = categorySections.find(section => section.key === "sanctioned").rows;
  const pendingRows = categorySections.find(section => section.key === "pending").rows;
  const returnedRows = categorySections.find(section => section.key === "returned").rows;
  const renewalSection = {
    key: "renewals",
    title: "Renewals",
    subtitle: "Open queue, month done, and done today",
    tone: "blue",
    rows: renewalRows,
    total: buildRenewalTotal(renewalRows),
  };

  return {
    metrics,
    dateLabel,
    viewerLabel: S.isAdmin ? "All officers view" : `${S.user || "Officer"} view`,
    summaryTiles: [
      { label: "Sanctioned", count: metrics.sanctionedThisMonth.length, amount: sumAmount(metrics.sanctionedThisMonth), tone: "green" },
      { label: "Pending", count: metrics.pending.length, amount: sumAmount(metrics.pending), tone: "red" },
      { label: "Returned", count: metrics.returned.length, amount: sumAmount(metrics.returned), tone: "amber" },
      { label: "Daily", count: metrics.sanctionedToday.length, amount: sumAmount(metrics.sanctionedToday), tone: "violet" },
      { label: "Renewals Done", count: metrics.renewalDoneThisMonth.length, amount: sumAmount(metrics.renewalDoneThisMonth), tone: "blue" },
    ],
    officerCards: officerNames.map(name => ({
      name,
      sanctioned: sanctionedRows.find(row => row.name === name) || { name, cats: emptyCatTotals(), total: { count: 0, amount: 0 } },
      pending: pendingRows.find(row => row.name === name) || { name, cats: emptyCatTotals(), total: { count: 0, amount: 0 } },
      returned: returnedRows.find(row => row.name === name) || { name, cats: emptyCatTotals(), total: { count: 0, amount: 0 } },
      daily: dailyRows.find(row => row.name === name) || { name, cats: emptyCatTotals(), total: { count: 0, amount: 0 } },
      renewals: renewalRows.find(row => row.name === name) || {
        name,
        queue: { count: 0, amount: 0 },
        monthDone: { count: 0, amount: 0 },
        todayDone: { count: 0, amount: 0 },
      },
    })).sort((a, b) => b.sanctioned.total.amount - a.sanctioned.total.amount || a.name.localeCompare(b.name)),
    sections: [...categorySections, renewalSection],
  };
}

function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
  return `${n}${suffix}`;
}

function renderLeaderChartCard(title, kicker, rows, metricKey, rankBy = "amount") {
  const valueOf = metric => rankBy === "count" ? metric.count : metric.amount;
  const maxValue = Math.max(1, ...rows.map(row => valueOf(metricKey(row))));
  return `<section class="editorial-leader-card">
    <div class="editorial-leader-head">
      <div class="editorial-leader-kicker">${esc(kicker)}</div>
      <h4>${esc(title)}</h4>
    </div>
    <div class="editorial-leader-list">
      ${rows.map((row, index) => {
        const metric = metricKey(row);
        const width = maxValue > 0 ? Math.max(8, valueOf(metric) / maxValue * 100) : 0;
        const nameWrapHtml = rankBy === "count"
          ? `<div class="editorial-leader-name-wrap">
              <span class="editorial-leader-rank">#${index + 1}</span>
              <span class="editorial-leader-name">${esc(row.name)}</span>
            </div>`
          : `<div class="editorial-leader-name-wrap">
              <span class="editorial-leader-rank">#${index + 1}</span>
              <span class="editorial-leader-name">${esc(row.name)}</span>
            </div>`;
        const metricHtml = rankBy === "count"
          ? `<div class="editorial-leader-metric count">${esc(metric.count)} cases</div>`
          : `<div class="editorial-leader-metric">Rs ${esc(fmtAmt(metric.amount))}L</div>`;
        const subHtml = rankBy === "count"
          ? `Rs ${esc(fmtAmt(metric.amount))}L this month`
          : `${esc(metric.count)} cases this month`;
        return `<div class="editorial-leader-row">
          <div class="editorial-leader-row-top ${rankBy === "count" ? "is-count" : ""}">
            ${nameWrapHtml}
            ${metricHtml}
          </div>
          <div class="editorial-leader-bar-track">
            <div class="editorial-leader-bar" style="width:${width}%"></div>
          </div>
          <div class="editorial-leader-sub">${subHtml}</div>
        </div>`;
      }).join("")}
    </div>
  </section>`;
}

function renderEditorialCategoryPills(card) {
  return CATS.map(cat => {
    const item = card.sanctioned.cats[cat];
    const cls = catCls(cat) || "neutral";
    return `<div class="editorial-pill ${cls} ${item.count ? "active" : ""}">
      <span>${esc(shortCat(cat))}</span>
      <div class="editorial-pill-values">
        <strong>${esc(item.count || "—")}</strong>
        <small>${item.count ? `Rs ${esc(fmtAmt(item.amount))}L` : "No fresh"}</small>
      </div>
    </div>`;
  }).join("");
}

function renderEditorialOfficerCard(card, index) {
  const renewal = card.renewals;
  const noneText = "None";
  const rank = index + 1;
  const freshTodayCount = card.daily.total.count || 0;
  const renewalTodayCount = renewal.todayDone.count || 0;
  return `<article class="editorial-officer-card">
    <div class="editorial-officer-top">
      <div class="editorial-officer-id rank-${rank}">${esc(ordinal(rank))}</div>
      <div class="editorial-officer-main">
        <div class="editorial-officer-headline">
          <div>
            <div class="editorial-officer-name">${esc(card.name)}</div>
          </div>
          <div class="editorial-officer-hero-metric">
            <strong>Rs ${esc(fmtAmt(card.sanctioned.total.amount))}L</strong>
            <span>${esc(card.sanctioned.total.count)} sanctioned</span>
          </div>
        </div>
      </div>
    </div>
    <div class="editorial-subhead-row">
      <span>Sanctioned by category</span>
      <small>count / Rs lakhs</small>
    </div>
    <div class="editorial-pills-grid">
      ${renderEditorialCategoryPills(card)}
    </div>
    <div class="editorial-status-strip">
      <div class="editorial-status-card pending">
        <label>Pending</label>
        <div class="editorial-status-values">
          <strong>${esc(card.pending.total.count || 0)}</strong>
          <span>${card.pending.total.count ? `Rs ${esc(fmtAmt(card.pending.total.amount))}L` : noneText}</span>
        </div>
      </div>
      <div class="editorial-status-card returned">
        <label>Returned</label>
        <div class="editorial-status-values">
          <strong>${esc(card.returned.total.count || 0)}</strong>
          <span>${card.returned.total.count ? `Rs ${esc(fmtAmt(card.returned.total.amount))}L` : noneText}</span>
        </div>
      </div>
      <div class="editorial-status-card daily today-highlight ${freshTodayCount ? "active" : "empty"}">
        <label>Fresh Today</label>
        <div class="editorial-status-values">
          <strong>${esc(freshTodayCount)}</strong>
          <span>${freshTodayCount ? `Rs ${esc(fmtAmt(card.daily.total.amount))}L` : noneText}</span>
        </div>
      </div>
    </div>
    <div class="editorial-renewal-row">
      <div class="editorial-renewal-bookmark">
        <span>Renewal Book</span>
      </div>
      <div class="editorial-renewal-metrics">
        <div class="editorial-renewal-metric"><label>Overdue</label><strong>${esc(renewal.queue.count || 0)}</strong><span>${renewal.queue.count ? `Rs ${esc(fmtAmt(renewal.queue.amount))}L` : noneText}</span></div>
        <div class="editorial-renewal-metric"><label>Done MTD</label><strong>${esc(renewal.monthDone.count || 0)}</strong><span>${renewal.monthDone.count ? `Rs ${esc(fmtAmt(renewal.monthDone.amount))}L` : noneText}</span></div>
        <div class="editorial-renewal-metric today-highlight ${renewalTodayCount ? "active" : "empty"}"><label>Done Today</label><strong>${esc(renewalTodayCount)}</strong><span>${renewalTodayCount ? `Rs ${esc(fmtAmt(renewal.todayDone.amount))}L` : noneText}</span></div>
      </div>
    </div>
  </article>`;
}

function buildEditorialShareMockupHtml(mockup, report) {
  const freshLeaders = [...report.officerCards]
    .sort((a, b) => b.sanctioned.total.amount - a.sanctioned.total.amount || a.name.localeCompare(b.name))
    .slice(0, 3);
  const renewalLeaders = [...report.officerCards]
    .sort((a, b) => b.renewals.monthDone.count - a.renewals.monthDone.count || b.renewals.monthDone.amount - a.renewals.monthDone.amount || a.name.localeCompare(b.name))
    .slice(0, 3);
  const topFresh = freshLeaders[0];

  return `<div class="report-mockup report-mockup-a editorial-phone-report">
    <header class="editorial-top">
      <div class="editorial-brand-row">
        <div class="editorial-brand-lock">
          <div class="editorial-brand-mark">
            <img src="icon-192.png" alt="Nirnay logo">
          </div>
          <div class="editorial-brand-copy">
            <strong><span>निर्णय</span></strong>
          </div>
        </div>
        <div class="editorial-tagline">Decisions | Delivered</div>
      </div>
      <div class="editorial-hero-row">
        <div>
          <div class="editorial-hero-title">Daily Performance</div>
          <div class="editorial-hero-sub">${esc(report.dateLabel)}</div>
        </div>
        <div class="editorial-hero-mtd">
          <label>Fresh MTD</label>
          <strong>Rs ${esc(fmtAmt(report.summaryTiles[0].amount))}L</strong>
          <span>${esc(report.summaryTiles[0].count)} sanctioned</span>
        </div>
      </div>
      <div class="editorial-callout-row">
        <div class="editorial-callout primary">
          <label>Top fresh performer</label>
          <strong>${esc(topFresh ? topFresh.name : "—")}</strong>
          <span>${topFresh ? `Rs ${esc(fmtAmt(topFresh.sanctioned.total.amount))}L · ${esc(topFresh.sanctioned.total.count)} cases` : "No data"}</span>
        </div>
        <div class="editorial-callout">
          <label>Pending pipeline</label>
          <strong>${esc(report.summaryTiles[1].count)}</strong>
          <span>Rs ${esc(fmtAmt(report.summaryTiles[1].amount))}L in queue</span>
        </div>
        <div class="editorial-callout">
          <label>Renewals done</label>
          <strong>${esc(report.summaryTiles[4].count)}</strong>
          <span>Rs ${esc(fmtAmt(report.summaryTiles[4].amount))}L this month</span>
        </div>
      </div>
    </header>
    <section class="editorial-leaders-wrap">
      <div class="editorial-section-title">
        <h2>Leaders This Month</h2>
        <span>MTD ranking</span>
      </div>
      <div class="editorial-leaders-grid">
        ${renderLeaderChartCard("Fresh Sanctioned", "Fresh MTD", freshLeaders, row => row.sanctioned.total)}
        ${renderLeaderChartCard("Renewal Sanctioned", "Renewal MTD", renewalLeaders, row => row.renewals.monthDone, "count")}
      </div>
    </section>
    <section class="editorial-cards-stack">
      ${report.officerCards.map((card, index) => renderEditorialOfficerCard(card, index)).join("")}
    </section>
    <footer class="editorial-footer">
      <span>Generated from Nirnay by Bhavneet</span>
      <span>AMCC Paonta Sahib</span>
    </footer>
  </div>`;
}

function renderMockupHeader(mockup, report) {
  const summary = report.summaryTiles.map(tile => `<div class="report-summary-chip tone-${tile.tone}">
    <span>${esc(tile.label)}</span>
    <strong>${esc(tile.count)}</strong>
    <small>Rs ${esc(fmtAmt(tile.amount))}L</small>
  </div>`).join("");

  return `<header class="report-top">
    <div class="report-title-wrap">
      <div class="report-top-kicker">${esc(mockup.label)} | ${esc(mockup.title)}</div>
      <h3>Performance Tracker ${esc(report.dateLabel)}</h3>
      <p>${esc(report.viewerLabel)} | Same reporting depth, cleaner visual structure for sharing.</p>
    </div>
    <div class="report-top-meta">
      <span>${esc(report.metrics.thisMonth)}</span>
      <span>${esc(S.officers.length)} officers</span>
      <span>5 sections</span>
    </div>
    <div class="report-summary-row">${summary}</div>
  </header>`;
}

function buildReportMockupHtml(mockup, report) {
  if (mockup.className === "report-mockup-a") {
    return buildEditorialShareMockupHtml(mockup, report);
  }
  return `<div class="report-mockup ${mockup.className}">
    ${renderMockupHeader(mockup, report)}
    <div class="report-section-stack">
      ${report.sections.map(section => section.key === "renewals" ? renderRenewalSection(section) : renderCategorySection(section)).join("")}
    </div>
  </div>`;
}

function buildDailySnapshotPageHtml() {
  const report = buildReportMockupData();
  const current = DAILY_SNAPSHOT;

  return `<div class="report-mockup-gallery report-mockup-gallery-single">
    ${buildReportMockupHtml(current, report)}
  </div>`;
}

function renderPerformanceView(target) {
  if (!target) return;
  target.innerHTML = buildDailySnapshotPageHtml();
}

window.exportPerformanceSnapshot = async function () {
  let exportHost;
  try {
    toast("Preparing detailed PDF...");
    await ensureHtml2Canvas();
    await ensureJsPdf();
    if (document.fonts && document.fonts.ready) await document.fonts.ready;

    exportHost = document.createElement("div");
    exportHost.className = "pdf-export-host";
    exportHost.style.position = "fixed";
    exportHost.style.left = "-10000px";
    exportHost.style.top = "0";
    exportHost.style.width = `${PDF_PAGE_WIDTH}px`;
    exportHost.style.background = "#EDE8F4";
    exportHost.style.pointerEvents = "none";
    exportHost.innerHTML = buildDetailedSnapshotPdfHtml();
    document.body.appendChild(exportHost);

    const pages = Array.from(exportHost.querySelectorAll(".pdf-page"));
    if (!pages.length) throw new Error("No PDF pages were generated");

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });

    for (let index = 0; index < pages.length; index++) {
      const page = pages[index];
      const canvas = await window.html2canvas(page, {
        backgroundColor: "#FBFAF7",
        scale: 2,
        useCORS: true,
        width: PDF_PAGE_WIDTH,
        height: PDF_PAGE_HEIGHT,
        windowWidth: PDF_PAGE_WIDTH,
        windowHeight: PDF_PAGE_HEIGHT,
      });
      const image = canvas.toDataURL("image/jpeg", 0.96);
      if (index > 0) pdf.addPage("a4", "portrait");
      pdf.addImage(image, "JPEG", 0, 0, 210, 297, undefined, "FAST");
    }

    const blob = pdf.output("blob");
    const fileName = `detailed-snapshot-${todayFileName()}.pdf`;
    const file = new File([blob], fileName, { type: "application/pdf" });

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: "Detailed Snapshot",
        text: `Detailed Performance Snapshot ${formatShareDate(new Date())}`,
      });
      return;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Detailed PDF downloaded");
  } catch (err) {
    console.warn("[Performance] Detailed PDF export failed:", err);
    toast("Unable to create detailed PDF right now");
  } finally {
    if (exportHost) exportHost.remove();
  }
};

window.showDailySnapshot = function () {
  const backBtn = document.querySelector("#perfOverlay .back-btn");
  const overlayHeader = document.querySelector("#perfOverlay .perf-overlay-header");
  const overlayTitle = document.querySelector("#perfOverlay .perf-overlay-title");
  const overlayActions = document.querySelector("#perfOverlay .perf-overlay-actions");
  if (overlayHeader) overlayHeader.classList.add("snapshot-mode");
  if (backBtn) backBtn.setAttribute("onclick", "closePerfOverlay()");
  if (overlayTitle) overlayTitle.textContent = "Daily Snapshot";
  if (overlayActions) {
    overlayActions.style.display = "";
    overlayActions.innerHTML = '<button class="perf-export-btn perf-export-btn-secondary" type="button" onclick="exportPerformanceSnapshot()">Detailed Snapshot</button><button class="perf-export-btn" type="button" onclick="shareDailySnapshotJpeg()">Share</button>';
  }
  const content = document.getElementById("perfOverlayContent");
  if (content) content.style.padding = "0";
  renderPerformanceView(content);
};

window.shareDailySnapshotJpeg = async function () {
  const card = document.querySelector(".editorial-phone-report");
  if (!card) {
    toast("Snapshot is not ready yet");
    return;
  }

  try {
    await ensureHtml2Canvas();
    await Promise.all(SNAPSHOT_BG_ASSETS.map(ensureImageLoaded));
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const exportWidth = 680;
    const exportHost = document.createElement("div");
    const exportCard = card.cloneNode(true);
    exportHost.style.position = "fixed";
    exportHost.style.left = "-10000px";
    exportHost.style.top = "0";
    exportHost.style.width = `${exportWidth}px`;
    exportHost.style.pointerEvents = "none";
    exportCard.classList.add("snapshot-export");
    exportCard.style.width = `${exportWidth}px`;
    exportCard.style.maxWidth = "none";
    exportHost.appendChild(exportCard);
    document.body.appendChild(exportHost);

    let canvas;
    try {
      canvas = await window.html2canvas(exportCard, {
        backgroundColor: "#f1eff8",
        scale: Math.min(4, Math.max(3, window.devicePixelRatio || 2)),
        useCORS: true,
        width: exportWidth,
        windowWidth: exportWidth,
      });
    } finally {
      exportHost.remove();
    }

    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.98));
    if (!blob) throw new Error("JPEG export failed");

    const fileName = `daily-snapshot-${todayFileName()}.jpg`;
    const file = new File([blob], fileName, { type: "image/jpeg" });

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: "Daily Snapshot",
        text: `Daily Performance Update ${formatShareDate(new Date())}`,
      });
      return;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("JPEG downloaded");
  } catch (err) {
    console.warn("[Performance] Snapshot share failed:", err);
    toast("Unable to share snapshot right now");
  }
};

function todayFileName() {
  return new Date().toISOString().slice(0, 10);
}

function formatShareDate(date) {
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
