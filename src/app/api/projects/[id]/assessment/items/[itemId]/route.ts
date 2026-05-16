/**
 * Assessment item status transitions.
 *
 * PUT /api/projects/[id]/assessment/items/[itemId]
 *
 * Transitions:
 *   security_champion (primary owner):   not_started/rejected → in_progress, in_progress → submitted (requires evidence)
 *   regional_champion / global / admin:  submitted → approved | rejected (rejection requires reason)
 *
 * On final item approved: auto-advance project current_belt if all items for belts 0..N are approved.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { normalizeRole, getUserRegionId } from '@/lib/authz'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'

const ONE_YEAR_S = 365 * 24 * 60 * 60
const GRACE_DAYS_S = 30 * 24 * 60 * 60

const transitionSchema = z.object({
  status: z.enum(['in_progress', 'submitted', 'approved', 'rejected']),
  evidence_url: z.string().url().max(1000).optional(),
  evidence_note: z.string().max(2000).optional(),
  rejection_reason: z.string().min(1).max(2000).optional(),
})

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, itemId } = await params
  const projectId = parseInt(id, 10)
  const itemIdNum = parseInt(itemId, 10)
  if (isNaN(projectId) || isNaN(itemIdNum)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const parsed = await validateBody(request, transitionSchema)
  if ('error' in parsed) return parsed.error
  const body = parsed.data

  const db = getDatabase()
  const role = normalizeRole(user.role)

  // Load item with cycle + project
  const item = db.prepare(`
    SELECT i.*, a.project_id, a.belt_level as cycle_belt, a.primary_champion_id
    FROM escp_project_assessment_items i
    JOIN escp_project_assessments a ON a.id = i.assessment_id
    WHERE i.id = ? AND a.project_id = ?
  `).get(itemIdNum, projectId) as any
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (item.is_in_scope === 0) {
    return NextResponse.json({ error: 'Item is out of scope' }, { status: 422 })
  }

  const now = Math.floor(Date.now() / 1000)

  // ── Transition rules ─────────────────────────────────────────────────────
  if (body.status === 'in_progress') {
    // Anyone with project access can start an item
    if (item.status !== 'not_started' && item.status !== 'rejected') {
      return NextResponse.json({ error: `Cannot move to in_progress from ${item.status}` }, { status: 422 })
    }
    db.prepare(`
      UPDATE escp_project_assessment_items SET status = 'in_progress' WHERE id = ?
    `).run(itemIdNum)
  } else if (body.status === 'submitted') {
    if (item.status !== 'in_progress') {
      return NextResponse.json({ error: 'Item must be in_progress before submitting' }, { status: 422 })
    }
    // Must supply at least one evidence field
    if (!body.evidence_url && !body.evidence_note) {
      return NextResponse.json({ error: 'Evidence (url or note) is required when submitting' }, { status: 422 })
    }
    // Must be primary champion, or regional/global/admin
    const isChampion = user.id === item.primary_champion_id
    const canSubmit = isChampion || role === 'admin' || role === 'global_champion' || role === 'regional_champion'
    if (!canSubmit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    db.prepare(`
      UPDATE escp_project_assessment_items SET
        status = 'submitted', submitted_by = ?, submitted_at = ?,
        evidence_url = ?, evidence_note = ?
      WHERE id = ?
    `).run(user.id, now, body.evidence_url ?? null, body.evidence_note ?? null, itemIdNum)
  } else if (body.status === 'approved') {
    if (item.status !== 'submitted') {
      return NextResponse.json({ error: 'Item must be submitted before approving' }, { status: 422 })
    }
    if (role !== 'admin' && role !== 'global_champion' && role !== 'regional_champion') {
      return NextResponse.json({ error: 'Forbidden — only regional/global champion or admin can approve' }, { status: 403 })
    }

    db.prepare(`
      UPDATE escp_project_assessment_items SET
        status = 'approved', reviewed_by = ?, reviewed_at = ?, rejection_reason = NULL
      WHERE id = ?
    `).run(user.id, now, itemIdNum)

    // ── Auto-advance project belt ──────────────────────────────────────────
    tryAdvanceProjectBelt(db, item.assessment_id, projectId, item.cycle_belt, now)
  } else if (body.status === 'rejected') {
    if (item.status !== 'submitted') {
      return NextResponse.json({ error: 'Item must be submitted before rejecting' }, { status: 422 })
    }
    if (role !== 'admin' && role !== 'global_champion' && role !== 'regional_champion') {
      return NextResponse.json({ error: 'Forbidden — only regional/global champion or admin can reject' }, { status: 403 })
    }
    if (!body.rejection_reason) {
      return NextResponse.json({ error: 'rejection_reason is required when rejecting' }, { status: 422 })
    }

    db.prepare(`
      UPDATE escp_project_assessment_items SET
        status = 'rejected', reviewed_by = ?, reviewed_at = ?, rejection_reason = ?
      WHERE id = ?
    `).run(user.id, now, body.rejection_reason, itemIdNum)
  }

  const updated = db.prepare('SELECT * FROM escp_project_assessment_items WHERE id = ?').get(itemIdNum)
  const project = db.prepare('SELECT id, current_belt, target_belt, belt_achieved_at, belt_expires_at FROM escp_projects WHERE id = ?').get(projectId)
  return NextResponse.json({ item: updated, project })
}

function tryAdvanceProjectBelt(db: any, assessmentId: number, projectId: number, cycleBelt: number, now: number) {
  // Count total in-scope items 0..cycleBelt vs approved items
  const cycle = db.prepare('SELECT * FROM escp_project_assessments WHERE id = ?').get(assessmentId) as any
  if (!cycle) return

  const total = db.prepare(`
    SELECT COUNT(*) as n FROM escp_project_assessment_items
    WHERE assessment_id = ? AND is_in_scope = 1 AND belt_level <= ?
  `).get(assessmentId, cycleBelt) as { n: number }

  const approved = db.prepare(`
    SELECT COUNT(*) as n FROM escp_project_assessment_items
    WHERE assessment_id = ? AND is_in_scope = 1 AND belt_level <= ? AND status = 'approved'
  `).get(assessmentId, cycleBelt) as { n: number }

  if (total.n === 0 || approved.n < total.n) return

  // Advance!
  const achieved = now
  const expires = achieved + ONE_YEAR_S
  const grace = expires + GRACE_DAYS_S

  db.transaction(() => {
    db.prepare(`
      UPDATE escp_project_assessments SET achieved_at = ?, expires_at = ?, grace_expires_at = ? WHERE id = ?
    `).run(achieved, expires, grace, assessmentId)

    db.prepare(`
      UPDATE escp_projects SET current_belt = ?, belt_achieved_at = ?, belt_expires_at = ?, belt_grace_expires_at = ?, updated_at = ?
      WHERE id = ? AND (current_belt < ? OR current_belt IS NULL)
    `).run(cycleBelt, achieved, expires, grace, now, projectId, cycleBelt)
  })()
}
