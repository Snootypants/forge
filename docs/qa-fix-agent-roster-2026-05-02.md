# QA Fix Agent Roster - 2026-05-02

Fix pass for findings from `qa-topdown-2026-05-02`.

Model policy: no explicit model override was set; each worker inherited the parent Codex session model. Reasoning effort was explicitly set to `high`.

## Workers

| Label | Nickname | Agent ID | Ownership | Model | Effort | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Worker A | Aristotle | `019debd8-9e97-70c2-8e9b-188917647cfb` | DB and config runtime | inherited parent Codex model | high | completed |
| Worker B | Darwin | `019debd8-9f06-7312-8018-c845d5c56f2d` | LLM providers and auth backend | inherited parent Codex model | high | completed |
| Worker C | Ohm | `019debd8-9f31-7ea1-a94d-4249712d679f` | Slack trust boundary | inherited parent Codex model | high | completed |
| Worker D | Carson | `019debd8-9f48-7e40-9e2c-af0c5392da27` | Frontend chat and settings UX | inherited parent Codex model | high | completed |
| Worker E | Confucius | `019debd8-9f57-77f2-be45-9876b2120f12` | Ops, release, docs, repo hygiene | inherited parent Codex model | high | completed |
| Worker F | Dirac | `019debd8-9f71-7543-a0db-b3ecee8794e5` | Memory vector lifecycle | inherited parent Codex model | high | completed |
| Manager | Codex | current session | Integration and shared chat architecture | parent Codex session model | current session effort | completed |

## Shared Instruction

All workers were told:

```text
You are not alone in the codebase: other workers are editing disjoint areas, so do not revert changes you did not make and keep your write scope tight.
```

## Work Assignments

### Worker A - DB and Config Runtime

Write scope:

```text
src/db/manager.ts, src/db/*.test.ts, src/web/config.test.ts, src/config.ts, src/platform.ts
```

Findings assigned: QA-052, QA-053, QA-058, QA-061, QA-069, QA-075.

Status: completed. Tests reported: `npm run typecheck`, `npm run check`.

### Worker B - LLM Providers and Auth Backend

Write scope:

```text
src/services/llm/**, src/services/llm.ts, src/services/llm.test.ts,
src/auth/oauth.ts, src/auth/oauth.test.ts,
src/web/routes/auth.ts, src/web/routes/settings.ts, src/web/routes/settings.test.ts
```

Findings assigned: QA-054, QA-062 backend portion, QA-064, QA-070, QA-071 integration helper, QA-076, QA-077.

Status: completed. Tests reported: targeted LLM/auth/settings tests and `npm run check`.

### Worker C - Slack Trust Boundary

Write scope:

```text
src/slack/listener.ts, src/slack/listener.test.ts, src/types.ts only for Slack config schema fields
```

Findings assigned: QA-055, QA-063.

Status: completed. Tests reported: `npm test -- src/slack/listener.test.ts`, `npm run check`.

### Worker D - Frontend Chat and Settings UX

Write scope:

```text
src/web/public/views/chat.js, src/web/public/views/chat-render.js,
src/web/public/views/settings.js, src/web/public/styles.css, src/web/public/index.html
```

Findings assigned: QA-059, QA-060, QA-065, QA-066, QA-078, QA-079.

Status: completed. Tests reported: `node --check` for edited frontend files, `git diff --check`, `npm run check`, `npm run build`.

### Worker E - Ops, Release, Docs, and Repo Hygiene

Write scope:

```text
Dockerfile, .dockerignore, .gitignore, .github/workflows/ci.yml,
package.json, README.md, docs/*.md, optional eval/results*.json hygiene
```

Findings assigned: QA-056, QA-057, QA-072, QA-073, QA-074, QA-080, QA-081.

Status: completed. Tests reported: `npm run check`, `npm run build`, `git diff --check`, `npm audit --omit=dev`. Local Docker build was blocked by a stopped Docker daemon.

### Worker F - Memory Vector Lifecycle

Write scope:

```text
src/services/memory.ts, src/services/memory.test.ts
```

Findings assigned: QA-067.

Status: completed. Tests reported: targeted memory tests, `npm run typecheck`.

### Manager - Integration and Shared Chat Architecture

Write scope:

```text
src/services/chat.ts, src/services/chat.test.ts,
src/slack/listener.ts, src/web/routes/messages.ts,
src/slack/context.ts, src/slack/context.test.ts
```

Findings assigned: QA-068 and final integration of QA-071 in web chat error handling.

Status: completed. Tests run after integration: `npm run check`.
