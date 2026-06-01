/**
 * Tests for usage.js — run with: node --test
 * Uses Node's built-in test runner (no dependencies).
 */

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { UsageTracker, hashToken, utcDate } = require("./usage.js");

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "usage-")), "stats.json");
}

const D1 = new Date("2026-06-01T10:00:00Z");
const D1_LATE = new Date("2026-06-01T23:59:00Z");
const D2 = new Date("2026-06-02T00:01:00Z");

test("hashToken is deterministic and one-way (no raw token in output)", () => {
  const h = hashToken("glpat-secret123");
  assert.strictEqual(h, hashToken("glpat-secret123"));
  assert.strictEqual(h.length, 64); // sha256 hex
  assert.ok(!h.includes("secret"));
});

test("utcDate returns YYYY-MM-DD in UTC", () => {
  assert.strictEqual(utcDate(D1), "2026-06-01");
  assert.strictEqual(utcDate(D1_LATE), "2026-06-01");
  assert.strictEqual(utcDate(D2), "2026-06-02");
});

test("distinct users counted once per day; same token deduped", () => {
  const t = new UsageTracker(tmpFile());
  assert.strictEqual(t.record("userA", D1), true);  // new
  assert.strictEqual(t.record("userA", D1), false); // same day, same user
  assert.strictEqual(t.record("userB", D1), true);  // new
  assert.deepStrictEqual(t.stats(), { "2026-06-01": 2 });
});

test("same user on a different day counts again (per-day)", () => {
  const t = new UsageTracker(tmpFile());
  t.record("userA", D1);
  t.record("userA", D2);
  assert.deepStrictEqual(t.stats(), { "2026-06-01": 1, "2026-06-02": 1 });
});

test("state persists across tracker instances (survives container restart)", () => {
  const f = tmpFile();
  const t1 = new UsageTracker(f);
  t1.record("userA", D1);
  t1.record("userB", D1);
  // New instance reads from disk — simulates a redeploy with a named volume.
  const t2 = new UsageTracker(f);
  assert.deepStrictEqual(t2.stats(), { "2026-06-01": 2 });
  assert.strictEqual(t2.record("userA", D1), false); // still deduped after reload
});

test("missing file starts empty, does not throw", () => {
  const t = new UsageTracker(path.join(os.tmpdir(), "does-not-exist-" + Date.now(), "x.json"));
  assert.deepStrictEqual(t.stats(), {});
});

test("stats() exposes counts only, never the hashes", () => {
  const t = new UsageTracker(tmpFile());
  t.record("userA", D1);
  const s = t.stats();
  assert.strictEqual(typeof s["2026-06-01"], "number");
  assert.ok(!JSON.stringify(s).includes(hashToken("userA")));
});
