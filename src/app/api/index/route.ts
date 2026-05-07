import { NextResponse } from 'next/server'

const VERSION = '1.3.0'
export const revalidate = 300

interface Endpoint {
  path: string
  methods: string[]
  description: string
  tag: string
  auth: string
}

const endpoints: Endpoint[] = [
  // ── Tasks ─────────────────────────────────────────
  { path: '/api/tasks', methods: ['GET', 'POST'], description: 'Task CRUD — list, create', tag: 'Tasks', auth: 'viewer/operator' },
  { path: '/api/tasks/:id', methods: ['GET', 'PATCH', 'DELETE'], description: 'Task detail — read, update, delete', tag: 'Tasks', auth: 'viewer/operator/admin' },
  { path: '/api/tasks/:id/comments', methods: ['GET', 'POST'], description: 'Task comments — list, add', tag: 'Tasks', auth: 'viewer/operator' },
  { path: '/api/tasks/:id/broadcast', methods: ['POST'], description: 'Broadcast task update via SSE', tag: 'Tasks', auth: 'operator' },
  { path: '/api/tasks/queue', methods: ['GET'], description: 'Task queue — next assignable tasks', tag: 'Tasks', auth: 'viewer' },
  { path: '/api/tasks/outcomes', methods: ['GET'], description: 'Task outcome analytics', tag: 'Tasks', auth: 'viewer' },
  { path: '/api/tasks/regression', methods: ['GET'], description: 'Task regression detection', tag: 'Tasks', auth: 'viewer' },

  // ── Projects ──────────────────────────────────────
  { path: '/api/workspaces', methods: ['GET'], description: 'Tenant-scoped workspace listing', tag: 'Projects', auth: 'viewer' },

  // ── Agents ────────────────────────────────────────
  { path: '/api/agents', methods: ['GET', 'POST'], description: 'Agent CRUD — list, register', tag: 'Agents', auth: 'viewer/operator' },
  { path: '/api/agents/:id', methods: ['GET', 'PATCH', 'DELETE'], description: 'Agent detail — read, update, delete', tag: 'Agents', auth: 'viewer/operator/admin' },
  { path: '/api/agents/:id/heartbeat', methods: ['POST'], description: 'Agent heartbeat ping', tag: 'Agents', auth: 'operator' },
  { path: '/api/agents/:id/wake', methods: ['POST'], description: 'Wake idle agent', tag: 'Agents', auth: 'operator' },
  { path: '/api/agents/:id/soul', methods: ['GET', 'PUT'], description: 'Agent soul file — read, write', tag: 'Agents', auth: 'viewer/operator' },
  { path: '/api/agents/:id/memory', methods: ['GET'], description: 'Agent memory files', tag: 'Agents', auth: 'viewer' },
  { path: '/api/agents/:id/files', methods: ['GET'], description: 'Agent workspace files', tag: 'Agents', auth: 'viewer' },
  { path: '/api/agents/:id/diagnostics', methods: ['GET'], description: 'Agent diagnostics', tag: 'Agents', auth: 'viewer' },
  { path: '/api/agents/:id/attribution', methods: ['GET'], description: 'Agent token usage attribution', tag: 'Agents', auth: 'viewer' },
  { path: '/api/agents/sync', methods: ['POST'], description: 'Sync agents from gateway sessions', tag: 'Agents', auth: 'operator' },
  { path: '/api/agents/comms', methods: ['GET'], description: 'Agent communication feed', tag: 'Agents', auth: 'viewer' },
  { path: '/api/agents/message', methods: ['POST'], description: 'Send message to agent', tag: 'Agents', auth: 'operator' },

  // ── Chat ──────────────────────────────────────────
  { path: '/api/chat/messages', methods: ['GET', 'POST'], description: 'Chat messages — list, send', tag: 'Chat', auth: 'viewer/operator' },
  { path: '/api/chat/messages/:id', methods: ['PATCH'], description: 'Mark chat message read', tag: 'Chat', auth: 'operator' },
  { path: '/api/chat/conversations', methods: ['GET'], description: 'List conversations', tag: 'Chat', auth: 'viewer' },
  { path: '/api/chat/session-prefs', methods: ['GET', 'PATCH'], description: 'Local session chat preferences (rename + color)', tag: 'Chat', auth: 'viewer/operator' },

  // ── Sessions ──────────────────────────────────────
  { path: '/api/sessions', methods: ['GET', 'POST', 'DELETE'], description: 'List and control gateway/local runtime sessions', tag: 'Sessions', auth: 'viewer/operator' },
  { path: '/api/sessions/:id/control', methods: ['POST'], description: 'Session control (stop, message)', tag: 'Sessions', auth: 'operator' },
  { path: '/api/sessions/continue', methods: ['POST'], description: 'Continue a local Claude/Codex/OpenCode session with a prompt', tag: 'Sessions', auth: 'operator' },
  { path: '/api/sessions/transcript', methods: ['GET'], description: 'Read local Claude/Codex/Hermes/OpenCode session transcript snippets', tag: 'Sessions', auth: 'viewer' },
  { path: '/api/claude/sessions', methods: ['GET'], description: 'Claude CLI session scanner', tag: 'Sessions', auth: 'viewer' },

  // ── Activities & Notifications ────────────────────
  { path: '/api/activities', methods: ['GET'], description: 'Activity feed', tag: 'Activities', auth: 'viewer' },
  { path: '/api/notifications', methods: ['GET', 'PATCH'], description: 'Notifications — list, mark read', tag: 'Notifications', auth: 'viewer/operator' },
  { path: '/api/notifications/deliver', methods: ['POST'], description: 'Deliver notification', tag: 'Notifications', auth: 'operator' },

  // ── Quality & Standup ─────────────────────────────
  { path: '/api/quality-review', methods: ['GET', 'POST'], description: 'Quality review gate', tag: 'Quality', auth: 'viewer/operator' },
  { path: '/api/standup', methods: ['GET', 'POST'], description: 'Daily standup reports', tag: 'Standup', auth: 'viewer/operator' },

  // ── Workflows & Pipelines ─────────────────────────
  { path: '/api/workflows', methods: ['GET', 'POST', 'PUT', 'DELETE'], description: 'Workflow templates CRUD', tag: 'Workflows', auth: 'viewer/operator' },
  { path: '/api/pipelines', methods: ['GET', 'POST', 'DELETE'], description: 'Pipeline CRUD', tag: 'Pipelines', auth: 'viewer/operator' },
  { path: '/api/pipelines/run', methods: ['POST'], description: 'Execute pipeline', tag: 'Pipelines', auth: 'operator' },

  // ── Webhooks ──────────────────────────────────────
  { path: '/api/webhooks', methods: ['GET', 'POST', 'PATCH', 'DELETE'], description: 'Webhook CRUD', tag: 'Webhooks', auth: 'viewer/operator' },
  { path: '/api/webhooks/deliveries', methods: ['GET'], description: 'Webhook delivery history', tag: 'Webhooks', auth: 'viewer' },
  { path: '/api/webhooks/retry', methods: ['POST'], description: 'Retry webhook delivery', tag: 'Webhooks', auth: 'operator' },
  { path: '/api/webhooks/test', methods: ['POST'], description: 'Send test webhook', tag: 'Webhooks', auth: 'operator' },
  { path: '/api/webhooks/verify-docs', methods: ['GET'], description: 'Webhook verification docs', tag: 'Webhooks', auth: 'public' },

  // ── Alerts ────────────────────────────────────────
  { path: '/api/alerts', methods: ['GET', 'POST', 'PATCH', 'DELETE'], description: 'Alert rules CRUD', tag: 'Alerts', auth: 'viewer/operator' },

  // ── Auth ──────────────────────────────────────────
  { path: '/api/auth/login', methods: ['POST'], description: 'Local user login (bootstrap admin + break-glass only)', tag: 'Auth', auth: 'public' },
  { path: '/api/auth/logout', methods: ['POST'], description: 'User logout', tag: 'Auth', auth: 'authenticated' },
  { path: '/api/auth/me', methods: ['GET'], description: 'Current user info', tag: 'Auth', auth: 'authenticated' },
  { path: '/api/auth/users', methods: ['GET', 'POST', 'PATCH', 'DELETE'], description: 'User management', tag: 'Auth', auth: 'admin' },
  { path: '/api/auth/v2/*', methods: ['GET', 'POST'], description: 'Better Auth handler (Microsoft Entra SSO; AUTH_V2 flag required)', tag: 'Auth', auth: 'public' },
  { path: '/api/auth/google', methods: ['POST'], description: 'Google OAuth callback (legacy; deprecated by AUTH_V2)', tag: 'Auth', auth: 'public' },
  { path: '/api/auth/access-requests', methods: ['GET', 'PATCH'], description: 'Access request approvals (legacy; deprecated by /api/invitations)', tag: 'Auth', auth: 'admin' },

  // ── Invitations (ESCP) ────────────────────────────
  { path: '/api/invitations', methods: ['GET', 'POST'], description: 'Invitation list and create — invite-only access for SSO sign-ins', tag: 'Invitations', auth: 'admin/global_champion/regional_champion' },
  { path: '/api/invitations/:id', methods: ['DELETE'], description: 'Revoke a pending invitation', tag: 'Invitations', auth: 'admin/global_champion/regional_champion' },

  // ── ESCP Domain (Region → Client → Project) ───────
  { path: '/api/regions', methods: ['GET', 'POST'], description: 'Region CRUD — list, create', tag: 'ESCP', auth: 'authenticated/global_champion' },
  { path: '/api/clients', methods: ['GET', 'POST'], description: 'Client CRUD — list (region-scoped), create', tag: 'ESCP', auth: 'authenticated/regional_champion' },
  { path: '/api/projects', methods: ['GET', 'POST'], description: 'Project CRUD — list (role-scoped), create', tag: 'ESCP', auth: 'authenticated/regional_champion' },
  { path: '/api/projects/:id/champions', methods: ['GET', 'POST', 'DELETE'], description: 'Project champion assignments', tag: 'ESCP', auth: 'authenticated/regional_champion' },

  // ── Tokens & Costs ────────────────────────────────
  { path: '/api/tokens', methods: ['GET', 'POST'], description: 'Token usage tracking', tag: 'Tokens', auth: 'viewer/operator' },

  // ── Cron & Scheduler ──────────────────────────────
  { path: '/api/cron', methods: ['GET', 'POST', 'PATCH', 'DELETE'], description: 'Cron job management', tag: 'Cron', auth: 'viewer/operator' },
  { path: '/api/scheduler', methods: ['POST'], description: 'Scheduler tick (internal)', tag: 'Cron', auth: 'operator' },

  // ── Spawn ─────────────────────────────────────────
  { path: '/api/spawn', methods: ['POST'], description: 'Spawn agent subprocess', tag: 'Spawn', auth: 'operator' },

  // ── Memory ────────────────────────────────────────
  { path: '/api/memory', methods: ['GET', 'POST', 'PUT', 'DELETE'], description: 'Memory browser — list, read, write, delete', tag: 'Memory', auth: 'viewer/operator' },

  // ── Search & Mentions ─────────────────────────────
  { path: '/api/search', methods: ['GET'], description: 'Full-text search across entities', tag: 'Search', auth: 'viewer' },
  { path: '/api/mentions', methods: ['GET'], description: 'Autocomplete for @mentions', tag: 'Search', auth: 'viewer' },

  // ── Logs ──────────────────────────────────────────
  { path: '/api/logs', methods: ['GET'], description: 'Application logs', tag: 'Logs', auth: 'viewer' },

  // ── Settings ──────────────────────────────────────
  { path: '/api/settings', methods: ['GET', 'PATCH'], description: 'System settings', tag: 'Settings', auth: 'viewer/admin' },
  { path: '/api/integrations', methods: ['GET', 'PATCH'], description: 'Integration configuration', tag: 'Settings', auth: 'viewer/admin' },
  { path: '/api/skills', methods: ['GET', 'POST', 'PUT', 'DELETE'], description: 'Installed skills index and disk CRUD', tag: 'Settings', auth: 'viewer/operator' },

  // ── Gateway ───────────────────────────────────────
  { path: '/api/gateways', methods: ['GET', 'POST', 'PATCH', 'DELETE'], description: 'Gateway management', tag: 'Gateway', auth: 'admin' },
  { path: '/api/gateways/connect', methods: ['POST'], description: 'Connect to gateway WebSocket', tag: 'Gateway', auth: 'operator' },
  { path: '/api/gateways/health', methods: ['GET'], description: 'Gateway health check', tag: 'Gateway', auth: 'viewer' },
  { path: '/api/gateway-config', methods: ['GET', 'PATCH'], description: 'Gateway configuration', tag: 'Gateway', auth: 'admin' },
  { path: '/api/connect', methods: ['POST'], description: 'WebSocket connection info', tag: 'Gateway', auth: 'operator' },

  // ── GitHub ────────────────────────────────────────
  { path: '/api/github', methods: ['GET', 'POST'], description: 'GitHub issue sync', tag: 'GitHub', auth: 'viewer/operator' },

  // ── System ────────────────────────────────────────
  { path: '/api/status', methods: ['GET'], description: 'System status & capabilities', tag: 'System', auth: 'public' },
  { path: '/api/audit', methods: ['GET'], description: 'Audit trail', tag: 'System', auth: 'admin' },
  { path: '/api/backup', methods: ['POST'], description: 'Database backup', tag: 'System', auth: 'admin' },
  { path: '/api/cleanup', methods: ['POST'], description: 'Database cleanup', tag: 'System', auth: 'admin' },
  { path: '/api/export', methods: ['GET'], description: 'Data export', tag: 'System', auth: 'viewer' },
  { path: '/api/workload', methods: ['GET'], description: 'Agent workload stats', tag: 'System', auth: 'viewer' },
  { path: '/api/releases/check', methods: ['GET'], description: 'Check for updates', tag: 'System', auth: 'public' },
  { path: '/api/releases/update', methods: ['POST'], description: 'Update Endava Security Champion Program to a specific release tag', tag: 'System', auth: 'admin' },
  { path: '/api/openclaw/version', methods: ['GET'], description: 'Installed OpenClaw version and latest release metadata', tag: 'System', auth: 'public' },
  { path: '/api/openclaw/update', methods: ['POST'], description: 'Update OpenClaw to the latest stable release', tag: 'System', auth: 'admin' },
  { path: '/api/openclaw/doctor', methods: ['GET', 'POST'], description: 'Inspect and fix OpenClaw configuration drift', tag: 'System', auth: 'admin' },

  // ── Local ─────────────────────────────────────────
  { path: '/api/local/flight-deck', methods: ['GET'], description: 'Local flight deck status', tag: 'Local', auth: 'viewer' },
  { path: '/api/local/agents-doc', methods: ['GET'], description: 'Local AGENTS.md discovery and content', tag: 'Local', auth: 'viewer' },
  { path: '/api/local/terminal', methods: ['POST'], description: 'Local terminal command', tag: 'Local', auth: 'admin' },

  // ── Docs ──────────────────────────────────────────
  { path: '/api/docs', methods: ['GET'], description: 'OpenAPI spec (JSON)', tag: 'Docs', auth: 'public' },
  { path: '/api/docs/tree', methods: ['GET'], description: 'Documentation tree', tag: 'Docs', auth: 'public' },
  { path: '/api/docs/content', methods: ['GET'], description: 'Documentation page content', tag: 'Docs', auth: 'public' },
  { path: '/api/docs/search', methods: ['GET'], description: 'Documentation search', tag: 'Docs', auth: 'public' },

  // ── Discovery ─────────────────────────────────────
  { path: '/api/index', methods: ['GET'], description: 'API endpoint catalog (this endpoint)', tag: 'Discovery', auth: 'public' },
]

const payload = {
  version: VERSION,
  generated_at: new Date().toISOString(),
  total_endpoints: endpoints.length,
  endpoints,
  event_stream: {
    path: '/api/events',
    protocol: 'SSE',
    description: 'Real-time server-sent events for tasks, agents, chat, and activity updates',
  },
  docs: {
    openapi: '/api/docs',
    tree: '/api/docs/tree',
    search: '/api/docs/search',
  },
}

export async function GET() {
  return NextResponse.json(payload, {
    headers: {
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  })
}
