import { S } from "./state.js";
import { getLoanMetrics, sumAmount } from "./derived.js";
import { catCls, esc, fmtAmt, fmtDate, fmtShortDate, isFreshCC, shortCat, toast } from "./utils.js";
import { monthDays, trendBuckets, groupAmountByBucket, buildOfficerTotals, buildTrendDatasets, buildLeaderboardRows, summaryRows, reportCell, metricBox, trendTable, performerTable, summaryTable, loanOfficer, loansForOfficer, totalMetric, metricHtml, statusRank, renewalUrgencyValue, sortRenewalRisk, riskWatchForOfficer, detailOfficerNames, officerPdfData, freshLoanLine, renewalLoanLine, riskStatusText, compactBranch, pdfSection, coverOfficerRow, CATS, TREND_COLORS, amountOf, PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT, html2canvasLoadPromise, jsPdfLoadPromise } from "./performance-utils.js";

import { buildDetailedSnapshotPdfHtml, miniFreshRow, miniRiskRow, miniRenewalDoneRow, buildOfficerPdfSections, paginateOfficerPdfSections, compactPdfSection, compactPdfSectionV2, buildOfficerPdfPages, buildCompactOfficerPdfPage, buildCompactOfficerPdfPageV2, buildOfficerPdfPage, detailedSnapshotPdfCss } from "./performance-pdf.js";
import { holidayReason, findCustomHoliday } from "./bank-holidays.js";
import { availabilityLabel, availabilityShortLabel, officerAvailabilityForDate } from "./officer-availability.js";

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
const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

let _selectedWeekDates = null;

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
    metrics.renewalDoneToday,
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
  const todayDone = metrics.renewalDoneToday || [];
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

function isoDate(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function currentWeekDates() {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const day = today.getDay() || 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - day + 1);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return isoDate(date);
  });
}

function weeklyDateLabel(dates) {
  const start = fmtShortDate(dates[0]);
  const end = fmtShortDate(dates[dates.length - 1]);
  return `${start} - ${end}`;
}

function getWeeksInCurrentMonth() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstOfMonth = new Date(year, month, 1, 12, 0, 0);
  const dow = firstOfMonth.getDay() || 7;
  const firstMonday = new Date(firstOfMonth);
  firstMonday.setDate(1 - (dow - 1));
  firstMonday.setHours(12, 0, 0, 0);
  const lastOfMonth = new Date(year, month + 1, 0, 12, 0, 0);
  const weeks = [];
  const cursor = new Date(firstMonday);
  while (cursor <= lastOfMonth) {
    const weekDates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(cursor);
      d.setDate(cursor.getDate() + i);
      return isoDate(d);
    });
    weeks.push(weekDates);
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

function getDefaultWeekDates(weeks) {
  const currentMonday = currentWeekDates()[0];
  return weeks.find(w => w[0] === currentMonday) || weeks[weeks.length - 1] || weeks[0];
}

function getWeekDatesFromMonday(mondayISO) {
  const monday = new Date(mondayISO);
  monday.setHours(12, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return isoDate(d);
  });
}

function getPrevWeekDates(dates) {
  const prevMonday = new Date(dates[0]);
  prevMonday.setHours(12, 0, 0, 0);
  prevMonday.setDate(prevMonday.getDate() - 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(prevMonday);
    d.setDate(prevMonday.getDate() + i);
    return isoDate(d);
  });
}

function renderWeekSelectorHtml(weeks, selectedDates) {
  const selectedMonday = selectedDates[0];
  const now = new Date();
  const monthName = now.toLocaleString("en-IN", { month: "long", year: "numeric" });
  return `<div class="weekly-week-selector">
    <span class="weekly-week-selector-label">${esc(monthName)}</span>
    <select class="weekly-week-selector-select" onchange="selectWeekForPerformance(this.value)">
      ${weeks.map(week => {
        const label = weeklyDateLabel(week);
        const sel = week[0] === selectedMonday ? " selected" : "";
        return `<option value="${esc(week[0])}"${sel}>${esc(label)}</option>`;
      }).join("")}
    </select>
  </div>`;
}

function metricSeed() {
  return { count: 0, amount: 0 };
}

function addLoanToMetric(metric, loan) {
  metric.count++;
  metric.amount += amountOf(loan);
}

function officerNamesFromWeekly(freshLoans, renewalLoans) {
  const seen = new Set(S.officers);
  const extra = [];
  [freshLoans, renewalLoans].flat().forEach(loan => {
    const name = loan.allocatedTo || "Unassigned";
    if (!seen.has(name)) {
      seen.add(name);
      extra.push(name);
    }
  });
  return [...S.officers, ...extra];
}

function buildWeeklyPerformanceData(targetDates) {
  const dates = targetDates || currentWeekDates();
  const dateSet = new Set(dates);
  const freshLoans = S.loans.filter(loan =>
    isFreshCC(loan) &&
    loan.status === "sanctioned" &&
    dateSet.has(loan.sanctionDate || "")
  );
  const renewalLoans = S.loans.filter(loan =>
    !isFreshCC(loan) &&
    loan.category === "SME" &&
    dateSet.has(loan.renewedDate || "")
  );
  const officers = officerNamesFromWeekly(freshLoans, renewalLoans);
  const createRows = () => officers.map(name => ({
    name,
    days: dates.map(date => ({ date, ...metricSeed() })),
    total: metricSeed(),
  }));
  const freshRows = createRows();
  const renewalRows = createRows();
  const freshByOfficer = new Map(freshRows.map(row => [row.name, row]));
  const renewalByOfficer = new Map(renewalRows.map(row => [row.name, row]));
  const dateIndex = new Map(dates.map((date, index) => [date, index]));

  const addToRows = (rowsByOfficer, loan, dateKey) => {
    const name = loan.allocatedTo || "Unassigned";
    const row = rowsByOfficer.get(name);
    const index = dateIndex.get(loan[dateKey]);
    if (!row || index === undefined) return;
    addLoanToMetric(row.days[index], loan);
    addLoanToMetric(row.total, loan);
  };

  freshLoans.forEach(loan => addToRows(freshByOfficer, loan, "sanctionDate"));
  renewalLoans.forEach(loan => addToRows(renewalByOfficer, loan, "renewedDate"));

  const freshTotal = freshRows.reduce((total, row) => {
    total.count += row.total.count;
    total.amount += row.total.amount;
    return total;
  }, metricSeed());
  const renewalTotal = renewalRows.reduce((total, row) => {
    total.count += row.total.count;
    total.amount += row.total.amount;
    return total;
  }, metricSeed());

  const officerRows = officers.map(name => {
    const fresh = freshByOfficer.get(name)?.total || metricSeed();
    const renewal = renewalByOfficer.get(name)?.total || metricSeed();
    return { name, fresh, renewal, combined: fresh.amount + renewal.amount };
  }).sort((a, b) => b.combined - a.combined || b.fresh.amount - a.fresh.amount || a.name.localeCompare(b.name));

  return {
    dates,
    label: weeklyDateLabel(dates),
    officers,
    fresh: { loans: freshLoans, rows: freshRows, total: freshTotal },
    renewal: { loans: renewalLoans, rows: renewalRows, total: renewalTotal },
    officerRows,
  };
}

function heatValueClass(metric, maxAmount) {
  if (!metric.count) return "empty";
  const pct = maxAmount > 0 ? metric.amount / maxAmount : 0;
  if (pct >= 0.72) return "hot";
  if (pct >= 0.38) return "mid";
  return "low";
}

function renderWeeklyMetricChip(label, metric, tone) {
  const noun = metric.count === 1 ? "case" : "cases";
  return `<div class="weekly-metric-chip ${tone}">
    <div class="weekly-metric-copy">
      <span>${esc(label)}</span>
      <strong>${esc(metric.count)}<small>${esc(noun)}</small></strong>
    </div>
    <div class="weekly-metric-amount">
      <b>Rs ${esc(fmtAmt(metric.amount))}L</b>
      <i>Total amount</i>
    </div>
  </div>`;
}

function weeklyCellActionAttrs(officer, date) {
  return ` data-officer="${esc(officer)}" data-date="${esc(date)}" onclick="markWeeklyOfficerAvailability(this.dataset.officer,this.dataset.date)" title="Mark officer availability"`;
}

function renderWeeklyHeatmapCard(title, kicker, rows, dates, tone) {
  const maxAmount = Math.max(1, ...rows.flatMap(row => row.days.map(day => day.amount)));
  return `<section class="weekly-heatmap-card ${tone}">
    <div class="weekly-card-head">
      <div>
        <span>${esc(kicker)}</span>
        <h3>${esc(title)}</h3>
      </div>
      <div class="weekly-legend">
        <i></i><b>Low</b><i></i><b>High</b>
      </div>
    </div>
    <div class="weekly-heatmap-grid" style="--weekly-cols:${dates.length + 2}">
      <div class="weekly-grid-head officer">Officer</div>
      ${dates.map((date, index) => `<div class="weekly-grid-head">
          <strong>${esc(WEEK_DAYS[index])}</strong>
          <span>${esc(fmtShortDate(date))}</span>
        </div>`).join("")}
      <div class="weekly-grid-head total">Total</div>
      ${rows.map(row => `
        <div class="weekly-officer-name">${esc(row.name)}</div>
        ${row.days.map(day => {
          const availability = officerAvailabilityForDate(row.name, day.date);
          if (!day.count && availability) {
            return `<div class="weekly-heat-cell weekly-heat-cell-action officer-away ${esc(availability.type)}"${weeklyCellActionAttrs(row.name, day.date)}>
              <span>${esc(availabilityLabel(availability))}</span>
            </div>`;
          }
          const reason = holidayReason(day.date);
          if (!day.count && reason) {
            const holLabel = reason === "custom" ? (findCustomHoliday(day.date)?.label || "Holiday") : "Holiday";
            return `<div class="weekly-heat-cell weekly-heat-cell-action holiday-day"${weeklyCellActionAttrs(row.name, day.date)}><span>${esc(holLabel)}</span></div>`;
          }
          return `<div class="weekly-heat-cell weekly-heat-cell-action ${tone} ${heatValueClass(day, maxAmount)} ${availability ? `has-away ${esc(availability.type)}` : ""}"${weeklyCellActionAttrs(row.name, day.date)}>
            <strong>${esc(day.count || "-")}</strong>
            <span>${day.count ? `Rs ${esc(fmtAmt(day.amount))}L` : "Nil"}</span>
            ${availability ? `<em>${esc(availabilityShortLabel(availability))}</em>` : ""}
          </div>`;
        }).join("")}
        <div class="weekly-row-total">
          <strong>${esc(row.total.count)}</strong>
          <span>Rs ${esc(fmtAmt(row.total.amount))}L</span>
        </div>
      `).join("")}
    </div>
  </section>`;
}

function smoothCurve(vals, xOf, yOf) {
  const pts = vals.map((v, i) => [+xOf(i).toFixed(2), +yOf(v).toFixed(2)]);
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = (p1[0] + (p2[0] - p0[0]) / 6).toFixed(2);
    const cp1y = (p1[1] + (p2[1] - p0[1]) / 6).toFixed(2);
    const cp2x = (p2[0] - (p3[0] - p1[0]) / 6).toFixed(2);
    const cp2y = (p2[1] - (p3[1] - p1[1]) / 6).toFixed(2);
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

const SPARKLINE_OFFICER_COLORS = ["#6B5FBF", "#F59E0B", "#EC4899", "#0EA5E9", "#14B8A6", "#F97316"];
const SPARKLINE_PREV_COLOR = "#B0A8CC";

function renderSparklineSvg(thisVals, prevVals, color, gradId, maxVal) {
  const W = 280, H = 72;
  const padL = 8, padR = 8, padT = 18, padB = 14;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const baselineY = (padT + plotH).toFixed(1);
  const xOf = i => padL + (i / (thisVals.length - 1)) * plotW;
  const yOf = v => padT + plotH * (1 - v / maxVal);
  const thisCurve = smoothCurve(thisVals, xOf, yOf);
  const prevCurve = smoothCurve(prevVals, xOf, yOf);
  const firstX = xOf(0).toFixed(1);
  const lastX = xOf(thisVals.length - 1).toFixed(1);
  const areaPath = `${thisCurve} L ${lastX},${baselineY} L ${firstX},${baselineY} Z`;
  const thisDots = thisVals.map((v, i) => {
    const cx = xOf(i).toFixed(1), cy = yOf(v).toFixed(1);
    return `<circle cx="${cx}" cy="${cy}" r="3" fill="${color}" stroke="#fff" stroke-width="1.5"><title>${esc(WEEK_DAYS[i] + ": " + v)}</title></circle>`;
  }).join("");
  const prevDots = prevVals.map((v, i) => {
    const cx = xOf(i).toFixed(1), cy = yOf(v).toFixed(1);
    return `<circle cx="${cx}" cy="${cy}" r="2.5" fill="#fff" stroke="${color}" stroke-width="1.5" opacity="0.45"><title>${esc(WEEK_DAYS[i] + ": " + v + " (prev)")}</title></circle>`;
  }).join("");
  const thisLabels = thisVals.map((v, i) => {
    if (v === 0) return "";
    const cx = xOf(i).toFixed(1);
    const cy = yOf(v);
    const labelY = cy < padT + 12 ? (cy + 13).toFixed(1) : (cy - 6).toFixed(1);
    return `<text x="${cx}" y="${labelY}" text-anchor="middle" fill="${color}" font-size="7.5" font-weight="800" opacity="0.9">${v}</text>`;
  }).join("");
  const prevLabels = prevVals.map((v, i) => {
    if (v === 0) return "";
    const cx = xOf(i).toFixed(1);
    const cy = yOf(v);
    const labelY = cy > H - padB - 10 ? (cy - 5).toFixed(1) : (cy + 11).toFixed(1);
    return `<text x="${cx}" y="${labelY}" text-anchor="middle" fill="${color}" font-size="7" font-weight="800" opacity="0.45">${v}</text>`;
  }).join("");
  const clipId = `clip-${gradId}`;
  return `<svg class="weekly-sparkline-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <clipPath id="${clipId}">
        <rect x="0" y="0" width="${W}" height="${H}"/>
      </clipPath>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.30"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <g clip-path="url(#${clipId})">
      <path d="${areaPath}" fill="url(#${gradId})" stroke="none"/>
      <path d="${prevCurve}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="4 3" stroke-linecap="round" stroke-linejoin="round" opacity="0.45"/>
      <path d="${thisCurve}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      ${prevDots}
      ${prevLabels}
      ${thisDots}
      ${thisLabels}
    </g>
  </svg>`;
}

function renderSparklineAxisSvg() {
  const W = 280, padL = 6, padR = 6;
  const xOf = i => padL + (i / 6) * (W - padL - padR);
  return `<svg class="weekly-sparkline-axis-svg" viewBox="0 0 ${W} 16" xmlns="http://www.w3.org/2000/svg">
    ${["M","T","W","T","F","S","S"].map((l, i) =>
      `<text x="${xOf(i).toFixed(1)}" y="12" text-anchor="middle" fill="#B0A8CC" font-size="8.5" font-weight="800">${l}</text>`
    ).join("")}
  </svg>`;
}

function renderWeeklyComparativeCharts(thisData, prevData) {
  const renderSection = (title, thisRows, prevRows, sectionIdx) => {
    const prevByName = new Map(prevRows.map(r => [r.name, r]));
    const maxVal = Math.max(1,
      ...thisRows.flatMap(r => r.days.map(d => d.count)),
      ...prevRows.flatMap(r => r.days.map(d => d.count))
    );

    const officerRows = thisRows.map((row, idx) => {
      const color = SPARKLINE_OFFICER_COLORS[idx % SPARKLINE_OFFICER_COLORS.length];
      const prevRow = prevByName.get(row.name);
      const prevVals = prevRow ? prevRow.days.map(d => d.count) : new Array(7).fill(0);
      const gradId = `wksg-${sectionIdx}-${idx}`;
      return `<div class="weekly-sparkline-row">
        <div class="weekly-sparkline-meta">
          <span class="weekly-sparkline-name" style="color:${color}">${esc(row.name)}</span>
          <div class="weekly-sparkline-total">
            <strong>${row.total.count}</strong>
            <span>Total</span>
          </div>
        </div>
        ${renderSparklineSvg(row.days.map(d => d.count), prevVals, color, gradId, maxVal)}
      </div>`;
    }).join("");

    return `<div class="weekly-chart-section">
      <div class="weekly-chart-section-head">
        <span class="weekly-chart-kicker">Daily count trend</span>
        <h4>${esc(title)}</h4>
      </div>
      <div class="weekly-sparkline-list">
        ${officerRows}
        <div class="weekly-sparkline-row x-axis-row">
          <div class="weekly-sparkline-meta"></div>
          ${renderSparklineAxisSvg()}
        </div>
      </div>
    </div>`;
  };

  return `<section class="weekly-comparative-section">
    <div class="weekly-comp-head">
      <span>Week-on-Week Trend</span>
      <div class="weekly-comp-right">
        <div class="weekly-sparkline-legend">
          <span class="wsl-item"><i class="wsl-solid"></i>This Week</span>
          <span class="wsl-item"><i class="wsl-dashed"></i>Prev Week</span>
        </div>
        <strong>Daily count comparison</strong>
      </div>
    </div>
    <div class="weekly-comp-charts">
      ${renderSection("Fresh Sanctions", thisData.fresh.rows, prevData.fresh.rows, 0)}
      ${renderSection("Renewals", thisData.renewal.rows, prevData.renewal.rows, 1)}
    </div>
  </section>`;
}

function renderWeeklyOfficerStrip(rows) {
  return `<section class="weekly-officer-strip">
    <div class="weekly-strip-head">
      <span>Officer Summary</span>
      <strong>Fresh + renewal totals</strong>
    </div>
    <div class="weekly-strip-grid">
      ${rows.map((row, index) => `<article class="weekly-officer-mini">
        <div class="weekly-mini-rank">${esc(ordinal(index + 1))}</div>
        <div>
          <h4>${esc(row.name)}</h4>
          <p>Fresh ${esc(row.fresh.count)} / Rs ${esc(fmtAmt(row.fresh.amount))}L</p>
          <p>Renewal ${esc(row.renewal.count)} / Rs ${esc(fmtAmt(row.renewal.amount))}L</p>
        </div>
      </article>`).join("")}
    </div>
  </section>`;
}

function buildWeeklyPerformancePageHtml(targetDates) {
  const data = buildWeeklyPerformanceData(targetDates);
  const prevData = buildWeeklyPerformanceData(getPrevWeekDates(data.dates));
  const currentMonday = currentWeekDates()[0];
  const kickerText = data.dates[0] === currentMonday ? "Current Week" : "Selected Week";
  const topFresh = [...data.officerRows].sort((a, b) =>
    b.fresh.amount - a.fresh.amount || b.fresh.count - a.fresh.count || a.name.localeCompare(b.name)
  )[0];
  return `<div class="weekly-performance-wrap">
    <div class="weekly-performance-report">
      <header class="weekly-report-top">
        <div class="weekly-brand-row">
          <div class="weekly-brand-lock">
            <div class="weekly-brand-mark"><img src="icon-192.png" alt="Nirnay logo"></div>
            <strong><span>Nirnay</span></strong>
          </div>
          <div class="weekly-tagline">Decisions | Delivered</div>
        </div>
        <div class="weekly-hero-row">
          <div>
            <div class="weekly-kicker">${esc(kickerText)}</div>
            <h2>Weekly Performance</h2>
            <p>${esc(data.label)}</p>
          </div>
          <div class="weekly-hero-total">
            <label>Top Fresh</label>
            <strong>${esc(topFresh ? topFresh.name : "-")}</strong>
            <span>${topFresh ? `Rs ${esc(fmtAmt(topFresh.fresh.amount))}L - ${esc(topFresh.fresh.count)} cases` : "No data"}</span>
          </div>
        </div>
        <div class="weekly-summary-row">
          ${renderWeeklyMetricChip("Fresh Sanctions", data.fresh.total, "fresh")}
          ${renderWeeklyMetricChip("Renewals", data.renewal.total, "renewal")}
        </div>
      </header>
      <main class="weekly-report-main">
        ${renderWeeklyHeatmapCard("Fresh Sanctions", "Daily officer heatmap", data.fresh.rows, data.dates, "fresh")}
        ${renderWeeklyHeatmapCard("Renewals", "Daily officer heatmap", data.renewal.rows, data.dates, "renewal")}
        ${renderWeeklyComparativeCharts(data, prevData)}
      </main>
      <footer class="weekly-report-footer">
        <span>Generated from Nirnay by Bhavneet</span>
        <span>AMCC Paonta Sahib</span>
      </footer>
    </div>
  </div>`;
}

function buildMonthlyPerformancePageHtml() {
  const report = buildReportMockupData();
  return `<div class="perf-period-placeholder monthly">
    <div class="perf-period-placeholder-kicker">Monthly View</div>
    <h2>Monthly Performance</h2>
    <p>Detailed snapshot for ${esc(report.metrics.thisMonth)}.</p>
  </div>`;
}

function renderDailyPerformanceView(target) {
  if (!target) return;
  target.innerHTML = buildDailySnapshotPageHtml();
}

function renderWeeklyPerformanceView(target) {
  if (!target) return;
  const weeks = getWeeksInCurrentMonth();
  if (!_selectedWeekDates || !weeks.some(w => w[0] === _selectedWeekDates[0])) {
    _selectedWeekDates = getDefaultWeekDates(weeks);
  }
  target.innerHTML = `<div class="weekly-selector-bar">${renderWeekSelectorHtml(weeks, _selectedWeekDates)}</div>${buildWeeklyPerformancePageHtml(_selectedWeekDates)}`;
}

window.selectWeekForPerformance = function (mondayISO) {
  _selectedWeekDates = getWeekDatesFromMonday(mondayISO);
  const target = document.getElementById("perfOverlayContent");
  if (target) renderWeeklyPerformanceView(target);
};

function renderMonthlyPerformanceView(target) {
  if (!target) return;
  target.innerHTML = buildMonthlyPerformancePageHtml();
}

function renderPerformanceView(target) {
  renderDailyPerformanceView(target);
}



export { ensureHtml2Canvas, ensureJsPdf, ensureImageLoaded, officerNamesFromMetrics, emptyCatTotals, buildOfficerCategoryRows, buildOfficerRenewalRows, buildCategoryTotal, buildRenewalTotal, dualMetricCell, renderCategorySection, renderRenewalSection, buildReportMockupData, buildWeeklyPerformanceData, ordinal, renderLeaderChartCard, renderEditorialCategoryPills, renderEditorialOfficerCard, buildEditorialShareMockupHtml, renderMockupHeader, buildReportMockupHtml, buildDailySnapshotPageHtml, buildWeeklyPerformancePageHtml, buildMonthlyPerformancePageHtml, renderDailyPerformanceView, renderWeeklyPerformanceView, renderMonthlyPerformanceView, renderPerformanceView, DAILY_SNAPSHOT, SNAPSHOT_BG_ASSETS };
