"use strict";

// Exact port of the Salesforce `Url__c` formula field.
// Builds the taxrecords-nj.com scrape URL from a property's block, lot,
// and its city's district_code.

// Left-pad string `s` with `pad` to length `n` (unchanged if already >= n).
function LPAD(s, n, pad = "0") {
  s = String(s);
  if (s.length >= n) return s;
  return pad.repeat(n - s.length) + s;
}

// First `n` characters of `s`.
function LEFT(s, n) {
  return String(s).slice(0, Math.max(0, n));
}

// Last `n` characters of `s`.
function RIGHT(s, n) {
  s = String(s);
  if (n <= 0) return "";
  return s.slice(Math.max(0, s.length - n));
}

// block/lot "period" flag: contains a '.'.
function hasPeriod(s) {
  return String(s == null ? "" : s).includes(".");
}

// Build the scrape URL. Mirrors the Salesforce formula byte-for-byte.
function buildUrl(block, lot, districtCode) {
  const district = String(districtCode == null ? "" : districtCode);
  const blockStr = String(block == null ? "" : block);
  const lotStr = String(lot == null ? "" : lot);

  const blockPeriod = hasPeriod(blockStr);
  const lotPeriod = hasPeriod(lotStr);

  const base =
    "https://taxrecords-nj.com/pub/cgi/m4.cgi?district=" +
    district +
    "&l02=" +
    district;

  // Block segment
  const blockSeg = !blockPeriod
    ? LPAD(blockStr, 5, "0") + "____"
    : LPAD(LEFT(blockStr, blockStr.length - 3), 5, "0") +
      "__" +
      RIGHT(blockStr, 2);

  // Lot segment
  const lotSeg = !lotPeriod
    ? LPAD(lotStr, 5, "0")
    : LPAD(LEFT(lotStr, lotStr.length - 3), 5, "0") +
      "__" +
      RIGHT(lotStr, 2) +
      "_____M";

  // Trailing segment
  const tailSeg = !lotPeriod ? "_________M" : "";

  return base + blockSeg + lotSeg + tailSeg + "&hist=0";
}

module.exports = { LPAD, LEFT, RIGHT, hasPeriod, buildUrl };
