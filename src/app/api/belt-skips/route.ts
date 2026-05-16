/**
 * Belt skip request API — regional champion proposes, global champion approves.
 *
 * POST /api/belt-skips          — create skip request (regional_champion or admin)
 * GET  /api/belt-skips          — list pending skip requests (global_champion, admin)
 * PUT  /api/belt-skips          — approve or reject (global_champion, admin)
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { normalizeRole } from '@/lib/authz'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { beltLevelExists } from '@/lib/escp-belts'

const ONE_YEAR_S = 365 * 24 * 60 * 60
const GRACE_DAYS_S = 30 * 24 * 60 * 60

const createSchema = z.object({
  user_id: z.number().int().positive(),
  from_belt: z.number().int(),
  to_belt: z.number().int(),
  reason_text: z.string().min(1).max(2000),
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
      SELECT r.*, COALESCE(u.display_name, u.username) as user_name, u.email as user_email,
        COALESCE(req.display_name, req.username) as requested_by_name
    FROM escp_belt_skip_requests r
    JOIN users u ON u.id = r.user_id
    JOIN users req ON req.id = r.requested_by
    WHERE r.status = ?
    ORDER BY r.requested_at DESC
  `).all(status)

  return NextResponse.json({ skip_requests: rows })
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

  if (body.to_belt <= body.from_belt) {
    return NextResponse.json({ error: 'to_belt must be greater than from_belt' }, { status: 400 })
  }

  const db = getDatabase()
  if (!beltLevelExists(db, body.from_belt) || !beltLevelExists(db, body.to_belt)) {
    return NextResponse.json({ error: 'Invalid from_belt or to_belt' }, { status: 400 })
  }

  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(body.user_id)
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // Check no pending request already exists for this user + belt range
  const existing = db.prepare(`
    SELECT id FROM escp_belt_skip_requests
    WHERE user_id = ? AND from_belt = ? AND to_belt = ? AND status = 'pending'
  `).get(body.user_id, body.from_belt, body.to_belt)
  if (existing) {
    return NextResponse.json({ error: 'A pending skip request already exists for this belt range' }, { status: 409 })
  }

  const result = db.prepare(`
    INSERT INTO escp_belt_skip_requests (user_id, from_belt, to_belt, requested_by, reason_text)
    VALUES (?, ?, ?, ?, ?)
  `).run(body.user_id, body.from_belt, body.to_belt, user.id, body.reason_text)

  const created = db.prepare('SELECT * FROM escp_belt_skip_requests WHERE id = ?').get(result.lastInsertRowid)
  return NextResponse.json({ skip_request: created }, { status: 201 })
}

export async function PUT(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = normalizeRole(user.role)
  if (role !== 'admin' && role !== 'global_champion') {
    return NextResponse.json({ error: 'Forbidden — only global champion or admin can approve/reject' }, { status: 403 })
  }

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const parsed = await validateBody(request, reviewSchema)
  if ('error' in parsed) return parsed.error
  const body = parsed.data

  const db = getDatabase()
  const skipReq = db.prepare('SELECT * FROM escp_belt_skip_requests WHERE id = ?').get(body.id) as any
  if (!skipReq) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (skipReq.status !== 'pending') {
    return NextResponse.json({ error: 'Request is no longer pending' }, { status: 409 })
  }

  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    UPDATE escp_belt_skip_requests SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?
  `).run(body.action, user.id, now, body.id)

  // On approval: advance champion's current_belt to to_belt
  if (body.action === 'approved') {
    db.prepare('INSERT OR IGNORE INTO escp_champion_belts (user_id) VALUES (?)').run(skipReq.user_id)
    const achieved = now
    const expires = achieved + ONE_YEAR_S
    const grace = expires + GRACE_DAYS_S
    db.prepare(`
      UPDATE escp_champion_belts SET
        current_belt = ?, achieved_at = ?, expires_at = ?, grace_expires_at = ?, status = 'active', verified_by = ?
      WHERE user_id = ?
    `).run(skipReq.to_belt, achieved, expires, grace, user.id, skipReq.user_id)
  }

  const updated = db.prepare('SELECT * FROM escp_belt_skip_requests WHERE id = ?').get(body.id)
  return NextResponse.json({ skip_request: updated })
}
