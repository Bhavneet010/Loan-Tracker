import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../js/script-loader.js", import.meta.url), "utf8");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const { createRetryableScriptLoader } = await import(moduleUrl);

function scriptHarness() {
  const scripts = [];
  const documentRef = {
    createElement() { return {}; },
    head: { appendChild(script) { scripts.push(script); } },
  };
  return { documentRef, scripts };
}

test("a failed script load can be retried with a fresh script element", async () => {
  const { documentRef, scripts } = scriptHarness();
  let ready = false;
  const ensureScript = createRetryableScriptLoader({
    documentRef,
    isReady: () => ready,
    src: "https://cdn.example/report.js",
    errorMessage: "Report library failed",
  });

  const firstAttempt = ensureScript();
  scripts[0].onerror();
  await assert.rejects(firstAttempt, /Report library failed/);

  const secondAttempt = ensureScript();
  assert.equal(scripts.length, 2);
  ready = true;
  scripts[1].onload();
  await secondAttempt;
});

test("concurrent callers share one in-flight script load", async () => {
  const { documentRef, scripts } = scriptHarness();
  let ready = false;
  const ensureScript = createRetryableScriptLoader({
    documentRef,
    isReady: () => ready,
    src: "https://cdn.example/report.js",
    errorMessage: "Report library failed",
  });

  const firstCaller = ensureScript();
  const secondCaller = ensureScript();
  assert.equal(firstCaller, secondCaller);
  assert.equal(scripts.length, 1);

  ready = true;
  scripts[0].onload();
  await Promise.all([firstCaller, secondCaller]);
});
