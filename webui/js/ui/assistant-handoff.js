/* One offline handoff and review workflow for every approved assistant. */
(function (root) {
  "use strict";
  const B = root.AIxRay = root.AIxRay || {};
  const { h } = B.dom;
  const handoff = B.assistantHandoff;

  function field(label, control, hint) {
    return h("div", { class: "field" }, h("label", { for: control.id }, label), control,
      hint ? h("span", { class: "field-hint" }, hint) : null);
  }

  function open(app, initial) {
    if (!app.store) {
      B.dialogs.messageDialog("Open a project first", "Open a project before preparing an assistant task packet. Completed AI result files can also be opened from the main file picker.");
      return null;
    }
    const init = initial || {};
    const starting = app.store.get();
    const models = handoff.baselines(starting);
    const provider = h("select", { class: "select", id: "ah-provider" }, Object.keys(handoff.PROVIDERS).map(id =>
      h("option", { value: id, selected: id === init.provider }, handoff.PROVIDERS[id].label)));
    const task = h("select", { class: "select", id: "ah-task" }, Object.keys(handoff.TASKS).map(id =>
      h("option", { value: id, selected: id === init.task }, handoff.TASKS[id])));
    const baseline = h("select", { class: "select", id: "ah-baseline" }, models.map(m =>
      h("option", { value: m.id, selected: m.id === init.baselineModelId }, m.name + " v" + m.version)));
    const format = h("select", { class: "select", id: "ah-format" },
      h("option", { value: "json" }, "JSON packet"), h("option", { value: "text" }, "Text packet"));
    const plan = h("select", { class: "select", id: "ah-plan" },
      h("option", { value: "unknown" }, "Unknown / not declared"),
      h("option", { value: "commercial" }, "Commercial account"), h("option", { value: "consumer" }, "Consumer account"));
    const approval = h("input", { type: "checkbox", id: "ah-approval" });
    const training = h("input", { type: "checkbox", id: "ah-training" });
    const written = h("input", { class: "input", id: "ah-written", maxlength: 500 });
    const policy = h("input", { type: "checkbox", id: "ah-policy" });
    const reviewed = h("input", { type: "checkbox", id: "ah-reviewed" });
    const activities = h("textarea", { class: "input", id: "ah-activities", rows: 4, maxlength: 150000 });
    const activityField = field("Approved activity names, one per line", activities,
      "Review the names before pasting. Do not paste event rows, case IDs, resources or credentials.");
    const approvalField = h("label", { class: "check" }, approval, B.aiResults.GATE_TEXT.approval);
    const trainingField = h("label", { class: "check" }, training,
      "I confirmed this account's model training is turned off under the current policy.");
    const writtenField = field(B.aiResults.GATE_TEXT.writtenApproval, written);
    const classification = h("p", { class: "small", id: "ah-classification" });
    const gateMessage = h("p", { class: "small", id: "ah-gate", role: "status" });
    const status = h("p", { class: "small", id: "ah-status", role: "status" });
    const preview = h("pre", { class: "ah-preview", id: "ah-preview", tabindex: "0", "aria-label": "Packet preview" });
    const importFile = h("input", { type: "file", id: "ah-import", class: "input", accept: ".json,.ai-result.json" });
    let packet = null;
    let fingerprint = "";
    let exportButton = null;

    function options() {
      return {
        provider: provider.value, task: task.value, baselineModelId: baseline.value, plan: plan.value,
        approvalConfirmed: approval.checked, trainingOptOutConfirmed: training.checked,
        writtenApproval: written.value, policyConfirmed: policy.checked,
        activities: activities.value.split(/\r?\n/).map(name => ({ name: name.trim() })).filter(a => a.name)
      };
    }

    function sync() {
      const e = app.store.get();
      const gate = handoff.policyGate(e, options());
      classification.textContent = "Project " + e.id + ", revision " + e.revision + ". " +
        B.schema.label("confidentiality", e.meta.confidentiality) + "; " + B.schema.label("dataStatus", e.meta.dataStatus) + ".";
      activityField.hidden = task.value !== "log-mapping";
      approvalField.hidden = !gate.requires.includes("approval");
      trainingField.hidden = !gate.requires.includes("trainingOff");
      writtenField.hidden = !gate.requires.includes("writtenApproval");
      gateMessage.textContent = gate.message;
      gateMessage.className = gate.blocked ? "error-text" : "small";
      packet = null;
      try {
        packet = handoff.createPacket(e, options());
        const next = handoff.serialize(packet, "json");
        if (next !== fingerprint) reviewed.checked = false;
        fingerprint = next;
        preview.textContent = next;
        status.textContent = "Review the packet below before exporting. The account plan is your declaration; the assistant model is unknown.";
      } catch (err) {
        fingerprint = "";
        reviewed.checked = false;
        preview.textContent = "Complete the data-handling check to preview the filtered packet.";
        status.textContent = err.message;
      }
      reviewed.disabled = !packet;
      if (exportButton) exportButton.disabled = !packet || !reviewed.checked;
      return packet;
    }

    function resetDestination() {
      plan.value = "unknown";
      approval.checked = false;
      training.checked = false;
      written.value = "";
      policy.checked = false;
      reviewed.checked = false;
      sync();
    }
    provider.addEventListener("change", resetDestination);
    plan.addEventListener("change", () => {
      approval.checked = false; training.checked = false; written.value = ""; policy.checked = false; sync();
    });
    [task, baseline, approval, training, policy, reviewed, format].forEach(control => control.addEventListener("change", sync));
    [written, activities].forEach(control => control.addEventListener("input", sync));

    const body = h("div", { class: "assistant-handoff form-grid" },
      h("p", null, "Export a task packet for an approved assistant, then bring back a completed AI result file for review. This screen does not run an assistant."),
      h("div", { class: "field-row" }, field("Assistant", provider), field("Task", task)),
      field("Model baseline", baseline, "Only reviewed models are offered. One baseline is exported."), activityField,
      h("p", { class: "note" }, "Packets exclude sensitive findings, unreviewed AI material, source documents, evidence links, raw event logs and scenario economics. For document extraction, use the existing approved AI extraction workflow; completed extraction results open through the same file picker."),
      h("section", { class: "ah-policy", "aria-labelledby": "ah-policy-title" },
        h("h3", { id: "ah-policy-title" }, "Data handling"), classification,
        field("Account plan", plan, "Check the actual destination account and current organizational policy. An assistant name does not establish plan or data protection."),
        gateMessage, approvalField, trainingField, writtenField,
        h("label", { class: "check" }, policy, "I checked the current data-handling policy and confirm this material may go to the selected assistant account.")),
      status,
      h("details", null, h("summary", null, "Review exported packet"), preview),
      h("label", { class: "check" }, reviewed, "I reviewed this packet and confirmed it contains only material approved for this destination."),
      field("Packet format", format),
      h("section", { class: "ah-import", "aria-labelledby": "ah-import-title" },
        h("h3", { id: "ah-import-title" }, "Import completed result"),
        field("Completed .ai-result.json file", importFile, "Return the complete envelope with the packet's original project ID, revision and baseline. You select proposals in the existing AI review before anything is applied.")));
    const api = B.dialogs.openDialog({
      title: "Work with an assistant", eyebrow: "Assistant handoff", wide: true, body,
      actions: [{ label: "Close" }, {
        label: "Export packet", variant: "btn-primary", keepOpen: true, onClick: () => {
          const ready = sync();
          if (!ready || !reviewed.checked) return false;
          const ext = format.value === "json" ? "json" : "txt";
          // A fixed filename avoids exporting confidential project names outside the packet.
          B.files.downloadBytes(handoff.serialize(ready, format.value), "assistant-" + task.value + "-r" + ready.engagementRevision + "." + ext,
            format.value === "json" ? "application/json" : "text/plain");
          B.dom.announce("Assistant packet exported. Return a complete AI result file for review.");
          return false;
        }
      }]
    });
    importFile.addEventListener("change", async () => {
      const file = importFile.files && importFile.files[0];
      if (!file) return;
      try {
        const bytes = await B.files.readBytes(file, B.schema.LIMITS.fileBytes);
        const checked = B.aiResults.parseAiResultText(B.files.textOf(bytes));
        if (!checked.ok) throw new Error("This is not a valid completed AI result. Return the complete .ai-result.json envelope, including its original project binding.");
        if (handoff.secretHits(checked.result).length) throw new Error("The completed result contains a possible credential. Remove it before importing.");
        api.close();
        await app.openFile(file);
      } catch (err) {
        status.textContent = err.message;
        importFile.value = "";
      }
    });
    exportButton = api.dialog.querySelector(".dlg-foot .btn-primary");
    exportButton.id = "ah-export";
    exportButton.setAttribute("aria-describedby", "ah-status ah-gate");
    sync();
    return api;
  }

  B.ext.registerMenuItem({ id: "assistant-handoff", order: 30, group: "ai", icon: "agent", label: "Work with an assistant", needsEngagement: true, run: open });
  B.assistantHandoffUi = { open };
})(typeof globalThis !== "undefined" ? globalThis : this);
