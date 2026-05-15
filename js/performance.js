import { db } from "./config.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { S, saveSettings } from "./state.js";
import { getLoanMetrics, sumAmount } from "./derived.js";
import { catCls, esc, fmtAmt, fmtDate, shortCat, toast } from "./utils.js";
import { monthDays, trendBuckets, groupAmountByBucket, buildOfficerTotals, buildTrendDatasets, buildLeaderboardRows, summaryRows, reportCell, metricBox, trendTable, performerTable, summaryTable, loanOfficer, loansForOfficer, totalMetric, metricHtml, statusRank, renewalUrgencyValue, sortRenewalRisk, riskWatchForOfficer, detailOfficerNames, officerPdfData, freshLoanLine, renewalLoanLine, riskStatusText, compactBranch, pdfSection, coverOfficerRow, CATS, TREND_COLORS, amountOf, PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT, html2canvasLoadPromise, jsPdfLoadPromise } from "./performance-utils.js";
import { buildDetailedSnapshotPdfHtml, miniFreshRow, miniRiskRow, miniRenewalDoneRow, buildOfficerPdfSections, paginateOfficerPdfSections, compactPdfSection, compactPdfSectionV2, buildOfficerPdfPages, buildCompactOfficerPdfPage, buildCompactOfficerPdfPageV2, buildOfficerPdfPage, detailedSnapshotPdfCss } from "./performance-pdf.js";
import { ensureHtml2Canvas, ensureJsPdf, ensureImageLoaded, officerNamesFromMetrics, emptyCatTotals, buildOfficerCategoryRows, buildOfficerRenewalRows, buildCategoryTotal, buildRenewalTotal, dualMetricCell, renderCategorySection, renderRenewalSection, buildReportMockupData, ordinal, renderLeaderChartCard, renderEditorialCategoryPills, renderEditorialOfficerCard, buildEditorialShareMockupHtml, renderMockupHeader, buildReportMockupHtml, buildDailySnapshotPageHtml, renderDailyPerformanceView, renderWeeklyPerformanceView, renderMonthlyPerformanceView, renderPerformanceView, DAILY_SNAPSHOT, SNAPSHOT_BG_ASSETS } from "./performance-snapshot.js";
import { AVAILABILITY_TYPES, availabilityLabel, normalizeAvailability, officerAvailabilityForDate } from "./officer-availability.js";

const PERFORMANCE_PERIODS = {
  daily: {
    label: "Daily",
    title: "Daily Snapshot",
    render: renderDailyPerformanceView,
    actions: '<button class="perf-export-btn perf-export-btn-secondary" type="button" onclick="exportPerformanceSnapshot()">Detailed Snapshot</button><button class="perf-export-btn" type="button" onclick="shareDailySnapshotJpeg()">Share</button>',
  },
  weekly: {
    label: "Weekly",
    title: "Weekly Performance",
    render: renderWeeklyPerformanceView,
    actions: '<button class="perf-export-btn" type="button" onclick="shareWeeklyPerformanceJpeg()">Share</button>',
  },
  monthly: {
    label: "Monthly",
    title: "Monthly Performance",
    render: renderMonthlyPerformanceView,
    actions: '<button class="perf-export-btn perf-export-btn-secondary" type="button" onclick="exportPerformanceSnapshot()">Detailed Snapshot</button>',
  },
};

let activePerformancePeriod = "daily";

window.exportPerformanceSnapshot = async function () {
  let exportHost;
  try {
    toast("Preparing detailed PDF...");
    await ensureHtml2Canvas();
    await ensureJsPdf();
    if (document.fonts && document.fonts.ready) await document.fonts.ready;

    exportHost = document.createElement("div");
    exportHost.className = "pdf-export-host";
    exportHost.style.position = "fixed";
    exportHost.style.left = "-10000px";
    exportHost.style.top = "0";
    exportHost.style.width = `${PDF_PAGE_WIDTH}px`;
    exportHost.style.background = "#EDE8F4";
    exportHost.style.pointerEvents = "none";
    exportHost.innerHTML = buildDetailedSnapshotPdfHtml();
    document.body.appendChild(exportHost);

    const pages = Array.from(exportHost.querySelectorAll(".pdf-page"));
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
    const fileName = `detailed-snapshot-${todayFileName()}.pdf`;
    const file = new File([blob], fileName, { type: "application/pdf" });

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await logSnapshot();
      await navigator.share({
        files: [file],
        title: "Detailed Snapshot",
        text: `Detailed Performance Snapshot ${formatShareDate(new Date())}`,
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
    toast("Detailed PDF downloaded");
  } catch (err) {
    console.warn("[Performance] Detailed PDF export failed:", err);
    toast("Unable to create detailed PDF right now");
  } finally {
    if (exportHost) exportHost.remove();
  }
};

window.showPerformanceSnapshot = function (period = "daily") {
  const currentPeriod = PERFORMANCE_PERIODS[period] ? period : "daily";
  activePerformancePeriod = currentPeriod;
  const current = PERFORMANCE_PERIODS[currentPeriod];
  const backBtn = document.querySelector("#perfOverlay .back-btn");
  const overlayHeader = document.querySelector("#perfOverlay .perf-overlay-header");
  const overlayTitle = document.querySelector("#perfOverlay .perf-overlay-title");
  const overlayActions = document.querySelector("#perfOverlay .perf-overlay-actions");
  if (overlayHeader) overlayHeader.classList.add("snapshot-mode");
  if (backBtn) backBtn.setAttribute("onclick", "closePerfOverlay()");
  if (overlayTitle) overlayTitle.textContent = current.title;
  renderPerformancePeriodToggle(currentPeriod);
  if (overlayActions) {
    overlayActions.style.display = current.actions ? "" : "none";
    overlayActions.innerHTML = current.actions;
  }
  const content = document.getElementById("perfOverlayContent");
  if (content) {
    content.style.padding = "0";
    content.classList.toggle("weekly-performance-content", currentPeriod === "weekly");
    current.render(content);
  }
};

window.showDailySnapshot = function () {
  window.showPerformanceSnapshot("daily");
};

window.refreshWeeklyPerformanceIfVisible = function () {
  const overlay = document.getElementById("perfOverlay");
  if (!overlay || getComputedStyle(overlay).display === "none") return;
  if (activePerformancePeriod === "weekly") window.showPerformanceSnapshot("weekly");
};

window.shareDailySnapshotJpeg = async function () {
  const card = document.querySelector(".editorial-phone-report");
  if (!card) {
    toast("Snapshot is not ready yet");
    return;
  }

  try {
    await ensureHtml2Canvas();
    await Promise.all(SNAPSHOT_BG_ASSETS.map(ensureImageLoaded));
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const exportWidth = 680;
    const hdScale = 4;
    const exportHost = document.createElement("div");
    const exportCard = card.cloneNode(true);
    exportHost.style.position = "fixed";
    exportHost.style.left = "-10000px";
    exportHost.style.top = "0";
    exportHost.style.width = `${exportWidth}px`;
    exportHost.style.pointerEvents = "none";
    exportCard.classList.add("snapshot-export");
    exportCard.style.width = `${exportWidth}px`;
    exportCard.style.maxWidth = "none";
    exportHost.appendChild(exportCard);
    document.body.appendChild(exportHost);

    let canvas;
    try {
      canvas = await window.html2canvas(exportCard, {
        backgroundColor: "#f1eff8",
        scale: hdScale,
        useCORS: true,
        width: exportWidth,
        windowWidth: exportWidth,
      });
    } finally {
      exportHost.remove();
    }

    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.99));
    if (!blob) throw new Error("JPEG export failed");

    const fileName = `daily-snapshot-hd-${todayFileName()}.jpg`;
    const file = new File([blob], fileName, { type: "image/jpeg" });

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: "Daily Snapshot",
        text: `Daily Performance Update ${formatShareDate(new Date())}`,
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
    toast("HD JPEG downloaded");
  } catch (err) {
    console.warn("[Performance] Snapshot share failed:", err);
    toast("Unable to share snapshot right now");
  }
};

window.shareWeeklyPerformanceJpeg = async function () {
  const report = document.querySelector(".weekly-performance-report");
  if (!report) {
    toast("Weekly dashboard is not ready yet");
    return;
  }

  try {
    await ensureHtml2Canvas();
    await Promise.all(SNAPSHOT_BG_ASSETS.map(ensureImageLoaded));
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const exportWidth = 794;
    const hdScale = 3;
    toast("Preparing export…");

    // Build off-screen export element
    const exportHost = document.createElement("div");
    const exportReport = report.cloneNode(true);
    exportHost.style.cssText = `position:absolute;left:-10000px;top:0;width:${exportWidth}px;pointer-events:none;overflow:visible;`;
    exportReport.classList.add("weekly-export");
    exportReport.style.cssText = `width:${exportWidth}px;max-width:none;overflow:visible;min-height:0;`;
    // Force 2-column grid inline to override media-query-driven 1-column layout on phone viewport
    const exportGrid = exportReport.querySelector(".weekly-comp-charts");
    if (exportGrid) {
      exportGrid.style.display = "grid";
      exportGrid.style.gridTemplateColumns = "1fr 1fr";
      exportGrid.style.gap = "20px";
    }
    exportHost.appendChild(exportReport);
    document.body.appendChild(exportHost);

    // Wait two animation frames for the layout engine to compute dimensions at 794px width
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const contentH = Math.max(exportReport.scrollHeight, exportReport.offsetHeight, 800);

    let canvas;
    try {
      canvas = await window.html2canvas(exportReport, {
        backgroundColor: "#f7f4fc",
        scale: hdScale,
        useCORS: true,
        width: exportWidth,
        height: contentH,
        windowWidth: exportWidth,
        windowHeight: contentH,
        scrollX: 0,
        scrollY: 0,
        onclone: (_doc, clonedEl) => {
          clonedEl.style.overflow = "visible";
          clonedEl.style.minHeight = "0";
          clonedEl.style.height = contentH + "px";
          const g = clonedEl.querySelector(".weekly-comp-charts");
          if (g) {
            g.style.display = "grid";
            g.style.gridTemplateColumns = "1fr 1fr";
            g.style.gap = "20px";
          }
        },
      });
    } finally {
      exportHost.remove();
    }

    // Trim canvas to content height (no trailing blank rows)
    {
      const cropPx = Math.min(Math.ceil(contentH * hdScale), canvas.height);
      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = canvas.width;
      cropCanvas.height = cropPx;
      cropCanvas.getContext("2d").drawImage(canvas, 0, 0);
      canvas = cropCanvas;
    }

    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.99));
    if (!blob) throw new Error("JPEG export failed");

    const fileName = `weekly-performance-${todayFileName()}.jpg`;
    const file = new File([blob], fileName, { type: "image/jpeg" });

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: "Weekly Performance",
        text: `Weekly Performance Update ${formatShareDate(new Date())}`,
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
    toast("Weekly JPEG downloaded");
  } catch (err) {
    console.warn("[Performance] Weekly share failed:", err);
    toast("Unable to share weekly dashboard right now");
  }
};

window.markWeeklyOfficerAvailability = function (officer, date) {
  if (!S.isAdmin) {
    toast("Admin only");
    return;
  }
  if (!officer || !date) return;

  const existing = officerAvailabilityForDate(officer, date);
  showWeeklyAvailabilitySheet(officer, date, existing);
};

window.closeWeeklyAvailabilitySheet = function () {
  document.querySelector(".weekly-availability-overlay")?.remove();
};

window.saveWeeklyOfficerAvailabilityFromSheet = function (type) {
  const sheet = document.querySelector(".weekly-availability-sheet");
  if (!sheet) return;
  window.saveWeeklyOfficerAvailability(sheet.dataset.officer, sheet.dataset.date, type);
};

window.removeWeeklyOfficerAvailabilityFromSheet = function () {
  const sheet = document.querySelector(".weekly-availability-sheet");
  if (!sheet) return;
  window.removeWeeklyOfficerAvailability(sheet.dataset.officer, sheet.dataset.date);
};

window.saveWeeklyOfficerAvailability = async function (officer, date, type) {
  if (!S.isAdmin) {
    toast("Admin only");
    return;
  }
  const existing = officerAvailabilityForDate(officer, date);
  const label = document.getElementById("weeklyAvailabilityNote")?.value.trim() || "";
  const list = removeAvailabilityDate(S.officerAvailability || [], existing, date);
  const item = normalizeAvailability({
    id: `${officer}_${type}_${date}_${Date.now()}`.replace(/[^a-z0-9_-]+/gi, "_"),
    officer,
    type,
    startDate: date,
    endDate: date,
    label,
  });
  if (!item) {
    toast("Could not mark availability");
    return;
  }

  S.officerAvailability = [...list, item];
  await saveSettings();
  window.renderSettingsList?.();
  window.closeWeeklyAvailabilitySheet();
  window.showPerformanceSnapshot("weekly");
  toast(`${AVAILABILITY_TYPES[type]} marked`);
};

window.removeWeeklyOfficerAvailability = async function (officer, date) {
  if (!S.isAdmin) {
    toast("Admin only");
    return;
  }
  const existing = officerAvailabilityForDate(officer, date);
  if (!existing) {
    window.closeWeeklyAvailabilitySheet();
    return;
  }
  S.officerAvailability = removeAvailabilityDate(S.officerAvailability || [], existing, date);
  await saveSettings();
  window.renderSettingsList?.();
  window.closeWeeklyAvailabilitySheet();
  window.showPerformanceSnapshot("weekly");
  toast("Availability removed");
};

function todayFileName() {
  return new Date().toISOString().slice(0, 10);
}

function formatShareDate(date) {
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function showWeeklyAvailabilitySheet(officer, date, existing) {
  window.closeWeeklyAvailabilitySheet();
  const overlay = document.createElement("div");
  overlay.className = "weekly-availability-overlay";
  overlay.innerHTML = `<div class="weekly-availability-sheet" role="dialog" aria-modal="true" data-officer="${esc(officer)}" data-date="${esc(date)}">
    <div class="sheet-handle"></div>
    <div class="weekly-availability-head">
      <div>
        <span>Officer Availability</span>
        <h3>${esc(officer)}</h3>
        <p>${esc(date)}${existing ? ` · ${esc(availabilityLabel(existing))}` : ""}</p>
      </div>
      <button type="button" class="weekly-availability-close" onclick="closeWeeklyAvailabilitySheet()">Close</button>
    </div>
    <label class="weekly-availability-note">
      <span>Note</span>
      <input id="weeklyAvailabilityNote" type="text" value="${esc(existing?.label || "")}" placeholder="Optional note">
    </label>
    <div class="weekly-availability-actions">
      <button type="button" class="weekly-availability-btn holiday" onclick="saveWeeklyOfficerAvailabilityFromSheet('holiday')">On Leave</button>
      <button type="button" class="weekly-availability-btn deputation" onclick="saveWeeklyOfficerAvailabilityFromSheet('deputation')">Deputation</button>
      ${existing ? `<button type="button" class="weekly-availability-btn remove" onclick="removeWeeklyOfficerAvailabilityFromSheet()">Remove</button>` : ""}
    </div>
  </div>`;
  overlay.addEventListener("click", event => {
    if (event.target === overlay) window.closeWeeklyAvailabilitySheet();
  });
  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById("weeklyAvailabilityNote")?.focus(), 80);
}

function renderPerformancePeriodToggle(currentPeriod = activePerformancePeriod) {
  const overlayTitle = document.querySelector("#perfOverlay .perf-overlay-title");
  if (!overlayTitle) return;
  let toggle = document.querySelector("#perfOverlay .perf-period-toggle");
  if (!toggle) {
    toggle = document.createElement("div");
    toggle.className = "perf-period-toggle";
    toggle.setAttribute("role", "tablist");
    toggle.setAttribute("aria-label", "Performance period");
    overlayTitle.insertAdjacentElement("afterend", toggle);
  }
  toggle.innerHTML = Object.entries(PERFORMANCE_PERIODS).map(([key, item]) => {
    const active = key === currentPeriod;
    return `<button class="perf-period-option${active ? " active" : ""}" type="button" role="tab" aria-selected="${active ? "true" : "false"}" onclick="showPerformanceSnapshot('${key}')">${item.label}</button>`;
  }).join("");
}

async function logSnapshot() {
  try {
    const today = new Date();
    today.setHours(today.getHours() + 5, today.getMinutes() + 30);
    const dateStr = today.toISOString().split("T")[0];
    await setDoc(doc(db, "snapshotLogs", dateStr), { sharedAt: new Date().toISOString() }, { merge: true });
  } catch(e) {}
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function cloneAvailabilityRange(item, startDate, endDate, suffix) {
  if (!item || startDate > endDate) return null;
  return {
    ...item,
    id: `${item.id}_${suffix}_${startDate}_${endDate}`.replace(/[^a-z0-9_-]+/gi, "_"),
    startDate,
    endDate,
  };
}

function removeAvailabilityDate(items, existing, date) {
  if (!existing) return [...items];
  const out = [];
  items.forEach(item => {
    const normalized = normalizeAvailability(item);
    if (!normalized || normalized.id !== existing.id) {
      out.push(item);
      return;
    }
    const before = cloneAvailabilityRange(normalized, normalized.startDate, addDays(date, -1), "before");
    const after = cloneAvailabilityRange(normalized, addDays(date, 1), normalized.endDate, "after");
    if (before) out.push(before);
    if (after) out.push(after);
  });
  return out;
}
