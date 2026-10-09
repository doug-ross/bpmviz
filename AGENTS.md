# Working in the BPMVIZ repository

BPMVIZ is a process workshop workbench that runs in the browser from local files. `README.md` describes the app; `docs/ai.md` describes the AI tasks.

## Commands

```
npm install              # development tools only: playwright-core and pdfjs-dist
npm test                 # unit tests
npm run test:browser     # the app in Chrome or Edge, from disk and over HTTP
npm run check            # style gate and prose check
npm run ai -- --help     # AI tasks on your own Claude Code or Codex sign-in
```

Run `npm test` and `npm run check` before you finish a change. Run `npm run test:browser` after a change to anything in `webui/`.

## Rules for changes

- Files under `webui/js/lib/` load both as browser scripts and as Node modules. Keep that pattern, and keep them free of network and DOM access.
- JavaScript sources are ASCII only. Write the escape (backslash, u, then four hex digits, such as u00b7 for a middle dot), not the character itself. A test enforces this.
- Client-visible text (README, docs, prompts, UI copy, examples) has no em dashes and no marketing filler. `npm run check` enforces this.
- Engagement data is shown as text, never as HTML.
- The app opened from disk makes no network requests. Its content security policy says `connect-src 'none'`; keep it that way.
- After changing `webui/js/lib/schema.js` or `webui/js/lib/ai-results.js`, run `node tools/build-schema.mjs`. After changing the archived samples or the converter, run `npm run build:examples`.
- Do not commit engagement files, AI result files or source documents from real engagements.

## AI tasks

The skills in `.agents/skills/` (Codex) and `.claude/skills/` (Claude Code) draft BPMVIZ material and save it as an AI result file that a person reviews in the app. Claude Code skills: `/bpmviz-extract`, `/bpmviz-log-mapping`, `/bpmviz-opportunities`, `/bpmviz-future-state` and `/bpmviz-summary`. Each one checks the data-handling rules with `npm run ai -- gate` before it reads any material. Use them only when the user asks for one.
