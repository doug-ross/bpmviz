// Event-log import (mining slice): CSV reading and activity name matching.
import test from "node:test";
import assert from "node:assert/strict";
import { lib, tinyEngagement } from "./helpers.mjs";

const csv = lib("csv");
const fuzzy = lib("fuzzy");
const mining = lib("mining");

test("CSV fields keep quotes, separators and line breaks, and a byte order mark is removed", () => {
  const text = "\ufeffcase,activity,note\r\n1,\"Check, then file\",\"She said \"\"done\"\"\"\r\n\r\n2,Approve,\"two\nlines\"\n3,Close,\n";
  const r = csv.parse(text);
  assert.equal(r.delimiter, ",");
  assert.deepEqual(r.rows, [
    ["case", "activity", "note"],
    ["1", "Check, then file", "She said \"done\""],
    ["2", "Approve", "two\nlines"],
    ["3", "Close", ""]
  ]);
  assert.equal(r.problems.unterminatedQuote, false);
  assert.equal(r.complete, true);
});

test("the separator is detected from the first lines, outside quotes", () => {
  assert.equal(csv.detectDelimiter("a;b;c\n1;\"x,y\";3\n"), ";");
  assert.equal(csv.detectDelimiter("a\tb\n1\t2\n"), "\t");
  assert.equal(csv.detectDelimiter("a|b|c\n1|2|3"), "|");
  assert.equal(csv.detectDelimiter("just one column\nvalue"), ",");
  assert.equal(csv.delimiterName("\t"), "tab");
  assert.deepEqual(csv.parse("a;b\n\"1;2\";3", { delimiter: ";" }).rows, [["a", "b"], ["1;2", "3"]]);
});

test("the chunked reader gives the same rows as a full parse and reports progress", () => {
  const lines = ["case,activity"];
  for (let i = 0; i < 250; i++) lines.push(i + ",\"Step " + i + "\"");
  const text = lines.join("\n");
  const reader = csv.createReader(text);
  const rows = [];
  let chunks = 0;
  while (!reader.done()) { rows.push(...reader.next(40)); chunks++; }
  assert.equal(chunks, 7);
  assert.equal(reader.progress(), 1);
  assert.deepEqual(rows, csv.parse(text).rows);
});

test("an unterminated quote is read to the end and flagged; text after a closing quote is kept", () => {
  const r = csv.parse("a,b\n1,\"open quote\n2,x");
  assert.equal(r.problems.unterminatedQuote, true);
  assert.deepEqual(r.rows[1], ["1", "open quote\n2,x"]);
  assert.deepEqual(csv.parse("\"12\"34,b").rows, [["1234", "b"]]);
  assert.deepEqual(csv.parse("a,b,").rows, [["a", "b", ""]]);
});

test("names are normalized and compared by tokens and edit distance", () => {
  assert.equal(fuzzy.normalize("  Scrub SOV & Geocode! "), "scrub sov and geocode");
  assert.equal(fuzzy.normalize("R\u00e9vision"), "revision");
  assert.equal(fuzzy.levenshtein("kitten", "sitting"), 3);
  assert.equal(fuzzy.levenshtein("", "abc"), 3);
  assert.equal(fuzzy.jaccard(["a", "b"], ["b", "c"]), 1 / 3);
  assert.equal(fuzzy.similarity("Fix", "fix"), 1);
  assert.equal(fuzzy.similarity("", "fix"), 0);
  const s = fuzzy.similarity("Check clearance and dedupe", "Check Clearance & Dedup");
  assert.ok(s >= 0.75 && s < 1, String(s));
  assert.ok(fuzzy.similarity("Fix it", "Fix") < 0.75);
});

test("exact names are confirmed, similar names are suggested unconfirmed, and gateways are never offered", () => {
  const model = tinyEngagement().models[0];
  const steps = mining.mappableSteps(model).map(n => ({ id: n.id, label: n.label }));
  assert.equal(steps.some(st => st.id === "check"), false, "the gateway is not a mapping target");
  const out = fuzzy.matchActivities([{ name: "DO THE WORK", events: 9 }, { name: "Do the wrk", events: 4 }, { name: "Check", events: 2 }, "Coffee break"], steps);
  assert.deepEqual(out.map(x => [x.activity, x.nodeId, x.method, x.confirmed]), [
    ["DO THE WORK", "work", "exact", true],
    ["Do the wrk", "work", "fuzzy", false],
    ["Check", null, null, false],
    ["Coffee break", null, null, false]
  ]);
  assert.equal(out[0].events, 9);
  assert.ok(out[1].score >= fuzzy.SUGGEST && out[1].score < 1);
  assert.equal(fuzzy.matchActivities(["Do the wrk"], steps, { threshold: 0.95 })[0].nodeId, null);
});
