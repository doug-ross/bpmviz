// Value dimensions step 3: portfolio criteria in the screening (reuse, cash
// tied up, what a pilot teaches), offered on request and not in the default set.
import test from "node:test";
import assert from "node:assert/strict";
import { lib } from "./helpers.mjs";

const S = lib("screening");

test("portfolio criteria are offered, not default, and are added once", () => {
  const blank = S.blankScreening({ title: "Q4 screening" });
  const ids = S.PORTFOLIO_CRITERIA.map(c => c.id);
  assert.deepEqual(ids, ["reuse", "workingCapital", "learning"]);
  assert.equal(blank.criteria.some(c => ids.includes(c.id)), false, "a new screening scores as before");
  const r = S.addPortfolioCriteria(blank);
  assert.deepEqual(r.added, ids);
  assert.equal(blank.criteria.length + 3, r.screening.criteria.length, "the input is left as it was");
  assert.ok(r.screening.criteria.filter(c => ids.includes(c.id)).every(c => c.group === "value" && c.weight === 1 && c.anchors[5]));
  assert.throws(() => S.addPortfolioCriteria(r.screening), /already in this screening/);

  // One removed is added back on its own.
  const removed = S.removeCriterion(r.screening, "learning").screening;
  assert.deepEqual(S.addPortfolioCriteria(removed).added, ["learning"]);

  // They survive a save and open, and an unscored one leaves a candidate provisional.
  const opened = S.parseScreening(JSON.stringify(r.screening));
  assert.deepEqual(opened.screening.criteria.slice(-3).map(c => c.id), ids);
  let s = S.addCandidate(r.screening, { name: "Claims intake" });
  const id = s.candidateId;
  s = s.screening;
  S.DEFAULT_CRITERIA.forEach(k => { s = S.setScore(s, id, k.id, { value: 4 }).screening; });
  const row = S.evaluate(s).rows[0];
  assert.equal(row.score, null);
  assert.equal(row.provisional, 75);
  ids.forEach(k => { s = S.setScore(s, id, k, { value: 4 }).screening; });
  assert.equal(S.evaluate(s).rows[0].score, 75);
});
