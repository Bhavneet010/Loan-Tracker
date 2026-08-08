import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../js/calendar-export-pdf.js", import.meta.url), "utf8");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const { renderMultiMonthRenewalPdf } = await import(moduleUrl);

const columns = [
  { header: "#", w: 7 },
  { header: "Customer", w: 42, key: "Customer" },
  { header: "Remarks", w: 55, key: "Remarks" },
];

function fakePdf(pageHeight = 120) {
  const events = [];
  let pages = 1;
  let currentPage = 1;
  return {
    events,
    internal: { pageSize: { getHeight: () => pageHeight, getWidth: () => 120 } },
    setFillColor(...values) { events.push(["fill", currentPage, ...values]); },
    rect(...values) { events.push(["rect", currentPage, ...values]); },
    setFont() {},
    setFontSize() {},
    setTextColor() {},
    text(value) { events.push(["text", currentPage, String(value)]); },
    setDrawColor() {},
    setLineWidth() {},
    line() {},
    splitTextToSize(value) { return [String(value)]; },
    getTextWidth(value) { return String(value).length; },
    addPage() { pages += 1; currentPage = pages; events.push(["addPage", currentPage]); },
    getNumberOfPages() { return pages; },
    setPage(page) { currentPage = page; },
  };
}

const rowMapper = loan => ({ Customer: loan.name, Remarks: loan.remarks || "" });

test("PDF renderer flows month sections and keeps an explicit empty month", () => {
  const doc = fakePdf();
  const sections = [
    {
      monthName: "August",
      year: 2026,
      loans: [{ name: "Alpha" }],
      rnpLoans: [{ name: "Beta", remarks: "deferred" }],
    },
    { monthName: "September", year: 2026, loans: [], rnpLoans: [] },
  ];

  renderMultiMonthRenewalPdf(doc, sections, { columns, rowMapper });

  const text = doc.events.filter(event => event[0] === "text").map(event => event[2]);
  assert.ok(text.indexOf("August 2026") < text.indexOf("September 2026"));
  assert.ok(text.includes("1 pending renewal · 1 not possible"));
  assert.ok(text.includes("No pending renewals"));
  assert.equal(text.filter(value => value === "Customer").length, 2, "each month repeats table headings");
  assert.ok(doc.events.some(event => event[0] === "fill" && event.slice(2).join(",") === "226,232,240"), "not-possible row is grey");
  assert.ok(text.includes("Page 1 of 1"));
});

test("PDF renderer repeats the active month heading after a page break", () => {
  const doc = fakePdf(44);
  const sections = [{
    monthName: "October",
    year: 2026,
    loans: Array.from({ length: 6 }, (_, index) => ({ name: `Account ${index + 1}` })),
    rnpLoans: [],
  }];

  renderMultiMonthRenewalPdf(doc, sections, { columns, rowMapper });

  const text = doc.events.filter(event => event[0] === "text").map(event => event[2]);
  assert.ok(doc.getNumberOfPages() > 1);
  assert.ok(text.includes("October 2026 (continued)"));
  assert.equal(text.filter(value => value === "Customer").length, doc.getNumberOfPages());
});
