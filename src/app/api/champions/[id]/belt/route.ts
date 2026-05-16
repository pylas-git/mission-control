/**
 * Champion belt state API.
 *
 * GET  /api/champions/[id]/belt  — get champion's current belt + course progress
 * POST /api/champions/[id]/belt/courses/[courseId]/complete — mark a course complete (self-attest)
 *
 * Auto-advance: when all courses for belt N are completed, champion belt advances to N automatically.
 * Belt validity: 1 year from achievement. 30-day grace on expiry.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { normalizeRole } from '@/lib/authz'

const ONE_YEAR_S = 365 * 24 * 60 * 60
const GRACE_DAYS_S = 30 * 24 * 60 * 60

function computeBeltStatus(expires_at: number | null, grace_expires_at: number | null, now: number): 'active' | 'grace' | 'expired' {
  if (!expires_at) return 'active'
  if (now <= expires_at) return 'active'
  if (grace_expires_at && now <= grace_expires_at) return 'grace'
  return 'expired'
}

function canViewChampion(actorId: number, actorRole: string, targetId: number): boolean {
  if (actorRole === 'admin' || actorRole === 'global_champion') return true
  if (actorId === targetId) return true
  // regional champion can view champions in their region — checked by caller
  return false
}

function computeGapStatus(currentBelt: number, targetBelt: number | null, targetDate: number | null, now: number) {
  if (targetBelt == null || currentBelt >= targetBelt) return 'qualified'
  if (!targetDate) return 'gap'
  if (now > targetDate) return 'overdue'
  return 'gap'
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const targetId = parseInt(id, 10)
  if (isNaN(targetId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const role = normalizeRole(user.role)
  const db = getDatabase()

  // Regional champions can view champions in their own region
  if (!canViewChampion(user.id, role, targetId)) {
    if (role === 'regional_champion') {
      const sameRegion = db.prepare(`
        SELECT 1 FROM users u
        JOIN users actor ON actor.id = ?
        WHERE u.id = ? AND u.region_id = actor.region_id
      `).get(user.id, targetId)
      if (!sameRegion) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    } else {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const now = Math.floor(Date.now() / 1000)

  // Get or create champion belt state
  let belt = db.prepare('SELECT * FROM escp_champion_belts WHERE user_id = ?').get(targetId) as any
  if (!belt) {
    db.prepare('INSERT OR IGNORE INTO escp_champion_belts (user_id) VALUES (?)').run(targetId)
    belt = db.prepare('SELECT * FROM escp_champion_belts WHERE user_id = ?').get(targetId) as any
  }

  // Sync status
  const liveStatus = computeBeltStatus(belt.expires_at, belt.grace_expires_at, now)
  if (liveStatus !== belt.status) {
    db.prepare('UPDATE escp_champion_belts SET status = ? WHERE user_id = ?').run(liveStatus, targetId)
    belt.status = liveStatus
  }

  // Get course progress with course info, grouped by belt level
  const progress = db.prepare(`
    SELECT
      c.id as course_id, c.belt_level, c.title, c.url, c.type, c.provider, c.sort_order,
      COALESCE(p.status, 'not_started') as status,
      p.completed_at, p.completed_via, p.notes
    FROM escp_belt_courses c
    LEFT JOIN escp_champion_course_progress p ON p.course_id = c.id AND p.user_id = ?
    ORDER BY c.belt_level, c.sort_order, c.id
  `).all(targetId)

  const assignments = db.prepare(`
    SELECT
      p.id as project_id,
      p.name as project_name,
      p.target_belt,
      p.current_belt as project_current_belt,
      p.belt_expires_at,
      pc.is_primary,
      pc.belt_target_date,
      c.name as client_name,
      r.name as region_name
    FROM escp_project_champions pc
    JOIN escp_projects p ON p.id = pc.project_id
    JOIN escp_clients c ON c.id = p.client_id
    JOIN escp_regions r ON r.id = c.region_id
    WHERE pc.user_id = ?
    ORDER BY pc.is_primary DESC, p.name ASC
  `).all(targetId).map((assignment: any) => ({
    ...assignment,
    gap_status: computeGapStatus(belt.current_belt ?? 0, assignment.target_belt ?? 0, assignment.belt_target_date ?? null, now),
    belt_gap: Math.max(0, (assignment.target_belt ?? 0) - (belt.current_belt ?? 0)),
  }))

  return NextResponse.json({ belt, progress, assignments })
}

/**
 * Mark a course as complete for a champion (self-attest).
 * Triggers auto-advance check.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const targetId = parseInt(id, 10)
  if (isNaN(targetId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const role = normalizeRole(user.role)

  // Only the champion themselves, regional/global champion, or admin can mark complete
  if (user.id !== targetId && role !== 'admin' && role !== 'global_champion' && role !== 'regional_champion') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const courseId = parseInt(body?.course_id, 10)
  if (isNaN(courseId)) return NextResponse.json({ error: 'course_id required' }, { status: 400 })

  const db = getDatabase()

  const course = db.prepare('SELECT * FROM escp_belt_courses WHERE id = ?').get(courseId) as any
  if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 })

  const now = Math.floor(Date.now() / 1000)

  // Upsert progress
  db.prepare(`
    INSERT INTO escp_champion_course_progress (user_id, course_id, status, completed_at, completed_via, notes)
    VALUES (?, ?, 'completed', ?, 'manual', ?)
    ON CONFLICT(user_id, course_id) DO UPDATE SET
      status = 'completed', completed_at = excluded.completed_at,
      completed_via = 'manual', notes = excluded.notes
  `).run(targetId, courseId, now, body?.notes ?? null)

  // Auto-advance check: did the champion just complete all courses for this belt level?
  const total = db.prepare('SELECT COUNT(*) as n FROM escp_belt_courses WHERE belt_level = ?').get(course.belt_level) as { n: number }
  const done = db.prepare(`
    SELECT COUNT(*) as n FROM escp_champion_course_progress p
    JOIN escp_belt_courses c ON c.id = p.course_id
    WHERE p.user_id = ? AND c.belt_level = ? AND p.status = 'completed'
  `).get(targetId, course.belt_level) as { n: number }

  let advanced = false
  if (total.n > 0 && done.n >= total.n) {
    // Ensure or create champion belt row
    db.prepare('INSERT OR IGNORE INTO escp_champion_belts (user_id) VALUES (?)').run(targetId)
    const belt = db.prepare('SELECT * FROM escp_champion_belts WHERE user_id = ?').get(targetId) as any

    // Advance only if this belt level is higher than current and sequential gate is met
    if (course.belt_level === belt.current_belt + 1 || (course.belt_level === 0 && belt.current_belt === 0)) {
      const achieved = now
      const expires = achieved + ONE_YEAR_S
      const grace = expires + GRACE_DAYS_S
      db.prepare(`
        UPDATE escp_champion_belts SET
          current_belt = ?, achieved_at = ?, expires_at = ?, grace_expires_at = ?, status = 'active', verified_by = NULL
        WHERE user_id = ?
      `).run(course.belt_level, achieved, expires, grace, targetId)
      advanced = true
    }
  }

  const belt = db.prepare('SELECT * FROM escp_champion_belts WHERE user_id = ?').get(targetId)
  return NextResponse.json({ ok: true, advanced, belt })
}
