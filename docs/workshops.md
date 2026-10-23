# Process workshop guide

Use this guide to build and review a process with the people who run it. AIxRay is a local-file workbench with one facilitator editing one project file. Agree who owns the working copy, where it will be saved, and who will make edits during the session. Other participants can contribute verbally or keep their own notes; separate project copies do not merge.

The route below follows the implemented controls. A walkthrough is an explicit path through the diagram, and entered scenario timing compares assumptions. Neither executes business rules or simulates live process behavior.

## Live workshop sequence

### 1. Build the current process

From the start action or **More actions**, choose **Build a process**. Enter a process name and initial lane name. The new process begins with a start event, an end event, and a people lane.

In the **Build a process** editor, add lanes and steps, choose each step's type and lane, and connect steps. Use **Exclusive gateway** for decisions with conditional branches; label each condition and provide a default branch. Use sequence flows for parallel branches, and a loop flow to return to an earlier step. Use **Structure checks** to find missing starts or ends, unreachable steps, and incomplete gateway branches. Delete or reconnect carefully: deleting a step disconnects its flows, and **Undo last change** reverses the last edit. **Save a copy** preserves the work in a project file.

To continue editing an open process, choose **Edit process structure** from **More actions** or the **Process structure** section in the process drawer. This opens the same dedicated editor modal. A current baseline becomes locked after you create a future alternative; select the alternative to edit it. Diagram edits clear saved scenario runs and their derived route effort and cycle figures for that diagram, so rebuild the runs before playback or comparison.

### 2. Walk the normal and exception routes

In Present, choose **Walkthrough**, or use the walkthrough controls in the process drawer. Choose a process and start step, then select **Start walkthrough**. At each decision, select **Which branch?** and choose **Next**. Use **Previous**, **Start again**, and **Route history** to revisit the path. **Capture finding at this step** opens a linked finding form. Walk the normal route first, then repeat for each important exception, rework loop, or alternate outcome. Treat unconfirmed branches as questions.

This walkthrough records one selected route at a time. Parallel or inclusive gateways do not execute all branches or model synchronization; review those branches separately. It does not measure duration. Use it to check the route with participants, not to claim that the process was simulated.

### 3. Add scenarios and timing assumptions

Choose **Edit scenarios** from **More actions** or the walkthrough panel. Create and name a scenario, select a process under **Process for this run**, add ordered visits, select incoming branches, and enter wait, duration, human effort, and optional start time. Repeated visits represent rework. Blank human effort remains unknown. **Save run** saves that route; save before changing assumptions or switching routes. Use **Reload saved route** to discard unsaved edits.

Under **Compare processes and enter assumptions**, select the before and future processes and enter any scenario-specific economics overrides. The controls include three explicit variants: **Conservative**, **Expected**, and **Optimistic**. **Create three alternatives** saves those variants; **Save assumptions** saves the scenario overrides. The comparison panel reports annual cost difference, time freed up, and missing assumptions from the entered runs and engagement assumptions. These are alternatives, not additive outcomes. Capacity is redeployable time; elapsed duration alone does not establish cost savings. The editor does not schedule parallel branches or execute business rules.

### 4. Make future alternatives

In **Build a process**, open **Future alternatives**, name an alternative, and choose **Create future alternative**. AIxRay copies the current process and locks that baseline. Select the future process in **Process diagram** and edit its lanes, steps, gateways, and flows. The future-state comparison marks changed, added, and removed items with their lineage. Keep alternatives tied to a clear reason and to findings from the walkthrough. Rebuild scenario runs for a changed diagram before comparing timing again.

### 5. Design automation responsibility and safeguards

Open the process drawer for a step and expand **Automation design**, or go to Findings, **Workshop** and use **Step automation designs** to select a process and step. Record a **Design owner** and **Responsibility**: Human, Rules, AI assist, or Agent. Fill in **Trigger**, **Inputs**, **Outputs**, **Systems**, **Rules and limits**, **Approval**, **Fallback and escalation**, and **Test criteria**.

Ask who owns the outcome, which decisions require human approval, what happens when inputs are missing or the automation fails, and how the team will test normal and exception cases. Mark a design **Reviewed** only after checking its limits and criteria. A reviewed design requires an owner and every design field. Sensitive designs can be excluded from the Pilot brief.

### 6. Run the Workshop tab and capture a checkpoint

In Findings, open the **Workshop** subtab. Under **Agenda**, add items with an owner, minutes, and status; use **Save agenda** to keep changes. Under **Parking lot and actions**, use **Park a question**, **Add a note**, **Quick finding**, or **Add an action**. Assign owners and statuses in the finding form.

Under **Agreed processes**, select the current and future processes and choose **Agree processes**. Under **Checkpoint and pilot acceptance**, record a reviewer and date, select accepted changes and unresolved issues, and add acceptance criteria with an owner for each. Mark checkpoint details sensitive to exclude them from the Pilot brief. Mark them reviewed only after checking what may be shared. Choose **Capture checkpoint** when the group has recorded its position.

The checkpoint fingerprint detects changes to the agreed process, findings, or automation designs. A stale checkpoint says to review and capture a new one. It does not constitute formal approval, sign-off, or an organizational authorization.

### 7. Review the Pilot brief, then save and reopen

From Workshop, choose **Open pilot brief** to go to Present and select **Pilot brief**. Review the agreed processes, the value goals the accepted changes serve, checkpoint status, acceptance criteria, accepted changes, unresolved issues, reviewed automation designs, and actions. Sensitive material and unreviewed drafts are excluded. If the checkpoint is stale, review it before sharing. **Download pilot brief** exports a text file; **Pilot brief text** is also available in Present. The printable Pilot brief can be printed from Present.

Return to the project and choose **Save a copy**. Save the project file in the agreed location. Reopen that saved file with **Open** and check that the process, routes, findings, Workshop agenda, designs, and checkpoint are present. This confirms the saved file can be continued; it does not replace the participants' decision or approval process.

## External assistant packets

Choose **Work with an assistant** from **More actions**. Select an assistant label, task, reviewed model baseline, packet format, and account plan. For activity mapping, supply approved activity names. Review the data-handling policy for the destination account and confirm that the material may be sent, then choose **Export packet**.

The packet is an external handoff for Codex, Claude Code, or GitHub Copilot. AIxRay does not run the assistant from this screen. The assistant name and account plan are user declarations; they do not verify authentication, the model, or the provider's data protections. The packet contains an allowlisted snapshot of reviewed process content and eligible findings, excludes source documents, scenarios, datasets, assumptions, sensitive material, and unreviewed AI drafts, and is checked for possible credentials. Give the packet to the selected assistant using an approved route. Ask it to return a complete `.ai-result.json` envelope preserving the packet's project, revision, task, and baseline bindings.

Back in AIxRay, choose **Import completed result** in the handoff screen and select the returned file. Review proposals in the existing AI review flow and apply only what a person accepts. A result for a changed project revision needs explicit review against that revision or a new packet. Do not treat assistant output as a decision or approved process change. See [AI tasks](ai.md) for the separate Claude Code and Codex task routes and their data-handling rules.

## Facilitator habits

- Ask for a recent case before generalizing from an unusual one.
- Separate the normal route from exceptions, rework, and skipped work.
- Record observed facts, estimates, and assumptions with their basis.
- Capture disagreements and missing evidence as open questions.
- Confirm decisions, owners, acceptance criteria, and follow-up dates aloud.
- Keep one authoritative project file and tell participants where it is saved.
