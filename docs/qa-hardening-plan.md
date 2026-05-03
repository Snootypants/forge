# QA Hardening Plan

Plan id: `qa-hardening-2026-05-01`

This is the first full QA hardening backlog from the specialist-agent pass. The same list is tracked locally in `dbs/plans.db` with owner, diff plan, test plan, and status fields.

Status note, 2026-05-02: this document is historical for the first hardening pass. The current top-down regression pass and live status deltas are tracked in [qa-topdown-pass-2026-05-02.md](./qa-topdown-pass-2026-05-02.md). Rows below should be read as the state after their named pass unless a later section explicitly updates them.

## Active Fix Team

| Worker | Ownership | Primary issues |
| --- | --- | --- |
| Worker A | `src/services/llm.ts`, `src/services/llm.test.ts`, `src/types.ts` | completed |
| Worker B | web server and message route security | completed |
| Worker C | memory/data/Slack persistence | completed |
| Worker D | frontend public assets | completed |
| Worker E | release/docs/ops files | completed |

## Critical

| ID | Area | Finding | Status |
| --- | --- | --- | --- |
| QA-001 | security/llm | User-facing chat can drive Claude Code with bypass permissions. | completed |

## High

| ID | Area | Finding | Status |
| --- | --- | --- | --- |
| QA-002 | llm/context | Conversation history is dropped before model execution. | completed |
| QA-003 | web/security | Message polling exposes `prompt_context` and accepts unbounded limits. | completed |
| QA-004 | web/security | Admin web surface is too broadly exposed. | completed |
| QA-007 | data/sqlite | Slack upsert leaves stale FTS rows. | completed |
| QA-008 | memory | Memory mutations are non-transactional. | completed |
| QA-011 | frontend | API errors are treated as success. | completed |
| QA-016 | release | `npm run build` is not a release build. | completed |
| QA-017 | ops/docker | Docker docs can bake secrets/state into images. | completed |
| QA-018 | ci | No CI release gate exists. | completed |

## Medium

| ID | Area | Finding | Status |
| --- | --- | --- | --- |
| QA-005 | web/security | Cookie-authenticated writes lack origin/CSRF guard. | completed |
| QA-006 | security/ops | Generated web auth token is printed in full to logs. | completed |
| QA-009 | db/schema | No schema migration/version boundary. | partially completed |
| QA-010 | db/schema | Schemas allow invalid/orphan lifecycle data. | completed |
| QA-012 | frontend/security | Unsafe `innerHTML` and attribute escaping patterns. | completed |
| QA-013 | frontend/a11y | Mouse-only interactions and missing ARIA state. | completed |
| QA-014 | frontend/responsive | Mobile layout is unsupported. | completed |
| QA-019 | runtime | Node version assumptions are under-specified. | completed |
| QA-020 | ops | No health/readiness endpoint. | completed |
| QA-021 | product/runtime | Runtime settings are saved but not consumed. | partially completed |
| QA-022 | identity/runtime | Identity edits do not affect live prompts until restart. | completed |
| QA-023 | memory/search | Hybrid/vector search is not used by live contexts and vectors can go stale. | partially completed |
| QA-024 | architecture | Web and Slack chat orchestration are duplicated. | open |
| QA-025 | architecture | `MemoryService` is a god class. | open |
| QA-026 | docs/product | Docs overstate automatic memory writeback and eval meaning. | completed |

## Low

| ID | Area | Finding | Status |
| --- | --- | --- | --- |
| QA-015 | frontend/state | Invalid saved tab can blank the shell. | completed |
| QA-027 | tests | Test discovery is narrow and lacks coverage/lint gate. | open |
| QA-028 | frontend/product | Budget UI hardcodes zero spend. | open |

## Current Fix Order

1. Close immediate security and correctness bugs: QA-001 through QA-008.
2. Close frontend reliability and release gates: QA-011 through QA-019.
3. Follow with larger architectural work: migrations, shared chat service, settings runtime wiring, identity reloads, vector freshness, and memory-service decomposition.

## Pass Two Findings

Pass two was a regression and residual-risk pass against the patched tree. The first batch is mostly holding, but the next layer is now clearer.

### High

| ID | Area | Finding | Status |
| --- | --- | --- | --- |
| QA-009 | db/schema | Existing DBs are not migrated, so new constraints do not apply to upgraded installs. | partially completed |
| QA-023 | memory/search | Vector index can go stale and live contexts still use FTS-only search. | partially completed |
| QA-029 | web/security/frontend | Prompt trace contract is inconsistent and still exposes `prompt_context` in POST. | completed |
| QA-033 | db/migration | Existing FTS contents are not rebuilt or backfilled. | completed |
| QA-037 | docker/ops | Docker published port is unreachable with localhost bind default. | completed |
| QA-041 | product/budget | Budget UI is a dead control with hard-stop language. | completed |
| QA-042 | web/context | Web chat does not include thread history. | completed |

### Medium

| ID | Area | Finding | Status |
| --- | --- | --- | --- |
| QA-030 | frontend/settings | Settings load failures can show stale settings. | completed |
| QA-031 | frontend/mobile | Mobile layout hides inspector, trace, and identity controls. | open |
| QA-034 | memory/fts | Memory FTS is service-maintained instead of trigger-backed. | open |
| QA-035 | db/schema | Foreign key coverage remains incomplete in auxiliary schemas. | open |
| QA-038 | ci/release | CI does not exercise release build. | completed |
| QA-040 | slack/security | Slack defaults trust every channel and user. | open |
| QA-043 | auth/runtime | Auth settings imply immediate enablement but require restart. | open |
| QA-044 | memory/lifecycle | `/forget` deletes memories while docs promise archive/lifecycle preservation. | open |

### Low

| ID | Area | Finding | Status |
| --- | --- | --- | --- |
| QA-032 | frontend/a11y | Rail divider ARIA semantics are weak. | open |
| QA-036 | ops/health | Readiness health is shallow and public detail leaks DB names/errors. | completed |
| QA-039 | docs/ops | Systemd docs still run source TypeScript instead of `dist`. | completed |
| QA-045 | security/files | Runtime sensitive files rely on process umask. | completed |

## Manager Fix Pass After Rename

| ID | Area | Finding | Status |
| --- | --- | --- | --- |
| QA-046 | llm/provider | Provider fallback could send Claude model names to non-Claude providers. | completed |
| QA-047 | llm/provider | Anthropic API path serialized system messages as fake user content. | completed |
| QA-048 | security/cli | CLI prompt serialization used pseudo-XML and allowed prompt text to collide with tags. | completed |
| QA-049 | auth/security | Claude auth subprocess inherited the full parent environment. | completed |
| QA-050 | repo/ops | Residual legacy path references survived the directory rename. | completed |
