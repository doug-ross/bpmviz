# Exporting to other tools

AIxRay keeps the project in its own file, but the people who act on it work in PowerPoint, a BPMN modeling tool, Jira, Azure DevOps or Excel. **Export to other tools** builds those files from the current project. It never changes the project, so there is nothing to undo.

Open it from the Present bar (the download icon, next to Save a copy) or from the More actions menu under Save a copy. Both open the same dialog with three sections: a PowerPoint deck, a BPMN 2.0 diagram and a backlog.

Two settings shape what goes out:

- **Scenario**, in the deck section: which scenario's figures feed the deck's modeled value. The BPMN export and the backlog do not use a scenario.
- **Include sensitive findings** and **Include AI drafts not yet reviewed**, at the top, apply to all three exports. Both are off by default, matching the report and the Present bar. Turn them on only when the audience for this particular export is cleared to see that material.

## PowerPoint deck

The deck is a 16:9 presentation with one static layout, built the same way every time so it opens cleanly in PowerPoint, Keynote or Google Slides. It covers, in order:

1. **Title**: the process name, the client and project, the data status, confidentiality and version.
2. **Scope**: the models in the project, their role, version, status and step count.
3. **Pain points**: the pain points included in the report.
4. **Opportunities**: every opportunity, ranked the same way as in the Matrix view, with its modeled value and the basis of that figure (illustrative, provided, measured or confirmed). An opportunity with no business case recorded shows "No estimate yet" rather than a fabricated number.
5. **Value by wave**: the net annual benefit and hours saved for each delivery wave (now, next, later), and the opportunities not yet assigned to one.
6. **Process**: the diagram currently shown in the Process tab. If the Process tab has not drawn a diagram in this session, the slide says so instead of leaving a blank image. Open the Process tab once, then export again, to include it.
7. **Next steps**: decisions, actions and open questions recorded against the project.
8. **About this data**: the project's disclosure text, and a note of how many sensitive findings or unreviewed AI drafts were left out.

A table longer than ten rows continues on further slides, each headed "(2 of 3)" and so on; any notes for that table are shown on the last page.

## BPMN 2.0 diagram

This writes the chosen model back out as a standard BPMN 2.0 XML file: a collaboration with one participant, its lanes, every step and connector, and the diagram positions, in the layout the Process tab already computed. Choose the **Process** and then **Download BPMN file**. It is the reverse of importing a BPMN file into AIxRay, and round-trips cleanly back through that importer.

A few things do not carry over, because AIxRay does not record them:

- Removed steps and the connectors attached to them are left out.
- A connector's label becomes the sequence flow's name. No condition logic is invented for a gateway's branches; add that in the modeling tool if the target tool needs it.
- A step's BPMN element ID is reused from the file it was first imported from, when that ID is still a valid XML name. Otherwise a new, unique one is generated.

## Backlog

The backlog turns opportunities and actions into items a delivery team can import:

| AIxRay finding | Jira | Azure DevOps |
|---|---|---|
| Opportunity | Epic | Feature |
| Action | Task | User Story |

Each item carries its linked steps as labels or tags, and acceptance criteria built from the opportunity's How to confirm it, the business case's targets (effort reduction, duration reduction, share of cases), and any open question linked to the same steps. Under **Format**, choose Jira (CSV), Azure DevOps (CSV) or Excel workbook (everything on one sheet), then **Download backlog**. In the two CSV exports, a cell that would otherwise look like a spreadsheet formula is neutralized with a leading apostrophe; the Excel workbook writes its cells as inline strings, which Excel never evaluates as formulas, so no neutralization is needed there.

A pain point, decision, question or note is not itself a backlog item; add it as an action first if it needs its own ticket.

## Things to know

- **PowerPoint may offer to repair the file.** This is common for decks assembled outside PowerPoint and is harmless; PowerPoint rebuilds its internal part list and opens normally. Fonts fall back to whatever the opening machine has for Ubuntu; install Ubuntu for an exact match.
- **Jira and Azure DevOps importers vary** by project configuration. Check the column mapping on import, especially for Priority and Status, which AIxRay labels in plain text rather than the exact values your project's workflow uses.
- **The deck's figures are modeled, not realized.** Each one carries the basis of its weakest input, the same rule the Value tab and the report follow.
