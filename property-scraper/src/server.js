"use strict";

require("dotenv").config();
const express = require("express");
const { migrate } = require("./migrate");
const { runResync, startResync, getStatus, abortResync } = require("./resync");
const { importData } = require("./importer");

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);
// Bind to localhost only: endpoints are unauthenticated and meant to be
// triggered by cron or manual SSH on the droplet.
const HOST = process.env.HOST || "127.0.0.1";

app.use(express.json({ limit: "50mb" }));

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "property-scraper" });
});

// Bulk import. Body: { cities?: [...], properties?: [...] }
app.post("/import", async (req, res) => {
  try {
    const result = await importData(req.body || {});
    res.json({ ok: true, imported: result });
  } catch (err) {
    console.error("[import]", err);
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Trigger a full resync pass. Optional body overrides:
// { limit, delayMs, concurrency }
app.post("/resync", async (req, res) => {
  try {
    const body = req.body || {};
    const options = {};
    if (body.limit !== undefined) options.limit = body.limit;
    if (body.delayMs !== undefined) options.delayMs = body.delayMs;
    if (body.concurrency !== undefined) options.concurrency = body.concurrency;

    const summary = await runResync(options);
    res.json({ ok: true, run: summary });
  } catch (err) {
    console.error("[resync]", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Start a background resync. Body: { limit, delayMs, concurrency }.
// Returns 409 if a run is already active.
app.post("/resync/start", (req, res) => {
  try {
    const body = req.body || {};
    const options = {};
    if (body.limit !== undefined) options.limit = body.limit;
    if (body.delayMs !== undefined) options.delayMs = body.delayMs;
    if (body.delayMin !== undefined) options.delayMin = body.delayMin;
    if (body.delayMax !== undefined) options.delayMax = body.delayMax;
    if (body.concurrency !== undefined) options.concurrency = body.concurrency;
    if (body.autoAbortAfter !== undefined) options.autoAbortAfter = body.autoAbortAfter;

    const status = startResync(options);
    res.json({ ok: true, status });
  } catch (err) {
    if (err.code === "BUSY") {
      return res.status(409).json({ ok: false, error: err.message, status: getStatus() });
    }
    console.error("[resync/start]", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Live progress of the current/last run.
app.get("/resync/status", (req, res) => {
  res.json(getStatus());
});

// Signal the active run to stop after the in-flight property.
app.post("/resync/abort", (req, res) => {
  const aborted = abortResync();
  res.json({ ok: true, aborted, status: getStatus() });
});

// Run migrations on boot so a fresh deploy is ready, then listen.
async function start() {
  try {
    await migrate();
    console.log("[server] migrations applied");
  } catch (err) {
    console.error("[server] migration failed:", err.message);
  }

  // Any run still marked 'running' at boot is orphaned (the process died
  // mid-run). Close it out so the history doesn't show a stuck run.
  try {
    const { pool } = require("./db");
    const r = await pool.query(
      `UPDATE resync_runs
          SET status = 'failed', finished_at = now(),
              note = COALESCE(note, 'interrupted by service restart')
        WHERE status = 'running'`
    );
    if (r.rowCount) console.log(`[server] closed ${r.rowCount} orphaned run(s)`);
  } catch (err) {
    console.error("[server] orphan cleanup failed:", err.message);
  }

  app.listen(PORT, HOST, () => {
    console.log(`property-scraper listening on http://${HOST}:${PORT}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = { app, start };
