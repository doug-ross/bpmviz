# Exporting for client tools

BPMVIZ keeps the engagement in its own file, but the people who act on it work in PowerPoint, a BPMN modeling tool, Jira, Azure DevOps or Excel. **Export for client tools** builds those files from the current engagement. It never changes the engagement, so there is nothing to undo.

Open it from the present bar (the download icon, next to Engagement JSON) or from the menu under Save as a new file. Both open the same dialog with three sections: a PowerPoint deck, a BPMN 2.0 diagram and a backlog.

Two settings at the top apply to all three exports:

- **Scenario**: which scenario's figures feed the deck's modeled value. The BPMN export and the backlog do not use a scenario.
- **Include sensitive records** and **Include AI drafts not yet reviewed**: both are off by default, matching the handoff summary and the present bar. Turn them on only when the audience for this particular export is cleared to see that material.

## PowerPoint deck

The deck is a 16:9 presentation with one static layout, built the same way every time so it opens cleanly in PowerPoint, Keynote or Google Slides. It covers, in order:

1. **Title**: the process name, the client and engagement, the data status, confidentiality and revision.
2. **Scope**: the models in the engagement, their role, version, status and step count.
3. **Findings**: the pain points marked for the handoff.
4. **Opportunities**: every opportunity, ranked the same way the Value workspace ranks them, with its modeled value and the basis of that figure (illustrative, supplied, observed or validated). An opportunity with no value case recorded shows "Not modeled" rather than a fabricated number.
5. **Value by wave**: the net annual benefit and hours saved for each delivery wave (now, next, later), and the opportunities not yet assigned to one.
6. **Process**: the diagram currently shown in the Process workspace. If the Process workspace has not drawn a diagram in this session, the slide says so instead of leaving a blank image. Open the Process workspace once, then export again, to include it.
7. **Next steps**: decisions, actions and open questions recorded against the engagement.
8. **Disclosure**: the engagement's disclosure text, and a note of how many sensitive records or unreviewed AI drafts were left out.

A table longer than ten rows continues on further slides, each headed "(2 of 3)" and so on; any notes for that table are shown on the last page.

## BPMN 2.0 diagram

This writes the chosen model back out as a standard BPMN 2.0 XML file: a collaboration with one participant, its lanes, every step and connector, and the diagram positions, in the layout the Process workspace already computed. It is the reverse of importing a BPMN file into BPMVIZ, and round-trips cleanly back through that importer.

A few things do not carry over, because BPMVIZ does not record them:

- Removed steps and the connectors attached to them are left out.
- A connector's label becomes the sequence flow's name. No condition logic is invented for a gateway's branches; add that in the modeling tool if the target tool needs it.
- A step's BPMN element ID is reused from the file it was first imported from, when that ID is still a valid XML name. Otherwise a new, unique one is generated.

## Backlog

The backlog turns opportunity and action records into items a delivery team can import:

| BPMVIZ record | Jira | Azure DevOps |
|---|---|---|
| Opportunity | Epic | Feature |
| Action | Task | User Story |

Each item carries its linked steps as labels or tags, and acceptance criteria built from the recorded validation action, the value case's targets (effort reduction, duration reduction, share of cases), and any open question linked to the same steps. Choose Jira CSV, Azure DevOps CSV or an Excel workbook with everything on one sheet. A cell that would otherwise look like a spreadsheet formula is neutralized with a leading apostrophe.

A pain point, decision, question or note is not itself a backlog item; capture it as an action first if it needs its own ticket.

## Things to know

- **PowerPoint may offer to repair the file.** This is common for decks assembled outside PowerPoint and is harmless; PowerPoint rebuilds its internal part list and opens normally. Fonts fall back to whatever the opening machine has for Ubuntu; install Ubuntu for an exact match.
- **Jira and Azure DevOps importers vary** by project configuration. Check the column mapping on import, especially for Priority and Status, which BPMVIZ labels in plain text rather than the exact values your project's workflow uses.
- **The deck's figures are modeled, not realized.** Each one carries the basis of its weakest input, the same rule the Value workspace and the handoff summary follow.
