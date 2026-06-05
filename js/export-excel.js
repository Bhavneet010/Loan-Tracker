import { S } from "./state.js";
import { effectiveOfficer } from "./derived.js";
import { isFreshCC, toast } from "./utils.js";

const XLSX_CDN = "https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js";

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

function baseRow(loan) {
  return {
    "Customer Name": loan.customerName || "",
    "Amount (₹ Lakhs)": parseFloat(loan.amount) || 0,
    "Category": loan.category || "",
    "Officer": effectiveOfficer(loan),
    "Branch": loan.branch || "",
    "Receive Date": fmt(loan.receiveDate),
    "Sanction Date": fmt(loan.sanctionDate),
    "Remarks": loan.remarks || "",
  };
}

function pendingRows(loans) {
  return loans
    .filter(l => isFreshCC(l) && l.status === "pending")
    .sort((a, b) => {
      const cd = (CAT_ORDER[a.category] ?? 99) - (CAT_ORDER[b.category] ?? 99);
      return cd !== 0 ? cd : (a.receiveDate || "").localeCompare(b.receiveDate || "");
    })
    .map(baseRow);
}

function sanctionedRows(loans) {
  return loans
    .filter(l => isFreshCC(l) && l.status === "sanctioned")
    .sort((a, b) => (b.sanctionDate || "").localeCompare(a.sanctionDate || ""))
    .map(baseRow);
}

function returnedRows(loans) {
  return loans
    .filter(l => isFreshCC(l) && l.status === "returned")
    .sort((a, b) => (b.returnedDate || "").localeCompare(a.returnedDate || ""))
    .map(l => ({ ...baseRow(l), "Returned Date": fmt(l.returnedDate) }));
}

function renewalsDoneRows(loans) {
  return loans
    .filter(l => l.category === "SME" && !l.isTermLoan && l.renewedDate)
    .sort((a, b) => (b.renewedDate || "").localeCompare(a.renewedDate || ""))
    .map(l => ({
      "Customer Name": l.customerName || "",
      "Amount (₹ Lakhs)": parseFloat(l.amount) || 0,
      "Officer": effectiveOfficer(l),
      "Branch": l.branch || "",
      "Sanction Date": fmt(l.sanctionDate),
      "Renewed Date": fmt(l.renewedDate),
      "Renewal Due Date": fmt(l.renewalDueDate),
      "Limit Expiry Date": fmt(l.limitExpiryDate),
      "Remarks": l.remarks || "",
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
      makeSheet(pendingRows(loans), ["Customer Name", "Amount (₹ Lakhs)", "Category", "Officer", "Branch", "Receive Date", "Sanction Date", "Remarks"]),
      "Pending Loans"
    );
    XLSX.utils.book_append_sheet(
      wb,
      makeSheet(sanctionedRows(loans), ["Customer Name", "Amount (₹ Lakhs)", "Category", "Officer", "Branch", "Receive Date", "Sanction Date", "Remarks"]),
      "Sanctioned Loans"
    );
    XLSX.utils.book_append_sheet(
      wb,
      makeSheet(returnedRows(loans), ["Customer Name", "Amount (₹ Lakhs)", "Category", "Officer", "Branch", "Receive Date", "Sanction Date", "Returned Date", "Remarks"]),
      "Returned Loans"
    );
    XLSX.utils.book_append_sheet(
      wb,
      makeSheet(renewalsDoneRows(loans), ["Customer Name", "Amount (₹ Lakhs)", "Officer", "Branch", "Sanction Date", "Renewed Date", "Renewal Due Date", "Limit Expiry Date", "Remarks"]),
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
