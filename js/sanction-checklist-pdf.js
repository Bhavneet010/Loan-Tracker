// PDF export of a pre-sanction checklist (A4 portrait, drawn with jsPDF).
// Loaded on demand from sanction-checklist.js when "PDF" is tapped.
import { createRetryableScriptLoader } from "./script-loader.js";
import {
  CONSTITUTIONS, checklistReport, collateralRequired, isEducation, relationLabel, workLabel,
} from "./sanction-checklist-model.js";

const ensureJsPdf = createRetryableScriptLoader({
  documentRef: document,
  isReady: () => !!window.jspdf?.jsPDF,
  src: "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",
  errorMessage: "Failed to load jsPDF",
});

// Section colours, matching the cards on screen.
const SECTION_RGB = {
  A: [110, 96, 214], B: [13, 148, 136], C: [37, 118, 214], D: [202, 128, 16],
  E: [224, 98, 40], F: [200, 60, 108], G: [64, 150, 60], H: [120, 90, 60],
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
  return `${isEducation(checklist) ? "education-loan-checklist" : "pre-sanction-checklist"}-${slug}-${today}.pdf`;
}

const pdfTitle = checklist => (isEducation(checklist) ? "Education Loan Checklist" : "Pre-Sanction Checklist");

// Label / value pairs for the details box at the top.
export function checklistPdfDetails(checklist) {
  if (isEducation(checklist)) {
    const coApplicant = n => {
      const relation = relationLabel(checklist[`co${n}Relation`]) || "-";
      const work = workLabel(checklist[`co${n}Work`]);
      return work ? `${relation} (${work})` : relation;
    };
    const required = collateralRequired(checklist);
    const auto = (checklist.collateralMode || "auto") === "auto";
    // Short enough to fit on one line of the details box.
    const collateral = `${required ? "Required" : "Not required"} - ${auto ? "by amount" : "overridden"}`;
    return [
      ["Student", checklist.borrowerName || "-"],
      ["Amount", fmtLakh(checklist.amountLakh)],
      ["Course", checklist.course || "-"],
      ["Study", checklist.studyAbroad ? "Abroad" : "India"],
      ["Co-applicant 1", coApplicant(1)],
      ["Co-applicant 2", checklist.secondCoApplicant ? coApplicant(2) : "None"],
      ["Collateral", collateral],
    ];
  }
  const constitution = CONSTITUTIONS.find(opt => opt.value === checklist.constitution)?.label || "-";
  return [
    ["Borrower", checklist.borrowerName || "-"],
    ["Facility", facilityName(checklist.facility)],
    ["Amount", fmtLakh(checklist.amountLakh)],
    ["Constitution", constitution],
    ["Collateral", checklist.collateral ? "Offered" : "None - covered under CGTMSE"],
    ["Premises", checklist.rented ? "Rented" : "Owned"],
  ];
}

export function drawChecklistPdf(doc, checklist, { user } = {}) {
  const report = checklistReport(checklist);
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 12;
  const CW = W - M * 2;
  // Status sits left of centre so the remarks column has room to write in.
  const COLS = { no: 11, label: 86, status: 24 };
  COLS.remark = CW - COLS.no - COLS.label - COLS.status;
  const X = { no: M, label: M + COLS.no, status: M + COLS.no + COLS.label };
  X.remark = X.status + COLS.status;
  const BOTTOM = H - 14;
  let y = M;

  const text = (value, x, ty, opts) => doc.text(clean(value), x, ty, opts);
  const setFont = (style, size, rgb = INK) => { doc.setFont("helvetica", style); doc.setFontSize(size); doc.setTextColor(...rgb); };

  const tableHeader = () => {
    doc.setFillColor(...INDIGO);
    doc.rect(M, y, CW, 6.8, "F");
    setFont("bold", 9, [255, 255, 255]);
    text("No.", X.no + 1.5, y + 4.7);
    text("Particular", X.label + 1.5, y + 4.7);
    text("Status", X.status + COLS.status / 2, y + 4.7, { align: "center" });
    text("Remarks", X.remark + 1.5, y + 4.7);
    y += 6.8;
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
  doc.roundedRect(M, y, CW, 14, 2.5, 2.5, "F");
  setFont("bold", 18, [255, 255, 255]);
  text(pdfTitle(checklist), W / 2, y + 9.4, { align: "center" });
  y += 17;

  // ── Borrower / student details ──
  const details = checklistPdfDetails(checklist);
  // Education labels ("Co-applicant 1") are longer, so give them more room.
  const labelW = isEducation(checklist) ? 28 : 26;
  const half = CW / 2;
  const boxH = Math.ceil(details.length / 2) * 6.2 + 3;
  doc.setDrawColor(...LINE);
  doc.setFillColor(248, 247, 253);
  doc.roundedRect(M, y, CW, boxH, 2, 2, "FD");
  details.forEach(([label, value], index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const bx = M + 4 + col * half;
    const by = y + 6 + row * 6.2;
    setFont("normal", 9, MUTED);
    text(label, bx, by);
    setFont("bold", 10, INK);
    text(doc.splitTextToSize(clean(value), half - labelW - 6)[0], bx + labelW, by);
  });
  y += boxH + 3;

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
    doc.roundedRect(tx, y, tileW, 10.5, 2, 2, "F");
    setFont("bold", 14, rgb);
    const valueWidth = doc.getTextWidth(String(value));
    text(String(value), tx + 4, y + 7.3);
    setFont("bold", 8, MUTED);
    text(label.toUpperCase(), tx + 4 + valueWidth + 2.5, y + 6.9);
  });
  y += 10.5;
  // Overall progress bar
  doc.setFillColor(...tint(INDIGO, 0.12));
  doc.roundedRect(M, y + 2.5, CW, 2, 1, 1, "F");
  if (s.percent > 0) {
    doc.setFillColor(...INDIGO);
    doc.roundedRect(M, y + 2.5, Math.max(2, (CW * s.percent) / 100), 2, 1, 1, "F");
  }
  y += 7.5;

  // ── Sections ──
  function sectionBand(section, continued = false) {
    const rgb = SECTION_RGB[section.id] || INDIGO;
    ensure(7 + 8.4);
    doc.setFillColor(...tint(rgb, 0.14));
    doc.rect(M, y, CW, 7, "F");
    doc.setFillColor(...rgb);
    doc.rect(M, y, 1.6, 7, "F");
    setFont("bold", 10, rgb);
    text(`${section.id}.`, M + 4, y + 4.9);
    setFont("bold", 10, INK);
    text(`${section.title}${continued ? " (continued)" : ""}`, M + 11, y + 4.9);
    setFont("bold", 9, rgb);
    text(`${section.received}/${section.applicable} ${section.doneLabel.toLowerCase()}`, M + CW - 3, y + 4.9, { align: "right" });
    y += 7;
  }

  const statusCell = (status, label, ty, rowH) => {
    const pillW = COLS.status - 4;
    doc.setFillColor(...(STATUS_FILL[status] || STATUS_FILL.pending));
    doc.roundedRect(X.status + 2, ty + (rowH - 5.2) / 2, pillW, 5.2, 2.6, 2.6, "F");
    setFont("bold", 8.5, STATUS_RGB[status] || STATUS_RGB.pending);
    text(label, X.status + 2 + pillW / 2, ty + rowH / 2 + 1.5, { align: "center" });
  };

  const rowLine = ty => {
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.line(M, ty, M + CW, ty);
  };

  tableHeader();
  for (const section of report.sections) {
    // Set after drawing the band: if the band itself moves to a new page,
    // it must not also be repeated there as "(continued)".
    currentSection = null;
    sectionBand(section);
    currentSection = section;
    for (const row of section.rows) {
      const LH = 4; // line height for 9.5pt text
      setFont("normal", 9.5, INK);
      const labelLines = doc.splitTextToSize(clean(row.label), COLS.label - 3);
      setFont("italic", 9, MUTED);
      const remarkLines = row.remark ? doc.splitTextToSize(clean(row.remark), COLS.remark - 4) : [];
      // Rows leave room for a hand-written remark when none was typed.
      const rowH = Math.max(8.4, 3 + Math.max(labelLines.length, remarkLines.length || 1) * LH);
      ensure(rowH);
      // Centre the label block in the row, like the status pill beside it.
      const labelY = y + (rowH - labelLines.length * LH) / 2 + 3;
      setFont("bold", 9, SECTION_RGB[section.id] || INDIGO);
      text(row.no, X.no + 1.5, labelY);
      setFont(row.years ? "bold" : "normal", 9.5, row.status === "na" ? MUTED : INK);
      doc.text(labelLines, X.label + 1.5, labelY);
      statusCell(row.status, row.statusLabel, y, rowH);
      if (remarkLines.length) {
        setFont("italic", 9, MUTED);
        doc.text(remarkLines, X.remark + 2, y + (rowH - remarkLines.length * LH) / 2 + 2.9);
      } else {
        // Empty outline so a remark can be written on the printout.
        doc.setDrawColor(175, 170, 205);
        doc.setLineWidth(0.25);
        doc.roundedRect(X.remark + 1.5, y + (rowH - 6.6) / 2, COLS.remark - 3, 6.6, 3.3, 3.3, "S");
      }
      y += rowH;
      for (const entry of row.years || []) {
        ensure(5.8);
        setFont("normal", 9, entry.status === "na" ? MUTED : INK);
        text(`-  ${entry.label}`, X.label + 5, y + 4);
        statusCell(entry.status, entry.statusLabel, y, 5.8);
        y += 5.8;
      }
      if (!row.years?.length && row.years) {
        setFont("italic", 9, MUTED);
        text("No years listed", X.label + 5, y + 4);
        y += 5.8;
      }
      rowLine(y);
    }
    y += 1.5;
  }
  currentSection = null;

  if (report.hidden.length) {
    ensure(9);
    setFont("italic", 9, MUTED);
    const note = `Not applicable: ${report.hidden.map(entry => `${entry.id}. ${entry.title} (${entry.reason})`).join("; ")}.`;
    const lines = doc.splitTextToSize(clean(note), CW);
    doc.text(lines, M, y + 5);
    y += 5 + lines.length * 4;
  }

  // ── Footer on every page ──
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    setFont("normal", 8, MUTED);
    text(`${checklist.borrowerName || "Borrower"} - ${pdfTitle(checklist)}${user ? ` - exported by ${user}` : ""}`, M, H - 6);
    text(`Page ${page} of ${pages}`, M + CW, H - 6, { align: "right" });
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
