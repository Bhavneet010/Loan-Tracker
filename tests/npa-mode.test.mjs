import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const helperSource = await readFile(
  new URL("../js/npa-mode.js", import.meta.url),
  "utf8",
);
const helperModule = await import(
  `data:text/javascript;base64,${Buffer.from(helperSource).toString("base64")}`
);
const { NPA_MODES, normalizeNpaMode, nextNpaMode, npaModeAllows } = helperModule;

test("the NPA button cycles off, all, only and back to off", () => {
  assert.deepEqual(NPA_MODES, ["off", "all", "only"]);
  assert.equal(nextNpaMode("off"), "all");
  assert.equal(nextNpaMode("all"), "only");
  assert.equal(nextNpaMode("only"), "off");
});

test("an unknown stored mode falls back to the hidden state", () => {
  assert.equal(normalizeNpaMode(undefined), "off");
  assert.equal(normalizeNpaMode("npa"), "off");
  assert.equal(nextNpaMode(undefined), "all");
});

test("the hidden state keeps NPA accounts out of the list", () => {
  assert.equal(npaModeAllows("off", true), false);
  assert.equal(npaModeAllows("off", false), true);
});

test("the second click lists NPA accounts alongside the rest", () => {
  assert.equal(npaModeAllows("all", true), true);
  assert.equal(npaModeAllows("all", false), true);
});

test("the third click lists NPA accounts alone", () => {
  assert.equal(npaModeAllows("only", true), true);
  assert.equal(npaModeAllows("only", false), false);
});
