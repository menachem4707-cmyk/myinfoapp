"use strict";

const fs = require("fs");
const path = require("path");
const { pool } = require("./db");
const {
  parseCsv,
  remapRecord,
  deriveCities,
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

// Upsert a list of remapped city records. Returns count of successes.
async function upsertCities(client, cities, report) {
  let ok = 0;
  for (const city of cities) {
    try {
      await upsertRow(client, "cities", CITY_COLS, city);
      ok += 1;
    } catch (err) {
      report.errors.push({ type: "cities", id: city.id, message: err.message });
    }
  }
  return ok;
}

// Import cities then properties (order matters for the FK).
// data: { cities?: [...], properties?: [...] }
// Properties that carry City__r.* relationship columns auto-derive their city.
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
    // 1) Explicit cities file, if provided.
    if (data.cities && data.cities.length) {
      const remappedCities = data.cities.map((raw) => {
        const { record, unmapped } = remapRecord(raw, "cities");
        unmapped.forEach((u) => report.unmapped.cities.add(u));
        return record;
      });
      report.cities += await upsertCities(client, remappedCities, report);
    }

    // 2) Properties: remap up front, derive any cities from relationship cols.
    if (data.properties && data.properties.length) {
      const remapped = data.properties.map((raw) => {
        const { record, unmapped } = remapRecord(raw, "properties");
        unmapped.forEach((u) => report.unmapped.properties.add(u));
        return record;
      });

      const derived = deriveCities(remapped);
      if (derived.length) {
        const n = await upsertCities(client, derived, report);
        report.cities += n;
        if (logger) logger(`derived ${n} cities from property rows`);
      }

      for (let i = 0; i < remapped.length; i++) {
        const rec = remapped[i];
        if (rec.__city_district != null && rec.city_id == null) {
          rec.city_id = String(rec.__city_district).trim() || null;
        }
        delete rec.__city_name;
        delete rec.__city_district;

        try {
          await upsertRow(client, "properties", PROPERTY_COLS, rec);
          report.properties += 1;
        } catch (err) {
          report.errors.push({
            type: "properties",
            id: rec.id,
            message: err.message,
          });
        }

        if (logger && (i + 1) % 1000 === 0) {
          logger(`properties: ${i + 1}/${remapped.length} processed`);
        }
      }
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
