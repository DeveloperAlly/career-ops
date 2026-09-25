# Running career-ops in Docker

Use this when the host can't install Playwright/Chromium directly (e.g. Ubuntu
26.04, NixOS without the `playwright-driver` shell, locked-down corporate
laptops). The image is based on Microsoft's official Playwright image, which
ships Chromium preinstalled and works on any Linux kernel Docker supports.

No feature is dropped: PDF generation, scanner, liveness checker, dashboard
(Go), batch workers, update system — everything runs inside the container.
Your project directory is bind-mounted, so reports, CVs, profile, tracker, and
all generated artifacts live on the host as before.

## Prerequisites

- Docker Engine 24+ with the Compose plugin (`docker compose version`)
- ~2 GB free disk for the image

## First-time setup

```bash
# from project root
./cops up           # builds image (first run takes a few minutes) and starts container
./cops doctor       # confirms node + playwright + chromium + go are present
```

That's it. Container stays running in the background. Re-runs are instant.

## Daily use

The `./cops` wrapper forwards any command into the container.

| Task | Command |
|------|---------|
| Health check | `./cops doctor` |
| Verify pipeline | `./cops verify` |
| Generate PDF | `./cops pdf output/cv.html output/cv.pdf` |
| Scan portals | `./cops scan` |
| Check liveness | `./cops liveness <url>` |
| Merge tracker | `./cops merge` |
| Dedup tracker | `./cops dedup` |
| Normalize statuses | `./cops normalize` |
| Update check | `./cops update:check` |
| Apply update | `./cops update` |
| Rollback | `./cops rollback` |
| Interactive shell | `./cops shell` |
| Raw node script | `./cops node check-liveness.mjs <url>` |
| Build dashboard | `./cops bash -c 'cd dashboard && go build -buildvcs=false -o career-dashboard . && ./career-dashboard --path ..'` |

Unknown subcommands fall through to `docker compose exec` so anything works:

```bash
./cops npm test
./cops bash -c 'find reports -name "*.md" | wc -l'
```

## Lifecycle

```bash
./cops up        # start (idempotent)
./cops down      # stop and remove the container (volumes kept)
./cops rebuild   # full rebuild (use after Dockerfile or deps change)
./cops logs      # tail container logs
```

## How it works

- `Dockerfile` — installs Node, Playwright/Chromium (preinstalled in base image),
  Go (for the dashboard), LaTeX (for `generate-latex.mjs`), and project deps.
- `docker-compose.yml` — bind-mounts the project at `/app` so host edits appear
  inside the container immediately. `node_modules` lives in a named volume to
  avoid host/container ABI mismatches.
- `.dockerignore` — keeps generated and personal data out of the build context.

## API keys

Drop your keys in `.env` at the project root or export them in the shell that
runs `./cops`. The compose file forwards these into the container (unset ones
arrive empty, which every script treats as unset):

- Keys: `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`
- Model / endpoint: `OPENAI_BASE_URL`, `OPENAI_MODEL`, `CAREER_OPS_MODEL`, `OPENROUTER_TIMEOUT_MS`
- Data location: `CAREER_OPS_DATA_DIR` (see below)

```bash
echo "GEMINI_API_KEY=..." >> .env
./cops gemini:eval
```

**`CAREER_OPS_DATA_DIR` is resolved inside the container**, relative to `/app`
(the project root), and only the project directory is mounted. So a path inside
the project works (`CAREER_OPS_DATA_DIR=my-data`), but one outside it
(`../career-ops-data`, or an absolute host path you use for native runs) does not
exist in the container. For data outside the project, add a volume for it in
`docker-compose.yml` and set `CAREER_OPS_DATA_DIR` to the container-side path.

## Data persistence

Everything under the project root is on your host filesystem:

- `cv.md`, `config/profile.yml`, `modes/_profile.md`, `portals.yml`
- `data/applications.md`, `data/pipeline.md`, `data/scan-history.tsv`
- `reports/`, `output/`, `interview-prep/`, `jds/`

Nothing important is stored inside the container. `./cops down` is safe.

## Updating

Career-ops updates work the same as native:

```bash
./cops update:check
./cops update
```

If `package.json` deps change, run `./cops rebuild` once to refresh the image
layer that holds `node_modules`.

## Troubleshooting

**`docker: not found`** — install Docker Engine + Compose plugin first.

**Playwright still complains** — you're running the host's Node, not the
container's. Always go through `./cops`.

**Permission errors on generated files** — the container runs as root by
default. If host files end up root-owned, either:
- run `sudo chown -R "$USER" .` once, or
- uncomment `user: "${UID:-1000}:${GID:-1000}"` in `docker-compose.yml` to run
  as your host user. Export the IDs first (`export UID GID=$(id -g)`; bash sets
  `UID` but does not export it, and sets no `GID`), otherwise both default to
  `1000`. Caveats, which is why it stays opt-in:
  - UID `1000` is normally the image's `pwuser`, which has a home directory.
    Any other UID has no account in the image, so `HOME` becomes `/` and npm,
    Go and Chromium cannot write their caches or profiles. Add `HOME=/tmp` to
    `environment:` if you hit this.
  - The `node_modules` volume is populated as root at build time, so
    `./cops npm install` fails as a non-root user. Use `./cops rebuild` after
    dependency changes instead.
  - Files already created as root must be `chown`ed back once before switching.

**Slow first build** — base image is ~1.5 GB. Subsequent builds reuse layers
and finish in seconds.
