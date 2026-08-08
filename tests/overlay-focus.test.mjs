import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function focusable(name, document) {
  return {
    name,
    isConnected: true,
    focusCount: 0,
    focus() {
      this.focusCount += 1;
      document.activeElement = this;
    },
  };
}

test("reopening an open overlay preserves its first focus-return target", async () => {
  const attributes = new Map([["aria-hidden", "true"]]);
  const classes = new Set();
  const overlay = {
    style: { display: "none" },
    classList: {
      add(...names) { names.forEach(name => classes.add(name)); },
      remove(...names) { names.forEach(name => classes.delete(name)); },
      contains(name) { return classes.has(name); },
    },
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, value); },
  };
  const document = {
    activeElement: null,
    getElementById(id) { return id === "formModal" ? overlay : null; },
  };
  const launcher = focusable("add loan", document);
  const nestedDialogButton = focusable("open existing loan", document);
  document.activeElement = launcher;

  const previousGlobals = {
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };
  globalThis.document = document;
  globalThis.requestAnimationFrame = callback => callback();

  try {
    const source = await readFile(new URL("../js/animate.js", import.meta.url), "utf8");
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${Date.now()}`;
    const { openOverlay, closeOverlay } = await import(moduleUrl);

    openOverlay("formModal");
    nestedDialogButton.focus();
    openOverlay("formModal");
    closeOverlay("formModal");

    await new Promise(resolve => setTimeout(resolve, 300));

    assert.equal(launcher.focusCount, 1, "the original launcher should regain focus");
    assert.equal(nestedDialogButton.focusCount, 1, "reopening must not replace the return target");
  } finally {
    globalThis.document = previousGlobals.document;
    globalThis.requestAnimationFrame = previousGlobals.requestAnimationFrame;
  }
});
