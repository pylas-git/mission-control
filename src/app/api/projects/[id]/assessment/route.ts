/**
 * Project assessment cycles API.
 *
 * GET  /api/projects/[id]/assessment  — get active assessment cycle(s) for a project
 * POST /api/projects/[id]/assessment  — create or open a new assessment cycle
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { normalizeRole, getUserRegionId } from '@/lib/authz'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { beltLevelExists } from '@/lib/escp-belts'

const ONE_YEAR_S = 365 * 24 * 60 * 60
const GRACE_DAYS_S = 30 * 24 * 60 * 60
const RENEWAL_WINDOW_S = 30 * 24 * 60 * 60

const createCycleSchema = z.object({
  belt_level: z.number().int(),
  primary_champion_id: z.number().int().positive().optional(),
})

function canManageProject(db: any, role: string, userId: number, projectId: number): boolean {
  if (role === 'admin' || role === 'global_champion') return true
  if (role === 'regional_champion') {
    const regionId = getUserRegionId(userId)
    if (!regionId) return false
    const project = db.prepare(`
      SELECT p.id FROM escp_projects p
      JOIN escp_clients c ON c.id = p.client_id
      WHERE p.id = ? AND c.region_id = ?
    `).get(projectId, regionId)
    return !!project
  }
  return false
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const projectId = parseInt(id, 10)
  if (isNaN(projectId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const db = getDatabase()
  // Project must exist and actor must have access
  const project = db.prepare('SELECT * FROM escp_projects WHERE id = ?').get(projectId) as any
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const now = Math.floor(Date.now() / 1000)

  // Update expiry statuses before returning
  const cycles = db.prepare(`
    SELECT a.*, COALESCE(u.display_name, u.username) as primary_champion_name
    FROM escp_project_assessments a
    LEFT JOIN users u ON u.id = a.primary_champion_id
    WHERE a.project_id = ?
    ORDER BY a.belt_level, a.started_at DESC
  `).all(projectId) as any[]

  for (const cycle of cycles) {
    let newStatus = cycle.status
    if (cycle.achieved_at && cycle.expires_at) {
      if (now > (cycle.grace_expires_at ?? cycle.expires_at)) {
        newStatus = 'expired'
      } else if (now > cycle.expires_at) {
        newStatus = 'grace'
      } else if (now >= cycle.expires_at - RENEWAL_WINDOW_S) {
        if (newStatus === 'active') newStatus = 'renewal_open'
      }
    }
    if (newStatus !== cycle.status) {
      db.prepare('UPDATE escp_project_assessments SET status = ? WHERE id = ?').run(newStatus, cycle.id)
      cycle.status = newStatus
    }
  }

  // Get items for all cycles
  const items = db.prepare(`
    SELECT i.* FROM escp_project_assessment_items i
    JOIN escp_project_assessments a ON a.id = i.assessment_id
    WHERE a.project_id = ?
    ORDER BY i.assessment_id, i.belt_level, i.sort_order, i.id
  `).all(projectId)

  return NextResponse.json({ project, cycles, items })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const projectId = parseInt(id, 10)
  if (isNaN(projectId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const role = normalizeRole(user.role)
  const db = getDatabase()

  if (!canManageProject(db, role, user.id, projectId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const parsed = await validateBody(request, createCycleSchema)
  if ('error' in parsed) return parsed.error
  const body = parsed.data

  if (!beltLevelExists(db, body.belt_level)) {
    return NextResponse.json({ error: 'Invalid belt_level' }, { status: 400 })
  }

  const project = db.prepare('SELECT * FROM escp_projects WHERE id = ?').get(projectId) as any
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Validate primary champion qualification if provided
  if (body.primary_champion_id) {
    const belt = db.prepare('SELECT * FROM escp_champion_belts WHERE user_id = ?').get(body.primary_champion_id) as any
    const now = Math.floor(Date.now() / 1000)
    const currentBelt = belt?.current_belt ?? 0
    const isQualified = currentBelt >= body.belt_level &&
      (!belt?.expires_at || now <= (belt?.grace_expires_at ?? belt?.expires_at))

    // Check for approved waiver if not qualified
    if (!isQualified) {
      const waiver = db.prepare(`
        SELECT id FROM escp_qualification_waivers
        WHERE project_id = ? AND champion_user_id = ? AND status = 'approved'
        AND (expires_at IS NULL OR expires_at > ?)
      `).get(projectId, body.primary_champion_id, now)
      if (!waiver) {
        return NextResponse.json(
          { error: 'Primary champion does not meet belt qualification for this project. Request a qualification waiver first.' },
          { status: 422 }
        )
      }
    }
  }

  // Check no active cycle for this belt level already
  const existing = db.prepare(`
    SELECT id FROM escp_project_assessments
    WHERE project_id = ? AND belt_level = ? AND status IN ('active', 'renewal_open', 'grace')
  `).get(projectId, body.belt_level)
  if (existing) {
    return NextResponse.json({ error: 'An active assessment cycle already exists for this belt level' }, { status: 409 })
  }

  const now = Math.floor(Date.now() / 1000)

  // Create cycle
  const cycleResult = db.prepare(`
    INSERT INTO escp_project_assessments (project_id, belt_level, primary_champion_id, started_at)
    VALUES (?, ?, ?, ?)
  `).run(projectId, body.belt_level, body.primary_champion_id ?? null, now)

  const cycleId = cycleResult.lastInsertRowid

  // Snapshot requirements for belts 0..belt_level into items
  const requirements = db.prepare(`
    SELECT * FROM escp_belt_requirements WHERE belt_level <= ? ORDER BY belt_level, sort_order, id
  `).all(body.belt_level) as any[]

  const insertItem = db.prepare(`
    INSERT INTO escp_project_assessment_items
      (assessment_id, requirement_id, belt_level, title, description, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  db.transaction(() => {
    for (const req of requirements) {
      insertItem.run(cycleId, req.id, req.belt_level, req.title, req.description ?? null, req.sort_order)
    }
  })()

  const cycle = db.prepare('SELECT * FROM escp_project_assessments WHERE id = ?').get(cycleId)
  const items = db.prepare('SELECT * FROM escp_project_assessment_items WHERE assessment_id = ? ORDER BY belt_level, sort_order').all(cycleId)

  return NextResponse.json({ cycle, items }, { status: 201 })
}
