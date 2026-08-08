function sectionHeading(section) {
  const pendingCount = section.loans.length;
  const pendingLabel = `${pendingCount} pending renewal${pendingCount === 1 ? "" : "s"}`;
  const rnpLabel = section.rnpLoans.length
    ? ` - ${section.rnpLoans.length} not possible`
    : "";
  return `${section.monthName} ${section.year} - ${pendingLabel}${rnpLabel}`;
}

export function buildMultiMonthTabularLayout(sections, headers, rowMapper) {
  if (!Array.isArray(sections) || !sections.length) {
    throw new TypeError("At least one month section is required");
  }
  if (!Array.isArray(headers) || !headers.length || typeof rowMapper !== "function") {
    throw new TypeError("Headers and a row mapper are required");
  }

  const layout = {
    rows: [],
    merges: [],
    headingRows: [],
    headerRows: [],
    dataRows: [],
    emptyRows: [],
  };
  const mergeRow = row => {
    layout.merges.push({ s: { r: row, c: 0 }, e: { r: row, c: headers.length - 1 } });
  };

  sections.forEach((section, sectionIndex) => {
    const headingRow = layout.rows.length;
    layout.headingRows.push(headingRow);
    layout.rows.push([sectionHeading(section)]);
    mergeRow(headingRow);

    const headerRow = layout.rows.length;
    layout.headerRows.push(headerRow);
    layout.rows.push([...headers]);

    const addLoan = (loan, rnp) => {
      const mapped = rowMapper(loan);
      const row = layout.rows.length;
      layout.rows.push(headers.map(header => mapped?.[header] ?? ""));
      layout.dataRows.push({ row, rnp });
    };
    section.loans.forEach(loan => addLoan(loan, false));
    section.rnpLoans.forEach(loan => addLoan(loan, true));

    if (!section.loans.length && !section.rnpLoans.length) {
      const emptyRow = layout.rows.length;
      layout.emptyRows.push(emptyRow);
      layout.rows.push(["No pending renewals"]);
      mergeRow(emptyRow);
    }

    if (sectionIndex < sections.length - 1) layout.rows.push([]);
  });

  return layout;
}
