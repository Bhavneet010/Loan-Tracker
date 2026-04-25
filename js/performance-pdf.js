import { S } from "./state.js";
import { getLoanMetrics, sumAmount } from "./derived.js";
import { catCls, esc, fmtAmt, fmtDate, shortCat, toast } from "./utils.js";
import { monthDays, trendBuckets, groupAmountByBucket, buildOfficerTotals, buildTrendDatasets, buildLeaderboardRows, summaryRows, reportCell, metricBox, trendTable, performerTable, summaryTable, loanOfficer, loansForOfficer, totalMetric, metricHtml, statusRank, renewalUrgencyValue, sortRenewalRisk, riskWatchForOfficer, detailOfficerNames, officerPdfData, freshLoanLine, renewalLoanLine, riskStatusText, compactBranch, pdfSection, coverOfficerRow, CATS, TREND_COLORS, amountOf, PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT, html2canvasLoadPromise, jsPdfLoadPromise } from "./performance-utils.js";

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


export { buildDetailedSnapshotPdfHtml, miniFreshRow, miniRenewalRow, buildOfficerPdfSections, paginateOfficerPdfSections, compactPdfSection, compactPdfSectionV2, buildOfficerPdfPages, buildCompactOfficerPdfPage, buildCompactOfficerPdfPageV2, buildOfficerPdfPage, detailedSnapshotPdfCss };
