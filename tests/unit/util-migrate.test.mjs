import test from "node:test";
import assert from "node:assert/strict";
import { lib, tinyEngagement } from "./helpers.mjs";

const util = lib("util");
const migrate = lib("migrate");

test("mojibake repair reverses double-encoded UTF-8 and leaves clean text alone", () => {
  assert.equal(util.repairMojibake("Invoice Capture Bot \u00c2\u00b7 deployed"), "Invoice Capture Bot \u00b7 deployed");
  assert.equal(util.repairMojibake("1\u00c3\u2014 speed"), "1\u00d7 speed");
  assert.equal(util.repairMojibake("Caf\u00e9 M\u00fcller"), "Caf\u00e9 M\u00fcller");
});

test("only http and https URLs are accepted", () => {
  assert.equal(util.safeHttpUrl("linkedin.com/in/someone"), "https://linkedin.com/in/someone");
  assert.equal(util.safeHttpUrl("javascript:alert(1)"), null);
  assert.equal(util.safeHttpUrl("data:text/html,x"), null);
});

test("CSV cells are quoted and formula-guarded", () => {
  assert.equal(util.csvCell("plain"), "plain");
  assert.equal(util.csvCell("a,b"), "\"a,b\"");
  assert.equal(util.csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(util.csvCell("-1"), "'-1");
});

test("loose number parsing reads supplied figures", () => {
  assert.equal(util.parseLooseNumber("~$4,550 cost saved per submission"), 4550);
  assert.equal(util.parseLooseNumber("7.3 FTE-equivalent"), 7.3);
  assert.equal(util.parseLooseNumber("n/a"), null);
});

test("the migration registry upgrades step by step", () => {
  const steps = { 1: e => Object.assign(e, { upgraded: true }) };
  const r = migrate.migrateEngagement(tinyEngagement(), steps);
  assert.equal(r.engagement.schemaVersion, 2);
  assert.equal(r.engagement.upgraded, true);
  assert.equal(r.notes.length, 1);
  assert.match(migrate.migrateEngagement({ schemaVersion: 0 }).error, /schemaVersion/);
});
