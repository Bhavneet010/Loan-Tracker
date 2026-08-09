import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const snapshotSource = await readFile(new URL("../js/performance-snapshot.js", import.meta.url), "utf8");
const snapshotCss = await readFile(new URL("../css/snapshot-report.css", import.meta.url), "utf8");
const performanceSource = await readFile(new URL("../js/performance.js", import.meta.url), "utf8");
const compactCss = snapshotCss.replace(/\s+/g, "");
const mobileRendererSource = snapshotSource.slice(
  snapshotSource.indexOf("function renderEditorialMobileView"),
  snapshotSource.indexOf("function buildEditorialShareMockupHtml"),
);

test("daily snapshot renders a dedicated mobile presentation from the same report", () => {
  assert.match(snapshotSource, /function renderEditorialMobileView\(report, topFresh\)/);
  assert.match(snapshotSource, /class="editorial-mobile-view"/);
  assert.match(snapshotSource, /renderEditorialMobileView\(report, topFresh\)/);
  assert.match(snapshotSource, /report\.officerCards\.map\(\(card, index\) => renderEditorialOfficerCard\(card, index\)\)/);
});

test("mobile renderer preserves the brand and empty-performer labels", () => {
  assert.match(mobileRendererSource, /<strong><span>निर्णय<\/span><\/strong>/);
  assert.match(mobileRendererSource, /topFresh \? topFresh\.name : "—"/);
  assert.doesNotMatch(mobileRendererSource, /à¤¨à¤¿à¤°à¥à¤£à¤¯/);
  assert.doesNotMatch(mobileRendererSource, /â€”/);
});

test("mobile presentation is isolated from desktop and export layouts", () => {
  assert.match(compactCss, /\.editorial-mobile-view\{display:none;/);
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

test("mobile summary follows the approved readable phone scale", () => {
  assert.match(compactCss, /\.editorial-mobile-summary\{[^}]*padding:24px16px18px/);
  assert.match(compactCss, /\.editorial-mobile-mtd>strong\{[^}]*font-size:28px/);
  assert.match(compactCss, /\.editorial-mobile-top-performer\{[^}]*min-height:64px/);
  assert.match(compactCss, /\.editorial-mobile-top-performer\{[^}]*background-size:auto100%/);
  assert.match(compactCss, /\.editorial-mobile-top-performer>div:first-childspan\{[^}]*white-space:nowrap/);
  assert.match(compactCss, /\.editorial-mobile-top-metric\{[^}]*grid-template-columns:autoauto/);
  assert.match(compactCss, /\.editorial-mobile-glance-grid\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(compactCss, /\.editorial-mobile-officer-list\{[^}]*gap:12px/);
});

test("narrow phones reflow summary metrics before text can intersect", () => {
  assert.match(
    compactCss,
    /@media\(max-width:361px\).*\.editorial-mobile-brandsmall\{[^}]*white-space:normal/,
  );
  assert.match(
    compactCss,
    /@media\(max-width:361px\).*\.editorial-mobile-top-metric\{[^}]*grid-template-columns:1fr/,
  );
  assert.match(
    compactCss,
    /@media\(max-width:361px\).*\.editorial-mobile-top-metricspan\{[^}]*border-left:0/,
  );
  assert.match(
    compactCss,
    /@media\(max-width:361px\).*\.editorial-mobile-glance-grid\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,
  );
});

test("approved phone composition reserves label room at 391px", () => {
  assert.match(
    compactCss,
    /@media\(max-width:430px\).*\.editorial-mobile-summary\{[^}]*gap:10px/,
  );
  assert.match(
    compactCss,
    /@media\(max-width:430px\).*\.editorial-mobile-brand\{[^}]*gap:8px/,
  );
  assert.match(
    compactCss,
    /@media\(max-width:430px\).*\.editorial-mobile-top-metric\{[^}]*column-gap:6px[^}]*padding:4px28px4px8px/,
  );
});

test("very narrow phones give original renewal metrics full card width", () => {
  assert.match(
    compactCss,
    /@media\(max-width:340px\).*\.editorial-mobile-top-performer>div:first-childspan\{[^}]*white-space:normal/,
  );
  assert.match(
    compactCss,
    /@media\(max-width:340px\).*\.editorial-mobile-view\.editorial-renewal-row\{[^}]*grid-template-columns:1fr/,
  );
  assert.match(
    compactCss,
    /@media\(max-width:340px\).*\.editorial-mobile-view\.editorial-renewal-metrics\{[^}]*grid-column:1/,
  );
});

test("mobile officers keep the original granular renderer and three-column groups", () => {
  assert.match(snapshotSource, /<div class="editorial-pills-grid">/);
  assert.match(snapshotSource, /<div class="editorial-status-strip">/);
  assert.match(snapshotSource, /<div class="editorial-renewal-row">/);
  assert.doesNotMatch(snapshotSource, /Status Summary/);
  assert.doesNotMatch(snapshotSource, /editorial-mobile-officer-card/);
});
