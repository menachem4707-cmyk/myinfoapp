"use strict";

// Port of PropertyDetailsExtractor.extractDetails / extractValue.
// Parses property fields out of the taxrecords-nj.com HTML response using a
// simple "between two markers" routine.

const FIREBRICK_TD =
  "<td nowrap> <font size=2 face=verdana color=FIREBRICK>";

// extractValue(content, startTag, endTag):
//   - find startTag; if missing -> null
//   - advance past startTag
//   - find endTag from there; if missing -> null
//   - take the substring between them, trim
//   - remove the FIREBRICK <td> marker and '&nbsp'
//   - strip '\r', '\n', literal '0x0D0A', then trim again
function extractValue(content, startTag, endTag) {
  if (content == null) return null;
  const text = String(content);

  const startIdx = text.indexOf(startTag);
  if (startIdx === -1) return null;

  const from = startIdx + startTag.length;
  const endIdx = text.indexOf(endTag, from);
  if (endIdx === -1) return null;

  let value = text.slice(from, endIdx).trim();

  value = value.split(FIREBRICK_TD).join("");
  value = value.split("&nbsp").join("");
  value = value.split("\r").join("");
  value = value.split("\n").join("");
  value = value.split("0x0D0A").join("");

  return value.trim();
}

const END_TAG = "</font>";

const FIELD_MARKERS = {
  owner_name: "Owner: </font> </td>",
  name: "Prop Loc: </font> </td>",
  owner_street: "Street: </font> </td>",
  city_state: "City State: </font> </td>",
  sale_date: "Sale Date: </font> </td>",
  sale_price: "Price: </font> </td>",
};

// extractDetails(html): returns an object with the six parsed fields
// (each value is a string or null).
function extractDetails(html) {
  const details = {};
  for (const [field, startTag] of Object.entries(FIELD_MARKERS)) {
    details[field] = extractValue(html, startTag, END_TAG);
  }
  return details;
}

module.exports = { extractValue, extractDetails, FIELD_MARKERS, END_TAG };
