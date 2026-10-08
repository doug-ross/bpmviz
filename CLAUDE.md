# BPMVIZ

Follow `AGENTS.md`: the commands, the rules for changes and the AI task skills are described there.

The BPMVIZ skills for Claude Code are `/bpmviz-extract`, `/bpmviz-opportunities`, `/bpmviz-future-state` and `/bpmviz-summary`. They run only when the user types them. For client material, `npm run ai` is the stricter route: it runs Claude Code in a separate session with no hooks, no MCP servers, no shell and no saved session (see `docs/ai.md`).
