# @arguslog/mcp-server

Model Context Protocol server for [Arguslog](https://arguslog.org) — gives an LLM agent
direct, authenticated access to your error tracking data: issues, events, projects,
organizations, alert rules, releases, members, billing, and (for platform admins) the admin
panel surface. Authenticates with a Personal Access Token issued from the dashboard.

The server exposes **the entire Arguslog REST API** as MCP tools — generated from the
OpenAPI spec at build time, with hand-curated descriptions for the most common operations.

## Two ways to run

| Mode              | Best for                               | Setup                                                                         |
| ----------------- | -------------------------------------- | ----------------------------------------------------------------------------- |
| **Hosted (HTTP)** | Anyone with a PAT — zero install       | Point your MCP client at `https://mcp.arguslog.org/mcp` with a Bearer header. |
| **Local (stdio)** | Air-gapped envs / self-hosted Arguslog | `npx -y @arguslog/mcp-server` with `ARGUSLOG_PAT` in env.                     |

The hosted endpoint runs the same code as the npm binary, just with per-request PAT auth
instead of a process-wide env var. Choose stdio if you want zero network hops between your
client and the MCP server, or if you're running against a self-hosted Arguslog instance.

## Quick start

### 1. Generate a PAT

In the Arguslog dashboard, open **Personal access tokens** (top-right user menu →
"Personal access tokens"), click **Generate new token**, choose the scopes you want the
agent to have (read-only for agents that just look at issues; `orgs:write`,
`releases:write`, etc. if you want it to be able to create / update). Copy the
`arglog_pat_…` value once — the dashboard never shows it again.

### 2. Wire it up in your client

#### Hosted — recommended

Use the public endpoint. No install, no version drift, always serves the latest tool
catalog from production:

```json
{
  "mcpServers": {
    "arguslog": {
      "url": "https://mcp.arguslog.org/mcp",
      "headers": {
        "Authorization": "Bearer arglog_pat_xxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

(Hosted mode requires an MCP client that speaks Streamable HTTP and accepts per-server
headers. Newer Claude Desktop / Claude Code, Cursor 0.50+, and Continue support this. If
yours doesn't yet, fall back to the stdio config below.)

#### Local stdio — Claude Desktop / Claude Code

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the
equivalent on your platform:

```json
{
  "mcpServers": {
    "arguslog": {
      "command": "npx",
      "args": ["-y", "@arguslog/mcp-server"],
      "env": {
        "ARGUSLOG_PAT": "arglog_pat_xxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

#### Cursor

In Cursor's settings → MCP, add a new server with command `npx -y @arguslog/mcp-server`
and the `ARGUSLOG_PAT` env var.

#### Continue

In `~/.continue/config.json`:

```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "name": "arguslog",
        "command": "npx",
        "args": ["-y", "@arguslog/mcp-server"],
        "env": { "ARGUSLOG_PAT": "arglog_pat_xxx" }
      }
    ]
  }
}
```

#### Self-hosted Arguslog

Set `ARGUSLOG_API_URL` alongside the PAT:

```json
"env": {
  "ARGUSLOG_PAT": "arglog_pat_xxx",
  "ARGUSLOG_API_URL": "https://arguslog.your-company.com"
}
```

### 3. Talk to your error tracker

```
> What are my open critical issues this week?

The agent calls arguslog_orgs_list_mine, finds your org, picks a project, then runs
arguslog_issues_list with statuses=unresolved levels=fatal,error and shows you the rows.
```

```
> Create a new React project called "Marketing Web" in my Acme org and show me its DSN.

The agent chains:
  arguslog_orgs_list_mine        → finds Acme (orgId: 42)
  arguslog_projects_create       → POSTs name=Marketing Web platform=react
  arguslog_dsns_list             → fetches the auto-generated DSN
```

```
> Grant a 3-month Pro courtesy upgrade to the demo org with reason "Beta tester".

(Requires platform admin allowlisted PAT.)
The agent calls arguslog_admin_grant_bonus with tier=pro months=3.
```

## What's covered

Every endpoint in `/api/v1/...` is callable. The high-leverage ones have curated
descriptions and example payloads in their tool docstring:

| Group       | Examples                                                                |
| ----------- | ----------------------------------------------------------------------- |
| Orgs        | list mine, create, delete, usage, members                               |
| Projects    | list, create, archive, DSN keys CRUD                                    |
| Issues      | list with filters, get, list events, change status                      |
| Releases    | list, create, attach source-map artifacts, delete                       |
| Alerts      | rules CRUD, destinations CRUD (Telegram / Slack / email / webhook)      |
| Billing     | plan catalog, usage snapshot, **user-level checkout / portal / crypto** |
| Admin       | platform stats, user / org tables, **per-user + per-org bonus grants**  |
| Me          | who am I + **billing state (plan, renew, bonus, grace)**, PATs          |
| Web3 events | the rich event payload shape from `@arguslog/sdk-web3` flows through    |

PAT scopes are enforced server-side, so a read-only PAT can call read tools but writes
return `403`. The MCP server surfaces those problem responses verbatim so the agent can
explain to the user what scope is missing.

## Configuration

| Env var                     | Required         | Default                    | Description                                                                                                                                                                                    |
| --------------------------- | ---------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARGUSLOG_PAT`              | stdio mode only  | —                          | Bearer token from the dashboard. Not needed for the hosted HTTP server — there it comes from each request's `Authorization` header.                                                            |
| `ARGUSLOG_API_URL`          | no               | `https://api.arguslog.org` | Override for self-hosted / staging environments.                                                                                                                                               |
| `CF_ORIGIN_TOKEN`           | hosted HTTP only | —                          | When set, `POST /mcp` requires the matching value in the `X-Origin-Token` header. Configure a Cloudflare Transform Rule on `mcp.arguslog.org` to inject it. (CF reserves the `X-CF-*` prefix.) |
| `MCP_RATE_LIMIT_PER_MINUTE` | no               | `120`                      | Per-PAT (or per-IP when unauthenticated) rate cap for `POST /mcp`. `/healthz` is exempt.                                                                                                       |

## Local development

```bash
pnpm install
pnpm --filter @arguslog/mcp-server build      # generate + compile
pnpm --filter @arguslog/mcp-server test
ARGUSLOG_PAT=arglog_pat_xxx node dist/index.js  # smoke test stdio server
```

When the OpenAPI spec changes (new endpoints, renamed paths), re-run `pnpm generate` to
refresh `src/generated/openapi-tools.ts`.

## License

MIT — see [LICENSE](https://github.com/petarnenov/arguslog/blob/main/LICENSE).
