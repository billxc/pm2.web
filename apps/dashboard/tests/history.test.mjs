import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HISTORY_RANGES,
  historyPipeline,
  historyPoints,
  historyWindow,
  latestPipeline,
} from "../server/helpers/history.ts";
import { historyCoverage, historyTime } from "../utils/history.ts";

const now = Date.parse("2026-06-18T12:34:56.789Z");

test("host capacity is returned only for authorized host-source queries, not process sources", () => {
  const host = latestPipeline({ "source.server": "server" }, "source.server", now);
  assert.deepEqual(host[2].$group.memoryMax, { $first: "$memoryMax" });
  assert.deepEqual(host[3].$group.memoryMax, { $avg: "$memoryMax" });
  assert.equal(host[4].$project.memoryMax, 1);
  const process = latestPipeline({ "source.process": "process" }, "source.process", now);
  assert.equal(process[2].$group.memoryMax, undefined);
  assert.equal(process[3].$group.memoryMax, undefined);
  assert.equal(process[4].$project.memoryMax, undefined);
});

test("fixed hour/day/week bucket mapping and bounded UTC slots", () => {
  const expected = {
    hour: [3_600_000, 30_000, 120],
    day: [86_400_000, 300_000, 288],
    week: [604_800_000, 3_600_000, 168],
  };
  for (const [range, [durationMs, bucketMs, count]] of Object.entries(expected)) {
    assert.equal(HISTORY_RANGES[range].durationMs, durationMs);
    const window = historyWindow(range, now);
    const points = historyPoints(window, []);
    assert.equal(window.bucketMs, bucketMs);
    assert.equal(window.maxPoints, count);
    assert.equal(points.length, count);
    assert.equal(points[0].timestamp, window.start);
    assert.equal(points.at(-1).timestamp, Math.floor(now / bucketMs) * bucketMs);
    assert.ok(points.every((p) => p.timestamp <= now && p.timestamp % bucketMs === 0));
    assert.ok(points.every((p) => p.cpu === null && p.memory === null && p.sources === 0));
    assert.equal(new Set(points.map((p) => p.timestamp)).size, count);
  }
});

test("boundaries include current partial bucket and exclude out-of-window rows", () => {
  for (const range of Object.keys(HISTORY_RANGES)) {
    for (const time of [now, Date.parse("2026-06-18T12:00:00.000Z"), Date.parse("2026-06-18T23:59:59.999Z")]) {
      const window = historyWindow(range, time);
      const row = (timestamp, cpu = 12) => ({
        timestamp: new Date(timestamp),
        cpu,
        memory: 0,
        heapUsed: null,
        uptime: 0,
        sources: 1,
        samples: 3,
      });
      const last = window.start + (window.maxPoints - 1) * window.bucketMs;
      const points = historyPoints(window, [
        row(window.start),
        row(last, 0),
        row(window.start - window.bucketMs, 99),
        row(last + window.bucketMs, 99),
      ]);
      assert.equal(points.length, window.maxPoints);
      assert.equal(points[0].cpu, 12);
      assert.equal(points[0].memory, 0); // A real zero is not missing data.
      assert.equal(points.at(-1).cpu, 0);
      assert.equal(points[1].cpu, null); // Never interpolate or backfill.
      assert.equal(points[0].heapUsed, null);
      assert.equal(points.filter((p) => p.sources).length, 2);
    }
  }
});

test("Mongo pipeline bounds timestamps before grouping and limits final buckets", () => {
  for (const range of Object.keys(HISTORY_RANGES)) {
    const window = historyWindow(range, now);
    const source = { "source.server": "server", "source.process": { $exists: false } };
    const pipeline = historyPipeline(source, "source.server", window);
    assert.deepEqual(pipeline[0].$match, {
      ...source,
      timestamp: { $gte: new Date(window.start), $lte: new Date(now) },
    });
    assert.equal(pipeline[1].$group._id.source, "$source.server");
    assert.equal(pipeline[1].$group._id.bucket.$subtract[1].$mod[1], window.bucketMs);
    assert.deepEqual(pipeline[2].$group.cpu, { $avg: "$cpu" }); // Not a mislabeled total.
    assert.deepEqual(pipeline[3], { $sort: { _id: 1 } });
    assert.deepEqual(pipeline[4], { $limit: window.maxPoints });
  }
});

test("UTC labels distinguish midnight and DST, and insufficient history stays explicit", () => {
  assert.equal(historyTime(Date.parse("2026-03-29T00:59:00Z")), "03-29 00:59:00 UTC");
  assert.equal(historyTime(Date.parse("2026-03-29T01:00:00Z")), "03-29 01:00:00 UTC");
  assert.notEqual(historyTime(Date.parse("2026-06-17T12:00:00Z")), historyTime(Date.parse("2026-06-18T12:00:00Z")));
  assert.notEqual(historyTime(now), historyTime(now + 30_000)); // Half-minute buckets stay distinct.
  assert.match(historyCoverage(0, 168), /No history/);
  assert.match(historyCoverage(24, 168), /24\/168/);
});
