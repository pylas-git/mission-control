import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { normalizeRole } from '@/lib/authz'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'

const createBeltSchema = z.object({
  level: z.number().int().min(0),
  color: z.string().min(1).max(32),
  name: z.string().min(1).max(64),
  description: z.string().max(2000).optional(),
})

const deleteBeltSchema = z.object({
  level: z.number().int().min(0),
})

function canManage(role: string) {
  return role === 'admin' || role === 'global_champion'
}

function referenceCounts(db: ReturnType<typeof getDatabase>, level: number) {
  const checks: Array<{ key: string; label: string; sql: string; params: unknown[] }> = [
    { key: 'requirements', label: 'requirements', sql: 'SELECT COUNT(*) as n FROM escp_belt_requirements WHERE belt_level = ?', params: [level] },
    { key: 'courses', label: 'training materials', sql: 'SELECT COUNT(*) as n FROM escp_belt_courses WHERE belt_level = ?', params: [level] },
    { key: 'champion_state', label: 'champion belt states', sql: 'SELECT COUNT(*) as n FROM escp_champion_belts WHERE current_belt = ?', params: [level] },
    { key: 'projects_target', label: 'project target belts', sql: 'SELECT COUNT(*) as n FROM escp_projects WHERE target_belt = ?', params: [level] },
    { key: 'projects_current', label: 'project current belts', sql: 'SELECT COUNT(*) as n FROM escp_projects WHERE current_belt = ?', params: [level] },
    { key: 'assessments', label: 'assessment cycles', sql: 'SELECT COUNT(*) as n FROM escp_project_assessments WHERE belt_level = ?', params: [level] },
    { key: 'assessment_items', label: 'assessment items', sql: 'SELECT COUNT(*) as n FROM escp_project_assessment_items WHERE belt_level = ?', params: [level] },
    { key: 'waivers', label: 'qualification waivers', sql: 'SELECT COUNT(*) as n FROM escp_qualification_waivers WHERE remediation_target_belt = ?', params: [level] },
    { key: 'skip_from', label: 'belt skip requests (from)', sql: 'SELECT COUNT(*) as n FROM escp_belt_skip_requests WHERE from_belt = ?', params: [level] },
    { key: 'skip_to', label: 'belt skip requests (to)', sql: 'SELECT COUNT(*) as n FROM escp_belt_skip_requests WHERE to_belt = ?', params: [level] },
  ]

  const reasons: Array<{ key: string; label: string; count: number }> = []
  for (const check of checks) {
    try {
      const row = db.prepare(check.sql).get(...check.params) as { n?: number } | undefined
      const count = row?.n ?? 0
      if (count > 0) reasons.push({ key: check.key, label: check.label, count })
    } catch {
      // Ignore optional/legacy-table lookup failures.
    }
  }
  return reasons
}

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getDatabase()
  const belts = db.prepare('SELECT level, color, name, description, created_at, updated_at FROM escp_belts ORDER BY level ASC').all()
  return NextResponse.json({ belts })
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = normalizeRole(user.role)
  if (!canManage(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const parsed = await validateBody(request, createBeltSchema)
  if ('error' in parsed) return parsed.error

  const { level, color, name, description } = parsed.data
  const db = getDatabase()

  try {
    db.prepare(`
      INSERT INTO escp_belts (level, color, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, unixepoch(), unixepoch())
    `).run(level, color.trim(), name.trim(), description?.trim() || null)
  } catch (err: any) {
    const message = String(err?.message || '')
    if (message.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Belt level or name already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create belt' }, { status: 500 })
  }

  const belt = db.prepare('SELECT level, color, name, description, created_at, updated_at FROM escp_belts WHERE level = ?').get(level)
  return NextResponse.json({ belt }, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = normalizeRole(user.role)
  if (!canManage(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const parsed = await validateBody(request, deleteBeltSchema)
  if ('error' in parsed) return parsed.error

  const { level } = parsed.data
  const db = getDatabase()
  const existing = db.prepare('SELECT level, name FROM escp_belts WHERE level = ?').get(level) as { level: number; name: string } | undefined
  if (!existing) return NextResponse.json({ error: 'Belt not found' }, { status: 404 })

  const blockers = referenceCounts(db, level)
  if (blockers.length > 0) {
    return NextResponse.json({
      error: 'Cannot delete belt because it is referenced by existing data',
      blockers,
    }, { status: 409 })
  }

  db.prepare('DELETE FROM escp_belts WHERE level = ?').run(level)
  return NextResponse.json({ ok: true })
}
