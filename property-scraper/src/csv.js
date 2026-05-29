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
function remapRecord(record, type) {
  const aliasMap = ALIAS_MAPS[type];
  if (!aliasMap) throw new Error(`unknown import type: ${type}`);

  const out = {};
  const unmapped = [];
  for (const [key, value] of Object.entries(record)) {
    const dbCol = aliasMap[norm(key)];
    if (dbCol) {
      out[dbCol] = value;
    } else {
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

module.exports = {
  parseCsv,
  remapRecord,
  CITY_COLS,
  PROPERTY_COLS,
  ALIAS_MAPS,
};
