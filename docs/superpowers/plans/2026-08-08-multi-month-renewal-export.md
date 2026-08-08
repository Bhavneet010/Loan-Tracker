# Multi-Month Pending-Renewal Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an accessible arbitrary-month selector to the renewal calendar and generate one continuous Excel worksheet or PDF containing chronological month sections.

**Architecture:** Put month-key normalization, grouping, and filename generation in a browser-independent module with Node tests. Keep filter-aware selection and dialog behavior in the calendar module, then have both lazy-loaded exporters consume the same month-section model.

**Tech Stack:** Browser ES modules, DOM APIs, xlsx-js-style, jsPDF, CSS, Node.js built-in test runner.

## Global Constraints

- Preserve the current one-click Excel and PDF actions and filenames.
- Allow non-consecutive and cross-year selections; export them chronologically in one file.
- Include every selected month, including months with no matching renewals.
- Preserve user/officer, branch, status, NPA visibility, and search filters.
- Keep renewal-not-possible rows last and grey.
- Do not change stored loan data, Firestore behavior, status calculation, or calendar navigation.
- Keep report libraries lazy-loaded through `js/lazy-actions.js`.
- Support keyboard use, focus return, mobile layout, and light/dark themes.

---

### Task 1: Pure multi-month export model

**Files:**

- Create: `js/calendar-export-model.js`
- Create: `tests/calendar-export-model.test.mjs`

**Interfaces:**

- Produces `normalizeMonthKeys(monthKeys: unknown[]): string[]`.
- Produces `buildRenewalMonthSections(renewals: object[], monthKeys: string[]): MonthSection[]`, where a section is `{ key, year, month, monthName, loans, rnpLoans }` and `month` is zero-based.
- Produces `buildMultiMonthExportFilename(monthKeys: string[], extension: "xlsx" | "pdf"): string`.

- [ ] **Step 1: Write failing tests**

Create `tests/calendar-export-model.test.mjs`. Assert invalid keys are dropped, duplicates are removed, keys are chronological, empty selected months produce empty sections, normal and renewal-not-possible loans are sorted separately by `_rs.npaDateStr`, an NPA-status loan is normal even if `renewalNotPossible` is true, and filenames follow these exact examples:

```js
assert.equal(buildMultiMonthExportFilename(["2026-08", "2026-10", "2026-12"], "xlsx"), "nirnay-pending-renewals-aug-oct-dec-2026.xlsx");
assert.equal(buildMultiMonthExportFilename(["2026-08", "2026-10", "2027-02"], "pdf"), "nirnay-pending-renewals-aug-2026-to-feb-2027-3-months.pdf");
assert.equal(buildMultiMonthExportFilename(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"], "xlsx"), "nirnay-pending-renewals-jan-2026-to-may-2026-5-months.xlsx");
```

Also assert empty selection and unsupported extensions throw `TypeError`.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/calendar-export-model.test.mjs`  
Expected: FAIL because the model module does not exist.

- [ ] **Step 3: Implement the model**

Create `js/calendar-export-model.js` with a strict `/^(\d{4})-(0[1-9]|1[0-2])$/` validator, exported month names, normalization via sorted `Set`, section creation before grouping so empty months survive, separate `loans` and `rnpLoans` arrays, and the approved four-month/same-year filename cutoff.

The grouping decision is exactly:

```js
const deferred = loan.renewalNotPossible === true && loan._rs?.status !== "npa";
(deferred ? section.rnpLoans : section.loans).push(loan);
```

- [ ] **Step 4: Verify GREEN and commit**

```powershell
node --test tests/calendar-export-model.test.mjs
npm test
git add -- js/calendar-export-model.js tests/calendar-export-model.test.mjs
git diff --cached --check
git commit -m "feat: add multi-month renewal export model"
```

Expected: all tests PASS and the commit succeeds.

---

### Task 2: Accessible arbitrary-month selector

**Files:**

- Modify: `js/ui-calendar.js`
- Modify: `index.html`
- Modify: `css/calendar.css`
- Modify: `tests/runtime-assets.test.mjs`

**Interfaces:**

- Consumes `buildRenewalMonthSections` and `CALENDAR_MONTH_NAMES`.
- Produces `getCalendarMonthsExport(monthKeys, metrics = getLoanMetrics()): MonthSection[]`.
- Produces globals `openCalMultiExport`, `closeCalMultiExport`, `calMultiExportYear`, `toggleCalMultiExportMonth`, `selectCalMultiExportYear`, `clearCalMultiExport`, and `downloadCalMultiExport`.

- [ ] **Step 1: Add failing action-boundary assertions**

Extend `tests/runtime-assets.test.mjs` so new inline actions must be defined, and so `exportCalendarRenewalsMultiExcel` and `exportCalendarRenewalsMultiPdf` must be registered as lazy actions. Run the focused test and confirm it fails.

- [ ] **Step 2: Add filter-aware grouping**

Import the pure model and `openOverlay`/`closeOverlay` in `js/ui-calendar.js`. Replace the local month-name array with the exported constant. Add:

```js
export function getCalendarMonthsExport(monthKeys, metrics = getLoanMetrics()) {
  return buildRenewalMonthSections(getFilteredRenewals(metrics), monthKeys);
}
```

Refactor `getCalendarMonthExport` to delegate to this function while preserving its current result shape.

- [ ] **Step 3: Add the menu entry and overlay**

Below the existing PDF action, add a separator and `Multiple months...`. Add `aria-expanded`/`aria-controls` to the download trigger and synchronize `aria-expanded` in the existing menu functions.

Add a centered `#calMultiExportOverlay` in `index.html` with dialog semantics, backdrop close, close button, previous/next year controls, `#calMultiExportMonths`, `#calMultiExportSummary`, Select all, Clear, and disabled Excel/PDF buttons.

- [ ] **Step 4: Implement dialog state and behavior**

Store the viewed year, selected keys, and busy state as module-local values. Opening selects the displayed month, renders 12 visible-year month buttons, opens the overlay, and focuses the selected month. Each button shows ordinary count plus a separate not-possible count, uses `aria-pressed`, and has a 44-pixel target.

Year navigation preserves selections. Select all adds all visible-year keys. Clear removes all keys. Export buttons disable for zero selections or while busy. `downloadCalMultiExport(format)` awaits the corresponding lazy exporter, closes only on `true`, and always restores controls. Escape and backdrop close without exporting; focus returns through `closeOverlay`.

- [ ] **Step 5: Style and verify**

Add dropdown separator, modal, 3-column month grid, selected/focus/disabled/busy states, dark-mode colors, and a `max-width:480px` mobile rule to `css/calendar.css`.

```powershell
node --check js/ui-calendar.js
npm test -- tests/runtime-assets.test.mjs
npm test
```

Browser-check selection, year persistence, Select all, Clear, zero-selection disablement, Escape/backdrop close, focus return, dark mode, and 390 x 844 layout.

- [ ] **Step 6: Commit**

```powershell
git add -- js/ui-calendar.js index.html css/calendar.css tests/runtime-assets.test.mjs
git diff --cached --check
git commit -m "feat: add renewal export month selector"
```

---

### Task 3: Continuous Excel worksheet

**Files:**

- Modify: `js/export-excel.js`
- Modify: `js/lazy-actions.js`
- Modify: `sw.js`
- Modify: `tests/runtime-assets.test.mjs`

**Interfaces:**

- Consumes `getCalendarMonthsExport(monthKeys)` and `buildMultiMonthExportFilename(monthKeys, "xlsx")`.
- Produces `exportCalendarRenewalsMultiExcel(monthKeys): Promise<boolean>`.

- [ ] **Step 1: Register lazy actions and the core asset**

Register both multi-month exporter globals in `js/lazy-actions.js`. Add `./js/calendar-export-model.js` to `sw.js`, increment its cache version by one, and update runtime-asset assertions.

- [ ] **Step 2: Build the worksheet renderer**

Add `createMultiMonthRenewalSheet(sections)` using `XLSX.utils.aoa_to_sheet`. For each section emit a merged month heading, `RENEWAL_DUE_HEADERS`, normal rows, renewal-not-possible rows, or `No pending renewals`, then one blank row between sections.

Use the heading `${monthName} ${year} - ${loans.length} pending renewal(s)` and append ` - ${rnpLoans.length} not possible` when needed. Preserve column widths, 40-character Remarks cap, wrapped Remarks row heights, purple headings, white header text, and grey renewal-not-possible fills.

- [ ] **Step 3: Add the Excel action**

`exportCalendarRenewalsMultiExcel` obtains sections at click time, rejects zero valid keys into its catch path, ensures XLSX, appends one sheet named `Pending Renewals`, saves the model-generated filename, toasts success, and returns `true`. Its catch logs `[Multi-month calendar Excel export]`, toasts failure, and returns `false`.

- [ ] **Step 4: Verify and commit**

Run `npm test` and JavaScript syntax checks. Export non-consecutive same-year months with one empty section, then a cross-year set. Verify one sheet, chronological headings, repeated columns, explicit empty month, grey not-possible rows, wrapped remarks, and both filename forms.

```powershell
git add -- js/export-excel.js js/lazy-actions.js sw.js tests/runtime-assets.test.mjs
git diff --cached --check
git commit -m "feat: export multi-month renewal workbook"
```

---

### Task 4: Continuous PDF and final verification

**Files:**

- Modify: `js/export-excel.js`
- Verify: all feature files from Tasks 1-3

**Interfaces:**

- Consumes `getCalendarMonthsExport(monthKeys)` and `buildMultiMonthExportFilename(monthKeys, "pdf")`.
- Produces `exportCalendarRenewalsMultiPdf(monthKeys): Promise<boolean>`.

- [ ] **Step 1: Extract reusable PDF helpers**

Refactor without changing the single-month result so page setup, table headings, row height, wrapped Remarks, not-possible fill, page numbering, and fit-to-column behavior can serve both exporters.

- [ ] **Step 2: Render month sections**

Flow sections without forced page breaks, adding 6 mm between them. If the next heading and table header do not fit, add a portrait A4 page first. Draw separate ordinary/not-possible counts, explicit `No pending renewals`, section-local row numbers, and repeat the active month plus table headings after page breaks.

- [ ] **Step 3: Add the PDF action**

`exportCalendarRenewalsMultiPdf` follows the Excel action's boolean contract, uses `ensureJsPdf`, renders one document, saves the model-generated filename, and handles errors with `[Multi-month calendar PDF export]` plus the existing failure toast.

- [ ] **Step 4: Run fresh verification**

```powershell
npm test
$syntaxFailed = $false; Get-ChildItem js -Filter *.js | ForEach-Object { node --check $_.FullName; if ($LASTEXITCODE -ne 0) { $syntaxFailed = $true } }; if ($syntaxFailed) { exit 1 }
git diff --check
```

Expected: all tests and syntax checks PASS with no whitespace errors.

- [ ] **Step 5: Run the browser matrix**

Verify original single-month exports, non-consecutive/cross-year selection, empty sections, grey not-possible rows, long Remarks, duplicate-click prevention, forced library-load failure recovery, keyboard focus, Escape/backdrop close, dark mode, 390 x 844 layout, and no new uncaught console errors.

- [ ] **Step 6: Commit**

```powershell
git add -- js/export-excel.js
git diff --cached --check
git commit -m "feat: export multi-month renewal PDF"
git status --short
```

---

## Completion Gate

Before claiming completion, invoke `superpowers:verification-before-completion`, rerun `npm test`, all JavaScript syntax checks, `git diff --check`, and targeted browser checks. Report implementation commits, automated results, browser results, and any verification limitation.
