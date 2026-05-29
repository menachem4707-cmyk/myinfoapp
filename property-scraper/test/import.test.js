"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { parseCsv, remapRecord, deriveCities } = require("../src/csv");

test("parseCsv reads headers and rows, handling quotes and CRLF", () => {
  const csv =
    'Id,Name,District_Code__c\r\n' +
    'a01,"Lakewood, Twp",2009\r\n' +
    "a02,Linden,0907\r\n";
  const rows = parseCsv(csv);
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows[0], {
    Id: "a01",
    Name: "Lakewood, Twp",
    District_Code__c: "2009",
  });
  assert.strictEqual(rows[1].Name, "Linden");
});

test("parseCsv strips a leading BOM from the first header", () => {
  const csv = "\uFEFFId,Name\n1,Test\n";
  const rows = parseCsv(csv);
  assert.deepStrictEqual(Object.keys(rows[0]), ["Id", "Name"]);
});

test("parseCsv skips blank trailing lines", () => {
  const csv = "Id,Name\n1,A\n\n";
  const rows = parseCsv(csv);
  assert.strictEqual(rows.length, 1);
});

test("remapRecord maps Salesforce city headers to DB columns", () => {
  const { record, unmapped } = remapRecord(
    { Id: "a01", Name: "Lakewood", District_Code__c: "2009" },
    "cities"
  );
  assert.deepStrictEqual(record, {
    id: "a01",
    name: "Lakewood",
    district_code: "2009",
  });
  assert.deepStrictEqual(unmapped, []);
});

test("remapRecord maps Salesforce property headers (City__c -> city_id)", () => {
  const { record, unmapped } = remapRecord(
    {
      Id: "a02",
      Name: "123 MAIN ST",
      City__c: "a01",
      Block__c: "388",
      Lot__c: "12",
      Yiddish__c: "true",
      Some_Other__c: "x",
    },
    "properties"
  );
  assert.strictEqual(record.id, "a02");
  assert.strictEqual(record.city_id, "a01");
  assert.strictEqual(record.block, "388");
  assert.strictEqual(record.lot, "12");
  // Truly unknown columns are reported, not silently included.
  assert.deepStrictEqual(unmapped, ["Some_Other__c"]);
});

test("remapRecord ignores Salesforce formula/audit columns silently", () => {
  const { record, unmapped } = remapRecord(
    {
      Id: "a02",
      Price__c: "150000",
      Date_Of_Sale__c: "2021-01-01",
      Block_Period__c: "false",
      Lot_Period__c: "false",
      Url__c: "http://x",
      CreatedDate: "2021-01-01",
    },
    "properties"
  );
  assert.deepStrictEqual(record, { id: "a02" });
  assert.deepStrictEqual(unmapped, []);
});

test("remapRecord carries City__r.* relationship hints", () => {
  const { record } = remapRecord(
    {
      Id: "a02",
      Block__c: "87",
      Lot__c: "1",
      "City__r.Name": "Linden",
      "City__r.District_Code__c": "2009",
    },
    "properties"
  );
  assert.strictEqual(record.__city_name, "Linden");
  assert.strictEqual(record.__city_district, "2009");
});

test("deriveCities builds distinct cities keyed by district code", () => {
  const props = [
    { id: "p1", __city_name: "Linden", __city_district: "2009" },
    { id: "p2", __city_name: "Linden", __city_district: "2009" },
    { id: "p3", __city_name: "Lakewood", __city_district: "1515" },
    { id: "p4" }, // no district -> ignored
  ];
  const cities = deriveCities(props);
  assert.strictEqual(cities.length, 2);
  assert.deepStrictEqual(cities[0], {
    id: "2009",
    name: "Linden",
    district_code: "2009",
  });
  assert.deepStrictEqual(cities[1], {
    id: "1515",
    name: "Lakewood",
    district_code: "1515",
  });
});

test("remapRecord is case-insensitive and accepts DB column names directly", () => {
  const { record } = remapRecord(
    { id: "a03", BLOCK__C: "5", city_id: "a01" },
    "properties"
  );
  assert.deepStrictEqual(record, { id: "a03", block: "5", city_id: "a01" });
});
