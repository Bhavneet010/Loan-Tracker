import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function getCreateLazyAction() {
  const source = await readFile(new URL("../js/lazy-action.js", import.meta.url), "utf8");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const helper = await import(moduleUrl);
  assert.equal(
    typeof helper?.createLazyAction,
    "function",
    "js/lazy-action.js must export createLazyAction",
  );
  return helper.createLazyAction;
}

test("the first lazy call loads and invokes the registered action", async () => {
  const createLazyAction = await getCreateLazyAction();
  let registeredAction;
  let loadedPath;
  const received = [];
  const lazyAction = createLazyAction({
    name: "openReport",
    modulePath: "./report.js",
    loadModule: async path => {
      loadedPath = path;
      registeredAction = (...args) => {
        received.push(...args);
        return "opened";
      };
    },
    getAction: () => registeredAction,
    onError() {},
  });

  const result = await lazyAction("daily", 7);

  assert.equal(loadedPath, "./report.js");
  assert.deepEqual(received, ["daily", 7]);
  assert.equal(result, "opened");
});

test("the pre-load hook runs synchronously while arguments and results still forward", async () => {
  const createLazyAction = await getCreateLazyAction();
  let resolveLoad;
  const loadGate = new Promise(resolve => { resolveLoad = resolve; });
  let registeredAction;
  let stopped = false;
  let forwardedArgs;
  const event = { stopPropagation() { stopped = true; } };
  const lazyAction = createLazyAction({
    name: "toggleCalExportMenu",
    modulePath: "./export-excel.js",
    loadModule: () => loadGate,
    getAction: () => registeredAction,
    beforeLoad: receivedEvent => receivedEvent?.stopPropagation(),
    onError() {},
  });

  const resultPromise = lazyAction(event, "renewals");

  assert.equal(stopped, true, "the click must stop before module loading settles");
  registeredAction = (...args) => {
    forwardedArgs = args;
    return "menu-opened";
  };
  resolveLoad();

  assert.equal(await resultPromise, "menu-opened");
  assert.deepEqual(forwardedArgs, [event, "renewals"]);
});

test("missing and recursive registrations are rejected", async () => {
  const createLazyAction = await getCreateLazyAction();

  for (const mode of ["missing", "recursive"]) {
    let registeredAction;
    let reportedError;
    const lazyAction = createLazyAction({
      name: "openReport",
      modulePath: "./report.js",
      loadModule: async () => {},
      getAction: () => registeredAction,
      onError: error => { reportedError = error; },
    });
    if (mode === "recursive") registeredAction = lazyAction;

    assert.equal(await lazyAction(), undefined, mode);
    assert.match(reportedError?.message || "", /did not register window\.openReport/, mode);
  }
});

test("load failures are reported through the error callback", async () => {
  const createLazyAction = await getCreateLazyAction();
  const loadError = new Error("chunk unavailable");
  let reportedError;
  const lazyAction = createLazyAction({
    name: "openReport",
    modulePath: "./report.js",
    loadModule: async () => { throw loadError; },
    getAction: () => undefined,
    onError: error => { reportedError = error; },
  });

  assert.equal(await lazyAction(), undefined);
  assert.equal(reportedError, loadError);
});
