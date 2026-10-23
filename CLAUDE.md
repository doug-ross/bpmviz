# AIxRay

Follow `AGENTS.md`: the commands, the rules for changes and the AI task skills are described there.

The AIxRay skills for Claude Code are `/aixray-extract`, `/aixray-log-mapping`, `/aixray-opportunities`, `/aixray-future-state`, `/aixray-summary`, `/aixray-screen` and `/aixray-goals`. They run only when the user types them. For client material, `npm run ai` is the stricter route: it runs Claude Code in a separate session with no hooks, no MCP servers, no shell and no saved session (see `docs/ai.md`).
