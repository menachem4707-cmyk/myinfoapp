"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { extractValue, extractDetails } = require("../src/extractor");
const { dateOfSale, price } = require("../src/derived");

const SAMPLE = fs.readFileSync(
  path.join(__dirname, "fixtures", "sample.html"),
  "utf8"
);

test("extractValue returns null when the start tag is missing", () => {
  assert.strictEqual(extractValue("nothing here", "Owner: </font> </td>", "</font>"), null);
});

test("extractValue returns null when the end tag is missing", () => {
  const html = "Owner: </font> </td>JOHN DOE (no closing tag)";
  assert.strictEqual(extractValue(html, "Owner: </font> </td>", "</font>"), null);
});

test("extractValue strips the FIREBRICK <td> marker", () => {
  const html =
    "Owner: </font> </td><td nowrap> <font size=2 face=verdana color=FIREBRICK>JOHN DOE</font>";
  assert.strictEqual(extractValue(html, "Owner: </font> </td>", "</font>"), "JOHN DOE");
});

test("extractValue strips &nbsp and newlines", () => {
  const html =
    "Price: </font> </td><td nowrap> <font size=2 face=verdana color=FIREBRICK>$150,000&nbsp\r\n</font>";
  assert.strictEqual(extractValue(html, "Price: </font> </td>", "</font>"), "$150,000");
});

test("extractDetails parses all six fields from the fixture", () => {
  const d = extractDetails(SAMPLE);
  assert.strictEqual(d.owner_name, "DOE JOHN &amp; JANE");
  assert.strictEqual(d.name, "123 MAIN ST");
  assert.strictEqual(d.owner_street, "123 MAIN ST");
  assert.strictEqual(d.city_state, "LAKEWOOD NJ 08701");
  assert.strictEqual(d.sale_date, "06/15/21");
  assert.strictEqual(d.sale_price, "$150,000");
});

test("dateOfSale parses MM/DD/YY with the 35 pivot", () => {
  assert.deepStrictEqual(dateOfSale("06/15/21"), new Date(Date.UTC(2021, 5, 15)));
  assert.deepStrictEqual(dateOfSale("01/02/99"), new Date(Date.UTC(1999, 0, 2)));
  assert.deepStrictEqual(dateOfSale("12/31/36"), new Date(Date.UTC(1936, 11, 31)));
  assert.deepStrictEqual(dateOfSale("12/31/35"), new Date(Date.UTC(2035, 11, 31)));
  assert.strictEqual(dateOfSale(""), null);
  assert.strictEqual(dateOfSale(null), null);
});

test("price strips non-numeric characters", () => {
  assert.strictEqual(price("$150,000"), 150000);
  assert.strictEqual(price("1,234.56"), 1234.56);
  assert.strictEqual(price(""), null);
  assert.strictEqual(price(null), null);
});
