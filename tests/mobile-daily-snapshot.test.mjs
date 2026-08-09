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
