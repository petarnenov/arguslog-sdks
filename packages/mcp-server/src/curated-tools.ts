/**
 * Hand-crafted MCP tools for the most-used Arguslog operations. Each entry overrides the
 * auto-generated one of the same name from {@code generated/openapi-tools.ts} — the runtime
 * dispatcher prefers curated entries when both exist.
 *
 * <p>Curated tools have:
 *
 * <ul>
 *   <li>An LLM-friendly description that includes <em>when</em> to use the tool, not just what
 *       it does — generic OpenAPI summaries are too thin for an agent to plan with.</li>
 *   <li>Examples in the description showing typical arg shapes — anchors the LLM's first call.</li>
 * </ul>
 *
 * <p>Adding more curated entries is the cheapest way to improve LLM accuracy on a specific
 * workflow — they share the same dispatcher path as auto-generated tools, just better docs.
 */
import type { OpenApiTool } from './generated/openapi-tools.js';

export const CURATED_TOOLS: Record<string, OpenApiTool> = {
  arguslog_orgs_list_mine: {
    name: 'arguslog_orgs_list_mine',
    description: `List the organizations the authenticated user is a member of.

Always start here. Most other tools need an \`orgId\` from this list. Returns one row per org with
\`id\`, \`slug\`, \`name\`, \`plan\`, and \`createdAt\`. The \`plan\` field is one of: free,
starter, pro, business, enterprise.

Method: GET /api/v1/orgs

No arguments. Example: call this tool first to discover the user's orgs, pick the right one by
\`name\` or \`slug\`, then pass its \`id\` to other tools.`,
    method: 'GET',
    path: '/api/v1/orgs',
    pathParams: [],
    queryParams: [],
    hasBody: false,
  },

  arguslog_projects_list: {
    name: 'arguslog_projects_list',
    description: `List projects belonging to an organization.

Returns rows with \`id\`, \`slug\`, \`name\`, \`platform\`, \`createdAt\`. Archived projects
are excluded by default. Use the \`id\` from this list as \`projectId\` for issues / events /
release tools.

Method: GET /api/v1/orgs/{orgId}/projects

Required: \`orgId\` (number). Example: \`{ "orgId": 42 }\`.`,
    method: 'GET',
    path: '/api/v1/orgs/{orgId}/projects',
    pathParams: [{ name: 'orgId', required: true, type: 'integer' }],
    queryParams: [],
    hasBody: false,
  },

  arguslog_issues_list: {
    name: 'arguslog_issues_list',
    description: `List unresolved issues for a project, most-recent first.

This is the agent's main lookup tool when the user says "what broke today" or "show me the
top errors". Use \`statuses=unresolved\` (the default) for the live error wall; pass
\`statuses=resolved,ignored\` to audit silenced groups. Pagination uses \`afterId\` from the
last row of the previous page.

Method: GET /api/v1/projects/{projectId}/issues

Required: \`projectId\` (number).
Optional: \`statuses\` (csv: \`unresolved,resolved,ignored\`), \`levels\` (csv:
\`fatal,error,warning,info,debug\`), \`q\` (free-text search), \`afterId\`, \`limit\` (default
50, max 200).

Example: \`{ "projectId": 7, "statuses": "unresolved", "levels": "error,fatal", "limit": 25 }\``,
    method: 'GET',
    path: '/api/v1/projects/{projectId}/issues',
    pathParams: [{ name: 'projectId', required: true, type: 'integer' }],
    queryParams: [
      { name: 'statuses', required: false, type: 'string' },
      { name: 'levels', required: false, type: 'string' },
      { name: 'q', required: false, type: 'string' },
      { name: 'afterId', required: false, type: 'integer' },
      { name: 'limit', required: false, type: 'integer' },
    ],
    hasBody: false,
  },

  arguslog_issues_get: {
    name: 'arguslog_issues_get',
    description: `Fetch full details of a single issue, including its first / last seen timestamps,
total occurrences, fingerprint, and current status.

Method: GET /api/v1/projects/{projectId}/issues/{issueId}

Required: \`projectId\` (number), \`issueId\` (number). Example:
\`{ "projectId": 7, "issueId": 123 }\``,
    method: 'GET',
    path: '/api/v1/projects/{projectId}/issues/{issueId}',
    pathParams: [
      { name: 'projectId', required: true, type: 'integer' },
      { name: 'issueId', required: true, type: 'integer' },
    ],
    queryParams: [],
    hasBody: false,
  },

  arguslog_issues_events: {
    name: 'arguslog_issues_events',
    description: `List recent events for an issue, ordered by time descending. Each event has the
full payload (stack trace, breadcrumbs, contexts, request, web3 fields if present).

Use this after \`arguslog_issues_get\` to see actual exception details — the issue row only
has aggregate stats, not the per-occurrence payloads.

Method: GET /api/v1/projects/{projectId}/issues/{issueId}/events

Required: \`projectId\`, \`issueId\`.
Optional: \`afterId\`, \`limit\` (default 50, max 200).`,
    method: 'GET',
    path: '/api/v1/projects/{projectId}/issues/{issueId}/events',
    pathParams: [
      { name: 'projectId', required: true, type: 'integer' },
      { name: 'issueId', required: true, type: 'integer' },
    ],
    queryParams: [
      { name: 'afterId', required: false, type: 'integer' },
      { name: 'limit', required: false, type: 'integer' },
    ],
    hasBody: false,
  },

  arguslog_orgs_get_usage: {
    name: 'arguslog_orgs_get_usage',
    description: `Current-month event usage + plan caps for an organization. Use to answer
"are we close to our event cap?" or "what plan are we on?". Returns \`eventsUsed\`,
\`eventCap\`, \`projectCap\`, \`retentionDays\`, \`plan\`, \`ratio\` (0..1+), \`exceeded\`,
\`bonus\` (when an admin has comp'd a paid plan).

Method: GET /api/v1/orgs/{orgId}/usage`,
    method: 'GET',
    path: '/api/v1/orgs/{orgId}/usage',
    pathParams: [{ name: 'orgId', required: true, type: 'integer' }],
    queryParams: [],
    hasBody: false,
  },

  arguslog_projects_create: {
    name: 'arguslog_projects_create',
    description: `Create a new project under an org. The project gets an auto-generated DSN; call
\`arguslog_dsns_list\` afterwards to fetch it (the response of this tool returns the project
metadata only).

Method: POST /api/v1/orgs/{orgId}/projects

Required: \`orgId\`, \`body.name\` (2-100 chars), \`body.platform\` (one of: javascript, react,
vue, angular, nextjs, react-native, node, java-spring, python).

Example: \`{ "orgId": 42, "body": { "name": "Marketing Web", "platform": "react" } }\``,
    method: 'POST',
    path: '/api/v1/orgs/{orgId}/projects',
    pathParams: [{ name: 'orgId', required: true, type: 'integer' }],
    queryParams: [],
    hasBody: true,
  },

  arguslog_releases_create: {
    name: 'arguslog_releases_create',
    description: `Register a release for a project. Source maps uploaded later via the artifact
endpoints attach to this release so symbolication can resolve minified frames back to original
files.

Method: POST /api/v1/projects/{projectId}/releases

Required: \`projectId\`, \`body.version\` (semver or commit sha). Optional: \`body.environment\`
(\`production\`, \`staging\`, …), \`body.commit\`.

Example: \`{ "projectId": 7, "body": { "version": "1.4.2", "environment": "production",
"commit": "abc123" } }\``,
    method: 'POST',
    path: '/api/v1/projects/{projectId}/releases',
    pathParams: [{ name: 'projectId', required: true, type: 'integer' }],
    queryParams: [],
    hasBody: true,
  },

  arguslog_alert_rules_list: {
    name: 'arguslog_alert_rules_list',
    description: `List alert rules for a project. Each rule has a name, enabled flag, level filter
(\`fatal | error | warning | info | debug\`), tag filters, throttle window, and the destinations
it fires to.

Method: GET /api/v1/projects/{projectId}/alert-rules`,
    method: 'GET',
    path: '/api/v1/projects/{projectId}/alert-rules',
    pathParams: [{ name: 'projectId', required: true, type: 'integer' }],
    queryParams: [],
    hasBody: false,
  },

  arguslog_alert_destinations_list: {
    name: 'arguslog_alert_destinations_list',
    description: `List the alert destinations configured on an org (Telegram, Slack, email,
generic webhook). Destination IDs are referenced from alert rules.

Method: GET /api/v1/orgs/{orgId}/alert-destinations`,
    method: 'GET',
    path: '/api/v1/orgs/{orgId}/alert-destinations',
    pathParams: [{ name: 'orgId', required: true, type: 'integer' }],
    queryParams: [],
    hasBody: false,
  },

  arguslog_members_list: {
    name: 'arguslog_members_list',
    description: `List members of an org with their roles (owner / admin / member) and join dates.

Method: GET /api/v1/orgs/{orgId}/members`,
    method: 'GET',
    path: '/api/v1/orgs/{orgId}/members',
    pathParams: [{ name: 'orgId', required: true, type: 'integer' }],
    queryParams: [],
    hasBody: false,
  },

  arguslog_members_invite: {
    name: 'arguslog_members_invite',
    description: `Invite a new member to an org. The server emails the invitee a magic link and
also inserts a pending membership row. Required scope on the PAT: \`orgs:write\`.

Method: POST /api/v1/orgs/{orgId}/members

Required: \`orgId\`, \`body.email\`, \`body.role\` (\`admin\` | \`member\`).
Example: \`{ "orgId": 42, "body": { "email": "alice@example.com", "role": "member" } }\``,
    method: 'POST',
    path: '/api/v1/orgs/{orgId}/members',
    pathParams: [{ name: 'orgId', required: true, type: 'integer' }],
    queryParams: [],
    hasBody: true,
  },

  arguslog_dsns_list: {
    name: 'arguslog_dsns_list',
    description: `List active DSN keys for a project. The DSN is the SDK ingest credential —
SDKs authenticate to ingest with this. Returns the public part of the DSN; the secret half
is shown only at creation time.

Method: GET /api/v1/projects/{projectId}/keys`,
    method: 'GET',
    path: '/api/v1/projects/{projectId}/keys',
    pathParams: [{ name: 'projectId', required: true, type: 'integer' }],
    queryParams: [],
    hasBody: false,
  },

  arguslog_billing_plans: {
    name: 'arguslog_billing_plans',
    description: `Public catalog of all paid plans with caps + duration ladder (-17/-25/-33%
discount for 3/6/12 months). No org context needed. Use to answer "what's the price of Pro
for 6 months" or "how many events does Business include".

Method: GET /api/v1/billing/plans`,
    method: 'GET',
    path: '/api/v1/billing/plans',
    pathParams: [],
    queryParams: [],
    hasBody: false,
  },

  arguslog_admin_grant_bonus: {
    name: 'arguslog_admin_grant_bonus',
    description: `[Platform admin only] Comp a paid plan to a specific organization. The plan
column is updated to the new tier and \`bonus_until\` is set to now + months × 30 days. An
audit-log entry is written.

Required: \`orgId\`, \`body.tier\` (\`starter\` | \`pro\` | \`business\`), \`body.months\`
(1, 3, 6, or 12), \`body.reason\` (free text shown to the customer).

Method: POST /api/v1/admin/orgs/{orgId}/grant

Example: \`{ "orgId": 42, "body": { "tier": "pro", "months": 3, "reason": "Beta tester" } }\``,
    method: 'POST',
    path: '/api/v1/admin/orgs/{orgId}/grant',
    pathParams: [{ name: 'orgId', required: true, type: 'integer' }],
    queryParams: [],
    hasBody: true,
  },
};
