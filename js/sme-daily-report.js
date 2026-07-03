import { db } from "./config.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { getLoanMetrics, sumAmount } from "./derived.js";
import { esc, fmtAmt, fmtDate, toast, todayStr } from "./utils.js";
import { ensureHtml2Canvas } from "./performance-snapshot.js";

const SME_BRANCH_CODE = "63494";
const SME_CENTRE_TYPE = "AMCC";

/* Band limits are in lacs, matching loan.amount units. */
function inSmeBand(loan, min, max) {
  if (loan.category !== "SME") return false;
  const amt = parseFloat(loan.amount) || 0;
  return amt >= min && amt <= max;
}

function collectStats(metrics, predicate) {
  const ftdLoans = metrics.sanctionedToday.filter(predicate);
  const mtdLoans = metrics.sanctionedThisMonth.filter(predicate);
  return {
    ftdNo: ftdLoans.length,
    mtdNo: mtdLoans.length,
    ftdAmt: sumAmount(ftdLoans),
    mtdAmt: sumAmount(mtdLoans),
  };
}

function disbCacheKey(dateStr) {
  return `smeDisbursement:${dateStr}`;
}

function cachedDisbursement(dateStr) {
  try {
    return JSON.parse(localStorage.getItem(disbCacheKey(dateStr)) || "null");
  } catch {
    return null;
  }
}

function buildSmeDailyReportHtml() {
  const metrics = getLoanMetrics();
  const band1to50 = collectStats(metrics, loan => inSmeBand(loan, 1, 50));
  // BRE is a manual flag set on the loan form — not every 10-50 lac sanction
  // goes through the BRE journey.
  const band10to50 = collectStats(metrics, loan => loan.category === "SME" && loan.isBre === true);
  const cached = cachedDisbursement(metrics.day) || {};
  const metricCells = stats => `
    <td class="sme-num">${stats.ftdNo}</td>
    <td class="sme-num">${stats.mtdNo}</td>
    <td class="sme-num">${esc(fmtAmt(stats.ftdAmt))}</td>
    <td class="sme-num">${esc(fmtAmt(stats.mtdAmt))}</td>`;

  return `<div class="sme-daily-wrap">
    <div class="sme-daily-report">
      <div class="sme-daily-title">SME DAILY REPORTING DATED&nbsp;-&nbsp;${esc(fmtDate(metrics.day))}</div>
      <div class="sme-daily-scroll">
        <table class="sme-daily-table">
          <thead>
            <tr>
              <th rowspan="2" class="sme-head-green">Br. Code</th>
              <th rowspan="2" class="sme-head-green">AMCC/SMEC</th>
              <th colspan="4" class="sme-head-green">Sanctioned 1-50 lacs</th>
              <th colspan="4" class="sme-head-green">Sanctioned 10-50 lacs (BRE)</th>
              <th colspan="2" class="sme-head-green">Disbursement</th>
            </tr>
            <tr>
              <th class="sme-head-ftd">FTD (No)</th>
              <th class="sme-head-mtd">MTD (No)</th>
              <th class="sme-head-ftd">FTD (Amt.)</th>
              <th class="sme-head-mtd">MTD (Amt.)</th>
              <th class="sme-head-ftd">FTD (No)</th>
              <th class="sme-head-mtd">MTD (No)</th>
              <th class="sme-head-ftd">FTD (Amt.)</th>
              <th class="sme-head-mtd">MTD (Amt.)</th>
              <th class="sme-head-ftd">FTD (Amt.)</th>
              <th class="sme-head-mtd">MTD (Amt.)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="sme-num">${SME_BRANCH_CODE}</td>
              <td class="sme-num">${SME_CENTRE_TYPE}</td>
              ${metricCells(band1to50)}
              ${metricCells(band10to50)}
              <td class="sme-num"><input id="smeDisbFtd" class="sme-disb-input" type="text" inputmode="decimal" placeholder="0" value="${esc(cached.ftdAmt ?? "")}" oninput="onSmeDisbursementInput()"></td>
              <td class="sme-num"><input id="smeDisbMtd" class="sme-disb-input" type="text" inputmode="decimal" placeholder="0" value="${esc(cached.mtdAmt ?? "")}" oninput="onSmeDisbursementInput()"></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="sme-daily-note">
        <span>All amounts in lacs</span>
        <span id="smeDisbStatus" class="sme-disb-status"></span>
      </div>
    </div>
  </div>`;
}

export function renderSmeDailyReportView(target) {
  if (!target) return;
  target.innerHTML = buildSmeDailyReportHtml();
  hydrateDisbursement(todayStr());
}

function setDisbStatus(text) {
  const el = document.getElementById("smeDisbStatus");
  if (el) el.textContent = text;
}

function setDisbInputValue(id, value) {
  const input = document.getElementById(id);
  if (!input || document.activeElement === input) return;
  input.value = value == null ? "" : String(value);
}

async function hydrateDisbursement(dateStr) {
  try {
    const snap = await getDoc(doc(db, "smeDisbursement", dateStr));
    if (!snap.exists()) return;
    const data = snap.data();
    setDisbInputValue("smeDisbFtd", data.ftdAmt);
    setDisbInputValue("smeDisbMtd", data.mtdAmt);
    try {
      localStorage.setItem(disbCacheKey(dateStr), JSON.stringify({ ftdAmt: data.ftdAmt ?? "", mtdAmt: data.mtdAmt ?? "" }));
    } catch {}
  } catch (err) {
    console.warn("[SME Daily] Could not load disbursement:", err);
  }
}

let disbSaveTimer = null;

window.onSmeDisbursementInput = function () {
  setDisbStatus("Saving…");
  clearTimeout(disbSaveTimer);
  disbSaveTimer = setTimeout(saveSmeDisbursement, 800);
};

async function saveSmeDisbursement() {
  const dateStr = todayStr();
  const ftdRaw = document.getElementById("smeDisbFtd")?.value.trim() ?? "";
  const mtdRaw = document.getElementById("smeDisbMtd")?.value.trim() ?? "";
  const payload = { ftdAmt: ftdRaw, mtdAmt: mtdRaw };
  try {
    localStorage.setItem(disbCacheKey(dateStr), JSON.stringify(payload));
  } catch {}
  try {
    await setDoc(doc(db, "smeDisbursement", dateStr), { ...payload, updatedAt: new Date().toISOString() }, { merge: true });
    setDisbStatus("Saved ✓");
  } catch (err) {
    console.warn("[SME Daily] Could not save disbursement:", err);
    setDisbStatus("Saved on this device only");
  }
}

window.shareSmeDailyReportJpeg = async function () {
  // Works from the share menu even when the SME view is not open: build the
  // report from current data (disbursement comes from the local cache).
  let report = document.querySelector(".sme-daily-report");
  if (!report) {
    const holder = document.createElement("div");
    holder.innerHTML = buildSmeDailyReportHtml();
    report = holder.querySelector(".sme-daily-report");
  }
  if (!report) {
    toast("SME report is not ready yet");
    return;
  }

  try {
    await ensureHtml2Canvas();
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const exportHost = document.createElement("div");
    const exportCard = report.cloneNode(true);
    // Inputs render unreliably in html2canvas clones, so bake values into spans.
    exportCard.querySelectorAll("input.sme-disb-input").forEach(input => {
      const live = document.getElementById(input.id);
      const span = document.createElement("span");
      span.className = "sme-disb-print";
      span.textContent = (live?.value ?? input.value ?? "").trim() || "-";
      input.replaceWith(span);
    });
    exportCard.querySelector(".sme-disb-status")?.remove();
    exportCard.classList.add("sme-daily-export");
    exportHost.style.position = "fixed";
    exportHost.style.left = "-10000px";
    exportHost.style.top = "0";
    exportHost.style.pointerEvents = "none";
    // Size to the table's natural (unwrapped) width instead of a fixed box,
    // so the wide 12-column table never gets clipped by the scroll wrapper.
    exportCard.style.display = "inline-block";
    exportCard.style.width = "max-content";
    exportCard.style.maxWidth = "none";
    exportHost.appendChild(exportCard);
    document.body.appendChild(exportHost);

    const exportWidth = Math.ceil(exportCard.getBoundingClientRect().width);

    let canvas;
    try {
      canvas = await window.html2canvas(exportCard, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        width: exportWidth,
        windowWidth: exportWidth,
      });
    } finally {
      exportHost.remove();
    }

    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.98));
    if (!blob) throw new Error("JPEG export failed");

    const fileName = `sme-daily-reporting-${todayStr()}.jpg`;
    const file = new File([blob], fileName, { type: "image/jpeg" });

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: "SME Daily Reporting",
        text: `SME Daily Reporting ${fmtDate(todayStr())}`,
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
    toast("SME report JPEG downloaded");
  } catch (err) {
    console.warn("[SME Daily] Share failed:", err);
    toast("Unable to share SME report right now");
  }
};
