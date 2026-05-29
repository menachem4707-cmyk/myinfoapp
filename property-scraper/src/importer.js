"use strict";

const fs = require("fs");
const path = require("path");
const { pool } = require("./db");

const CITY_COLS = ["id", "name", "district_code"];
const PROPERTY_COLS = [
  "id",
  "name",
  "city_id",
  "block",
  "lot",
  "owner_name",
  "owner_street",
  "city_state",
  "sale_date",
  "sale_price",
  "reviewed",
  "last_run_date_time",
  "notes",
  "yiddish",
  "bobov",
];
const BOOLEAN_COLS = new Set(["reviewed", "yiddish", "bobov"]);

function coerceBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value == null || value === "") return null;
  const v = String(value).trim().toLowerCase();
  if (["true", "t", "1", "yes", "y"].includes(v)) return true;
  if (["false", "f", "0", "no", "n"].includes(v)) return false;
  return null;
}

// Upsert a single record into `table`, only touching the provided allowed
// columns. Conflict on id updates those columns.
async function upsertRow(table, allowedCols, record) {
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

  await pool.query(
    `INSERT INTO ${table} (${cols.join(", ")})
       VALUES (${placeholders.join(", ")})
     ON CONFLICT (id) ${updateClause}`,
    values
  );
}

// Import cities then properties (order matters for the FK).
// data: { cities?: [...], properties?: [...] }
async function importData(data) {
  const result = { cities: 0, properties: 0 };

  for (const city of data.cities || []) {
    await upsertRow("cities", CITY_COLS, city);
    result.cities += 1;
  }
  for (const property of data.properties || []) {
    await upsertRow("properties", PROPERTY_COLS, property);
    result.properties += 1;
  }

  return result;
}

// Minimal RFC-4180-ish CSV parser (handles quoted fields, commas, newlines).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // ignore; handled by \n
    } else {
      field += ch;
    }
  }
  // last field/row (if file doesn't end with newline)
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const obj = {};
    header.forEach((key, idx) => {
      obj[key] = cells[idx] !== undefined ? cells[idx] : null;
    });
    return obj;
  });
}

// Import from a file.
//   .json -> { cities, properties } or a bare array (needs `type`)
//   .csv  -> needs `type` ('cities' | 'properties')
async function importFromFile(filePath, type) {
  const ext = path.extname(filePath).toLowerCase();
  const raw = fs.readFileSync(filePath, "utf8");

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

  return importData(data);
}

module.exports = {
  importData,
  importFromFile,
  parseCsv,
  upsertRow,
  CITY_COLS,
  PROPERTY_COLS,
};
