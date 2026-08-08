import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const helperSource = await readFile(
  new URL("../js/fresh-group-state.js", import.meta.url),
  "utf8",
);
const helperModule = await import(
  `data:text/javascript;base64,${Buffer.from(helperSource).toString("base64")}`
);
const {
  effectiveFreshGroupCollapsed,
  nextFreshGroupCollapsed,
} = helperModule;

test("an administrator group uses the collapsed default until overridden", () => {
  assert.equal(effectiveFreshGroupCollapsed(undefined, true), true);
  assert.equal(effectiveFreshGroupCollapsed(false, true), false);
});

test("the first click inverts the effective administrator default", () => {
  assert.equal(nextFreshGroupCollapsed(undefined, true), false);
});

test("the first click inverts the effective officer default", () => {
  assert.equal(nextFreshGroupCollapsed(undefined, false), true);
});

test("subsequent clicks alternate the stored override", () => {
  let stored = nextFreshGroupCollapsed(undefined, true);
  assert.equal(stored, false);
  stored = nextFreshGroupCollapsed(stored, true);
  assert.equal(stored, true);
  stored = nextFreshGroupCollapsed(stored, true);
  assert.equal(stored, false);
});
