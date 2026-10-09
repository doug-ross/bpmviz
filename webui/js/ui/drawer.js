/*
 * Side panel for the process workspace:
 *  - overview: scenario, scorecard and a keyboard-friendly activity list
 *  - activity drawer: summary, quick capture of linked records, and editing
 */
(function (root) {
  "use strict";
  const B = root.BPMVIZ = root.BPMVIZ || {};
  const { h, clear, icon, iconButton, formatDate, announce } = B.dom;
  const { schema, units, replay: replayLib, economics, diagram } = B;

  const TONE = { done: "success", progress: "info", stuck: "warning", new: "" };
  const PROV_TONE = { illustrative: "", supplied: "info", observed: "success" };

  function badge(text, tone) {
    return h("span", { class: "badge" + (tone ? " " + tone : "") }, text);
  }

  function stateIcon(state) {
    const map = { active: "play", done: "check", excluded: "close", unknown: "help" };
    return map[state] ? icon(map[state]) : h("span", { "aria-hidden": "true" });
  }

  function textList(value) {
    if (value == null || value === "") return null;
    if (Array.isArray(value)) {
      const items = value.filter(v => v !== null && v !== "");
      if (!items.length) return null;
      return items.length === 1 ? String(items[0]) : h("ul", { class: "plain-list" }, items.map(v => h("li", null, typeof v === "object" ? JSON.stringify(v) : String(v))));
    }
    if (typeof value === "object") return h("ul", { class: "plain-list" }, Object.keys(value).map(k => h("li", null, niceName(k) + ": " + String(value[k]))));
    return String(value);
  }

  function niceName(key) {
    return String(key).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/^./, c => c.toUpperCase());
  }

  function facts(pairs) {
    const rows = pairs.filter(([, v]) => v !== null && v !== undefined && v !== "");
    if (!rows.length) return null;
    return h("dl", { class: "facts" }, rows.map(([k, v]) => [h("dt", null, k), h("dd", null, v)]));
  }

  function measureText(m) {
    if (!m || !B.util.isFiniteNumber(m.value)) return null;
    return units.formatMeasure(m.value, m.unit || "minute", {});
  }

  /* Sections registered with BPMVIZ.ext.registerDrawerSection for one place. */
  function extSections(ctx, where, model, node) {
    if (!B.ext) return [];
    return B.ext.list("drawerSection").filter(s => s.where === where)
      .map(s => B.ext.guard("drawerSection", s, () => s.render(ctx, model, node), null)).filter(x => x instanceof Node);
  }

  /* ---------------- Overview ---------------- */

  function scorecard(ctx) {
    const e = ctx.engagement, s = ctx.scenario;
    if (!s || !s.measures.length) return null;
    const ids = economics.modelIds(e, s);
    const hasAfter = !!ids.after && s.measures.some(m => B.util.isFiniteNumber(m.values[ids.after]));
    const uctx = { timeBasis: e.meta.timeBasis, currency: e.meta.currency };
    const nameOf = id => (e.models.find(m => m.id === id) || {}).name || "";
    const rows = s.measures.map(m => {
      const b = m.values[ids.before], a = hasAfter ? m.values[ids.after] : null;
      const change = hasAfter ? units.formatDelta(b, a, m.unit, uctx) : null;
      const pct = hasAfter && m.unit !== "percent" ? units.formatPercentChange(b, a) : null;
      const delta = change && change !== units.NA ? change + (pct && pct !== units.NA && change !== "No change" ? " (" + pct + ")" : "") : "";
      return h("div", { class: "measure-row", title: m.note || "" },
        h("div", { class: "m-top" }, h("span", { class: "m-label" }, m.label), delta ? h("span", { class: "m-delta" }, delta) : null),
        h("div", { class: "m-vals" }, units.formatMeasure(b, m.unit, uctx) + (hasAfter ? " \u2192 " + units.formatMeasure(a, m.unit, uctx) : "")));
    });
    const table = h("div", { class: "measure-list", role: "list", "aria-label": "Measures" },
      hasAfter ? h("p", { class: "note", style: { margin: "0 0 2px" } }, nameOf(ids.before) + " \u2192 " + nameOf(ids.after)) : null,
      rows.map(r => { r.setAttribute("role", "listitem"); return r; }));
    const recon = s.economics ? economics.reconcileScenario(e, s) : null;
    let reconLine = null;
    if (recon && recon.checks.length) {
      const bad = recon.checks.filter(c => c.status === "unreconciled").length;
      const text = !e.assumptions.length ? "Supplied cost and capacity figures have no declared assumptions, so they are not reconciled." :
        bad ? bad + " of " + recon.checks.length + " supplied cost and capacity figures do not reconcile with the declared assumptions." :
          "Supplied cost and capacity figures reconcile with the declared assumptions.";
      reconLine = h("div", { class: "warn-line" }, icon(bad || !e.assumptions.length ? "alert" : "check"),
        h("span", null, text, " ", h("button", { type: "button", class: "link-btn", on: { click: () => ctx.goto("value") } }, "Open the value model")));
    }
    return h("section", { class: "side-section", "aria-labelledby": "sc-h" },
      h("h3", { id: "sc-h" }, "Scorecard"),
      table,
      h("p", { class: "note" }, "Figures are " + schema.label("scenarioProvenance", s.provenance).toLowerCase() +
        " and shown in their declared units. " + units.describeTimeBasis(e.meta.timeBasis)),
      reconLine);
  }

  function activityList(ctx) {
    const model = ctx.primaryModel;
    const rp = ctx.replays.get(model.id);
    const list = h("ul", { class: "activity-list", "aria-label": "Steps in " + model.name });
    model.lanes.forEach(lane => {
      const nodes = model.nodes.filter(n => n.laneId === lane.id)
        .sort((a, b) => (ctx.positions(model.id, a.id) - ctx.positions(model.id, b.id)));
      if (!nodes.length) return;
      list.appendChild(h("li", { class: "lane-name" }, lane.name));
      nodes.forEach(n => {
        const st = rp ? replayLib.nodeStateAt(rp, n.id, ctx.t) : null;
        const count = ctx.recordCount(model.id, n.id);
        list.appendChild(h("li", null, h("button", {
          type: "button", "aria-current": ctx.selected && ctx.selected.nodeId === n.id ? "true" : null,
          on: { click: () => ctx.select(model.id, n.id, { center: true, focusDrawer: true }) }
        }, stateIcon(st ? st.state : ""), h("span", null, n.label + (n.removed ? " (removed)" : "")),
        h("span", { class: "st" }, (st ? diagram.statusText(st, ctx.engagement.meta.timeBasis) : "") + (count ? " \u00b7 " + count + " rec." : "")))));
      });
    });
    return h("section", { class: "side-section", "aria-labelledby": "al-h" },
      h("h3", { id: "al-h" }, "Steps (" + model.nodes.length + ")"),
      h("p", { class: "note" }, "The same steps as the canvas, in lane and flow order."),
      list);
  }

  function renderOverview(container, ctx) {
    clear(container);
    const e = ctx.engagement, s = ctx.scenario;
    const inner = h("div", { class: "side-inner" });
    if (s) {
      inner.appendChild(h("section", { class: "side-section", "aria-labelledby": "scn-h" },
        h("div", { class: "eyebrow" }, "Scenario"),
        h("h2", { id: "scn-h" }, s.name),
        h("div", { class: "scenario-head" },
          s.statusLabel ? badge(s.statusLabel, TONE[s.statusTone]) : null,
          s.statusLabel && s.statusLabel.toLowerCase().includes(schema.label("scenarioProvenance", s.provenance).toLowerCase()) ? null :
            badge(schema.label("scenarioProvenance", s.provenance), PROV_TONE[s.provenance])),
        s.summary ? h("p", { class: "small" }, s.summary) : null,
        facts(s.attributes.map(a => [a.label, a.value])),
        h("p", { class: "note" }, h("strong", null, schema.label("timingMethod", s.timing.method) + ". "), s.timing.note || "")));
    } else {
      inner.appendChild(h("section", { class: "side-section" },
        h("h2", null, e.meta.processName),
        h("p", { class: "small" }, "No scenario timing is recorded for this engagement, so playback is off. You can still inspect, correct and capture findings on every step.")));
    }
    const card = scorecard(ctx);
    if (card) inner.appendChild(card);
    extSections(ctx, "overview", ctx.primaryModel, null).forEach(x => inner.appendChild(x));
    const current = e.models.find(m => m.role === "current");
    if (current && !e.models.some(m => m.basedOn && m.basedOn.modelId === current.id)) {
      inner.appendChild(h("section", { class: "side-section" },
        h("h3", null, "Redesign"),
        h("p", { class: "small" }, "Start a future-state draft from the current state. The current state then stays fixed as the baseline, and every change in the draft is tracked against it."),
        h("div", null, h("button", { type: "button", class: "btn", on: { click: () => ctx.cloneBaseline(current.id) } }, icon("clone"), "Start a future-state draft"))));
    }
    if (current && ctx.aiTask) {
      inner.appendChild(h("section", { class: "side-section" },
        h("h3", null, "Draft with AI"),
        h("p", { class: "small" }, "Ask Claude Code or Codex, on your own sign-in, for a future-state draft or suggested records. You review each item before anything changes."),
        h("div", { class: "btn-stack" },
          h("button", { type: "button", class: "btn", id: "drawer-ai-future", on: { click: () => ctx.aiTask("future-state") } }, icon("agent"), "Draft a future state with AI"),
          h("button", { type: "button", class: "btn", id: "drawer-ai-suggest", on: { click: () => ctx.aiTask("opportunities") } }, icon("agent"), "Suggest records with AI"))));
    }
    inner.appendChild(activityList(ctx));
    container.appendChild(inner);
  }

  /* ---------------- Activity drawer ---------------- */

  function statusParts(st, timeBasis) {
    const parts = [stateIcon(st ? st.state : ""),
      h("span", { class: "status-text" }, st ? diagram.statusText(st, timeBasis) : "No scenario timing")];
    if (st && st.sla && st.state === "active") {
      parts.push(badge(Math.round(st.sla.pct * 100) + "% of SLA", st.sla.state === "breach" ? "error" : st.sla.state === "warn" ? "warning" : ""));
    }
    return parts;
  }

  function linkedRecords(e, modelId, nodeId) {
    return e.records.filter(r => r.linkedNodeIds.includes(nodeId) && (!r.linkedModelId || r.linkedModelId === modelId));
  }

  function summaryTab(ctx, model, node, st) {
    const d = node.details || {};
    const lane = model.lanes.find(l => l.id === node.laneId);
    const tb = ctx.engagement.meta.timeBasis;
    const rp = ctx.replays.get(model.id);
    const visits = rp ? replayLib.visitHistory(rp, node.id) : [];
    const ev = new Map(ctx.engagement.evidence.map(x => [x.id, x]));
    const m = node.measures || {};
    const box = h("div", { class: "side-inner" });
    box.appendChild(h("section", { class: "side-section" },
      d.desc ? h("p", { class: "small" }, String(d.desc)) : h("p", { class: "small muted" }, "No description recorded."),
      facts([
        ["Accountable", d.owner ? String(d.owner) : null],
        ["Responsible", d.who ? String(d.who) : null],
        ["Swimlane", lane ? lane.name : ""],
        ["Authority", textList(d.authority)],
        ["Systems", textList(d.systems)],
        ["Typical time", measureText(m.typicalDuration)],
        ["SLA target", measureText(m.slaTarget)],
        ["Touch effort", measureText(m.touchEffort)],
        ["Wait type", m.waitType ? schema.label("waitType", m.waitType) : null],
        ["Effort (notes)", textList(d.effort)],
        ["Pain points", textList(d.pain)],
        ["Controls", textList(d.controls)]
      ])));
    if (visits.length) {
      box.appendChild(h("section", { class: "side-section" },
        h("h3", null, "Visits in this scenario"),
        h("ol", { class: "plain-list small" }, visits.map(v => h("li", null,
          units.formatDuration(v.start, tb) + " to " + units.formatDuration(v.end, tb) +
          " (" + units.formatDuration(v.duration, tb, { precise: true }) + ")")))));
    }
    const p = node.provenance || {};
    box.appendChild(h("section", { class: "side-section" },
      h("h3", null, "Provenance"),
      facts([
        ["Source", schema.label("provenanceSource", p.source)],
        ["Validation", schema.label("validation", p.validation)],
        ["Evidence", (p.evidenceRefs || []).length ? h("ul", { class: "plain-list" }, p.evidenceRefs.map(id => {
          const x = ev.get(id);
          return h("li", null, x ? x.title + " (" + schema.label("evidenceStatus", x.status) + ")" : id);
        })) : "None linked"],
        ["Source IDs", (node.sourceIds || []).length ? node.sourceIds.join(", ") : null],
        ["Note", p.note || null]
      ]),
      node.lineage ? facts([
        ["Change", schema.label("change", node.lineage.change)],
        ["Baseline step", node.lineage.baselineNodeId ? ctx.baselineLabel(model, node.lineage.baselineNodeId) : "New in this draft"],
        ["Rationale", node.lineage.rationale || null]
      ]) : null,
      h("div", null, h("button", { type: "button", class: "btn", on: { click: () => ctx.fullDetails(model.id, node.id) } }, icon("list"), "All recorded fields"))));
    extSections(ctx, "step", model, node).forEach(x => box.appendChild(x));
    return box;
  }

  function recordRow(ctx, r) {
    const status = h("select", { class: "select", "aria-label": "Status of " + r.title },
      schema.ENUMS.recordStatus.map(v => h("option", { value: v, selected: v === r.status }, schema.label("recordStatus", v))));
    status.addEventListener("change", () => ctx.dispatch("record/update", { id: r.id, patch: { status: status.value } }, "Status updated"));
    return h("div", { class: "record-mini" },
      h("div", { class: "rm-top" },
        h("span", { class: "rm-title" }, r.title),
        iconButton("edit", "Edit " + r.title, { on: { click: () => ctx.openRecord(r) } }, { variant: "btn-ghost" })),
      h("div", { class: "rm-meta" },
        h("span", null, schema.label("recordKind", r.kind)),
        r.owner ? h("span", null, "Owner: " + r.owner) : h("span", null, "No owner"),
        r.sensitive ? badge("Sensitive", "warning") : null,
        status));
  }

  function captureTab(ctx, model, node) {
    const e = ctx.engagement;
    const box = h("div", { class: "side-inner" });
    const kinds = ["pain", "opportunity", "question", "decision", "action", "assumption", "note"];
    const kindSet = h("fieldset", { class: "segmented" }, h("legend", null, "Record type"),
      kinds.map((k, i) => h("label", null, h("input", { type: "radio", name: "cap-kind", value: k, checked: i === 0 }), h("span", null, schema.label("recordKind", k)))));
    const title = h("input", { class: "input", id: "cap-title", maxlength: 300, autocomplete: "off" });
    const desc = h("textarea", { class: "textarea", id: "cap-desc", rows: 3 });
    const owner = h("input", { class: "input", id: "cap-owner", maxlength: 200, list: "owner-list", autocomplete: "off" });
    const sensitive = h("input", { type: "checkbox", id: "cap-sensitive" });
    const err = h("p", { class: "error-text", role: "alert", hidden: true });
    const form = h("form", { class: "form-grid", "aria-label": "Capture a record for " + node.label },
      kindSet,
      h("div", { class: "field" }, h("label", { for: "cap-title" }, "Title"), title),
      h("div", { class: "field" }, h("label", { for: "cap-desc" }, "Details"), desc),
      h("div", { class: "field" }, h("label", { for: "cap-owner" }, "Owner"), owner),
      h("label", { class: "check" }, sensitive, "Sensitive (left out of exports unless selected)"),
      err,
      h("div", { class: "form-actions" }, h("button", { type: "submit", class: "btn btn-primary" }, icon("plus"), "Add record")));
    form.addEventListener("submit", ev => {
      ev.preventDefault();
      const kind = (form.querySelector("input[name=cap-kind]:checked") || {}).value || "note";
      if (!title.value.trim()) { err.hidden = false; err.textContent = "Give the record a title."; title.focus(); return; }
      err.hidden = true;
      const ok = ctx.dispatch("record/add", { record: {
        kind, title: title.value, description: desc.value, owner: owner.value, sensitive: sensitive.checked,
        linkedModelId: model.id, linkedNodeIds: [node.id]
      } }, schema.label("recordKind", kind) + " added to " + node.label);
      if (ok) { title.value = ""; desc.value = ""; sensitive.checked = false; title.focus(); }
    });
    const owners = [...new Set(e.records.map(r => r.owner).filter(Boolean))];
    box.appendChild(h("section", { class: "side-section" }, form, h("datalist", { id: "owner-list" }, owners.map(o => h("option", { value: o })))));
    const recs = linkedRecords(e, model.id, node.id);
    box.appendChild(h("section", { class: "side-section", "aria-labelledby": "lr-h" },
      h("h3", { id: "lr-h" }, "Linked records (" + recs.length + ")"),
      recs.length ? h("div", null, recs.map(r => recordRow(ctx, r))) : h("p", { class: "small muted" }, "Nothing captured for this step yet.")));
    return box;
  }

  function unitSelect(id, value, allowed) {
    return h("select", { class: "select", id }, allowed.map(u => h("option", { value: u, selected: u === value }, units.unitLabel(u))));
  }

  function editTab(ctx, model, node) {
    const box = h("div", { class: "side-inner" });
    if (model.locked) {
      const draft = ctx.engagement.models.find(m => m.basedOn && m.basedOn.modelId === model.id);
      box.appendChild(h("div", { class: "locked-note" },
        h("p", null, h("strong", null, model.name + " is the locked baseline. "), "A future-state draft is based on it, so its steps stay fixed and every change is made in the draft."),
        draft ? h("div", null, h("button", { type: "button", class: "btn", on: { click: () => ctx.showModel(draft.id, node.id) } }, "Edit this step in " + draft.name)) : null));
      return box;
    }
    const d = node.details || {};
    const m = node.measures || {};
    const p = node.provenance || {};
    const val = x => x == null ? "" : Array.isArray(x) ? x.join(", ") : String(x);
    const input = (id, value, attrs) => h("input", Object.assign({ class: "input", id, value: value == null ? "" : String(value) }, attrs || {}));
    const numberInput = (id, mv) => input(id, mv && B.util.isFiniteNumber(mv.value) ? mv.value : "", { type: "number", min: 0, step: "any", inputmode: "decimal" });
    const f = {
      label: input("ed-label", node.label, { maxlength: 300, required: true }),
      sub: input("ed-sub", node.sub, { maxlength: 300 }),
      desc: h("textarea", { class: "textarea", id: "ed-desc", rows: 4 }, val(d.desc)),
      owner: input("ed-owner", val(d.owner)),
      who: input("ed-who", val(d.who)),
      systems: input("ed-systems", val(d.systems)),
      slaV: numberInput("ed-sla", m.slaTarget), slaU: unitSelect("ed-sla-u", (m.slaTarget || {}).unit || "hour", ["minute", "hour", "businessDay", "calendarDay"]),
      typV: numberInput("ed-typ", m.typicalDuration), typU: unitSelect("ed-typ-u", (m.typicalDuration || {}).unit || "hour", ["minute", "hour", "businessDay", "calendarDay"]),
      effV: numberInput("ed-eff", m.touchEffort), effU: unitSelect("ed-eff-u", (m.touchEffort || {}).unit || "hour", ["minute", "hour"]),
      wait: h("select", { class: "select", id: "ed-wait" }, schema.ENUMS.waitType.map(v => h("option", { value: v, selected: v === (m.waitType || "") }, schema.label("waitType", v)))),
      source: h("select", { class: "select", id: "ed-source" }, schema.ENUMS.provenanceSource.map(v => h("option", { value: v, selected: v === p.source }, schema.label("provenanceSource", v)))),
      validation: h("select", { class: "select", id: "ed-validation" }, schema.ENUMS.validation.map(v => h("option", { value: v, selected: v === p.validation }, schema.label("validation", v)))),
      evidence: h("select", { class: "select", id: "ed-evidence", multiple: true, size: Math.min(5, Math.max(2, ctx.engagement.evidence.length)) },
        ctx.engagement.evidence.map(x => h("option", { value: x.id, selected: (p.evidenceRefs || []).includes(x.id) }, x.title))),
      rationale: node.lineage ? h("textarea", { class: "textarea", id: "ed-rationale", rows: 2 }, node.lineage.rationale || "") : null
    };
    const tags = ["bottleneck", "agent", "humanReview", "optional"].map(k => h("label", { class: "check" },
      h("input", { type: "checkbox", name: "ed-tag", value: k, checked: !!(node.tags || {})[k] }),
      { bottleneck: "Suspected bottleneck", agent: "AI or automation", humanReview: "Human review point", optional: "Optional step" }[k]));
    const err = h("p", { class: "error-text", role: "alert", hidden: true });
    const pair = (label, id, a, b) => h("div", { class: "field" }, h("label", { for: id }, label), h("div", { class: "field-row" }, a, b));
    const form = h("form", { class: "form-grid", "aria-label": "Edit " + node.label },
      h("div", { class: "field" }, h("label", { for: "ed-label" }, "Step name"), f.label),
      h("div", { class: "field" }, h("label", { for: "ed-sub" }, "Subtitle"), f.sub),
      h("div", { class: "field" }, h("label", { for: "ed-desc" }, "Description"), f.desc),
      h("div", { class: "field-row" },
        h("div", { class: "field" }, h("label", { for: "ed-owner" }, "Accountable owner"), f.owner),
        h("div", { class: "field" }, h("label", { for: "ed-who" }, "Responsible"), f.who)),
      h("div", { class: "field" }, h("label", { for: "ed-systems" }, "Systems"), f.systems, h("span", { class: "field-hint" }, "Separate with commas.")),
      pair("SLA target", "ed-sla", f.slaV, f.slaU),
      pair("Typical duration", "ed-typ", f.typV, f.typU),
      pair("Human touch effort per case", "ed-eff", f.effV, f.effU),
      h("div", { class: "field" }, h("label", { for: "ed-wait" }, "Wait type"), f.wait),
      h("fieldset", { class: "segmented" }, h("legend", null, "Tags"), h("div", { class: "form-grid" }, tags)),
      h("div", { class: "field-row" },
        h("div", { class: "field" }, h("label", { for: "ed-source" }, "Provenance"), f.source),
        h("div", { class: "field" }, h("label", { for: "ed-validation" }, "Validation"), f.validation)),
      ctx.engagement.evidence.length ? h("div", { class: "field" }, h("label", { for: "ed-evidence" }, "Evidence"), f.evidence,
        h("span", { class: "field-hint" }, "Ctrl or Cmd to select several.")) : null,
      f.rationale ? h("div", { class: "field" }, h("label", { for: "ed-rationale" }, "Reason for the change"), f.rationale) : null,
      err,
      h("div", { class: "form-actions" },
        h("button", { type: "button", class: "btn", on: { click: () => ctx.setTab("summary") } }, "Cancel"),
        h("button", { type: "submit", class: "btn btn-primary" }, "Save changes")));
    form.addEventListener("submit", ev => {
      ev.preventDefault();
      const num = (v, u) => v.value === "" ? null : { value: Number(v.value), unit: u.value };
      const patch = {
        label: f.label.value, sub: f.sub.value,
        details: { desc: f.desc.value, owner: f.owner.value, who: f.who.value,
          systems: f.systems.value.trim() ? f.systems.value.split(",").map(x => x.trim()).filter(Boolean) : "" },
        measures: { slaTarget: num(f.slaV, f.slaU), typicalDuration: num(f.typV, f.typU), touchEffort: num(f.effV, f.effU), waitType: f.wait.value },
        provenance: { source: f.source.value, validation: f.validation.value,
          evidenceRefs: Array.from(f.evidence.selectedOptions || []).map(o => o.value) },
        tags: Object.fromEntries(Array.from(form.querySelectorAll("input[name=ed-tag]")).map(c => [c.value, c.checked]))
      };
      if (f.rationale) patch.rationale = f.rationale.value;
      if (!ctx.engagement.evidence.length) delete patch.provenance.evidenceRefs;
      const ok = ctx.dispatch("node/update", { modelId: model.id, nodeId: node.id, patch }, "Changes to " + f.label.value + " saved", err);
      if (ok) ctx.setTab("summary");
    });
    box.appendChild(form);
    if (model.role === "future" && !model.locked) {
      box.appendChild(h("section", { class: "side-section" },
        h("h3", null, "Change the flow"),
        h("p", { class: "small" }, "Insert a new step after this one, or remove it. Removing a step reconnects its neighbours and keeps the step in the draft as removed, so the comparison shows it."),
        h("div", { class: "form-actions", style: { justifyContent: "flex-start" } },
          h("button", { type: "button", class: "btn", on: { click: () => ctx.insertAfter(model.id, node.id) } }, icon("plus"), "Insert step after"),
          node.removed ? null : h("button", { type: "button", class: "btn btn-danger", on: { click: () => ctx.removeStep(model.id, node.id) } }, icon("trash"), "Remove step"))));
    }
    return box;
  }

  /** ctx.tab: "summary" | "capture" | "edit" */
  function renderActivity(container, ctx) {
    clear(container);
    const model = ctx.engagement.models.find(m => m.id === ctx.selected.modelId);
    const node = model && model.nodes.find(n => n.id === ctx.selected.nodeId);
    if (!node) return false;
    const lane = model.lanes.find(l => l.id === node.laneId);
    const rp = ctx.replays.get(model.id);
    const st = rp ? replayLib.nodeStateAt(rp, node.id, ctx.t) : null;
    const records = linkedRecords(ctx.engagement, model.id, node.id);
    const tabs = [["summary", "Summary"], ["capture", "Capture (" + records.length + ")"], ["edit", "Edit"]];
    const tabBar = h("div", { class: "drawer-tabs", role: "tablist", "aria-label": "Step panels" });
    const panel = h("div", { role: "tabpanel", id: "drawer-panel", tabindex: -1 });
    tabs.forEach(([id, label]) => {
      const t = h("button", { type: "button", class: "tab", role: "tab", id: "dt-" + id, "aria-selected": String(ctx.tab === id),
        "aria-controls": "drawer-panel", tabindex: ctx.tab === id ? 0 : -1 }, label);
      t.addEventListener("click", () => ctx.setTab(id));
      t.addEventListener("keydown", ev => {
        const i = tabs.findIndex(x => x[0] === id);
        const next = ev.key === "ArrowRight" ? tabs[(i + 1) % tabs.length] : ev.key === "ArrowLeft" ? tabs[(i + tabs.length - 1) % tabs.length] : null;
        if (next) { ev.preventDefault(); ctx.setTab(next[0], true); }
      });
      tabBar.appendChild(t);
    });
    panel.setAttribute("aria-labelledby", "dt-" + ctx.tab);
    const statusLine = h("div", { class: "status-line", id: "drawer-status" }, statusParts(st, ctx.engagement.meta.timeBasis));
    const head = h("header", { class: "drawer-head" },
      h("div", { class: "drawer-top" },
        h("span", { class: "eyebrow" }, schema.typeInfo(node.semanticType).label + (node.sourceType ? " (" + node.sourceType + ")" : "")),
        h("span", { class: "spacer" }),
        iconButton("focus", "Center on canvas", { on: { click: () => ctx.focusNode(model.id, node.id) } }, { variant: "btn-ghost" }),
        iconButton("close", "Close step panel (Esc)", { id: "drawer-close", on: { click: () => ctx.close() } }, { variant: "btn-ghost" })),
      h("h2", { id: "drawer-title", tabindex: -1 }, node.label),
      h("div", { class: "small muted" }, (lane ? lane.name : "") + " \u00b7 " + model.name + (node.removed ? " \u00b7 removed in this draft" : "")),
      statusLine);
    const wrapper = h("div", { class: "side-inner" }, head, tabBar);
    const body = ctx.tab === "capture" ? captureTab(ctx, model, node) : ctx.tab === "edit" ? editTab(ctx, model, node) : summaryTab(ctx, model, node, st);
    panel.appendChild(body);
    container.append(wrapper, panel);
    return true;
  }

  /** Lightweight refresh of the status line while playback runs. */
  function refreshStatus(container, ctx) {
    const line = container.querySelector("#drawer-status");
    if (!line || !ctx.selected) return;
    const model = ctx.engagement.models.find(m => m.id === ctx.selected.modelId);
    const rp = model && ctx.replays.get(model.id);
    const st = rp ? replayLib.nodeStateAt(rp, ctx.selected.nodeId, ctx.t) : null;
    const text = st ? diagram.statusText(st, ctx.engagement.meta.timeBasis) : "No scenario timing";
    const span = line.querySelector(".status-text");
    if (!span || span.textContent !== text) {
      clear(line);
      statusParts(st, ctx.engagement.meta.timeBasis).forEach(part => line.appendChild(part));
    }
  }

  /** Every recorded field, grouped, with gaps shown as not recorded. */
  function fullDetailsBody(engagement, model, node, rp, t) {
    const d = node.details || {};
    const lane = model.lanes.find(l => l.id === node.laneId);
    const tb = engagement.meta.timeBasis;
    const incoming = model.edges.filter(e => e.to === node.id && !e.removed).map(e => {
      const n = model.nodes.find(x => x.id === e.from); return (n ? n.label : e.from) + (e.label ? " (" + e.label + ")" : "");
    });
    const outgoing = model.edges.filter(e => e.from === node.id && !e.removed).map(e => {
      const n = model.nodes.find(x => x.id === e.to); return (n ? n.label : e.to) + (e.label ? " (" + e.label + ")" : "") + (e.dashed ? ", conditional" : "");
    });
    const field = (k, v) => h("div", { class: "field-block" }, h("span", { class: "k" }, k),
      textList(v) === null ? h("span", { class: "placeholder" }, "Not recorded") : textList(v));
    const section = (title, pairs) => h("section", null, h("h3", null, title), pairs.map(([k, v]) => field(k, v)));
    const known = new Set(["desc", "who", "owner", "authority", "sla", "volume", "effort", "activities", "systems", "inputs", "outputs",
      "controls", "risks", "exceptions", "escalation", "decisionRules", "audit", "pain", "kpis", "cost", "roi", "dataQuality",
      "handoff", "dependencies", "note", "evidence", "assumptions", "confidence"]);
    const extra = Object.keys(d).filter(k => !known.has(k));
    const st = rp ? replayLib.nodeStateAt(rp, node.id, t) : null;
    return h("div", null,
      d.desc ? h("p", null, String(d.desc)) : null,
      h("p", { class: "small muted" }, schema.typeInfo(node.semanticType).label + " \u00b7 " + (lane ? lane.name : "") + " \u00b7 " + model.name +
        (st ? " \u00b7 " + diagram.statusText(st, tb) + " at " + units.formatDuration(t, tb) : "")),
      h("div", { class: "detail-grid" },
        section("Ownership and accountability", [["Responsible", d.who], ["Accountable owner", d.owner], ["Swimlane", lane ? lane.name + (lane.role ? ", " + lane.role : "") : ""], ["Decision or approval authority", d.authority]]),
        section("Timing and expectations", [["Service level (as written)", d.sla], ["Volume or frequency", d.volume], ["Human effort (as written)", d.effort],
          ["SLA target (typed)", measureText((node.measures || {}).slaTarget)], ["Typical duration (typed)", measureText((node.measures || {}).typicalDuration)]]),
        section("Work performed", [["Activities", d.activities], ["Systems and tools", d.systems], ["Inputs", d.inputs], ["Outputs", d.outputs]]),
        section("Controls, risks and exceptions", [["Controls", d.controls], ["Risks", d.risks], ["Exceptions", d.exceptions], ["Escalation", d.escalation], ["Decision rules", d.decisionRules], ["Audit requirements", d.audit]]),
        section("Business impact", [["Pain points", d.pain], ["KPIs", d.kpis], ["Step cost", d.cost], ["Step benefit", d.roi], ["Data quality", d.dataQuality]]),
        section("Handoffs and context", [["Handoff", d.handoff], ["Incoming", incoming.length ? incoming : "None"], ["Outgoing", outgoing.length ? outgoing : "None"], ["Dependencies", d.dependencies]]),
        section("Evidence and assumptions", [["Source notes", d.note], ["Evidence references", d.evidence], ["Assumptions", d.assumptions], ["Confidence", d.confidence], ["Source IDs", (node.sourceIds || []).join(", ")]]),
        extra.length ? section("Other recorded fields", extra.map(k => [niceName(k), d[k]])) : null),
      h("p", { class: "note" }, "Descriptions and service levels are shown as supplied and may use different assumptions from the scenario timing. Gaps are shown as not recorded; nothing is inferred."));
  }

  B.drawer = { renderOverview, renderActivity, refreshStatus, fullDetailsBody, linkedRecords, badge, TONE, PROV_TONE };
})(typeof globalThis !== "undefined" ? globalThis : this);
