/**
 * Qualification waivers API — allows an unqualified champion to be assigned as
 * primary assessment owner with global champion approval.
 *
 * POST /api/qualification-waivers          — request waiver (regional_champion)
 * GET  /api/qualification-waivers          — list waivers (global/admin)
 * PUT  /api/qualification-waivers          — approve/reject (global_champion, admin)
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
  project_id: z.number().int().positive(),
  champion_user_id: z.number().int().positive(),
  expires_at: z.number().int().positive(),
  remediation_target_belt: z.number().int(),
  remediation_due_date: z.number().int().positive(),
  remediation_notes: z.string().max(2000).optional(),
})

const reviewSchema = z.object({
  id: z.number().int().positive(),
  action: z.enum(['approved', 'rejected']),
})

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = normalizeRole(user.role)
  if (role !== 'admin' && role !== 'global_champion') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = getDatabase()
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') ?? 'pending'

  const rows = db.prepare(`
    SELECT w.*,
      p.name as project_name,
      COALESCE(u.display_name, u.username) as champion_name, u.email as champion_email,
      COALESCE(req.display_name, req.username) as requested_by_name
    FROM escp_qualification_waivers w
    JOIN escp_projects p ON p.id = w.project_id
    JOIN users u ON u.id = w.champion_user_id
    JOIN users req ON req.id = w.requested_by
    WHERE w.status = ?
    ORDER BY w.requested_at DESC
  `).all(status)

  return NextResponse.json({ waivers: rows })
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = normalizeRole(user.role)
  if (role !== 'admin' && role !== 'global_champion' && role !== 'regional_champion') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const parsed = await validateBody(request, createSchema)
  if ('error' in parsed) return parsed.error
  const body = parsed.data

  const db = getDatabase()
  if (!beltLevelExists(db, body.remediation_target_belt)) {
    return NextResponse.json({ error: 'Invalid remediation_target_belt' }, { status: 400 })
  }

  const project = db.prepare('SELECT id FROM escp_projects WHERE id = ?').get(body.project_id)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const champion = db.prepare('SELECT id FROM users WHERE id = ?').get(body.champion_user_id)
  if (!champion) return NextResponse.json({ error: 'Champion user not found' }, { status: 404 })

  // No duplicate pending waivers
  const existing = db.prepare(`
    SELECT id FROM escp_qualification_waivers
    WHERE project_id = ? AND champion_user_id = ? AND status = 'pending'
  `).get(body.project_id, body.champion_user_id)
  if (existing) {
    return NextResponse.json({ error: 'A pending waiver already exists for this champion on this project' }, { status: 409 })
  }

  const result = db.prepare(`
    INSERT INTO escp_qualification_waivers
      (project_id, champion_user_id, requested_by, expires_at, remediation_target_belt, remediation_due_date, remediation_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    body.project_id,
    body.champion_user_id,
    user.id,
    body.expires_at,
    body.remediation_target_belt,
    body.remediation_due_date,
    body.remediation_notes ?? null,
  )

  const created = db.prepare('SELECT * FROM escp_qualification_waivers WHERE id = ?').get(result.lastInsertRowid)
  return NextResponse.json({ waiver: created }, { status: 201 })
}

export async function PUT(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = normalizeRole(user.role)
  if (role !== 'admin' && role !== 'global_champion') {
    return NextResponse.json({ error: 'Forbidden — only global champion or admin can approve/reject waivers' }, { status: 403 })
  }

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const parsed = await validateBody(request, reviewSchema)
  if ('error' in parsed) return parsed.error
  const body = parsed.data

  const db = getDatabase()
  const waiver = db.prepare('SELECT * FROM escp_qualification_waivers WHERE id = ?').get(body.id) as any
  if (!waiver) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (waiver.status !== 'pending') {
    return NextResponse.json({ error: 'Waiver is no longer pending' }, { status: 409 })
  }

  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    UPDATE escp_qualification_waivers SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?
  `).run(body.action, user.id, now, body.id)

  const updated = db.prepare('SELECT * FROM escp_qualification_waivers WHERE id = ?').get(body.id)
  return NextResponse.json({ waiver: updated })
}
