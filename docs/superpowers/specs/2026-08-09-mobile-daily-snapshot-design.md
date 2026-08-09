# Mobile Daily Snapshot Design

**Date:** 2026-08-09
**Status:** Approved visual direction; awaiting implementation-plan review

## Objective

Replace the squeezed report-style Daily Snapshot shown inside the phone app with the approved action-focused mobile layout. Preserve the current exported PDF and JPEG dashboard exactly, and preserve each officer's granular dashboard structure and values exactly as they appear in the existing app.

## Scope

### Included

- Apply the redesigned Daily Snapshot only to narrow in-app viewports.
- Keep the existing overlay header, Back action, share action, and Daily / Weekly / Monthly navigation behavior.
- Present the Nirnay brand beside the Fresh MTD total in a compact mobile summary.
- Keep the report date visible directly below the summary.
- Restore a dedicated Top Fresh Performer strip with the officer name, sanctioned amount, and case count.
- Add a scan-friendly Today at a Glance strip for pending pipeline, fresh completed today, renewals completed today, and overdue renewals.
- Keep the Officers This Month heading and ranking context.
- Reuse the existing granular officer dashboard card without changing its structure: rank/name/total header, three sanctioned-category tiles, three status tiles, and the Renewal Book panel.
- Add automated checks that prevent the mobile-only presentation from entering export output.

### Excluded

- Any visual or structural change to exported PDF or JPEG dashboards.
- Any change to daily snapshot calculations, source data, Firestore data, or ranking logic.
- Any change to the granular officer-card fields, values, grouping, colors, or order.
- Redesign of the Weekly or Monthly performance views.
- Changes to the performance overlay's share/export behavior.
- A framework, build-system, or component-library migration.

## Approved Mobile Composition

The narrow in-app Daily Snapshot will follow this order:

1. Existing overlay header and Daily / Weekly / Monthly tabs.
2. Nirnay brand and Fresh MTD summary on one balanced row.
3. Report date.
4. Dark Top Fresh Performer strip.
5. Today at a Glance summary with four equal metrics.
6. Officers This Month heading and ranking label.
7. Existing granular officer cards in rank order.

The mobile layout uses the existing Nirnay palette: warm white, lavender, deep navy, violet, green, amber, and restrained red. Page gutters, section spacing, and the summary hierarchy will follow the approved visual reference. The officer cards remain visually and structurally intact from the current implementation.

## Architecture

The application remains a browser-native ES-module PWA. The Daily Snapshot continues to be built from the same report data and ranking calculations in `js/performance-snapshot.js`.

The implementation will add a mobile-only presentation inside the existing Daily Snapshot report. It will be rendered from the same report object as the current report layout, so totals and officer values cannot diverge. The existing report markup remains available as the export layout.

CSS will control presentation isolation:

- The new mobile presentation is hidden by default.
- It is shown only for narrow in-app Daily Snapshot viewports.
- The existing report presentation is hidden only in that narrow in-app state.
- Any report carrying `snapshot-export` or `daily-jpeg-export` keeps the current export presentation and always hides the mobile presentation.

No export module, export dimensions, export-specific selectors, or PDF/JPEG rendering options will be changed.

## Components and Behavior

### Mobile summary

The summary pairs the existing Nirnay brand lockup with Fresh MTD amount and sanctioned count. It uses the same calculated Fresh MTD values as the current report and introduces no new data source.

### Date and Top Fresh Performer

The report date remains the existing formatted date. The Top Fresh Performer strip uses the same highest-ranked fresh officer already used by the current top-performer callout. Empty data continues to use the existing no-data fallback.

### Today at a Glance

The four metrics are derived from existing report aggregates:

- Pending Pipeline: total pending fresh count and amount.
- Fresh Today: total fresh sanctions completed on the report date.
- Renewal Done Today: total renewals completed on the report date.
- Renewal Overdue: total current renewal queue count and amount.

Zero states display the existing `None` convention. Green remains the success color, violet remains the neutral pipeline color, and red is reserved for overdue or zero-today attention states as established by the current dashboard.

### Officer dashboards

The existing officer-card renderer remains the single source of truth for both the current/export presentation and the mobile presentation. Each officer card retains:

- ordinal badge, name, sanctioned amount, and sanctioned count;
- `SANCTIONED BY CATEGORY` and `COUNT / RS LAKHS` header row;
- AGRI, SME, and EDU tiles;
- PENDING, RETURNED, and FRESH TODAY tiles;
- RENEWAL BOOK panel with OVERDUE, DONE MTD, and DONE TODAY;
- existing pastel fills, red zero-state emphasis, borders, radii, ordering, and value formatting.

The redesign must not flatten these groups, rename them, convert them into accordion rows, or move renewal metrics into the six-tile grid.

## Data Flow

`buildReportMockupData()` remains responsible for totals and officer rows. The Daily Snapshot builder passes the same report object into the existing report markup and the mobile-only markup. Reused officer-card rendering ensures that category, status, and renewal values are calculated and formatted once.

No writes occur. The change affects DOM composition and CSS visibility only.

## Responsive and Export Isolation

The new presentation targets in-app viewports at or below 560 CSS pixels through the project's existing phone breakpoint. Wider app viewports keep the existing report presentation.

Export isolation is explicit rather than dependent on viewport width. Export classes override mobile rules so the mobile presentation cannot appear in a cloned PDF/JPEG document even if the export engine reports a narrow viewport. The existing fixed export width and export typography remain authoritative.

## Error Handling and Safety

- Missing or zero report values use current formatting and `None` fallbacks.
- An empty officer list displays the current no-data behavior without inventing a performer.
- The mobile presentation does not attach new event handlers, mutate report data, or alter share/export entry points.
- The implementation will not touch Firestore, stored loan records, or production data.
- Existing unrelated working-tree changes, if any, will be preserved.

## Testing and Verification

Implementation will begin with failing automated checks for the presentation boundary. Tests will verify that:

- the Daily Snapshot contains a dedicated mobile presentation;
- the mobile presentation reuses the existing granular officer-card structure;
- mobile CSS shows the new presentation only in the narrow in-app state;
- `snapshot-export` and `daily-jpeg-export` explicitly hide the mobile presentation and retain the existing report presentation;
- no export-specific JavaScript dimensions or rendering settings change.

Verification will also include:

- the complete Node test suite;
- JavaScript syntax checks for all modules;
- a local phone-width browser check of the Daily Snapshot;
- a comparison of the rendered phone view against the approved visual reference and original officer-card screenshots;
- a generated PDF/JPEG regression check against the existing export layout;
- desktop-width smoke testing of Daily, Weekly, and Monthly performance tabs;
- final diff inspection confirming that only app-view markup, responsive CSS, tests, and documentation changed.

## Acceptance Criteria

- The phone app displays the approved action-focused Daily Snapshot hierarchy.
- Top Fresh Performer remains visible with the correct officer, amount, and case count.
- Today at a Glance displays the four approved aggregate metrics.
- Every officer's granular dashboard remains structurally and visually intact from the original.
- All displayed values come from the existing Daily Snapshot report data.
- Exported PDF and JPEG dashboards are visually unchanged and contain no mobile-only presentation.
- Weekly and Monthly performance views remain unchanged.
- Automated tests and JavaScript syntax checks pass.
- Browser verification shows readable, unclipped phone content with no horizontal overflow.
