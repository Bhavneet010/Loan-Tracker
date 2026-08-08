# Nirnay Stabilization and Cleanup Design

**Date:** 2026-08-08  
**Status:** Approved for implementation planning

## Objective

Stabilize the existing static progressive web application without changing its loan data model or performing operations against live Firestore data. The work removes confirmed stale recovery code, fixes reproduced defects, reduces unnecessary loading, and improves essential accessibility while preserving current user workflows.

## Scope

### Included

- Remove the April 2026 recovery import controls and their dedicated JavaScript functions.
- Delete the obsolete April pending, returns, and sanctioned JSON files.
- Preserve the June 2026 monthly snapshot archive and the general CSV import workflow.
- Remove imports, functions, stylesheets, and other code only after confirming that they have no callers or runtime references.
- Fix the Fresh Loans officer-group toggle so its first interaction always changes the visible state.
- Make application and service-worker asset URLs consistent so offline caching does not depend on cache-busting query strings.
- Stop the Performance section from bypassing the module and service-worker caches.
- Defer performance reporting and export support until those features are opened, where this can be done without changing their behavior.
- Improve keyboard access, dialog semantics, form labeling, viewport scaling, and undersized mobile controls.
- Correct repository documentation that no longer matches the application structure.
- Add dependency-free automated checks for the corrected state behavior and the application's static asset graph.

### Excluded

- Firebase Authentication, Firestore security-rule deployment, and App Check. These require a separately approved security design and Firebase project decisions.
- Changes to Firestore collections, document schemas, or stored customer records.
- A framework migration, build-system introduction, or visual redesign.
- Firebase SDK and Admin SDK major-version upgrades. Dependency modernization will be handled separately because it has deployment and compatibility implications.
- Removal of operational CSV import or June snapshot recovery capabilities.
- Any write, import, wipe, or migration against a live Firebase project.

## Architecture

The application remains a browser-native ES-module PWA. Existing feature boundaries and global event entry points remain intact unless a global is proven unused across HTML, JavaScript, and runtime-generated markup.

A small pure state helper will define the next collapsed state from the stored override and the role-based default. Both initial rendering and click handling will use the same rule, eliminating the current mismatch without introducing a broader state-management layer.

Performance and report modules will use stable module URLs. Heavy report, PDF, and spreadsheet code will be dynamically loaded at the user-action boundary instead of through eager top-level imports when the existing API permits it. Dynamic imports must use stable paths so browser and service-worker caches remain effective.

The service worker will cache the exact stable URLs loaded by `index.html`. Its cache identifier will be advanced whenever this asset list changes. Installation failures will remain observable rather than being silently mistaken for a successful offline installation.

## Components and Changes

### Legacy recovery cleanup

The settings UI will no longer display the fixed April 2026 import actions. Their event handlers, import-specific parsing paths, and data files will be removed after a final reference scan. The generic CSV import and June monthly snapshot archive will remain available and unchanged.

Destructive administrative operations that are not specific to the April recovery flow are outside this deletion. They will not be invoked during implementation or verification.

### Dead-code and redundancy cleanup

Removal will be conservative and evidence-based:

1. Build the HTML, service-worker, CSS, static-import, dynamic-import, inline-handler, and global-reference inventory.
2. Delete only an item with no remaining load path or caller.
3. Re-run the inventory after each cleanup group to catch indirect dependencies.
4. Keep compatibility exports if runtime-generated markup or external browser entry points still reference them.

The four unreferenced legacy CSS files identified by the audit are candidates for deletion, not automatic deletions; the final reference check decides their disposition. Unused named imports will be removed from their import lists without changing exported module APIs unless the export itself is also confirmed unreachable.

### Fresh Loans collapse behavior

The role-based initial state remains unchanged: administrators see groups collapsed by default unless a stored override exists. The click handler will invert the effective state, not the raw optional stored value. The first click must therefore expand a default-collapsed group, and every later click must alternate predictably.

### PWA and loading behavior

- Application module URLs in the page and service-worker precache will match exactly.
- Performance modules will not append timestamps or other per-open cache-busting parameters.
- The service worker will continue using a versioned application cache and will discard only older application-cache versions.
- Core navigation must remain available after a successful first online load and subsequent offline reload.
- Report-only code should not be downloaded during initial navigation when it can be loaded at the report/export action boundary.

### Accessibility

Clickable header elements will use native buttons or equivalent keyboard-operable semantics without changing their visual function. Icon-only actions will receive accessible names. The shared form modal will expose dialog semantics, a name, and modal state. Form labels will be programmatically associated with their controls. The viewport will allow user zoom, and primary mobile controls will meet a practical minimum touch height without materially redesigning the interface.

Focus behavior will be verified for opening and closing the shared modal. Existing escape-to-close and click-outside behavior will be preserved where present.

### Documentation

The README will describe the actual modular CSS and JavaScript layout, current local-run workflow, PWA behavior, and available verification commands. It will not claim that modules are lazy-loaded unless the final implementation verifies that behavior.

## Data and Control Flow

This pass does not alter application data flow between the UI, state layer, and Firestore. The collapse fix affects only local UI state. Lazy loading affects only when report code becomes available, not the data passed into it. Offline changes affect retrieval of static assets, not Firestore persistence or synchronization.

The removed April JSON files will have no runtime fallback. This is intentional because the fixed recovery actions are stale. The preserved CSV flow remains the supported manual import path.

## Error Handling and Safety

- Dynamic report loading failures will surface through the application's existing user-visible error mechanism and console diagnostics.
- Service-worker installation must fail visibly when a required precache asset is missing, allowing the previous working worker to remain active.
- Cleanup will not execute administrative buttons, imports, notification sends, database wipes, or migration functions.
- Existing uncommitted mockup deletions belong to the user and will not be staged, restored, or modified.
- If a supposedly unused symbol is found in generated markup or a runtime entry point, it will be retained and documented rather than deleted.

## Testing and Verification

Implementation will begin with a failing regression test for the collapse-state transition. The test will cover an absent stored value with both default states plus repeated toggles. A static asset-integrity test will verify that local HTML, manifest, service-worker, CSS, and module references resolve to real files and that removed April assets are no longer referenced.

Verification will include:

- JavaScript syntax checks and JSON parsing checks.
- Automated regression and asset-integrity tests using the Node.js standard test runner.
- A clean local HTTP run with console-error inspection.
- Desktop and mobile smoke checks for Fresh Loans, Renewals, Performance, Settings, and the Add Loan modal.
- Keyboard-only checks for header navigation and modal interaction.
- An online-first/offline-reload PWA check after service-worker activation.
- A final reference scan for the removed files and symbols.
- Review of the final Git diff to ensure the user's pre-existing mockup deletions are not included.

## Acceptance Criteria

- No April 2026 recovery button, dedicated handler, or pending/returns/sanctioned data file remains.
- The June monthly snapshot and generic CSV import remain intact.
- A default-collapsed Fresh Loans group expands on the first activation and alternates correctly afterward.
- Performance navigation no longer uses a timestamped module URL.
- Every precached local asset exists and matches the URL form used by the application.
- A previously loaded application shell can open offline without a missing core-module failure.
- Primary header controls and the shared modal are keyboard accessible and meaningfully named.
- All new automated checks pass, and browser smoke testing produces no new application errors.
- No live Firestore mutation occurs during implementation or verification.
- Only task-related files are staged or committed.

## Follow-up

After this stabilization pass, the highest-priority separate project is a Firebase security migration covering real user authentication, server-enforced roles, Firestore rules, App Check, removal of client-trusted administrator state, and supported Firebase SDK versions.
