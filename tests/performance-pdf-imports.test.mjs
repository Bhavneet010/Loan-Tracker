import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const utilsSource = await readFile(new URL("../js/performance-utils.js", import.meta.url), "utf8");

// The detailed MTD PDF builds its officer list from S.officers; without this
// import the export threw "S is not defined" and always failed.
test("performance utils imports the shared state it reads", () => {
  assert.match(utilsSource, /\bS\.officers\b/);
  assert.match(utilsSource, /^import \{ S \} from "\.\/state\.js";$/m);
});
