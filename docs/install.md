# Install Guide

Forge can run from Docker, from the prepared npm package metadata, or from a source checkout. Docker is the verified universal install path today. npm is the package distribution path once published, and git clone is the source install path.

## Platform Support

| Platform | Support stance |
|----------|----------------|
| Docker | Verified recommended path across macOS, Linux, Windows, NAS appliances, and servers. CI builds the image and smokes `/readyz`; persistent state is mounted under `/config`. |
| macOS native | Verified native development path with Node.js 22.6+. |
| Linux native | Supported for source installs and server deployment with Node.js 22.6+. Ubuntu/Debian plus systemd is the primary bare-metal server shape and CI covers native checks. |
| Windows via Docker or WSL | Recommended Windows path today. Docker Desktop and WSL keep the runtime close to the Linux/macOS paths. |
| Windows native | In progress. Native install, build, provider subprocesses, and runtime behavior are being hardened through CI and external install feedback. |

## Provider Credentials

Forge chat needs one LLM provider:

- `openai-api`
- `anthropic-api`
- `claude-cli`
- `codex-cli`

API providers are easiest in Docker and on servers. Put `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in `.env`, keep `forge.config.yaml` key refs as `env:` entries, and pass `.env` to the process or container.

CLI providers need more care because they depend on provider-owned binaries and login state. A native install can use the host's `claude auth login` or `codex login` state. A Docker container cannot see host CLI credentials unless you intentionally mount them, and it also needs the relevant CLI binary available inside the container. Prefer API providers in Docker unless you are deliberately building and operating a CLI-provider image.

Do not bake `.env`, provider credentials, `dbs/`, `identity/`, `logs/`, or `forge.config.yaml` into a Docker image. Mount them at runtime.

## Docker Install

Docker is the verified recommended path when you want repeatable deployment across machines.

Prerequisites:

- Docker or Docker Desktop
- Git, until a prebuilt image is published
- One API provider key, unless you are intentionally configuring a CLI provider inside the container

Build the image from a checkout:

```bash
git clone https://github.com/Snootypants/forge.git
cd forge
docker build -t forge .
```

Create runtime state volumes:

```bash
docker volume create forge-dbs
docker volume create forge-identity
docker volume create forge-logs
```

Create `.env` next to `forge.config.yaml` for provider keys:

```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

Start the container:

```bash
docker run -d \
  --name forge \
  -p 6800:6800 \
  --mount type=bind,src="$(pwd)/forge.config.yaml",dst=/config/forge.config.yaml,readonly \
  --mount type=volume,src=forge-dbs,dst=/config/dbs \
  --mount type=volume,src=forge-identity,dst=/config/identity \
  --mount type=volume,src=forge-logs,dst=/config/logs \
  --env-file .env \
  forge
```

The Docker image sets `FORGE_CONFIG=/config/forge.config.yaml` and `FORGE_WEB_HOST=0.0.0.0`. The published web port is controlled by `-p 6800:6800`; change the host-side port if you want multiple containers on the same machine.

Relative `paths.*` entries resolve under `forge.root`. For Docker, set `forge.root: /config` in the mounted config, or use absolute `/config/dbs`, `/config/identity`, and `/config/logs` path entries. With the default relative paths and `forge.root: /config`, the named volumes above persist databases, identity files, logs, and the generated web auth token.

Readiness checks:

```bash
curl http://127.0.0.1:6800/healthz
curl http://127.0.0.1:6800/readyz
```

If you bind-mount host directories instead of using named volumes, create them first and make them writable by the container user:

```bash
mkdir -p dbs identity logs
sudo chown -R 1000:1000 dbs identity logs
```

Then bind those host directories to `/config/dbs`, `/config/identity`, and `/config/logs` instead of the named-volume mounts.

## npm Install

The package metadata is prepared for the scoped package `@35bird/forge`, with the installed CLI command mapped to `forge`. Registry availability depends on publishing the package. The unscoped `forge` npm package name is currently occupied, so use the scoped package name for installs.

After the package is published:

```bash
npm install -g @35bird/forge
forge init
forge start --config ./forge.config.yaml
```

The package entry point is import-safe and exports CLI helpers, but the supported public surface today is the `forge` CLI. Internal service imports such as `@35bird/forge/src/...` are not exported by the packed package; use a source checkout if you need to wire internal services directly.

Until the package is available in the registry, use Docker or the git clone source install.

## Git Clone Source Install

Use this path for development, release validation, or running before the npm package is published.

Prerequisites:

- Node.js 22.6+; Node 22 LTS is the supported runtime line
- npm
- Git
- One configured provider

Install and build:

```bash
git clone https://github.com/Snootypants/forge.git
cd forge
npm ci
npm run typecheck
npm run build
```

Run the source entrypoint during development:

```bash
npm start
```

Run the compiled release artifact:

```bash
npm run start:dist
```

Use an explicit config path when running outside the repo default:

```bash
node dist/index.js --config /path/to/forge.config.yaml
```

On first boot, Forge creates SQLite databases, initializes identity templates when needed, and creates a web auth token under the resolved logs directory if no token is configured. Run `forge token --show` to reveal the saved token for web UI login. From a source checkout before global npm install, run `node --experimental-strip-types src/index.ts token --show`.

Web token enforcement can be disabled from stored settings. Only disable it behind a trusted local network, VPN, or reverse proxy; unauthenticated web access exposes the chat and settings APIs to anyone who can reach the host and port.

The web UI listens on `http://127.0.0.1:6800` for native installs unless `services.web.host`, `services.web.port`, or environment overrides change it.

## Native Service Install

For Linux servers, build once and run `dist/index.js` under a service manager:

```ini
[Unit]
Description=forge agent
After=network.target

[Service]
Type=simple
User=agent
WorkingDirectory=/home/agent/forge
ExecStart=/usr/bin/node dist/index.js --config /home/agent/forge/forge.config.yaml
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=FORGE_WEB_HOST=127.0.0.1

[Install]
WantedBy=multi-user.target
```

Use a reverse proxy or firewall rules if you expose the web UI beyond localhost.

## Quick Troubleshooting

- Config not found: pass `--config /path/to/forge.config.yaml` or set `FORGE_CONFIG`.
- Web UI unreachable in Docker: confirm `-p 6800:6800` is set and the container uses `FORGE_WEB_HOST=0.0.0.0`.
- Docker state missing after rebuild: confirm Docker config uses `forge.root: /config` or absolute `/config/...` paths, and that volumes are mounted at `/config/dbs`, `/config/identity`, and `/config/logs`.
- Web UI unreachable natively from another machine: set `services.web.host` or `FORGE_WEB_HOST` intentionally; native installs default to localhost.
- API provider fails: check that `.env` is in the same directory as the active config file and that config uses the matching `env:` key reference.
- CLI provider fails in Docker: confirm the CLI binary and login state exist inside the container or switch to an API provider.
