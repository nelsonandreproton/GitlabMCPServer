/**
 * usage.js — anonymous daily usage tracking for the MCP gateway.
 *
 * Counts distinct users per UTC day. A "user" is identified by a one-way
 * SHA-256 hash of their GitLab token — the raw token is NEVER stored. GitLab
 * PATs carry ~120 bits of entropy, so the hash is irreversible in practice.
 *
 * On-disk format (JSON), keyed by UTC date:
 *   { "2026-06-01": ["<hash>", "<hash>", ...], ... }
 *
 * The stats view returns COUNTS only, never the hashes:
 *   { "2026-06-01": 5, ... }
 *
 * State is persisted to STATS_FILE, which must live on a Docker named volume
 * so it survives container recreation on deploy.
 */

const fs = require("fs");
const crypto = require("crypto");

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** UTC date string YYYY-MM-DD. Inject `now` for testability. */
function utcDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

class UsageTracker {
  /**
   * @param {string} filePath  where to persist the JSON state
   */
  constructor(filePath) {
    this.filePath = filePath;
    this.data = this._load();
  }

  _load() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch {
      // Missing or corrupt file → start fresh. (First run, or volume wiped.)
      return {};
    }
  }

  _persist() {
    // Write atomically: temp file + rename, so a crash mid-write can't corrupt
    // the stats and lose all history.
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.filePath);
  }

  /**
   * Record one request from the given token. Idempotent within a UTC day:
   * the same token on the same day is counted once.
   * @returns {boolean} true if this was a newly-seen user today
   */
  record(token, now = new Date()) {
    const day = utcDate(now);
    const hash = hashToken(token);
    const seen = this.data[day] || [];
    if (seen.includes(hash)) return false;
    seen.push(hash);
    this.data[day] = seen;
    this._persist();
    return true;
  }

  /** @returns {Object<string, number>} { date: distinctUserCount } */
  stats() {
    const out = {};
    for (const [day, hashes] of Object.entries(this.data)) {
      out[day] = hashes.length;
    }
    return out;
  }
}

module.exports = { UsageTracker, hashToken, utcDate };
