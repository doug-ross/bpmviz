/*
 * AIxRay reviews: client review packs, the answers that come back, and
 * applying them to the engagement.
 *
 * A pack lists steps of one model and findings (records) for a client
 * stakeholder to confirm, dispute or mark as not sure. It goes out as a
 * self-contained web page (lib/review-pack.js) or an Excel workbook
 * (workbookSpec here, written by lib/xlsx.js). The answers come back as a
 * review response file (schema aixray.review-response) or the filled-in
 * workbook, which responseFromWorkbook turns into the same response shape.
 *
 * prepareApply checks a response against the open engagement and works out
 * what applying it would change; buildApplyPayload turns the consultant's
 * choices into one review/apply command. Applying never edits the process:
 * it changes the validation status of steps (also on a locked baseline,
 * without marking anything modified), may add open questions and an
 * evidence source, and appends the review to engagement.reviews.
 *
 * Owned by the client review feature; see docs/client-review.md.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./util.js"), require("./schema.js"), require("./validate.js"), require("./store.js"));
  } else {
    const B = root.AIxRay = root.AIxRay || {};
    B.reviews = factory(B.util, B.schema, B.validate, B.store);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, schema, validate, store) {
  "use strict";

  const L = schema.LIMITS;
  const PACK_SHEET = "aixray-pack";
  const REVIEW_SHEET = "Review";
  const ABOUT_SHEET = "About";
  /* Answers are read back by header name (HEADER_ALIASES), so older workbooks with Verdict and Comment still import. */
  const REVIEW_HEADERS = ["Item ID", "Type", "Lane", "Item", "Details", "Your answer", "Your comment"];
  /* What each answer means, for the instructions on the About sheet. */
  const VERDICT_MEANING = { confirm: "if the row is right as written", dispute: "if it is wrong or incomplete", unsure: "if you can't say" };
  const STEP_SHAPES = ["task", "gateway"];
  /* Record kinds a pack offers, in the order they appear. */
  const FINDING_KINDS = ["pain", "opportunity", "decision", "assumption", "question", "action", "note"];
  const DEFAULT_KINDS = ["pain", "opportunity", "decision", "assumption"];
  const VALIDATION_FOR = { confirm: "validated", dispute: "disputed" };

  class ReviewError extends Error {}

  function stepRef(modelId, nodeId) { return "step/" + modelId + "/" + nodeId; }
  function recordRef(recordId) { return "record/" + recordId; }

  function text(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") return "";
    return String(v);
  }

  function clip(value, max) {
    const t = text(value).replace(/\s+/g, " ").trim();
    return t.length > max ? t.slice(0, max - 3).trimEnd() + "..." : t;
  }

  /* Text of a step detail, which may be a string or a list. */
  function detailText(v) {
    if (Array.isArray(v)) return v.map(text).filter(Boolean).join("; ");
    return text(v);
  }

  function typeLabelOf(node) {
    const shape = schema.typeInfo(node.semanticType).shape;
    if (shape === "gateway") return "Decision point";
    if (shape === "start" || shape === "end" || shape === "event") return "Event";
    return "Step";
  }

  function laneName(model, laneId) {
    const lane = model.lanes.find(l => l.id === laneId);
    return lane ? lane.name : "";
  }

  /**
   * What an item reference points at in engagement e, or null:
   * { itemRef, kind: "step" | "record", modelId, nodeId, recordId, model, node, record, label, type, lane, details }.
   */
  function resolveItem(e, itemRef) {
    const p = validate.parseItemRef(itemRef);
    if (!p) return null;
    if (p.kind === "step") {
      const model = e.models.find(m => m.id === p.modelId);
      const node = model && model.nodes.find(n => n.id === p.nodeId);
      if (!node) return null;
      const d = node.details || {};
      const sentence = t => (t && !/[.!?]$/.test(t.trim()) ? t.trim() + "." : t.trim());
      const details = [sentence(detailText(d.desc) || text(node.sub)), d.who ? sentence("Who: " + detailText(d.who)) : "", d.systems ? sentence("Systems: " + detailText(d.systems)) : ""]
        .filter(Boolean).join(" ");
      return { itemRef, kind: "step", modelId: model.id, nodeId: node.id, recordId: null, model, node, record: null,
        label: node.label, type: typeLabelOf(node), lane: laneName(model, node.laneId), details: clip(details, 1200) };
    }
    const record = e.records.find(r => r.id === p.recordId);
    if (!record) return null;
    const model = record.linkedModelId ? e.models.find(m => m.id === record.linkedModelId) : null;
    const nodes = record.linkedNodeIds.map(id => {
      const m = model || e.models.find(x => x.nodes.some(n => n.id === id));
      const n = m && m.nodes.find(x => x.id === id);
      return n ? { node: n, model: m } : null;
    }).filter(Boolean);
    const lanes = [...new Set(nodes.map(x => laneName(x.model, x.node.laneId)).filter(Boolean))];
    const stepsText = nodes.length ? "Steps: " + nodes.map(x => x.node.label).join(", ") + "." : "";
    return { itemRef, kind: "record", modelId: model ? model.id : null, nodeId: null, recordId: record.id, model, node: null, record,
      label: record.title, type: schema.label("recordKind", record.kind), lane: lanes.join(", "),
      details: clip([record.description, stepsText].filter(Boolean).join(" "), 1200) };
  }

  function isUnreviewedAi(r) {
    return !!(r && r.generated && !r.generated.reviewed);
  }

  /*
   * The records a pack can offer for a model: in the handoff, not dropped,
   * linked to that model or to no model, sensitive records and unreviewed AI
   * drafts only when asked.
   */
  function candidateRecords(e, o) {
    return e.records.filter(r => r.includeInHandoff && r.status !== "dropped" &&
      (o.includeSensitive || !r.sensitive) && (o.includeUnreviewedAi || !isUnreviewedAi(r)) &&
      (!r.linkedModelId || !o.modelId || r.linkedModelId === o.modelId));
  }

  /**
   * How many items of each kind a pack for this model could hold:
   * { steps, records: { pain: n, ... } }. Used by the pack dialog.
   */
  function packCounts(e, opts) {
    const o = Object.assign({}, opts || {});
    const model = e.models.find(m => m.id === o.modelId);
    const steps = model ? model.nodes.filter(n => !n.removed && STEP_SHAPES.includes(schema.typeInfo(n.semanticType).shape)).length : 0;
    const records = {};
    FINDING_KINDS.forEach(k => { records[k] = 0; });
    candidateRecords(e, o).forEach(r => { if (r.kind in records) records[r.kind]++; });
    return { steps, records };
  }

  /**
   * The items for a review pack, in reading order: steps by lane and flow
   * position, then findings by kind.
   * opts: { modelId, steps (default true), kinds (record kinds, default pain,
   *   opportunity, decision, assumption), includeSensitive, includeUnreviewedAi,
   *   itemRefs (only these, for downloading a recorded pack again; records
   *   still pass the sensitive, AI draft, dropped and handoff checks) }
   * Returns [{ itemRef, kind, type, lane, label, details }].
   */
  function buildPackItems(e, opts) {
    const o = Object.assign({ steps: true, kinds: DEFAULT_KINDS }, opts || {});
    const only = Array.isArray(o.itemRefs) ? new Set(o.itemRefs) : null;
    const model = e.models.find(m => m.id === o.modelId) || null;
    const items = [];
    if (model && (o.steps || only)) {
      const laneOrder = new Map(model.lanes.map((l, i) => [l.id, i]));
      const pos = id => (model.presentation && model.presentation.nodes && model.presentation.nodes[id] && Number.isFinite(model.presentation.nodes[id].x) ? model.presentation.nodes[id].x : 0);
      model.nodes
        .map((n, i) => ({ n, i }))
        .filter(({ n }) => !n.removed && (only ? only.has(stepRef(model.id, n.id)) : STEP_SHAPES.includes(schema.typeInfo(n.semanticType).shape)))
        .sort((a, b) => (laneOrder.get(a.n.laneId) || 0) - (laneOrder.get(b.n.laneId) || 0) || pos(a.n.id) - pos(b.n.id) || a.i - b.i)
        .forEach(({ n }) => items.push(resolveItem(e, stepRef(model.id, n.id))));
    }
    const kinds = only ? FINDING_KINDS : (Array.isArray(o.kinds) ? o.kinds : []).filter(k => FINDING_KINDS.includes(k));
    // A recorded pack downloaded again still leaves out records that are now
    // sensitive, unreviewed AI drafts, dropped or out of the handoff.
    const records = only ? candidateRecords(e, Object.assign({}, o, { modelId: null })).filter(r => only.has(recordRef(r.id))) :
      candidateRecords(e, Object.assign({}, o, { modelId: model ? model.id : o.modelId }));
    kinds.forEach(kind => records.filter(r => r.kind === kind).forEach(r => items.push(resolveItem(e, recordRef(r.id)))));
    return items.filter(Boolean).slice(0, L.reviewEntries).map(it => ({
      itemRef: it.itemRef, kind: it.kind, type: it.type, lane: it.lane, label: it.label, details: it.details
    }));
  }

  function person(p) {
    const x = p || {};
    return { name: clip(x.name, 200), role: clip(x.role, 200), organization: clip(x.organization, 200) };
  }

  /**
   * A new review pack record for engagement e (not yet stored; record it with
   * review/recordPack). opts: { format, stakeholder, modelId, note }.
   */
  function newPack(e, opts, items) {
    const o = opts || {};
    const taken = new Set((e.reviewPacks || []).map(p => p.id));
    let id = util.uid("rp");
    while (taken.has(id)) id = util.uid("rp");
    return {
      id,
      createdAt: util.nowIso(),
      format: schema.ENUMS.reviewFormat.includes(o.format) ? o.format : "html",
      stakeholder: person(o.stakeholder),
      engagementRevision: e.revision,
      modelId: e.models.some(m => m.id === o.modelId) ? o.modelId : null,
      items: (items || []).map(it => ({ itemRef: it.itemRef, label: text(it.label).slice(0, 300) })),
      note: text(o.note).slice(0, 4000)
    };
  }

  /**
   * What goes into the pack file: the engagement context a reviewer needs
   * and the items, nothing else from the engagement.
   */
  function packPayload(e, pack, items) {
    const model = e.models.find(m => m.id === pack.modelId);
    return {
      schema: schema.REVIEW_PACK_ID,
      schemaVersion: 1,
      responseSchema: schema.REVIEW_RESPONSE_ID,
      packId: pack.id,
      engagementId: e.id,
      engagementRevision: pack.engagementRevision,
      createdAt: pack.createdAt,
      format: pack.format,
      title: e.meta.processName,
      client: e.meta.clientDisplayName || "",
      engagementName: e.meta.engagementName || "",
      modelName: model ? model.name : "",
      dataStatus: schema.label("dataStatus", e.meta.dataStatus),
      confidentiality: schema.label("confidentiality", e.meta.confidentiality),
      disclosure: e.meta.disclosure || "",
      stakeholder: Object.assign({}, pack.stakeholder),
      note: pack.note || "",
      verdicts: schema.ENUMS.reviewVerdict.map(v => ({ value: v, label: schema.label("reviewVerdict", v) })),
      items: (items || []).map(it => ({ itemRef: it.itemRef, kind: it.kind, type: it.type, lane: it.lane, label: it.label, details: it.details }))
    };
  }

  function dateOnly(iso) {
    return text(iso).slice(0, 10);
  }

  /*
   * Text for a workbook cell. The writer stores text as inline strings, so
   * nothing is a formula when the file opens, but a reviewer who edits a cell
   * that starts with = + - @ (or a tab or carriage return), or saves the sheet
   * as CSV, would turn it into one. Such text gets a leading apostrophe, the
   * same rule as the CSV exports (util.csvCell). plainCell removes it again
   * when the workbook is read back.
   */
  const FORMULA_START = /^[=+\-@\t\r]/;
  function safeCell(v) {
    return typeof v === "string" && FORMULA_START.test(v) ? "'" + v : v;
  }
  function plainCell(v) {
    const t = text(v);
    return /^'[=+\-@\t\r]/.test(t) ? t.slice(1) : t;
  }

  /**
   * The Excel version of a pack, for xlsx.writeWorkbook: an About sheet with
   * instructions and the reviewer's details, a Review sheet with one row per
   * item and a Verdict list, and the hidden aixray-pack sheet that ties the
   * workbook to the pack and the engagement.
   */
  function workbookSpec(pack, payload) {
    const items = payload.items || [];
    const s = payload.stakeholder || {};
    const verdictWords = (payload.verdicts || []).map(v => v.label);
    const choices = (payload.verdicts || []).map(v => "\"" + v.label + "\"" + (VERDICT_MEANING[v.value] ? " " + VERDICT_MEANING[v.value] : ""));
    const choiceText = choices.length > 1 ? choices.slice(0, -1).join(", ") + (choices.length > 2 ? ", or " : " or ") + choices[choices.length - 1] : choices.join("");
    const about = [
      ["Process review", payload.title],
      ["Client", payload.client],
      ["Project", payload.engagementName],
      ["Process", payload.modelName],
      ["Prepared for", [s.name, s.role, s.organization].filter(Boolean).join(", ")],
      ["Prepared on", dateOnly(payload.createdAt)],
      ["Items to review", items.length],
      ["Data status", payload.dataStatus],
      ["Confidentiality", payload.confidentiality],
      []
    ];
    if (payload.note) about.push(["Note from the team", payload.note], []);
    about.push(
      ["How to review"],
      ["1", "Go to the Review sheet. Each row is one step in the process, or one point the team noted, such as a problem or an idea."],
      ["2", "In the Your answer column, choose " + choiceText + "."],
      ["3", "In the Your comment column, say what is wrong, missing or unclear. Comments help most when a row is wrong or you are not sure."],
      ["4", "Fill in your details below, save the workbook and send it back to the team. Please don't rename the sheets, or change the Item ID column or the references at the bottom of this sheet."],
      [],
      ["Your name", s.name || ""],
      ["Your role", s.role || ""],
      ["Your organization", s.organization || ""],
      ["General comment", ""],
      []
    );
    about.push(["Form reference", pack.id], ["Project reference", payload.engagementId], ["Project version", payload.engagementRevision]);
    const review = [REVIEW_HEADERS.slice()].concat(items.map(it => [it.itemRef, it.type, it.lane, it.label, it.details, "", ""]));
    const safe = rows => rows.map(row => row.map(safeCell));
    const sheets = [
      { name: ABOUT_SHEET, rows: safe(about), columns: [24, 90], headerRows: 1 },
      { name: REVIEW_SHEET, rows: safe(review), columns: [30, 16, 24, 40, 70, 14, 60], freeze: 1, headerRows: 1,
        validations: items.length ? [{ range: "F2:F" + (items.length + 1), list: verdictWords }] : [] },
      { name: PACK_SHEET, hidden: true, rows: safe([
        ["schema", schema.REVIEW_PACK_ID], ["schemaVersion", 1], ["packId", pack.id], ["engagementId", payload.engagementId],
        ["engagementRevision", payload.engagementRevision], ["format", "xlsx"]
      ]) }
    ];
    return {
      sheets,
      props: { title: "Process review: " + text(payload.title), subject: "Review form", creator: "AIxRay", created: payload.createdAt, modified: payload.createdAt }
    };
  }

  /* ---------- Reading answers back ---------- */

  function norm(v) {
    return text(v).toLowerCase().replace(/[^a-z0-9?]+/g, " ").trim();
  }

  const VERDICT_WORDS = {
    confirm: ["confirm", "confirmed", "confirms", "yes", "y", "correct", "agree", "agreed", "ok", "okay", "right", "accurate", "true", "approved", "approve"],
    dispute: ["dispute", "disputed", "disputes", "no", "n", "incorrect", "not correct", "disagree", "wrong", "inaccurate", "false", "reject", "rejected"],
    unsure: ["unsure", "not sure", "don t know", "dont know", "do not know", "unknown", "maybe", "?", "not certain", "uncertain", "partly", "partially"]
  };

  /**
   * A verdict from what a reviewer typed or picked: "confirm", "dispute",
   * "unsure", "" for nothing, or the original text when it is not
   * recognized (the response check then reports it).
   */
  function normalizeVerdict(v) {
    const raw = text(v).trim();
    const t = norm(raw);
    if (!t) return "";
    for (const key of Object.keys(VERDICT_WORDS)) {
      if (t === key || VERDICT_WORDS[key].includes(t)) return key;
    }
    return raw.slice(0, 60);
  }

  function findSheet(wb, name) {
    const want = name.toLowerCase();
    return (wb.sheets || []).find(s => text(s.name).trim().toLowerCase() === want) || null;
  }

  function keyValues(sheet) {
    const out = new Map();
    if (!sheet) return out;
    (sheet.rows || []).forEach(row => {
      const k = norm(plainCell(row && row[0]));
      if (k && !out.has(k)) out.set(k, typeof row[1] === "string" ? plainCell(row[1]) : row[1]);
    });
    return out;
  }

  const HEADER_ALIASES = {
    itemRef: ["item id", "itemid", "item ref", "item reference", "id"],
    verdict: ["verdict", "your verdict", "answer", "your answer"],
    comment: ["comment", "comments", "your comment", "your comments"]
  };

  function headerMap(row) {
    const map = {};
    (row || []).forEach((cell, i) => {
      const t = norm(cell);
      Object.keys(HEADER_ALIASES).forEach(k => { if (map[k] === undefined && HEADER_ALIASES[k].includes(t)) map[k] = i; });
    });
    return map;
  }

  /**
   * A review response from a filled-in Excel pack, as read by
   * xlsx.readWorkbookAsync: { sheets: [{ name, hidden, rows }] }. Columns on
   * the Review sheet are matched by their header, so moved columns still
   * read; verdict wording is normalized. The pack reference comes from the
   * hidden sheet, or from the About sheet when a re-save lost the hidden one.
   * Throws ReviewError when the workbook is not an AIxRay review pack.
   */
  function responseFromWorkbook(wb) {
    if (!wb || !Array.isArray(wb.sheets)) throw new ReviewError("This file couldn't be read as an Excel workbook.");
    const hidden = keyValues(findSheet(wb, PACK_SHEET));
    const about = keyValues(findSheet(wb, ABOUT_SHEET));
    // The About sheet's reference rows, under their current names or the older ones.
    const aboutRef = keys => keys.map(k => text(about.get(k)).trim()).find(Boolean) || "";
    const packId = text(hidden.get("packid")).trim() || aboutRef(["form reference", "pack reference"]);
    const engagementId = text(hidden.get("engagementid")).trim() || aboutRef(["project reference", "engagement reference"]);
    if (!packId || !engagementId) {
      throw new ReviewError("This workbook is not an AIxRay review form, or its form reference was removed. Ask the reviewer to send back the workbook with the About sheet unchanged.");
    }
    let rev = hidden.has("engagementrevision") ? hidden.get("engagementrevision") :
      about.has("project version") ? about.get("project version") : about.get("engagement revision");
    if (typeof rev === "string" && /^\d+$/.test(rev.trim())) rev = Number(rev.trim());
    let sheet = findSheet(wb, REVIEW_SHEET);
    let headerAt = -1, cols = {};
    const scanFor = s => {
      const rows = (s && s.rows) || [];
      for (let i = 0; i < Math.min(rows.length, 20); i++) {
        const m = headerMap(rows[i]);
        if (m.itemRef !== undefined && m.verdict !== undefined) return { at: i, cols: m };
      }
      return null;
    };
    let found = scanFor(sheet);
    if (!found) {
      sheet = (wb.sheets || []).find(s => scanFor(s)) || null;
      found = sheet ? scanFor(sheet) : null;
    }
    if (!found) throw new ReviewError("This workbook has no Review sheet with Item ID and Your answer columns.");
    headerAt = found.at;
    cols = found.cols;
    const entries = [];
    sheet.rows.slice(headerAt + 1).forEach(row => {
      const r = row || [];
      const itemRef = plainCell(r[cols.itemRef]).trim();
      if (!itemRef) return;
      entries.push({
        itemRef,
        verdict: normalizeVerdict(plainCell(r[cols.verdict])),
        comment: cols.comment === undefined ? "" : plainCell(r[cols.comment]).trim()
      });
    });
    const response = {
      schema: schema.REVIEW_RESPONSE_ID,
      schemaVersion: 1,
      packId,
      engagementId,
      format: "xlsx",
      reviewer: {
        name: text(about.get("your name")).trim(),
        role: text(about.get("your role")).trim(),
        organization: text(about.get("your organization")).trim()
      },
      submittedAt: "",
      generalComment: text(about.get("general comment")).trim(),
      entries
    };
    if (Number.isInteger(rev) && rev >= 0) response.engagementRevision = rev;
    return response;
  }

  /* ---------- Applying answers ---------- */

  function timeOf(iso) {
    const t = Date.parse(iso || "");
    return Number.isFinite(t) ? t : null;
  }

  /* Negative when a is earlier than b. Missing dates count as earliest. */
  function compareTimes(a, b) {
    const x = timeOf(a), y = timeOf(b);
    if (x === null && y === null) return 0;
    if (x === null) return -1;
    if (y === null) return 1;
    return x - y;
  }

  function reviewTime(r) {
    return r.submittedAt || r.receivedAt || "";
  }

  /**
   * The latest answer for every reviewed item, across all reviews in e:
   * Map itemRef -> { verdict, comment, reviewId, reviewer, at, history, conflict }.
   * Reviews are ordered by when they were submitted (received when the
   * submission date is unknown); the latest one wins. history lists every
   * answer in that order; conflict is true when the answers differ.
   */
  function latestVerdicts(e) {
    const out = new Map();
    const list = (e.reviews || []).map((r, i) => ({ r, i }))
      .sort((a, b) => compareTimes(reviewTime(a.r), reviewTime(b.r)) || a.i - b.i);
    list.forEach(({ r }) => (r.entries || []).forEach(en => {
      const answer = { verdict: en.verdict, comment: en.comment, reviewId: r.id, reviewer: Object.assign({}, r.reviewer), at: reviewTime(r) };
      const prev = out.get(en.itemRef);
      const history = prev ? prev.history.concat([answer]) : [answer];
      out.set(en.itemRef, Object.assign({}, answer, { history, conflict: history.some(a => a.verdict !== answer.verdict) }));
    }));
    return out;
  }

  function who(p) {
    const x = p || {};
    return [x.name || "Reviewer not named", x.role, x.organization].filter(Boolean).join(", ");
  }

  function issue(code, message, level, path) {
    return { path: path || "", message, code, level: level || "warning" };
  }

  /**
   * Checks a response (the parsed file, or responseFromWorkbook output)
   * against engagement e and works out what applying it changes.
   * Returns { ok, errors, warnings, response, pack, items, counts }:
   *  - items: one per answered item { itemRef, kind, modelId, nodeId, recordId, label, packLabel, renamed, type,
   *    verdict, comment, currentValidation, targetValidation, locked, previous, superseded }
   *  - counts: { confirm, dispute, unsure, blank, unanswered, total }
   * A response for another engagement is refused (an error).
   */
  function prepareApply(e, data) {
    const v = validate.validateReviewResponse(data, e);
    const empty = { confirm: 0, dispute: 0, unsure: 0, blank: 0, unanswered: 0, total: 0 };
    if (!v.ok) return { ok: false, errors: v.errors, warnings: v.warnings, response: null, pack: null, items: [], counts: empty };
    const response = v.response;
    const warnings = v.warnings.slice();
    const pack = (e.reviewPacks || []).find(p => p.id === response.packId) || null;
    const packItems = new Map(pack ? pack.items.map(it => [it.itemRef, it]) : []);
    if (!pack) {
      warnings.push(issue("review.pack", "This project has no record of the review form these answers belong to, so they are matched to steps and findings by their IDs.", "info", "packId"));
    }
    // Recording the pack is one change, so a pack made at revision n is current at n + 1.
    const madeAt = Number.isInteger(response.engagementRevision) ? response.engagementRevision : null;
    if (madeAt !== null && e.revision > madeAt + 1) {
      const n = e.revision - madeAt - 1;
      warnings.push(issue("review.revision", "The project has had " + n + " change" + (n === 1 ? "" : "s") + " since the review form was created. Any step renamed since then is listed here.", "info", "engagementRevision"));
    }
    const again = (e.reviews || []).find(r => r.packId === response.packId && r.submittedAt && r.submittedAt === response.submittedAt &&
      (r.reviewer.name || "") === (response.reviewer.name || ""));
    if (again) {
      warnings.push(issue("review.again", "These answers from " + who(again.reviewer) + " were already imported on " + dateOnly(again.receivedAt) + ". Importing them again adds a second copy.", "warning"));
    }
    const latest = latestVerdicts(e);
    // Ordered as latestVerdicts will order the stored review: by the submission
    // date, or by the time it is received (now) when the response has none.
    const answeredAt = response.submittedAt || util.nowIso();
    const counts = Object.assign({}, empty);
    const items = [];
    response.entries.forEach(en => {
      const it = resolveItem(e, en.itemRef);
      if (!it) return;
      if (!en.verdict && !en.comment.trim()) { counts.blank++; return; }
      const packItem = packItems.get(en.itemRef);
      if (pack && !packItem) warnings.push(issue("review.extra", "\"" + clip(it.label, 80) + "\" wasn't in the review form but has an answer. It is included.", "info"));
      const packLabel = packItem ? packItem.label : null;
      const renamed = packLabel !== null && packLabel !== it.label.slice(0, 300);
      if (renamed) {
        warnings.push(issue("review.renamed", (it.kind === "step" ? "Step" : "Finding") + " \"" + clip(it.label, 80) + "\" was called \"" + clip(packLabel, 80) +
          "\" in the review form. Check that the answer still applies.", "warning"));
      }
      const prev = latest.get(en.itemRef) || null;
      const superseded = !!(prev && compareTimes(answeredAt, prev.at) < 0);
      if (prev && en.verdict && prev.verdict !== en.verdict) {
        warnings.push(issue("review.conflict", "\"" + clip(it.label, 80) + "\": " + who(prev.reviewer) + " answered \"" + schema.label("reviewVerdict", prev.verdict) + "\"" +
          (prev.at ? " on " + dateOnly(prev.at) : "") + "; this file says \"" + schema.label("reviewVerdict", en.verdict) + "\". " +
          (superseded ? "This file is older, so the answer already imported still counts." : "This file is newer, so its answer counts."), "warning"));
      }
      const current = it.node ? ((it.node.provenance && it.node.provenance.validation) || "unvalidated") : null;
      const target = it.node && !superseded && VALIDATION_FOR[en.verdict] ? VALIDATION_FOR[en.verdict] : null;
      if (en.verdict) counts[en.verdict]++;
      else counts.blank++;
      items.push({
        itemRef: en.itemRef, kind: it.kind, modelId: it.modelId, nodeId: it.nodeId, recordId: it.recordId,
        label: it.label, packLabel, renamed, type: it.type, verdict: en.verdict, comment: en.comment,
        currentValidation: current, targetValidation: target, locked: !!(it.model && it.model.locked),
        previous: prev, superseded
      });
    });
    const answered = new Set(response.entries.filter(en => en.verdict || en.comment.trim()).map(en => en.itemRef));
    counts.unanswered = pack ? pack.items.filter(it => !answered.has(it.itemRef)).length : counts.blank;
    counts.total = pack ? pack.items.length : response.entries.length;
    return { ok: true, errors: [], warnings, response, pack, items, counts };
  }

  /**
   * The payload for review/apply from prepareApply output and the
   * consultant's choices: { validations (default true), questions (default
   * true), evidence (default true) }.
   */
  function buildApplyPayload(e, prepared, choices) {
    const c = Object.assign({ validations: true, questions: true, evidence: true }, choices || {});
    const r = prepared.response;
    const taken = new Set((e.reviews || []).map(x => x.id));
    let id = util.uid("rv");
    while (taken.has(id)) id = util.uid("rv");
    const now = util.nowIso();
    const items = prepared.items;
    const review = {
      id,
      packId: prepared.pack ? prepared.pack.id : null,
      receivedAt: now,
      submittedAt: r.submittedAt || "",
      source: r.format,
      reviewer: Object.assign({}, r.reviewer),
      generalComment: r.generalComment || "",
      entries: items.slice(0, L.reviewEntries).map(it => ({
        itemRef: it.itemRef, label: text(it.label).slice(0, 300),
        // A blank verdict with a comment is kept as not sure, never as confirm.
        verdict: it.verdict || "unsure", comment: it.comment
      })),
      applied: { validations: 0, questions: 0, evidenceId: null }
    };
    const validations = c.validations ? items
      .filter(it => it.kind === "step" && it.targetValidation && it.targetValidation !== it.currentValidation)
      .map(it => ({ modelId: it.modelId, nodeId: it.nodeId, validation: it.targetValidation })) : [];
    const name = who(r.reviewer);
    const day = dateOnly(r.submittedAt || now);
    const questions = c.questions ? items
      .filter(it => (it.verdict === "dispute" || it.verdict === "unsure" || !it.verdict) && it.comment.trim())
      .map(it => {
        const record = it.recordId ? e.records.find(x => x.id === it.recordId) : null;
        const lead = it.verdict === "dispute" ? "Disputed in client review: " : "Not confirmed in client review: ";
        return {
          kind: "question",
          title: (lead + it.label).slice(0, 300),
          description: name + " (" + day + ") on \"" + it.label + "\": " + it.comment,
          linkedModelId: it.kind === "step" ? it.modelId : (record ? record.linkedModelId : null),
          linkedNodeIds: it.kind === "step" ? [it.nodeId] : (record ? record.linkedNodeIds.slice() : []),
          includeInHandoff: true
        };
      }) : [];
    let evidence = null;
    if (c.evidence) {
      const n = prepared.counts;
      evidence = {
        title: ("Client review: " + name + ", " + day).slice(0, 300),
        locator: "Review pack " + (prepared.pack ? prepared.pack.id : r.packId) + " (" + schema.label("reviewFormat", r.format) + ")",
        extractedFact: n.confirm + " confirmed, " + n.dispute + " disputed and " + n.unsure + " not sure, of " + n.total + " items in the pack." +
          (r.generalComment ? " General comment: " + r.generalComment : ""),
        status: "validated",
        reviewer: (r.reviewer.name || "").slice(0, 200),
        reviewDate: day,
        steps: items.filter(it => it.kind === "step" && it.verdict === "confirm").map(it => ({ modelId: it.modelId, nodeId: it.nodeId }))
      };
    }
    return { review, validations, questions, evidence };
  }

  /* ---------- Store commands ---------- */

  const H = store.helpers;

  const COMMANDS = {
    /* Records a pack that was sent to a client stakeholder. */
    "review/recordPack"(e, p) {
      e.reviewPacks = e.reviewPacks || [];
      if (e.reviewPacks.length >= L.reviewPacks) throw new H.StoreError("limit", "This project already has " + L.reviewPacks + " review forms, the most it can hold. Delete old ones in Findings, Reviews.");
      const r = validate.sanitizeReviewPack(p.pack, e);
      if (r.errors.length) throw new H.StoreError("invalid", "Review form: " + r.errors[0].message);
      if (!r.value.items.length) throw new H.StoreError("invalid", "A review form needs at least one step or finding.");
      e.reviewPacks.push(r.value);
      return { id: r.value.id };
    },

    /*
     * Applies a client review in one undoable step. Validation changes touch
     * node.provenance only, so they work on a locked baseline and never mark a
     * future-state step as modified.
     */
    "review/apply"(e, p) {
      e.reviews = e.reviews || [];
      if (e.reviews.length >= L.reviews) throw new H.StoreError("limit", "This project already has " + L.reviews + " reviews, the most it can hold.");
      const raw = p.review;
      if (!raw || typeof raw !== "object") throw new H.StoreError("invalid", "There is no review to apply.");
      const validations = Array.isArray(p.validations) ? p.validations : [];
      const questions = Array.isArray(p.questions) ? p.questions : [];
      let changed = 0;
      validations.forEach(v => {
        const model = H.findModel(e, v && v.modelId);
        const node = H.findNode(model, v.nodeId);
        if (!schema.ENUMS.validation.includes(v.validation)) throw new H.StoreError("invalid", "Unknown validation status " + v.validation + ".");
        node.provenance = node.provenance || { source: "unknown", validation: "unvalidated", evidenceRefs: [], note: "" };
        if (node.provenance.validation !== v.validation) { node.provenance.validation = v.validation; changed++; }
      });
      let evidenceId = null;
      if (p.evidence) {
        const ev = p.evidence;
        const title = H.cleanText(ev.title, 300).trim();
        if (!title) throw new H.StoreError("invalid", "The source needs a title.");
        if (e.evidence.length >= L.evidence) throw new H.StoreError("limit", "This project already has " + L.evidence + " sources, the most it can hold.");
        const taken = new Set(e.evidence.map(x => x.id));
        evidenceId = util.uid("ev");
        while (taken.has(evidenceId)) evidenceId = util.uid("ev");
        e.evidence.push({
          id: evidenceId, title, locator: H.cleanText(ev.locator, 500), extractedFact: H.cleanText(ev.extractedFact),
          status: H.enumValue("evidenceStatus", ev.status, "validated"),
          reviewer: H.cleanText(ev.reviewer, 200), reviewDate: H.cleanText(ev.reviewDate, 40), link: null
        });
        (Array.isArray(ev.steps) ? ev.steps : []).forEach(s => {
          const node = H.findNode(H.findModel(e, s && s.modelId), s.nodeId);
          node.provenance = node.provenance || { source: "unknown", validation: "unvalidated", evidenceRefs: [], note: "" };
          node.provenance.evidenceRefs = node.provenance.evidenceRefs || [];
          if (!node.provenance.evidenceRefs.includes(evidenceId)) node.provenance.evidenceRefs.push(evidenceId);
        });
      }
      if (e.records.length + questions.length > L.records) throw new H.StoreError("limit", "A project can't hold more than " + L.records + " findings.");
      const questionIds = questions.map(q => {
        const record = H.newRecord(e, Object.assign({}, q, { kind: "question", evidenceRefs: [] }));
        if (evidenceId) record.evidenceRefs = [evidenceId];
        e.records.push(record);
        return record.id;
      });
      const ids = new Set(e.reviews.map(x => x.id));
      const id = util.isValidId(raw.id) && !ids.has(raw.id) ? raw.id : util.uniqueId("rv-" + util.slug(util.nowIso().slice(0, 10)), ids);
      const r = validate.sanitizeReview(Object.assign({}, raw, { id, applied: { validations: changed, questions: questionIds.length, evidenceId } }), e);
      if (r.errors.length) throw new H.StoreError("invalid", "Review: " + r.errors[0].message);
      e.reviews.push(r.value);
      return { id, validations: changed, questions: questionIds, evidenceId };
    },

    /* Removes a received review. Validation it set on steps stays as it is. */
    "review/delete"(e, p) {
      const before = (e.reviews || []).length;
      e.reviews = (e.reviews || []).filter(r => r.id !== p.id);
      if (e.reviews.length === before) throw new H.StoreError("not-found", "Review not found.");
      return { id: p.id };
    },

    /* Removes a recorded pack. Reviews of it stay, without the link. */
    "review/deletePack"(e, p) {
      const before = (e.reviewPacks || []).length;
      e.reviewPacks = (e.reviewPacks || []).filter(x => x.id !== p.id);
      if (e.reviewPacks.length === before) throw new H.StoreError("not-found", "Review form not found.");
      (e.reviews || []).forEach(r => { if (r.packId === p.id) r.packId = null; });
      return { id: p.id };
    }
  };

  if (store && typeof store.registerCommands === "function" && !Object.prototype.hasOwnProperty.call(store.COMMANDS, "review/apply")) {
    store.registerCommands(COMMANDS);
  }

  /**
   * A summary for the handoff and the records tab, using the latest answer
   * per item: { reviews, reviewers, steps: { confirm, dispute, unsure }, findings: { ... }, items }.
   * Findings that are sensitive or unreviewed AI drafts are left out unless asked.
   */
  function summarize(e, opts) {
    const o = opts || {};
    const latest = latestVerdicts(e);
    const steps = { confirm: 0, dispute: 0, unsure: 0 };
    const findings = { confirm: 0, dispute: 0, unsure: 0 };
    const items = [];
    latest.forEach((answer, ref) => {
      const it = resolveItem(e, ref);
      if (!it) return;
      if (it.record && ((it.record.sensitive && !o.includeSensitive) || (isUnreviewedAi(it.record) && !o.includeUnreviewedAi))) return;
      const bucket = it.kind === "step" ? steps : findings;
      if (answer.verdict in bucket) bucket[answer.verdict]++;
      items.push({ itemRef: ref, kind: it.kind, label: it.label, type: it.type, lane: it.lane, modelId: it.modelId, nodeId: it.nodeId,
        recordId: it.recordId, answer });
    });
    const reviewers = [];
    (e.reviews || []).forEach(r => { const w = who(r.reviewer); if (!reviewers.includes(w)) reviewers.push(w); });
    return { reviews: (e.reviews || []).length, reviewers, steps, findings, items };
  }

  return {
    PACK_SHEET, REVIEW_SHEET, ABOUT_SHEET, REVIEW_HEADERS, FINDING_KINDS, DEFAULT_KINDS, ReviewError,
    stepRef, recordRef, resolveItem, packCounts, buildPackItems, newPack, packPayload, workbookSpec,
    normalizeVerdict, responseFromWorkbook, latestVerdicts, prepareApply, buildApplyPayload, summarize, who,
    commands: COMMANDS
  };
});
