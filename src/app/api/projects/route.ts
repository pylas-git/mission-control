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
import { normalizeRole, getUserRegionId, canManageRegion } from '@/lib/authz'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)

const createProjectSchema = z.object({
  client_id: z.number().int().positive(),
  name: z.string().min(1).max(150),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/).optional(),
})

const updateProjectSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(150).optional(),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/).optional(),
})

const deleteProjectSchema = z.object({
  id: z.number().int().positive(),
})

interface ProjectRow {
  id: number; client_id: number; name: string; slug: string;
  archived_at: number | null; created_at: number; updated_at: number;
  client_name?: string; region_id?: number; region_name?: string;
}

interface ClientLookupRow { region_id: number }

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getDatabase()
  const role = normalizeRole(user.role)
  const baseSelect = `
    SELECT p.*, c.name as client_name, c.region_id as region_id, r.name as region_name
    FROM escp_projects p
    JOIN escp_clients c ON c.id = p.client_id
    JOIN escp_regions r ON r.id = c.region_id
  `
  let rows: ProjectRow[]
  if (role === 'admin' || role === 'global_champion') {
    rows = db.prepare(`${baseSelect} ORDER BY p.name`).all() as ProjectRow[]
  } else if (role === 'regional_champion') {
    const regionId = getUserRegionId(user.id)
    if (!regionId) return NextResponse.json({ projects: [] })
    rows = db.prepare(`${baseSelect} WHERE c.region_id = ? ORDER BY p.name`).all(regionId) as ProjectRow[]
  } else {
    rows = db.prepare(`
      ${baseSelect}
      JOIN escp_project_champions pc ON pc.project_id = p.id
      WHERE pc.user_id = ?
      ORDER BY p.name
    `).all(user.id) as ProjectRow[]
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
  const { client_id, name } = result.data
  const slug = result.data.slug || slugify(name)
  if (!slug) return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })

  const db = getDatabase()
  const client = db.prepare(`SELECT region_id FROM escp_clients WHERE id = ?`).get(client_id) as ClientLookupRow | undefined
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  if (!canManageRegion(user, client.region_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const insert = db.prepare(`
      INSERT INTO escp_projects (client_id, name, slug) VALUES (?, ?, ?)
    `).run(client_id, name, slug)
    const id = Number(insert.lastInsertRowid)
    logAuditEvent({
      action: 'project_create', actor: user.username, actor_id: user.id,
      target_type: 'project', target_id: id,
      detail: { client_id, name, slug }, ip_address: request.headers.get('x-real-ip') || 'unknown',
    })
    return NextResponse.json({ project: { id, client_id, name, slug } }, { status: 201 })
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

  const { id, name, slug } = result.data
  if (!name && !slug) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const db = getDatabase()
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

  try {
    db.prepare(`
      UPDATE escp_projects
      SET name = ?, slug = COALESCE(?, slug), updated_at = strftime('%s','now')
      WHERE id = ?
    `).run(nextName, nextSlug, id)

    logAuditEvent({
      action: 'project_update', actor: user.username, actor_id: user.id,
      target_type: 'project', target_id: id,
      detail: { name: nextName, slug: nextSlug }, ip_address: request.headers.get('x-real-ip') || 'unknown',
    })

    return NextResponse.json({ project: { id, client_id: existing.client_id, name: nextName, slug: nextSlug } })
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
    SELECT p.id, c.region_id
    FROM escp_projects p
    JOIN escp_clients c ON c.id = p.client_id
    WHERE p.id = ?
  `).get(id) as {
    id: number
    region_id: number
  } | undefined

  if (!existing) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (!canManageRegion(user, existing.region_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const del = db.prepare(`DELETE FROM escp_projects WHERE id = ?`).run(id)
    if (del.changes === 0) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    logAuditEvent({
      action: 'project_delete', actor: user.username, actor_id: user.id,
      target_type: 'project', target_id: id,
      detail: {}, ip_address: request.headers.get('x-real-ip') || 'unknown',
    })

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    logger.error({ err }, 'DELETE /api/projects failed')
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 })
  }
}
