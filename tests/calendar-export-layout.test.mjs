import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../js/calendar-export-layout.js", import.meta.url), "utf8");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const { buildMultiMonthTabularLayout } = await import(moduleUrl);

test("tabular layout appends selected months with repeated headers and an empty section", () => {
  const headers = ["Customer", "Remarks"];
  const sections = [
    {
      key: "2026-08",
      year: 2026,
      monthName: "August",
      loans: [{ name: "Alpha", remarks: "plain" }],
      rnpLoans: [{ name: "Beta", remarks: "deferred" }],
    },
    {
      key: "2026-09",
      year: 2026,
      monthName: "September",
      loans: [],
      rnpLoans: [],
    },
  ];

  const layout = buildMultiMonthTabularLayout(
    sections,
    headers,
    loan => ({ Customer: loan.name, Remarks: loan.remarks }),
  );

  assert.deepEqual(layout.rows, [
    ["August 2026 - 1 pending renewal - 1 not possible"],
    ["Customer", "Remarks"],
    ["Alpha", "plain"],
    ["Beta", "deferred"],
    [],
    ["September 2026 - 0 pending renewals"],
    ["Customer", "Remarks"],
    ["No pending renewals"],
  ]);
  assert.deepEqual(layout.headingRows, [0, 5]);
  assert.deepEqual(layout.headerRows, [1, 6]);
  assert.deepEqual(layout.dataRows, [
    { row: 2, rnp: false },
    { row: 3, rnp: true },
  ]);
  assert.deepEqual(layout.emptyRows, [7]);
  assert.deepEqual(layout.merges, [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },
    { s: { r: 5, c: 0 }, e: { r: 5, c: 1 } },
    { s: { r: 7, c: 0 }, e: { r: 7, c: 1 } },
  ]);
});

test("tabular layout rejects an empty section list", () => {
  assert.throws(
    () => buildMultiMonthTabularLayout([], ["Customer"], loan => loan),
    TypeError,
  );
});
