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


export { monthDays, trendBuckets, groupAmountByBucket, buildOfficerTotals, buildTrendDatasets, buildLeaderboardRows, summaryRows, reportCell, metricBox, trendTable, performerTable, summaryTable, loanOfficer, loansForOfficer, totalMetric, metricHtml, statusRank, renewalUrgencyValue, sortRenewalRisk, riskWatchForOfficer, detailOfficerNames, officerPdfData, freshLoanLine, renewalLoanLine, riskStatusText, compactBranch, pdfSection, coverOfficerRow, CATS, TREND_COLORS, amountOf, PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT, html2canvasLoadPromise, jsPdfLoadPromise };
