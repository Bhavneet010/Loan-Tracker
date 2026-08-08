import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";
import vm from "node:vm";

const port = 43000 + (process.pid % 1000);
const origin = `http://127.0.0.1:${port}`;
const root = new URL("../", import.meta.url);
let server;

before(async () => {
  server = spawn(process.execPath, ["dev-server.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${origin}/index.html`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("dev-server.js did not become ready");
});

after(() => server?.kill());

async function fetchOk(reference, base = `${origin}/index.html`) {
  const url = new URL(reference, base);
  const response = await fetch(url);
  assert.equal(response.ok, true, `${url.pathname} returned ${response.status}`);
  return response;
}

function executeWorkerAssetContract(workerSource) {
  const sandbox = {
    URL,
    console,
    fetch,
    importScripts() {},
    firebase: {
      initializeApp() {},
      messaging() { return { onBackgroundMessage() {} }; },
    },
    self: {
      addEventListener() {},
      registration: { showNotification() {} },
      skipWaiting() {},
      clients: { claim() {} },
    },
    caches: {},
  };
  vm.runInNewContext(
    `${workerSource}\nself.__assetContract = { cache: CACHE, assets: ASSETS };`,
    sandbox,
  );
  return sandbox.self.__assetContract;
}

test("the served shell and worker use stable asset URLs", async () => {
  const index = await (await fetchOk("/index.html")).text();
  const workerSource = await (await fetchOk("/sw.js")).text();
  const { cache, assets } = executeWorkerAssetContract(workerSource);
  const pageAssets = [...index.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map(match => match[1])
    .filter(reference => new URL(reference, origin).origin === origin);

  assert.match(cache, /^nirnay-v\d+$/);
  for (const reference of [...pageAssets, ...assets]) {
    assert.doesNotMatch(reference, /[?&](?:v|t)=/, `${reference} bypasses the stable cache key`);
  }
});

test("every served shell and precache asset returns successfully", async () => {
  const index = await (await fetchOk("/index.html")).text();
  const workerSource = await (await fetchOk("/sw.js")).text();
  const manifest = await (await fetchOk("/manifest.json")).json();
  const { assets } = executeWorkerAssetContract(workerSource);
  const pageAssets = [...index.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map(match => match[1])
    .filter(reference => new URL(reference, origin).origin === origin);

  for (const reference of [...new Set([...pageAssets, ...assets])]) {
    await fetchOk(reference);
  }
  for (const icon of manifest.icons || []) {
    await fetchOk(icon.src, `${origin}/manifest.json`);
  }
});

test("report-only resources are deferred from install-time precaching", async () => {
  const workerSource = await (await fetchOk("/sw.js")).text();
  const { assets } = executeWorkerAssetContract(workerSource);
  for (const deferredAsset of [
    "./assets/snapshot/top-performer-bg.png",
    "./assets/sme/sbi-logo.svg",
    "./js/export-excel.js",
    "./js/month-end.js",
    "./js/performance.js",
    "./js/performance-utils.js",
    "./js/performance-pdf.js",
    "./js/performance-snapshot.js",
    "./js/sme-daily-report.js",
  ]) {
    assert.equal(assets.includes(deferredAsset), false, deferredAsset);
  }
});
