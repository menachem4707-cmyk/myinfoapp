"use strict";

// Ports of the Salesforce formula fields that are derived (not stored).
// These compute on read. The URL formula lives in urlBuilder.js.

// Block_Period__c / Lot_Period__c: value contains a '.'.
function blockPeriod(block) {
  return String(block == null ? "" : block).includes(".");
}

function lotPeriod(lot) {
  return String(lot == null ? "" : lot).includes(".");
}

// Date_Of_Sale__c: parse sale_date "MM/DD/YY" into a real Date (UTC).
//   year  = RIGHT(sale_date, 2) + (yy > 35 ? 1900 : 2000)
//   month = LEFT(sale_date, 2)
//   day   = MID(sale_date, 4, 2)   (Salesforce MID is 1-indexed)
// Returns a Date, or null if sale_date is blank / not in MM/DD/YY shape.
function dateOfSale(saleDate) {
  const s = String(saleDate == null ? "" : saleDate).trim();
  if (!/^\d{2}\/\d{2}\/\d{2}/.test(s)) return null;

  const month = parseInt(s.slice(0, 2), 10);
  const day = parseInt(s.slice(3, 5), 10);
  const yy = parseInt(s.slice(6, 8), 10);
  if (Number.isNaN(month) || Number.isNaN(day) || Number.isNaN(yy)) return null;

  const year = yy > 35 ? 1900 + yy : 2000 + yy;
  return new Date(Date.UTC(year, month - 1, day));
}

// Price__c: numeric value of sale_price (strip everything but digits and '.').
// Returns a Number, or null if there is no numeric content.
function price(salePrice) {
  if (salePrice == null) return null;
  const cleaned = String(salePrice).replace(/[^0-9.]/g, "");
  if (cleaned === "" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}

module.exports = { blockPeriod, lotPeriod, dateOfSale, price };
