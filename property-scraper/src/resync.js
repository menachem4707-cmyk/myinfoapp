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
// Returns 'updated' | 'skipped'. Mutates counters via the returned outcome.
async function applyScrape(property, details, log) {
  // Accept ONLY IF owner_name and name (address) are both non-blank.
  if (isBlank(details.owner_name) || isBlank(details.name)) {
    log(`skip ${property.id}: blank owner or address`);
    return "skipped";
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

  await pool.query(
    `UPDATE properties SET ${sets.join(", ")} WHERE id = $1`,
    params
  );

  log(`update ${property.id}${differs ? " (reviewed=false)" : ""}`);
  return "updated";
}

// Process a single property end-to-end. Returns 'updated' | 'skipped' | 'errored'.
async function processOne(property, log) {
  try {
    const city = property.city_id
      ? { district_code: property.district_code }
      : null;
    const { ok, status, url, details } = await scrapeProperty(property, city);
    log(`fetch ${property.id} -> ${status} ${url}`);

    if (!ok || !details) {
      log(`skip ${property.id}: status ${status} / empty body`);
      return "skipped";
    }

    return await applyScrape(property, details, log);
  } catch (err) {
    log(`error ${property.id}: ${err.message}`);
    return "errored";
  }
}

// Resolve run options from explicit values, falling back to env defaults.
function resolveOptions(options = {}) {
  const limit =
    options.limit !== undefined
      ? parseLimit(options.limit)
      : parseLimit(process.env.RESYNC_LIMIT);
  let delayMs =
    options.delayMs !== undefined
      ? parseInt(options.delayMs, 10)
      : parseInt(process.env.RESYNC_DELAY_MS || "1000", 10);
  if (Number.isNaN(delayMs) || delayMs < 0) delayMs = 0;
  let concurrency =
    options.concurrency !== undefined
      ? parseInt(options.concurrency, 10)
      : parseInt(process.env.RESYNC_CONCURRENCY || "1", 10);
  if (Number.isNaN(concurrency) || concurrency < 1) concurrency = 1;
  if (concurrency > 10) concurrency = 10;
  return { limit, delayMs, concurrency };
}

// Core runner. `controls` = { logger, shouldAbort(), onProgress(counts) }.
async function executeRun(opts, controls = {}) {
  const { limit, delayMs, concurrency } = opts;
  const log = controls.logger || (() => {});
  const shouldAbort = controls.shouldAbort || (() => false);
  const onProgress = controls.onProgress || (() => {});

  const runRes = await pool.query(
    `INSERT INTO resync_runs (status) VALUES ('running') RETURNING id`
  );
  const runId = runRes.rows[0].id;

  const counts = { total: 0, processed: 0, updated: 0, skipped: 0, errored: 0 };

  const persist = async (status) => {
    await pool.query(
      `UPDATE resync_runs
          SET finished_at = now(), total = $2, updated = $3,
              skipped = $4, errored = $5, status = $6
        WHERE id = $1`,
      [runId, counts.total, counts.updated, counts.skipped, counts.errored, status]
    );
  };

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
    log(`starting run #${runId}: ${counts.total} properties, concurrency=${concurrency}, delay=${delayMs}ms`);

    const handle = async (i) => {
      const outcome = await processOne(properties[i], log);
      counts[outcome] += 1;
      counts.processed += 1;
      onProgress({ ...counts, runId });
    };

    if (concurrency <= 1) {
      for (let i = 0; i < properties.length; i++) {
        if (shouldAbort()) break;
        await handle(i);
        if (delayMs > 0 && i < properties.length - 1) await sleep(delayMs);
      }
    } else {
      let cursor = 0;
      const worker = async () => {
        while (true) {
          if (shouldAbort()) break;
          const i = cursor++;
          if (i >= properties.length) break;
          await handle(i);
          if (delayMs > 0) await sleep(delayMs);
        }
      };
      await Promise.all(
        Array.from({ length: concurrency }, () => worker())
      );
    }

    const status = shouldAbort() ? "aborted" : "completed";
    await persist(status);
    log(
      `run #${runId} ${status}: processed=${counts.processed}/${counts.total} updated=${counts.updated} skipped=${counts.skipped} errored=${counts.errored}`
    );
    return { runId, status, ...counts };
  } catch (err) {
    await persist("failed");
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
const runState = {
  running: false,
  runId: null,
  status: "idle", // idle | running | completed | aborted | failed
  total: 0,
  processed: 0,
  updated: 0,
  skipped: 0,
  errored: 0,
  startedAt: null,
  finishedAt: null,
  limit: null,
  delayMs: 1000,
  concurrency: 1,
  aborted: false,
  lastError: null,
};

function getStatus() {
  return { ...runState };
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
    updated: 0,
    skipped: 0,
    errored: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    limit: opts.limit,
    delayMs: opts.delayMs,
    concurrency: opts.concurrency,
    lastError: null,
  });

  executeRun(opts, {
    logger: (m) => console.log(`[resync] ${m}`),
    shouldAbort: () => runState.aborted,
    onProgress: (p) => {
      runState.runId = p.runId;
      runState.total = p.total;
      runState.processed = p.processed || 0;
      runState.updated = p.updated || 0;
      runState.skipped = p.skipped || 0;
      runState.errored = p.errored || 0;
    },
  })
    .then((summary) => {
      runState.status = summary.status;
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
