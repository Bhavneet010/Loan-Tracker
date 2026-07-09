import { db } from "./config.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { getLoanMetrics, sumAmount } from "./derived.js";
import { esc, fmtAmt, fmtDate, toast, todayStr } from "./utils.js";
import { ensureHtml2Canvas, ensureImageLoaded } from "./performance-snapshot.js";

const SME_BRANCH_CODE = "63494";
const SME_CENTRE_TYPE = "AMCC";
const SME_LOGO_SRC = "assets/sme/sbi-logo.svg";
const SME_BRANCH_LABEL = "SBI AMCC PAONTA SAHIB 63494";

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

function prevDayStr(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  date.setDate(date.getDate() - 1);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function sameMonth(a, b) {
  return a.slice(0, 7) === b.slice(0, 7);
}

// MTD disbursement carries over day to day: today's MTD = yesterday's MTD +
// today's FTD, unless the user has typed their own MTD figure for today.
let mtdBaseline = 0;
let mtdIsManual = false;

async function computeMtdBaseline(dateStr) {
  const prev = prevDayStr(dateStr);
  if (!sameMonth(prev, dateStr)) return 0; // new month: MTD restarts at zero
  try {
    const snap = await getDoc(doc(db, "smeDisbursement", prev));
    if (snap.exists()) {
      const data = snap.data();
      if (data.mtdAmt !== undefined && data.mtdAmt !== "") return parseFloat(data.mtdAmt) || 0;
    }
  } catch (err) {
    console.warn("[SME Daily] Could not load previous day disbursement:", err);
  }
  const cachedPrev = cachedDisbursement(prev);
  return parseFloat(cachedPrev?.mtdAmt) || 0;
}

function applyAutoMtd() {
  const mtdInput = document.getElementById("smeDisbMtd");
  if (!mtdInput || document.activeElement === mtdInput) return;
  const ftdRaw = document.getElementById("smeDisbFtd")?.value ?? "";
  const total = mtdBaseline + (parseFloat(ftdRaw) || 0);
  mtdInput.value = total ? String(Math.round(total * 100) / 100) : "0";
}

function buildSmeDailyReportHtml() {
  const metrics = getLoanMetrics();
  const band1to50 = collectStats(metrics, loan => inSmeBand(loan, 1, 50));
  // BRE is a manual flag set on the loan form — not every 10-50 lac sanction
  // goes through the BRE journey.
  const band10to50 = collectStats(metrics, loan => loan.category === "SME" && loan.isBre === true);
  const cached = cachedDisbursement(metrics.day) || {};
  const metricCells = (stats, groupLabel) => `
    <td class="sme-num" data-label="FTD (No)" data-group="${esc(groupLabel)}">${stats.ftdNo}</td>
    <td class="sme-num" data-label="MTD (No)">${stats.mtdNo}</td>
    <td class="sme-num" data-label="FTD (Amt.)">${esc(fmtAmt(stats.ftdAmt))}</td>
    <td class="sme-num" data-label="MTD (Amt.)">${esc(fmtAmt(stats.mtdAmt))}</td>`;

  return `<div class="sme-daily-report">
      <div class="sme-daily-header">
        <img src="${SME_LOGO_SRC}" alt="SBI" class="sme-daily-logo">
        <span class="sme-daily-branch">${esc(SME_BRANCH_LABEL)}</span>
      </div>
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
              <td class="sme-num" data-label="Br. Code">${SME_BRANCH_CODE}</td>
              <td class="sme-num" data-label="AMCC/SMEC">${SME_CENTRE_TYPE}</td>
              ${metricCells(band1to50, "Sanctioned 1-50 lacs")}
              ${metricCells(band10to50, "Sanctioned 10-50 lacs (BRE)")}
              <td class="sme-num" data-label="FTD (Amt.)" data-group="Disbursement"><input id="smeDisbFtd" class="sme-disb-input" type="text" inputmode="decimal" placeholder="0" value="${esc(cached.ftdAmt ?? "")}" oninput="onSmeDisbFtdInput()"></td>
              <td class="sme-num" data-label="MTD (Amt.)"><input id="smeDisbMtd" class="sme-disb-input" type="text" inputmode="decimal" placeholder="0" value="${esc(cached.mtdAmt ?? "")}" oninput="onSmeDisbMtdInput()"></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="sme-daily-note">
        <span>All amounts in lacs</span>
        <span id="smeDisbStatus" class="sme-disb-status"></span>
      </div>
      <div class="sme-daily-footer"></div>
    </div>`;
}

/* ── FORMAT 2: AMCC/SMEC REPORTING ── */

const AMCC_CENTRE_LABEL = "AMCC PAONTA-63494";

// Manual fields the app cannot derive from loan data. Each is persisted per
// day in Firestore (amccSmecReport/{date}) with a localStorage fallback.
const AMCC_FIELDS = [
  "breDisbFtd", "breDisbMtd",
  "eclgsSanFtdNo", "eclgsSanMtdNo", "eclgsSanFtdAmt", "eclgsSanMtdAmt",
  "eclgsDisbFtd", "eclgsDisbMtd",
  "ctrlPending", "ctrlDoneDay", "ctrlMonthProgress", "ctrlPendingDate",
];

// Cumulative (month-to-date) figures carry forward from the last saved day of
// the same month; for-the-day figures always start blank.
const AMCC_CARRYOVER_FIELDS = [
  "breDisbMtd", "eclgsSanMtdNo", "eclgsSanMtdAmt", "eclgsDisbMtd",
  "ctrlPending", "ctrlMonthProgress", "ctrlPendingDate",
];

function amccCacheKey(dateStr) {
  return `amccSmecReport:${dateStr}`;
}

function cachedAmccReport(dateStr) {
  try {
    return JSON.parse(localStorage.getItem(amccCacheKey(dateStr)) || "null");
  } catch {
    return null;
  }
}

function fmtDotDate(dateStr) {
  const [y, m, d] = String(dateStr || "").split("-");
  return y && m && d ? `${d}.${m}.${y}` : dateStr || "";
}

function prevMonthEndStr(dateStr) {
  const [y, m] = dateStr.split("-").map(Number);
  const end = new Date(y, m - 1, 0, 12, 0, 0, 0);
  end.setMinutes(end.getMinutes() - end.getTimezoneOffset());
  return end.toISOString().slice(0, 10);
}

/* Format 2 amounts are reported in ₹ Crore (loan.amount is in lacs). */
function crAmt(lacs) {
  return ((parseFloat(lacs) || 0) / 100).toFixed(2);
}

function buildAmccSmecReportHtml() {
  const metrics = getLoanMetrics();
  const bre = collectStats(metrics, loan => loan.category === "SME" && loan.isBre === true);
  const nonBre = collectStats(metrics, loan => inSmeBand(loan, 1, 50) && loan.isBre !== true);
  const saved = cachedAmccReport(metrics.day) || {};
  const inputCell = key => `<td class="sme-num"><input id="amcc_${key}" class="sme-disb-input amcc-input" type="text" inputmode="decimal" placeholder="0" value="${esc(saved[key] ?? "")}" oninput="onAmccFieldInput()"></td>`;

  return `<div class="amcc-smec-report">
      <div class="sme-daily-header">
        <img src="${SME_LOGO_SRC}" alt="SBI" class="sme-daily-logo">
        <span class="sme-daily-branch">${esc(SME_BRANCH_LABEL)}</span>
      </div>
      <div class="amcc-title">AMCC/SMEC REPORTING FORMAT&nbsp;&nbsp;&mdash;&nbsp;&nbsp;DATE: ${esc(fmtDotDate(metrics.day))}</div>
      <div class="amcc-scroll">
        <table class="sme-daily-table amcc-table">
          <tr>
            <th rowspan="7" class="amcc-head-name">
              <span class="amcc-name-label">AMCC/SMEC<br>(NAME &amp; CODE)</span>
              <span class="amcc-name-value">${esc(AMCC_CENTRE_LABEL)}</span>
            </th>
            <th colspan="4" class="amcc-head-bre">Sanctioned 10-50 lacs (BRE)</th>
            <th colspan="2" class="amcc-head-bre">BRE Disbursement</th>
            <th colspan="4" class="amcc-head-nonbre">Sanctioned 1-50 lacs (NON-BRE)</th>
          </tr>
          <tr>
            <th class="amcc-head-bre">FTD (No)</th>
            <th class="amcc-head-bre">MTD (No)</th>
            <th class="amcc-head-bre">FTD (Amt.)</th>
            <th class="amcc-head-bre">MTD (Amt.)</th>
            <th class="amcc-head-bre">FTD (No.)</th>
            <th class="amcc-head-bre">MTD (No.)</th>
            <th class="amcc-head-nonbre">FTD (No)</th>
            <th class="amcc-head-nonbre">MTD (No)</th>
            <th class="amcc-head-nonbre">FTD (Amt.)</th>
            <th class="amcc-head-nonbre">MTD (Amt.) IN CR</th>
          </tr>
          <tr>
            <td class="sme-num">${bre.ftdNo}</td>
            <td class="sme-num">${bre.mtdNo}</td>
            <td class="sme-num">${esc(crAmt(bre.ftdAmt))}</td>
            <td class="sme-num">${esc(crAmt(bre.mtdAmt))}</td>
            ${inputCell("breDisbFtd")}
            ${inputCell("breDisbMtd")}
            <td class="sme-num">${nonBre.ftdNo}</td>
            <td class="sme-num">${nonBre.mtdNo}</td>
            <td class="sme-num">${esc(crAmt(nonBre.ftdAmt))}</td>
            <td class="sme-num">${esc(crAmt(nonBre.mtdAmt))}</td>
          </tr>
          <tr>
            <th colspan="6" class="amcc-head-eclgs">ECLGS 5.0</th>
            <th colspan="4" class="amcc-head-controls">CONTROLS</th>
          </tr>
          <tr>
            <th colspan="4" class="amcc-head-eclgs">SANCTION</th>
            <th colspan="2" class="amcc-head-eclgs">DISBURSEMENT</th>
            <th rowspan="2" class="amcc-head-controls">PENDING AS ON ${esc(fmtDotDate(prevMonthEndStr(metrics.day)))}</th>
            <th rowspan="2" class="amcc-head-controls">CONTROLS DONE DURING THE DAY</th>
            <th rowspan="2" class="amcc-head-controls">PROGRESS DURING THE MONTH</th>
            <th rowspan="2" class="amcc-head-controls">PENDING CONTROLS AS ON DATE</th>
          </tr>
          <tr>
            <th class="amcc-head-eclgs">FTD (No)</th>
            <th class="amcc-head-eclgs">MTD (No)</th>
            <th class="amcc-head-eclgs">FTD (Amt.)</th>
            <th class="amcc-head-eclgs">MTD (Amt.)</th>
            <th class="amcc-head-eclgs">FTD (Amt.) IN CR</th>
            <th class="amcc-head-eclgs">MTD (Amt.) IN CR</th>
          </tr>
          <tr>
            ${inputCell("eclgsSanFtdNo")}
            ${inputCell("eclgsSanMtdNo")}
            ${inputCell("eclgsSanFtdAmt")}
            ${inputCell("eclgsSanMtdAmt")}
            ${inputCell("eclgsDisbFtd")}
            ${inputCell("eclgsDisbMtd")}
            ${inputCell("ctrlPending")}
            ${inputCell("ctrlDoneDay")}
            ${inputCell("ctrlMonthProgress")}
            ${inputCell("ctrlPendingDate")}
          </tr>
        </table>
      </div>
      <div class="sme-daily-note">
        <span>All amounts in &#8377; Crore</span>
        <span id="amccStatus" class="sme-disb-status"></span>
      </div>
      <div class="sme-daily-footer"></div>
    </div>`;
}

export function renderSmeDailyReportView(target) {
  if (!target) return;
  target.innerHTML = `<div class="sme-daily-wrap">
    <div class="sme-format-label">Format 1 &middot; SME Daily Reporting</div>
    ${buildSmeDailyReportHtml()}
    <div class="sme-format-label">Format 2 &middot; AMCC/SMEC Reporting</div>
    ${buildAmccSmecReportHtml()}
  </div>`;
  hydrateDisbursement(todayStr());
  hydrateAmccReport(todayStr());
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
  const cached = cachedDisbursement(dateStr);
  mtdIsManual = !!cached?.mtdManual;
  mtdBaseline = await computeMtdBaseline(dateStr);
  if (!mtdIsManual) applyAutoMtd();

  try {
    const snap = await getDoc(doc(db, "smeDisbursement", dateStr));
    if (!snap.exists()) return;
    const data = snap.data();
    mtdIsManual = !!data.mtdManual;
    setDisbInputValue("smeDisbFtd", data.ftdAmt);
    if (mtdIsManual) {
      setDisbInputValue("smeDisbMtd", data.mtdAmt);
    } else {
      applyAutoMtd();
    }
    try {
      localStorage.setItem(disbCacheKey(dateStr), JSON.stringify({ ftdAmt: data.ftdAmt ?? "", mtdAmt: data.mtdAmt ?? "", mtdManual: mtdIsManual }));
    } catch {}
  } catch (err) {
    console.warn("[SME Daily] Could not load disbursement:", err);
  }
}

let disbSaveTimer = null;

window.onSmeDisbFtdInput = function () {
  if (!mtdIsManual) applyAutoMtd();
  setDisbStatus("Saving…");
  clearTimeout(disbSaveTimer);
  disbSaveTimer = setTimeout(saveSmeDisbursement, 800);
};

window.onSmeDisbMtdInput = function () {
  mtdIsManual = true;
  setDisbStatus("Saving…");
  clearTimeout(disbSaveTimer);
  disbSaveTimer = setTimeout(saveSmeDisbursement, 800);
};

async function saveSmeDisbursement() {
  const dateStr = todayStr();
  const ftdRaw = document.getElementById("smeDisbFtd")?.value.trim() ?? "";
  const mtdRaw = document.getElementById("smeDisbMtd")?.value.trim() ?? "";
  const payload = { ftdAmt: ftdRaw, mtdAmt: mtdRaw, mtdManual: mtdIsManual };
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
    await ensureImageLoaded(SME_LOGO_SRC).catch(() => {});
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

/* ── FORMAT 2: persistence ── */

function setAmccStatus(text) {
  const el = document.getElementById("amccStatus");
  if (el) el.textContent = text;
}

function setAmccInputValue(key, value, { onlyIfEmpty = false } = {}) {
  const input = document.getElementById(`amcc_${key}`);
  if (!input || document.activeElement === input) return;
  if (onlyIfEmpty && input.value.trim() !== "") return;
  input.value = value == null ? "" : String(value);
}

async function hydrateAmccReport(dateStr) {
  try {
    const snap = await getDoc(doc(db, "amccSmecReport", dateStr));
    if (snap.exists()) {
      const data = snap.data();
      AMCC_FIELDS.forEach(key => setAmccInputValue(key, data[key]));
      try {
        const payload = {};
        AMCC_FIELDS.forEach(key => { payload[key] = data[key] ?? ""; });
        localStorage.setItem(amccCacheKey(dateStr), JSON.stringify(payload));
      } catch {}
      return;
    }
  } catch (err) {
    console.warn("[AMCC/SMEC] Could not load report:", err);
  }

  // Nothing saved for today: carry month-to-date figures forward from the
  // most recent saved day in the same month (looking back up to 6 days).
  if (cachedAmccReport(dateStr)) return;
  let prev = prevDayStr(dateStr);
  for (let hops = 0; hops < 6 && sameMonth(prev, dateStr); hops++, prev = prevDayStr(prev)) {
    let data = null;
    try {
      const snap = await getDoc(doc(db, "amccSmecReport", prev));
      if (snap.exists()) data = snap.data();
    } catch {}
    if (!data) data = cachedAmccReport(prev);
    if (data) {
      AMCC_CARRYOVER_FIELDS.forEach(key => setAmccInputValue(key, data[key], { onlyIfEmpty: true }));
      return;
    }
  }
}

let amccSaveTimer = null;

window.onAmccFieldInput = function () {
  setAmccStatus("Saving…");
  clearTimeout(amccSaveTimer);
  amccSaveTimer = setTimeout(saveAmccReport, 800);
};

async function saveAmccReport() {
  const dateStr = todayStr();
  const payload = {};
  AMCC_FIELDS.forEach(key => {
    payload[key] = document.getElementById(`amcc_${key}`)?.value.trim() ?? "";
  });
  try {
    localStorage.setItem(amccCacheKey(dateStr), JSON.stringify(payload));
  } catch {}
  try {
    await setDoc(doc(db, "amccSmecReport", dateStr), { ...payload, updatedAt: new Date().toISOString() }, { merge: true });
    setAmccStatus("Saved ✓");
  } catch (err) {
    console.warn("[AMCC/SMEC] Could not save report:", err);
    setAmccStatus("Saved on this device only");
  }
}

/* ── FORMAT 2: JPEG export ── */

window.shareAmccSmecReportJpeg = async function () {
  // Works from the share menu even when the SME view is not open: build the
  // report from current data (manual fields come from the local cache).
  let report = document.querySelector(".amcc-smec-report");
  if (!report) {
    const holder = document.createElement("div");
    holder.innerHTML = buildAmccSmecReportHtml();
    report = holder.querySelector(".amcc-smec-report");
  }
  if (!report) {
    toast("AMCC/SMEC report is not ready yet");
    return;
  }

  try {
    await ensureHtml2Canvas();
    await ensureImageLoaded(SME_LOGO_SRC).catch(() => {});
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
    exportCard.classList.add("sme-daily-export", "amcc-export");
    exportHost.style.position = "fixed";
    exportHost.style.left = "-10000px";
    exportHost.style.top = "0";
    exportHost.style.pointerEvents = "none";
    // Size to the tables' natural (unwrapped) width instead of a fixed box,
    // so the wide tables never get clipped by the scroll wrappers.
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

    const fileName = `amcc-smec-reporting-${todayStr()}.jpg`;
    const file = new File([blob], fileName, { type: "image/jpeg" });

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: "AMCC/SMEC Reporting",
        text: `AMCC/SMEC Reporting ${fmtDate(todayStr())}`,
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
    toast("AMCC/SMEC report JPEG downloaded");
  } catch (err) {
    console.warn("[AMCC/SMEC] Share failed:", err);
    toast("Unable to share AMCC/SMEC report right now");
  }
};
