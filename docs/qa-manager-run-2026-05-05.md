# QA Manager Run - 2026-05-05

This document records the manager-led QA routine for the 2026-05-05 hardening pass. It is written from the coordinator view so the pass can be audited and resumed without relying on chat history.

## Scope

Repository: `/Users/calebbelshe/forge`

Operating constraints:

- Multiple workers edited disjoint areas in parallel.
- Workers were told not to revert edits made by others.
- Fix ownership was split by file and subsystem.
- Pass 1 QA agents were read-only.
- Fix workers received narrow write scopes and explicit verification duties.
- Pass 2 re-audited the integrated fixes before the final manager verification.

## Baseline Routine

The manager routine followed the established Forge QA operating map:

1. Inspect worktree state before dispatch.
2. Launch read-only QA agents by risk area.
3. Require ranked findings with file references, impact, suggested fix, and test plan.
4. Dedupe overlapping findings centrally.
5. Convert findings into a consolidated fix matrix.
6. Assign workers by ownership boundary to avoid merge conflicts.
7. Require each worker final to report changed files, tests run, and unresolved caveats.
8. Run pass 2 as regression and residual-risk QA after fix integration.
9. Run final manager verification across check, build, pack, diff, and frontend syntax.

## Pass 1 QA Agents

Model and reasoning were held constant for all pass 1 agents: inherited current Codex model, reasoning high. All pass 1 work was read-only.

| Agent | Lens | Prompt summary | Status |
| --- | --- | --- | --- |
| Hypatia | Security/Auth/Trust Boundaries | Deep QA security/web auth/token/settings toggle/CSRF/secrets/provider CLI env/Slack/package/Docker/unsafe defaults; findings with refs/impact/fix/test. | completed |
| Socrates | Configuration/Settings | Config/settings behavior, `forge.config`, schema/defaults, logs/settings, Settings UI, models/auth/budget/env overrides/Docker/native/hardcoded settings. | completed |
| Lovelace | UI/UX/Frontend Logic | Web UI/frontend logic, composer controls, settings, auth, panels, polling, mobile/responsive, copy, saving, disabled/accessibility, UX model-agnostic memory/chat. | completed |
| Leibniz | Provider/Model Agnosticism | LLM provider architecture, model catalog, overrides, providers, validation, auth requirements, yolo/default, spawn portability, transcript, hardcoding. | completed |
| Harvey | Data/DB/Memory/Persistence | DB schemas/migrations/bootstrap/memory vector/FTS/runtime files/logs/settings/token/identity/notepad/chat-history/all db/gitignore/data corruption. | completed |
| Plato | Install/Packaging/Release/Cross-Platform | npm metadata/bin/build/package allowlist/Docker/native macOS/Linux/Windows/shell/path/README/publish/audit/first-run. | completed |
| Noether | Code Hygiene/Maintainability/Tests | God files/duplication/hardcoded constants/brittle tests/missing tests/type safety/errors/naming/module boundaries/frontend-backend contract/dist churn. | completed |
| Raman | Product Concept/Documentation | README/docs/install/release notes vs current behavior: model-agnostic stance, Docker/native/npm/auth token/provider/settings/vector/DB/security posture/overclaims. | completed |

## Pass 1 Findings and Fix Matrix

These are the major real pass 1 clusters that drove the fix plan. Smaller findings were folded into the relevant cluster when the impact and fix owner matched.

| ID | Severity | Cluster | QA source | Impact | Fix worker | Fix summary |
| --- | --- | --- | --- | --- | --- | --- |
| QA-2026-05-05-001 | high | Docker persistence | Plato, Harvey, Raman | DBs, identity, logs, web token, and memory data could be documented as persistent while resolving elsewhere at runtime. | Erdos | Aligned Docker persistence guidance/package docs and install wording around the real config/runtime paths. |
| QA-2026-05-05-002 | high | Auth-disable security | Hypatia, Socrates, Lovelace | Disabling web auth could be unsafe beyond loopback or unclear when env/config forced auth. | Laplace, Ampere, Euclid, Anscombe | Added loopback-only auth disable behavior, force-auth policy, DNS rebinding guard, effective auth state API/UI, and clearer auth toggle copy. |
| QA-2026-05-05-003 | high | `permissionMode` not enforced | Hypatia, Leibniz | Provider requests could ignore intended permission mode/yolo constraints or present misleading controls. | Gauss | Fixed request `permissionMode` handling and provider runtime behavior. |
| QA-2026-05-05-004 | high | Provider command/model validation | Leibniz, Socrates, Lovelace | Provider switching, catalog validation, Codex readiness, and model IDs could drift from configured provider capabilities. | Gauss, Hilbert | Fixed provider switching, exact model validation, catalog updates, Claude 1M alias, Anthropic catalog, and Codex readiness/auth handling. |
| QA-2026-05-05-005 | medium | Prompt traces default | Hypatia, Noether, Raman | Prompt/context traces could expose sensitive context by default or in unclear runtime settings. | Laplace | Changed prompt trace defaults and redaction-oriented behavior. |
| QA-2026-05-05-006 | medium | Env save path and credential handling | Hypatia, Socrates | Settings/API saves could write credentials to the wrong env path or expose token values in output. | Laplace | Fixed env-path credential saves, removed token printing, and tightened provider CLI env handling. |
| QA-2026-05-05-007 | medium | FTS/vector persistence | Harvey, Lovelace, Raman | Memory search status, FTS triggers/backfill, vector backfill, and hybrid recall could be stale, overclaimed, or non-idempotent. | Arendt, Ampere, Hilbert, Euclid | Added FTS triggers/backfill, vector backfill/status, chunk cascade tests, memory runtime status in settings, and hybrid recall fallback. |
| QA-2026-05-05-008 | medium | Package/import/CI/docs overclaims | Plato, Noether, Raman | npm package contents, import side effects, CI/platform claims, Docker context, and docs could mislead install/release users. | Erdos, Anscombe | Added package safeguards/docs install inclusion/import side-effect fix, Docker persistence docs, `.dockerignore` additions, token docs, pass logs, and release doc updates. |

## Pass 1 Fix Workers

All pass 1 fix workers ran with high reasoning.

| Worker | Area | Summary |
| --- | --- | --- |
| Laplace | Backend Security, Settings, and Auth | Fixed loopback-only auth disable, force-auth policy, env-path credential saves, no token printing, prompt trace defaults, and Codex auth requirement handling. |
| Gauss | LLM Provider, Model Catalog, and Runtime Execution | Fixed request `permissionMode`, provider switching, model validation, catalog behavior, Codex readiness, and hybrid recall. |
| Euclid | Frontend UI/UX Logic | Fixed inspector stability, auth failures, polling, provider readiness, send disabled state, mobile panels, settings auth copy, and vector overclaiming. |
| Arendt | Data, Memory, Persistence, and DB Hygiene | Fixed FTS triggers/backfill, vector backfill/status, and chunk cascade tests; atomic writes were deferred to pass 2. |
| Erdos | Packaging, Install, Docs, CI, and QA Run Documentation | Fixed Docker persistence docs, package safeguards, import side effect, docs/install, and QA log. |

## Pass 1 Verification Results

Recorded during the Erdos packaging/docs/CI fix pass:

| Command | Result | Notes |
| --- | --- | --- |
| `npm run check` | failed | Typecheck passed. Three LLM/provider tests failed in `src/services/llm.test.ts` because expected model IDs did not match current provider/catalog behavior; those files were outside Erdos ownership. |
| `npm run build` | passed | Typecheck and release build completed. |
| `npm pack --dry-run` | passed | `prepack` ran `npm run build`; tarball included `dist/`, `README.md`, `LICENSE`, `package.json`, and `docs/install.md`. |
| `node -e "import('./dist/index.js')..."` | passed | Package entry imported without starting the CLI and exposed `runCli`. |
| `docker build -t forge:worker5 .` | passed | Image built with `/config/dbs`, `/config/identity`, and `/config/logs` created in the runtime stage. |
| Docker `/readyz` smoke | passed | Container started with config at `/config/forge.config.yaml` and volumes mounted at `/config/dbs`, `/config/identity`, and `/config/logs`; `/readyz` responded and `/config/logs/web-auth-token` existed. |

## Pass 2 QA Agents

All pass 2 QA agents were explorers with high reasoning.

| Agent | Lens | Prompt summary | Status |
| --- | --- | --- | --- |
| Poincare | Security/Auth Regression Audit | Re-audit auth disable loopback policy, force auth, same-origin, token display, redaction, prompt context, env path, OAuth/copy UX backend, CLI env/PATH, Docker exposure, package secrets. | completed |
| Peirce | Provider/Model Runtime Regression Audit | Re-audit `permissionMode`, yolo, provider switching, catalog validation, Codex readiness, model IDs vs CLI labels, Slack/web behavior, hybrid recall, error handling. | completed |
| Newton | UI/UX Regression Audit | Re-audit composer provider/model selection, readiness states, settings clarity, auth disable checkbox, token copy buttons, inspector stability, polling/login/error state, mobile/a11y, vector claims. | completed |
| Epicurus | Data/DB/Persistence Regression Audit | Re-audit FTS triggers/backfills, migration compatibility, vector backfill/idempotency, hybrid status, chunk cascades, atomicity, Docker volume paths, gitignore. | completed |
| Hubble | Packaging/Install/Docs/CI Regression Audit | Re-audit npm metadata/prepack/files/bin/main/exports/import side effects, lock/package contents, Dockerfile/docs persistence, Windows/macOS/Linux install language, README truth, QA log completeness, CI, ignored data. | completed |

## Pass 2 Findings

| ID | Severity | Area | Finding | Impact | Fix assignment |
| --- | --- | --- | --- | --- | --- |
| P2-2026-05-05-001 | high | backend/security | DNS rebinding and effective-auth state needed stronger backend enforcement/exposure after auth-disable fixes. | A browser-visible auth state could diverge from server policy or be weaker on non-loopback hosts. | Ampere |
| P2-2026-05-05-002 | medium | backend/persistence | Runtime settings writes still needed atomic write handling and journal ignores. | Interrupted writes could corrupt settings or leave noisy DB journal files in the worktree. | Ampere |
| P2-2026-05-05-003 | medium | provider/model | Hybrid recall fallback, exact model validation, Claude 1M alias, Anthropic catalog, xapp redaction, and cwd PATH priority still needed tightening. | Provider behavior could be brittle across models, auth modes, and local CLI resolution. | Hilbert |
| P2-2026-05-05-004 | medium | frontend/auth | Composer readiness could appear before auth status fully loaded, and effective auth toggle/UI wording needed backend policy awareness. | Users could see misleading readiness or auth-disabled state. | Anscombe |
| P2-2026-05-05-005 | medium | frontend/polling-status | Poll failures and provider status needed better backoff/status presentation. | Transient backend failures could spam users or show stale connection state. | Anscombe |
| P2-2026-05-05-006 | medium | docs/token-package | Token docs, Docker context ignores, pass 2 log, and release docs needed final alignment with implemented behavior. | Operators and release auditors could follow stale package/auth guidance. | Anscombe |

## Pass 2 Fix Workers

All pass 2 fix workers ran with high reasoning.

| Worker | Area | Summary |
| --- | --- | --- |
| Ampere | Backend Security, Persistence, and Settings API | Fixed DNS rebinding guard, effective auth state, atomic write helper and usage, memory runtime status in settings, and `db-journal` ignore. |
| Hilbert | Provider/Data Model Behavior | Fixed hybrid recall fallback, exact model validation, Claude 1M alias, Anthropic catalog, xapp redaction, and cwd PATH priority. |
| Anscombe | Frontend and Docs Polish | Fixed auth-loading composer state, effective auth toggle UI, Codex auth display, poll backoff/status, token docs, `.dockerignore`, pass 2 log, and release doc. |

## Pass 2 Verification Notes

Recorded during the Anscombe frontend/docs polish pass:

| Command | Result | Notes |
| --- | --- | --- |
| `node --check src/web/public/views/app.js src/web/public/views/chat.js src/web/public/views/settings.js src/web/public/views/chat-render.js` | passed | Edited frontend modules parsed successfully. |
| `npm run check` | failed | Typecheck passed. Four LLM/provider tests failed in `src/services/llm.test.ts` around provider/catalog model compatibility expectations; those files were outside Anscombe ownership at that point. |
| `npm pack --dry-run` | passed | `prepack` ran `npm run build`; tarball included `dist/`, `README.md`, `LICENSE`, `package.json`, and `docs/install.md`. |

## Final Manager Verification

Final verification after pass 2 fixes:

| Command | Result | Notes |
| --- | --- | --- |
| `npm run check` | passed | 90 tests passed. |
| `npm run build` | passed | Release build completed. |
| `git diff --check` | passed | No whitespace errors. |
| `npm pack --dry-run` | passed | Package `@35bird/forge@0.1.0` includes `docs/install.md` and `dist/utils/atomic-write`. |
| `node --check` for frontend JS | passed | Frontend JavaScript syntax check passed. |

## Residual Notes

- Earlier pass-local verification failures are preserved above because they explain why pass 2 provider/model work was dispatched.
- Docker local smoke was already recorded in pass 1 verification; final manager verification focused on static/package/build checks.
