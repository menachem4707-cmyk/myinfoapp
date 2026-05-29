"use strict";

// CSV parsing + Salesforce-field -> DB-column mapping.
// No database dependency so it can be unit tested in isolation.

// DB columns per table.
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

function norm(h) {
  return String(h == null ? "" : h)
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase();
}

// Salesforce field name -> DB column. Keyed by normalized header.
// DB column names themselves also map to themselves (added below).
const CITY_ALIASES = {
  id: "id",
  name: "name",
  district_code__c: "district_code",
  "district code": "district_code",
};

const PROPERTY_ALIASES = {
  id: "id",
  name: "name",
  city__c: "city_id",
  block__c: "block",
  lot__c: "lot",
  owner_name__c: "owner_name",
  owner_street__c: "owner_street",
  city_state__c: "city_state",
  sale_date__c: "sale_date",
  sale_price__c: "sale_price",
  reviewed__c: "reviewed",
  last_run_date_time__c: "last_run_date_time",
  notes__c: "notes",
  yiddish__c: "yiddish",
  bobov__c: "bobov",
  // Relationship columns (no City__c Id in the export): carry city name +
  // district code as hints so the importer can auto-derive the city row.
  "city__r.name": "__city_name",
  "city__r.district_code__c": "__city_district",
  "city__r.district_code": "__city_district",
};

// Salesforce formula / audit columns we intentionally skip (computed on read
// or not stored). Listed so they are NOT reported as surprising "unmapped".
const IGNORED_COLS = {
  cities: new Set(["createddate", "lastmodifieddate", "isdeleted"]),
  properties: new Set([
    "price__c",
    "date_of_sale__c",
    "block_period__c",
    "lot_period__c",
    "url__c",
    "createddate",
    "lastmodifieddate",
    "isdeleted",
  ]),
};

function buildAliasMap(cols, aliases) {
  const map = {};
  for (const col of cols) map[norm(col)] = col; // db name -> itself
  for (const [k, v] of Object.entries(aliases)) map[norm(k)] = v;
  return map;
}

const ALIAS_MAPS = {
  cities: buildAliasMap(CITY_COLS, CITY_ALIASES),
  properties: buildAliasMap(PROPERTY_COLS, PROPERTY_ALIASES),
};

// Remap one record's keys (Salesforce headers) to DB columns for `type`.
// Returns { record: {dbCol: value}, unmapped: [originalHeader, ...] }.
// Known formula/audit columns are skipped silently (not reported as unmapped).
function remapRecord(record, type) {
  const aliasMap = ALIAS_MAPS[type];
  if (!aliasMap) throw new Error(`unknown import type: ${type}`);
  const ignored = IGNORED_COLS[type] || new Set();

  const out = {};
  const unmapped = [];
  for (const [key, value] of Object.entries(record)) {
    const n = norm(key);
    const dbCol = aliasMap[n];
    if (dbCol) {
      out[dbCol] = value;
    } else if (!ignored.has(n)) {
      unmapped.push(key);
    }
  }
  return { record: out, unmapped };
}

// Minimal RFC-4180-ish CSV parser (handles quoted fields, commas, CRLF, BOM).
function parseCsv(text) {
  text = String(text).replace(/^\uFEFF/, "");
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
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return [];
  const header = rows[0].map((h) => String(h).replace(/^\uFEFF/, "").trim());
  return rows
    .slice(1)
    .filter((cells) => !(cells.length === 1 && cells[0] === "")) // drop blank lines
    .map((cells) => {
      const obj = {};
      header.forEach((key, idx) => {
        obj[key] = cells[idx] !== undefined ? cells[idx] : null;
      });
      return obj;
    });
}

// Derive distinct city rows from remapped property records that carry the
// relationship hints (__city_district / __city_name). Keyed by district code,
// which is used as the synthetic city id (the export has no City__c Id).
function deriveCities(remappedProperties) {
  const map = new Map();
  for (const r of remappedProperties) {
    const district =
      r.__city_district != null ? String(r.__city_district).trim() : "";
    if (!district) continue;
    if (!map.has(district)) {
      map.set(district, {
        id: district,
        name: r.__city_name != null ? String(r.__city_name).trim() : null,
        district_code: district,
      });
    }
  }
  return Array.from(map.values());
}

module.exports = {
  parseCsv,
  remapRecord,
  deriveCities,
  CITY_COLS,
  PROPERTY_COLS,
  ALIAS_MAPS,
  IGNORED_COLS,
};
