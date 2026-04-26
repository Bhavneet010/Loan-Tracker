import {
  collection,
  doc,
  getDocs,
  setDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { db } from "./config.js";
import { S } from "./state.js";
import { ts } from "./db.js";
import { getLoanMetricsForMonth, sumAmount } from "./derived.js";
import { esc, fmtAmt, fmtDate, isFreshCC, toast } from "./utils.js";
import {
  ensureHtml2Canvas,
  ensureJsPdf,
} from "./performance-templates.js";
import {
  PDF_PAGE_HEIGHT,
  PDF_PAGE_WIDTH,
} from "./performance-utils.js";

const SNAPSHOT_COLLECTION = "monthlySnapshots";
const DETAIL_ROWS_PER_PAGE = 24;

function previousMonthKey() {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month) {
  return new Date(`${month}-01T12:00:00`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

function amountMetric(loans) {
  return { count: loans.length, amount: sumAmount(loans) };
}

function collectMonthEndData(month = previousMonthKey()) {
  const metrics = getLoanMetricsForMonth(month);
  const sanctioned = metrics.sanctionedThisMonth.filter(isFreshCC);
  const returned = metrics.returnedThisMonth.filter(isFreshCC);
  const renewalsDone = metrics.renewalDoneThisMonth.filter(loan => !isFreshCC(loan));

  return {
    month,
    label: monthLabel(month),
    metrics,
    sanctioned,
    returned,
    renewalsDone,
  };
}

function officerNames(data) {
  const seen = new Set(S.officers);
  const extra = [];
  [
    data.sanctioned,
    data.returned,
    data.renewalsDone,
    data.metrics.pending,
    data.metrics.renewalDueSoon,
    data.metrics.renewalOverdue,
  ].flat().forEach(loan => {
    const name = loan.allocatedTo || "Unassigned";
    if (!seen.has(name)) {
      seen.add(name);
      extra.push(name);
    }
  });
  return [...S.officers, ...extra];
}

function aggregateByOfficer(data) {
  return officerNames(data).map(name => {
    const byOfficer = loan => (loan.allocatedTo || "Unassigned") === name;
    const sanctioned = data.sanctioned.filter(byOfficer);
    const returned = data.returned.filter(byOfficer);
    const renewalsDone = data.renewalsDone.filter(byOfficer);
    const pending = data.metrics.pending.filter(byOfficer);
    const dueSoon = data.metrics.renewalDueSoon.filter(byOfficer);
    const overdue = data.metrics.renewalOverdue.filter(byOfficer);
    return {
      name,
      sanctioned: amountMetric(sanctioned),
      returned: amountMetric(returned),
      renewalsDone: amountMetric(renewalsDone),
      pending: amountMetric(pending),
      dueSoon: amountMetric(dueSoon),
      overdue: amountMetric(overdue),
    };
  });
}

function aggregateByCategory(loans) {
  const categories = ["Agriculture", "SME", "Education"];
  return categories.map(category => ({
    category,
    ...amountMetric(loans.filter(loan => loan.category === category)),
  }));
}

function buildLightweightSummary(data) {
  const officerRows = aggregateByOfficer(data);
  return {
    month: data.month,
    label: data.label,
    generatedAt: new Date().toISOString(),
    generatedBy: S.user || "Admin",
    totals: {
      sanctioned: amountMetric(data.sanctioned),
      returned: amountMetric(data.returned),
      renewalsDone: amountMetric(data.renewalsDone),
      pending: amountMetric(data.metrics.pending),
      renewalDueSoon: amountMetric(data.metrics.renewalDueSoon),
      renewalOverdue: amountMetric(data.metrics.renewalOverdue),
    },
    officers: officerRows,
    categories: {
      sanctioned: aggregateByCategory(data.sanctioned),
      returned: aggregateByCategory(data.returned),
      renewalsDone: aggregateByCategory(data.renewalsDone),
    },
    recordCountsOnly: true,
  };
}

function metricCard(label, metric, tone = "") {
  return `<div class="me-metric ${tone}">
    <span>${esc(label)}</span>
    <strong>${esc(metric.count)}</strong>
    <small>Rs ${esc(fmtAmt(metric.amount))}L</small>
  </div>`;
}

function topOfficer(rows, key, rankBy = "amount") {
  return [...rows].sort((a, b) =>
    (b[key]?.[rankBy] || 0) - (a[key]?.[rankBy] || 0) ||
    (b[key]?.amount || 0) - (a[key]?.amount || 0) ||
    a.name.localeCompare(b.name)
  )[0];
}

function insightRows(summary) {
  const rows = summary.officers;
  const sanctionLeader = topOfficer(rows, "sanctioned");
  const renewalLeader = topOfficer(rows, "renewalsDone", "count");
  const returnedLeader = topOfficer(rows, "returned", "count");
  const riskTotal = summary.totals.renewalDueSoon.count + summary.totals.renewalOverdue.count;
  const closedWork = summary.totals.sanctioned.count + summary.totals.returned.count + summary.totals.renewalsDone.count;
  const returnedRate = closedWork ? Math.round((summary.totals.returned.count / closedWork) * 100) : 0;
  return [
    ["Top sanction officer", sanctionLeader ? `${sanctionLeader.name} - Rs ${fmtAmt(sanctionLeader.sanctioned.amount)}L` : "No sanctions"],
    ["Top renewal officer", renewalLeader ? `${renewalLeader.name} - ${renewalLeader.renewalsDone.count} done` : "No renewals"],
    ["Highest returns", returnedLeader ? `${returnedLeader.name} - ${returnedLeader.returned.count} cases` : "No returns"],
    ["Return share", `${returnedRate}% of closed-month activity`],
    ["Current renewal risk", `${riskTotal} due soon / overdue accounts`],
  ];
}

function buildCoverPage(data, summary) {
  const generatedAt = new Date(summary.generatedAt).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return `<section class="me-page me-cover">
    <header class="me-header">
      <div>
        <div class="me-brand">Nirnay</div>
        <div class="me-kicker">MONTH END SNAPSHOT</div>
      </div>
      <div class="me-date">${esc(data.label)}</div>
    </header>
    <div class="me-hero">
      <div>
        <h1>Monthly Performance Dashboard</h1>
        <p>Sanctions, returns, renewals done, and active dashboard metrics captured before cleanup.</p>
      </div>
      <div class="me-close-badge">
        <span>Close Month</span>
        <strong>${esc(data.month)}</strong>
      </div>
    </div>
    <div class="me-metric-grid">
      ${metricCard("Sanctioned", summary.totals.sanctioned, "good")}
      ${metricCard("Returned", summary.totals.returned, "danger")}
      ${metricCard("Renewals Done", summary.totals.renewalsDone, "blue")}
      ${metricCard("Current Pending", summary.totals.pending, "warn")}
      ${metricCard("Due Soon", summary.totals.renewalDueSoon, "amber")}
      ${metricCard("Overdue / NPA", summary.totals.renewalOverdue, "danger")}
    </div>
    <div class="me-two-col">
      <section class="me-panel">
        <h2>Analysis Metrics</h2>
        <table class="me-table">
          <tbody>${insightRows(summary).map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`).join("")}</tbody>
        </table>
      </section>
      <section class="me-panel">
        <h2>Category Mix</h2>
        <table class="me-table">
          <thead><tr><th>Category</th><th>Sanctioned</th><th>Returned</th></tr></thead>
          <tbody>${summary.categories.sanctioned.map((row, index) => {
            const ret = summary.categories.returned[index] || { count: 0, amount: 0 };
            return `<tr>
              <th>${esc(row.category)}</th>
              <td>${esc(row.count)} / Rs ${esc(fmtAmt(row.amount))}L</td>
              <td>${esc(ret.count)} / Rs ${esc(fmtAmt(ret.amount))}L</td>
            </tr>`;
          }).join("")}</tbody>
        </table>
      </section>
    </div>
    <footer class="me-footer">
      <span>Generated ${esc(generatedAt)}</span>
      <span>${esc(summary.generatedBy)}</span>
      <span>AMCC Paonta Sahib</span>
    </footer>
  </section>`;
}

function buildOfficerPage(data, summary) {
  return `<section class="me-page">
    <header class="me-section-head">
      <div>
        <span class="me-kicker">OFFICER SUMMARY</span>
        <h2>${esc(data.label)}</h2>
      </div>
      <strong>${esc(summary.officers.length)} officers</strong>
    </header>
    <table class="me-table me-officer-table">
      <thead>
        <tr>
          <th>Officer</th>
          <th>Sanctioned</th>
          <th>Returned</th>
          <th>Renewals Done</th>
          <th>Pending</th>
          <th>Renewal Risk</th>
        </tr>
      </thead>
      <tbody>
        ${summary.officers.map(row => `<tr>
          <th>${esc(row.name)}</th>
          <td>${esc(row.sanctioned.count)}<small>Rs ${esc(fmtAmt(row.sanctioned.amount))}L</small></td>
          <td>${esc(row.returned.count)}<small>Rs ${esc(fmtAmt(row.returned.amount))}L</small></td>
          <td>${esc(row.renewalsDone.count)}<small>Rs ${esc(fmtAmt(row.renewalsDone.amount))}L</small></td>
          <td>${esc(row.pending.count)}<small>Rs ${esc(fmtAmt(row.pending.amount))}L</small></td>
          <td>${esc(row.dueSoon.count + row.overdue.count)}<small>${esc(row.dueSoon.count)} due / ${esc(row.overdue.count)} OD</small></td>
        </tr>`).join("")}
      </tbody>
    </table>
    <footer class="me-footer"><span>Month End Snapshot</span><span>${esc(data.label)}</span></footer>
  </section>`;
}

function detailRow(loan, index, dateKey, mode) {
  const dateText = fmtDate(loan[dateKey]) || "-";
  const note = mode === "renewal"
    ? `Due ${fmtDate(loan.renewalDueDate || loan._rs?.dueDateStr) || "-"} / Exp ${fmtDate(loan.limitExpiryDate) || "-"}`
    : (loan.remarks || "");
  return `<tr>
    <td class="me-num">${esc(index)}</td>
    <td class="me-customer"><strong>${esc(loan.customerName || "Unnamed")}</strong><span>${esc(note)}</span></td>
    <td>${esc(loan.allocatedTo || "Unassigned")}</td>
    <td>${esc(loan.branch || "-")}</td>
    <td>${esc(loan.category || "-")}</td>
    <td class="me-amount">Rs ${esc(fmtAmt(loan.amount))}L</td>
    <td>${esc(dateText)}</td>
  </tr>`;
}

function buildDetailPages(title, loans, dateKey, tone, mode = "fresh") {
  if (!loans.length) {
    return `<section class="me-page">
      <header class="me-section-head ${tone}">
        <div><span class="me-kicker">DETAIL LIST</span><h2>${esc(title)}</h2></div>
        <strong>0 records</strong>
      </header>
      <div class="me-empty">No records for this section.</div>
    </section>`;
  }

  const pages = [];
  for (let start = 0; start < loans.length; start += DETAIL_ROWS_PER_PAGE) {
    const chunk = loans.slice(start, start + DETAIL_ROWS_PER_PAGE);
    const part = Math.floor(start / DETAIL_ROWS_PER_PAGE) + 1;
    const totalParts = Math.ceil(loans.length / DETAIL_ROWS_PER_PAGE);
    pages.push(`<section class="me-page">
      <header class="me-section-head ${tone}">
        <div>
          <span class="me-kicker">DETAIL LIST${totalParts > 1 ? ` - PART ${part} OF ${totalParts}` : ""}</span>
          <h2>${esc(title)}</h2>
        </div>
        <strong>${esc(loans.length)} records</strong>
      </header>
      <table class="me-table me-detail-table">
        <thead>
          <tr><th>#</th><th>Customer</th><th>Officer</th><th>Branch</th><th>Cat</th><th>Amount</th><th>Date</th></tr>
        </thead>
        <tbody>${chunk.map((loan, index) => detailRow(loan, start + index + 1, dateKey, mode)).join("")}</tbody>
      </table>
      <footer class="me-footer"><span>${esc(title)}</span><span>${esc(part)} of ${esc(totalParts)}</span></footer>
    </section>`);
  }
  return pages.join("");
}

function monthlyPdfCss() {
  return `
    .me-report{width:${PDF_PAGE_WIDTH}px;background:#EDE8F4;color:#15122D;font-family:'Outfit','Inter','Segoe UI',Arial,sans-serif}
    .me-page{width:${PDF_PAGE_WIDTH}px;height:${PDF_PAGE_HEIGHT}px;position:relative;overflow:hidden;background:#FBFAF7;padding:30px 30px 42px;box-sizing:border-box}
    .me-page + .me-page{margin-top:20px}
    .me-header,.me-section-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}
    .me-brand{font-size:30px;font-weight:950;letter-spacing:-.03em;color:#13234C}
    .me-kicker{display:block;font-size:10px;font-weight:950;letter-spacing:.14em;text-transform:uppercase;color:#6B5FBF}
    .me-date{font-size:15px;font-weight:900;color:#4A4467}
    .me-hero{display:grid;grid-template-columns:1fr 160px;gap:18px;align-items:stretch;margin:34px 0 20px}
    .me-hero h1{margin:0 0 8px;font-size:42px;line-height:.98;letter-spacing:-.04em;color:#111B42}
    .me-hero p{margin:0;max-width:470px;color:#5F5A78;font-size:15px;line-height:1.45}
    .me-close-badge{border-radius:18px;background:#13234C;color:#fff;padding:18px;text-align:center}
    .me-close-badge span{display:block;font-size:10px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:#C7D2FE}
    .me-close-badge strong{display:block;margin-top:10px;font-size:28px;line-height:1}
    .me-metric-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:20px 0}
    .me-metric{border-radius:12px;background:#F4F1FB;border:1px solid rgba(107,95,191,.12);padding:14px 16px}
    .me-metric span{display:block;font-size:9px;font-weight:950;letter-spacing:.08em;text-transform:uppercase;color:#756F91}
    .me-metric strong{display:block;margin-top:5px;font-size:28px;line-height:1}
    .me-metric small{display:block;margin-top:4px;font-size:11px;font-weight:850;color:#4D4868}
    .me-metric.good{background:#ECFDF5;color:#047857;border-color:#A7F3D0}
    .me-metric.danger{background:#FEF2F2;color:#B91C1C;border-color:#FECACA}
    .me-metric.blue{background:#EFF6FF;color:#1D4ED8;border-color:#BFDBFE}
    .me-metric.warn,.me-metric.amber{background:#FFF7ED;color:#C2410C;border-color:#FED7AA}
    .me-two-col{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:18px}
    .me-panel{background:#fff;border:1px solid rgba(35,25,70,.08);border-radius:12px;padding:14px;box-shadow:0 5px 14px rgba(45,35,85,.04)}
    .me-panel h2,.me-section-head h2{margin:0 0 10px;font-size:20px;color:#102151}
    .me-section-head h2{font-size:28px;margin-top:5px}
    .me-section-head strong{font-size:14px;color:#4A4467}
    .me-section-head.good .me-kicker{color:#047857}
    .me-section-head.danger .me-kicker{color:#B91C1C}
    .me-section-head.blue .me-kicker{color:#1D4ED8}
    .me-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:10px;color:#15122D}
    .me-table th,.me-table td{padding:8px 7px;border-bottom:1px solid rgba(35,25,70,.08);vertical-align:top;text-align:left;overflow:hidden;text-overflow:ellipsis}
    .me-table thead th{font-size:8px;font-weight:950;letter-spacing:.06em;text-transform:uppercase;color:#515A75;background:#F8FAFC}
    .me-table tbody th{font-weight:900;color:#111B42}
    .me-table small,.me-customer span{display:block;margin-top:3px;font-size:8px;font-weight:750;color:#64748B;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .me-officer-table{margin-top:22px;font-size:10px}
    .me-detail-table{margin-top:22px;font-size:8.8px}
    .me-detail-table th:nth-child(1),.me-detail-table td:nth-child(1){width:20px;text-align:right}
    .me-detail-table th:nth-child(2),.me-detail-table td:nth-child(2){width:230px}
    .me-detail-table th:nth-child(3),.me-detail-table td:nth-child(3){width:70px}
    .me-detail-table th:nth-child(4),.me-detail-table td:nth-child(4){width:92px}
    .me-detail-table th:nth-child(5),.me-detail-table td:nth-child(5){width:52px}
    .me-detail-table th:nth-child(6),.me-detail-table td:nth-child(6){width:66px;text-align:right}
    .me-detail-table th:nth-child(7),.me-detail-table td:nth-child(7){width:66px;text-align:right}
    .me-customer strong{display:block;font-size:9px;line-height:1.15;color:#111B42;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .me-amount{font-weight:900;color:#111B42;white-space:nowrap}
    .me-empty{margin-top:30px;border:1px dashed #CBD5E1;border-radius:12px;padding:40px;text-align:center;color:#64748B;font-weight:850;background:#fff}
    .me-footer{position:absolute;left:30px;right:30px;bottom:16px;display:flex;justify-content:space-between;gap:14px;color:#8983A1;font-size:9px;font-weight:850}
  `;
}

function buildMonthlySnapshotPdfHtml(data, summary) {
  return `<div class="me-report">
    <style>${monthlyPdfCss()}</style>
    ${buildCoverPage(data, summary)}
    ${buildOfficerPage(data, summary)}
    ${buildDetailPages("Sanctions Done", data.sanctioned, "sanctionDate", "good")}
    ${buildDetailPages("Returns Done", data.returned, "returnedDate", "danger")}
    ${buildDetailPages("Renewals Done", data.renewalsDone, "renewedDate", "blue", "renewal")}
  </div>`;
}

async function downloadMonthlyPdf(data, summary) {
  let exportHost;
  try {
    await ensureHtml2Canvas();
    await ensureJsPdf();
    if (document.fonts && document.fonts.ready) await document.fonts.ready;

    exportHost = document.createElement("div");
    exportHost.className = "pdf-export-host";
    exportHost.style.position = "fixed";
    exportHost.style.left = "-10000px";
    exportHost.style.top = "0";
    exportHost.style.width = `${PDF_PAGE_WIDTH}px`;
    exportHost.style.pointerEvents = "none";
    exportHost.innerHTML = buildMonthlySnapshotPdfHtml(data, summary);
    document.body.appendChild(exportHost);

    const pages = Array.from(exportHost.querySelectorAll(".me-page"));
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
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `monthly-snapshot-${data.month}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } finally {
    if (exportHost) exportHost.remove();
  }
}

async function saveMonthlySummary(month, summary) {
  await setDoc(doc(db, SNAPSHOT_COLLECTION, month), summary, { merge: true });
}

function cleanupSummaryText(data) {
  return `This will remove ${data.sanctioned.length} sanctions, ${data.returned.length} returns, and clear ${data.renewalsDone.length} renewal done flags for ${data.label}. Continue?`;
}

async function commitCleanup(data) {
  const operations = [
    ...data.sanctioned.map(loan => ({ type: "delete", id: loan.id })),
    ...data.returned.map(loan => ({ type: "delete", id: loan.id })),
    ...data.renewalsDone.map(loan => ({
      type: "update",
      id: loan.id,
      data: {
        renewedDate: "",
        renewalDatesPending: false,
        monthEndClearedMonth: data.month,
        monthEndClearedAt: new Date().toISOString(),
        ...ts(),
      },
    })),
  ];

  for (let start = 0; start < operations.length; start += 450) {
    const batch = writeBatch(db);
    operations.slice(start, start + 450).forEach(op => {
      const ref = doc(db, "loans", op.id);
      if (op.type === "delete") batch.delete(ref);
      else batch.update(ref, op.data);
    });
    await batch.commit();
  }

  await setDoc(doc(db, SNAPSHOT_COLLECTION, data.month), {
    cleanup: {
      cleanedAt: new Date().toISOString(),
      cleanedBy: S.user || "Admin",
      deletedSanctions: data.sanctioned.length,
      deletedReturns: data.returned.length,
      clearedRenewals: data.renewalsDone.length,
    },
  }, { merge: true });
}

window.runMonthEndSnapshot = async function () {
  if (!S.isAdmin) {
    toast("Admin only");
    return;
  }

  const btn = document.getElementById("monthEndSnapshotBtn");
  const month = previousMonthKey();
  const data = collectMonthEndData(month);
  const summary = buildLightweightSummary(data);

  if (!confirm(`Generate month-end snapshot for ${data.label}? Cleanup will be asked separately after the PDF is created.`)) {
    return;
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Generating snapshot...";
    }
    toast("Preparing monthly PDF...");
    await downloadMonthlyPdf(data, summary);
    await saveMonthlySummary(month, summary);
    toast("Monthly snapshot saved. Review the PDF, then clean up separately.");
    renderMonthEndSettings();
  } catch (err) {
    console.error("[MonthEnd] Snapshot failed:", err);
    toast("Unable to complete month-end snapshot");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = `Generate ${monthLabel(previousMonthKey())} Snapshot`;
    }
  }
};

window.runMonthEndCleanup = async function () {
  if (!S.isAdmin) {
    toast("Admin only");
    return;
  }

  const btn = document.getElementById("monthEndCleanupBtn");
  const month = previousMonthKey();
  const data = collectMonthEndData(month);

  if (!confirm(cleanupSummaryText(data))) return;

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Cleaning month...";
    }
    await commitCleanup(data);
    toast("Month-end cleanup complete");
    if (typeof window.render === "function") window.render();
    renderMonthEndSettings();
  } catch (err) {
    console.error("[MonthEnd] Cleanup failed:", err);
    toast("Unable to complete month-end cleanup");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = `Clean ${monthLabel(previousMonthKey())} Data`;
    }
  }
};

function totalsLine(totals) {
  return [
    `Sanctioned ${totals.sanctioned?.count || 0}`,
    `Returned ${totals.returned?.count || 0}`,
    `Renewals ${totals.renewalsDone?.count || 0}`,
  ].join(" | ");
}

export async function renderMonthEndSettings() {
  const target = document.getElementById("monthEndHistory");
  if (!target) return;
  target.innerHTML = `<div style="padding:10px 0;color:#7B7A9A;font-size:13px;">Loading previous month summaries...</div>`;
  try {
    const snap = await getDocs(collection(db, SNAPSHOT_COLLECTION));
    const rows = snap.docs
      .map(docSnap => docSnap.data())
      .filter(item => item && item.month)
      .sort((a, b) => String(b.month).localeCompare(String(a.month)));

    if (!rows.length) {
      target.innerHTML = `<div class="setting-item"><span>No monthly dashboard summaries yet.</span></div>`;
      return;
    }

    target.innerHTML = rows.slice(0, 12).map(row => {
      const cleanup = row.cleanup
        ? `<small style="display:block;color:#047857;margin-top:3px;">Cleaned by ${esc(row.cleanup.cleanedBy || "Admin")}</small>`
        : `<small style="display:block;color:#B45309;margin-top:3px;">Cleanup not recorded</small>`;
      return `<div class="setting-item" style="align-items:flex-start;">
        <span>
          <b>${esc(row.label || row.month)}</b>
          <small style="display:block;color:#7B7A9A;margin-top:3px;">${esc(totalsLine(row.totals || {}))}</small>
          ${cleanup}
        </span>
        <span style="font-weight:800;color:#4A4467;">Rs ${esc(fmtAmt(row.totals?.sanctioned?.amount || 0))}L</span>
      </div>`;
    }).join("");
  } catch (err) {
    console.error("[MonthEnd] Failed to load monthly summaries:", err);
    target.innerHTML = `<div class="setting-item"><span>Unable to load monthly summaries.</span></div>`;
  }
}
