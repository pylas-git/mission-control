/**
 * Regions API — list/create.
 *
 * Read: any authenticated user.
 * Create: admin or global_champion.
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
})

const updateRegionSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/).optional(),
})

const deleteRegionSchema = z.object({
  id: z.number().int().positive(),
})

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getDatabase()
  const role = normalizeRole(user.role)
  let rows: unknown[] = []

  if (role === 'admin' || role === 'global_champion') {
    rows = db.prepare(`SELECT id, name, slug, created_at, updated_at FROM escp_regions ORDER BY name`).all()
  } else if (role === 'regional_champion') {
    const regionId = getUserRegionId(user.id)
    if (regionId) {
      rows = db.prepare(`
        SELECT id, name, slug, created_at, updated_at
        FROM escp_regions
        WHERE id = ?
        ORDER BY name
      `).all(regionId)
    }
  } else {
    rows = db.prepare(`
      SELECT DISTINCT r.id, r.name, r.slug, r.created_at, r.updated_at
      FROM escp_regions r
      JOIN escp_clients c ON c.region_id = r.id
      JOIN escp_projects p ON p.client_id = c.id
      JOIN escp_project_champions pc ON pc.project_id = p.id
      WHERE pc.user_id = ?
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
  const { name } = result.data
  const slug = result.data.slug || slugify(name)
  if (!slug) return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })

  try {
    const db = getDatabase()
    const insert = db.prepare(`INSERT INTO escp_regions (name, slug) VALUES (?, ?)`).run(name, slug)
    const id = Number(insert.lastInsertRowid)
    logAuditEvent({
      action: 'region_create', actor: user.username, actor_id: user.id,
      target_type: 'region', target_id: id,
      detail: { name, slug }, ip_address: request.headers.get('x-real-ip') || 'unknown',
    })
    return NextResponse.json({ region: { id, name, slug } }, { status: 201 })
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

  const { id, name, slug } = result.data
  if (!name && !slug) {
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

    logAuditEvent({
      action: 'region_update', actor: user.username, actor_id: user.id,
      target_type: 'region', target_id: id,
      detail: { name: nextName, slug: nextSlug }, ip_address: request.headers.get('x-real-ip') || 'unknown',
    })

    return NextResponse.json({ region: { id, name: nextName, slug: nextSlug } })
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

  try {
    const del = db.prepare(`DELETE FROM escp_regions WHERE id = ?`).run(id)
    if (del.changes === 0) return NextResponse.json({ error: 'Region not found' }, { status: 404 })

    logAuditEvent({
      action: 'region_delete', actor: user.username, actor_id: user.id,
      target_type: 'region', target_id: id,
      detail: {}, ip_address: request.headers.get('x-real-ip') || 'unknown',
    })

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    if ((err as { message?: string }).message?.includes('FOREIGN KEY')) {
      return NextResponse.json({ error: 'Cannot delete region with existing accounts/projects' }, { status: 409 })
    }
    logger.error({ err }, 'DELETE /api/regions failed')
    return NextResponse.json({ error: 'Failed to delete region' }, { status: 500 })
  }
}
