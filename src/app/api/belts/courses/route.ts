/**
 * Belt courses/labs catalog API — CRUD for SecureFlag course links per belt level.
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
  url: z.string().url().max(1000),
  type: z.enum(['course', 'lab']).default('course'),
  provider: z.string().max(100).optional(),
  sort_order: z.number().int().min(0).optional(),
})

const updateSchema = z.object({
  id: z.number().int().positive(),
  belt_level: z.number().int().optional(),
  title: z.string().min(1).max(255).optional(),
  url: z.string().url().max(1000).optional(),
  type: z.enum(['course', 'lab']).optional(),
  provider: z.string().max(100).optional(),
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
      .prepare('SELECT * FROM escp_belt_courses WHERE belt_level = ? ORDER BY sort_order, id')
      .all(level)
  } else {
    rows = db
      .prepare('SELECT * FROM escp_belt_courses ORDER BY belt_level, sort_order, id')
      .all()
  }

  return NextResponse.json({ courses: rows })
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
    INSERT INTO escp_belt_courses (belt_level, title, url, type, provider, sort_order, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    body.belt_level,
    body.title,
    body.url,
    body.type,
    body.provider ?? null,
    body.sort_order ?? 0,
    user.id,
    now,
    now,
  )

  const created = db.prepare('SELECT * FROM escp_belt_courses WHERE id = ?').get(result.lastInsertRowid)
  return NextResponse.json({ course: created }, { status: 201 })
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
  const existing = db.prepare('SELECT * FROM escp_belt_courses WHERE id = ?').get(body.id) as any
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (body.belt_level !== undefined && !beltLevelExists(db, body.belt_level)) {
    return NextResponse.json({ error: 'Invalid belt_level' }, { status: 400 })
  }

  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    UPDATE escp_belt_courses SET
      belt_level = ?, title = ?, url = ?, type = ?, provider = ?, sort_order = ?, updated_at = ?
    WHERE id = ?
  `).run(
    body.belt_level ?? existing.belt_level,
    body.title ?? existing.title,
    body.url ?? existing.url,
    body.type ?? existing.type,
    body.provider !== undefined ? body.provider : existing.provider,
    body.sort_order ?? existing.sort_order,
    now,
    body.id,
  )

  const updated = db.prepare('SELECT * FROM escp_belt_courses WHERE id = ?').get(body.id)
  return NextResponse.json({ course: updated })
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
  const existing = db.prepare('SELECT id FROM escp_belt_courses WHERE id = ?').get(body.id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  db.prepare('DELETE FROM escp_belt_courses WHERE id = ?').run(body.id)
  return NextResponse.json({ ok: true })
}
