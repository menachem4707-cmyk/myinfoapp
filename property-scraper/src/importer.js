"use strict";

const fs = require("fs");
const path = require("path");
const { pool } = require("./db");
const {
  parseCsv,
  remapRecord,
  CITY_COLS,
  PROPERTY_COLS,
} = require("./csv");

const BOOLEAN_COLS = new Set(["reviewed", "yiddish", "bobov"]);

function coerceBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value == null || value === "") return null;
  const v = String(value).trim().toLowerCase();
  if (["true", "t", "1", "yes", "y"].includes(v)) return true;
  if (["false", "f", "0", "no", "n"].includes(v)) return false;
  return null;
}

// Upsert a single record (already remapped to DB columns) into `table`,
// only touching the provided allowed columns. Conflict on id updates them.
async function upsertRow(client, table, allowedCols, record) {
  const cols = allowedCols.filter((c) =>
    Object.prototype.hasOwnProperty.call(record, c)
  );
  if (!cols.includes("id")) {
    throw new Error(`record for ${table} is missing required "id"`);
  }

  const values = cols.map((c) => {
    let v = record[c];
    if (BOOLEAN_COLS.has(c)) v = coerceBoolean(v);
    if (v === "") v = null;
    return v;
  });

  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const updateCols = cols.filter((c) => c !== "id");
  const updateClause = updateCols.length
    ? "DO UPDATE SET " +
      updateCols.map((c) => `${c} = EXCLUDED.${c}`).join(", ")
    : "DO NOTHING";

  await client.query(
    `INSERT INTO ${table} (${cols.join(", ")})
       VALUES (${placeholders.join(", ")})
     ON CONFLICT (id) ${updateClause}`,
    values
  );
}

const TABLE_FOR_TYPE = { cities: "cities", properties: "properties" };
const COLS_FOR_TYPE = { cities: CITY_COLS, properties: PROPERTY_COLS };

// Import an array of records of a given type (cities|properties).
// Remaps Salesforce headers -> DB columns, upserts per row, captures errors.
async function importRecords(client, type, records, report, logger) {
  const table = TABLE_FOR_TYPE[type];
  const allowedCols = COLS_FOR_TYPE[type];
  let ok = 0;

  for (let i = 0; i < records.length; i++) {
    const { record, unmapped } = remapRecord(records[i], type);
    for (const u of unmapped) report.unmapped[type].add(u);

    try {
      await upsertRow(client, table, allowedCols, record);
      ok += 1;
    } catch (err) {
      report.errors.push({
        type,
        id: record.id,
        message: err.message,
      });
    }

    if (logger && (i + 1) % 1000 === 0) {
      logger(`${type}: ${i + 1}/${records.length} processed`);
    }
  }

  return ok;
}

// Import cities then properties (order matters for the FK).
// data: { cities?: [...], properties?: [...] }
// Returns { cities, properties, errors, unmapped }.
async function importData(data, logger) {
  const report = {
    cities: 0,
    properties: 0,
    errors: [],
    unmapped: { cities: new Set(), properties: new Set() },
  };

  const client = await pool.connect();
  try {
    if (data.cities && data.cities.length) {
      report.cities = await importRecords(
        client,
        "cities",
        data.cities,
        report,
        logger
      );
    }
    if (data.properties && data.properties.length) {
      report.properties = await importRecords(
        client,
        "properties",
        data.properties,
        report,
        logger
      );
    }
  } finally {
    client.release();
  }

  return {
    cities: report.cities,
    properties: report.properties,
    errors: report.errors,
    unmapped: {
      cities: Array.from(report.unmapped.cities),
      properties: Array.from(report.unmapped.properties),
    },
  };
}

// Import from a file.
//   .json -> { cities, properties } object, or a bare array (needs `type`)
//   .csv  -> needs `type` ('cities' | 'properties')
async function importFromFile(filePath, type, logger) {
  const ext = path.extname(filePath).toLowerCase();
  let raw = fs.readFileSync(filePath, "utf8");
  raw = raw.replace(/^\uFEFF/, "");

  let data;
  if (ext === ".json") {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      if (!type) {
        throw new Error(
          "JSON array given without a type; pass 'cities' or 'properties'"
        );
      }
      data = { [type]: parsed };
    } else {
      data = parsed;
    }
  } else if (ext === ".csv") {
    if (!type) {
      throw new Error("CSV import requires a type: 'cities' or 'properties'");
    }
    data = { [type]: parseCsv(raw) };
  } else {
    throw new Error(`unsupported file type: ${ext} (use .json or .csv)`);
  }

  return importData(data, logger);
}

module.exports = {
  importData,
  importFromFile,
  upsertRow,
  CITY_COLS,
  PROPERTY_COLS,
};
