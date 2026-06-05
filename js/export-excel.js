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

function pendingRows(loans) {
  return loans
    .filter(l => isFreshCC(l) && l.status === "pending")
    .sort((a, b) => {
      const cd = (CAT_ORDER[a.category] ?? 99) - (CAT_ORDER[b.category] ?? 99);
      return cd !== 0 ? cd : (a.receiveDate || "").localeCompare(b.receiveDate || "");
    })
    .map(l => ({
      "Category": l.category || "",
      "Officer": effectiveOfficer(l),
      "Branch": l.branch || "",
      "Customer Name": l.customerName || "",
      "Amount (₹ Lakhs)": parseFloat(l.amount) || 0,
      "Receive Date": fmt(l.receiveDate),
      "Remarks": l.remarks || "",
    }));
}

function sanctionedRows(loans) {
  return loans
    .filter(l => isFreshCC(l) && l.status === "sanctioned")
    .sort((a, b) => (b.sanctionDate || "").localeCompare(a.sanctionDate || ""))
    .map(l => ({
      "Officer": effectiveOfficer(l),
      "Branch": l.branch || "",
      "Customer Name": l.customerName || "",
      "Amount (₹ Lakhs)": parseFloat(l.amount) || 0,
      "Category": l.category || "",
      "Receive Date": fmt(l.receiveDate),
      "Sanction Date": fmt(l.sanctionDate),
      "Remarks": l.remarks || "",
    }));
}

function returnedRows(loans) {
  return loans
    .filter(l => isFreshCC(l) && l.status === "returned")
    .sort((a, b) => (b.returnedDate || "").localeCompare(a.returnedDate || ""))
    .map(l => ({
      "Officer": effectiveOfficer(l),
      "Branch": l.branch || "",
      "Customer Name": l.customerName || "",
      "Amount (₹ Lakhs)": parseFloat(l.amount) || 0,
      "Category": l.category || "",
      "Receive Date": fmt(l.receiveDate),
      "Returned Date": fmt(l.returnedDate),
      "Remarks": l.remarks || "",
    }));
}

function renewalsDoneRows(loans) {
  return loans
    .filter(l => l.category === "SME" && !l.isTermLoan && l.renewedDate)
    .sort((a, b) => (b.renewedDate || "").localeCompare(a.renewedDate || ""))
    .map(l => ({
      "Officer": effectiveOfficer(l),
      "Branch": l.branch || "",
      "": "",
      "Customer Name": l.customerName || "",
      "Limit (₹ Lakhs)": parseFloat(l.amount) || 0,
      "Limit Expiry Date": fmt(l.limitExpiryDate),
      "Renewal Due Date": fmt(l.renewalDueDate),
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
      makeSheet(renewalsDoneRows(loans), ["Officer", "Branch", "", "Customer Name", "Limit (₹ Lakhs)", "Limit Expiry Date", "Renewal Due Date"]),
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
