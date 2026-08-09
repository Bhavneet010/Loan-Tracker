# Mobile Daily Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the narrow in-app Daily Snapshot with the approved mobile hierarchy while leaving PDF/JPEG exports and the original granular officer dashboard unchanged.

**Architecture:** Render a second, mobile-only presentation from the existing Daily Snapshot report object inside `editorial-phone-report`. Reuse `renderEditorialOfficerCard()` verbatim for officer details, and isolate the new presentation with CSS so only app viewports at or below 560 CSS pixels see it; export classes always show the existing report presentation.

**Tech Stack:** Browser-native JavaScript ES modules, HTML template strings, responsive CSS, Node.js `node:test`, local static dev server.

## Global Constraints

- Apply the redesign only to the narrow in-app Daily Snapshot at or below 560 CSS pixels.
- Do not change `js/performance.js`, `js/performance-pdf.js`, export dimensions, export rendering options, or export-specific typography.
- Keep the current wide/desktop Daily Snapshot, Weekly view, and Monthly view unchanged.
- Reuse `renderEditorialOfficerCard(card, index)` for every mobile officer card; do not duplicate or alter granular officer markup.
- Keep the officer order, category/status/renewal groups, labels, values, colors, and formatting intact.
- Use only existing report data and existing assets; do not introduce a new data source or dependency.
- Do not perform Firestore writes or mutate stored loan data during implementation or verification.
- Approved visual reference: `C:\Users\bhavn\.codex\generated_images\019fe536-7733-7b53-a46a-252e5e93f49f\exec-96d25c61-4f5b-475b-8a2d-7cbe7ca84bd2.png`.
- Original officer-card references: the two user-provided screenshots in `C:\Users\bhavn\Downloads\Mobile Devices\` dated 2026-08-09.

---

## File Structure

- Create `tests/mobile-daily-snapshot.test.mjs`: static regression contract for mobile markup, officer-card reuse, CSS visibility isolation, and unchanged export configuration.
- Modify `js/performance-snapshot.js`: add aggregate helpers and the mobile-only Daily Snapshot renderer; inject it before the existing report markup.
- Modify `css/snapshot-report.css`: add the mobile presentation styles and explicit export visibility boundary.
- Do not modify `js/performance.js` or `js/performance-pdf.js`.

### Task 1: Establish the Mobile/Export Rendering Boundary

**Files:**
- Create: `tests/mobile-daily-snapshot.test.mjs`
- Modify: `js/performance-snapshot.js:390-523`
- Modify: `css/snapshot-report.css:1009-1018,1694-2005`

**Interfaces:**
- Consumes: `report.summaryTiles`, `report.officerCards`, `renderEditorialOfficerCard(card, index)`, `fmtAmt(value)`, `esc(value)`.
- Produces: `sumOfficerMetric(officerCards, metricOf) -> { count: number, amount: number }` and `renderEditorialMobileView(report, topFresh) -> string`.

- [ ] **Step 1: Write the failing rendering-boundary tests**

Create `tests/mobile-daily-snapshot.test.mjs` with:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const snapshotSource = await readFile(new URL("../js/performance-snapshot.js", import.meta.url), "utf8");
const snapshotCss = await readFile(new URL("../css/snapshot-report.css", import.meta.url), "utf8");
const performanceSource = await readFile(new URL("../js/performance.js", import.meta.url), "utf8");
const compactCss = snapshotCss.replace(/\s+/g, "");

test("daily snapshot renders a dedicated mobile presentation from the same report", () => {
  assert.match(snapshotSource, /function renderEditorialMobileView\(report, topFresh\)/);
  assert.match(snapshotSource, /class="editorial-mobile-view"/);
  assert.match(snapshotSource, /renderEditorialMobileView\(report, topFresh\)/);
  assert.match(snapshotSource, /report\.officerCards\.map\(\(card, index\) => renderEditorialOfficerCard\(card, index\)\)/);
});

test("mobile presentation is isolated from desktop and export layouts", () => {
  assert.match(compactCss, /\.editorial-mobile-view\{display:none;\}/);
  assert.match(
    compactCss,
    /\.editorial-phone-report\.snapshot-export\.editorial-mobile-view,\.editorial-phone-report\.daily-jpeg-export\.editorial-mobile-view\{display:none!important;\}/,
  );
  assert.match(
    compactCss,
    /@media\(max-width:560px\).*\.editorial-phone-report:not\(\.snapshot-export\):not\(\.daily-jpeg-export\)>.editorial-mobile-view\{display:block;\}/,
  );
});

test("daily export dimensions and clone classes remain unchanged", () => {
  assert.match(performanceSource, /const exportWidth = 900;/);
  assert.match(performanceSource, /const exportHeight = 1600;/);
  assert.match(performanceSource, /const hdScale = 2;/);
  assert.match(performanceSource, /exportCard\.classList\.add\("snapshot-export", "daily-jpeg-export"\)/);
  assert.match(performanceSource, /width: exportWidth,/);
  assert.match(performanceSource, /windowWidth: exportWidth,/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
node --test tests/mobile-daily-snapshot.test.mjs
```

Expected: FAIL because `renderEditorialMobileView` and `.editorial-mobile-view` do not exist.

- [ ] **Step 3: Add aggregate and mobile rendering helpers**

In `js/performance-snapshot.js`, immediately after `renderEditorialOfficerCard`, add:

```js
function sumOfficerMetric(officerCards, metricOf) {
  return officerCards.reduce((total, card) => {
    const metric = metricOf(card);
    total.count += metric.count || 0;
    total.amount += metric.amount || 0;
    return total;
  }, { count: 0, amount: 0 });
}

function renderMobileGlanceMetric(label, metric, tone) {
  return `<div class="editorial-mobile-glance-metric ${tone}">
    <span>${esc(label)}</span>
    <strong>${esc(metric.count || 0)}</strong>
    <small>${metric.count ? `Rs ${esc(fmtAmt(metric.amount))}L` : "None"}</small>
  </div>`;
}

function renderEditorialMobileView(report, topFresh) {
  const freshMtd = report.summaryTiles[0];
  const pending = report.summaryTiles[1];
  const freshToday = report.summaryTiles[3];
  const renewalToday = sumOfficerMetric(report.officerCards, card => card.renewals.todayDone);
  const renewalQueue = sumOfficerMetric(report.officerCards, card => card.renewals.queue);

  return `<section class="editorial-mobile-view" aria-label="Daily performance dashboard">
    <div class="editorial-mobile-summary">
      <div class="editorial-mobile-brand">
        <div class="editorial-brand-mark"><img src="icon-192.png" alt="Nirnay logo"></div>
        <div>
          <strong><span>निर्णय</span></strong>
          <small>Decisions | Delivered</small>
        </div>
      </div>
      <div class="editorial-mobile-mtd">
        <span>Fresh MTD</span>
        <strong>Rs ${esc(fmtAmt(freshMtd.amount))}L</strong>
        <small>${esc(freshMtd.count)} sanctioned</small>
      </div>
    </div>
    <div class="editorial-mobile-date">${esc(report.dateLabel)}</div>
    <section class="editorial-mobile-top-performer">
      <div>
        <span>Top Fresh Performer</span>
        <strong>${esc(topFresh ? topFresh.name : "—")}</strong>
      </div>
      <div class="editorial-mobile-top-metric">
        <strong>${topFresh ? `Rs ${esc(fmtAmt(topFresh.sanctioned.total.amount))}L` : "No data"}</strong>
        <span>${topFresh ? `${esc(topFresh.sanctioned.total.count)} cases` : ""}</span>
      </div>
    </section>
    <section class="editorial-mobile-glance">
      <h2>Today at a Glance</h2>
      <div class="editorial-mobile-glance-grid">
        ${renderMobileGlanceMetric("Pending Pipeline", pending, "pipeline")}
        ${renderMobileGlanceMetric("Fresh Today", freshToday, "fresh")}
        ${renderMobileGlanceMetric("Renewal Done Today", renewalToday, "renewal")}
        ${renderMobileGlanceMetric("Renewal Overdue", renewalQueue, "overdue")}
      </div>
    </section>
    <section class="editorial-mobile-officers">
      <div class="editorial-mobile-section-title">
        <h2>Officers This Month</h2>
        <span>MTD Ranking</span>
      </div>
      <div class="editorial-mobile-officer-list">
        ${report.officerCards.map((card, index) => renderEditorialOfficerCard(card, index)).join("")}
      </div>
    </section>
  </section>`;
}
```

Inside `buildEditorialShareMockupHtml`, insert the mobile renderer as the first child of `.editorial-phone-report`, before the existing `.editorial-top`:

```js
return `<div class="report-mockup report-mockup-a editorial-phone-report">
  ${renderEditorialMobileView(report, topFresh)}
  <header class="editorial-top">
```

- [ ] **Step 4: Add the minimal visibility boundary**

In `css/snapshot-report.css`, add before the existing editorial styles:

```css
.editorial-mobile-view{
  display:none;
}
.editorial-phone-report.snapshot-export .editorial-mobile-view,
.editorial-phone-report.daily-jpeg-export .editorial-mobile-view{
  display:none!important;
}
```

At the end of the editorial responsive styles, add:

```css
@media(max-width:560px){
  .editorial-phone-report:not(.snapshot-export):not(.daily-jpeg-export) > .editorial-mobile-view{
    display:block;
  }
  .editorial-phone-report:not(.snapshot-export):not(.daily-jpeg-export) > .editorial-top,
  .editorial-phone-report:not(.snapshot-export):not(.daily-jpeg-export) > .editorial-leaders-wrap,
  .editorial-phone-report:not(.snapshot-export):not(.daily-jpeg-export) > .editorial-cards-stack,
  .editorial-phone-report:not(.snapshot-export):not(.daily-jpeg-export) > .editorial-footer{
    display:none;
  }
}
```

- [ ] **Step 5: Run focused and full tests**

Run:

```powershell
node --test tests/mobile-daily-snapshot.test.mjs
npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit the tested rendering boundary**

```powershell
git add -- tests/mobile-daily-snapshot.test.mjs js/performance-snapshot.js css/snapshot-report.css
git commit -m "feat: isolate mobile daily snapshot view"
```

### Task 2: Match the Approved Mobile Styling

**Files:**
- Modify: `tests/mobile-daily-snapshot.test.mjs`
- Modify: `css/snapshot-report.css:1012-1604,1694-2005`

**Interfaces:**
- Consumes: the mobile class names produced by `renderEditorialMobileView()` and the existing `.editorial-officer-*`, `.editorial-pill`, `.editorial-status-*`, and `.editorial-renewal-*` styles.
- Produces: the final phone layout at or below 560 CSS pixels without changing officer-card internals.

- [ ] **Step 1: Add failing style-contract assertions**

Append to `tests/mobile-daily-snapshot.test.mjs`:

```js
test("mobile summary follows the approved readable phone scale", () => {
  assert.match(compactCss, /\.editorial-mobile-summary\{[^}]*padding:24px16px18px/);
  assert.match(compactCss, /\.editorial-mobile-mtd>strong\{[^}]*font-size:28px/);
  assert.match(compactCss, /\.editorial-mobile-top-performer\{[^}]*min-height:88px/);
  assert.match(compactCss, /\.editorial-mobile-glance-grid\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(compactCss, /\.editorial-mobile-officer-list\{[^}]*gap:12px/);
});

test("mobile officers keep the original granular renderer and three-column groups", () => {
  assert.match(snapshotSource, /<div class="editorial-pills-grid">/);
  assert.match(snapshotSource, /<div class="editorial-status-strip">/);
  assert.match(snapshotSource, /<div class="editorial-renewal-row">/);
  assert.doesNotMatch(snapshotSource, /Status Summary/);
  assert.doesNotMatch(snapshotSource, /editorial-mobile-officer-card/);
});
```

- [ ] **Step 2: Run the focused test and verify the new style assertions fail**

Run:

```powershell
node --test tests/mobile-daily-snapshot.test.mjs
```

Expected: FAIL because the final mobile scale and layout styles do not exist yet.

- [ ] **Step 3: Implement the approved mobile surface and hierarchy**

Replace the minimal `.editorial-mobile-view` rule from Task 1 with these base styles, keeping the export-hide rule immediately after it:

```css
.editorial-mobile-view{
  display:none;
  color:#14112E;
  background:linear-gradient(180deg,#fff 0%,#f7f5fc 100%);
}
.editorial-mobile-summary{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:14px;
  padding:24px 16px 18px;
  border-bottom:1px solid rgba(30,20,80,0.10);
}
.editorial-mobile-brand{
  display:flex;
  align-items:center;
  gap:10px;
  min-width:0;
}
.editorial-mobile-brand > div:last-child{
  min-width:0;
}
.editorial-mobile-brand strong{
  display:block;
  font-family:'Noto Sans Devanagari','Mangal','Outfit','Inter',sans-serif;
  font-size:28px;
  line-height:1;
  color:#14112E;
}
.editorial-mobile-brand small{
  display:block;
  margin-top:4px;
  color:#6B5FBF;
  font-size:9px;
  font-weight:900;
  letter-spacing:0.08em;
  text-transform:uppercase;
  white-space:nowrap;
}
.editorial-mobile-mtd{
  flex:none;
  padding-left:14px;
  border-left:1px solid rgba(107,95,191,0.20);
  text-align:right;
}
.editorial-mobile-mtd > span,
.editorial-mobile-top-performer span,
.editorial-mobile-section-title span{
  color:#6E6890;
  font-size:10px;
  font-weight:900;
  letter-spacing:0.08em;
  text-transform:uppercase;
}
.editorial-mobile-mtd > strong{
  display:block;
  margin-top:5px;
  font-family:'Outfit','Inter',sans-serif;
  font-size:28px;
  line-height:1;
  color:#14112E;
}
.editorial-mobile-mtd > small{
  display:block;
  margin-top:5px;
  color:#047857;
  font-size:12px;
  font-weight:900;
}
.editorial-mobile-date{
  padding:12px 16px 10px;
  color:#4A4470;
  font-size:13px;
  font-weight:850;
}
.editorial-mobile-top-performer{
  min-height:88px;
  margin:0 16px 14px;
  padding:16px 18px;
  border-radius:16px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  overflow:hidden;
  background:#101234 url("../assets/snapshot/top-performer-bg.png") center/cover no-repeat;
  color:#fff;
  box-shadow:0 10px 24px rgba(22,16,52,0.18);
}
.editorial-mobile-top-performer > div:first-child span{
  color:#FFE08A;
}
.editorial-mobile-top-performer > div:first-child strong,
.editorial-mobile-top-metric strong{
  display:block;
  margin-top:7px;
  color:#fff;
  font-family:'Outfit','Inter',sans-serif;
  font-size:22px;
  line-height:1;
}
.editorial-mobile-top-metric{
  text-align:right;
}
.editorial-mobile-top-metric span{
  display:block;
  margin-top:7px;
  color:#FFF0D4;
  font-size:12px;
  letter-spacing:0;
  text-transform:none;
}
.editorial-mobile-glance{
  padding:0 16px 16px;
  border-bottom:1px solid rgba(30,20,80,0.10);
}
.editorial-mobile-glance h2,
.editorial-mobile-section-title h2{
  margin:0;
  font-family:'Outfit','Inter',sans-serif;
  font-size:20px;
  line-height:1.1;
  color:#14112E;
}
.editorial-mobile-glance-grid{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  margin-top:12px;
  border-top:1px solid rgba(107,95,191,0.16);
  border-bottom:1px solid rgba(107,95,191,0.16);
}
.editorial-mobile-glance-metric{
  min-width:0;
  padding:12px 7px;
  text-align:center;
}
.editorial-mobile-glance-metric + .editorial-mobile-glance-metric{
  border-left:1px solid rgba(107,95,191,0.16);
}
.editorial-mobile-glance-metric span{
  display:block;
  min-height:28px;
  font-size:9px;
  line-height:1.35;
  font-weight:900;
  letter-spacing:0.04em;
  text-transform:uppercase;
}
.editorial-mobile-glance-metric strong{
  display:block;
  margin-top:7px;
  font-family:'Outfit','Inter',sans-serif;
  font-size:24px;
  line-height:1;
}
.editorial-mobile-glance-metric small{
  display:block;
  margin-top:6px;
  color:#6E6890;
  font-size:10px;
  font-weight:800;
  white-space:nowrap;
}
.editorial-mobile-glance-metric.pipeline span,
.editorial-mobile-glance-metric.pipeline strong{color:#5A4EAF;}
.editorial-mobile-glance-metric.fresh span,
.editorial-mobile-glance-metric.fresh strong,
.editorial-mobile-glance-metric.renewal span,
.editorial-mobile-glance-metric.renewal strong{color:#047857;}
.editorial-mobile-glance-metric.overdue span,
.editorial-mobile-glance-metric.overdue strong{color:#B91C1C;}
.editorial-mobile-officers{
  padding:16px;
}
.editorial-mobile-section-title{
  display:flex;
  align-items:baseline;
  justify-content:space-between;
  gap:12px;
  margin-bottom:12px;
}
.editorial-mobile-officer-list{
  display:flex;
  flex-direction:column;
  gap:12px;
}
```

In the `@media(max-width:560px)` block, normalize only the outer app-view report surface:

```css
.editorial-phone-report:not(.snapshot-export):not(.daily-jpeg-export){
  width:100%;
  border:0;
  border-radius:0;
  box-shadow:none;
}
```

Do not add mobile-specific replacements for `.editorial-officer-card`, `.editorial-pills-grid`, `.editorial-status-strip`, or `.editorial-renewal-row`. Their current renderer and styles are intentionally preserved.

- [ ] **Step 4: Run focused and full automated verification**

Run:

```powershell
node --test tests/mobile-daily-snapshot.test.mjs
npm test
$syntaxFailed = $false; Get-ChildItem js -Filter *.js | ForEach-Object { node --check $_.FullName; if ($LASTEXITCODE -ne 0) { $syntaxFailed = $true } }; if ($syntaxFailed) { exit 1 }
```

Expected: all tests PASS and every JavaScript module reports valid syntax.

- [ ] **Step 5: Commit the approved mobile styling**

```powershell
git add -- tests/mobile-daily-snapshot.test.mjs css/snapshot-report.css
git commit -m "style: redesign daily snapshot for phones"
```

### Task 3: Browser and Export Regression Verification

**Files:**
- Modify only if verification finds a mismatch: `css/snapshot-report.css`, `js/performance-snapshot.js`, `tests/mobile-daily-snapshot.test.mjs`
- Verify unchanged: `js/performance.js`, `js/performance-pdf.js`

**Interfaces:**
- Consumes: the completed mobile presentation, the approved ImageGen reference, original user screenshots, and the existing share/export entry points.
- Produces: accepted phone screenshots and evidence that desktop/export rendering did not regress.

- [ ] **Step 1: Start the local app and open it with the in-app browser**

Run:

```powershell
node dev-server.js
```

Open `http://127.0.0.1:4175` in the Codex in-app browser. Use a 390 CSS pixel-wide phone viewport. Do not use Chrome or Playwright unless the user explicitly authorizes that browser/tool.

- [ ] **Step 2: Verify the mobile Daily Snapshot**

Open Performance → Daily Snapshot and capture the complete narrow app view. Confirm:

- header and period tabs still work;
- Fresh MTD, date, Top Fresh Performer, and four Today at a Glance values use live report data;
- each officer uses the original granular card structure with no renamed or missing fields;
- the page has no horizontal overflow, clipped values, overlapping type, or tiny unreadable metadata;
- the 390 px rendering visually follows the approved reference.

- [ ] **Step 3: Compare the implementation and visual references together**

Create one comparison input containing:

- the approved ImageGen reference;
- the new 390 px implementation screenshot;
- the original officer-card screenshots.

Inspect the combined comparison for hierarchy, padding, font weights, borders, radii, card grouping, and overflow. If the upper mobile layout differs materially, adjust only mobile selectors. If officer cards differ structurally, remove the mobile override causing the difference rather than rewriting the officer renderer.

- [ ] **Step 4: Verify wide app and export isolation**

At a viewport wider than 560 CSS pixels, confirm the original Daily Snapshot presentation remains visible and the mobile presentation is hidden. Exercise the current daily PDF/JPEG export path and confirm:

- the export clone has `snapshot-export` and, for JPEG, `daily-jpeg-export`;
- `.editorial-mobile-view` is absent from the rendered export because CSS hides it;
- export width, typography, summary, leader cards, officer cards, footer, and pagination match the pre-change output;
- Weekly and Monthly views remain unchanged.

- [ ] **Step 5: Run final automated verification and inspect the diff**

Run:

```powershell
npm test
$syntaxFailed = $false; Get-ChildItem js -Filter *.js | ForEach-Object { node --check $_.FullName; if ($LASTEXITCODE -ne 0) { $syntaxFailed = $true } }; if ($syntaxFailed) { exit 1 }
git diff --check
git status --short
git diff -- js/performance.js js/performance-pdf.js
```

Expected: all tests PASS, syntax checks PASS, `git diff --check` is clean, and the final command produces no diff.

- [ ] **Step 6: Commit any verification-only corrections**

If verification required changes:

```powershell
git add -- tests/mobile-daily-snapshot.test.mjs js/performance-snapshot.js css/snapshot-report.css
git commit -m "fix: align mobile daily snapshot with approved design"
```

If verification required no changes, do not create an empty commit.
