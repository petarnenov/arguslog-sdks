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
  list_my_orgs: {
    name: 'list_my_orgs',
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

  list_projects: {
    name: 'list_projects',
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

  list_issues: {
    name: 'list_issues',
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

  get_issue: {
    name: 'get_issue',
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

  list_issue_events: {
    name: 'list_issue_events',
    description: `List recent events for an issue, ordered by time descending. Each event has the
full payload (stack trace, breadcrumbs, contexts, request, web3 fields if present).

Use this after \`get_issue\` to see actual exception details — the issue row only
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

  get_org_usage: {
    name: 'get_org_usage',
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

  create_project: {
    name: 'create_project',
    description: `Create a new project under an org. The response carries both the project metadata
AND the auto-generated first DSN inline (full \`arguslog://…\` string, visible exactly once —
SDK config goes here). No follow-up call needed; \`list_dsns\` returns metadata only.

Method: POST /api/v1/orgs/{orgId}/projects

Required: \`orgId\`, \`body.name\` (2-100 chars), \`body.platform\` (one of: javascript, react,
vue, angular, nextjs, react-native, node, java-spring, python).

Example: \`{ "orgId": 42, "body": { "name": "Marketing Web", "platform": "react" } }\`
Response shape: \`{ project: {...}, dsn: { dsn: "arguslog://...", dsnPublic, ... } }\``,
    method: 'POST',
    path: '/api/v1/orgs/{orgId}/projects',
    pathParams: [{ name: 'orgId', required: true, type: 'integer' }],
    queryParams: [],
    hasBody: true,
  },

  create_release: {
    name: 'create_release',
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

  list_alert_rules: {
    name: 'list_alert_rules',
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

  list_alert_destinations: {
    name: 'list_alert_destinations',
    description: `List the alert destinations configured on an org (Telegram, Slack, email,
generic webhook). Destination IDs are referenced from alert rules.

Method: GET /api/v1/orgs/{orgId}/alert-destinations`,
    method: 'GET',
    path: '/api/v1/orgs/{orgId}/alert-destinations',
    pathParams: [{ name: 'orgId', required: true, type: 'integer' }],
    queryParams: [],
    hasBody: false,
  },

  list_members: {
    name: 'list_members',
    description: `List members of an org with their roles (owner / admin / member) and join dates.

Method: GET /api/v1/orgs/{orgId}/members`,
    method: 'GET',
    path: '/api/v1/orgs/{orgId}/members',
    pathParams: [{ name: 'orgId', required: true, type: 'integer' }],
    queryParams: [],
    hasBody: false,
  },

  invite_member: {
    name: 'invite_member',
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

  list_dsns: {
    name: 'list_dsns',
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

  list_billing_plans: {
    name: 'list_billing_plans',
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

  grant_bonus_plan: {
    name: 'grant_bonus_plan',
    description: `[Platform admin only] Comp a paid plan to a specific organization. Delegates to
the org's primary owner under the hood — billing identity is per-user (V27+), so this just
finds the owner and writes their \`users.plan\` + \`bonus_until\`. Prefer \`grant_user_bonus\`
when you already have the userId; this org-scoped variant stays for legacy callers.

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

  grant_user_bonus: {
    name: 'grant_user_bonus',
    description: `[Platform admin only] Comp a paid plan directly to a user (V27+ direct surface).
Per-user billing means the bonus tier automatically covers every org that user owns — no
need to think about which org to apply it to. Writes \`users.plan\` and \`bonus_until\`, and
appends an audit-log entry with target_type=user.

Required: \`userId\` (UUID from list_admin_users), \`body.tier\` (\`starter\` | \`pro\` |
\`business\`), \`body.months\` (1, 3, 6, or 12), \`body.reason\` (free text).

Method: POST /api/v1/admin/users/{userId}/grant

Example: \`{ "userId": "11111111-1111-1111-1111-111111111111", "body": { "tier": "pro",
"months": 3, "reason": "Beta tester" } }\``,
    method: 'POST',
    path: '/api/v1/admin/users/{userId}/grant',
    pathParams: [{ name: 'userId', required: true, type: 'string' }],
    queryParams: [],
    hasBody: true,
  },

  get_me: {
    name: 'get_me',
    description: `Get the authenticated user's identity + billing state. Returns \`userId\`,
\`email\`, \`displayName\`, \`isPlatformAdmin\`, \`plan\` (the user's effective tier), and
billing timestamps \`planRenewsAt\`, \`paymentGraceUntil\`, \`bonusUntil\`, \`bonusReason\`.

Use to answer "what plan am I on" or "when does my subscription renew" without picking an org —
post-V27, billing identity lives on the user, not on individual orgs.

Method: GET /api/v1/me`,
    method: 'GET',
    path: '/api/v1/me',
    pathParams: [],
    queryParams: [],
    hasBody: false,
  },

  start_me_checkout: {
    name: 'start_me_checkout',
    description: `Start a Stripe Checkout session for the authenticated user (V27+ user-scoped
billing). Backend resolves the user's primary owned org under the hood; the returned URL is the
hosted Stripe Checkout page — redirect / open in browser.

Method: POST /api/v1/me/billing/checkout-session

Optional query: \`interval\` (\`monthly\` | \`annual\`). Defaults to monthly.

Example return: \`{ "url": "https://checkout.stripe.com/c/..." }\``,
    method: 'POST',
    path: '/api/v1/me/billing/checkout-session',
    pathParams: [],
    queryParams: [{ name: 'interval', required: false, type: 'string' }],
    hasBody: false,
  },

  open_me_portal: {
    name: 'open_me_portal',
    description: `Open the Stripe Customer Portal for the authenticated user — manage card,
download invoices, cancel subscription. Returns the portal URL; valid for ~30s on Stripe's side.

Method: POST /api/v1/me/billing/portal

Example return: \`{ "url": "https://billing.stripe.com/p/..." }\``,
    method: 'POST',
    path: '/api/v1/me/billing/portal',
    pathParams: [],
    queryParams: [],
    hasBody: false,
  },

  start_me_crypto_checkout: {
    name: 'start_me_crypto_checkout',
    description: `Start a NOWPayments crypto invoice for the authenticated user — alternative to
the card flow. Returns a hosted NOWPayments URL the user opens to pick a coin and pay.

Method: POST /api/v1/me/billing/crypto-invoice

Required query: \`tier\` (\`starter\` | \`pro\` | \`business\`), \`duration\` (\`1\` | \`3\` |
\`6\` | \`12\` months).

Example return: \`{ "checkoutUrl": "https://nowpayments.io/...", "invoiceReference": "inv_..." }\``,
    method: 'POST',
    path: '/api/v1/me/billing/crypto-invoice',
    pathParams: [],
    queryParams: [
      { name: 'tier', required: true, type: 'string' },
      { name: 'duration', required: true, type: 'integer' },
    ],
    hasBody: false,
  },
};
