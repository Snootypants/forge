# Release and Install Hardening - 2026-05-02

Plan id: `release-install-hardening-2026-05-02`

Purpose: turn the current QA-hardened repo into something a new user can install, initialize, diagnose, and run without knowing the repo history.

## Release Stance

- Docker is the recommended universal deployment path.
- Native macOS and Linux are supported install paths.
- Windows should be supported through Docker Desktop or WSL2 first.
- Native Windows should become CI-validated before it is called first-class.
- npm publish should use the scoped `@35bird/forge` package unless the existing `forge` npm owner transfers the unscoped name.

## Findings

| ID | Severity | Area | Finding | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| REL-010 | high | install/cli | Add first-run CLI commands for init, start, doctor, and token discovery. | Worker A | completed |
| REL-011 | high | release/npm | Prepare npm package metadata and publish dry-run path. | Worker B | completed |
| REL-012 | high | cross-platform/build | Replace POSIX-only build script with cross-platform Node build helper. | Worker C | completed |
| REL-013 | high | ci/platform | Add OS matrix CI for native install checks while keeping Docker smoke on Linux. | Worker D | completed |
| REL-014 | medium | providers/windows | Harden provider CLI command spawning for Windows/native portability. | Worker E | completed |
| REL-015 | medium | docs/install | Rewrite install docs around Docker, npm, git, and Windows support stance. | Worker F | completed |

## Worker Roster

Model policy: no explicit model override. Each worker inherits the parent Codex session model. Reasoning effort is `high`.

| Label | Nickname | Ownership | Model | Effort | Status |
| --- | --- | --- | --- | --- | --- |
| Worker A | Bacon | `019dec0c-1979-7791-a7f4-820d2937af7b` | CLI init/start/doctor/token | inherited parent Codex model | high | completed |
| Worker B | Kant | `019dec0c-19ff-7201-b803-b06828562a8c` | npm package metadata and dry-run publish path | inherited parent Codex model | high | completed |
| Worker C | Feynman | `019dec0c-1a68-7ab1-ae39-428a3e252337` | cross-platform release build helper | inherited parent Codex model | high | completed |
| Worker D | Nietzsche | `019dec0c-1a98-7f90-a1ad-90d8202c2eef` | CI OS matrix and Docker smoke split | inherited parent Codex model | high | completed |
| Worker E | Planck | `019dec0c-1ac7-7a42-b310-ed02874b6f59` | provider CLI Windows/native spawn portability | inherited parent Codex model | high | completed |
| Worker F | Sagan | `019dec0c-1af9-7aa0-85d2-a5e766b5fd67` | install/platform support docs | inherited parent Codex model | high | completed |

## Shared Worker Instruction

```text
You are not alone in the codebase. Other workers are editing disjoint areas. Do not revert changes you did not make. Keep your write scope tight. If your work needs a file owned by another worker, record the needed change in your final response instead of editing across scope.
```

## Prompts

### Worker A - Bacon - CLI

```text
Implement first-run CLI commands for Forge.

Ownership: src/cli.ts and targeted tests for CLI behavior. You may read src/index.ts/config/platform, but avoid changing package.json because Worker B owns package metadata. If a bin/package change is required, report the exact requested package.json entry.

Required behavior:
- forge init: create a forge.config.yaml in the current directory unless it exists; do not overwrite unless an explicit flag exists.
- forge start [mode] [--config path]: start the existing runtime using an explicit config path.
- forge doctor [--config path]: check Node version, config parse, DB path writability, provider auth readiness at a high level, and print actionable status without leaking secrets.
- forge token [--config path]: print where the web token is configured/stored and whether it exists; do not print token value.

Keep implementation small and consistent with existing parse/config patterns. Add tests where practical.
```

### Worker B - Lovelace - npm Package

```text
Prepare npm package metadata and publish dry-run path.

Ownership: package.json, package-lock.json, and package metadata docs/checklist if needed. Coordinate with Worker A by wiring the CLI bin only if src/cli.ts exists or by documenting the expected target.

Required behavior:
- Switch from occupied unscoped name planning to the scoped package `@35bird/forge`.
- Preserve CLI command name as forge through package bin.
- Remove private publish block only if package metadata is ready; otherwise add a clear publish-prep state.
- Add files allowlist so npm excludes runtime DBs, identity, logs, eval data, research, and generated output.
- Add npm pack/dry-run validation script if useful.

Run npm pack --dry-run and report included package surface.
```

### Worker C - Feynman - Cross-Platform Build

```text
Replace POSIX-only release build script with a cross-platform Node helper.

Ownership: scripts/build-release.mjs, package.json script field only where necessary for build:release, and targeted tests if useful.

Required behavior:
- Replace rm -rf, cp -R, and find usage in build:release with Node fs operations.
- Keep dist output identical in intent: compiled JS, web public assets, DB schemas, no .DS_Store.
- Do not own npm package naming/bin/files beyond the script wiring needed for build.

Run npm run build.
```

## npm Publish Prep State

Status: publish-ready metadata. The package metadata uses the scoped name `@35bird/forge`, exposes the installed command as `forge`, and sets `publishConfig.access` to `public` for the scoped npm release.

The npm package allowlist is limited to `dist/`, `docs/install.md`, `README.md`, and `LICENSE`, so runtime databases, identity files, logs, eval data, research files, local config, and other repo output are excluded from `npm pack`. The `dist/` directory is intentionally the release artifact.

The CLI command name remains `forge` through package `bin`:

```json
"bin": {
  "forge": "./dist/cli.js"
}
```

Validation command: `npm run pack:dry-run`.

### Worker D - Nietzsche - CI Matrix

```text
Add native OS CI matrix and keep Docker smoke Linux-only.

Ownership: .github/workflows/ci.yml only.

Required behavior:
- Native job matrix for ubuntu-latest, macos-latest, windows-latest.
- Each native job runs npm ci, npm run check, npm run build, npm audit --omit=dev.
- Docker image build and /readyz smoke remain Linux-only.
- Avoid shell snippets that break on Windows in the native matrix.

Validate workflow shape locally as much as possible by inspection.
```

### Worker E - Planck - Provider CLI Portability

```text
Harden provider CLI command spawning for native Windows portability.

Ownership: src/services/llm/shared.ts, CLI provider files under src/services/llm/providers, src/auth/oauth.ts, and related tests.

Required behavior:
- Provider command spawning should work when commands resolve as .cmd/.exe on Windows.
- Avoid unsafe shell interpolation.
- Keep configured llm.command support.
- Claude auth status/login checks should use the same portable command-resolution approach where practical.
- Add tests for command/argument handling without requiring Windows.

Run targeted tests and npm run check.
```

### Worker F - Sagan - Install Docs

```text
Rewrite install/platform docs for release readiness.

Ownership: README.md install/platform sections and optional docs/install.md. Do not edit code.

Required behavior:
- Explain Docker, npm, and git clone install paths.
- State platform support honestly: Docker universal, macOS/Linux native, Windows Docker/WSL recommended, native Windows CI-tracked/experimental until validated.
- Explain provider caveats: API providers easiest in Docker; CLI providers need host/container credentials.
- Include npm scoped package plan and note unscoped forge npm name is currently occupied.
- Keep README concise; move detail into docs/install.md if needed.

Do link/path sanity checks.
```

## Integration Review

Manager review sent three follow-up passes:

- Worker A removed runtime-entrypoint drift by making `src/index.ts` delegate to `runCli`.
- Worker B added the active npm `bin` mapping and removed the publish block after `dist/cli.js` existed.
- Worker D removed the Windows bash npm-script workaround after Worker C replaced the POSIX build script.
- Worker C fixed the Docker build contract by copying `scripts/build-release.mjs` into the Docker build stage.
- Worker F updated npm docs after the package became publish-ready.

## Verification

- `npm run check`: passed, 61 tests.
- `npm run build`: passed using `node scripts/build-release.mjs`.
- `git diff --check`: passed.
- `npm audit --omit=dev`: passed, 0 vulnerabilities.
- `npm pack --dry-run --json`: passed; package is `@35bird/forge@0.1.0`, includes `dist/cli.js`, excludes runtime DBs, identity, logs, eval data, and research paths.
- Built CLI smoke: `node dist/cli.js init --force` and `node dist/cli.js token --config forge.config.yaml` passed without printing token values.
- CI workflow structural check: passed for native `ubuntu-latest`, `macos-latest`, `windows-latest`, and Linux-only Docker smoke.
- `docker build -t forge:install-hardening .`: passed.
- Docker `/readyz` smoke with generated non-secret config: passed.
