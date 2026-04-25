import { S } from "./state.js";
import { getLoanMetrics, sumAmount } from "./derived.js";
import { catCls, esc, fmtAmt, fmtDate, shortCat, toast } from "./utils.js";
import { monthDays, trendBuckets, groupAmountByBucket, buildOfficerTotals, buildTrendDatasets, buildLeaderboardRows, summaryRows, reportCell, metricBox, trendTable, performerTable, summaryTable, loanOfficer, loansForOfficer, totalMetric, metricHtml, statusRank, renewalUrgencyValue, sortRenewalRisk, riskWatchForOfficer, detailOfficerNames, officerPdfData, freshLoanLine, renewalLoanLine, riskStatusText, compactBranch, pdfSection, coverOfficerRow, CATS, TREND_COLORS, amountOf, PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT, html2canvasLoadPromise, jsPdfLoadPromise } from "./performance-utils.js";
import { buildDetailedSnapshotPdfHtml, miniFreshRow, miniRenewalRow, buildOfficerPdfSections, paginateOfficerPdfSections, compactPdfSection, compactPdfSectionV2, buildOfficerPdfPages, buildCompactOfficerPdfPage, buildCompactOfficerPdfPageV2, buildOfficerPdfPage, detailedSnapshotPdfCss, ensureHtml2Canvas, ensureJsPdf, ensureImageLoaded, officerNamesFromMetrics, emptyCatTotals, buildOfficerCategoryRows, buildOfficerRenewalRows, buildCategoryTotal, buildRenewalTotal, dualMetricCell, renderCategorySection, renderRenewalSection, buildReportMockupData, ordinal, renderLeaderChartCard, renderEditorialCategoryPills, renderEditorialOfficerCard, buildEditorialShareMockupHtml, renderMockupHeader, buildReportMockupHtml, buildDailySnapshotPageHtml, renderPerformanceView, DAILY_SNAPSHOT, SNAPSHOT_BG_ASSETS } from "./performance-templates.js";

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

window.showDailySnapshot = function () {
  const backBtn = document.querySelector("#perfOverlay .back-btn");
  const overlayHeader = document.querySelector("#perfOverlay .perf-overlay-header");
  const overlayTitle = document.querySelector("#perfOverlay .perf-overlay-title");
  const overlayActions = document.querySelector("#perfOverlay .perf-overlay-actions");
  if (overlayHeader) overlayHeader.classList.add("snapshot-mode");
  if (backBtn) backBtn.setAttribute("onclick", "closePerfOverlay()");
  if (overlayTitle) overlayTitle.textContent = "Daily Snapshot";
  if (overlayActions) {
    overlayActions.style.display = "";
    overlayActions.innerHTML = '<button class="perf-export-btn perf-export-btn-secondary" type="button" onclick="exportPerformanceSnapshot()">Detailed Snapshot</button><button class="perf-export-btn" type="button" onclick="shareDailySnapshotJpeg()">Share</button>';
  }
  const content = document.getElementById("perfOverlayContent");
  if (content) content.style.padding = "0";
  renderPerformanceView(content);
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
        scale: Math.min(4, Math.max(3, window.devicePixelRatio || 2)),
        useCORS: true,
        width: exportWidth,
        windowWidth: exportWidth,
      });
    } finally {
      exportHost.remove();
    }

    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.98));
    if (!blob) throw new Error("JPEG export failed");

    const fileName = `daily-snapshot-${todayFileName()}.jpg`;
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
    toast("JPEG downloaded");
  } catch (err) {
    console.warn("[Performance] Snapshot share failed:", err);
    toast("Unable to share snapshot right now");
  }
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
