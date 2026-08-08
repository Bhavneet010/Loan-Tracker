# Nirnay Stabilization and Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove confirmed stale and redundant code, correct the reproduced Fresh Loans and PWA defects, and improve essential accessibility without changing stored loan data or invoking live administrative operations.

**Architecture:** Keep the browser-native ES-module PWA and its current UI/state/Firestore boundaries. Add a dependency-free Node test harness, isolate the collapse-state rule in one pure helper, register heavy report actions through a stable lazy-action boundary, and make the page and service worker use the same stable asset URLs.

**Tech Stack:** HTML5, CSS, browser ES modules, service workers, Firebase Web SDK 11.0.2, Node.js standard test runner, PowerShell verification commands.

## Global Constraints

- Do not change Firestore collections, document schemas, or stored customer records.
- Do not execute any import, notification send, cleanup, wipe, migration, or other administrative write against the live Firebase project.
- Preserve `data/monthly-snapshot-2026-06.json` and the generic CSV import workflow.
- Do not introduce a framework, bundler, runtime dependency, or Firebase SDK major-version upgrade.
- Keep existing feature boundaries and global event entry points unless the entry point is proven unused across HTML, JavaScript, and runtime-generated markup.
- Use stable local asset URLs without timestamp or version query parameters.
- Stage and commit only files from the task being completed. Do not stage, restore, or modify the user's existing `mockups/` deletions.
- Run each failing test before its implementation change, then rerun it after the minimal change.

---

## File Map

### New files

- `package.json` — exposes the dependency-free `npm test` command.
- `js/fresh-group-state.js` — owns effective and next collapsed-state calculations.
- `js/lazy-actions.js` — registers stable lazy entry points for month-end and spreadsheet modules.
- `tests/fresh-group-state.test.mjs` — regression tests for first-click and repeated collapse transitions.
- `tests/runtime-assets.test.mjs` — executes the local server and service worker manifest to validate stable, loadable application assets.

### Modified files

- `js/ui-render.js` and `js/ui-tabs-loans.js` — consume the shared collapse-state helper.
- `js/importers.js` and `js/ui-settings.js` — remove the fixed April recovery flow while retaining CSV and operational admin actions.
- `js/app.js`, `js/ui-core.js`, `js/lazy-actions.js`, `index.html`, and `sw.js` — establish stable lazy loading and consistent offline asset caching.
- `js/animate.js`, `js/ui-forms.js`, `js/ui-core.js`, `index.html`, `css/core.css`, and `css/forms.css` — add accessible semantics, focus restoration, and usable touch targets.
- `js/bank-holidays.js`, `js/officer-availability.js`, `js/ui-reminder-mail.js`, `js/ui-calendar.js`, `js/loan-actions.js`, `js/month-end.js`, `js/performance-snapshot.js`, `js/performance-pdf.js`, `js/performance-utils.js`, `js/performance.js`, `js/ui-components.js`, and `js/ui-settings.js` — remove confirmed dead definitions and unused bindings.
- `README.md` — document the actual structure and verification workflow.

### Deleted files

- `data/pending-2026-04.json`
- `data/returns-2026-04.json`
- `data/sanctioned-2026-04.json`
- `css/base.css`
- `css/theme.css`
- `css/layout.css`
- `css/components.css`

---

### Task 1: Add the regression harness and fix Fresh Loans group toggling

**Files:**

- Create: `package.json`
- Create: `tests/fresh-group-state.test.mjs`
- Create: `js/fresh-group-state.js`
- Modify: `js/ui-render.js:1-10,120-123`
- Modify: `js/ui-tabs-loans.js:1-6,48-54`

**Interfaces:**

- Produces: `effectiveFreshGroupCollapsed(stored: unknown, defaultCollapsed: boolean): boolean`
- Produces: `nextFreshGroupCollapsed(stored: unknown, defaultCollapsed: boolean): boolean`
- Consumes: `S.isAdmin` as the existing role-based default and `S.freshGroupCollapsed[key]` as the optional override.

- [ ] **Step 1: Add the Node test command and the failing state regression test**

Create `package.json`:

```json
{
  "name": "nirnay-loan-tracker",
  "private": true,
  "scripts": {
    "test": "node --test"
  }
}
```

Create `tests/fresh-group-state.test.mjs` before creating the helper:

```js
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
```

- [ ] **Step 2: Run the regression test and verify that it fails for the missing helper**

Run:

```powershell
npm test -- tests/fresh-group-state.test.mjs
```

Expected: FAIL with `ENOENT` for `js/fresh-group-state.js`.

- [ ] **Step 3: Implement the pure collapsed-state helper**

Create `js/fresh-group-state.js`:

```js
export function effectiveFreshGroupCollapsed(stored, defaultCollapsed) {
  return stored === undefined ? Boolean(defaultCollapsed) : Boolean(stored);
}

export function nextFreshGroupCollapsed(stored, defaultCollapsed) {
  return !effectiveFreshGroupCollapsed(stored, defaultCollapsed);
}
```

- [ ] **Step 4: Use the helper for both rendering and toggling**

Add this import to `js/ui-tabs-loans.js`:

```js
import { effectiveFreshGroupCollapsed } from "./fresh-group-state.js";
```

Replace the current `stored !== undefined` calculation with:

```js
const stored = S.freshGroupCollapsed?.[key];
const collapsed = effectiveFreshGroupCollapsed(stored, S.isAdmin);
```

Add this import to `js/ui-render.js`:

```js
import { nextFreshGroupCollapsed } from "./fresh-group-state.js";
```

Replace `window.toggleFreshGroup` with:

```js
window.toggleFreshGroup = function(key) {
  const stored = S.freshGroupCollapsed?.[key];
  S.freshGroupCollapsed = {
    ...(S.freshGroupCollapsed || {}),
    [key]: nextFreshGroupCollapsed(stored, S.isAdmin),
  };
  render();
};
```

- [ ] **Step 5: Run the focused and complete tests**

Run:

```powershell
npm test -- tests/fresh-group-state.test.mjs
npm test
node --check js/fresh-group-state.js
node --check js/ui-render.js
node --check js/ui-tabs-loans.js
```

Expected: all commands PASS.

- [ ] **Step 6: Commit the isolated regression fix**

```powershell
git add -- package.json tests/fresh-group-state.test.mjs js/fresh-group-state.js js/ui-render.js js/ui-tabs-loans.js
git diff --cached --check
git commit -m "fix: toggle fresh loan groups on first click"
```

---

### Task 2: Remove the stale April 2026 recovery flow

**Files:**

- Modify: `js/importers.js:1-56,265-309`
- Modify: `js/ui-settings.js:112-120`
- Delete: `data/pending-2026-04.json`
- Delete: `data/returns-2026-04.json`
- Delete: `data/sanctioned-2026-04.json`

**Interfaces:**

- Preserves: `window.triggerCsvUpload()` and `window.handleCsvUpload(event)`.
- Preserves: `window.clearAllSmeRenewals()` and `window.wipeSanctionedFreshLoans()` without invoking them.
- Removes: `importReturnsFromUrl()`, `window.importMonthlyReturns()`, `importSanctionedFromUrl()`, and `window.importMonthlySanctioned()`.

- [ ] **Step 1: Record the approved deletion boundary before editing**

Run this read-only inventory:

```powershell
rg -n "importReturnsFromUrl|importMonthlyReturns|importSanctionedFromUrl|importMonthlySanctioned|pending-2026-04|returns-2026-04|sanctioned-2026-04|Import April 2026|triggerCsvUpload|handleCsvUpload|monthly-snapshot-2026-06" index.html js data sw.js
```

Expected: the fixed April handlers and files are present, while the generic CSV functions and June snapshot are independently identifiable. This is cleanup evidence, not a permanent source-text regression test.

- [ ] **Step 2: Remove the dedicated April import code and controls**

In `js/importers.js`, delete these complete definitions:

```text
importReturnsFromUrl
window.importMonthlyReturns
importSanctionedFromUrl
window.importMonthlySanctioned
```

Keep the CSV, clear-renewals, and wipe-sanctioned-fresh definitions unchanged. Remove `todayStr` from the `./utils.js` import after confirming its only use disappeared; retain `slugifyId` because the CSV importer uses it.

In the `S.settingsTab === 'import'` markup in `js/ui-settings.js`, replace the introductory copy and button block with:

```js
el.innerHTML = `<div style="padding:4px 2px 12px;font-size:13px;color:#7B7A9A;">Bulk-import loan data from a CSV file.</div>
  <button type="button" id="clearRenewalsBtn" class="btn btn-primary-full" style="width:100%;margin-bottom:10px;background:linear-gradient(135deg,#EF4444,#B91C1C);" onclick="clearAllSmeRenewals()">&#128465; Clear All SME Renewals</button>
  <button type="button" id="wipeFreshBtn" class="btn btn-primary-full" style="width:100%;margin-bottom:10px;background:linear-gradient(135deg,#DC2626,#991B1B);" onclick="wipeSanctionedFreshLoans()">&#128465; Wipe All Sanctioned Fresh</button>
  <input type="file" id="csvFileInput" accept=".csv,text/csv" style="display:none;" onchange="handleCsvUpload(event)">
  <button type="button" id="importCsvBtn" class="btn btn-primary-full" style="width:100%;background:linear-gradient(135deg,#3B82F6,#2563EB);" onclick="triggerCsvUpload()">&#128229; Upload CSV</button>`;
```

- [ ] **Step 3: Delete only the three approved April data files**

Use `apply_patch` to delete:

```text
data/pending-2026-04.json
data/returns-2026-04.json
data/sanctioned-2026-04.json
```

Do not delete `data/monthly-snapshot-2026-06.json`.

- [ ] **Step 4: Run syntax checks, the existing behavior suite, and the final reference scan**

```powershell
rg -n "importReturnsFromUrl|importMonthlyReturns|importSanctionedFromUrl|importMonthlySanctioned|pending-2026-04|returns-2026-04|sanctioned-2026-04|Import April 2026" index.html js data sw.js
node --check js/importers.js
node --check js/ui-settings.js
npm test
```

Expected: `rg` returns no matches, syntax checks pass, and the existing behavior suite passes. Confirm separately that `window.triggerCsvUpload`, `window.handleCsvUpload`, and `data/monthly-snapshot-2026-06.json` still exist.

- [ ] **Step 5: Commit the approved recovery cleanup**

```powershell
git add -- js/importers.js js/ui-settings.js data/pending-2026-04.json data/returns-2026-04.json data/sanctioned-2026-04.json
git diff --cached --check
git commit -m "refactor: remove stale April recovery imports"
```

---

### Task 3: Remove confirmed dead definitions, stylesheets, and import bindings

**Files:**

- Modify: `js/app.js`, `js/importers.js`, `js/loan-actions.js`, `js/ui-components.js`, `js/ui-forms.js`, `js/ui-settings.js`, `js/performance-utils.js`, `js/performance-pdf.js`, `js/performance-snapshot.js`, `js/performance.js`
- Modify: `js/bank-holidays.js`, `js/officer-availability.js`, `js/ui-reminder-mail.js`, `js/ui-calendar.js`, `js/ui-render.js`, `js/month-end.js`
- Delete: `css/base.css`, `css/theme.css`, `css/layout.css`, `css/components.css`

**Interfaces:**

- Removes only the 13 definitions listed in the test below.
- Preserves every remaining `window.*` action and every CSS file referenced by `index.html` or `sw.js`.
- Preserves runtime behavior while reducing definitions and bindings already proven unreachable by the audit.

- [ ] **Step 1: Reconfirm the 13 definitions have no callers**

Run `rg -n "SYMBOL_NAME" index.html js` for every name below. Expected: only the definition itself. If an unexpected caller appears, stop this task and report the exact caller instead of deleting the definition.

- [ ] **Step 2: Remove the 13 exact dead definitions**

Delete each complete definition, including its assignment terminator where applicable:

```text
js/bank-holidays.js: countWorkingDaysInMonth
js/officer-availability.js: expandAvailabilityDates
js/ui-reminder-mail.js: lastReminderMail
js/ui-calendar.js: renderCalendar
js/loan-actions.js: window.moveToPending, applyLoanStatus, applyRenewalStatus
js/month-end.js: buildOfficerPage, totalsLine
js/performance-snapshot.js: renderWeeklyOfficerStrip
js/ui-render.js: applyCalMbarKey, window.setTaskCategory
js/ui-core.js: window.toggleDark
```

- [ ] **Step 3: Replace named imports with their exact used bindings**

Use these import clauses; remove any clause whose right-hand side is empty:

```js
// js/app.js
// Delete: import { initPushNotifications } from "./push-notifications.js";

// js/importers.js
import { S } from "./state.js";
// Delete the named import from "./ui-settings.js".

// js/loan-actions.js
import { todayStr, showUndoToast, toast, isFreshCC, appConfirm } from "./utils.js";
import {
  getBranchSearchInput,
  getBranchValueInput,
  getCategorySelect,
  getLoanTypeValue,
  normalizeName,
  saveRecentBranch,
  updateCategoryHint,
  matchBranchOption,
  assignedOfficerForBranch,
  fillFormFromLoan,
  confirmPotentialDuplicate,
} from "./ui-forms.js";
// Delete the named import from "./animate.js".

// js/ui-components.js
// Remove computeRenewalStatus from the existing "./utils.js" clause.

// js/ui-forms.js
import { S } from "./state.js";
import { todayStr, esc, branchCode, fmtAmt, fmtDate, catCls, isFreshCC } from "./utils.js";
import { openOverlay, closeOverlay } from "./animate.js";
import { effectiveOfficer } from "./derived.js";
// Delete the named imports from "./db.js", "./notifications.js", "./config.js",
// and the Firebase Firestore CDN.

// js/ui-settings.js
// Delete the named import from "./push-notifications.js".

// js/performance-utils.js
import { sumAmount, effectiveOfficer } from "./derived.js";
import { esc, fmtAmt, fmtDate, shortCat } from "./utils.js";

// js/performance-pdf.js
import { S } from "./state.js";
import { getLoanMetrics, sumAmount, effectiveOfficer } from "./derived.js";
import { esc, fmtAmt, fmtDate } from "./utils.js";
import {
  totalMetric,
  metricHtml,
  officerPdfData,
  freshLoanLine,
  renewalLoanLine,
  compactBranch,
  pdfSection,
  PDF_PAGE_WIDTH,
  PDF_PAGE_HEIGHT,
} from "./performance-utils.js";

// js/performance-snapshot.js
import { S } from "./state.js";
import { getLoanMetrics, sumAmount, effectiveOfficer } from "./derived.js";
import { catCls, esc, fmtAmt, fmtShortDate, isFreshCC, shortCat } from "./utils.js";
import { metricHtml, CATS, amountOf } from "./performance-utils.js";
// Delete the named import from "./performance-pdf.js".

// js/performance.js
import { db } from "./config.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { S, saveSettings } from "./state.js";
import { esc, toast } from "./utils.js";
import { PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT } from "./performance-utils.js";
import { buildDetailedSnapshotPdfHtml } from "./performance-pdf.js";
import {
  ensureHtml2Canvas,
  ensureJsPdf,
  ensureImageLoaded,
  renderDailyPerformanceView,
  renderWeeklyPerformanceView,
  renderMonthlyPerformanceView,
  SNAPSHOT_BG_ASSETS,
} from "./performance-snapshot.js";
// Delete the named import from "./derived.js".
```

- [ ] **Step 4: Delete the four CSS files after a final reference check**

Run:

```powershell
rg -n "css/(base|theme|layout|components)\.css|@import.*(base|theme|layout|components)\.css" index.html sw.js css js
```

Expected: no references. Then use `apply_patch` to delete exactly:

```text
css/base.css
css/theme.css
css/layout.css
css/components.css
```

- [ ] **Step 5: Run the unused-binding audit, syntax checks, and full behavior suite**

```powershell
$unused = @()
Get-ChildItem js -Filter *.js | ForEach-Object {
  $fileName = $_.Name
  $raw = Get-Content -Raw $_.FullName
  $body = [regex]::Replace($raw, '(?ms)^\s*import\s*\{.*?\}\s*from\s*["''][^"'']+["''];?', '')
  [regex]::Matches($raw, '(?ms)^\s*import\s*\{(?<names>.*?)\}\s*from\s*["''][^"'']+["''];?') | ForEach-Object {
    foreach ($binding in ($_.Groups['names'].Value -split ',')) {
      $local = (($binding.Trim() -split '\s+as\s+')[-1]).Trim()
      if ($local -match '^[A-Za-z_$][\w$]*$' -and -not [regex]::IsMatch($body, "(?<![A-Za-z0-9_$])$([regex]::Escape($local))(?![A-Za-z0-9_$])")) {
        $unused += "${fileName}:$local"
      }
    }
  }
}
if ($unused.Count) { $unused; exit 1 }
$syntaxFailed = $false; Get-ChildItem js -Filter *.js | ForEach-Object { node --check $_.FullName; if ($LASTEXITCODE -ne 0) { $syntaxFailed = $true } }; if ($syntaxFailed) { exit 1 }
npm test
```

Expected: the one-time audit reports no unused named imports, all syntax checks pass, and the behavior suite passes. This audit remains execution evidence rather than a permanent source-text test.

- [ ] **Step 6: Commit the conservative redundancy cleanup**

```powershell
git add -- js/app.js js/importers.js js/loan-actions.js js/ui-components.js js/ui-forms.js js/ui-settings.js js/performance-utils.js js/performance-pdf.js js/performance-snapshot.js js/performance.js js/bank-holidays.js js/officer-availability.js js/ui-reminder-mail.js js/ui-calendar.js js/ui-render.js js/month-end.js js/ui-core.js css/base.css css/theme.css css/layout.css css/components.css
git diff --cached --check
git commit -m "refactor: remove confirmed dead code and styles"
```

---

### Task 4: Stabilize PWA caching and defer heavy report modules

**Files:**

- Create: `tests/runtime-assets.test.mjs`
- Create: `js/lazy-actions.js`
- Modify: `js/app.js:9-18`
- Modify: `js/ui-core.js:150-157`
- Modify: `index.html:18-31,432-434`
- Modify: `sw.js:25-117`

**Interfaces:**

- Produces: lazy `window.*` functions with the same names and arguments as the loaded modules.
- Loads: `./month-end.js` for month-end actions and `./export-excel.js` for spreadsheet/calendar-export actions.
- Preserves: `window.showPerfOverlay()` and all existing inline HTML handlers.
- Changes: local application asset URLs become stable paths without `?v=` or `?t=` parameters.

- [ ] **Step 1: Write a failing runtime asset test**

Create `tests/runtime-assets.test.mjs`. It must start the real `dev-server.js`, execute `sw.js` in a controlled VM sandbox to obtain its runtime asset contract, fetch the served page/manifest/assets over HTTP, and assert user-visible loading properties rather than grepping repository files:

```js
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
```

- [ ] **Step 2: Run the runtime asset test and verify the expected failures**

```powershell
npm test -- tests/runtime-assets.test.mjs
```

Expected: FAIL because served URLs contain query-based cache busting and report-only resources remain in the install-time manifest.

- [ ] **Step 3: Add stable lazy entry points for report-only modules**

Create `js/lazy-actions.js`:

```js
import { toast } from "./utils.js";

function registerLazyAction(name, modulePath, failureLabel) {
  const lazyAction = async (...args) => {
    try {
      await import(modulePath);
      const loadedAction = window[name];
      if (typeof loadedAction !== "function" || loadedAction === lazyAction) {
        throw new Error(`${modulePath} did not register window.${name}`);
      }
      return await loadedAction(...args);
    } catch (error) {
      console.error(`[LazyAction] ${name} failed`, error);
      toast(`Could not load ${failureLabel}`);
      return undefined;
    }
  };
  window[name] = lazyAction;
}

for (const name of [
  "overrideSnapshotLock",
  "runMonthEndSnapshot",
  "runMonthEndCleanup",
  "renderMonthEndSettings",
  "toggleMeHistCard",
  "toggleMeHistEdit",
  "deleteMonthSnapshot",
]) {
  registerLazyAction(name, "./month-end.js", "month-end tools");
}

for (const name of [
  "exportLoansExcel",
  "toggleCalExportMenu",
  "closeCalExportMenu",
  "exportCalendarRenewalsExcel",
  "exportCalendarRenewalsPdf",
]) {
  registerLazyAction(name, "./export-excel.js", "export tools");
}
```

In `js/app.js`, replace the static imports of `month-end.js` and `export-excel.js` with:

```js
import "./lazy-actions.js";
```

- [ ] **Step 4: Use a stable Performance import with visible failure handling**

Replace `window.showPerfOverlay` in `js/ui-core.js` with:

```js
window.showPerfOverlay = async function () {
  openOverlay('perfOverlay', 'block');
  document.body.style.overflow = 'hidden';
  const target = document.getElementById('perfOverlayContent');
  if (target) target.innerHTML = '<div class="skeleton-wrap"><div class="skeleton-row"><div class="skel-circle"></div><div class="skel-bar skel-bar--md"></div><div class="skel-bar skel-bar--lg skel-bar--right"></div></div><div class="skeleton-row"><div class="skel-circle"></div><div class="skel-bar skel-bar--md"></div><div class="skel-bar skel-bar--lg skel-bar--right"></div></div><div class="skeleton-row"><div class="skel-circle"></div><div class="skel-bar skel-bar--md"></div><div class="skel-bar skel-bar--lg skel-bar--right"></div></div></div>';
  try {
    await import('./performance.js');
    if (typeof window.showDailySnapshot !== 'function') {
      throw new Error('Performance module did not register showDailySnapshot');
    }
    window.showDailySnapshot();
  } catch (error) {
    console.error('[Performance] Failed to load', error);
    if (target) {
      target.innerHTML = '<div class="empty-state" style="padding:32px 20px;">Could not load Performance.<br><button class="btn btn-primary-full" style="margin-top:12px;" onclick="showPerfOverlay()">Retry</button></div>';
    }
    toast('Could not load Performance');
  }
};
```

- [ ] **Step 5: Make page and worker asset URLs identical and stable**

In `index.html`, remove the query suffixes from all local CSS links and change the module entry point to:

```html
<script type="module" src="js/app.js"></script>
```

In `sw.js`:

1. Change the cache name to `nirnay-v203`.
2. Remove all `?v=` suffixes from `ASSETS`.
3. Add `'./js/lazy-actions.js'` and `'./js/fresh-group-state.js'` to `ASSETS`.
4. Remove these report-only resources from the install-time `ASSETS` list so the service worker's existing runtime fetch handler caches them only after their feature is opened:

```text
./assets/snapshot/top-performer-bg.png
./assets/sme/sbi-logo.svg
./js/export-excel.js
./js/month-end.js
./js/performance.js
./js/performance-utils.js
./js/performance-pdf.js
./js/performance-snapshot.js
./js/sme-daily-report.js
```

5. Replace the install listener with:

```js
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});
```

6. Replace the activate listener with:

```js
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(key => key.startsWith('nirnay-v') && key !== CACHE)
        .map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});
```

Do not change the Firebase background-messaging setup or the network-first fetch strategy in this pass.

- [ ] **Step 6: Run static-asset, syntax, and complete tests**

```powershell
npm test -- tests/runtime-assets.test.mjs
node --check js/lazy-actions.js
node --check js/app.js
node --check js/ui-core.js
node --check sw.js
npm test
```

Expected: all commands PASS.

- [ ] **Step 7: Commit the PWA and lazy-loading boundary**

```powershell
git add -- tests/runtime-assets.test.mjs js/lazy-actions.js js/app.js js/ui-core.js index.html sw.js
git diff --cached --check
git commit -m "fix: stabilize PWA assets and lazy report loading"
```

---

### Task 5: Add essential keyboard, dialog, and form accessibility

**Files:**

- Modify: `index.html:5,67-98,208-209,239-344`
- Modify: `js/animate.js:1-35`
- Modify: `js/ui-forms.js:497-509,532-534`
- Modify: `js/ui-core.js:114-138`
- Modify: `css/core.css:97-145,912-938`
- Modify: `css/forms.css:8-10`
- Modify: `css/neo-brutalist.css:528`
- Modify: `css/sketchnote.css:691`

**Interfaces:**

- `openOverlay(id, displayMode)` stores the previously focused element and sets `aria-hidden="false"`.
- `closeOverlay(id, callback)` sets `aria-hidden="true"` and restores focus after the close animation.
- `window.toggleUserMenu()` keeps `aria-expanded` synchronized with the dropdown's visibility.

- [ ] **Step 1: Record the failing browser accessibility behavior before editing**

Start `node dev-server.js` and inspect `http://127.0.0.1:4175` using the browser accessibility tree and keyboard only. Record these expected RED observations in the task report:

1. Tab cannot reach the Tasks brand, Notifications, Task List, Performance, or user control because they are clickable `div` elements.
2. The Add Loan overlay is not exposed as a named modal dialog.
3. Allocated To, Branch, Customer Name, Amount, date fields, and Remarks do not have programmatically associated labels.
4. The viewport metadata disables user scaling.

Do not save a loan or invoke any administrative action while recording this baseline.

- [ ] **Step 2: Convert the primary header actions to named native buttons**

In `index.html`:

- Remove `user-scalable=no` from the viewport meta content.
- Change the `.brand` wrapper to `button type="button"` with `aria-label="Open today's tasks"`.
- Change the notification, task-list, and Performance `.hbtn` elements to `button type="button"` with `aria-label="Notifications"`, `aria-label="Task List"`, and `aria-label="Performance"` respectively.
- Add `performance-hbtn` to the Performance button's class list.
- Change `.user-pill` to `button type="button"` with `aria-label="Open user menu"`, `aria-haspopup="menu"`, and `aria-expanded="false"`.
- Add `role="menu"` to `#userMenu`.
- Add `aria-label="Add loan"` to `#mainFab`.

The resulting header action skeleton must be:

```html
<button type="button" class="brand" onclick="toggleTasksMode()" aria-label="Open today's tasks" title="Today's Tasks">
  <!-- existing brand contents -->
</button>
<div class="header-right">
  <button type="button" class="hbtn notif-hbtn" onclick="showNotifOverlay()" aria-label="Notifications" title="Notifications"><!-- existing contents --></button>
  <button type="button" class="hbtn tasklist-hbtn" onclick="showTaskListOverlay()" aria-label="Task List" title="Task List"><!-- existing contents --></button>
  <button type="button" class="hbtn performance-hbtn" onclick="showPerfOverlay()" aria-label="Performance" title="Performance"><!-- existing contents --></button>
  <div class="user-pill-wrap">
    <button type="button" class="user-pill" onclick="toggleUserMenu()" aria-label="Open user menu" aria-haspopup="menu" aria-expanded="false"><!-- existing contents --></button>
    <div id="userMenu" class="user-dropdown" role="menu" style="display:none;"></div>
  </div>
</div>
```

- [ ] **Step 3: Add modal semantics and explicit form-label relationships**

Change the form overlay opening tag to:

```html
<div class="overlay" id="formModal" role="dialog" aria-modal="true" aria-labelledby="formTitle" aria-hidden="true" style="display:none;">
```

Add exact `for` attributes to the existing labels:

```text
Allocated To -> fOfficer
Branch -> fBranchSearch
Customer Name -> fName
Amount (in Lakhs) -> fAmount
Receive Date -> fReceive
Sanction Date -> fSanction
Renewal Due Date -> fRenewalDue
Limit Expiry Date -> fLimitExpiry
Documentation Date -> fDocumentation
Disbursement Date -> fDisbursement
Remarks -> fRemarks
```

Replace the Category label and chip opening tag with:

```html
<span class="form-label" id="categoryLabel">Category *</span>
<div id="categoryChips" class="category-chips" role="group" aria-labelledby="categoryLabel"></div>
```

Give the Loan Facility label `id="loanTypeLabel"`, replace its outer `label` element with a `span class="form-label"`, and add `role="radiogroup" aria-labelledby="loanTypeLabel"` to `.loan-type-options`.

- [ ] **Step 4: Restore focus when overlays close and synchronize the user menu state**

At the top of `js/animate.js`, add:

```js
const overlayReturnFocus = new WeakMap();
```

Inside `openOverlay`, before changing display, add:

```js
const active = document.activeElement;
if (active && typeof active.focus === 'function') {
  overlayReturnFocus.set(el, active);
}
el.setAttribute('aria-hidden', 'false');
```

Inside the close timeout, immediately after setting `display = 'none'`, add:

```js
el.setAttribute('aria-hidden', 'true');
const returnFocus = overlayReturnFocus.get(el);
overlayReturnFocus.delete(el);
if (returnFocus?.isConnected) returnFocus.focus();
```

In `js/ui-forms.js`, move `openOverlay('formModal')` before the existing initial-focus branch. Wrap that focus branch in two animation frames so its target is visible before focus is applied:

```js
openOverlay('formModal');
requestAnimationFrame(() => requestAnimationFrame(() => {
  if (entryMode === 'quick' && !prefills) {
    document.getElementById('categoryChips')?.querySelector('button')?.focus();
  } else if (mode === 'renewal') {
    const renewalInput = document.getElementById('fRenewalDue');
    if (renewalInput) {
      renewalInput.focus();
      renewalInput.classList.add('form-highlight');
      setTimeout(() => renewalInput.classList.remove('form-highlight'), 2000);
    }
  } else {
    document.getElementById('fOfficer')?.focus();
  }
}));
```

In `js/ui-core.js`, add this helper and route open, close, and outside-click dismissal through it:

```js
function _setUserMenuOpen(open) {
  const menu = document.getElementById('userMenu');
  const trigger = document.querySelector('.user-pill');
  if (menu) menu.style.display = open ? 'block' : 'none';
  trigger?.setAttribute('aria-expanded', String(open));
}
```

Use `_setUserMenuOpen(true)` when opening, `_setUserMenuOpen(false)` when closing, and add `role="menuitem"` to each generated `.udrop-item` button.

- [ ] **Step 5: Preserve visual styling and enlarge interactive targets**

Update `css/core.css` with:

```css
.brand{
  min-height:44px;
  padding:0;
  border:0;
  background:transparent;
  color:inherit;
  font:inherit;
  text-align:left;
  cursor:pointer;
}
.hbtn{
  width:44px;
  height:44px;
  padding:0;
  color:inherit;
  font:inherit;
}
.user-pill{
  min-width:44px;
  min-height:44px;
  color:inherit;
  font:inherit;
}
.brand:focus-visible,
.hbtn:focus-visible,
.user-pill:focus-visible{
  outline:2px solid rgba(90,78,175,0.5);
  outline-offset:2px;
}
.mode-btn{min-height:44px;}
```

Update the form-label selector in `css/core.css`, `css/forms.css`, `css/neo-brutalist.css`, and `css/sketchnote.css` from `.form-group label` to `.form-group label, .form-group .form-label` so the Category and Loan Facility labels retain the existing appearance in every theme.

- [ ] **Step 6: Verify the corrected behavior in the browser and run automated checks**

```powershell
node --check js/animate.js
node --check js/ui-forms.js
node --check js/ui-core.js
npm test
```

Then repeat the browser check and record these GREEN observations:

1. Tab and Shift+Tab reach all five header actions, which have the intended accessible names; Enter and Space activate them.
2. Opening Add Loan moves focus into the visible form without submitting data.
3. The accessibility tree exposes a modal dialog named by `Add New Loan` and each primary field exposes its visible label.
4. Cancel closes the form and returns focus to the Add button.
5. The viewport permits zoom and the 44-pixel controls do not introduce horizontal page overflow at 390 × 844.

Expected: the browser observations are GREEN, syntax checks pass, and the behavior suite passes without warnings.

- [ ] **Step 7: Commit the accessibility improvements**

```powershell
git add -- index.html js/animate.js js/ui-forms.js js/ui-core.js css/core.css css/forms.css css/neo-brutalist.css css/sketchnote.css
git diff --cached --check
git commit -m "fix: improve primary navigation and form accessibility"
```

---

### Task 6: Update documentation and run full application verification

**Files:**

- Modify: `README.md`
- Verify: all task files from Tasks 1-5
- Preserve unstaged: `mockups/`

**Interfaces:**

- Documents: `npm test` and `node dev-server.js` as the supported local verification workflow.
- Documents: the modular CSS/JavaScript layout and the distinction between offline shell availability and Firestore connectivity.

- [ ] **Step 1: Replace the stale README with accurate repository guidance**

Use this content structure and wording:

````markdown
# Nirnay Loan Tracker PWA

Nirnay is a browser-native Progressive Web App for tracking fresh loan applications, SME renewals, officer tasks, and performance reporting with Firebase Firestore synchronization.

## Features

- Officer and Admin views with configurable officers, branches, ownership, targets, and availability.
- Fresh loan tracking across Pending, Sanctioned, and Returned states.
- SME renewal tracking with calendar, due-soon, overdue, completed, and not-possible views.
- Task, notification, month-end snapshot, spreadsheet, PDF, and image-report workflows.
- Stable lazy loading for performance, spreadsheet, and month-end reporting code.
- Installable application shell cached for offline launch after a successful online load.
- Firestore offline persistence when supported by the browser.

## Local Development

The app has no build step and no runtime package dependencies.

```powershell
node dev-server.js
```

Open `http://127.0.0.1:4175`.

## Verification

Run the dependency-free regression and static-integrity suite:

```powershell
npm test
```

Check all application modules for JavaScript syntax errors:

```powershell
$syntaxFailed = $false; Get-ChildItem js -Filter *.js | ForEach-Object { node --check $_.FullName; if ($LASTEXITCODE -ne 0) { $syntaxFailed = $true } }; if ($syntaxFailed) { exit 1 }
```

## Project Structure

```text
.
├── index.html                 Application shell and shared overlays
├── manifest.json              PWA metadata
├── sw.js                      Offline shell and background messaging worker
├── dev-server.js              Local static HTTP server
├── css/                       Feature and theme stylesheets
├── js/                        Browser ES modules
│   ├── app.js                 Application startup and subscriptions
│   ├── state.js               In-memory state and persisted settings
│   ├── db.js                  Firestore loan subscription and writes
│   ├── ui-*.js                Rendering, forms, navigation, and UI actions
│   ├── performance*.js        Performance views and report generation
│   ├── month-end.js           Monthly snapshot and cleanup tools
│   └── lazy-actions.js        Deferred report/export entry points
├── data/                      Preserved recovery snapshots
└── tests/                     Node behavior and runtime-asset tests
```

## Firebase and Security

Firebase project configuration is defined in `js/config.js`. The client configuration values are public identifiers; production protection must come from Firebase Authentication, server-enforced Firestore rules, and App Check.

The current Admin mode is client-managed and must not be treated as a security boundary. A separate security migration is required before exposing sensitive production data to untrusted users.

The cached application shell can launch offline, but uncached Firebase operations and first-time report-library downloads still require network access.
````

- [ ] **Step 2: Run the complete automated verification from a clean server state**

```powershell
npm test
$syntaxFailed = $false; Get-ChildItem js -Filter *.js | ForEach-Object { node --check $_.FullName; if ($LASTEXITCODE -ne 0) { $syntaxFailed = $true } }; if ($syntaxFailed) { exit 1 }
Get-ChildItem -Recurse -Filter *.json | ForEach-Object { Get-Content -Raw $_.FullName | ConvertFrom-Json | Out-Null }
git diff --check
```

Expected: all tests pass, every JavaScript file parses, every JSON file parses, and Git reports no whitespace errors.

- [ ] **Step 3: Run the local desktop and mobile smoke matrix**

Start the server in a dedicated terminal:

```powershell
node dev-server.js
```

At `http://127.0.0.1:4175`, verify the following without invoking an import, wipe, month-end cleanup, or other administrative write:

1. Desktop Fresh Loans: a default-collapsed administrator group expands on the first click and collapses on the second.
2. Desktop Renewals: calendar and list navigation render without console errors.
3. Desktop Performance: the overlay opens, Daily/Weekly/Monthly navigation works, and reopening it does not request a timestamped module URL.
4. Desktop Settings: Officers, Branches, Targets, Availability, Admin ID, Online, and Import tabs render; Import contains CSV plus the two preserved operational cleanup buttons and no April recovery buttons.
5. Add Loan modal: keyboard focus enters the visible form, every primary field has an announced label, Cancel returns focus to the Add button, and no save is submitted.
6. Header: Tab and Shift+Tab reach Tasks, Notifications, Task List, Performance, and User Menu; Enter and Space activate each control.
7. Mobile at 390 × 844: Fresh Loans, Renewals, Performance, Settings, and Add Loan render without horizontal page overflow or clipped primary actions.

Expected: no uncaught application errors. The known Firebase 11 persistence deprecation warning may remain because the SDK migration is outside this plan.

- [ ] **Step 4: Verify the application shell offline**

Using browser network controls:

1. Clear the local origin's service-worker and Cache Storage data.
2. Load `http://127.0.0.1:4175` online and wait until `navigator.serviceWorker.controller` is present after a reload.
3. Confirm Cache Storage contains `nirnay-v203` and every `ASSETS` request succeeded.
4. Switch the browser context offline and reload the root URL.
5. Confirm the shell, core styles, Fresh Loans view, and previously loaded Performance module render without a missing-module error.
6. Return the browser context online before ending verification.

- [ ] **Step 5: Review the final diff and preserve user-owned changes**

```powershell
git status --short
git diff --stat 9545adb..HEAD
git diff 9545adb..HEAD -- . ':(exclude)mockups/**'
git diff --name-only --cached
```

Expected: the nine pre-existing `mockups/` deletions remain unstaged and unchanged. No live data file other than the three approved April JSON files is deleted.

- [ ] **Step 6: Commit the documentation after verification**

```powershell
git add -- README.md
git diff --cached --check
git commit -m "docs: update local verification guidance"
git status --short
```

Expected: the only remaining working-tree changes are the user's pre-existing `mockups/` deletions.

---

## Completion Gate

Before reporting completion, invoke `superpowers:verification-before-completion` and rerun the fresh automated evidence required by that skill. Report separately:

- the six implementation commit hashes;
- automated test, syntax, JSON, asset, desktop/mobile, keyboard, and offline results;
- the exact stale files and confirmed dead files removed;
- the unchanged `mockups/` deletions still owned by the user;
- the remaining Firebase authentication/rules/App Check and SDK-modernization follow-up risks.
