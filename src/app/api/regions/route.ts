/**
 * Regions API — list/create/update/delete/archive.
 *
 * Read: any authenticated user.
 * Create/Update/Archive: admin or global_champion.
 * Delete: admin or global_champion (blocked when accounts exist).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { getUserRegionId, hasMinRole, normalizeRole } from '@/lib/authz'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)

const createRegionSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/).optional(),
  regional_champion_id: z.number().int().positive().nullable().optional(),
})

const updateRegionSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/).optional(),
  regional_champion_id: z.number().int().positive().nullable().optional(),
})

function setRegionalChampion(db: ReturnType<typeof getDatabase>, regionId: number, userId: number | null) {
  if (userId == null) {
    db.prepare(`
      UPDATE users
      SET region_id = NULL
      WHERE role = 'regional_champion' AND region_id = ?
    `).run(regionId)
    return
  }

  const target = db.prepare(`SELECT id FROM users WHERE id = ?`).get(userId) as { id: number } | undefined
  if (!target) {
    return { status: 404 as const, error: 'Regional champion user not found' }
  }

  db.prepare(`
    UPDATE users
    SET region_id = NULL
    WHERE role = 'regional_champion' AND region_id = ? AND id <> ?
  `).run(regionId, userId)

  db.prepare(`
    UPDATE users
    SET role = 'regional_champion', region_id = ?
    WHERE id = ?
  `).run(regionId, userId)

  return null
}

const deleteRegionSchema = z.object({
  id: z.number().int().positive(),
})

const archiveRegionSchema = z.object({
  id: z.number().int().positive(),
  archive: z.boolean(),
  reason: z.string().max(500).optional(),
  confirm_text: z.string().max(200).optional(),
})

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getDatabase()
  const role = normalizeRole(user.role)
  const includeArchived = request.nextUrl.searchParams.get('includeArchived') === 'true'
  const archivedFilter = includeArchived ? '' : 'AND r.archived_at IS NULL'
  let rows: unknown[] = []

  if (role === 'admin' || role === 'global_champion') {
    rows = db.prepare(`
      SELECT r.id, r.name, r.slug, r.archived_at, r.archive_reason, r.created_at, r.updated_at,
        (SELECT u.id FROM users u WHERE u.region_id = r.id AND u.role = 'regional_champion' ORDER BY u.display_name LIMIT 1) AS regional_champion_id,
        (SELECT u.display_name FROM users u WHERE u.region_id = r.id AND u.role = 'regional_champion' ORDER BY u.display_name LIMIT 1) AS regional_champion_name,
        (SELECT COUNT(*) FROM escp_clients WHERE region_id = r.id) AS accounts_count,
        (SELECT COUNT(*) FROM escp_projects p JOIN escp_clients c ON c.id = p.client_id WHERE c.region_id = r.id) AS projects_count
      FROM escp_regions r
      WHERE 1=1 ${archivedFilter}
      ORDER BY r.name
    `).all()
  } else if (role === 'regional_champion') {
    const regionId = getUserRegionId(user.id)
    if (regionId) {
      rows = db.prepare(`
        SELECT r.id, r.name, r.slug, r.archived_at, r.archive_reason, r.created_at, r.updated_at,
          (SELECT u.id FROM users u WHERE u.region_id = r.id AND u.role = 'regional_champion' ORDER BY u.display_name LIMIT 1) AS regional_champion_id,
          (SELECT u.display_name FROM users u WHERE u.region_id = r.id AND u.role = 'regional_champion' ORDER BY u.display_name LIMIT 1) AS regional_champion_name,
          (SELECT COUNT(*) FROM escp_clients WHERE region_id = r.id) AS accounts_count,
          (SELECT COUNT(*) FROM escp_projects p JOIN escp_clients c ON c.id = p.client_id WHERE c.region_id = r.id) AS projects_count
        FROM escp_regions r
        WHERE r.id = ? ${archivedFilter}
        ORDER BY r.name
      `).all(regionId)
    }
  } else {
    rows = db.prepare(`
      SELECT DISTINCT r.id, r.name, r.slug, r.archived_at, r.archive_reason, r.created_at, r.updated_at,
        (SELECT u.id FROM users u WHERE u.region_id = r.id AND u.role = 'regional_champion' ORDER BY u.display_name LIMIT 1) AS regional_champion_id,
        (SELECT u.display_name FROM users u WHERE u.region_id = r.id AND u.role = 'regional_champion' ORDER BY u.display_name LIMIT 1) AS regional_champion_name,
        (SELECT COUNT(*) FROM escp_clients WHERE region_id = r.id) AS accounts_count,
        (SELECT COUNT(*) FROM escp_projects p2 JOIN escp_clients c2 ON c2.id = p2.client_id WHERE c2.region_id = r.id) AS projects_count
      FROM escp_regions r
      JOIN escp_clients c ON c.region_id = r.id
      JOIN escp_projects p ON p.client_id = c.id
      JOIN escp_project_champions pc ON pc.project_id = p.id
      WHERE pc.user_id = ? ${archivedFilter}
      ORDER BY r.name
    `).all(user.id)
  }

  return NextResponse.json({ regions: rows })
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasMinRole(user, 'global_champion')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, createRegionSchema)
  if ('error' in result) return result.error
  const { name, regional_champion_id } = result.data
  const slug = result.data.slug || slugify(name)
  if (!slug) return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })

  try {
    const db = getDatabase()
    const insert = db.prepare(`INSERT INTO escp_regions (name, slug) VALUES (?, ?)`).run(name, slug)
    const id = Number(insert.lastInsertRowid)

    if (regional_champion_id !== undefined) {
      const assignResult = setRegionalChampion(db, id, regional_champion_id)
      if (assignResult) {
        return NextResponse.json({ error: assignResult.error }, { status: assignResult.status })
      }
    }

    logAuditEvent({
      action: 'region_create', actor: user.username, actor_id: user.id,
      target_type: 'region', target_id: id,
      detail: { name, slug, regional_champion_id: regional_champion_id ?? null }, ip_address: request.headers.get('x-real-ip') || 'unknown',
    })

    const created = db.prepare(`
      SELECT r.id, r.name, r.slug,
        (SELECT u.id FROM users u WHERE u.region_id = r.id AND u.role = 'regional_champion' ORDER BY u.display_name LIMIT 1) AS regional_champion_id,
        (SELECT u.display_name FROM users u WHERE u.region_id = r.id AND u.role = 'regional_champion' ORDER BY u.display_name LIMIT 1) AS regional_champion_name
      FROM escp_regions r
      WHERE r.id = ?
    `).get(id)

    return NextResponse.json({ region: created }, { status: 201 })
  } catch (err: unknown) {
    if ((err as { message?: string }).message?.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Region name or slug already exists' }, { status: 409 })
    }
    logger.error({ err }, 'POST /api/regions failed')
    return NextResponse.json({ error: 'Failed to create region' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasMinRole(user, 'global_champion')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, updateRegionSchema)
  if ('error' in result) return result.error

  const { id, name, slug, regional_champion_id } = result.data
  if (name === undefined && slug === undefined && regional_champion_id === undefined) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const db = getDatabase()
  const existing = db.prepare(`SELECT id, name FROM escp_regions WHERE id = ?`).get(id) as { id: number; name: string } | undefined
  if (!existing) return NextResponse.json({ error: 'Region not found' }, { status: 404 })

  const nextName = name ?? existing.name
  const nextSlug = slug || (name ? slugify(name) : undefined)

  try {
    db.prepare(`
      UPDATE escp_regions
      SET name = ?, slug = COALESCE(?, slug), updated_at = strftime('%s','now')
      WHERE id = ?
    `).run(nextName, nextSlug, id)

    if (regional_champion_id !== undefined) {
      const assignResult = setRegionalChampion(db, id, regional_champion_id)
      if (assignResult) {
        return NextResponse.json({ error: assignResult.error }, { status: assignResult.status })
      }
    }

    logAuditEvent({
      action: 'region_update', actor: user.username, actor_id: user.id,
      target_type: 'region', target_id: id,
      detail: { name: nextName, slug: nextSlug, regional_champion_id: regional_champion_id ?? null }, ip_address: request.headers.get('x-real-ip') || 'unknown',
    })

    const updated = db.prepare(`
      SELECT r.id, r.name, r.slug,
        (SELECT u.id FROM users u WHERE u.region_id = r.id AND u.role = 'regional_champion' ORDER BY u.display_name LIMIT 1) AS regional_champion_id,
        (SELECT u.display_name FROM users u WHERE u.region_id = r.id AND u.role = 'regional_champion' ORDER BY u.display_name LIMIT 1) AS regional_champion_name
      FROM escp_regions r
      WHERE r.id = ?
    `).get(id)

    return NextResponse.json({ region: updated })
  } catch (err: unknown) {
    if ((err as { message?: string }).message?.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Region name or slug already exists' }, { status: 409 })
    }
    logger.error({ err }, 'PUT /api/regions failed')
    return NextResponse.json({ error: 'Failed to update region' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasMinRole(user, 'global_champion')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, deleteRegionSchema)
  if ('error' in result) return result.error

  const { id } = result.data
  const db = getDatabase()

  const existing = db.prepare(`SELECT id, name FROM escp_regions WHERE id = ?`).get(id) as { id: number; name: string } | undefined
  if (!existing) return NextResponse.json({ error: 'Region not found' }, { status: 404 })

  // Block delete when accounts exist — archive instead
  const accountCount = (db.prepare(`SELECT COUNT(*) as n FROM escp_clients WHERE region_id = ?`).get(id) as { n: number }).n
  if (accountCount > 0) {
    return NextResponse.json({
      error: `Cannot delete region with ${accountCount} account${accountCount !== 1 ? 's' : ''}. Archive the region instead, or remove all accounts first.`,
      blocked: true,
      accounts_count: accountCount,
    }, { status: 409 })
  }

  try {
    const del = db.prepare(`DELETE FROM escp_regions WHERE id = ?`).run(id)
    if (del.changes === 0) return NextResponse.json({ error: 'Region not found' }, { status: 404 })

    logAuditEvent({
      action: 'region_delete', actor: user.username, actor_id: user.id,
      target_type: 'region', target_id: id,
      detail: { name: existing.name }, ip_address: request.headers.get('x-real-ip') || 'unknown',
    })

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    if ((err as { message?: string }).message?.includes('FOREIGN KEY')) {
      return NextResponse.json({ error: 'Cannot delete region with existing accounts' }, { status: 409 })
    }
    logger.error({ err }, 'DELETE /api/regions failed')
    return NextResponse.json({ error: 'Failed to delete region' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasMinRole(user, 'global_champion')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, archiveRegionSchema)
  if ('error' in result) return result.error

  const { id, archive, reason, confirm_text } = result.data

  if (archive && !reason?.trim()) {
    return NextResponse.json({ error: 'Archive reason is required' }, { status: 400 })
  }

  const db = getDatabase()
  const existing = db.prepare(`SELECT id, name, archived_at FROM escp_regions WHERE id = ?`).get(id) as {
    id: number; name: string; archived_at: number | null
  } | undefined
  if (!existing) return NextResponse.json({ error: 'Region not found' }, { status: 404 })

  // Compute impact for archive action (informational, re-validated here)
  const accountCount = (db.prepare(`SELECT COUNT(*) as n FROM escp_clients WHERE region_id = ?`).get(id) as { n: number }).n
  const projectCount = (db.prepare(`
    SELECT COUNT(*) as n FROM escp_projects p JOIN escp_clients c ON c.id = p.client_id WHERE c.region_id = ?
  `).get(id) as { n: number }).n
  const impactCount = accountCount + projectCount

  // Re-validate high-impact archive actions at submit time to avoid stale UI decisions.
  if (archive && impactCount >= 10 && confirm_text?.trim() !== existing.name) {
    return NextResponse.json({
      error: 'Typed confirmation required for high-impact archive action',
      requires_typed_confirmation: true,
      required_text: existing.name,
      impact_count: impactCount,
      accounts_count: accountCount,
      projects_count: projectCount,
    }, { status: 409 })
  }

  if (archive) {
    db.prepare(`
      UPDATE escp_regions SET archived_at = unixepoch(), archive_reason = ?, updated_at = unixepoch() WHERE id = ?
    `).run(reason!.trim(), id)
    logAuditEvent({
      action: 'region_archive', actor: user.username, actor_id: user.id,
      target_type: 'region', target_id: id,
      detail: { reason: reason!.trim(), accounts_count: accountCount, projects_count: projectCount },
      ip_address: request.headers.get('x-real-ip') || 'unknown',
    })
  } else {
    db.prepare(`
      UPDATE escp_regions SET archived_at = NULL, archive_reason = ?, updated_at = unixepoch() WHERE id = ?
    `).run(reason?.trim() ?? null, id)
    logAuditEvent({
      action: 'region_unarchive', actor: user.username, actor_id: user.id,
      target_type: 'region', target_id: id,
      detail: { reason: reason?.trim() ?? null },
      ip_address: request.headers.get('x-real-ip') || 'unknown',
    })
  }

  const updated = db.prepare(`SELECT id, name, slug, archived_at, archive_reason FROM escp_regions WHERE id = ?`).get(id)
  return NextResponse.json({
    region: updated,
    impact: {
      accounts_count: accountCount,
      projects_count: projectCount,
      impact_count: impactCount,
    },
  })
}
