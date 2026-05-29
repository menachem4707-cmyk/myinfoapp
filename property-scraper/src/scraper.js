"use strict";

const { buildUrl } = require("./urlBuilder");
const { extractDetails } = require("./extractor");

// HTTP GET a property's computed URL.
// Node 18+ global fetch (undici) transparently decompresses gzip/deflate/br.
// Returns { status, body, ok } where ok = status 200 AND non-empty body.
async function fetchProperty(url) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Accept-Encoding": "gzip, deflate, br",
      Connection: "keep-alive",
    },
  });

  const body = await res.text();
  const ok = res.status === 200 && body != null && body.length > 0;
  return { status: res.status, body, ok };
}

// Scrape a single property. `property` needs { block, lot }; `city` needs
// { district_code }. Returns:
//   { url, status, ok, details }  on a successful fetch+parse
//   { url, status, ok: false, details: null }  on non-200 / empty body
async function scrapeProperty(property, city) {
  const url = buildUrl(
    property.block,
    property.lot,
    city ? city.district_code : null
  );

  const { status, body, ok } = await fetchProperty(url);
  if (!ok) {
    return { url, status, ok: false, details: null };
  }

  return { url, status, ok: true, details: extractDetails(body) };
}

module.exports = { fetchProperty, scrapeProperty };
