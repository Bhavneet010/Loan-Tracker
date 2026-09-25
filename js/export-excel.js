import { S } from "./state.js";
import { effectiveOfficer, getLoanMetrics } from "./derived.js";
import { isFreshCC, toast, branchCode, daysPending } from "./utils.js";
import { getCalendarMonthExport, getCalendarMonthsExport } from "./ui-calendar.js";
import { getCriticalCareExport } from "./ui-tasks.js";
import { ensureJsPdf } from "./performance-snapshot.js";
import { buildMultiMonthExportFilename } from "./calendar-export-model.js";
import { buildMultiMonthTabularLayout } from "./calendar-export-layout.js";
import { renderMultiMonthRenewalPdf } from "./calendar-export-pdf.js";
import { createRetryableScriptLoader } from "./script-loader.js";
import { formatDateStr, istDateStr } from "./ist-date.js";

// xlsx-js-style is API-compatible with SheetJS but can also write cell styles
// (used to grey out "renewal not possible" rows in the calendar export).
const XLSX_CDN = "https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js";

const ensureXlsx = createRetryableScriptLoader({
  documentRef: document,
  isReady: () => !!window.XLSX,
  src: XLSX_CDN,
  errorMessage: "Failed to load SheetJS",
});

const CAT_ORDER = { Agriculture: 0, SME: 1, Education: 2 };

function fmt(s) {
  if (!s) return "";
  const p = s.split("-");
  return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : s;
}

function up(s) {
  return s ? String(s).toUpperCase() : "";
}

function pendingRows(loans) {
  return loans
    .filter(l => isFreshCC(l) && l.status === "pending")
    .sort((a, b) => {
      const cd = (CAT_ORDER[a.category] ?? 99) - (CAT_ORDER[b.category] ?? 99);
      return cd !== 0 ? cd : (a.receiveDate || "").localeCompare(b.receiveDate || "");
    })
    .map(l => ({
      "Category": up(l.category),
      "Officer": up(effectiveOfficer(l)),
      "Branch": up(l.branch),
      "Customer Name": up(l.customerName),
      "Amount (₹ Lakhs)": parseFloat(l.amount) || 0,
      "Receive Date": fmt(l.receiveDate),
      "Remarks": up(l.remarks),
    }));
}

function sanctionedRows(loans) {
  return loans
    .filter(l => isFreshCC(l) && l.status === "sanctioned")
    .sort((a, b) => (b.sanctionDate || "").localeCompare(a.sanctionDate || ""))
    .map(l => ({
      "Officer": up(effectiveOfficer(l)),
      "Branch": up(l.branch),
      "Customer Name": up(l.customerName),
      "Amount (₹ Lakhs)": parseFloat(l.amount) || 0,
      "Category": up(l.category),
      "Receive Date": fmt(l.receiveDate),
      "Sanction Date": fmt(l.sanctionDate),
      "Remarks": up(l.remarks),
    }));
}

function returnedRows(loans) {
  return loans
    .filter(l => isFreshCC(l) && l.status === "returned")
    .sort((a, b) => (b.returnedDate || "").localeCompare(a.returnedDate || ""))
    .map(l => ({
      "Officer": up(effectiveOfficer(l)),
      "Branch": up(l.branch),
      "Customer Name": up(l.customerName),
      "Amount (₹ Lakhs)": parseFloat(l.amount) || 0,
      "Category": up(l.category),
      "Receive Date": fmt(l.receiveDate),
      "Returned Date": fmt(l.returnedDate),
      "Remarks": up(l.remarks),
    }));
}

// Uses every renewal still flagged done (not just the current month) so an
// export taken before month-end cleanup carries last month's renewals, matching
// how the sanctioned/returned sheets keep rows until cleanup removes them.
function renewalsDoneRows() {
  return getLoanMetrics().renewalDonePendingCleanup
    .slice()
    .sort((a, b) => (b.renewedDate || "").localeCompare(a.renewedDate || ""))
    .map(l => ({
      "Officer": up(effectiveOfficer(l)),
      "Branch": up(l.branch),
      "Customer Name": up(l.customerName),
      "Limit (₹ Lakhs)": parseFloat(l.amount) || 0,
      "Renewed Date": fmt(l.renewedDate),
      "Next Renewal Due": fmt(l.renewalDueDate),
    }));
}

function makeSheet(rows, emptyHeaders) {
  const XLSX = window.XLSX;
  if (!rows.length) {
    const ws = XLSX.utils.aoa_to_sheet([emptyHeaders]);
    ws["!cols"] = emptyHeaders.map(h => ({ wch: h.length + 2 }));
    return ws;
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = Object.keys(rows[0]).map(key => ({
    wch: Math.max(key.length, ...rows.map(r => String(r[key] ?? "").length)) + 2,
  }));
  return ws;
}

window.exportLoansExcel = async function () {
  try {
    toast("Preparing Excel export…");
    await ensureXlsx();
    const XLSX = window.XLSX;
    const loans = S.loans;

    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      wb,
      makeSheet(pendingRows(loans), ["Category", "Officer", "Branch", "Customer Name", "Amount (₹ Lakhs)", "Receive Date", "Remarks"]),
      "Pending Loans"
    );
    XLSX.utils.book_append_sheet(
      wb,
      makeSheet(sanctionedRows(loans), ["Officer", "Branch", "Customer Name", "Amount (₹ Lakhs)", "Category", "Receive Date", "Sanction Date", "Remarks"]),
      "Sanctioned Loans"
    );
    XLSX.utils.book_append_sheet(
      wb,
      makeSheet(returnedRows(loans), ["Officer", "Branch", "Customer Name", "Amount (₹ Lakhs)", "Category", "Receive Date", "Returned Date", "Remarks"]),
      "Returned Loans"
    );
    XLSX.utils.book_append_sheet(
      wb,
      makeSheet(renewalsDoneRows(), ["Officer", "Branch", "Customer Name", "Limit (₹ Lakhs)", "Renewed Date", "Next Renewal Due"]),
      "Renewals Done"
    );

    XLSX.writeFile(wb, `nirnay-loans-${istDateStr()}.xlsx`);
    toast("Excel exported!");
  } catch (err) {
    console.error("[Excel export]", err);
    toast("Export failed. Please try again.");
  }
};

window.toggleCalExportMenu = function (e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById("calExportMenu");
  const trigger = document.getElementById("calExportTrigger");
  if (!menu) return;
  const isOpen = menu.classList.contains("open");
  if (isOpen) {
    menu.classList.remove("open");
    trigger?.setAttribute("aria-expanded", "false");
  } else {
    menu.classList.add("open");
    trigger?.setAttribute("aria-expanded", "true");
    setTimeout(() => document.addEventListener("click", window.closeCalExportMenu, { once: true }), 0);
  }
};

window.closeCalExportMenu = function () {
  const menu = document.getElementById("calExportMenu");
  if (menu) menu.classList.remove("open");
  document.getElementById("calExportTrigger")?.setAttribute("aria-expanded", "false");
};

function renewalDueRow(l) {
  const rs = l._rs;
  return {
    "Officer": up(effectiveOfficer(l)),
    "Customer Name": up(l.customerName),
    "A/C Number": up(l.acNumber),
    "Branch": up(branchCode(l.branch)),
    "Limit (₹ Lakhs)": parseFloat(l.amount) || 0,
    "Renewal Due Date": fmt(rs.dueDateStr),
    "NPA Date": fmt(rs.lastPendingDateStr),
    "Remarks": up(l.renewalNotPossible ? (l.renewalNotPossibleRemarks || l.remarks) : l.remarks),
  };
}

const RENEWAL_DUE_HEADERS = ["Officer", "Customer Name", "A/C Number", "Branch", "Limit (₹ Lakhs)", "Renewal Due Date", "NPA Date", "Remarks"];

function createMultiMonthRenewalSheet(sections) {
  const XLSX = window.XLSX;
  const layout = buildMultiMonthTabularLayout(sections, RENEWAL_DUE_HEADERS, renewalDueRow);
  const ws = XLSX.utils.aoa_to_sheet(layout.rows);
  ws["!merges"] = layout.merges;

  ws["!cols"] = RENEWAL_DUE_HEADERS.map((header, column) => ({
    wch: Math.max(
      header.length,
      ...layout.dataRows.map(({ row }) => String(layout.rows[row][column] ?? "").length),
    ) + 2,
  }));
  const remarksColumn = RENEWAL_DUE_HEADERS.indexOf("Remarks");
  const remarksWidth = 40;
  ws["!cols"][remarksColumn] = { wch: Math.min(ws["!cols"][remarksColumn].wch, remarksWidth) };
  ws["!rows"] = Array.from({ length: layout.rows.length }, () => ({}));

  layout.headingRows.forEach(row => {
    ws["!rows"][row] = { hpt: 24 };
    const cell = ws[XLSX.utils.encode_cell({ r: row, c: 0 })];
    if (cell) {
      cell.s = {
        fill: { patternType: "solid", fgColor: { rgb: "6B5FBF" } },
        font: { bold: true, color: { rgb: "FFFFFF" }, sz: 12 },
        alignment: { vertical: "center" },
      };
    }
  });

  layout.headerRows.forEach(row => {
    for (let column = 0; column < RENEWAL_DUE_HEADERS.length; column++) {
      const cell = ws[XLSX.utils.encode_cell({ r: row, c: column })];
      if (cell) {
        cell.s = {
          fill: { patternType: "solid", fgColor: { rgb: "E9E5F7" } },
          font: { bold: true, color: { rgb: "3D3480" } },
          alignment: { vertical: "center" },
        };
      }
    }
  });

  layout.dataRows.forEach(({ row, rnp }) => {
    const remarks = String(layout.rows[row][remarksColumn] || "");
    const lines = Math.max(1, Math.ceil(remarks.length / remarksWidth));
    ws["!rows"][row] = lines > 1 ? { hpt: 13 * lines + 4 } : {};
    for (let column = 0; column < RENEWAL_DUE_HEADERS.length; column++) {
      const cell = ws[XLSX.utils.encode_cell({ r: row, c: column })];
      if (!cell) continue;
      const existing = cell.s || {};
      cell.s = {
        ...existing,
        ...(rnp ? { fill: { patternType: "solid", fgColor: { rgb: "E2E8F0" } } } : {}),
        alignment: {
          ...(existing.alignment || {}),
          vertical: "top",
          ...(column === remarksColumn ? { wrapText: true } : {}),
        },
      };
    }
  });

  layout.emptyRows.forEach(row => {
    const cell = ws[XLSX.utils.encode_cell({ r: row, c: 0 })];
    if (cell) {
      cell.s = {
        font: { italic: true, color: { rgb: "64748B" } },
        alignment: { vertical: "center" },
      };
    }
  });

  return ws;
}

window.exportCalendarRenewalsExcel = async function () {
  try {
    const { year, monthName, loans, rnpLoans } = getCalendarMonthExport();
    if (!loans.length && !rnpLoans.length) {
      toast(`No renewals due in ${monthName} ${year}`);
      return;
    }
    toast("Preparing Excel export…");
    await ensureXlsx();
    const XLSX = window.XLSX;

    const rows = [
      ...loans.map(renewalDueRow),
      ...rnpLoans.map(renewalDueRow),
    ];

    const ws = makeSheet(rows, RENEWAL_DUE_HEADERS);

    // Cap the Remarks column width and wrap long remarks onto multiple lines,
    // growing the row height to fit instead of stretching the column.
    const REMARKS_COL = RENEWAL_DUE_HEADERS.indexOf("Remarks");
    const REMARKS_WCH = 40;
    if (ws["!cols"] && ws["!cols"][REMARKS_COL] && ws["!cols"][REMARKS_COL].wch > REMARKS_WCH) {
      ws["!cols"][REMARKS_COL] = { wch: REMARKS_WCH };
    }
    ws["!rows"] = [{}];
    rows.forEach((row, i) => {
      const lines = Math.max(1, Math.ceil(String(row["Remarks"] || "").length / REMARKS_WCH));
      ws["!rows"][i + 1] = lines > 1 ? { hpt: 13 * lines + 4 } : {};
      const cell = ws[XLSX.utils.encode_cell({ r: i + 1, c: REMARKS_COL })];
      if (cell) cell.s = { alignment: { wrapText: true, vertical: "top" } };
    });

    // Grey-fill "renewal not possible" rows (they sit after the normal rows;
    // +1 skips the header row). Needs the style-capable xlsx-js-style build —
    // a plain SheetJS build already on the page just ignores the styling.
    for (let i = 0; i < rnpLoans.length; i++) {
      const r = loans.length + i + 1;
      for (let c = 0; c < RENEWAL_DUE_HEADERS.length; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell) cell.s = { ...(cell.s || {}), fill: { patternType: "solid", fgColor: { rgb: "E2E8F0" } } };
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${monthName} ${year}`.slice(0, 31));
    XLSX.writeFile(wb, `nirnay-renewals-due-${monthName.toLowerCase()}-${year}.xlsx`);
    toast(`${monthName} renewals exported!`);
  } catch (err) {
    console.error("[Calendar export]", err);
    toast("Export failed. Please try again.");
  }
};

window.exportCalendarRenewalsMultiExcel = async function (monthKeys) {
  try {
    const sections = getCalendarMonthsExport(monthKeys);
    if (!sections.length) throw new TypeError("Select at least one month");
    toast("Preparing multi-month Excel export…");
    await ensureXlsx();
    const XLSX = window.XLSX;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, createMultiMonthRenewalSheet(sections), "Pending Renewals");
    XLSX.writeFile(wb, buildMultiMonthExportFilename(monthKeys, "xlsx"));
    toast(`${sections.length} month${sections.length === 1 ? "" : "s"} exported!`);
    return true;
  } catch (err) {
    console.error("[Multi-month calendar Excel export]", err);
    toast("Export failed. Please try again.");
    return false;
  }
};

// jsPDF's built-in fonts can't render ₹, so amounts use "Rs".
// Widths sum to 194mm = portrait A4 (210) minus 8mm margins.
const PDF_COLS = [
  { header: "#", w: 7 },
  { header: "Officer", w: 22, key: "Officer" },
  { header: "Customer Name", w: 40, key: "Customer Name" },
  { header: "A/C Number", w: 22, key: "A/C Number" },
  { header: "Branch", w: 12, key: "Branch" },
  { header: "Limit (Rs L)", w: 15, key: "Limit (₹ Lakhs)", align: "right" },
  { header: "Renewal Due", w: 19, key: "Renewal Due Date" },
  { header: "NPA Date", w: 19, key: "NPA Date" },
  { header: "Remarks", w: 38, key: "Remarks" },
];

function pdfFitText(doc, text, maxW) {
  let t = String(text ?? "");
  if (doc.getTextWidth(t) <= maxW) return t;
  while (t.length && doc.getTextWidth(t + "...") > maxW) t = t.slice(0, -1);
  return t + "...";
}

window.exportCalendarRenewalsPdf = async function () {
  try {
    const { year, monthName, loans, rnpLoans } = getCalendarMonthExport();
    if (!loans.length && !rnpLoans.length) {
      toast(`No renewals due in ${monthName} ${year}`);
      return;
    }
    toast("Preparing PDF export…");
    await ensureJsPdf();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

    const rows = [
      ...loans.map(l => ({ r: renewalDueRow(l), rnp: false })),
      ...rnpLoans.map(l => ({ r: renewalDueRow(l), rnp: true })),
    ];

    const M = 8;
    const pageH = doc.internal.pageSize.getHeight();
    const rowH = 5.4;
    const cellPad = 1.2;
    let y;

    const colX = [];
    let x = M;
    PDF_COLS.forEach(c => { colX.push(x); x += c.w; });
    const tableW = x - M;

    const drawHeaderRow = () => {
      doc.setFillColor(107, 95, 191);
      doc.rect(M, y, tableW, rowH, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.2);
      doc.setTextColor(255, 255, 255);
      PDF_COLS.forEach((c, i) => {
        const tx = c.align === "right" ? colX[i] + c.w - cellPad : colX[i] + cellPad;
        doc.text(c.header, tx, y + rowH - 1.7, { align: c.align === "right" ? "right" : "left" });
      });
      y += rowH;
    };

    const startPage = () => {
      y = M;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12.5);
      doc.setTextColor(40, 35, 70);
      doc.text(`Renewals Due — ${monthName} ${year}`, M, y + 4);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.8);
      doc.setTextColor(110, 110, 125);
      const parts = [`${loans.length} renewal${loans.length !== 1 ? "s" : ""} due`];
      if (rnpLoans.length) parts.push(`${rnpLoans.length} not possible (grey rows)`);
      parts.push(`generated ${formatDateStr(istDateStr(), { day: "numeric", month: "short", year: "numeric" })}`);
      doc.text(parts.join("  ·  "), M, y + 8.6);
      y += 12.5;
      drawHeaderRow();
    };

    startPage();
    const lineH = 3.1;
    const remarksW = PDF_COLS[PDF_COLS.length - 1].w - cellPad * 2;
    rows.forEach(({ r, rnp }, idx) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.2);
      // Long remarks wrap within their column; the row grows to fit and
      // everything below shifts down.
      const remarkLines = doc.splitTextToSize(String(r["Remarks"] ?? ""), remarksW);
      const h = Math.max(rowH, remarkLines.length * lineH + (rowH - lineH));
      if (y + h > pageH - M) {
        doc.addPage("a4", "portrait");
        startPage();
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.2);
      }
      if (rnp) {
        doc.setFillColor(226, 232, 240);
        doc.rect(M, y, tableW, h, "F");
      } else if (idx % 2 === 1) {
        doc.setFillColor(244, 242, 250);
        doc.rect(M, y, tableW, h, "F");
      }
      doc.setTextColor(...(rnp ? [100, 116, 139] : [45, 45, 55]));
      const baseY = y + rowH - 1.7;
      PDF_COLS.forEach((c, i) => {
        const tx = c.align === "right" ? colX[i] + c.w - cellPad : colX[i] + cellPad;
        if (c.key === "Remarks") {
          remarkLines.forEach((ln, li) => doc.text(ln, tx, baseY + li * lineH));
          return;
        }
        const raw = c.key ? r[c.key] : idx + 1;
        const text = pdfFitText(doc, raw, c.w - cellPad * 2);
        doc.text(text, tx, baseY, { align: c.align === "right" ? "right" : "left" });
      });
      doc.setDrawColor(225, 222, 238);
      doc.setLineWidth(0.15);
      doc.line(M, y + h, M + tableW, y + h);
      y += h;
    });

    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(150, 150, 160);
      doc.text(`Page ${p} of ${pageCount}`, doc.internal.pageSize.getWidth() - M, pageH - 4, { align: "right" });
    }

    doc.save(`nirnay-renewals-due-${monthName.toLowerCase()}-${year}.pdf`);
    toast(`${monthName} renewals PDF exported!`);
  } catch (err) {
    console.error("[Calendar PDF export]", err);
    toast("Export failed. Please try again.");
  }
};

window.exportCalendarRenewalsMultiPdf = async function (monthKeys) {
  try {
    const sections = getCalendarMonthsExport(monthKeys);
    if (!sections.length) throw new TypeError("Select at least one month");
    toast("Preparing multi-month PDF export…");
    await ensureJsPdf();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    renderMultiMonthRenewalPdf(doc, sections, {
      columns: PDF_COLS,
      rowMapper: renewalDueRow,
    });
    doc.save(buildMultiMonthExportFilename(monthKeys, "pdf"));
    toast(`${sections.length} month${sections.length === 1 ? "" : "s"} exported to PDF!`);
    return true;
  } catch (err) {
    console.error("[Multi-month calendar PDF export]", err);
    toast("Export failed. Please try again.");
    return false;
  }
};

/* ── Critical Care: one download per bucket ── */

const isStageBucket = key => key === "docPending" || key === "disbPending";

function criticalRemarks(l) {
  return up(l.renewalNotPossible ? (l.renewalNotPossibleRemarks || l.remarks) : l.remarks);
}

function criticalCareRow(key, l) {
  const base = {
    "Officer": up(effectiveOfficer(l)),
    "Customer Name": up(l.customerName),
    "A/C Number": up(l.acNumber),
    "Branch": up(branchCode(l.branch)),
  };
  if (key === "npa15") {
    return {
      ...base,
      "Limit (₹ Lakhs)": parseFloat(l.amount) || 0,
      "Renewal Due Date": fmt(l._rs?.dueDateStr),
      "NPA Date": fmt(l._rs?.lastPendingDateStr),
      "Days to NPA": l._rs?.daysUntilNpa ?? "",
      "Remarks": criticalRemarks(l),
    };
  }
  if (isStageBucket(key)) {
    const fresh = isFreshCC(l);
    const stageDate = fresh ? l.sanctionDate : l.renewedDate;
    return {
      "Type": fresh ? "FRESH" : "RENEWAL",
      ...base,
      "Amount (₹ Lakhs)": parseFloat(l.amount) || 0,
      "Sanctioned / Renewed": fmt(stageDate),
      "Days Since": stageDate ? daysPending(stageDate) : "",
      "Remarks": criticalRemarks(l),
    };
  }
  return { ...base, "Limit (₹ Lakhs)": parseFloat(l.amount) || 0, "Remarks": criticalRemarks(l) };
}

const CRITICAL_HEADERS = {
  npa15: ["Officer", "Customer Name", "A/C Number", "Branch", "Limit (₹ Lakhs)", "Renewal Due Date", "NPA Date", "Days to NPA", "Remarks"],
  datesMissing: ["Officer", "Customer Name", "A/C Number", "Branch", "Limit (₹ Lakhs)", "Remarks"],
  docPending: ["Type", "Officer", "Customer Name", "A/C Number", "Branch", "Amount (₹ Lakhs)", "Sanctioned / Renewed", "Days Since", "Remarks"],
};
CRITICAL_HEADERS.disbPending = CRITICAL_HEADERS.docPending;

// Widths sum to 194mm = portrait A4 (210) minus 8mm margins.
const CRITICAL_PDF_COLS = {
  npa15: [
    { header: "#", w: 7 },
    { header: "Officer", w: 22, key: "Officer" },
    { header: "Customer Name", w: 38, key: "Customer Name" },
    { header: "A/C Number", w: 22, key: "A/C Number" },
    { header: "Branch", w: 12, key: "Branch" },
    { header: "Limit (Rs L)", w: 15, key: "Limit (₹ Lakhs)", align: "right" },
    { header: "Renewal Due", w: 18, key: "Renewal Due Date" },
    { header: "NPA Date", w: 18, key: "NPA Date" },
    { header: "Days", w: 10, key: "Days to NPA", align: "right" },
    { header: "Remarks", w: 32, key: "Remarks" },
  ],
  datesMissing: [
    { header: "#", w: 7 },
    { header: "Officer", w: 24, key: "Officer" },
    { header: "Customer Name", w: 50, key: "Customer Name" },
    { header: "A/C Number", w: 26, key: "A/C Number" },
    { header: "Branch", w: 14, key: "Branch" },
    { header: "Limit (Rs L)", w: 17, key: "Limit (₹ Lakhs)", align: "right" },
    { header: "Remarks", w: 56, key: "Remarks" },
  ],
  docPending: [
    { header: "#", w: 7 },
    { header: "Type", w: 15, key: "Type" },
    { header: "Officer", w: 22, key: "Officer" },
    { header: "Customer Name", w: 36, key: "Customer Name" },
    { header: "A/C Number", w: 22, key: "A/C Number" },
    { header: "Branch", w: 12, key: "Branch" },
    { header: "Amt (Rs L)", w: 15, key: "Amount (₹ Lakhs)", align: "right" },
    { header: "Sanc./Renewed", w: 20, key: "Sanctioned / Renewed" },
    { header: "Days", w: 10, key: "Days Since", align: "right" },
    { header: "Remarks", w: 35, key: "Remarks" },
  ],
};
CRITICAL_PDF_COLS.disbPending = CRITICAL_PDF_COLS.docPending;

function criticalCareFilename(title, extension) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `nirnay-critical-care-${slug}-${istDateStr()}.${extension}`;
}

function loadCriticalCare(key) {
  const data = getCriticalCareExport(key);
  if (!data.loans.length && !data.rnpLoans.length) {
    toast(`No accounts in ${data.title}`);
    return null;
  }
  return data;
}

window.exportCriticalCareExcel = async function (key) {
  try {
    const data = loadCriticalCare(key);
    if (!data) return;
    toast("Preparing Excel export…");
    await ensureXlsx();
    const XLSX = window.XLSX;
    const headers = CRITICAL_HEADERS[key];
    const rows = [...data.loans, ...data.rnpLoans].map(l => criticalCareRow(key, l));
    const ws = makeSheet(rows, headers);

    // Same treatment as the calendar export: wrap long remarks and grey out
    // "renewal not possible" rows (they sit last; +1 skips the header row).
    const REMARKS_COL = headers.indexOf("Remarks");
    const REMARKS_WCH = 40;
    if (ws["!cols"]?.[REMARKS_COL]?.wch > REMARKS_WCH) ws["!cols"][REMARKS_COL] = { wch: REMARKS_WCH };
    ws["!rows"] = [{}];
    rows.forEach((row, i) => {
      const lines = Math.max(1, Math.ceil(String(row["Remarks"] || "").length / REMARKS_WCH));
      ws["!rows"][i + 1] = lines > 1 ? { hpt: 13 * lines + 4 } : {};
      const cell = ws[XLSX.utils.encode_cell({ r: i + 1, c: REMARKS_COL })];
      if (cell) cell.s = { alignment: { wrapText: true, vertical: "top" } };
    });
    for (let i = 0; i < data.rnpLoans.length; i++) {
      const r = data.loans.length + i + 1;
      for (let c = 0; c < headers.length; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell) cell.s = { ...(cell.s || {}), fill: { patternType: "solid", fgColor: { rgb: "E2E8F0" } } };
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, data.title.slice(0, 31));
    XLSX.writeFile(wb, criticalCareFilename(data.title, "xlsx"));
    toast(`${data.title} exported!`);
  } catch (err) {
    console.error("[Critical Care Excel export]", err);
    toast("Export failed. Please try again.");
  }
};

window.exportCriticalCarePdf = async function (key) {
  try {
    const data = loadCriticalCare(key);
    if (!data) return;
    toast("Preparing PDF export…");
    await ensureJsPdf();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const cols = CRITICAL_PDF_COLS[key];
    const rows = [
      ...data.loans.map(l => ({ r: criticalCareRow(key, l), rnp: false })),
      ...data.rnpLoans.map(l => ({ r: criticalCareRow(key, l), rnp: true })),
    ];
    const total = data.loans.reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0);

    const M = 8;
    const pageH = doc.internal.pageSize.getHeight();
    const rowH = 5.4;
    const cellPad = 1.2;
    const lineH = 3.1;
    let y;

    const colX = [];
    let x = M;
    cols.forEach(c => { colX.push(x); x += c.w; });
    const tableW = x - M;
    const textX = (c, i) => (c.align === "right" ? colX[i] + c.w - cellPad : colX[i] + cellPad);
    const textOpts = c => ({ align: c.align === "right" ? "right" : "left" });

    const startPage = () => {
      y = M;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12.5);
      doc.setTextColor(40, 35, 70);
      doc.text(`Critical Care — ${data.title}`, M, y + 4);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.8);
      doc.setTextColor(110, 110, 125);
      const parts = [`${data.loans.length} account${data.loans.length !== 1 ? "s" : ""}`, `Rs ${Math.round(total * 100) / 100}L`];
      if (data.rnpLoans.length) parts.push(`${data.rnpLoans.length} not possible (grey rows)`);
      parts.push(`generated ${formatDateStr(istDateStr(), { day: "numeric", month: "short", year: "numeric" })}`);
      doc.text(parts.join("  ·  "), M, y + 8.6);
      y += 12.5;
      doc.setFillColor(107, 95, 191);
      doc.rect(M, y, tableW, rowH, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.2);
      doc.setTextColor(255, 255, 255);
      cols.forEach((c, i) => doc.text(c.header, textX(c, i), y + rowH - 1.7, textOpts(c)));
      y += rowH;
    };

    startPage();
    const remarksCol = cols[cols.length - 1];
    const remarksW = remarksCol.w - cellPad * 2;
    rows.forEach(({ r, rnp }, idx) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.2);
      const remarkLines = doc.splitTextToSize(String(r["Remarks"] ?? ""), remarksW);
      const h = Math.max(rowH, remarkLines.length * lineH + (rowH - lineH));
      if (y + h > pageH - M) {
        doc.addPage("a4", "portrait");
        startPage();
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.2);
      }
      if (rnp) {
        doc.setFillColor(226, 232, 240);
        doc.rect(M, y, tableW, h, "F");
      } else if (idx % 2 === 1) {
        doc.setFillColor(244, 242, 250);
        doc.rect(M, y, tableW, h, "F");
      }
      doc.setTextColor(...(rnp ? [100, 116, 139] : [45, 45, 55]));
      const baseY = y + rowH - 1.7;
      cols.forEach((c, i) => {
        if (c.key === "Remarks") {
          remarkLines.forEach((ln, li) => doc.text(ln, textX(c, i), baseY + li * lineH));
          return;
        }
        const raw = c.key ? r[c.key] : idx + 1;
        doc.text(pdfFitText(doc, raw, c.w - cellPad * 2), textX(c, i), baseY, textOpts(c));
      });
      doc.setDrawColor(225, 222, 238);
      doc.setLineWidth(0.15);
      doc.line(M, y + h, M + tableW, y + h);
      y += h;
    });

    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(150, 150, 160);
      doc.text(`Page ${p} of ${pageCount}`, doc.internal.pageSize.getWidth() - M, pageH - 4, { align: "right" });
    }

    doc.save(criticalCareFilename(data.title, "pdf"));
    toast(`${data.title} PDF exported!`);
  } catch (err) {
    console.error("[Critical Care PDF export]", err);
    toast("Export failed. Please try again.");
  }
};
