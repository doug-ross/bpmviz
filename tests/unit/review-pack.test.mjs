// The self-contained HTML review pack (lib/review-pack.js): its content
// security policy hashes, the escaping of the embedded data, and that the
// page has no way to reach the network or keep data in the browser.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import vm from "node:vm";
import { lib, tinyEngagement } from "./helpers.mjs";

const rp = lib("review-pack");
const reviews = lib("reviews");
const validate = lib("validate");

const sha = text => crypto.createHash("sha256").update(text, "utf8").digest("base64");

function payload() {
  const e = validate.validateEngagement(tinyEngagement()).engagement;
  e.meta.clientDisplayName = "Caf\u00e9 & Co <Ltd>";
  e.models[0].nodes[1].label = "Do the work </script><script>alert(1)</script>";
  e.models[0].nodes[1].details = { desc: "Line\u2028separator and \u2029paragraph, emoji \ud83d\ude00, quote \" and backslash \\" };
  const items = reviews.buildPackItems(e, { modelId: "m-current" });
  const pack = reviews.newPack(e, { format: "html", stakeholder: { name: "Zo\u00eb Client", role: "Lead" }, modelId: "m-current", note: "<b>not bold</b>\u2028next line" }, items);
  return reviews.packPayload(e, pack, items);
}

test("the policy hashes match the pack script and style", () => {
  assert.equal(rp.PACK_SCRIPT_SHA256, sha(rp.PACK_SCRIPT), "run the hash update after changing packScript: expected " + sha(rp.PACK_SCRIPT));
  assert.equal(rp.PACK_STYLE_SHA256, sha(rp.PACK_STYLE), "expected " + sha(rp.PACK_STYLE));
  const html = rp.buildPackHtml(payload());
  assert.ok(html.includes("<script>" + rp.PACK_SCRIPT + "</script>"), "the script is emitted exactly as hashed");
  assert.ok(html.includes("<style>" + rp.PACK_STYLE + "</style>"), "the style is emitted exactly as hashed");
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1];
  assert.equal(csp, "default-src 'none'; script-src 'sha256-" + sha(rp.PACK_SCRIPT) + "'; style-src 'sha256-" + sha(rp.PACK_STYLE) +
    "'; img-src data:; form-action 'none'; base-uri 'none'");
  assert.ok(html.indexOf("Content-Security-Policy") < html.indexOf("<style>"), "the policy comes before the style and the script");
});

test("data containing </script> and line separators stays inside the JSON block", () => {
  const data = payload();
  const html = rp.buildPackHtml(data);
  assert.equal((html.match(/<\/script/gi) || []).length, 2, "only the two real closing tags");
  assert.equal((html.match(/<script/gi) || []).length, 2);
  assert.equal(/[^\x00-\x7f]/.test(html), false, "the file is ASCII only");
  assert.equal(/[\u2028\u2029]/.test(html), false);
  assert.ok(html.includes("\\u003c/script\\u003e"));
  assert.ok(html.includes("\\u00e9") && html.includes("\\ud83d\\ude00") && html.includes("\\u2028"));
  assert.deepEqual(rp.readPackHtml(html), data, "the data reads back unchanged");
  assert.equal(html.includes("Caf"), true);
  assert.equal(html.includes("<b>"), false, "engagement text never appears as markup");
  assert.equal(rp.jsonForScript({ a: "<&>" }), "{\"a\":\"\\u003c\\u0026\\u003e\"}");
});

test("the pack has no URLs, no storage, no network calls and no markup injection", () => {
  const html = rp.buildPackHtml(payload());
  assert.equal(/https?:|\/\/[a-z]/i.test(html.replace(/\/\/ /g, "")), false, "no URLs");
  assert.equal(/\s(src|href|action|formaction|srcset)\s*=/i.test(html), false, "no attributes that load or send anything");
  ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "localStorage", "sessionStorage", "indexedDB", "document.cookie",
    "fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon", "eval(", "new Function", "import(", "setAttribute(\"style\"", ".style."].forEach(word => {
    assert.equal(rp.PACK_SCRIPT.includes(word), false, word);
  });
  assert.equal(/url\(|@import/i.test(rp.PACK_STYLE), false, "the style loads nothing");
  assert.equal(/\son[a-z]+\s*=/i.test(html), false, "no inline event handlers");
  assert.throws(() => rp.buildPackHtml(null), TypeError);
});

test("the pack script parses as a standalone program", () => {
  assert.doesNotThrow(() => new vm.Script(rp.PACK_SCRIPT));
  assert.match(rp.PACK_SCRIPT, /^\(function packScript\(\) \{/);
  assert.match(rp.PACK_SCRIPT, /\}\)\(\);$/);
});
