/**
 * Belt requirements catalog API — CRUD for assessment requirement definitions.
 *
 * Read:   all authenticated ESCP roles.
 * Write:  admin, global_champion only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { normalizeRole } from '@/lib/authz'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { beltLevelExists } from '@/lib/escp-belts'

const createSchema = z.object({
  belt_level: z.number().int(),
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  upstream_ref: z.string().max(500).optional(),
  sort_order: z.number().int().min(0).optional(),
})

const updateSchema = z.object({
  id: z.number().int().positive(),
  belt_level: z.number().int().optional(),
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  upstream_ref: z.string().max(500).optional(),
  sort_order: z.number().int().min(0).optional(),
})

const deleteSchema = z.object({
  id: z.number().int().positive(),
})

function canWrite(role: string) {
  return role === 'admin' || role === 'global_champion'
}

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getDatabase()
  const { searchParams } = new URL(request.url)
  const levelParam = searchParams.get('belt_level')

  let rows
  if (levelParam !== null) {
    const level = parseInt(levelParam, 10)
    if (!Number.isInteger(level) || !beltLevelExists(db, level)) {
      return NextResponse.json({ error: 'Invalid belt_level' }, { status: 400 })
    }
    rows = db
      .prepare('SELECT * FROM escp_belt_requirements WHERE belt_level = ? ORDER BY sort_order, id')
      .all(level)
  } else {
    rows = db
      .prepare('SELECT * FROM escp_belt_requirements ORDER BY belt_level, sort_order, id')
      .all()
  }

  return NextResponse.json({ requirements: rows })
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = normalizeRole(user.role)
  if (!canWrite(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const parsed = await validateBody(request, createSchema)
  if ('error' in parsed) return parsed.error
  const body = parsed.data

  const db = getDatabase()
  if (!beltLevelExists(db, body.belt_level)) {
    return NextResponse.json({ error: 'Invalid belt_level' }, { status: 400 })
  }

  const now = Math.floor(Date.now() / 1000)
  const result = db.prepare(`
    INSERT INTO escp_belt_requirements (belt_level, title, description, upstream_ref, sort_order, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    body.belt_level,
    body.title,
    body.description ?? null,
    body.upstream_ref ?? null,
    body.sort_order ?? 0,
    user.id,
    now,
    now,
  )

  const created = db.prepare('SELECT * FROM escp_belt_requirements WHERE id = ?').get(result.lastInsertRowid)
  return NextResponse.json({ requirement: created }, { status: 201 })
}

export async function PUT(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = normalizeRole(user.role)
  if (!canWrite(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const parsed = await validateBody(request, updateSchema)
  if ('error' in parsed) return parsed.error
  const body = parsed.data

  const db = getDatabase()
  const existing = db.prepare('SELECT * FROM escp_belt_requirements WHERE id = ?').get(body.id) as any
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (body.belt_level !== undefined && !beltLevelExists(db, body.belt_level)) {
    return NextResponse.json({ error: 'Invalid belt_level' }, { status: 400 })
  }

  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    UPDATE escp_belt_requirements SET
      belt_level = ?, title = ?, description = ?, upstream_ref = ?, sort_order = ?, updated_at = ?
    WHERE id = ?
  `).run(
    body.belt_level ?? existing.belt_level,
    body.title ?? existing.title,
    body.description !== undefined ? body.description : existing.description,
    body.upstream_ref !== undefined ? body.upstream_ref : existing.upstream_ref,
    body.sort_order ?? existing.sort_order,
    now,
    body.id,
  )

  const updated = db.prepare('SELECT * FROM escp_belt_requirements WHERE id = ?').get(body.id)
  return NextResponse.json({ requirement: updated })
}

export async function DELETE(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = normalizeRole(user.role)
  if (!canWrite(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = await validateBody(request, deleteSchema)
  if ('error' in parsed) return parsed.error
  const body = parsed.data

  const db = getDatabase()
  const existing = db.prepare('SELECT id FROM escp_belt_requirements WHERE id = ?').get(body.id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Prevent deleting requirements that have been snapshotted into active assessments
  const inUse = db.prepare(`
    SELECT COUNT(*) as count FROM escp_project_assessment_items WHERE requirement_id = ?
  `).get(body.id) as { count: number }
  if (inUse.count > 0) {
    return NextResponse.json(
      { error: 'Requirement is referenced by active assessments and cannot be deleted.' },
      { status: 409 }
    )
  }

  db.prepare('DELETE FROM escp_belt_requirements WHERE id = ?').run(body.id)
  return NextResponse.json({ ok: true })
}
