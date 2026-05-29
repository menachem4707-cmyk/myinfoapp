"use strict";

const { pool } = require("./db");
const { scrapeProperty } = require("./scraper");

// Fields compared (trimmed) to decide whether to flip reviewed -> false,
// and the fields we persist on accept.
const COMPARE_FIELDS = [
  "owner_name",
  "owner_street",
  "city_state",
  "sale_price",
  "sale_date",
  "name",
];

function norm(v) {
  return String(v == null ? "" : v).trim();
}

function isBlank(v) {
  return norm(v) === "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Parse RESYNC_LIMIT: empty/0/NaN -> null (ALL properties).
function parseLimit(raw) {
  if (raw == null || raw === "") return null;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) return null;
  return n;
}

// Apply the scraped details to one property row.
// Returns { outcome: 'changed' | 'same' | 'errored', reason? }.
async function applyScrape(property, details, log) {
  // A good response must carry an owner and an address; otherwise it is not a
  // usable record and counts as an error (not a silent skip).
  if (isBlank(details.owner_name) || isBlank(details.name)) {
    log(`error ${property.id}: blank owner or address`);
    return { outcome: "errored", reason: "empty response (no owner/address)" };
  }

  // reviewed -> false if ANY compared field differs from stored value.
  let differs = false;
  for (const field of COMPARE_FIELDS) {
    if (norm(details[field]) !== norm(property[field])) {
      differs = true;
      break;
    }
  }

  const sets = [
    "owner_name = $2",
    "name = $3",
    "owner_street = $4",
    "city_state = $5",
    "sale_price = $6",
    "sale_date = $7",
    "last_run_date_time = now()",
  ];
  const params = [
    property.id,
    details.owner_name,
    details.name,
    details.owner_street,
    details.city_state,
    details.sale_price,
    details.sale_date,
  ];

  // Only touch reviewed when scraped data differs from stored data.
  if (differs) {
    sets.push("reviewed = false");
  }

  const updateSql = `UPDATE properties SET ${sets.join(", ")} WHERE id = $1`;

  if (differs) {
    // Snapshot the pre-update values into property_history, then update, in
    // one transaction so a history row never exists without its change.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO property_history
           (property_id, name, owner_name, owner_street, city_state,
            sale_date, sale_price, last_run_date_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          property.id,
          property.name,
          property.owner_name,
          property.owner_street,
          property.city_state,
          property.sale_date,
          property.sale_price,
          property.last_run_date_time,
        ]
      );
      await client.query(updateSql, params);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } else {
    await pool.query(updateSql, params);
  }

  log(`update ${property.id}${differs ? " (reviewed=false, history saved)" : " (same)"}`);
  return { outcome: differs ? "changed" : "same" };
}

// Process a single property end-to-end.
// Returns { outcome: 'changed' | 'same' | 'errored', url, status, reason? }.
async function processOne(property, log) {
  let url = null;
  let status = null;
  try {
    const city = property.city_id
      ? { district_code: property.district_code }
      : null;
    const r = await scrapeProperty(property, city);
    url = r.url;
    status = r.status;
    log(`fetch ${property.id} -> ${status} ${url}`);

    // No usable response: HTTP error status or empty body.
    if (!r.ok || !r.details) {
      const empty = status === 200;
      const reason = empty ? "empty response body" : "HTTP " + status;
      log(`error ${property.id}: ${reason}`);
      return { outcome: "errored", url, status, reason, empty };
    }

    const res = await applyScrape(property, r.details, log);
    // A 200 that parsed but has no owner/address is also an "empty" signal.
    return {
      outcome: res.outcome,
      url,
      status,
      reason: res.reason,
      empty: res.outcome === "errored",
    };
  } catch (err) {
    // No response at all: connection refused, DNS, TLS, timeout, etc.
    log(`error ${property.id}: ${err.message}`);
    return {
      outcome: "errored",
      url,
      status,
      reason: err.message || "request failed",
      empty: false,
    };
  }
}

function toInt(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

// Resolve run options from explicit values, falling back to env defaults.
// Delay is a range [delayMin, delayMax]; each request waits a random amount in
// that range to look less like a fixed-rate bot.
function resolveOptions(options = {}) {
  const limit =
    options.limit !== undefined
      ? parseLimit(options.limit)
      : parseLimit(process.env.RESYNC_LIMIT);

  // Accept delayMin/delayMax, or a single delayMs (used for both), or env.
  let delayMin =
    options.delayMin !== undefined
      ? toInt(options.delayMin, 1000)
      : options.delayMs !== undefined
      ? toInt(options.delayMs, 1000)
      : toInt(process.env.RESYNC_DELAY_MIN_MS || process.env.RESYNC_DELAY_MS, 1000);
  let delayMax =
    options.delayMax !== undefined
      ? toInt(options.delayMax, delayMin)
      : options.delayMs !== undefined
      ? toInt(options.delayMs, delayMin)
      : toInt(process.env.RESYNC_DELAY_MAX_MS || process.env.RESYNC_DELAY_MS, 5000);
  if (delayMin < 0) delayMin = 0;
  if (delayMax < delayMin) delayMax = delayMin;

  let concurrency =
    options.concurrency !== undefined
      ? toInt(options.concurrency, 1)
      : toInt(process.env.RESYNC_CONCURRENCY, 1);
  if (concurrency < 1) concurrency = 1;
  if (concurrency > 10) concurrency = 10;

  // Auto-abort after this many consecutive empty responses (0 = disabled).
  let autoAbortAfter =
    options.autoAbortAfter !== undefined
      ? toInt(options.autoAbortAfter, 10)
      : toInt(process.env.RESYNC_AUTO_ABORT_EMPTIES, 10);
  if (autoAbortAfter < 0) autoAbortAfter = 0;

  return { limit, delayMin, delayMax, concurrency, autoAbortAfter };
}

// Random integer delay in [min, max].
function pickDelay(min, max) {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

// Core runner. `controls` = { logger, shouldAbort(), onProgress(counts), onError(err) }.
async function executeRun(opts, controls = {}) {
  const { limit, delayMin, delayMax, concurrency, autoAbortAfter } = opts;
  const log = controls.logger || (() => {});
  const shouldAbort = controls.shouldAbort || (() => false);
  const onProgress = controls.onProgress || (() => {});
  const onError = controls.onError || (() => {});

  const runRes = await pool.query(
    `INSERT INTO resync_runs (status) VALUES ('running') RETURNING id`
  );
  const runId = runRes.rows[0].id;

  const counts = { total: 0, processed: 0, changed: 0, same: 0, errored: 0 };

  const persist = async (status, note) => {
    await pool.query(
      `UPDATE resync_runs
          SET finished_at = now(), total = $2, changed = $3,
              same = $4, errored = $5, status = $6, note = $7
        WHERE id = $1`,
      [runId, counts.total, counts.changed, counts.same, counts.errored, status, note || null]
    );
  };

  // Auto-abort guard: too many empty responses in a row almost certainly means
  // the source is rate-limiting/blocking us, not that the parcels are empty.
  let consecutiveEmpty = 0;
  let autoAbort = false;
  let autoAbortNote = null;

  try {
    // Oldest first: never-run properties (NULL last_run) come first, then the
    // ones whose data is most stale. p.id breaks ties for a stable order.
    const propsRes = await pool.query(
      `SELECT p.*, c.district_code
         FROM properties p
         LEFT JOIN cities c ON c.id = p.city_id
        ORDER BY p.last_run_date_time ASC NULLS FIRST, p.id ASC
        ${limit ? "LIMIT " + limit : ""}`
    );
    const properties = propsRes.rows;
    counts.total = properties.length;
    onProgress({ ...counts, runId });
    log(`starting run #${runId}: ${counts.total} properties, concurrency=${concurrency}, delay=${delayMin}-${delayMax}ms, autoAbortAfter=${autoAbortAfter}`);

    const handle = async (i) => {
      const p = properties[i];
      const r = await processOne(p, log);
      counts[r.outcome] += 1;
      counts.processed += 1;
      if (r.outcome === "errored") {
        onError({
          id: p.id,
          name: p.name,
          url: r.url,
          status: r.status,
          reason: r.reason,
          at: new Date().toISOString(),
        });
      }
      // Track consecutive empty responses for the auto-abort guard.
      if (r.empty) {
        consecutiveEmpty += 1;
        if (autoAbortAfter > 0 && consecutiveEmpty >= autoAbortAfter && !autoAbort) {
          autoAbort = true;
          autoAbortNote = `Auto-aborted after ${consecutiveEmpty} consecutive empty responses (source likely rate-limiting).`;
          log(`run #${runId}: ${autoAbortNote}`);
        }
      } else {
        consecutiveEmpty = 0;
      }
      onProgress({ ...counts, runId });
    };

    const stop = () => shouldAbort() || autoAbort;

    if (concurrency <= 1) {
      for (let i = 0; i < properties.length; i++) {
        if (stop()) break;
        await handle(i);
        if (!stop() && i < properties.length - 1) await sleep(pickDelay(delayMin, delayMax));
      }
    } else {
      let cursor = 0;
      const worker = async () => {
        while (true) {
          if (stop()) break;
          const i = cursor++;
          if (i >= properties.length) break;
          await handle(i);
          if (!stop()) await sleep(pickDelay(delayMin, delayMax));
        }
      };
      await Promise.all(
        Array.from({ length: concurrency }, () => worker())
      );
    }

    const status = stop() ? "aborted" : "completed";
    const note = autoAbort ? autoAbortNote : null;
    await persist(status, note);
    log(
      `run #${runId} ${status}: processed=${counts.processed}/${counts.total} changed=${counts.changed} same=${counts.same} errored=${counts.errored}`
    );
    return { runId, status, note, autoAborted: autoAbort, ...counts };
  } catch (err) {
    await persist("failed", err.message);
    log(`run #${runId} failed: ${err.message}`);
    throw err;
  }
}

// Blocking full run (used by the CLI and the legacy /resync endpoint).
async function runResync(options = {}) {
  const opts = resolveOptions(options);
  const log = options.logger || ((msg) => console.log(`[resync] ${msg}`));
  return executeRun(opts, { logger: log });
}

// ---- Background run management (single active run) for the HTTP API ----
// Cap the error list kept in memory so a huge run can't balloon the process.
const MAX_ERRORS = 500;

const runState = {
  running: false,
  runId: null,
  status: "idle", // idle | running | completed | aborted | failed
  total: 0,
  processed: 0,
  changed: 0,
  same: 0,
  errored: 0,
  startedAt: null,
  finishedAt: null,
  limit: null,
  delayMin: 1000,
  delayMax: 5000,
  concurrency: 1,
  autoAbortAfter: 10,
  aborted: false,
  note: null,
  lastError: null,
  errors: [],
};

function getStatus() {
  return { ...runState, errors: runState.errors.slice(0, 200) };
}

function abortResync() {
  if (!runState.running) return false;
  runState.aborted = true;
  return true;
}

// Kick off a run in the background; returns the initial status snapshot.
function startResync(options = {}) {
  if (runState.running) {
    const e = new Error("A resync is already running");
    e.code = "BUSY";
    throw e;
  }
  const opts = resolveOptions(options);
  Object.assign(runState, {
    running: true,
    aborted: false,
    status: "running",
    runId: null,
    total: 0,
    processed: 0,
    changed: 0,
    same: 0,
    errored: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    limit: opts.limit,
    delayMin: opts.delayMin,
    delayMax: opts.delayMax,
    concurrency: opts.concurrency,
    autoAbortAfter: opts.autoAbortAfter,
    note: null,
    lastError: null,
    errors: [],
  });

  executeRun(opts, {
    logger: (m) => console.log(`[resync] ${m}`),
    shouldAbort: () => runState.aborted,
    onProgress: (p) => {
      runState.runId = p.runId;
      runState.total = p.total;
      runState.processed = p.processed || 0;
      runState.changed = p.changed || 0;
      runState.same = p.same || 0;
      runState.errored = p.errored || 0;
    },
    onError: (e) => {
      if (runState.errors.length < MAX_ERRORS) runState.errors.push(e);
    },
  })
    .then((summary) => {
      runState.status = summary.status;
      runState.note = summary.note || null;
    })
    .catch((err) => {
      runState.status = "failed";
      runState.lastError = err.message;
    })
    .finally(() => {
      runState.running = false;
      runState.finishedAt = new Date().toISOString();
    });

  return getStatus();
}

module.exports = {
  runResync,
  startResync,
  getStatus,
  abortResync,
  applyScrape,
  processOne,
  COMPARE_FIELDS,
};
