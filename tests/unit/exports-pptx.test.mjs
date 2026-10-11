// Client deck library (lib/pptx.js): deck content from an engagement, and
// the OOXML parts it is built into.
import test from "node:test";
import assert from "node:assert/strict";
import { lib, tinyEngagement } from "./helpers.mjs";

const pptx = lib("pptx");
const { validateEngagement } = lib("validate");

function engagement(records, opts) {
  const e = tinyEngagement();
  const o = opts || {};
  e.meta.clientDisplayName = "Acme & Co <Test>";
  e.meta.engagementName = "Pilot";
  e.meta.disclosure = o.disclosure || "";
  e.assumptions = [
    { id: "as-rate", key: "hourlyRate", value: 100, status: "supplied" },
    { id: "as-vol", key: "annualVolume", value: 1000, status: "supplied" },
    { id: "as-fte", key: "productiveHoursPerFte", value: 1600, status: "supplied" }
  ];
  e.models[0].nodes[3].measures = { touchEffort: { value: 1, unit: "hour" }, typicalDuration: { value: 60, unit: "minute" } };
  e.records = records || [];
  const r = validateEngagement(e);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r.engagement;
}

function opp(id, extra) {
  return Object.assign({
    id, kind: "opportunity", title: "Opportunity " + id, linkedModelId: "m-current", linkedNodeIds: ["fix"],
    opportunity: {
      effort: "M", wave: "now",
      valueCase: { effortReductionPct: 50, shareOfCasesPct: 40, oneTimeCost: 1000, annualRunningCost: 0, confidence: "medium", basis: "supplied" }
    }
  }, extra || {});
}

/* Every <Relationship Target="..."> in a .rels part resolves to a part that exists. */
function checkRelsResolve(parts) {
  const names = new Set(parts.map(p => p.name));
  const resolve = (base, target) => {
    if (target.startsWith("/")) return target.slice(1);
    const segs = (base + target).split("/");
    const out = [];
    segs.forEach(s => { if (s === "..") out.pop(); else if (s && s !== ".") out.push(s); });
    return out.join("/");
  };
  parts.filter(p => p.name.endsWith(".rels")).forEach(relPart => {
    const base = relPart.name.replace(/(^|\/)_rels\/[^/]*\.rels$/, "$1");
    const re = /<Relationship[^>]*Target="([^"]+)"/g;
    let m;
    while ((m = re.exec(relPart.data))) {
      const target = m[1].replace(/&amp;/g, "&");
      assert.ok(names.has(resolve(base, target)), relPart.name + " references missing part " + target);
    }
  });
}

test("deckFromEngagement builds a title, scope, opportunities, value, process and disclosure slide", () => {
  const e = engagement([opp("a")]);
  const spec = pptx.deckFromEngagement(e, {});
  const kinds = spec.slides.map(s => s.kind + ":" + s.title);
  assert.equal(spec.slides[0].kind, "title");
  assert.match(spec.slides[0].subtitle, /Acme/);
  assert.ok(kinds.some(k => /^table:Scope/.test(k)));
  assert.ok(kinds.some(k => /^table:Opportunities/.test(k)));
  assert.ok(kinds.some(k => /^table:Value by wave/.test(k)));
  assert.ok(kinds.some(k => /^image:Process/.test(k)));
  assert.equal(spec.slides[spec.slides.length - 1].kind, "bullets");
  assert.equal(spec.slides[spec.slides.length - 1].title, "Disclosure");
  const opportunities = spec.slides.find(s => s.title === "Opportunities");
  assert.deepEqual(opportunities.headers, ["Rank", "Opportunity", "Value", "Wave"]);
  assert.match(opportunities.rows[0][2], /inputs\)$/, "every modeled figure carries its basis");
});

test("a missing process image is noted, not invented", () => {
  const e = engagement([]);
  const spec = pptx.deckFromEngagement(e, {});
  const image = spec.slides.find(s => s.kind === "image");
  assert.equal(image.image, null);
  assert.match(image.note, /No process diagram is available/);
});

test("a supplied process image is carried through to the slide", () => {
  const e = engagement([]);
  const spec = pptx.deckFromEngagement(e, { image: { bytes: new Uint8Array([1, 2, 3]), width: 400, height: 200 } });
  const image = spec.slides.find(s => s.kind === "image");
  assert.equal(image.image.width, 400);
});

test("sensitive records and unreviewed AI drafts are left out unless asked for", () => {
  const e = engagement([
    { id: "p1", kind: "pain", title: "Sensitive pain point", linkedModelId: "m-current", linkedNodeIds: ["work"], sensitive: true },
    { id: "p2", kind: "pain", title: "Draft pain point", linkedModelId: "m-current", linkedNodeIds: ["work"], generated: { task: "opportunities", provider: "claude", reviewed: false } }
  ]);
  const spec = pptx.deckFromEngagement(e, {});
  assert.ok(!spec.slides.some(s => s.kind === "table" && (s.rows || []).some(r => r[0] === "Sensitive pain point")));
  const disclosure = spec.slides[spec.slides.length - 1];
  assert.ok(disclosure.lines.some(l => /1 sensitive record is not included/.test(l)));
  assert.ok(disclosure.lines.some(l => /1 AI-drafted record is not yet reviewed/.test(l)));
  const spec2 = pptx.deckFromEngagement(e, { includeSensitive: true, includeUnreviewedAi: true });
  assert.ok(spec2.slides.some(s => s.kind === "table" && (s.rows || []).some(r => r[0] === "Sensitive pain point")));
});

test("tables paginate at 10 rows, and notes attach to the last page", () => {
  const records = [];
  for (let i = 0; i < 23; i++) records.push({ id: "pain-" + i, kind: "pain", title: "Pain " + i, linkedModelId: "m-current", linkedNodeIds: ["work"] });
  const e = engagement(records);
  const spec = pptx.deckFromEngagement(e, {});
  const findings = spec.slides.filter(s => /^Findings/.test(s.title));
  assert.equal(findings.length, 3);
  assert.equal(findings[0].title, "Findings (1 of 3)");
  assert.equal(findings[0].rows.length, 10);
  assert.equal(findings[1].rows.length, 10);
  assert.equal(findings[2].rows.length, 3);
  const valueSlides = spec.slides.filter(s => /^Value by wave/.test(s.title));
  assert.ok(valueSlides[valueSlides.length - 1].notes.length > 0, "notes land on the last page of a paginated table");
});

test("buildDeck refuses an empty deck", () => {
  assert.throws(() => pptx.buildDeck({ slides: [] }), pptx.PptxError);
});

test("buildDeck's parts and relationships resolve, and special characters are escaped", () => {
  const e = engagement([opp("a", { title: "Fix <routing> & \"queues\"" })]);
  const spec = pptx.deckFromEngagement(e, { image: { bytes: new Uint8Array([137, 80, 78, 71]), width: 800, height: 450 } });
  const parts = pptx.buildDeck(spec);
  const byName = Object.fromEntries(parts.map(p => [p.name, p.data]));
  assert.ok(byName["[Content_Types].xml"]);
  assert.ok(byName["ppt/presentation.xml"]);
  assert.ok(byName["ppt/theme/theme1.xml"]);
  assert.ok(byName["ppt/slideMasters/slideMaster1.xml"]);
  assert.ok(byName["ppt/slideLayouts/slideLayout1.xml"]);
  assert.ok(byName["ppt/media/image1.png"]);
  const slideCount = spec.slides.length;
  for (let i = 1; i <= slideCount; i++) assert.ok(byName["ppt/slides/slide" + i + ".xml"], "slide " + i + " exists");
  assert.match(byName["[Content_Types].xml"], new RegExp("PartName=\"/ppt/slides/slide" + slideCount + "\\.xml\""));
  assert.equal((byName["ppt/presentation.xml"].match(/<p:sldId /g) || []).length, slideCount);
  checkRelsResolve(parts);
  const opportunitySlide = parts.find(p => /Fix &lt;routing&gt; &amp; &quot;queues&quot;/.test(p.data));
  assert.ok(opportunitySlide, "the opportunity title is escaped, not raw markup");
  assert.doesNotMatch(opportunitySlide.data, /<a:t>Fix <routing>/);
});

test("pptxBytesAsync produces a readable ZIP archive", async () => {
  const zlib = await import("node:zlib");
  const zip = lib("zip");
  const e = engagement([opp("a")]);
  const spec = pptx.deckFromEngagement(e, {});
  const bytes = await pptx.pptxBytesAsync(spec, { deflateRaw: b => zlib.deflateRawSync(b) });
  const pkg = await zip.openZipAsync(bytes, { inflateRaw: (b, max) => zlib.inflateRawSync(b, max ? { maxOutputLength: max } : {}) });
  assert.ok(pkg.names.includes("ppt/presentation.xml"));
  assert.ok(pkg.names.includes("[Content_Types].xml"));
});
