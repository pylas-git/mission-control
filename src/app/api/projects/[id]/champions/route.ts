/**
 * Project champions API — list/assign/unassign.
 *
 * GET    /api/projects/[id]/champions — admin/GSC/RSC(own region)/SC(if assigned)
 * POST   /api/projects/[id]/champions — admin/GSC/RSC(own region)
 * DELETE /api/projects/[id]/champions?user_id=X — admin/GSC/RSC(own region)
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { canManageProject, canReadProject, normalizeRole } from '@/lib/authz'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

const assignSchema = z.object({
  user_id: z.number().int().positive(),
})

interface ChampionRow {
  user_id: number
  username: string
  display_name: string
  email: string | null
  role: string
  assigned_by: number | null
  assigned_at: number
}

async function parseProjectId(params: Promise<{ id: string }>): Promise<number | null> {
  const { id } = await params
  const n = Number(id)
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const projectId = await parseProjectId(params)
  if (!projectId) return NextResponse.json({ error: 'Invalid project id' }, { status: 400 })

  if (!canReadProject(user, projectId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = getDatabase()
  const rows = db.prepare(`
    SELECT u.id as user_id, u.username, u.display_name, u.email, u.role,
           pc.assigned_by, pc.assigned_at
    FROM escp_project_champions pc
    JOIN users u ON u.id = pc.user_id
    WHERE pc.project_id = ?
    ORDER BY u.display_name
  `).all(projectId) as ChampionRow[]
  return NextResponse.json({ champions: rows })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const projectId = await parseProjectId(params)
  if (!projectId) return NextResponse.json({ error: 'Invalid project id' }, { status: 400 })

  if (!canManageProject(user, projectId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, assignSchema)
  if ('error' in result) return result.error
  const targetUserId = result.data.user_id

  const db = getDatabase()
  const target = db.prepare(`SELECT id, role FROM users WHERE id = ?`).get(targetUserId) as { id: number; role: string } | undefined
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // Only champions can be assigned to projects.
  const targetRole = normalizeRole(target.role)
  if (targetRole === 'admin') {
    return NextResponse.json({ error: 'Cannot assign admin as project champion' }, { status: 400 })
  }

  try {
    const now = Math.floor(Date.now() / 1000)
    db.prepare(`
      INSERT OR IGNORE INTO escp_project_champions (project_id, user_id, assigned_by, assigned_at)
      VALUES (?, ?, ?, ?)
    `).run(projectId, targetUserId, user.id, now)

    logAuditEvent({
      action: 'project_champion_assign', actor: user.username, actor_id: user.id,
      target_type: 'project', target_id: projectId,
      detail: { user_id: targetUserId }, ip_address: request.headers.get('x-real-ip') || 'unknown',
    })
    return NextResponse.json({ success: true }, { status: 201 })
  } catch (err) {
    logger.error({ err }, 'POST /api/projects/:id/champions failed')
    return NextResponse.json({ error: 'Failed to assign champion' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const projectId = await parseProjectId(params)
  if (!projectId) return NextResponse.json({ error: 'Invalid project id' }, { status: 400 })

  if (!canManageProject(user, projectId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const targetUserIdRaw = request.nextUrl.searchParams.get('user_id')
  const targetUserId = Number(targetUserIdRaw)
  if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
    return NextResponse.json({ error: 'Missing or invalid user_id query param' }, { status: 400 })
  }

  const db = getDatabase()
  const result = db.prepare(`
    DELETE FROM escp_project_champions WHERE project_id = ? AND user_id = ?
  `).run(projectId, targetUserId)

  if (result.changes > 0) {
    logAuditEvent({
      action: 'project_champion_unassign', actor: user.username, actor_id: user.id,
      target_type: 'project', target_id: projectId,
      detail: { user_id: targetUserId }, ip_address: request.headers.get('x-real-ip') || 'unknown',
    })
  }
  return NextResponse.json({ success: true, removed: result.changes })
}
