# @arguslog/cli

[![npm version](https://img.shields.io/npm/v/@arguslog/cli.svg)](https://www.npmjs.com/package/@arguslog/cli)
[![license](https://img.shields.io/npm/l/@arguslog/cli.svg)](https://github.com/petarnenov/arguslog/blob/main/LICENSE)

Command-line companion for [Arguslog](https://arguslog.org) — a multi-tenant error tracking
platform. The CLI handles the two release-time chores that don't belong inside your app's
SDK: cutting a new release tag and shipping the matching JavaScript sourcemaps so stack
traces deminify on the dashboard.

Ships ESM only. Requires Node.js ≥ 22. No runtime dependencies — the binary is the bundled
output of the `cli/` workspace package.

## Install

Grab it from npm — globally, project-local, or one-shot via `npx`:

```bash
# Global (puts `arguslog` on your PATH)
npm install -g @arguslog/cli

# Project-local (recommended for CI)
pnpm add -D @arguslog/cli
npm install --save-dev @arguslog/cli
yarn add -D @arguslog/cli

# One-off without installing
npx @arguslog/cli help
```

After install, the binary is exposed as `arguslog`:

```bash
arguslog version
# → 1.0.0
```

## Authentication

The CLI calls the Arguslog API on your behalf, so it needs a personal access token. Mint one
at **Settings → Personal access tokens** in the dashboard (tokens are prefixed `arglog_pat_`).

Credentials are resolved in this order — first match wins:

1. **Environment variables** (highest priority — perfect for CI):

   ```bash
   export ARGUSLOG_TOKEN="arglog_pat_xxxxxxxxxxxx"
   export ARGUSLOG_API_URL="https://api.arguslog.org"   # optional; defaults to localhost:8081
   ```

2. **Credentials file** at `~/.arguslog/credentials` (recommended for local dev):

   ```json
   {
     "token": "arglog_pat_xxxxxxxxxxxx",
     "apiBaseUrl": "https://api.arguslog.org"
   }
   ```

   ```bash
   mkdir -p ~/.arguslog
   cat > ~/.arguslog/credentials <<'EOF'
   {
     "token": "arglog_pat_xxxxxxxxxxxx",
     "apiBaseUrl": "https://api.arguslog.org"
   }
   EOF
   chmod 600 ~/.arguslog/credentials
   ```

If neither is set, every command exits with `arguslog: No credentials at …` (exit code 1).
There is no anonymous mode.

## Commands

### `arguslog releases new`

Records a new release for a project. The release ID is what the SDK's `release` field
points at, and what `sourcemaps upload` attaches artifacts to.

```bash
arguslog releases new <version> --project <id>
```

| Argument         | Required | Notes                                                              |
| ---------------- | -------- | ------------------------------------------------------------------ |
| `<version>`      | yes      | Free-form release name — git sha, semver, build number, …          |
| `--project <id>` | yes      | Numeric project ID (find it in the dashboard URL or project page). |

**Example:**

```bash
arguslog releases new 1.4.0 --project 42
# → release #1781 created: 1.4.0
```

The version field is intentionally a string, not parsed semver — `2026-05-08-a1b2c3d` is
just as valid as `1.4.0-rc.2`. Pick a scheme and stay with it; the dashboard groups events
by exact match.

### `arguslog sourcemaps upload`

Uploads a `.map` file and links it to a release. Stack traces from minified JS get
deminified on the dashboard the moment the upload lands.

```bash
arguslog sourcemaps upload <path> \
  --project <id> \
  --release <id> \
  [--name <originalPath>]
```

| Argument         | Required | Notes                                                                                                          |
| ---------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `<path>`         | yes      | Local path to the `.map` file.                                                                                 |
| `--project <id>` | yes      | Numeric project ID.                                                                                            |
| `--release <id>` | yes      | Numeric release ID — the value returned by `releases new`.                                                     |
| `--name <path>`  | no       | The path the SDK reports in its stack frames (`https://cdn.example.com/app.js`). Defaults to `basename(path)`. |

**Example:**

```bash
arguslog sourcemaps upload dist/app.abc123.js.map \
  --project 42 \
  --release 1781 \
  --name dist/app.js
# → sourcemap #9432 uploaded (812433 bytes, sha256=8f3e2c1a9b4d…)
```

**How it works.** The CLI does a two-step upload so the API server never sees the bytes:

1. `POST /api/v1/projects/:id/releases/:id/sourcemaps` with `{ originalPath, sha256, sizeBytes }` →
   the API records the artifact row and returns a presigned PUT URL for the object store.
2. `PUT` the bytes directly to the presigned URL — the object store enforces the signed
   `Content-Length` and `sha256`, so a corrupted upload can't slip through.

If step 2 fails after step 1 succeeded, the artifact row exists but has no bytes attached.
Re-run the same command — the API treats a repeat upload of the same `sha256` as the
authoritative copy.

### `arguslog help` / `arguslog version`

```bash
arguslog help     # full usage banner
arguslog version  # just the version number
arguslog -h       # alias for help
arguslog -v       # alias for version
```

## CI integration

The classic flow in a CI release pipeline: cut a release, build the app, upload every
sourcemap. Captured `RELEASE_ID` is reused across the upload calls so all artifacts land
under the same release.

### GitHub Actions

```yaml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  release:
    runs-on: ubuntu-latest
    env:
      ARGUSLOG_TOKEN: ${{ secrets.ARGUSLOG_TOKEN }}
      ARGUSLOG_API_URL: https://api.arguslog.org
      PROJECT_ID: '42'
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22

      - name: Build app
        run: npm ci && npm run build

      - name: Cut release in Arguslog
        id: cut
        run: |
          OUT=$(npx --yes @arguslog/cli releases new "${GITHUB_REF_NAME}" \
            --project "$PROJECT_ID")
          echo "$OUT"
          # `release #1781 created: v1.4.0` — pull out the numeric id
          RELEASE_ID=$(echo "$OUT" | sed -nE 's/^release #([0-9]+).*/\1/p')
          echo "release_id=$RELEASE_ID" >> "$GITHUB_OUTPUT"

      - name: Upload sourcemaps
        run: |
          for map in dist/**/*.js.map; do
            ORIG="${map%.map}"  # dist/app.abc123.js.map → dist/app.abc123.js
            npx --yes @arguslog/cli sourcemaps upload "$map" \
              --project "$PROJECT_ID" \
              --release "${{ steps.cut.outputs.release_id }}" \
              --name "$ORIG"
          done
```

### npm script (local / Docker / any CI)

`package.json`:

```json
{
  "scripts": {
    "release:cut": "arguslog releases new $npm_package_version --project 42",
    "release:upload": "find dist -name '*.js.map' -exec arguslog sourcemaps upload {} --project 42 --release $RELEASE_ID \\;"
  }
}
```

```bash
RELEASE_ID=$(npm run release:cut --silent | sed -nE 's/^release #([0-9]+).*/\1/p')
RELEASE_ID=$RELEASE_ID npm run release:upload
```

## Exit codes

| Code | Meaning                                                                         |
| ---- | ------------------------------------------------------------------------------- |
| `0`  | Success.                                                                        |
| `1`  | Runtime failure — API error, network failure, missing credentials, etc.         |
| `2`  | Usage error — missing argument or unknown flag. The error message is on stderr. |

API errors carry the upstream HTTP status and the RFC 9457 `problem+json` detail, so a
malformed request produces something like:

```
arguslog: api 400 — version "v 1.4.0" contains whitespace
```

## Troubleshooting

**`arguslog: No credentials at …`**
You hit a command before configuring auth. Set `ARGUSLOG_TOKEN` (and optionally
`ARGUSLOG_API_URL`) in your shell, or write `~/.arguslog/credentials`. See
**Authentication** above.

**`arguslog: api 401 — Invalid token`**
Token is expired, revoked, or copied with a leading/trailing space. Mint a new one in the
dashboard. The CLI trims whitespace before sending, but a pasted token with embedded
newline characters will still fail.

**`arguslog: api 404 — release not found`**
You passed a `--release <id>` that belongs to a different project, or the release was
deleted. Re-run `releases new` and use the fresh ID.

**`Sourcemap upload to R2 failed with HTTP 4xx/5xx`**
The metadata row was created on the API but the bytes never landed. Re-run the same
`sourcemaps upload` — the same `sha256` gets re-attached to the existing artifact row, so
duplicates aren't an issue.

**Stack traces still show minified frames after upload.**
The dashboard matches frames by the `release` stamped on the event AND the `--name` of the
uploaded map. If your SDK reports `release: '1.4.0'`, the corresponding `releases new` run
must use `1.4.0` as the version string — exact match. And the `--name` flag must match the
URL path the browser sees in its stack trace (e.g. `dist/app.js`, not `app.js` if the
deployed asset lives at `/dist/app.js`).

## Source

The CLI source lives in the [arguslog monorepo](https://github.com/petarnenov/arguslog) at
`cli/`. Issues and PRs welcome.
