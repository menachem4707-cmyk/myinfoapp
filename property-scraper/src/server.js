"use strict";

require("dotenv").config();
const express = require("express");
const { migrate } = require("./migrate");
const { runResync } = require("./resync");
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

// Run migrations on boot so a fresh deploy is ready, then listen.
async function start() {
  try {
    await migrate();
    console.log("[server] migrations applied");
  } catch (err) {
    console.error("[server] migration failed:", err.message);
  }

  app.listen(PORT, HOST, () => {
    console.log(`property-scraper listening on http://${HOST}:${PORT}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = { app, start };
