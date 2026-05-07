import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, updateUser, destroyAllUserSessions, createSession } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { verifyPassword } from '@/lib/password'
import { getMcSessionCookieName, getMcSessionCookieOptions, isRequestSecure } from '@/lib/session-cookie'
import { passwordChangeLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { isAuthV2Enabled } from '@/lib/feature-flags'
import { getDatabase } from '@/lib/db'

function hasUsersRegionColumn(db: ReturnType<typeof getDatabase>): boolean {
  try {
    const cols = db.prepare('PRAGMA table_info(users)').all() as Array<{ name?: string }>
    return cols.some(c => c.name === 'region_id')
  } catch {
    return false
  }
}

function getRegionNameForUserId(db: ReturnType<typeof getDatabase>, userId: number): string | null {
  try {
    if (!hasUsersRegionColumn(db)) return null
    try {
      const escpRegion = db.prepare(`
        SELECT r.name as region_name
        FROM users u
        LEFT JOIN escp_regions r ON r.id = u.region_id
        WHERE u.id = ?
        LIMIT 1
      `).get(userId) as { region_name?: string | null } | undefined
      return escpRegion?.region_name ?? null
    } catch {
      const legacyRegion = db.prepare(`
        SELECT r.name as region_name
        FROM users u
        LEFT JOIN regions r ON r.id = u.region_id
        WHERE u.id = ?
        LIMIT 1
      `).get(userId) as { region_name?: string | null } | undefined
      return legacyRegion?.region_name ?? null
    }
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const user = getUserFromRequest(request)
  const db = getDatabase()

  if (user) {
    const regionName = getRegionNameForUserId(db, user.id)

    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        provider: user.provider || 'local',
        email: user.email || null,
        avatar_url: user.avatar_url || null,
        workspace_id: user.workspace_id ?? 1,
        tenant_id: user.tenant_id ?? 1,
        region_name: regionName,
      },
    })
  }

  // AUTH_V2 bridge: if Better Auth has a valid session cookie but MC legacy
  // session is missing, map by email and mint the MC session cookie.
  if (isAuthV2Enabled()) {
    try {
      const url = new URL(request.url)
      const sessionRes = await fetch(`${url.origin}/api/auth/v2/get-session`, {
        method: 'GET',
        headers: {
          cookie: request.headers.get('cookie') || '',
        },
      })
      if (sessionRes.ok) {
        const payload = await sessionRes.json() as { user?: { email?: string; name?: string } }
        const email = String(payload?.user?.email || '').toLowerCase().trim()
        if (email) {
          const localUser = db.prepare(`
            SELECT id, username, display_name, role, provider, email, avatar_url,
                   workspace_id
            FROM users
            WHERE lower(email) = lower(?) AND COALESCE(is_approved, 1) = 1
            LIMIT 1
          `).get(email) as {
            id: number
            username: string
            display_name: string
            role: string
            provider: string | null
            email: string | null
            avatar_url: string | null
            workspace_id: number | null
          } | undefined

          if (localUser) {
            const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
            const userAgent = request.headers.get('user-agent') || undefined
            const { token, expiresAt } = createSession(localUser.id, ipAddress, userAgent, localUser.workspace_id ?? 1)
            const isSecureRequest = isRequestSecure(request)
            const cookieName = getMcSessionCookieName(isSecureRequest)

            const response = NextResponse.json({
              user: {
                id: localUser.id,
                username: localUser.username,
                display_name: localUser.display_name,
                role: localUser.role,
                provider: localUser.provider || 'microsoft',
                email: localUser.email || email,
                avatar_url: localUser.avatar_url || null,
                workspace_id: localUser.workspace_id ?? 1,
                tenant_id: 1,
                region_name: getRegionNameForUserId(db, localUser.id),
              },
            })
            response.cookies.set(cookieName, token, {
              ...getMcSessionCookieOptions({
                maxAgeSeconds: expiresAt - Math.floor(Date.now() / 1000),
                isSecureRequest,
              }),
            })
            return response
          }
        }
      }
    } catch (error) {
      logger.warn({ err: error }, 'AUTH_V2 session bridge failed in /api/auth/me')
    }
  }

  return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
}

/**
 * PATCH /api/auth/me - Self-service password change and display name update.
 * Body: { current_password, new_password } and/or { display_name }
 */
export async function PATCH(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // API key users (id=0) cannot change passwords
  if (user.id === 0) {
    return NextResponse.json({ error: 'API key users cannot change passwords' }, { status: 403 })
  }

  try {
    const { current_password, new_password, display_name } = await request.json()

    const updates: { password?: string; display_name?: string } = {}

    // Handle password change
    if (new_password) {
      // Rate-limit password change attempts per user (5/min, separate from login)
      const rateCheck = passwordChangeLimiter(String(user.id))
      if (rateCheck) return rateCheck

      if (!current_password) {
        return NextResponse.json({ error: 'Current password is required' }, { status: 400 })
      }

      if (new_password.length < 12) {
        return NextResponse.json({ error: 'New password must be at least 12 characters' }, { status: 400 })
      }

      // Verify current password by fetching stored hash
      const { getDatabase } = await import('@/lib/db')
      const db = getDatabase()
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as any
      if (!row || !verifyPassword(current_password, row.password_hash)) {
        return NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 })
      }

      updates.password = new_password
    }

    // Handle display name update
    if (display_name !== undefined) {
      if (!display_name.trim()) {
        return NextResponse.json({ error: 'Display name cannot be empty' }, { status: 400 })
      }
      updates.display_name = display_name.trim()
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
    }

    const updated = updateUser(user.id, updates)
    if (!updated) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    const userAgent = request.headers.get('user-agent') || undefined
    if (updates.password) {
      logAuditEvent({ action: 'password_change', actor: user.username, actor_id: user.id, ip_address: ipAddress })
      // Revoke all existing sessions and issue a fresh one for this request
      destroyAllUserSessions(user.id)
    }
    if (updates.display_name) {
      logAuditEvent({ action: 'profile_update', actor: user.username, actor_id: user.id, detail: { display_name: updates.display_name }, ip_address: ipAddress })
    }

    const response = NextResponse.json({
      success: true,
      user: {
        id: updated.id,
        username: updated.username,
        display_name: updated.display_name,
        role: updated.role,
        provider: updated.provider || 'local',
        email: updated.email || null,
        avatar_url: updated.avatar_url || null,
        workspace_id: updated.workspace_id ?? 1,
        tenant_id: updated.tenant_id ?? 1,
      },
    })

    // Issue a fresh session cookie after password change (old ones were just revoked)
    if (updates.password) {
      const { token, expiresAt } = createSession(user.id, ipAddress, userAgent, user.workspace_id ?? 1)
      const isSecureRequest = isRequestSecure(request)
      const cookieName = getMcSessionCookieName(isSecureRequest)
      response.cookies.set(cookieName, token, {
        ...getMcSessionCookieOptions({ maxAgeSeconds: expiresAt - Math.floor(Date.now() / 1000), isSecureRequest }),
      })
    }

    return response
  } catch (error) {
    logger.error({ err: error }, 'PATCH /api/auth/me error')
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}
