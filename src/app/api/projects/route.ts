/**
 * Projects API — list/create.
 *
 * Read: admin/global_champion (all), regional_champion (own region),
 *        security_champion (only projects they're assigned to).
 * Create: admin, global_champion, regional_champion (own region only).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { normalizeRole, getUserRegionId, canManageRegion, hasMinRole } from '@/lib/authz'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { beltLevelExists, getDefaultBeltLevel } from '@/lib/escp-belts'

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)

const createProjectSchema = z.object({
  client_id: z.number().int().positive(),
  name: z.string().min(1).max(150),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/).optional(),
  target_belt: z.number().int().optional(),
  primary_champion_id: z.number().int().positive().nullable().optional(),
})

const updateProjectSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(150).optional(),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/).optional(),
  target_belt: z.number().int().optional(),
  primary_champion_id: z.number().int().positive().nullable().optional(),
})

const deleteProjectSchema = z.object({
  id: z.number().int().positive(),
})

const archiveProjectSchema = z.object({
  id: z.number().int().positive(),
  archive: z.boolean(),
  reason: z.string().max(500).optional(),
})

interface ProjectRow {
  id: number; client_id: number; name: string; slug: string;
  archived_at: number | null; created_at: number; updated_at: number;
  client_name?: string; region_id?: number; region_name?: string;
  target_belt?: number | null
  current_belt?: number | null
  primary_champion_id?: number | null
  primary_champion_name?: string | null
  has_gap?: number
  has_overdue_gap?: number
  belt_gap?: number
  primary_belt_target_date?: number | null
}

interface ClientLookupRow { region_id: number }

function setPrimaryChampion(
  db: ReturnType<typeof getDatabase>,
  projectId: number,
  primaryChampionId: number | null,
  actorId: number,
): { status?: number; error?: string } {
  if (primaryChampionId === null) {
    db.prepare(`UPDATE escp_project_champions SET is_primary = 0 WHERE project_id = ?`).run(projectId)
    return {}
  }

  const target = db.prepare(`SELECT id, role FROM users WHERE id = ?`).get(primaryChampionId) as { id: number; role: string } | undefined
  if (!target) return { status: 404, error: 'Primary champion user not found' }
  if (normalizeRole(target.role) === 'admin') {
    return { status: 400, error: 'Cannot assign admin as project champion' }
  }

  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    INSERT OR IGNORE INTO escp_project_champions (project_id, user_id, assigned_by, assigned_at)
    VALUES (?, ?, ?, ?)
  `).run(projectId, primaryChampionId, actorId, now)

  db.prepare(`
    UPDATE escp_project_champions
    SET is_primary = CASE WHEN user_id = ? THEN 1 ELSE 0 END
    WHERE project_id = ?
  `).run(primaryChampionId, projectId)

  return {}
}

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getDatabase()
  const role = normalizeRole(user.role)
  const includeArchived = request.nextUrl.searchParams.get('includeArchived') === 'true'
  const archivedFilter = includeArchived ? '' : 'AND p.archived_at IS NULL'
  const baseSelect = `
    SELECT p.*, c.name as client_name, c.region_id as region_id, r.name as region_name,
           pcp.user_id as primary_champion_id,
           pu.display_name as primary_champion_name
    FROM escp_projects p
    JOIN escp_clients c ON c.id = p.client_id
    JOIN escp_regions r ON r.id = c.region_id
    LEFT JOIN escp_project_champions pcp ON pcp.project_id = p.id AND pcp.is_primary = 1
    LEFT JOIN users pu ON pu.id = pcp.user_id
  `
  let rows: ProjectRow[]
  if (role === 'admin' || role === 'global_champion') {
    rows = db.prepare(`${baseSelect} WHERE 1=1 ${archivedFilter} ORDER BY p.name`).all() as ProjectRow[]
  } else if (role === 'regional_champion') {
    const regionId = getUserRegionId(user.id)
    if (!regionId) return NextResponse.json({ projects: [] })
    rows = db.prepare(`${baseSelect} WHERE c.region_id = ? ${archivedFilter} ORDER BY p.name`).all(regionId) as ProjectRow[]
  } else {
    rows = db.prepare(`
      ${baseSelect}
      JOIN escp_project_champions pc_scope ON pc_scope.project_id = p.id
      WHERE pc_scope.user_id = ? ${archivedFilter}
      ORDER BY p.name
    `).all(user.id) as ProjectRow[]
  }

  const now = Math.floor(Date.now() / 1000)
  const gapMetaStmt = db.prepare(`
    SELECT
      p.target_belt,
      pc.belt_target_date,
      cb.current_belt,
      cb.expires_at,
      cb.grace_expires_at
    FROM escp_projects p
    LEFT JOIN escp_project_champions pc ON pc.project_id = p.id AND pc.is_primary = 1
    LEFT JOIN escp_champion_belts cb ON cb.user_id = pc.user_id
    WHERE p.id = ?
  `)

  for (const row of rows) {
    const meta = gapMetaStmt.get(row.id) as {
      target_belt?: number | null
      belt_target_date?: number | null
      current_belt?: number | null
      expires_at?: number | null
      grace_expires_at?: number | null
    } | undefined

    const targetBelt = meta?.target_belt ?? 0
    const currentBelt = meta?.current_belt ?? 0
    const beltGap = Math.max(0, targetBelt - currentBelt)

    const inGraceOrActive = !meta?.expires_at || now <= (meta?.grace_expires_at ?? meta?.expires_at)
    const hasGap = beltGap > 0 || !inGraceOrActive
    const hasOverdueGap = hasGap && !!meta?.belt_target_date && now > meta.belt_target_date

    row.has_gap = hasGap ? 1 : 0
    row.has_overdue_gap = hasOverdueGap ? 1 : 0
    row.belt_gap = beltGap
    row.primary_belt_target_date = meta?.belt_target_date ?? null
  }

  return NextResponse.json({ projects: rows })
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, createProjectSchema)
  if ('error' in result) return result.error
  const { client_id, name, target_belt, primary_champion_id } = result.data
  const slug = result.data.slug || slugify(name)
  if (!slug) return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })

  const db = getDatabase()
  const resolvedTargetBelt = target_belt ?? getDefaultBeltLevel(db)
  if (!beltLevelExists(db, resolvedTargetBelt)) {
    return NextResponse.json({ error: 'Invalid target_belt' }, { status: 400 })
  }

  const client = db.prepare(`SELECT region_id FROM escp_clients WHERE id = ?`).get(client_id) as ClientLookupRow | undefined
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  if (!canManageRegion(user, client.region_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const insert = db.prepare(`
      INSERT INTO escp_projects (client_id, name, slug, target_belt) VALUES (?, ?, ?, ?)
    `).run(client_id, name, slug, resolvedTargetBelt)
    const id = Number(insert.lastInsertRowid)

    if (primary_champion_id !== undefined) {
      const assign = setPrimaryChampion(db, id, primary_champion_id, user.id)
      if (assign.error) {
        db.prepare(`DELETE FROM escp_projects WHERE id = ?`).run(id)
        return NextResponse.json({ error: assign.error }, { status: assign.status ?? 400 })
      }
    }

    const created = db.prepare(`
      SELECT p.*, c.name as client_name, c.region_id as region_id, r.name as region_name,
             pcp.user_id as primary_champion_id,
             pu.display_name as primary_champion_name
      FROM escp_projects p
      JOIN escp_clients c ON c.id = p.client_id
      JOIN escp_regions r ON r.id = c.region_id
      LEFT JOIN escp_project_champions pcp ON pcp.project_id = p.id AND pcp.is_primary = 1
      LEFT JOIN users pu ON pu.id = pcp.user_id
      WHERE p.id = ?
    `).get(id)

    logAuditEvent({
      action: 'project_create', actor: user.username, actor_id: user.id,
      target_type: 'project', target_id: id,
      detail: { client_id, name, slug, target_belt: resolvedTargetBelt, primary_champion_id: primary_champion_id ?? null },
      ip_address: request.headers.get('x-real-ip') || 'unknown',
    })
    return NextResponse.json({ project: created }, { status: 201 })
  } catch (err: unknown) {
    if ((err as { message?: string }).message?.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Project slug already exists for this client' }, { status: 409 })
    }
    logger.error({ err }, 'POST /api/projects failed')
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, updateProjectSchema)
  if ('error' in result) return result.error

  const { id, name, slug, target_belt, primary_champion_id } = result.data
  if (name === undefined && slug === undefined && target_belt === undefined && primary_champion_id === undefined) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const db = getDatabase()
  if (target_belt !== undefined && !beltLevelExists(db, target_belt)) {
    return NextResponse.json({ error: 'Invalid target_belt' }, { status: 400 })
  }

  const existing = db.prepare(`
    SELECT p.id, p.client_id, p.name, c.region_id
    FROM escp_projects p
    JOIN escp_clients c ON c.id = p.client_id
    WHERE p.id = ?
  `).get(id) as {
    id: number
    client_id: number
    name: string
    region_id: number
  } | undefined

  if (!existing) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (!canManageRegion(user, existing.region_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const nextName = name ?? existing.name
  const nextSlug = slug || (name ? slugify(name) : undefined)
  const nextTargetBelt = target_belt

  try {
    db.prepare(`
      UPDATE escp_projects
      SET name = ?, slug = COALESCE(?, slug), target_belt = COALESCE(?, target_belt), updated_at = strftime('%s','now')
      WHERE id = ?
    `).run(nextName, nextSlug, nextTargetBelt, id)

    if (primary_champion_id !== undefined) {
      const assign = setPrimaryChampion(db, id, primary_champion_id, user.id)
      if (assign.error) {
        return NextResponse.json({ error: assign.error }, { status: assign.status ?? 400 })
      }
    }

    const updated = db.prepare(`
      SELECT p.*, c.name as client_name, c.region_id as region_id, r.name as region_name,
             pcp.user_id as primary_champion_id,
             pu.display_name as primary_champion_name
      FROM escp_projects p
      JOIN escp_clients c ON c.id = p.client_id
      JOIN escp_regions r ON r.id = c.region_id
      LEFT JOIN escp_project_champions pcp ON pcp.project_id = p.id AND pcp.is_primary = 1
      LEFT JOIN users pu ON pu.id = pcp.user_id
      WHERE p.id = ?
    `).get(id)

    logAuditEvent({
      action: 'project_update', actor: user.username, actor_id: user.id,
      target_type: 'project', target_id: id,
      detail: {
        name: nextName,
        slug: nextSlug,
        target_belt: nextTargetBelt,
        primary_champion_id: primary_champion_id,
      },
      ip_address: request.headers.get('x-real-ip') || 'unknown',
    })

    return NextResponse.json({ project: updated })
  } catch (err: unknown) {
    if ((err as { message?: string }).message?.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Project slug already exists for this client' }, { status: 409 })
    }
    logger.error({ err }, 'PUT /api/projects failed')
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, deleteProjectSchema)
  if ('error' in result) return result.error

  const { id } = result.data
  const db = getDatabase()
  const existing = db.prepare(`
    SELECT p.id, p.name, c.region_id
    FROM escp_projects p
    JOIN escp_clients c ON c.id = p.client_id
    WHERE p.id = ?
  `).get(id) as {
    id: number
    name: string
    region_id: number
  } | undefined

  if (!existing) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (!canManageRegion(user, existing.region_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Block delete when security history exists — archive instead
  const assessmentCount = (db.prepare(`SELECT COUNT(*) as n FROM escp_project_assessments WHERE project_id = ?`).get(id) as { n: number }).n
  const waiverCount = (db.prepare(`SELECT COUNT(*) as n FROM escp_qualification_waivers WHERE project_id = ?`).get(id) as { n: number }).n
  const historyCount = assessmentCount + waiverCount
  if (historyCount > 0) {
    return NextResponse.json({
      error: `Cannot delete project with security history (${assessmentCount} assessment${assessmentCount !== 1 ? 's' : ''}, ${waiverCount} waiver${waiverCount !== 1 ? 's' : ''}). Archive the project instead.`,
      blocked: true,
      assessments_count: assessmentCount,
      waivers_count: waiverCount,
    }, { status: 409 })
  }

  try {
    const del = db.prepare(`DELETE FROM escp_projects WHERE id = ?`).run(id)
    if (del.changes === 0) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    logAuditEvent({
      action: 'project_delete', actor: user.username, actor_id: user.id,
      target_type: 'project', target_id: id,
      detail: { name: existing.name }, ip_address: request.headers.get('x-real-ip') || 'unknown',
    })

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    logger.error({ err }, 'DELETE /api/projects failed')
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasMinRole(user, 'global_champion')) {
    return NextResponse.json({ error: 'Forbidden — only admin or global champion can archive projects' }, { status: 403 })
  }

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, archiveProjectSchema)
  if ('error' in result) return result.error

  const { id, archive, reason } = result.data

  if (archive && !reason?.trim()) {
    return NextResponse.json({ error: 'Archive reason is required' }, { status: 400 })
  }

  const db = getDatabase()
  const existing = db.prepare(`
    SELECT p.id, p.name, p.archived_at, c.region_id
    FROM escp_projects p
    JOIN escp_clients c ON c.id = p.client_id
    WHERE p.id = ?
  `).get(id) as { id: number; name: string; archived_at: number | null; region_id: number } | undefined
  if (!existing) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  if (archive) {
    db.prepare(`
      UPDATE escp_projects SET archived_at = unixepoch(), archive_reason = ?, updated_at = unixepoch() WHERE id = ?
    `).run(reason!.trim(), id)
    logAuditEvent({
      action: 'project_archive', actor: user.username, actor_id: user.id,
      target_type: 'project', target_id: id,
      detail: { reason: reason!.trim() },
      ip_address: request.headers.get('x-real-ip') || 'unknown',
    })
  } else {
    db.prepare(`
      UPDATE escp_projects SET archived_at = NULL, archive_reason = ?, updated_at = unixepoch() WHERE id = ?
    `).run(reason?.trim() ?? null, id)
    logAuditEvent({
      action: 'project_unarchive', actor: user.username, actor_id: user.id,
      target_type: 'project', target_id: id,
      detail: { reason: reason?.trim() ?? null },
      ip_address: request.headers.get('x-real-ip') || 'unknown',
    })
  }

  const updated = db.prepare(`
    SELECT p.*, c.name as client_name, c.region_id, r.name as region_name
    FROM escp_projects p
    JOIN escp_clients c ON c.id = p.client_id
    JOIN escp_regions r ON r.id = c.region_id
    WHERE p.id = ?
  `).get(id)
  return NextResponse.json({ project: updated })
}
