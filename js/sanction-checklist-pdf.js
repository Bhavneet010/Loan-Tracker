// PDF export of a pre-sanction checklist (A4 portrait, drawn with jsPDF).
// Loaded on demand from sanction-checklist.js when "PDF" is tapped.
import { createRetryableScriptLoader } from "./script-loader.js";
import { CONSTITUTIONS, checklistReport } from "./sanction-checklist-model.js";

const ensureJsPdf = createRetryableScriptLoader({
  documentRef: document,
  isReady: () => !!window.jspdf?.jsPDF,
  src: "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",
  errorMessage: "Failed to load jsPDF",
});

// Section colours, matching the cards on screen.
const SECTION_RGB = {
  A: [110, 96, 214], B: [13, 148, 136], C: [37, 118, 214], D: [202, 128, 16],
  E: [224, 98, 40], F: [200, 60, 108], G: [64, 150, 60],
};
const INDIGO = [79, 70, 200];
const INK = [30, 27, 58];
const MUTED = [110, 108, 140];
const LINE = [222, 219, 240];
const STATUS_RGB = { received: [4, 120, 87], pending: [185, 28, 28], na: [110, 108, 140] };
const STATUS_FILL = { received: [220, 245, 234], pending: [253, 228, 228], na: [238, 237, 244] };

const tint = (rgb, amount) => rgb.map(c => Math.round(255 - (255 - c) * amount));

// jsPDF's built-in fonts only cover Latin-1: swap the few characters that
// would otherwise print as gibberish.
const clean = value => String(value ?? "")
  .replace(/₹\s?/g, "Rs ")
  .replace(/[–—]/g, "-")
  .replace(/[‘’]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/•/g, "-")
  .replace(/…/g, "...")
  .replace(/[^\x00-\xFF]/g, "");

const fmtLakh = value => (value == null ? "-" : `Rs ${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })} lakh`);
const facilityName = value => ({ CC: "Cash Credit (CC)", TL: "Term Loan (TL)", CCTL: "CC + TL" }[value] || "-");

export function checklistPdfFilename(checklist, today) {
  const slug = clean(checklist?.borrowerName || "borrower").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "borrower";
  return `pre-sanction-checklist-${slug}-${today}.pdf`;
}

export function drawChecklistPdf(doc, checklist, { user } = {}) {
  const report = checklistReport(checklist);
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 12;
  const CW = W - M * 2;
  const COLS = { no: 10, label: 104, status: 24 };
  COLS.remark = CW - COLS.no - COLS.label - COLS.status;
  const X = { no: M, label: M + COLS.no, status: M + COLS.no + COLS.label };
  X.remark = X.status + COLS.status;
  const BOTTOM = H - 16;
  let y = M;

  const text = (value, x, ty, opts) => doc.text(clean(value), x, ty, opts);
  const setFont = (style, size, rgb = INK) => { doc.setFont("helvetica", style); doc.setFontSize(size); doc.setTextColor(...rgb); };

  const tableHeader = () => {
    doc.setFillColor(...INDIGO);
    doc.rect(M, y, CW, 6.5, "F");
    setFont("bold", 7.5, [255, 255, 255]);
    text("No.", X.no + 1.5, y + 4.4);
    text("Particular", X.label + 1.5, y + 4.4);
    text("Status", X.status + 1.5, y + 4.4);
    text("Remarks", X.remark + 1.5, y + 4.4);
    y += 6.5;
  };
  let currentSection = null;
  const newPage = () => {
    doc.addPage();
    y = M;
    tableHeader();
    if (currentSection) sectionBand(currentSection, true);
  };
  const ensure = height => { if (y + height > BOTTOM) newPage(); };

  // ── Title band: the title alone, centred ──
  doc.setFillColor(...INDIGO);
  doc.roundedRect(M, y, CW, 18, 2.5, 2.5, "F");
  setFont("bold", 20, [255, 255, 255]);
  text("Pre-Sanction Checklist", W / 2, y + 11.8, { align: "center" });
  y += 23;

  // ── Borrower details ──
  const constitution = CONSTITUTIONS.find(opt => opt.value === checklist.constitution)?.label || "-";
  const details = [
    ["Borrower", checklist.borrowerName || "-"],
    ["Facility", facilityName(checklist.facility)],
    ["Amount", fmtLakh(checklist.amountLakh)],
    ["Constitution", constitution],
    ["Collateral", checklist.collateral ? "Offered" : "None - covered under CGTMSE"],
    ["Premises", checklist.rented ? "Rented" : "Owned"],
  ];
  const half = CW / 2;
  const boxH = Math.ceil(details.length / 2) * 6 + 4;
  doc.setDrawColor(...LINE);
  doc.setFillColor(248, 247, 253);
  doc.roundedRect(M, y, CW, boxH, 2, 2, "FD");
  details.forEach(([label, value], index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const bx = M + 4 + col * half;
    const by = y + 6 + row * 6;
    setFont("normal", 7.5, MUTED);
    text(label, bx, by);
    setFont("bold", 8.5, INK);
    text(doc.splitTextToSize(clean(value), half - 30)[0], bx + 24, by);
  });
  y += boxH + 4;

  // ── Summary tiles ──
  const s = report.summary;
  const tiles = [
    ["Applicable", s.applicable, INDIGO],
    ["Done", s.received, STATUS_RGB.received],
    ["Pending", s.pending, STATUS_RGB.pending],
    ["N/A", s.na, STATUS_RGB.na],
  ];
  const tileW = (CW - 3 * 3) / 4;
  tiles.forEach(([label, value, rgb], index) => {
    const tx = M + index * (tileW + 3);
    doc.setFillColor(...tint(rgb, 0.1));
    doc.roundedRect(tx, y, tileW, 12, 2, 2, "F");
    setFont("bold", 13, rgb);
    const valueWidth = doc.getTextWidth(String(value));
    text(String(value), tx + 4, y + 7.6);
    setFont("bold", 7, MUTED);
    text(label.toUpperCase(), tx + 4 + valueWidth + 2.5, y + 7.3);
  });
  y += 12;
  // Overall progress bar
  doc.setFillColor(...tint(INDIGO, 0.12));
  doc.roundedRect(M, y + 3, CW, 2.2, 1.1, 1.1, "F");
  if (s.percent > 0) {
    doc.setFillColor(...INDIGO);
    doc.roundedRect(M, y + 3, Math.max(2.2, (CW * s.percent) / 100), 2.2, 1.1, 1.1, "F");
  }
  y += 9;

  // ── Sections ──
  function sectionBand(section, continued = false) {
    const rgb = SECTION_RGB[section.id] || INDIGO;
    ensure(8 + 7);
    doc.setFillColor(...tint(rgb, 0.14));
    doc.rect(M, y, CW, 7, "F");
    doc.setFillColor(...rgb);
    doc.rect(M, y, 1.6, 7, "F");
    setFont("bold", 8.5, rgb);
    text(`${section.id}.`, M + 4, y + 4.8);
    setFont("bold", 8.5, INK);
    text(`${section.title}${continued ? " (continued)" : ""}`, M + 10, y + 4.8);
    setFont("bold", 7.5, rgb);
    text(`${section.received}/${section.applicable} ${section.doneLabel.toLowerCase()}`, M + CW - 3, y + 4.8, { align: "right" });
    y += 7;
  }

  const statusCell = (status, label, ty, rowH) => {
    const pillW = COLS.status - 4;
    doc.setFillColor(...(STATUS_FILL[status] || STATUS_FILL.pending));
    doc.roundedRect(X.status + 2, ty + (rowH - 4.6) / 2, pillW, 4.6, 2.3, 2.3, "F");
    setFont("bold", 7, STATUS_RGB[status] || STATUS_RGB.pending);
    text(label, X.status + 2 + pillW / 2, ty + rowH / 2 + 1.2, { align: "center" });
  };

  const rowLine = ty => {
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.line(M, ty, M + CW, ty);
  };

  tableHeader();
  for (const section of report.sections) {
    currentSection = section;
    sectionBand(section);
    for (const row of section.rows) {
      setFont("normal", 8, INK);
      const labelLines = doc.splitTextToSize(clean(row.label), COLS.label - 3);
      setFont("italic", 7.5, MUTED);
      const remarkLines = row.remark ? doc.splitTextToSize(clean(row.remark), COLS.remark - 3) : [];
      // Rows leave room for a hand-written remark when none was typed.
      const rowH = Math.max(remarkLines.length ? 7 : 8.4, 3 + Math.max(labelLines.length, remarkLines.length || 1) * 3.6);
      ensure(rowH);
      // Centre the label block in the row, like the status pill beside it.
      const labelY = y + (rowH - labelLines.length * 3.6) / 2 + 2.7;
      setFont("bold", 7.5, SECTION_RGB[section.id] || INDIGO);
      text(row.no, X.no + 1.5, labelY);
      setFont(row.years ? "bold" : "normal", 8, row.status === "na" ? MUTED : INK);
      doc.text(labelLines, X.label + 1.5, labelY);
      statusCell(row.status, row.statusLabel, y, rowH);
      if (remarkLines.length) {
        setFont("italic", 7.5, MUTED);
        doc.text(remarkLines, X.remark + 1.5, y + 4.6);
      } else {
        // Empty outline so a remark can be written on the printout.
        doc.setDrawColor(175, 170, 205);
        doc.setLineWidth(0.25);
        doc.roundedRect(X.remark + 1.5, y + (rowH - 6.2) / 2, COLS.remark - 3, 6.2, 3.1, 3.1, "S");
      }
      y += rowH;
      for (const entry of row.years || []) {
        ensure(5.6);
        setFont("normal", 7.5, entry.status === "na" ? MUTED : INK);
        text(`-  ${entry.label}`, X.label + 5, y + 3.9);
        statusCell(entry.status, entry.statusLabel, y, 5.6);
        y += 5.6;
      }
      if (!row.years?.length && row.years) {
        setFont("italic", 7.5, MUTED);
        text("No years listed", X.label + 5, y + 3.9);
        y += 5.6;
      }
      rowLine(y);
    }
    y += 2;
  }
  currentSection = null;

  if (report.hidden.length) {
    ensure(8);
    setFont("italic", 7.5, MUTED);
    const note = `Not applicable: ${report.hidden.map(entry => `${entry.id}. ${entry.title} (${entry.reason})`).join("; ")}.`;
    const lines = doc.splitTextToSize(clean(note), CW);
    doc.text(lines, M, y + 4);
    y += 4 + lines.length * 3.4;
  }

  // ── Footer on every page ──
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    setFont("normal", 7, MUTED);
    text(`${checklist.borrowerName || "Borrower"} - Pre-Sanction Checklist${user ? ` - exported by ${user}` : ""}`, M, H - 7);
    text(`Page ${page} of ${pages}`, M + CW, H - 7, { align: "right" });
  }
  return doc;
}

export async function exportChecklistPdf(checklist, { today, user } = {}) {
  await ensureJsPdf();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  drawChecklistPdf(doc, checklist, { user });
  doc.save(checklistPdfFilename(checklist, today));
}
