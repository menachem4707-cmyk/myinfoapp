"use strict";

const fs = require("fs");
const path = require("path");
const { pool } = require("./db");

const SCHEMA_PATH = path.join(__dirname, "..", "sql", "schema.sql");

// Apply sql/schema.sql (idempotent: uses CREATE TABLE IF NOT EXISTS etc.).
async function migrate() {
  const sql = fs.readFileSync(SCHEMA_PATH, "utf8");
  await pool.query(sql);
  return { applied: SCHEMA_PATH };
}

module.exports = { migrate };
