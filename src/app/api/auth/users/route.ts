import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, getAllUsers, createUser, updateUser, deleteUser, getUserById } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { validateBody, createUserSchema } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getUserRegionId, normalizeRole } from '@/lib/authz'
import { getDatabase } from '@/lib/db'

function hasUsersRegionColumn(db: ReturnType<typeof getDatabase>): boolean {
  try {
    const cols = db.prepare('PRAGMA table_info(users)').all() as Array<{ name?: string }>
    return cols.some(c => c.name === 'region_id')
  } catch {
    return false
  }
}

function getUserRegionMap(db: ReturnType<typeof getDatabase>, userIds: number[]) {
  const out = new Map<number, { region_id: number | null; region_name: string | null }>()
  if (!userIds.length || !hasUsersRegionColumn(db)) return out
  const placeholders = userIds.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT u.id as user_id, u.region_id as region_id, r.name as region_name
    FROM users u
    LEFT JOIN escp_regions r ON r.id = u.region_id
    WHERE u.id IN (${placeholders})
  `).all(...userIds) as Array<{ user_id: number; region_id: number | null; region_name: string | null }>
  for (const row of rows) {
    out.set(row.user_id, { region_id: row.region_id, region_name: row.region_name })
  }
  return out
}

/**
 * GET /api/auth/users - List workspace users for ESCP managers.
 */
export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request)
  const actorRole = normalizeRole(user?.role)
  if (!user || actorRole === 'security_champion') {
    return NextResponse.json({ error: 'Champion management access required' }, { status: 403 })
  }

  const users = getAllUsers()
  const workspaceId = user.workspace_id ?? 1
  const db = getDatabase()
  const scopedUsers = users.filter((u) => (u.workspace_id ?? 1) === workspaceId)
  const regionMap = getUserRegionMap(db, scopedUsers.map(u => u.id))
  return NextResponse.json({
    users: scopedUsers.map((u) => {
      const region = regionMap.get(u.id)
      return {
        ...u,
        role: normalizeRole(u.role),
        region_id: region?.region_id ?? null,
        region_name: region?.region_name ?? null,
      }
    }),
  })
}

/**
 * POST /api/auth/users - Create a new user (admin only)
 */
export async function POST(request: NextRequest) {
  const currentUser = getUserFromRequest(request)
  if (!currentUser || currentUser.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const result = await validateBody(request, createUserSchema)
    if ('error' in result) return result.error
    const { username, password, display_name, role, provider, email } = result.data

    const workspaceId = currentUser.workspace_id ?? 1
    const newUser = createUser(username, password, display_name || username, role, {
      provider,
      email: email || null,
      workspace_id: workspaceId,
    })

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    logAuditEvent({
      action: 'user_create', actor: currentUser.username, actor_id: currentUser.id,
      target_type: 'user', target_id: newUser.id,
      detail: { username, role, provider, email }, ip_address: ipAddress,
    })

    return NextResponse.json({
      user: {
        id: newUser.id,
        username: newUser.username,
        display_name: newUser.display_name,
        role: newUser.role,
        provider: newUser.provider || 'local',
        email: newUser.email || null,
        avatar_url: newUser.avatar_url || null,
        is_approved: newUser.is_approved ?? 1,
        workspace_id: newUser.workspace_id ?? 1,
        tenant_id: newUser.tenant_id ?? 1,
      }
    }, { status: 201 })
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint failed')) {
      return NextResponse.json({ error: 'Username already exists' }, { status: 409 })
    }
    logger.error({ err: error }, 'POST /api/auth/users error')
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
  }
}

/**
 * PUT /api/auth/users - Update a user (scoped by ESCP role)
 */
export async function PUT(request: NextRequest) {
  const currentUser = getUserFromRequest(request)
  const actorRole = normalizeRole(currentUser?.role)
  if (!currentUser || actorRole === 'security_champion') {
    return NextResponse.json({ error: 'Champion management access required' }, { status: 403 })
  }

  try {
    const { id, display_name, role, password, is_approved, email, avatar_url, region_id } = await request.json()
    const userId = parseInt(String(id))

    if (!id || Number.isNaN(userId)) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    if (role && !['admin', 'global_champion', 'regional_champion', 'security_champion'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    if (region_id !== undefined && region_id !== null) {
      const parsedRegionId = Number(region_id)
      if (!Number.isInteger(parsedRegionId) || parsedRegionId <= 0) {
        return NextResponse.json({ error: 'Invalid region_id' }, { status: 400 })
      }
    }

    const workspaceId = currentUser.workspace_id ?? 1
    const existing = getUserById(userId)
    if (!existing || (existing.workspace_id ?? 1) !== workspaceId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const db = getDatabase()
    const existingRegionMeta = getUserRegionMap(db, [userId]).get(userId)
    const existingRole = normalizeRole(existing.role)
    const actorRegionId = actorRole === 'regional_champion' ? getUserRegionId(currentUser.id) : null

    if (display_name !== undefined) {
      if (actorRole !== 'admin') {
        return NextResponse.json({ error: 'Only admins can change display names' }, { status: 403 })
      }
      if (typeof display_name !== 'string' || !display_name.trim()) {
        return NextResponse.json({ error: 'Display name cannot be empty' }, { status: 400 })
      }
    }

    // Prevent changing your own role.
    if (userId === currentUser.id && role && role !== normalizeRole(currentUser.role)) {
      return NextResponse.json({ error: 'Cannot change your own role' }, { status: 400 })
    }

    if (actorRole === 'global_champion') {
      if (existingRole === 'admin') {
        return NextResponse.json({ error: 'Global champions cannot manage admins' }, { status: 403 })
      }
      if (role === 'admin') {
        return NextResponse.json({ error: 'Global champions cannot assign admin role' }, { status: 403 })
      }
    }

    if (actorRole === 'regional_champion') {
      if (!actorRegionId || existingRegionMeta?.region_id !== actorRegionId) {
        return NextResponse.json({ error: 'Regional champions can only manage users in their own region' }, { status: 403 })
      }
      if (existingRole !== 'security_champion') {
        return NextResponse.json({ error: 'Regional champions can only manage security champions' }, { status: 403 })
      }
      if (role && role !== 'security_champion') {
        return NextResponse.json({ error: 'Regional champions can only assign the security_champion role' }, { status: 403 })
      }
      if (region_id !== undefined && Number(region_id) !== actorRegionId) {
        return NextResponse.json({ error: 'Regional champions can only keep users in their own region' }, { status: 403 })
      }
    }

    const updated = updateUser(userId, { display_name, role, password: password || undefined, is_approved, email, avatar_url })
    if (!updated) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (region_id !== undefined) {
      if (!hasUsersRegionColumn(db)) {
        return NextResponse.json({ error: 'Region assignment is not supported by this database schema' }, { status: 400 })
      }
      if (region_id !== null) {
        const regionExists = db.prepare('SELECT 1 as ok FROM escp_regions WHERE id = ? LIMIT 1').get(Number(region_id)) as { ok?: number } | undefined
        if (!regionExists?.ok) {
          return NextResponse.json({ error: 'Region not found' }, { status: 404 })
        }
      }
      db.prepare('UPDATE users SET region_id = ? WHERE id = ?').run(region_id === null ? null : Number(region_id), userId)
    }

    const regionMeta = getUserRegionMap(db, [updated.id]).get(updated.id)

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    logAuditEvent({
      action: 'user_update', actor: currentUser.username, actor_id: currentUser.id,
      target_type: 'user', target_id: userId,
      detail: { display_name, role, password_changed: !!password, is_approved }, ip_address: ipAddress,
    })

    return NextResponse.json({
      user: {
        id: updated.id,
        username: updated.username,
        display_name: updated.display_name,
        role: normalizeRole(updated.role),
        region_id: regionMeta?.region_id ?? null,
        region_name: regionMeta?.region_name ?? null,
        provider: updated.provider || 'local',
        email: updated.email || null,
        avatar_url: updated.avatar_url || null,
        is_approved: updated.is_approved ?? 1,
        workspace_id: updated.workspace_id ?? 1,
        tenant_id: updated.tenant_id ?? 1,
      }
    })
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/auth/users error')
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
  }
}

/**
 * DELETE /api/auth/users - Delete a user (admin only)
 */
export async function DELETE(request: NextRequest) {
  const currentUser = getUserFromRequest(request)
  if (!currentUser || currentUser.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Request body required' }, { status: 400 }) }
  const id = body.id

  if (!id) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
  }

  const userId = parseInt(id)

  // Prevent deleting yourself
  if (userId === currentUser.id) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })
  }

  const workspaceId = currentUser.workspace_id ?? 1
  const existing = getUserById(userId)
  if (!existing || (existing.workspace_id ?? 1) !== workspaceId) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const deleted = deleteUser(userId)
  if (!deleted) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
  logAuditEvent({
    action: 'user_delete', actor: currentUser.username, actor_id: currentUser.id,
    target_type: 'user', target_id: userId,
    ip_address: ipAddress,
  })

  return NextResponse.json({ success: true })
}
