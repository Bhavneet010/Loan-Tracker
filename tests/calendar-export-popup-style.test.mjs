import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const calendarCss = await readFile(new URL("../css/calendar.css", import.meta.url), "utf8");

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = calendarCss.match(new RegExp(`${escaped}\\{([^}]+)\\}`));
  assert.ok(match, `Missing CSS rule for ${selector}`);
  return match[1].replace(/\s+/g, "");
}

test("the multi-month selector uses the compact desktop scale", () => {
  assert.match(rule(".cal-multi-modal"), /width:min\(380px,90vw\)/);
  assert.match(rule(".cal-multi-modal"), /max-height:min\(620px,86vh\)/);
  assert.match(rule(".cal-multi-modal"), /gap:9px/);
  assert.match(rule(".cal-multi-modal"), /padding:14px/);
  assert.match(rule(".cal-multi-head h2"), /font-size:16px/);
  assert.match(rule(".cal-multi-head p"), /font-size:10px/);
  assert.match(rule(".cal-multi-icon-btn"), /width:38px;height:38px/);
  assert.match(rule(".cal-multi-month"), /min-height:50px/);
  assert.match(rule(".cal-multi-month-name"), /font-size:12px/);
  assert.match(rule(".cal-multi-month-count"), /font-size:10px/);
});

test("the compact mobile selector retains touch-friendly controls", () => {
  const mobileStart = calendarCss.indexOf("@media(max-width:480px)");
  assert.notEqual(mobileStart, -1, "Missing mobile selector styles");
  const mobileCss = calendarCss.slice(mobileStart, calendarCss.indexOf(".cal-month-label", mobileStart));

  assert.match(mobileCss, /\.cal-multi-modal\{width:min\(90vw,380px\);max-height:90vh;padding:12px;gap:8px;\}/);
  assert.match(mobileCss, /\.cal-multi-icon-btn\{width:44px;height:44px;\}/);
  assert.match(mobileCss, /\.cal-multi-month\{min-height:48px;padding:6px;\}/);
  assert.match(mobileCss, /\.cal-multi-actions \.btn\{min-height:44px;\}/);
});
