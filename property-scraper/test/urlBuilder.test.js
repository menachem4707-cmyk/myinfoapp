"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { LPAD, LEFT, RIGHT, hasPeriod, buildUrl } = require("../src/urlBuilder");

const BASE = "https://taxrecords-nj.com/pub/cgi/m4.cgi?district=2009&l02=2009";

test("LPAD pads to length and leaves longer strings unchanged", () => {
  assert.strictEqual(LPAD("388", 5, "0"), "00388");
  assert.strictEqual(LPAD("12", 5, "0"), "00012");
  assert.strictEqual(LPAD("123456", 5, "0"), "123456");
});

test("LEFT and RIGHT take prefix/suffix characters", () => {
  assert.strictEqual(LEFT("388.01", "388.01".length - 3), "388");
  assert.strictEqual(RIGHT("388.01", 2), "01");
});

test("hasPeriod detects a '.'", () => {
  assert.strictEqual(hasPeriod("388"), false);
  assert.strictEqual(hasPeriod("388.01"), true);
});

test("non-period block and lot match the spec example shape", () => {
  // block 388, lot 12, district 2009
  const url = buildUrl("388", "12", "2009");
  assert.strictEqual(
    url,
    BASE + "00388____" + "00012" + "_________M" + "&hist=0"
  );
});

test("period block uses __ + RIGHT(block,2) segment", () => {
  // block 388.01 (period), lot 12 (no period)
  const url = buildUrl("388.01", "12", "2009");
  assert.strictEqual(
    url,
    BASE + "00388__01" + "00012" + "_________M" + "&hist=0"
  );
});

test("period lot uses __RIGHT(lot,2)_____M and drops the trailing segment", () => {
  // block 388 (no period), lot 12.02 (period)
  const url = buildUrl("388", "12.02", "2009");
  assert.strictEqual(
    url,
    BASE + "00388____" + "00012__02_____M" + "" + "&hist=0"
  );
});

test("period block and period lot combine both special segments", () => {
  const url = buildUrl("388.01", "12.02", "2009");
  assert.strictEqual(
    url,
    BASE + "00388__01" + "00012__02_____M" + "&hist=0"
  );
});
