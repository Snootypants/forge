# QA Agent Operating Map

This document captures the QA process used on Forge so it can be repeated without relying on memory. The goal is to move like a software lead: split the system into risk areas, send focused agents into each area, collect evidence, dedupe findings, record them in `dbs/plans.db`, then assign fix workers with non-overlapping ownership.

## Operating Principles

- Run QA in phases. Do not ask every agent to look at everything every time.
- Give each agent a narrow lens and a read-only mandate during discovery.
- Require exact file references, impact, suggested fix, and tests to add.
- Dedupe centrally. Agents may find the same issue from different angles.
- Fix in batches by ownership area so workers do not overwrite each other.
- Keep the plan ledger current in `dbs/plans.db`; keep a tracked summary in docs.
- After fixes, rerun QA as a regression and residual-risk pass, not as a copy of pass one.

## Phase 0: Baseline

Before launching agents:

```bash
git status -sb
npm run check
npm audit --omit=dev
```

Also inspect the current plan ledger:

```bash
sqlite3 dbs/plans.db "select status, count(*) from issues group by status order by status;"
```

The baseline tells the team whether they are reviewing a clean tree, a patch stack, or a broken state.

## Phase 1: Broad Discovery

Purpose: find the first real map of the system's risk.

Agents:

| Agent | Lens | What They Look For |
| --- | --- | --- |
| Security | auth, secrets, permissions, trust boundaries | prompt injection, token leakage, exposed surfaces, CSRF/origin gaps |
| Backend/Data | routes, SQLite, persistence | FTS drift, transactions, validation, partial writes |
| Frontend | UI, state, rendering | API error handling, unsafe rendering, accessibility, responsive layout |
| Architecture | module boundaries, god files | duplicated orchestration, misleading contracts, singleton/caching traps |
| Release/Ops | build, CI, Docker, runtime | fake builds, missing CI, deploy docs, health checks |
| Product/Docs | behavior truth | false UI promises, docs/runtime mismatch, dead controls |

Discovery prompt pattern:

```text
You are QA Agent <area>. Work in <repo>. Read-only. Do not edit files.

Your job is to inspect <owned risk area>. Look for correctness bugs, security issues,
sloppy architecture, missing tests, hardcoded behavior, docs/runtime mismatch, and
anything that would embarrass a serious software team.

Return ranked findings with:
- severity
- exact file refs
- impact
- suggested fix
- tests to add

Do not include vague style preferences. Prioritize actionable issues.
```

Manager output:

- Dedupe overlapping findings.
- Rank critical/high/medium/low.
- Record each issue in `dbs/plans.db`.
- Add or update [qa-hardening-plan.md](./qa-hardening-plan.md).

## Phase 2: Batch Fixing

Purpose: close the highest-value issues without creating merge conflicts.

Fix workers get ownership, not just issues. Each worker must know they are not alone in the codebase.

Prompt pattern:

```text
You are Worker <letter> on <repo>. You are not alone in the codebase; do not revert
edits made by others, and keep your write scope tight.

Ownership: <files/modules only>.

Fix:
- <issue 1>
- <issue 2>
- <issue 3>

Run relevant tests. Final response: files changed, tests run, and caveats.
```

Example ownership split from pass one:

| Worker | Ownership | Issues |
| --- | --- | --- |
| A | `src/services/llm.ts`, LLM tests | Claude permission mode, transcript handling |
| B | web server/routes/security tests | polling redaction, limits, cookie/origin hardening |
| C | memory, Slack persistence, DB schemas | FTS upsert, transactions, schema constraints |
| D | frontend public files | API errors, escaping, ARIA, responsive layout |
| E | release/docs/ops files | build, Docker, CI, Node version, docs truth |

Manager duties during fixing:

- Review risky patches directly.
- Close cheap gaps that fall between workers.
- Run the full suite after integration.
- Update plan statuses only after verification.

## Phase 3: Pass-Two Regression and Residual Risk

Purpose: verify the fixes and find the next layer of problems. This is the phase currently running after the first fix batch.

This pass uses a tighter team:

| Agent | Lens | Direction |
| --- | --- | --- |
| Security Regression | auth, cookies, prompt boundaries | Verify security fixes and look for bypasses introduced by the patch. |
| Data Integrity and Migration | SQLite, FTS, vectors | Verify data fixes; focus on migration gaps and vector freshness. |
| Runtime Behavior and Product Truth | settings, identity, Slack/web parity | Find false promises, restart-required behavior, and dead controls. |
| Frontend Manual/Static QA | browser scripts, a11y, responsive | Check changed UI code for regressions and missed edge cases. |
| Release/Ops Regression | dist, Docker, CI, health | Verify deploy artifacts and operational behavior. |

Pass-two prompts currently deployed:

### Security Regression

```text
You are pass-two QA Agent 1: Security Regression. Work in ~/forge.
Read-only. Do not edit files.

Context: pass one fixed Claude CLI bypassPermissions, web polling redaction/limits,
cookie origin guard, localhost default host, token redaction, health endpoints. The
worktree is intentionally dirty with those patches.

Your job: verify the fixes actually close the security findings and look for
regressions/new holes in auth, cookies, Origin/Referer handling, bearer vs cookie
behavior, public endpoints, prompt_context exposure, Claude CLI args/stdin, Slack
user/channel trust, token/log leakage, runtime file permissions. Prioritize actionable
issues only.

Return ranked findings with severity, exact file refs, impact, suggested fix, and
tests to add. Also state which prior security items appear resolved.
```

### Data Integrity and Migration

```text
You are pass-two QA Agent 2: Data Integrity and Migration. Work in
~/forge. Read-only. Do not edit files.

Context: pass one fixed Slack INSERT OR REPLACE by adding ON CONFLICT DO UPDATE,
added schema CHECK/FK constraints for new DBs, and wrapped memory mutations in
transactions with best-effort vector indexing. Open items include migrations, vector
freshness, and MemoryService architecture.

Your job: verify data fixes, identify remaining correctness risks around SQLite
migrations, FTS triggers, vector table freshness, transaction boundaries, existing DB
upgrade behavior, foreign keys/checks, WAL/permissions, and tests. Prioritize practical
issues.

Return ranked findings with severity, exact file refs, impact, suggested fix, and tests
to add. Also state which prior data items appear resolved.
```

### Runtime Behavior and Product Truth

```text
You are pass-two QA Agent 3: Runtime Behavior and Product Truth. Work in
~/forge. Read-only. Do not edit files.

Context: pass one updated README to clarify explicit /remember, Claude CLI, eval
hit-rate scope, and added health endpoints. Open items include runtime settings not
consumed, identity edits requiring restart, Slack/web orchestration duplication, and
budget UI truth.

Your job: compare UI/API/docs/runtime behavior. Look for false promises, dead controls,
restart-required cases, Slack/web parity bugs, context construction gaps, config
defaults that surprise users, and docs that still diverge from code.

Return ranked findings with severity, exact file refs, impact, suggested fix, and
tests/docs to add. Also state which prior product/docs items appear resolved.
```

### Frontend Manual/Static QA

```text
You are pass-two QA Agent 4: Frontend Manual/Static QA. Work in
~/forge. Read-only. Do not edit files.

Context: pass one changed public JS/CSS/HTML for API error handling, escaping,
ARIA/keyboard, tab state, trace disclosure, and responsive breakpoints.

Your job: inspect the frontend code for regressions, event-handler bugs, accessibility
gaps, unsafe rendering, text/layout issues, mobile breakpoints, state bugs, and
integration mismatches with changed APIs. If you can run static browser-script checks,
do so; otherwise read carefully. Do not start long-running servers unless necessary.

Return ranked findings with severity, exact file refs, impact, suggested fix, and
tests/manual QA to add. Also state which prior frontend items appear resolved.
```

### Release/Ops Regression

```text
You are pass-two QA Agent 5: Release/Ops Regression. Work in
~/forge. Read-only. Do not edit files.

Context: pass one added real dist build, Dockerfile, .dockerignore, GitHub Actions,
.nvmrc, Node engine update, health/readiness endpoints, and README ops docs.

Your job: verify build/release/ops changes and look for issues in dist artifact layout,
NodeNext import rewriting, Docker runtime config/ports/host binding, healthcheck
behavior, CI correctness, package scripts, ignored files, and deployment docs. Run safe
read-only/local commands if useful.

Return ranked findings with severity, exact file refs, impact, suggested fix, and
verification commands. Also state which prior release/ops items appear resolved.
```

## Phase 4: Backlog Update

After pass-two reports return:

1. Mark verified fixed issues as `verified`.
2. Convert new findings into new `QA-###` rows.
3. Keep unresolved architecture work open instead of pretending it was fixed.
4. Decide the next fix batch by severity and coupling.

Useful queries:

```bash
sqlite3 -header -column dbs/plans.db \
  "select id, severity, area, title from issues where status='open' order by id;"

sqlite3 -header -column dbs/plans.db \
  "select severity, status, count(*) from issues group by severity, status order by severity, status;"
```

## Completion Gate

A fix batch is not done until:

```bash
npm run check
npm run build
npm audit --omit=dev
git diff --check
```

For frontend-heavy batches, add an interactive browser pass before declaring the UI clean.

For Docker changes, build the image when Docker is available:

```bash
docker build -t forge .
```
