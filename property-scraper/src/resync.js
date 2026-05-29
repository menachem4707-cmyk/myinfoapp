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

// Run a full resync pass.
// options: { limit, delayMs, concurrency, logger }
async function runResync(options = {}) {
  const limit =
    options.limit !== undefined
      ? options.limit
      : parseLimit(process.env.RESYNC_LIMIT);
  const delayMs =
    options.delayMs !== undefined
      ? options.delayMs
      : parseInt(process.env.RESYNC_DELAY_MS || "1000", 10);
  let concurrency =
    options.concurrency !== undefined
      ? options.concurrency
      : parseInt(process.env.RESYNC_CONCURRENCY || "1", 10);
  if (Number.isNaN(concurrency) || concurrency < 1) concurrency = 1;

  const log = options.logger || ((msg) => console.log(`[resync] ${msg}`));

  // Open a run record.
  const runRes = await pool.query(
    `INSERT INTO resync_runs (status) VALUES ('running') RETURNING id`
  );
  const runId = runRes.rows[0].id;

  const counts = { total: 0, updated: 0, skipped: 0, errored: 0 };

  try {
    const propsRes = await pool.query(
      `SELECT p.*, c.district_code
         FROM properties p
         LEFT JOIN cities c ON c.id = p.city_id
        ORDER BY p.id
        ${limit ? "LIMIT " + limit : ""}`
    );
    const properties = propsRes.rows;
    counts.total = properties.length;
    log(`starting run #${runId}: ${counts.total} properties, concurrency=${concurrency}, delay=${delayMs}ms`);

    if (concurrency <= 1) {
      // Sequential with polite delay.
      for (let i = 0; i < properties.length; i++) {
        const outcome = await processOne(properties[i], log);
        counts[outcome] += 1;
        if (delayMs > 0 && i < properties.length - 1) await sleep(delayMs);
      }
    } else {
      // Bounded concurrency via a shared cursor.
      let cursor = 0;
      const worker = async () => {
        while (true) {
          const i = cursor++;
          if (i >= properties.length) break;
          const outcome = await processOne(properties[i], log);
          counts[outcome] += 1;
          if (delayMs > 0) await sleep(delayMs);
        }
      };
      const workers = [];
      for (let w = 0; w < concurrency; w++) workers.push(worker());
      await Promise.all(workers);
    }

    await pool.query(
      `UPDATE resync_runs
          SET finished_at = now(), total = $2, updated = $3,
              skipped = $4, errored = $5, status = 'completed'
        WHERE id = $1`,
      [runId, counts.total, counts.updated, counts.skipped, counts.errored]
    );

    log(
      `run #${runId} completed: total=${counts.total} updated=${counts.updated} skipped=${counts.skipped} errored=${counts.errored}`
    );
    return { runId, status: "completed", ...counts };
  } catch (err) {
    await pool.query(
      `UPDATE resync_runs
          SET finished_at = now(), total = $2, updated = $3,
              skipped = $4, errored = $5, status = 'failed'
        WHERE id = $1`,
      [runId, counts.total, counts.updated, counts.skipped, counts.errored]
    );
    log(`run #${runId} failed: ${err.message}`);
    throw err;
  }
}

module.exports = { runResync, applyScrape, processOne, COMPARE_FIELDS };
