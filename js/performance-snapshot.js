import { S } from "./state.js";
import { getLoanMetrics, sumAmount } from "./derived.js";
import { catCls, esc, fmtAmt, fmtDate, shortCat, toast } from "./utils.js";
import { monthDays, trendBuckets, groupAmountByBucket, buildOfficerTotals, buildTrendDatasets, buildLeaderboardRows, summaryRows, reportCell, metricBox, trendTable, performerTable, summaryTable, loanOfficer, loansForOfficer, totalMetric, metricHtml, statusRank, renewalUrgencyValue, sortRenewalRisk, riskWatchForOfficer, detailOfficerNames, officerPdfData, freshLoanLine, renewalLoanLine, riskStatusText, compactBranch, pdfSection, coverOfficerRow, CATS, TREND_COLORS, amountOf, PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT, html2canvasLoadPromise, jsPdfLoadPromise } from "./performance-utils.js";

import { buildDetailedSnapshotPdfHtml, miniFreshRow, miniRiskRow, miniRenewalDoneRow, buildOfficerPdfSections, paginateOfficerPdfSections, compactPdfSection, compactPdfSectionV2, buildOfficerPdfPages, buildCompactOfficerPdfPage, buildCompactOfficerPdfPageV2, buildOfficerPdfPage, detailedSnapshotPdfCss } from "./performance-pdf.js";

let localHtml2CanvasPromise = null;
let localJsPdfPromise = null;

function ensureHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve();
  if (localHtml2CanvasPromise) return localHtml2CanvasPromise;
  localHtml2CanvasPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return localHtml2CanvasPromise;
}

function ensureJsPdf() {
  if (window.jspdf?.jsPDF) return Promise.resolve();
  if (localJsPdfPromise) return localJsPdfPromise;
  localJsPdfPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
    script.async = true;
    script.onload = () => window.jspdf?.jsPDF ? resolve() : reject(new Error("jsPDF did not load"));
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return localJsPdfPromise;
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



export { ensureHtml2Canvas, ensureJsPdf, ensureImageLoaded, officerNamesFromMetrics, emptyCatTotals, buildOfficerCategoryRows, buildOfficerRenewalRows, buildCategoryTotal, buildRenewalTotal, dualMetricCell, renderCategorySection, renderRenewalSection, buildReportMockupData, ordinal, renderLeaderChartCard, renderEditorialCategoryPills, renderEditorialOfficerCard, buildEditorialShareMockupHtml, renderMockupHeader, buildReportMockupHtml, buildDailySnapshotPageHtml, renderPerformanceView, DAILY_SNAPSHOT, SNAPSHOT_BG_ASSETS };
