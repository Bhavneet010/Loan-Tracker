import { S } from "./state.js";
import { effectiveOfficer, getLoanMetrics } from "./derived.js";
import { isFreshCC, toast, branchCode } from "./utils.js";
import { getCalendarMonthExport } from "./ui-calendar.js";
import { ensureJsPdf } from "./performance-snapshot.js";

// xlsx-js-style is API-compatible with SheetJS but can also write cell styles
// (used to grey out "renewal not possible" rows in the calendar export).
const XLSX_CDN = "https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.full.min.js";

let xlsxLoadPromise = null;
function ensureXlsx() {
  if (window.XLSX) return Promise.resolve();
  if (xlsxLoadPromise) return xlsxLoadPromise;
  xlsxLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = XLSX_CDN;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load SheetJS"));
    document.head.appendChild(s);
  });
  return xlsxLoadPromise;
}

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

function renewalsDoneRows() {
  return getLoanMetrics().renewalDoneThisMonth
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

    const today = new Date();
    today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    XLSX.writeFile(wb, `nirnay-loans-${today.toISOString().slice(0, 10)}.xlsx`);
    toast("Excel exported!");
  } catch (err) {
    console.error("[Excel export]", err);
    toast("Export failed. Please try again.");
  }
};

window.toggleCalExportMenu = function (e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById("calExportMenu");
  if (!menu) return;
  const isOpen = menu.classList.contains("open");
  if (isOpen) {
    menu.classList.remove("open");
  } else {
    menu.classList.add("open");
    setTimeout(() => document.addEventListener("click", window.closeCalExportMenu, { once: true }), 0);
  }
};

window.closeCalExportMenu = function () {
  const menu = document.getElementById("calExportMenu");
  if (menu) menu.classList.remove("open");
};

function renewalDueRow(l) {
  const rs = l._rs;
  return {
    "Officer": up(effectiveOfficer(l)),
    "Customer Name": up(l.customerName),
    "Branch": up(branchCode(l.branch)),
    "Limit (₹ Lakhs)": parseFloat(l.amount) || 0,
    "Renewal Due Date": fmt(rs.dueDateStr),
    "NPA Date": fmt(rs.npaDateStr),
    "Remarks": up(l.renewalNotPossible ? (l.renewalNotPossibleRemarks || l.remarks) : l.remarks),
  };
}

const RENEWAL_DUE_HEADERS = ["Officer", "Customer Name", "Branch", "Limit (₹ Lakhs)", "Renewal Due Date", "NPA Date", "Remarks"];

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

// jsPDF's built-in fonts can't render ₹, so amounts use "Rs".
// Widths sum to 194mm = portrait A4 (210) minus 8mm margins.
const PDF_COLS = [
  { header: "#", w: 7 },
  { header: "Officer", w: 24, key: "Officer" },
  { header: "Customer Name", w: 48, key: "Customer Name" },
  { header: "Branch", w: 14, key: "Branch" },
  { header: "Limit (Rs L)", w: 16, key: "Limit (₹ Lakhs)", align: "right" },
  { header: "Renewal Due", w: 20, key: "Renewal Due Date" },
  { header: "NPA Date", w: 20, key: "NPA Date" },
  { header: "Remarks", w: 45, key: "Remarks" },
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
      parts.push(`generated ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`);
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
