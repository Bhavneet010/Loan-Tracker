import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const helperSource = await readFile(
  new URL("../js/amount-filter.js", import.meta.url),
  "utf8",
);
const helperModule = await import(
  `data:text/javascript;base64,${Buffer.from(helperSource).toString("base64")}`
);
const {
  normalizeAmountOp,
  parseAmountInput,
  amountFilterActive,
  matchesAmountFilter,
  amountFilterLabel,
} = helperModule;

const filter = (amountOp, amountValue) => ({ status: "Amount", amountOp, amountValue });

test("the comparison defaults to greater than", () => {
  assert.equal(normalizeAmountOp(undefined), "gt");
  assert.equal(normalizeAmountOp("between"), "gt");
  assert.equal(normalizeAmountOp("lt"), "lt");
  assert.equal(amountFilterLabel(filter("lt", "50")), "below");
  assert.equal(amountFilterLabel(filter("gt", "50")), "above");
});

test("a blank or unfinished figure reads as no limit", () => {
  assert.equal(parseAmountInput(""), null);
  assert.equal(parseAmountInput("  "), null);
  assert.equal(parseAmountInput("abc"), null);
  assert.equal(parseAmountInput(undefined), null);
  assert.equal(parseAmountInput("12.5"), 12.5);
  assert.equal(parseAmountInput("1,50"), 150);
});

test("the filter only counts once a figure has been typed", () => {
  assert.equal(amountFilterActive(filter("gt", "")), false);
  assert.equal(amountFilterActive(filter("gt", "25")), true);
  assert.equal(amountFilterActive({ status: "DueSoon", amountValue: "25" }), false);
});

test("an account without a figure to compare against is kept", () => {
  assert.equal(matchesAmountFilter("10", filter("gt", "")), true);
  assert.equal(matchesAmountFilter("10", filter("gt", "abc")), true);
});

test("greater than keeps only the larger accounts", () => {
  assert.equal(matchesAmountFilter("60", filter("gt", "50")), true);
  assert.equal(matchesAmountFilter("50", filter("gt", "50")), false);
  assert.equal(matchesAmountFilter("49.5", filter("gt", "50")), false);
});

test("smaller than keeps only the smaller accounts", () => {
  assert.equal(matchesAmountFilter("49.5", filter("lt", "50")), true);
  assert.equal(matchesAmountFilter("50", filter("lt", "50")), false);
  assert.equal(matchesAmountFilter("60", filter("lt", "50")), false);
});

test("an account with no amount drops out of an active amount filter", () => {
  assert.equal(matchesAmountFilter("", filter("gt", "50")), false);
  assert.equal(matchesAmountFilter(undefined, filter("lt", "50")), false);
});
