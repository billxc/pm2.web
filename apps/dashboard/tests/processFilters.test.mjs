import assert from "node:assert/strict";
import { test } from "node:test";

import { matchesProcessName } from "../utils/process-filters.ts";

test("unspaced queries match contiguous substrings, ignoring case and outer whitespace", () => {
  assert.equal(matchesProcessName("service-WEB-worker", " web "), true);
  assert.equal(matchesProcessName("aorg", "org"), true);
  assert.equal(matchesProcessName("orange", "org"), false);
  assert.equal(matchesProcessName("window-service-backend", "web"), false);
});

test("spaces allow gaps between ordered literal chunks, not inside each chunk", () => {
  assert.equal(matchesProcessName("window-service-backend", "w e b"), true);
  assert.equal(matchesProcessName("window-service-backend", "we b"), false);
  assert.equal(matchesProcessName("orange", "o r g"), true);
  assert.equal(matchesProcessName("WEB-worker-dashboard", " web  dash "), true);
  assert.equal(matchesProcessName("WEB-worker-dashboard", "web\t\ndash"), true);
  assert.equal(matchesProcessName("WEB-worker-dashboard", "dash web"), false);
  assert.equal(matchesProcessName("web", "web web"), false);
});

test("empty searches show all names and punctuation is literal, not a regex", () => {
  assert.equal(matchesProcessName("worker", ""), true);
  assert.equal(matchesProcessName("worker", "   "), true);
  assert.equal(matchesProcessName("service[a].*", "[a].*"), true);
  assert.equal(matchesProcessName("service", ".*"), false);
  assert.equal(matchesProcessName("worker", "["), false);
});
