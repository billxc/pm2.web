import assert from "node:assert/strict";
import { test } from "node:test";

import { matchesProcessName } from "../utils/process-filters.ts";

test("ordered partial process-name matching includes the requested examples", () => {
  for (const name of ["aorg", "orange", "ORANGE", "service-org-worker"]) {
    assert.equal(matchesProcessName(name, "org"), true, name);
  }
  assert.equal(matchesProcessName("orange", " ORG "), true);
  assert.equal(matchesProcessName("orange", "gor"), false);
  assert.equal(matchesProcessName("worker", "org"), false);
});

test("empty searches show all names and punctuation is literal, not a regex", () => {
  assert.equal(matchesProcessName("worker", ""), true);
  assert.equal(matchesProcessName("worker", "   "), true);
  assert.equal(matchesProcessName("service[a].*", "[a].*"), true);
  assert.equal(matchesProcessName("service", ".*"), false);
  assert.equal(matchesProcessName("worker", "["), false);
});
