# Registering @arguslog/mcp-server

After the package is published to npm, list it in the major MCP registries so users can
discover it without copy-pasting JSON snippets. Each registry has different submission
rules — checklist below.

## 1. npm — primary

Tag-driven release. Bump the version in `packages/mcp-server/package.json`, push a
`mcp-server-vX.Y.Z` tag, and the `release-mcp-server` workflow publishes:

```bash
git tag mcp-server-v0.1.0
git push origin mcp-server-v0.1.0
```

The workflow runs lint → typecheck → tests → codegen → tsc → `pnpm publish --provenance`.
First-time release of a `@arguslog/*` scope requires `npm login` from a maintainer with
the `@arguslog` org and an `NPM_TOKEN` GitHub secret — both are already provisioned for
the other SDK release workflows.

## 2. Smithery (smithery.ai)

Smithery is the most-used "MCP marketplace" — it gives users a one-click installer for
Claude Desktop / Cursor / Continue based on a `smithery.yaml` in the repo.

1. Visit https://smithery.ai/new and connect the GitHub repo.
2. Smithery autodetects `packages/mcp-server/smithery.yaml` and registers the server.
3. Approve the listing. Future commits to `main` that touch `packages/mcp-server/` are
   indexed automatically.

The `smithery.yaml` is already in this directory — it declares the stdio command,
required env vars (`ARGUSLOG_PAT`), and optional ones (`ARGUSLOG_API_URL`).

## 3. Glama AI (glama.ai/mcp/servers)

Glama indexes `@modelcontextprotocol`-style npm packages automatically once you submit
the npm name. The optional `glama.json` in the repo gives Glama the metadata it needs
without scraping (icons, tags, transports).

1. Visit https://glama.ai/mcp/servers/submit
2. Enter the npm package name: `@arguslog/mcp-server`
3. Glama crawls and lists within ~24 hours.

## 4. Anthropic / official MCP registry

The community list lives at https://github.com/modelcontextprotocol/servers — submit a
PR adding a row to the README. The PR gets review + merge from the MCP maintainers.

PR template:

```markdown
- **[Arguslog](https://arguslog.org)** ([source](packages/mcp-server)) - Sentry-compatible
  error tracking platform with issues, events, alerts, releases, billing, and platform
  admin panel as MCP tools. Uses dashboard-issued PATs for auth.
```

Anthropic also runs a curated registry via https://claude.ai/mcp — submission form opens
periodically; check the Claude Code docs for the latest URL when shipping a new version.

## 5. MCP-Get / pulsemcp.com / awesome-mcp-servers

Smaller community trackers. PR a row to:

- https://github.com/punkpeye/awesome-mcp-servers
- https://mcp-get.com (auto-pulls from npm — no submission needed once npm-published)
- https://pulsemcp.com (similar; auto-indexes)

## Verifying a release

After tagging and the workflow finishes:

```bash
npx @arguslog/mcp-server --help   # should print version + usage
npm view @arguslog/mcp-server     # should show the new version
```
