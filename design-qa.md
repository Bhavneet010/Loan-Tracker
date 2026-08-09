# Mobile Daily Snapshot Design QA

## Current QA — Real-phone density follow-up (9 August 2026)

This pass supersedes the earlier 361 px / 2 x 2 glance-grid notes below. The compact approved composition now applies to the complete in-app mobile range through 560 CSS px; export-only layouts remain excluded.

**Matched-state comparison**

- Approved visual target: `C:\Users\bhavn\.codex\generated_images\019fe536-7733-7b53-a46a-252e5e93f49f\exec-96d25c61-4f5b-475b-8a2d-7cbe7ca84bd2.png`.
- Reported phone result before this fix: `C:\Users\bhavn\Downloads\Mobile Devices\Screenshot_2026-08-09-14-25-19-77_40deb401b9ffe8e1df2f1cc5ba480b12.jpg`.
- Final in-app Browser capture: `C:\Users\bhavn\.codex\visualizations\2026\08\09\019fe536-7733-7b53-a46a-252e5e93f49f\mobile-density-final-391-v2.png` (391 x 844 CSS px).
- Required combined comparison input: `C:\Users\bhavn\.codex\visualizations\2026\08\09\019fe536-7733-7b53-a46a-252e5e93f49f\mobile-density-comparison-v2.png` (approved target | reported phone result | final implementation).
- State: light theme, Performance -> Daily Snapshot, Daily selected, live 9 August 2026 data.
- Browser: Codex in-app Browser, explicit 320 / 391 / 430 / 480 / 560 / 562 CSS-px viewport checks.

**Visible result and measurements**

- At 391 px the summary is 67.8 px high, date 22.4 px, Top Fresh Performer 48 px, and Today at a Glance 104.8 px. Officers begin at y=331.4 and the first original granular card at y=364.0.
- The reported over-spaced state had a 121.3 px summary, 70.5 px performer strip, 156.4 px glance section, and officers beginning around y=500. The excess vertical space is removed.
- The four glance metrics remain in one row at every tested mobile width. Grid cell widths are 70.2 px at 320, 88 px at 391, 97.8 px at 430, 110.2 px at 480, and 130.2 px at 560.
- At 320, 391, 430, 480, and 560 px, page overflow is zero and the mobile descendant overflow list is empty. At 562 px, the mobile view is hidden and the original desktop top, leaders, officer stack, and footer return.
- The original officer-card renderer, field order, category/status tiles, Renewal Book metrics, and live data are unchanged. The export renderer and export JavaScript were not modified; all density selectors exclude `.snapshot-export` and `.daily-jpeg-export`.

**Interaction and runtime evidence**

- Daily, Weekly, and Monthly tabs each selected and rendered their existing reports; the test returned to Daily successfully.
- Browser logs contained no errors. Only the pre-existing Firebase warning about future `enableIndexedDbPersistence()` deprecation appeared.
- Combined-image inspection found no remaining P0, P1, or P2 fidelity issue. Live overdue totals differ from the approved mock because the app is displaying current records, not mock data.

**Findings**

- No actionable P0, P1, or P2 findings remain after the narrow-width iteration.

**Comparison Target**

- Source visual truth: `C:\Users\bhavn\.codex\generated_images\019fe536-7733-7b53-a46a-252e5e93f49f\exec-96d25c61-4f5b-475b-8a2d-7cbe7ca84bd2.png` (886 x 1775 px).
- Original officer-card reference 1: `C:\Users\bhavn\Downloads\Mobile Devices\Screenshot_2026-08-09-12-00-47-62_40deb401b9ffe8e1df2f1cc5ba480b12.jpg` (1080 x 2376 px).
- Original officer-card reference 2: `C:\Users\bhavn\Downloads\Mobile Devices\Screenshot_2026-08-09-12-00-51-24_40deb401b9ffe8e1df2f1cc5ba480b12.jpg` (1080 x 2376 px).
- Implementation URL: `http://127.0.0.1:4175/`.
- Final CSS-normalized implementation captures:
  - `artifacts/mobile-daily-snapshot-320-light-final-css.png` (320 x 844 px).
  - `artifacts/mobile-daily-snapshot-360-light-final-css.png` (360 x 844 px).
  - `artifacts/mobile-daily-snapshot-391-light-narrow-final-css.png` (391 x 844 px).
  - `artifacts/mobile-daily-snapshot-320-light-officer-final-css.png` (320 x 844 px, scrolled officer detail).
- Full comparison: `artifacts/mobile-daily-snapshot-narrow-comparison-final.jpg` (2400 x 2800 px).
- Focused officer comparison: `artifacts/mobile-daily-snapshot-officer-comparison-final.jpg` (2400 x 1400 px).
- State: light theme, Performance -> Daily Snapshot, Daily selected, live 9 August 2026 data.

**Browser Choice and Density Normalization**

The Codex in-app Browser was unavailable during the original verification, so the permitted Codex Desktop fallback was used: Chrome through the documented `browser-client` surface only. No standalone Playwright process or external browser controller was used.

Chrome's viewport capability ran at browser-reported DPR 0.75. Physical override inputs of 240, 270, and 293 px produced true `window.innerWidth` values of 320, 360, and 391 CSS px. The corresponding raw screenshot canvases were 427 x 1125, 480 x 1125, and 521 x 1125 px. Chrome placed the CSS-sized page image at the upper-left and left extra blank capture pixels to the right and bottom. The `*-css.png` evidence therefore crops each raw canvas to the measured CSS viewport (320/360/391 x 844) without scaling. This preserves a 1:1 CSS-pixel comparison and avoids density or blank-canvas artifacts.

**Responsive Measurements**

| CSS viewport | Daily presentation | Overflow/intersection result | Layout result |
|---|---|---|---|
| 320 x 844 | Mobile | document, report, and all mobile descendants have `scrollWidth == clientWidth`; no brand/MTD or performer intersections | 2 x 2 glance grid; performer label wraps safely; original Renewal Book metrics use the full card width |
| 360 x 844 | Mobile | no horizontal overflow or intersections | 2 x 2 glance grid; stacked performer metric; brand and tagline readable |
| 391 x 844 | Mobile | no horizontal overflow; brand tagline 122/122 client/scroll px; performer label ends at x160.7 and metric starts at x171.9 | Approved four-column glance and horizontal performer metric retained |
| 560 x 933 | Mobile | no horizontal overflow or intersections | Mobile view visible; desktop report regions hidden |
| 562 x 933 | Desktop | mobile view hidden | Original top, leaders, officer stack, footer, and both officer cards visible |

Chrome initially reported `innerWidth: 360` while `(max-width:360px)` was false because of fractional device-density quantization. The narrow guard is intentionally 361 px so a true reported 360 px viewport reliably receives the narrow layout without changing the approved 391 px composition.

**Full-view Comparison Evidence**

`artifacts/mobile-daily-snapshot-narrow-comparison-final.jpg` places the approved mock, the 391/360/320 browser captures, and both original screenshots in one comparison input. The 391 px view retains the approved hierarchy: brand/Fresh MTD, date, compact Top Fresh Performer strip, four-column Today at a Glance, and original officer stack. At 360 and 320 px, only the summary density adapts: the glance metrics become a 2 x 2 grid and performer values stack so every label and amount remains legible. The live overdue value is 188 / Rs 1,606.43L rather than the mock's 107 / Rs 935.15L because the implementation correctly totals the current live officer records; this is expected data variance.

**Focused Region Comparison Evidence**

`artifacts/mobile-daily-snapshot-officer-comparison-final.jpg` compares the final 320 and 391 officer regions with the original granular officer screenshot in one input. Both officers retain the ordinal, name, sanctioned amount/count, `Sanctioned by category / count / Rs lakhs`, three category tiles, three status tiles, and the three Renewal Book metrics. At 320 px the existing Renewal Book DOM is not rewritten; its label occupies a full row so the same three original values have enough width. This focused comparison was necessary because full-view captures make the officer amounts too small to judge reliably.

**Required Fidelity Surfaces**

- Fonts and typography: the Outfit/Inter hierarchy, Devanagari brand, numeric emphasis, weights, labels, and uppercase tracking remain consistent. No text truncates, clips, or intersects at 320, 360, 391, or 560 px.
- Spacing and layout rhythm: the 391 px composition keeps the approved single-row performer metric and four-column glance. Tighter 430 px spacing and the 361 px reflow are limited to the mobile non-export view. Card radii, shadows, section dividers, and officer spacing remain consistent.
- Colors and visual tokens: purple brand controls, deep-navy performer strip, green success values, red overdue/fresh-today emphasis, and pastel category tiles match the approved direction and original cards.
- Image quality and asset fidelity: the supplied Nirnay logo and `assets/snapshot/top-performer-bg.png` remain real assets. The trophy is reduced only at phone widths so it does not collide with the metric text.
- Copy and content: all app-specific labels remain unchanged. The granular officer vocabulary, field order, live data, and renderer are intact.
- Responsiveness and accessibility: no child clipping, text intersection, or internal horizontal overflow remains at the required widths. Weekly and Monthly tabs still select and render their existing views. At 562 px the original desktop presentation returns immediately above the mobile gate.

**Comparison History**

1. Original matched-state pass found a P2 Top Fresh Performer height/trophy mismatch. The strip was compacted and the real trophy asset was scaled to fit.
2. The first post-fix pass found a P2 wrapped performer label. Space was reserved and the 391 px label was kept on one line.
3. Final-review measurements found a P2 narrow-width regression: at 320/360 px fixed padding and nowrap text clipped the brand, performer, glance, and Renewal Book values. A failing regression test was added, then tightly scoped 361/340 px reflows were implemented.
4. The first 320 px post-fix browser pass still found `Top Fresh Performer` at scrollWidth 121 inside 110 px. A second failing test was added; the <=340 px label now wraps, after which the mobile descendant overflow list was empty.
5. The first true 360 px pass found the DPR media-query boundary described above. A failing test changed the guarded contract to 361 px; the 360 px recheck passed with zero overflow and a 2 x 2 glance grid.
6. Exact text bounds at 391 px then exposed a 4 px brand-tag clip and about 9 px of performer-label/metric overlap that earlier box-level checks missed. A third failing test added <=430 px gap and metric-padding compaction. The final pass records brand 122/122 px and an 11.2 px label-to-metric gap, with the approved 391 px layout otherwise unchanged.
7. Final combined and focused comparisons found no remaining P0/P1/P2 issue.
8. The user then supplied a real-phone capture showing the 391–430 px composition still used the older large vertical spacing. A failing regression assertion broadened the compact contract beyond the former 361 px guard.
9. The final pass applies the approved density through the full 560 px in-app mobile range. The combined approved/before/after comparison and 320/391/430/480/560/562 browser measurements found no remaining P0/P1/P2 issue.

**Primary Interactions Tested**

- Opened Performance and rendered Daily Snapshot from live app data.
- Selected Weekly and confirmed the existing weekly report and selector rendered.
- Selected Monthly and confirmed the existing historical snapshot dashboard rendered.
- Returned to Daily and verified the original desktop presentation at 562 px.
- Verified both original officer cards and every granular field in the browser DOM.
- Verified the mobile/desktop switch at 560/562 px. Export code and export-only source files were not modified; all new CSS selectors explicitly exclude `.snapshot-export` and `.daily-jpeg-export`.

**Console Errors Checked**

- No app rendering error occurred during Daily/Weekly/Monthly or responsive checks.
- Chrome logged one extension message-channel closure after automation tab churn; it had no app stack, UI failure, or source-code location and is a browser-extension artifact rather than an application error.

**Open Questions**

- None for the mobile Daily Snapshot design.

**Follow-up Polish**

- [P3] The approved mock includes small decorative calendar/star/trophy heading icons that remain omitted; they do not affect comprehension or responsive acceptance.
- [P3] The 320 px view necessarily wraps the brand tagline and section heading, while preserving their full copy and hierarchy.

final result: passed
