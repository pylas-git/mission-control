/**
 * Better Auth instance for ESCP (Phase 2 of the migration plan).
 *
 * - Single SSO provider: Microsoft Entra ID (OIDC) via `genericOAuth`.
 * - Single Endava tenant — pinned via `MS_ENTRA_TENANT_ID`.
 * - Invite-only access enforced in the `databaseHooks.user.create.before`
 *   hook: sign-in is rejected unless the email matches a pending
 *   `escp_invitations` row (or an existing linked user).
 * - Session: 8h sliding (refreshed every 1h on use). Microsoft refresh
 *   tokens are stored in better-auth's `account` table for re-auth.
 *
 * Mounted at /api/auth/v2/* via src/app/api/auth/v2/[...all]/route.ts when
 * AUTH_V2 feature flag is enabled.
 */

import { betterAuth } from 'better-auth'
import { genericOAuth, microsoftEntraId } from 'better-auth/plugins/generic-oauth'
import { getDatabase } from './db'
import { logger } from './logger'
import { logSecurityEvent } from './security-events'
import { createHash } from 'crypto'

const ENDAVA_EMAIL_DOMAIN = '@endava.com'

interface InvitationRow {
  id: number
  email: string
  role: string
  region_id: number | null
  intended_project_ids: string | null
  expires_at: number
  invited_by: number
}

interface UserLinkRow {
  id: number
  is_approved: number | null
}

interface CountRow {
  count: number
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function findPendingInvitationByEmail(email: string): InvitationRow | null {
  try {
    const db = getDatabase()
    const row = db.prepare(`
      SELECT id, email, role, region_id, intended_project_ids, expires_at, invited_by
      FROM escp_invitations
      WHERE lower(email) = lower(?)
        AND accepted_at IS NULL
        AND revoked_at IS NULL
        AND expires_at > ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(email, nowSeconds()) as InvitationRow | undefined
    return row || null
  } catch {
    return null
  }
}

function findExistingLinkedUser(email: string): UserLinkRow | null {
  try {
    const db = getDatabase()
    const row = db.prepare(`
      SELECT id, is_approved FROM users WHERE lower(email) = lower(?) LIMIT 1
    `).get(email) as UserLinkRow | undefined
    return row || null
  } catch {
    return null
  }
}

function hasAnyLocalUsers(): boolean {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT COUNT(*) as count FROM users').get() as CountRow
    return row.count > 0
  } catch {
    return true
  }
}

function hasUsersRegionColumn(db: ReturnType<typeof getDatabase>): boolean {
  try {
    const cols = db.prepare('PRAGMA table_info(users)').all() as Array<{ name?: string }>
    return cols.some(c => c.name === 'region_id')
  } catch {
    return false
  }
}

function applyInvitationToExistingUser(params: { userId: number; invitation: InvitationRow }): boolean {
  try {
    const db = getDatabase()
    const now = nowSeconds()

    const current = db.prepare('SELECT role FROM users WHERE id = ? LIMIT 1').get(params.userId) as { role?: string } | undefined
    if (!current) return false

    const effectiveRole = current.role === 'admin' ? 'admin' : params.invitation.role
    if (hasUsersRegionColumn(db)) {
      db.prepare('UPDATE users SET role = ?, region_id = ?, updated_at = ? WHERE id = ?').run(
        effectiveRole,
        params.invitation.region_id,
        now,
        params.userId,
      )
    } else {
      db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(
        effectiveRole,
        now,
        params.userId,
      )
    }

    db.prepare(`
      UPDATE escp_invitations
      SET accepted_at = ?, accepted_user_id = ?
      WHERE id = ?
    `).run(now, params.userId, params.invitation.id)

    if (params.invitation.intended_project_ids) {
      try {
        const ids = JSON.parse(params.invitation.intended_project_ids) as unknown
        if (Array.isArray(ids)) {
          const insert = db.prepare(`
            INSERT OR IGNORE INTO escp_project_champions (project_id, user_id, assigned_by, assigned_at)
            VALUES (?, ?, ?, ?)
          `)
          for (const pid of ids) {
            const projectId = Number(pid)
            if (Number.isFinite(projectId)) {
              insert.run(projectId, params.userId, params.invitation.invited_by, now)
            }
          }
        }
      } catch {
        // ignore malformed project JSON
      }
    }

    return true
  } catch (err) {
    logger.error({ err }, 'Failed to apply invitation to existing user')
    return false
  }
}

function provisionLocalUserFromInvitation(params: {
  email: string
  displayName: string
  invitation: InvitationRow
  entraObjectId: string | null
  entraTenantId: string | null
}): number | null {
  try {
    const db = getDatabase()
    const now = nowSeconds()
    // Username derived from email local part; fall back to entra OID if collision.
    const baseUsername = params.email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '')
    let username = baseUsername || `user-${params.invitation.id}`
    const exists = db.prepare(`SELECT 1 as ok FROM users WHERE username = ?`).get(username) as { ok?: number } | undefined
    if (exists?.ok && params.entraObjectId) {
      username = `${baseUsername}-${params.entraObjectId.slice(0, 6)}`
    }

    const result = db.prepare(`
      INSERT INTO users (
        username, display_name, password_hash, role, provider, provider_user_id,
        email, is_approved, approved_by, approved_at,
        entra_object_id, entra_tenant_id, region_id,
        workspace_id, created_at, updated_at
      ) VALUES (?, ?, '', ?, 'microsoft', ?, ?, 1, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      username,
      params.displayName,
      params.invitation.role,
      params.entraObjectId,
      params.email,
      `invitation:${params.invitation.id}`,
      now,
      params.entraObjectId,
      params.entraTenantId,
      params.invitation.region_id,
      now,
      now,
    )

    db.prepare(`
      UPDATE escp_invitations
      SET accepted_at = ?, accepted_user_id = ?
      WHERE id = ?
    `).run(now, Number(result.lastInsertRowid), params.invitation.id)

    // Optional project assignments
    if (params.invitation.intended_project_ids) {
      try {
        const ids = JSON.parse(params.invitation.intended_project_ids) as unknown
        if (Array.isArray(ids)) {
          const insert = db.prepare(`
            INSERT OR IGNORE INTO escp_project_champions (project_id, user_id, assigned_by, assigned_at)
            VALUES (?, ?, ?, ?)
          `)
          for (const pid of ids) {
            const projectId = Number(pid)
            if (Number.isFinite(projectId)) {
              insert.run(projectId, Number(result.lastInsertRowid), params.invitation.invited_by, now)
            }
          }
        }
      } catch { /* invalid JSON, ignore */ }
    }

    return Number(result.lastInsertRowid)
  } catch (err) {
    logger.error({ err }, 'Failed to provision user from invitation')
    return null
  }
}

function provisionBootstrapAdminFromMicrosoft(params: {
  email: string
  displayName: string
  entraObjectId: string | null
  entraTenantId: string | null
}): number | null {
  try {
    const db = getDatabase()
    const now = nowSeconds()
    const baseUsername = params.email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '')
    let username = baseUsername || 'admin'
    const exists = db.prepare(`SELECT 1 as ok FROM users WHERE username = ?`).get(username) as { ok?: number } | undefined
    if (exists?.ok && params.entraObjectId) {
      username = `${baseUsername || 'admin'}-${params.entraObjectId.slice(0, 6)}`
    }

    const result = db.prepare(`
      INSERT INTO users (
        username, display_name, password_hash, role, provider, provider_user_id,
        email, is_approved, approved_by, approved_at,
        entra_object_id, entra_tenant_id,
        workspace_id, created_at, updated_at
      ) VALUES (?, ?, '', 'admin', 'microsoft', ?, ?, 1, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      username,
      params.displayName,
      params.entraObjectId,
      params.email,
      'bootstrap:microsoft-first-user',
      now,
      params.entraObjectId,
      params.entraTenantId,
      now,
      now,
    )

    return Number(result.lastInsertRowid)
  } catch (err) {
    logger.error({ err }, 'Failed to provision bootstrap admin from Microsoft')
    return null
  }
}

const tenantId = (process.env.MS_ENTRA_TENANT_ID || '').trim()
const clientId = (process.env.MS_ENTRA_CLIENT_ID || '').trim()
const clientSecret = (process.env.MS_ENTRA_CLIENT_SECRET || '').trim()

/**
 * When AUTH_V2_MOCK_ISSUER is set (e.g. http://localhost:4011) the server
 * substitutes the real Microsoft Entra endpoints with a local OIDC mock so
 * you can test the full sign-in flow without a real Entra tenant.
 *
 * Run the mock server first:  node scripts/dev-oidc-server.cjs
 */
const mockIssuer = (process.env.AUTH_V2_MOCK_ISSUER || '').trim()

function buildOAuthConfig(): Parameters<typeof genericOAuth>[0]['config'] {
  if (mockIssuer) {
    logger.warn(
      { mockIssuer },
      '[AUTH_V2] Using local OIDC mock — NEVER enable AUTH_V2_MOCK_ISSUER in production',
    )
    return [
      {
        providerId: 'microsoft-entra-id',
        authorizationUrl: `${mockIssuer}/authorize`,
        tokenUrl: `${mockIssuer}/token`,
        userInfoUrl: `${mockIssuer}/userinfo`,
        clientId: clientId || 'test-client',
        clientSecret: clientSecret || 'test-secret',
        scopes: ['openid', 'profile', 'email'],
      },
    ]
  }
  return [
    microsoftEntraId({
      clientId,
      clientSecret,
      tenantId,
      scopes: ['openid', 'profile', 'email', 'offline_access', 'User.Read'],
    }),
  ]
}

function buildAuth() {
  const baseURL = (process.env.AUTH_V2_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000').trim()
  return betterAuth({
    database: getDatabase(),
    baseURL,
    basePath: '/api/auth/v2',
    secret: process.env.AUTH_SECRET,
    session: {
      // 8h absolute lifetime, refreshed sliding-window every 1h of activity.
      expiresIn: 8 * 60 * 60,
      updateAge: 60 * 60,
    },
    // Email/password disabled: Microsoft SSO only.
    emailAndPassword: { enabled: false },
    plugins: [
      genericOAuth({
        config: buildOAuthConfig(),
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          // Invite-only gate. Runs once, the first time Microsoft SSO returns
          // a profile we've never seen before. If we reject here, better-auth
          // aborts the sign-in cleanly.
          before: async (user) => {
            const email = String(user.email || '').toLowerCase().trim()
            if (!email) {
              logSafe('invite_gate_reject', { reason: 'no_email' })
              return false
            }
            if (!email.endsWith(ENDAVA_EMAIL_DOMAIN)) {
              logSafe('invite_gate_reject', { email, reason: 'wrong_domain' })
              return false
            }

            // Allow if a `users` row already exists for this email (e.g. the
            // local bootstrap admin re-linking via SSO, or a previously
            // provisioned user signing in from a new device).
            const existing = findExistingLinkedUser(email)
            if (existing) {
              if ((existing.is_approved ?? 1) !== 1) {
                logSafe('invite_gate_reject', { email, reason: 'user_disabled' })
                return false
              }
              return true
            }

            const invite = findPendingInvitationByEmail(email)
            if (invite) {
              return true
            }

            if (!hasAnyLocalUsers()) {
              logSafe('bootstrap_gate_allow', { email, reason: 'first_user_admin' })
              return true
            }

            // Dev bypass: allow mock OIDC users to sign in without invitation
            if (mockIssuer) {
              logSafe('invite_gate_bypass_dev', { email, reason: 'mock_oidc_dev' })
              return true
            }

            if (!invite) {
              logSafe('invite_gate_reject', { email, reason: 'no_invitation' })
              return false
            }

            return true
          },
          after: async (user) => {
            const email = String(user.email || '').toLowerCase().trim()
            if (!email) return
            const existing = findExistingLinkedUser(email)
            if (existing) {
              const invite = findPendingInvitationByEmail(email)
              if (invite) {
                const applied = applyInvitationToExistingUser({ userId: existing.id, invitation: invite })
                logSafe('invite_reconciled_existing_user', {
                  email,
                  invitationId: invite.id,
                  localUserId: existing.id,
                  applied,
                })
              }
              return
            }

            const invite = findPendingInvitationByEmail(email)
            if (!invite && !mockIssuer) return

            // Pull entra OID from the linked account row (added by genericOAuth).
            let entraObjectId: string | null = null
            try {
              const db = getDatabase()
              const acct = db.prepare(`
                SELECT accountId FROM account
                WHERE userId = ? AND providerId = 'microsoft-entra-id'
                LIMIT 1
              `).get(String((user as { id?: string }).id || '')) as { accountId?: string } | undefined
              entraObjectId = acct?.accountId || null
            } catch { /* table not migrated yet */ }

            if (invite) {
              const userId = provisionLocalUserFromInvitation({
                email,
                displayName: String((user as { name?: string }).name || email),
                invitation: invite,
                entraObjectId,
                entraTenantId: tenantId,
              })

              logSafe('invite_accepted', {
                email,
                invitationId: invite.id,
                localUserId: userId,
              })
              return
            }

            // Dev mode: provision mock OIDC user as admin
            if (mockIssuer && !invite) {
              const userId = provisionBootstrapAdminFromMicrosoft({
                email,
                displayName: String((user as { name?: string }).name || email),
                entraObjectId,
                entraTenantId: tenantId,
              })
              logSafe('mock_oidc_admin_created', {
                email,
                localUserId: userId,
              })
              return
            }

            if (!hasAnyLocalUsers()) {
              const userId = provisionBootstrapAdminFromMicrosoft({
                email,
                displayName: String((user as { name?: string }).name || email),
                entraObjectId,
                entraTenantId: tenantId,
              })
              logSafe('bootstrap_admin_created', {
                email,
                localUserId: userId,
              })
            }
          },
        },
      },
    },
  })
}

let _instance: ReturnType<typeof buildAuth> | null = null

/**
 * Lazily build the Better Auth instance.
 * Throws if Entra env vars are missing (only when AUTH_V2 is enabled).
 */
export function getAuthV2(): ReturnType<typeof buildAuth> {
  if (_instance) return _instance
  if (!mockIssuer && (!tenantId || !clientId || !clientSecret)) {
    throw new Error(
      'AUTH_V2 is enabled but Microsoft Entra env vars are missing. ' +
      'Set MS_ENTRA_TENANT_ID, MS_ENTRA_CLIENT_ID, MS_ENTRA_CLIENT_SECRET. ' +
      'For local testing without a real tenant, set AUTH_V2_MOCK_ISSUER=http://localhost:4011 ' +
      'and run: node scripts/dev-oidc-server.cjs'
    )
  }
  _instance = buildAuth()
  return _instance
}

function logSafe(eventType: string, detail: Record<string, unknown>): void {
  try {
    logSecurityEvent({
      event_type: eventType,
      severity: eventType.endsWith('_reject') ? 'warning' : 'info',
      source: 'auth_v2',
      detail: JSON.stringify(detail),
      workspace_id: 1,
      tenant_id: 1,
    })
  } catch { /* startup race */ }
}

/**
 * Hash a raw invitation token for storage.
 * Tokens are randomly generated (32 bytes hex), shown once at creation,
 * stored only as sha256 to prevent replay if the DB is leaked.
 */
export function hashInvitationToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}
