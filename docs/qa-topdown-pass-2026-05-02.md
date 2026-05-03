# Top-Down QA Pass - 2026-05-02

Plan id: `qa-topdown-2026-05-02`

This pass used six read-only specialist agents. Roster, prompts, model policy, and effort are recorded in `docs/qa-agent-roster-2026-05-02.md`.

## Executive Summary

This pass produced 30 tracked findings. The follow-up fix pass closed the batch in code and docs, with one local verification limit: Docker artifact testing is covered by CI, but the local Docker daemon is not running on this machine.

The main improvements are:

- upgrade boot now has versioned SQLite migrations and FTS backfills
- config selection no longer reuses stale cached paths or ignores per-config `.env`
- provider selection is model-aware across Claude, Codex, OpenAI, and Anthropic paths
- Slack trust defaults now require explicit channel/user trust before storage or LLM calls
- web chat/mobile/settings UX has recoverable states and active polling
- chat memory commands and context construction now live in a shared service instead of Slack-specific code

## Deduped Findings

| ID | Severity | Area | Finding | Status |
| --- | --- | --- | --- | --- |
| QA-052 | high | db/migration | Schema boot still is not a real migration path, and old DBs can be marked `user_version = 1` without required columns/constraints. | completed |
| QA-053 | high | config/runtime | Config and Platform singleton caches can reuse the wrong config path in multi-instance or repeated boot scenarios. | completed |
| QA-054 | high | llm/provider | Default `llm.model` pins a Claude model, so switching only `llm.provider` can still break OpenAI/Codex. | completed |
| QA-055 | high | slack/security | Slack DMs trust every workspace user, and non-self bot/app messages are not default-denied. | completed |
| QA-056 | high | docker/security | Docker image copies `forge.config.yaml`, which can bake inline API keys or web auth tokens into the image. | completed |
| QA-057 | high | docker/ops | Docker bind-mount instructions can create root-owned host dirs that the container `node` user cannot write. | completed |
| QA-058 | high | db/search | Existing `all.db` document rows are not backfilled into `documents_fts`. | completed |
| QA-059 | high | frontend/mobile | Mobile hides the only inspector and identity editor surfaces. | completed |
| QA-060 | high | frontend/chat | Chat auto-scroll targets `.chat-scroll` while `.chat-center` is the actual scroll container. | completed |
| QA-061 | medium | runtime/env | Per-config `.env` files are ignored on `--config` boots. | completed |
| QA-062 | medium | auth/provider | Auth/settings UI is not selected-provider aware and lacks Anthropic API key save support. | completed |
| QA-063 | medium | slack/provider | Slack `allow_yolo` blocks API providers even though permission mode only applies to CLI providers. | completed |
| QA-064 | medium | llm/openai | OpenAI API provider sends history as one JSON string instead of structured role-preserving input. | completed |
| QA-065 | medium | frontend/chat | Web UI does not actually poll after initial load. | completed |
| QA-066 | medium | frontend/debug | Prompt inspector UI expects traces that the backend intentionally redacts by default. | completed |
| QA-067 | medium | memory/vector | Vector index lifecycle is split and lossy across `saveSync`, `update`, and `supersede`. | completed |
| QA-068 | medium | architecture/chat | Web chat imports Slack command logic and duplicates context construction. | completed |
| QA-069 | medium | llm/runtime | Relative `llm.workdir` is not resolved against the config root. | completed |
| QA-070 | medium | llm/runtime | CLI provider runner buffers stdout/stderr without size limits. | completed |
| QA-071 | medium | security/errors | Provider/subprocess error details are returned directly to authenticated web clients. | completed |
| QA-072 | medium | release/npm | npm publish surface is neither clean nor explicitly disabled. | completed |
| QA-073 | medium | ci/docker | CI does not build or smoke-test the documented Docker artifact. | completed |
| QA-074 | medium | docs/qa | QA hardening docs contain stale statuses against current repo state. | completed |
| QA-075 | low | db/schema | Schema directory path resolution uses URL pathname and can fail under escaped install paths. | completed |
| QA-076 | low | llm/usage | Codex CLI token metadata is permanently zero and tests lock that in. | completed |
| QA-077 | low | tests/llm | API providers have little/no direct unit coverage. | completed |
| QA-078 | low | frontend/settings | Settings and identity save failures are not handled locally with recoverable UI states. | completed |
| QA-079 | low | frontend/settings | Budget save ignores the returned settings and can render stale values. | completed |
| QA-080 | low | docs/db | README says SQLite Databases `(8)` while current core boot is six DBs. | completed |
| QA-081 | low | repo/hygiene | Ignored eval result files are still tracked. | completed |

## Positive Signals

- Core boot DB list is now narrowed to `memory`, `messages`, `all`, `chat-history`, `notepad`, and `logs`.
- Provider service boundaries are clean: web and Slack call `LLMService` rather than provider-specific APIs.
- Web auth basics are strong: timing-safe token compare, HttpOnly strict cookies, and same-origin checks for cookie writes.
- Poll backend uses explicit columns, clamps limits, and redacts `prompt_context`.
- Release build now emits `dist/`; CI runs checks, build, and production audit.
- CI now builds the Docker image and smokes `/readyz` with a generated non-secret config.
- Runtime secrets/state dirs and the active `forge.config.yaml` are ignored by Docker context rules.
- Generated `eval/results*.json` files are ignored and are not tracked in the current repo; benchmark baselines remain tracked under `eval/baselines/`.

## Fix Pass Verification

- `npm run check`: passed, 53 tests.
- `npm run build`: passed.
- `npm audit --omit=dev`: passed, 0 vulnerabilities.
- `git diff --check`: passed.
- Fresh temp boot created exactly `all.db`, `chat-history.db`, `logs.db`, `memory.db`, `messages.db`, and `notepad.db`.
- `docker build -t forge:qa-fix .`: blocked locally because the Docker daemon is not running; CI now builds and smokes the Docker image.
