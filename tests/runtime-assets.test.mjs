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

function executeWorkerContract(workerSource, overrides = {}) {
  const listeners = new Map();
  const sandbox = {
    URL,
    console,
    fetch: overrides.fetch || fetch,
    importScripts() {},
    firebase: {
      initializeApp() {},
      messaging() { return { onBackgroundMessage() {} }; },
    },
    self: {
      addEventListener(type, listener) { listeners.set(type, listener); },
      registration: { showNotification() {} },
      skipWaiting: overrides.skipWaiting || (() => {}),
      clients: overrides.clients || { claim() {} },
    },
    caches: overrides.caches || {},
  };
  vm.runInNewContext(
    `${workerSource}\nself.__assetContract = { cache: CACHE, assets: ASSETS };`,
    sandbox,
  );
  return { ...sandbox.self.__assetContract, listeners };
}

test("the served shell and worker use stable asset URLs", async () => {
  const index = await (await fetchOk("/index.html")).text();
  const workerSource = await (await fetchOk("/sw.js")).text();
  const { cache, assets } = executeWorkerContract(workerSource);
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
  const { assets } = executeWorkerContract(workerSource);
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
  const { assets } = executeWorkerContract(workerSource);
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

test("install-time precache failures reject the worker lifetime", async () => {
  const workerSource = await (await fetchOk("/sw.js")).text();
  const precacheError = new Error("asset unavailable");
  const caches = {
    async open() {
      return { async addAll() { throw precacheError; } };
    },
  };
  const { listeners } = executeWorkerContract(workerSource, { caches });
  let lifetime;

  listeners.get("install")({ waitUntil(promise) { lifetime = promise; } });

  await assert.rejects(lifetime, precacheError);
});

test("activation waits for client claim and deletes only obsolete Nirnay caches", async () => {
  const workerSource = await (await fetchOk("/sw.js")).text();
  const deleted = [];
  const caches = {
    async keys() {
      return ["nirnay-v201", "nirnay-v202", "nirnay-v203", "third-party-cache"];
    },
    async delete(key) { deleted.push(key); },
  };
  let resolveClaim;
  const claimGate = new Promise(resolve => { resolveClaim = resolve; });
  const clients = { claim() { return claimGate; } };
  const { listeners } = executeWorkerContract(workerSource, { caches, clients });
  let lifetime;

  listeners.get("activate")({ waitUntil(promise) { lifetime = promise; } });

  const stateBeforeClaim = await Promise.race([
    lifetime.then(() => "settled"),
    new Promise(resolve => setTimeout(() => resolve("pending"), 20)),
  ]);
  assert.equal(stateBeforeClaim, "pending", "activation settled before clients.claim()");
  assert.deepEqual(deleted, ["nirnay-v201", "nirnay-v202"]);

  resolveClaim();
  await lifetime;
});

test("a cacheable runtime response waits for its cache write before settling", async () => {
  const workerSource = await (await fetchOk("/sw.js")).text();
  const request = { url: `${origin}/js/performance.js`, method: "GET" };
  const cachedResponse = { body: "cached report module" };
  const networkResponse = {
    status: 200,
    clone() { return cachedResponse; },
  };
  let resolvePut;
  const putGate = new Promise(resolve => { resolvePut = resolve; });
  const caches = {
    async open() {
      return {
        put(receivedRequest, receivedResponse) {
          assert.equal(receivedRequest, request);
          assert.equal(receivedResponse, cachedResponse);
          return putGate;
        },
      };
    },
    async match() { throw new Error("offline fallback should not run"); },
  };
  const { listeners } = executeWorkerContract(workerSource, {
    caches,
    fetch: async receivedRequest => {
      assert.equal(receivedRequest, request);
      return networkResponse;
    },
  });
  let responsePromise;

  listeners.get("fetch")({
    request,
    respondWith(promise) { responsePromise = promise; },
  });

  try {
    const stateBeforePut = await Promise.race([
      responsePromise.then(() => "settled"),
      new Promise(resolve => setTimeout(() => resolve("pending"), 20)),
    ]);
    assert.equal(stateBeforePut, "pending", "response settled before cache.put()");
  } finally {
    resolvePut();
  }

  assert.equal(await responsePromise, networkResponse);
});
