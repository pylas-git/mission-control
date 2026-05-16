/**
 * Clients API — list/create/update/delete/archive.
 *
 * Read: any authenticated user (filtered by region scope for RSC).
 * Create/Update/Archive: admin, global_champion, or regional_champion (own region only).
 * Delete: admin, global_champion, or regional_champion (blocked when projects exist).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { canManageRegion, normalizeRole, getUserRegionId, hasMinRole } from '@/lib/authz'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)

const createClientSchema = z.object({
  region_id: z.number().int().positive(),
  name: z.string().min(1).max(150),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/).optional(),
})

const updateClientSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(150).optional(),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/).optional(),
})

const deleteClientSchema = z.object({
  id: z.number().int().positive(),
})

const archiveClientSchema = z.object({
  id: z.number().int().positive(),
  archive: z.boolean(),
  reason: z.string().max(500).optional(),
  confirm_text: z.string().max(200).optional(),
})

interface ClientRow {
  id: number; region_id: number; name: string; slug: string;
  archived_at: number | null; archive_reason: string | null;
  created_at: number; updated_at: number;
}

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getDatabase()
  const role = normalizeRole(user.role)
  const includeArchived = request.nextUrl.searchParams.get('includeArchived') === 'true'
  const archivedFilter = includeArchived ? '' : 'AND c.archived_at IS NULL'
  let rows: ClientRow[]
  if (role === 'admin' || role === 'global_champion') {
    rows = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM escp_projects WHERE client_id = c.id) AS projects_count FROM escp_clients c WHERE 1=1 ${archivedFilter} ORDER BY c.name`).all() as ClientRow[]
  } else if (role === 'regional_champion') {
    const regionId = getUserRegionId(user.id)
    if (!regionId) return NextResponse.json({ clients: [] })
    rows = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM escp_projects WHERE client_id = c.id) AS projects_count FROM escp_clients c WHERE c.region_id = ? ${archivedFilter} ORDER BY c.name`).all(regionId) as ClientRow[]
  } else {
    // security_champion: only clients of projects they're assigned to
    rows = db.prepare(`
      SELECT DISTINCT c.*, (SELECT COUNT(*) FROM escp_projects WHERE client_id = c.id) AS projects_count
      FROM escp_clients c
      JOIN escp_projects p ON p.client_id = c.id
      JOIN escp_project_champions pc ON pc.project_id = p.id
      WHERE pc.user_id = ? ${archivedFilter}
      ORDER BY c.name
    `).all(user.id) as ClientRow[]
  }
  return NextResponse.json({ clients: rows })
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, createClientSchema)
  if ('error' in result) return result.error
  const { region_id, name } = result.data
  const slug = result.data.slug || slugify(name)
  if (!slug) return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })

  if (!canManageRegion(user, region_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const db = getDatabase()
    const insert = db.prepare(`
      INSERT INTO escp_clients (region_id, name, slug) VALUES (?, ?, ?)
    `).run(region_id, name, slug)
    const id = Number(insert.lastInsertRowid)
    logAuditEvent({
      action: 'client_create', actor: user.username, actor_id: user.id,
      target_type: 'client', target_id: id,
      detail: { region_id, name, slug }, ip_address: request.headers.get('x-real-ip') || 'unknown',
    })
    return NextResponse.json({ client: { id, region_id, name, slug } }, { status: 201 })
  } catch (err: unknown) {
    if ((err as { message?: string }).message?.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Client slug already exists in this region' }, { status: 409 })
    }
    logger.error({ err }, 'POST /api/clients failed')
    return NextResponse.json({ error: 'Failed to create client' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, updateClientSchema)
  if ('error' in result) return result.error

  const { id, name, slug } = result.data
  if (!name && !slug) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const db = getDatabase()
  const existing = db.prepare(`SELECT id, region_id, name FROM escp_clients WHERE id = ?`).get(id) as {
    id: number
    region_id: number
    name: string
  } | undefined
  if (!existing) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  if (!canManageRegion(user, existing.region_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const nextName = name ?? existing.name
  const nextSlug = slug || (name ? slugify(name) : undefined)

  try {
    db.prepare(`
      UPDATE escp_clients
      SET name = ?, slug = COALESCE(?, slug), updated_at = strftime('%s','now')
      WHERE id = ?
    `).run(nextName, nextSlug, id)

    logAuditEvent({
      action: 'client_update', actor: user.username, actor_id: user.id,
      target_type: 'client', target_id: id,
      detail: { name: nextName, slug: nextSlug }, ip_address: request.headers.get('x-real-ip') || 'unknown',
    })

    return NextResponse.json({ client: { id, region_id: existing.region_id, name: nextName, slug: nextSlug } })
  } catch (err: unknown) {
    if ((err as { message?: string }).message?.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Client slug already exists in this region' }, { status: 409 })
    }
    logger.error({ err }, 'PUT /api/clients failed')
    return NextResponse.json({ error: 'Failed to update client' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, deleteClientSchema)
  if ('error' in result) return result.error

  const { id } = result.data
  const db = getDatabase()
  const existing = db.prepare(`SELECT id, region_id FROM escp_clients WHERE id = ?`).get(id) as {
    id: number
    region_id: number
  } | undefined
  if (!existing) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  if (!canManageRegion(user, existing.region_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Block delete when projects exist — archive instead
  const projectCount = (db.prepare(`SELECT COUNT(*) as n FROM escp_projects WHERE client_id = ?`).get(id) as { n: number }).n
  if (projectCount > 0) {
    return NextResponse.json({
      error: `Cannot delete account with ${projectCount} project${projectCount !== 1 ? 's' : ''}. Archive the account instead, or remove all projects first.`,
      blocked: true,
      projects_count: projectCount,
    }, { status: 409 })
  }

  try {
    const del = db.prepare(`DELETE FROM escp_clients WHERE id = ?`).run(id)
    if (del.changes === 0) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    logAuditEvent({
      action: 'client_delete', actor: user.username, actor_id: user.id,
      target_type: 'client', target_id: id,
      detail: {}, ip_address: request.headers.get('x-real-ip') || 'unknown',
    })

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    if ((err as { message?: string }).message?.includes('FOREIGN KEY')) {
      return NextResponse.json({ error: 'Cannot delete account with existing projects' }, { status: 409 })
    }
    logger.error({ err }, 'DELETE /api/clients failed')
    return NextResponse.json({ error: 'Failed to delete client' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasMinRole(user, 'global_champion')) {
    return NextResponse.json({ error: 'Forbidden — only admin or global champion can archive accounts' }, { status: 403 })
  }

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, archiveClientSchema)
  if ('error' in result) return result.error

  const { id, archive, reason, confirm_text } = result.data

  if (archive && !reason?.trim()) {
    return NextResponse.json({ error: 'Archive reason is required' }, { status: 400 })
  }

  const db = getDatabase()
  const existing = db.prepare(`SELECT id, region_id, name, archived_at FROM escp_clients WHERE id = ?`).get(id) as {
    id: number; region_id: number; name: string; archived_at: number | null
  } | undefined
  if (!existing) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  if (!canManageRegion(user, existing.region_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const projectCount = (db.prepare(`SELECT COUNT(*) as n FROM escp_projects WHERE client_id = ?`).get(id) as { n: number }).n

  if (archive && projectCount >= 10 && confirm_text?.trim() !== existing.name) {
    return NextResponse.json({
      error: 'Typed confirmation required for high-impact archive action',
      requires_typed_confirmation: true,
      required_text: existing.name,
      impact_count: projectCount,
      projects_count: projectCount,
    }, { status: 409 })
  }

  if (archive) {
    db.prepare(`
      UPDATE escp_clients SET archived_at = unixepoch(), archive_reason = ?, updated_at = unixepoch() WHERE id = ?
    `).run(reason!.trim(), id)
    logAuditEvent({
      action: 'client_archive', actor: user.username, actor_id: user.id,
      target_type: 'client', target_id: id,
      detail: { reason: reason!.trim(), projects_count: projectCount },
      ip_address: request.headers.get('x-real-ip') || 'unknown',
    })
  } else {
    db.prepare(`
      UPDATE escp_clients SET archived_at = NULL, archive_reason = ?, updated_at = unixepoch() WHERE id = ?
    `).run(reason?.trim() ?? null, id)
    logAuditEvent({
      action: 'client_unarchive', actor: user.username, actor_id: user.id,
      target_type: 'client', target_id: id,
      detail: { reason: reason?.trim() ?? null },
      ip_address: request.headers.get('x-real-ip') || 'unknown',
    })
  }

  const updated = db.prepare(`SELECT id, region_id, name, slug, archived_at, archive_reason FROM escp_clients WHERE id = ?`).get(id)
  return NextResponse.json({
    client: updated,
    impact: {
      projects_count: projectCount,
      impact_count: projectCount,
    },
  })
}
