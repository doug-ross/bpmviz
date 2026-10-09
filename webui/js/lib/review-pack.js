/*
 * BPMVIZ review-pack: the self-contained HTML review pack.
 *
 * buildPackHtml(payload) returns one HTML file that a client stakeholder
 * opens from disk. Its content security policy allows only the pack's own
 * script and style (by SHA-256 hash), no network, no forms and no base URL.
 * The pack data sits in a <script type="application/json"> block with <, >,
 * &, U+2028, U+2029 and every non-ASCII character written as \u escapes, and
 * the page shows it with textContent only. The reviewer answers each item,
 * then "Save response" downloads a review response file
 * (schema bpmviz.review-response); "Load saved response" reads one back so a
 * review can continue later. The page stores nothing in the browser.
 *
 * PACK_SCRIPT and PACK_STYLE are fixed; their hashes are the constants
 * below, and tests/unit/review-pack.test.mjs checks that they match.
 * Owned by the client review feature; see docs/client-review.md.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else { const B = root.BPMVIZ = root.BPMVIZ || {}; B.reviewPack = factory(); }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /*
   * The script of the pack page. It runs on its own in the pack, so it uses
   * nothing from this file; PACK_SCRIPT is its source text.
   */
  function packScript() {
    "use strict";
    const doc = document;
    const host = doc.getElementById("pack");
    let data = null;
    try { data = JSON.parse(doc.getElementById("pack-data").textContent); } catch (err) { data = null; }
    if (!data || !Array.isArray(data.items) || !data.packId) {
      host.textContent = "This review page is damaged and cannot be shown. Ask the team for a new copy.";
      return;
    }
    const MAX_FILE = 2 * 1024 * 1024;
    const verdicts = Array.isArray(data.verdicts) && data.verdicts.length ? data.verdicts :
      [{ value: "confirm", label: "Confirm" }, { value: "dispute", label: "Dispute" }, { value: "unsure", label: "Not sure" }];
    const answers = data.items.map(() => ({ verdict: "", comment: "" }));
    const controls = [];
    let dirty = false;

    function el(tag, attrs) {
      const node = doc.createElement(tag);
      const a = attrs || {};
      Object.keys(a).forEach(k => {
        const v = a[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = String(v);
        else if (v === true) node.setAttribute(k, "");
        else node.setAttribute(k, String(v));
      });
      for (let i = 2; i < arguments.length; i++) add(node, arguments[i]);
      return node;
    }
    function add(node, child) {
      if (child === null || child === undefined || child === false) return;
      if (Array.isArray(child)) { child.forEach(c => add(node, c)); return; }
      node.appendChild(typeof child === "object" ? child : doc.createTextNode(String(child)));
    }
    function day(iso) {
      const d = new Date(iso || "");
      return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" });
    }
    function field(id, label, value, multi) {
      const input = multi ? el("textarea", { class: "textarea", id, rows: 4, maxlength: 4000 }) : el("input", { class: "input", id, type: "text", maxlength: 200 });
      input.value = value || "";
      input.addEventListener("input", () => { dirty = true; });
      return { input, wrap: el("div", { class: "field" }, el("label", { for: id }, label), input) };
    }

    const status = el("p", { class: "status", id: "pack-status", role: "status", "aria-live": "polite" });
    const progress = el("span", { class: "progress", id: "pack-progress" });
    function say(message) { status.textContent = ""; setTimeout(() => { status.textContent = message; }, 20); }
    function countAnswered() { return answers.filter(a => a.verdict).length; }
    function updateProgress() {
      progress.textContent = countAnswered() + " of " + data.items.length + " items answered";
    }

    const s = data.stakeholder || {};
    const name = field("pack-name", "Your name", s.name);
    const role = field("pack-role", "Your role", s.role);
    const org = field("pack-org", "Your organization", s.organization);
    const general = field("pack-general", "Anything else the team should know", "", true);

    function itemCard(item, i) {
      const groupName = "pack-v-" + i;
      const radios = verdicts.map(v => {
        const input = el("input", { type: "radio", name: groupName, value: v.value, id: groupName + "-" + v.value });
        input.addEventListener("change", () => {
          if (!input.checked) return;
          answers[i].verdict = v.value;
          dirty = true;
          card.classList.add("answered");
          updateProgress();
        });
        return { input, wrap: el("label", { class: "opt", for: groupName + "-" + v.value }, input, el("span", null, v.label)) };
      });
      const clearBtn = el("button", { type: "button", class: "link-btn", text: "Clear answer" });
      clearBtn.addEventListener("click", () => {
        radios.forEach(r => { r.input.checked = false; });
        answers[i].verdict = "";
        dirty = true;
        card.classList.remove("answered");
        updateProgress();
      });
      const comment = el("textarea", { class: "textarea", id: "pack-c-" + i, rows: 2, maxlength: 4000 });
      comment.addEventListener("input", () => { answers[i].comment = comment.value; dirty = true; });
      controls[i] = { radios, comment, card: null };
      const headId = "pack-h-" + i;
      const card = el("article", { class: "item", id: "pack-item-" + i, "aria-labelledby": headId },
        el("h4", { id: headId }, item.label),
        el("p", { class: "meta" }, [item.type, item.lane].filter(Boolean).join(" \u00b7 ")),
        item.details ? el("p", { class: "details" }, item.details) : null,
        el("fieldset", { class: "opts" }, el("legend", null, "Your verdict on " + item.label), radios.map(r => r.wrap), clearBtn),
        el("div", { class: "field" }, el("label", { for: "pack-c-" + i }, "Comment"), comment));
      controls[i].card = card;
      return card;
    }

    function groups(list, keyOf) {
      const out = [];
      list.forEach(x => {
        const key = keyOf(x.item) || "Other";
        let g = out.find(y => y.key === key);
        if (!g) { g = { key, entries: [] }; out.push(g); }
        g.entries.push(x);
      });
      return out;
    }

    const indexed = data.items.map((item, i) => ({ item, i }));
    const steps = indexed.filter(x => x.item.kind === "step");
    const findings = indexed.filter(x => x.item.kind !== "step");
    const section = (title, list, keyOf, intro) => list.length ? el("section", { class: "block", "aria-label": title },
      el("h2", null, title + " (" + list.length + ")"), intro ? el("p", { class: "small" }, intro) : null,
      groups(list, keyOf).map(g => [el("h3", null, g.key), g.entries.map(x => itemCard(x.item, x.i))])) : null;

    function fileName() {
      const who = (name.input.value || "reviewer").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "reviewer";
      return "review-response-" + who + "-" + String(data.packId).replace(/[^A-Za-z0-9_-]+/g, "-") + ".json";
    }

    function save() {
      if (!name.input.value.trim()) {
        say("Add your name under About you before you save.");
        name.input.focus();
        return;
      }
      const response = {
        schema: data.responseSchema || "bpmviz.review-response",
        schemaVersion: 1,
        packId: data.packId,
        engagementId: data.engagementId,
        engagementRevision: data.engagementRevision,
        format: "html",
        reviewer: { name: name.input.value.trim(), role: role.input.value.trim(), organization: org.input.value.trim() },
        submittedAt: new Date().toISOString(),
        generalComment: general.input.value.trim(),
        entries: data.items.map((item, i) => ({ itemRef: item.itemRef, verdict: answers[i].verdict, comment: answers[i].comment.trim() }))
      };
      const blob = new Blob([JSON.stringify(response, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = el("a", { href: url, download: fileName() });
      doc.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      dirty = false;
      say("Saved " + fileName() + " with " + countAnswered() + " of " + data.items.length + " items answered. Send this file to the team.");
    }

    function load(response) {
      if (!response || response.schema !== (data.responseSchema || "bpmviz.review-response")) throw new Error("This file is not a saved review response.");
      if (response.packId !== data.packId) throw new Error("This response belongs to a different review pack, so it was not loaded.");
      const r = response.reviewer || {};
      name.input.value = typeof r.name === "string" ? r.name : name.input.value;
      role.input.value = typeof r.role === "string" ? r.role : role.input.value;
      org.input.value = typeof r.organization === "string" ? r.organization : org.input.value;
      general.input.value = typeof response.generalComment === "string" ? response.generalComment : "";
      const byRef = {};
      (Array.isArray(response.entries) ? response.entries : []).forEach(en => { if (en && typeof en.itemRef === "string") byRef[en.itemRef] = en; });
      let loaded = 0;
      data.items.forEach((item, i) => {
        const en = Object.prototype.hasOwnProperty.call(byRef, item.itemRef) ? byRef[item.itemRef] : null;
        const verdict = en && verdicts.some(v => v.value === en.verdict) ? en.verdict : "";
        answers[i].verdict = verdict;
        answers[i].comment = en && typeof en.comment === "string" ? en.comment : "";
        controls[i].radios.forEach(x => { x.input.checked = x.input.value === verdict; });
        controls[i].comment.value = answers[i].comment;
        controls[i].card.classList.toggle("answered", !!verdict);
        if (verdict || answers[i].comment) loaded++;
      });
      updateProgress();
      dirty = false;
      say("Loaded " + loaded + " answers from the saved response. Continue where you left off.");
    }

    const picker = el("input", { type: "file", accept: ".json,application/json", id: "pack-load-file", class: "sr-only", tabindex: -1, "aria-hidden": "true" });
    picker.addEventListener("change", () => {
      const f = picker.files && picker.files[0];
      if (!f) return;
      if (f.size > MAX_FILE) { say("That file is larger than 2 MB, so it is not a saved response from this page."); picker.value = ""; return; }
      const reader = new FileReader();
      reader.onload = () => {
        try { load(JSON.parse(String(reader.result || ""))); } catch (err) { say(err && err.message && !/JSON/.test(err.message) ? err.message : "This file could not be read as a saved response."); }
        picker.value = "";
      };
      reader.onerror = () => { say("The file could not be read."); picker.value = ""; };
      reader.readAsText(f);
    });
    const button = (id, label, primary, fn) => {
      const b = el("button", { type: "button", class: "btn" + (primary ? " btn-primary" : ""), id }, label);
      b.addEventListener("click", fn);
      return b;
    };

    const facts = [
      ["Prepared for", [s.name, s.role, s.organization].filter(Boolean).join(", ")],
      ["Prepared on", day(data.createdAt)],
      ["Process model", data.modelName],
      ["Items to review", String(data.items.length) + " (" + steps.length + " steps, " + findings.length + " findings)"],
      ["Data status", data.dataStatus],
      ["Confidentiality", data.confidentiality]
    ].filter(f => f[1]);
    doc.title = "Process review: " + (data.title || "");
    add(host, [
      el("header", { class: "head" },
        el("p", { class: "eyebrow" }, [data.client, data.engagementName].filter(Boolean).join(" \u00b7 ") || "Process review"),
        el("h1", null, "Process review: " + (data.title || "")),
        el("p", { class: "lede" }, "The team has listed the steps and findings from the workshop below. For each one, choose Confirm if it is right, Dispute if it is wrong or incomplete, or Not sure. Add a comment wherever something should change."),
        el("dl", { class: "facts" }, facts.map(f => [el("dt", null, f[0]), el("dd", null, f[1])]))),
      data.note ? el("section", { class: "block", "aria-label": "Note from the team" }, el("h2", null, "Note from the team"), el("p", null, data.note)) : null,
      el("section", { class: "block", "aria-label": "About you" }, el("h2", null, "About you"), el("div", { class: "row" }, name.wrap, role.wrap, org.wrap)),
      el("section", { class: "block", "aria-label": "How your answers are kept" }, el("h2", null, "How your answers are kept"),
        el("p", null, "Your answers stay in this page until you choose Save response. That saves a file on your computer; send that file to the team. Nothing is sent from this page and nothing is stored in your browser."),
        el("p", null, "To continue later, save a response, open this page again and choose Load saved response.")),
      el("div", { class: "bar", role: "toolbar", "aria-label": "Save or load your answers" }, progress,
        el("span", { class: "spacer" }), button("pack-load", "Load saved response", false, () => picker.click()), button("pack-save", "Save response", true, save), picker),
      section("Steps in the process", steps, item => item.lane, "Each step as the team understood it. Confirm it if the step happens as described."),
      section("Findings from the workshop", findings, item => item.type, "Pain points, opportunities and other findings recorded with the team."),
      el("section", { class: "block", "aria-label": "General comment" }, el("h2", null, "General comment"), general.wrap),
      el("div", { class: "foot" }, button("pack-save-end", "Save response", true, save), status),
      data.disclosure ? el("p", { class: "small" }, data.disclosure) : null
    ]);
    updateProgress();
    window.addEventListener("beforeunload", ev => {
      if (!dirty) return;
      ev.preventDefault();
      ev.returnValue = "";
    });
  }

  const PACK_SCRIPT = "(" + packScript.toString() + ")();";

  const PACK_STYLE = [
    "*{box-sizing:border-box}",
    "html{color-scheme:light}",
    "body{margin:0;background:#F5F5F7;color:#34343D;font-family:Ubuntu,system-ui,-apple-system,\"Segoe UI\",Roboto,sans-serif;font-size:15px;line-height:1.5}",
    ".page{max-width:880px;margin:0 auto;padding:32px 24px 64px}",
    "h1,h2,h3,h4{color:#2B0A3D;line-height:1.25;margin:0}",
    "h1{font-family:\"Ubuntu Mono\",ui-monospace,Menlo,monospace;font-weight:400;font-size:28px;margin:8px 0}",
    "h2{font-size:19px;margin:0 0 8px}",
    "h3{font-size:16px;margin:20px 0 8px;color:#4F4F5A}",
    "h4{font-size:15px}",
    ".eyebrow{margin:0;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0070AD}",
    ".lede{font-size:16px;font-weight:300;margin:0 0 16px}",
    ".facts{display:grid;grid-template-columns:minmax(120px,auto) 1fr;gap:4px 16px;margin:0;font-size:13px}",
    ".facts dt{color:#71717E}.facts dd{margin:0}",
    ".head{background:#FFFFFF;border:1px solid #DDDDE2;border-radius:10px;padding:24px;margin-bottom:16px}",
    ".block{background:#FFFFFF;border:1px solid #DDDDE2;border-radius:10px;padding:20px 24px;margin-bottom:16px}",
    ".block p{margin:0 0 8px}",
    ".small{font-size:13px;color:#71717E}",
    ".row{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}",
    ".field{display:flex;flex-direction:column;gap:4px;margin-top:8px}",
    ".field label{font-size:13px;font-weight:500;color:#2B0A3D}",
    ".input,.textarea{width:100%;font:inherit;font-size:14px;padding:6px 10px;border:1px solid #C5C5CD;border-radius:6px;background:#FFFFFF;color:#34343D}",
    ".textarea{resize:vertical;min-height:56px}",
    ".input:focus,.textarea:focus{outline:none;border-color:#0070AD;box-shadow:0 0 0 3px rgba(18,171,219,.45)}",
    ".bar{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;align-items:center;gap:8px;background:#FFFFFF;border:1px solid #DDDDE2;border-radius:10px;padding:10px 16px;margin-bottom:16px;box-shadow:0 1px 3px rgba(43,10,61,.08)}",
    ".spacer{flex:1}",
    ".progress{font-weight:500;color:#2B0A3D}",
    ".btn{font:inherit;font-size:14px;font-weight:500;min-height:36px;padding:0 14px;border:1px solid #C5C5CD;border-radius:6px;background:#FFFFFF;color:#2B0A3D;cursor:pointer}",
    ".btn:hover{border-color:#0070AD}",
    ".btn-primary{background:#0070AD;border-color:#0070AD;color:#FFFFFF}",
    ".btn-primary:hover{background:#005E91;border-color:#005E91}",
    ".btn:focus-visible,.link-btn:focus-visible,.opt input:focus-visible+span{outline:3px solid #12ABDB;outline-offset:2px}",
    ".link-btn{font:inherit;font-size:13px;background:none;border:0;padding:0 4px;color:#0070AD;cursor:pointer;align-self:center}",
    ".link-btn:hover{text-decoration:underline}",
    ".item{border-top:1px solid #ECECEF;padding:16px 0}",
    ".item:first-of-type{border-top:0}",
    ".meta{margin:2px 0 4px;font-size:12px;color:#71717E}",
    ".details{margin:0 0 8px;font-size:14px}",
    ".opts{display:flex;flex-wrap:wrap;gap:6px;border:0;padding:0;margin:8px 0 0}",
    ".opts legend{font-size:13px;font-weight:500;color:#2B0A3D;margin-bottom:4px;padding:0}",
    ".opt{position:relative}",
    ".opt input{position:absolute;opacity:0;pointer-events:none}",
    ".opt span{display:inline-block;padding:5px 12px;border:1px solid #C5C5CD;border-radius:6px;font-size:13px;cursor:pointer;background:#FFFFFF}",
    ".opt input:checked+span{border:2px solid #0070AD;color:#0070AD;font-weight:700;padding:4px 11px}",
    ".foot{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:8px 0 16px}",
    ".status{margin:0;font-size:14px;color:#2B0A3D}",
    ".sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}",
    "@media print{.bar,.foot,.link-btn{display:none}body{background:#FFFFFF}.head,.block{border:0;padding:0}}"
  ].join("\n");

  /* SHA-256 of PACK_SCRIPT and PACK_STYLE, base64, as the content security policy needs them. */
  const PACK_SCRIPT_SHA256 = "eOtPHDC1cylVhT+RMC335AguB1oWXWY7FS8BqYrz87g=";
  const PACK_STYLE_SHA256 = "5dn3qn3UAcR0HU4XWCeOk+9c7kbALAAPPWCgqyff4iA=";

  const CSP = "default-src 'none'; script-src 'sha256-" + PACK_SCRIPT_SHA256 + "'; style-src 'sha256-" + PACK_STYLE_SHA256 +
    "'; img-src data:; form-action 'none'; base-uri 'none'";

  /*
   * JSON that is safe inside a <script> element and ASCII only: <, >, &,
   * U+2028, U+2029 and every character outside ASCII become \u escapes.
   */
  function jsonForScript(value) {
    return JSON.stringify(value).replace(/[<>&\u2028\u2029]|[^\x00-\x7f]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  }

  /** The pack as one HTML file (ASCII only). payload comes from reviews.packPayload. */
  function buildPackHtml(payload) {
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.items)) throw new TypeError("buildPackHtml needs a pack payload with items.");
    return "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n" +
      "<meta http-equiv=\"Content-Security-Policy\" content=\"" + CSP + "\">\n" +
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
      "<meta name=\"referrer\" content=\"no-referrer\">\n" +
      "<title>Process review</title>\n" +
      "<style>" + PACK_STYLE + "</style>\n" +
      "</head>\n<body>\n" +
      "<noscript><p class=\"page\">This review page needs JavaScript. Open it in a current version of Chrome, Edge, Firefox or Safari.</p></noscript>\n" +
      "<main class=\"page\" id=\"pack\"></main>\n" +
      "<script type=\"application/json\" id=\"pack-data\">" + jsonForScript(payload) + "</script>\n" +
      "<script>" + PACK_SCRIPT + "</script>\n" +
      "</body>\n</html>\n";
  }

  /** The payload of a pack file, read back from its HTML (for tests and support). */
  function readPackHtml(html) {
    const m = /<script type="application\/json" id="pack-data">([\s\S]*?)<\/script>/.exec(String(html || ""));
    return m ? JSON.parse(m[1]) : null;
  }

  return { PACK_SCRIPT, PACK_STYLE, PACK_SCRIPT_SHA256, PACK_STYLE_SHA256, CSP, jsonForScript, buildPackHtml, readPackHtml };
});
