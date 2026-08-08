# Multi-Month Pending-Renewal Export Design

**Date:** 2026-08-08  
**Status:** Approved for implementation planning

## Objective

Extend the renewal calendar's download menu so users can export pending renewals for any set of months in one Excel or PDF file. Preserve the existing one-click Excel and PDF exports for the displayed calendar month.

## Scope

### Included

- Keep the current displayed-month Excel and PDF actions unchanged.
- Add a `Multiple months...` action below those actions, separated visually from them.
- Let users select non-consecutive months, including months from different years.
- Export selected months chronologically in one file.
- Give every selected month a visible section and count, including months with no matching renewals.
- Apply the same pending-renewal rules, active filters, ordering, columns, and renewal-not-possible treatment as the current calendar export.
- Support the existing light, dark, and mobile layouts.

### Excluded

- Separate files or ZIP archives for individual months.
- A continuous from/to range picker.
- Changes to renewal status calculation, stored loan data, Firestore, or calendar navigation.
- New report filters or changes to how current calendar filters affect exports.

## Interaction Design

The calendar download dropdown retains its current heading and immediate `Excel File` and `PDF File` actions for the displayed month. A divider appears below them, followed by `Multiple months...`.

Selecting `Multiple months...` closes the dropdown and opens a compact modal dialog. The dialog opens on the displayed calendar year and presents all 12 months as selectable controls. Each month shows the total number of rows that would be exported under the calendar's active filters; when renewal-not-possible rows are present, their count is identified separately from ordinary pending rows. The displayed calendar month is selected initially.

Previous- and next-year controls allow selection across years. Selections persist while navigating between years. `Select all` applies to the 12 months in the visible year, and `Clear` removes all selections. A concise selection summary shows the total number of selected months.

The footer contains `Download Excel` and `Download PDF`. Both controls remain disabled until at least one month is selected. Closing the dialog cancels the selection without downloading or changing the displayed calendar month.

The dialog uses proper modal semantics, moves focus inside when opened, supports Escape and backdrop close, and returns focus to the calendar download button when closed.

## Export Data Model

A shared multi-month data function accepts an array of canonical month keys in `YYYY-MM` form. It will:

1. Normalize and deduplicate the selected keys.
2. Sort them chronologically, independent of selection order.
3. Obtain pending renewals through the same filtering path as the existing calendar export.
4. Group each matching loan by the month of its calculated NPA date.
5. Sort normal loans by NPA date within each month.
6. Sort renewal-not-possible loans by NPA date and place them after normal loans in the same month.
7. Return an entry for every selected month, including entries with no loans.

The applicable filters are the current user or officer scope, branch, renewal status, NPA visibility, and search value. Data and filters are evaluated when an export button is pressed, so the generated file reflects the latest in-memory loan state.

The existing displayed-month function remains available for the quick actions. Implementation may delegate it to the shared grouping logic as long as its observable output and filenames remain unchanged.

## Excel Layout

The multi-month workbook contains one worksheet named `Pending Renewals`. Selected months appear from earliest to latest, continuously down the worksheet.

Each month section contains:

- A merged heading row in the form `September 2026 - 12 pending renewals`. When applicable, the heading adds a separate count such as `- 2 not possible`.
- The existing renewal-export column headings.
- The month's renewal rows.
- A blank separator row before the next month.

For a month with neither ordinary nor renewal-not-possible rows, the section contains its heading followed by `No pending renewals`. Renewal-not-possible rows retain the current grey fill. Existing column widths, amount handling, date formatting, and remarks wrapping remain consistent with the single-month workbook.

## PDF Layout

The PDF uses the same chronological month sections and existing renewal-export columns. Each section starts with the month name and pending count. Empty sections display `No pending renewals`.

Sections flow one after another without a forced page break. If a section cannot fit in the remaining space, rendering continues on the next page. Table column headings repeat whenever rows continue onto a new page. Renewal-not-possible rows retain the current grey styling. Existing page numbering, text fitting, portrait page format, and font limitations remain unchanged.

## Filenames

When four or fewer months are selected and they all belong to the same year, the filename lists their three-letter month abbreviations followed by the year, for example:

`nirnay-pending-renewals-aug-oct-dec-2026.xlsx`

For five or more months, or for any cross-year selection, the filename uses the first month, last month, and selection count, for example:

`nirnay-pending-renewals-aug-2026-to-feb-2027-7-months.pdf`

## Error and Progress Handling

- Export buttons are disabled while a file is being generated to prevent duplicate downloads.
- The dialog remains visible while generation is in progress and indicates which format is being prepared.
- Successful generation closes the dialog and uses the existing toast mechanism to confirm completion.
- A generation or library-loading failure keeps the dialog open, restores the buttons, logs diagnostic detail, and displays the existing export-failure toast.
- Selecting only empty months is valid and produces a report whose sections explicitly state that there are no pending renewals.

## Component Boundaries

- `js/ui-calendar.js` owns calendar-specific month grouping and the multi-month selection markup or view model.
- `js/export-excel.js` owns the shared export actions and Excel/PDF renderers.
- `js/state.js` is not required to persist temporary dialog selection; the selection should remain local to the export workflow unless implementation constraints make a small transient state field clearer.
- `index.html` hosts shared overlay markup only if the existing rendering pattern makes a static dialog preferable.
- `css/calendar.css` owns the dropdown extension and selection-dialog styles, including dark and responsive variants.
- `js/lazy-actions.js` exposes any new global entry points required by inline handlers without eagerly loading export libraries.

Each exporter consumes the same normalized month-section model so Excel and PDF cannot diverge in selection, filtering, grouping, or ordering.

## Testing and Verification

Automated tests will cover the pure selection and grouping behavior where it can be isolated from the DOM:

- Non-consecutive month selection.
- Cross-year chronological sorting.
- Duplicate-key normalization.
- Months with no pending renewals.
- Active officer, branch, status, NPA, and search filters.
- Normal versus renewal-not-possible ordering.
- Deterministic short and long filenames.
- Preservation of the existing single-month export behavior.

Static integrity checks will verify that any new inline actions are exposed through the lazy-action boundary and that all referenced assets exist. JavaScript syntax checks and the complete Node test suite must pass.

Browser verification will cover quick single-month downloads, multi-month Excel and PDF downloads, cross-year selection persistence, empty sections, duplicate-click prevention, failure recovery, keyboard focus, Escape and backdrop closing, narrow mobile layout, and light and dark themes.

## Acceptance Criteria

- The displayed-month Excel and PDF links remain immediately available and behave as before.
- `Multiple months...` opens an accessible selector without changing calendar navigation.
- Users can select arbitrary non-consecutive and cross-year months.
- The displayed month is initially selected, selections persist across year navigation, and no export can start with zero selected months.
- Excel produces one `Pending Renewals` worksheet with chronological month sections.
- PDF produces equivalent chronological month sections.
- Every selected month appears, including an explicit zero-result section when applicable.
- Existing filters and renewal-not-possible behavior are preserved.
- Progress, success, and failure states prevent accidental duplicate exports and leave the interface recoverable.
- Automated tests, syntax checks, and targeted browser verification pass.
