function fitText(doc, value, maxWidth) {
  let text = String(value ?? "");
  if (doc.getTextWidth(text) <= maxWidth) return text;
  while (text.length && doc.getTextWidth(`${text}...`) > maxWidth) text = text.slice(0, -1);
  return `${text}...`;
}

export function renderMultiMonthRenewalPdf(doc, sections, options) {
  const { columns, rowMapper, margin = 8 } = options || {};
  if (!doc || !Array.isArray(sections) || !sections.length) {
    throw new TypeError("A PDF document and month sections are required");
  }
  if (!Array.isArray(columns) || !columns.length || typeof rowMapper !== "function") {
    throw new TypeError("PDF columns and a row mapper are required");
  }

  const pageHeight = doc.internal.pageSize.getHeight();
  const rowHeight = 5.4;
  const cellPadding = 1.2;
  const lineHeight = 3.1;
  const sectionHeaderHeight = 12.5;
  const columnX = [];
  let x = margin;
  columns.forEach(column => {
    columnX.push(x);
    x += column.w;
  });
  const tableWidth = x - margin;
  const remarksColumn = columns.find(column => column.key === "Remarks");
  const remarksWidth = (remarksColumn?.w || 38) - cellPadding * 2;
  let y = margin;

  const drawTableHeader = () => {
    doc.setFillColor(107, 95, 191);
    doc.rect(margin, y, tableWidth, rowHeight, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.2);
    doc.setTextColor(255, 255, 255);
    columns.forEach((column, index) => {
      const tx = column.align === "right"
        ? columnX[index] + column.w - cellPadding
        : columnX[index] + cellPadding;
      doc.text(column.header, tx, y + rowHeight - 1.7, { align: column.align === "right" ? "right" : "left" });
    });
    y += rowHeight;
  };

  const drawSectionHeading = (section, continued = false) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.setTextColor(40, 35, 70);
    doc.text(`${section.monthName} ${section.year}${continued ? " (continued)" : ""}`, margin, y + 4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.8);
    doc.setTextColor(110, 110, 125);
    const pending = `${section.loans.length} pending renewal${section.loans.length === 1 ? "" : "s"}`;
    const notPossible = section.rnpLoans.length ? ` · ${section.rnpLoans.length} not possible` : "";
    doc.text(`${pending}${notPossible}`, margin, y + 8.6);
    y += sectionHeaderHeight;
    drawTableHeader();
  };

  const startContinuationPage = section => {
    doc.addPage("a4", "portrait");
    y = margin;
    drawSectionHeading(section, true);
  };

  sections.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) y += 6;
    if (y + sectionHeaderHeight + rowHeight > pageHeight - margin) {
      doc.addPage("a4", "portrait");
      y = margin;
    }
    drawSectionHeading(section);

    const rows = [
      ...section.loans.map(loan => ({ values: rowMapper(loan), rnp: false })),
      ...section.rnpLoans.map(loan => ({ values: rowMapper(loan), rnp: true })),
    ];

    if (!rows.length) {
      if (y + rowHeight > pageHeight - margin) startContinuationPage(section);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7.8);
      doc.setTextColor(100, 116, 139);
      doc.text("No pending renewals", margin + cellPadding, y + rowHeight - 1.7);
      y += rowHeight;
      return;
    }

    rows.forEach(({ values, rnp }, rowIndex) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.2);
      const remarkLines = doc.splitTextToSize(String(values.Remarks ?? ""), remarksWidth);
      const height = Math.max(rowHeight, remarkLines.length * lineHeight + (rowHeight - lineHeight));
      if (y + height > pageHeight - margin) startContinuationPage(section);

      if (rnp) {
        doc.setFillColor(226, 232, 240);
        doc.rect(margin, y, tableWidth, height, "F");
      } else if (rowIndex % 2 === 1) {
        doc.setFillColor(244, 242, 250);
        doc.rect(margin, y, tableWidth, height, "F");
      }

      doc.setTextColor(...(rnp ? [100, 116, 139] : [45, 45, 55]));
      const baseY = y + rowHeight - 1.7;
      columns.forEach((column, columnIndex) => {
        const tx = column.align === "right"
          ? columnX[columnIndex] + column.w - cellPadding
          : columnX[columnIndex] + cellPadding;
        if (column.key === "Remarks") {
          remarkLines.forEach((line, lineIndex) => doc.text(line, tx, baseY + lineIndex * lineHeight));
          return;
        }
        const raw = column.key ? values[column.key] : rowIndex + 1;
        const text = fitText(doc, raw, column.w - cellPadding * 2);
        doc.text(text, tx, baseY, { align: column.align === "right" ? "right" : "left" });
      });
      doc.setDrawColor(225, 222, 238);
      doc.setLineWidth(0.15);
      doc.line(margin, y + height, margin + tableWidth, y + height);
      y += height;
    });
  });

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 160);
    doc.text(`Page ${page} of ${pageCount}`, doc.internal.pageSize.getWidth() - margin, pageHeight - 4, { align: "right" });
  }

  return { pageCount };
}
