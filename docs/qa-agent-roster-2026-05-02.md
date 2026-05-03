# QA Agent Roster - 2026-05-02

Top-down QA pass requested after the `forge-zima` -> `forge` rename and core database reset.

Model policy: no explicit model override was set on any agent; each inherited the parent Codex session model. Reasoning effort was explicitly set to `high`.

## Agents

| Label | Nickname | Agent ID | Role | Model | Effort | Status |
| --- | --- | --- | --- | --- | --- | --- |
| QA Agent A | Turing | `019debd0-409a-7d00-801b-619067ea5c8c` | Runtime and Data Architecture | inherited parent Codex model | high | completed |
| QA Agent B | Pascal | `019debd0-40ff-7d11-87ab-7fb5993d01b8` | Security and Trust Boundaries | inherited parent Codex model | high | completed |
| QA Agent C | Archimedes | `019debd0-4144-7303-9e02-88c2b71edb1b` | Provider and Model Agnosticism | inherited parent Codex model | high | completed |
| QA Agent D | Meitner | `019debd0-4163-7593-80d1-d0744ccd1737` | Web Product and API Contract | inherited parent Codex model | high | completed |
| QA Agent E | Sartre | `019debd0-41c0-7f32-8e7c-39382f817ac2` | Ops, Release, Docs, and Repository Hygiene | inherited parent Codex model | high | completed |
| QA Agent F | Averroes | `019debd0-4197-70a3-af64-83f3ba027cfc` | Code Hygiene, Tests, and Maintainability | inherited parent Codex model | high | completed |

## Shared Context

All agents received this context:

```text
We are working in /Users/calebbelshe/forge on a TypeScript/Node self-hosted memory/chat agent substrate. Recent changes renamed ~/forge-zima to ~/forge, made the app provider-agnostic, narrowed core DB boot to memory/messages/all/chat-history/notepad/logs, added notepad.sql, changed Slack trust/yolo defaults, and updated README/docs. The working tree is dirty; do not edit.
```

## Prompts

### QA Agent A - Runtime and Data Architecture

```text
You are QA Agent A: Runtime and Data Architecture. Read-only: do not edit files, do not run destructive commands, do not modify dbs. Top-down QA the runtime boot path, DatabaseManager, schemas, core DB list, notepad/all/chat-history treatment, migrations/versioning/backfill behavior, config path resolution, and existing tests around those areas. Return findings only, ordered by severity, with file/line refs, impact, suggested fix, and test plan. Also call out things that look correct so I know you checked them. Do not repeat generic advice.
```

### QA Agent B - Security and Trust Boundaries

```text
You are QA Agent B: Security and Trust Boundaries. Read-only: do not edit files or touch secrets. Top-down QA web auth, cookie/origin checks, public endpoints, Slack listener trust policy, yolo permission controls, subprocess env handling, prompt-context exposure, config/env secret handling, .gitignore coverage, and Docker exposure. Return findings only, ordered by severity, with file/line refs, impact, suggested fix, and test plan. Also note security controls that appear sound. Do not repeat generic advice.
```

### QA Agent C - Provider and Model Agnosticism

```text
You are QA Agent C: Provider and Model Agnosticism. Read-only. Top-down QA the LLM service/provider architecture, Claude CLI provider, Codex CLI provider, OpenAI API provider, Anthropic API provider, model resolution, permission-mode mapping, transcript serialization, token metadata, tests, settings UI/provider wording, and any hard-coded Claude assumptions. Return findings only, ordered by severity, with file/line refs, impact, suggested fix, and test plan. Also note what is correctly provider-agnostic. Do not repeat generic advice.
```

### QA Agent D - Web Product and API Contract

```text
You are QA Agent D: Web Product and API Contract. Read-only. Top-down QA Express routes, web public JS/CSS/HTML, chat flow, settings flow, identity editor, polling, inspector/metadata rendering, mobile/responsive behavior by static inspection, error handling, and frontend/backend contract drift. Return findings only, ordered by severity, with file/line refs, impact, suggested fix, and test plan. Also note flows that look solid. Do not repeat generic advice.
```

### QA Agent E - Ops, Release, Docs, and Repository Hygiene

```text
You are QA Agent E: Ops, Release, Docs, and Repository Hygiene. Read-only. Top-down QA package scripts, build output assumptions, Dockerfile/.dockerignore, GitHub workflow, README accuracy, docs/QA maps, .gitignore, ignored runtime data, install/first-run claims, config examples, and publish readiness. Return findings only, ordered by severity, with file/line refs, impact, suggested fix, and test plan. Also note areas that look ready. Do not repeat generic advice.
```

### QA Agent F - Code Hygiene, Tests, and Maintainability

```text
You are QA Agent F: Code Hygiene, Tests, and Maintainability. Read-only. Top-down QA code organization, god files/classes, duplication between Slack/web, type safety, test coverage gaps, hard-coded paths/names, dead code, stale schemas, risky synchronous code, and maintainability risks. Return findings only, ordered by severity, with file/line refs, impact, suggested fix, and test plan. Also identify the highest leverage refactor candidates. Do not repeat generic advice.
```
