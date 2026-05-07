/**
 * Invitations API — Phase 3 of the Better Auth migration.
 *
 * Invitations are the only way (besides the bootstrap admin) to create a user.
 * The token is shown ONCE at creation time and stored hashed.
 *
 * Permissions:
 *   GET    — admin, global_champion (all); regional_champion (own region)
 *   POST   — admin, global_champion (any region/role <= GSC);
 *            regional_champion (own region, role <= SC)
 *   DELETE — same as POST scope
 */

import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { canManageRegion, normalizeRole, type EscpRole } from '@/lib/authz'
import { hashInvitationToken } from '@/lib/auth-v2'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

const ASSIGNABLE_ROLES: EscpRole[] = ['global_champion', 'regional_champion', 'security_champion']

const createInvitationSchema = z.object({
  email: z.string().email().max(254),
  role: z.enum(ASSIGNABLE_ROLES as [EscpRole, ...EscpRole[]]),
  region_id: z.number().int().positive().nullable().optional(),
  intended_project_ids: z.array(z.number().int().positive()).optional(),
  expires_in_days: z.number().int().min(1).max(30).optional(),
})

interface InviteRow {
  id: number
  email: string
  role: string
  region_id: number | null
  region_name: string | null
  intended_project_ids: string | null
  invited_by: number
  invited_by_name: string | null
  created_at: number
  expires_at: number
  accepted_at: number | null
  accepted_user_id: number | null
  revoked_at: number | null
  revoked_by: number | null
}

function serializeInvite(row: InviteRow) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    region_id: row.region_id,
    region_name: row.region_name,
    intended_project_ids: row.intended_project_ids ? JSON.parse(row.intended_project_ids) : [],
    invited_by: row.invited_by,
    invited_by_name: row.invited_by_name,
    created_at: row.created_at,
    expires_at: row.expires_at,
    accepted_at: row.accepted_at,
    accepted_user_id: row.accepted_user_id,
    revoked_at: row.revoked_at,
    revoked_by: row.revoked_by,
    status: row.revoked_at
      ? 'revoked'
      : row.accepted_at
      ? 'accepted'
      : row.expires_at < Math.floor(Date.now() / 1000)
      ? 'expired'
      : 'pending',
  }
}

/**
 * GET /api/invitations
 * Lists invitations visible to the caller.
 */
export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = normalizeRole(user.role)
  if (role === 'security_champion') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = getDatabase()
  const rows = db.prepare(`
    SELECT i.*, u.display_name as invited_by_name, r.name as region_name
    FROM escp_invitations i
    LEFT JOIN users u ON u.id = i.invited_by
    LEFT JOIN escp_regions r ON r.id = i.region_id
    ORDER BY i.created_at DESC
  `).all() as InviteRow[]

  // Regional champions only see their region's invitations.
  const filtered = rows.filter((row) => canManageRegion(user, row.region_id))
  return NextResponse.json({ invitations: filtered.map(serializeInvite) })
}

/**
 * POST /api/invitations
 * Creates a new invitation. Returns the raw token EXACTLY once.
 */
export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const callerRole = normalizeRole(user.role)
  if (callerRole === 'security_champion') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, createInvitationSchema)
  if ('error' in result) return result.error
  const data = result.data

  // Email domain enforcement matches the SSO invite-gate.
  if (!data.email.toLowerCase().endsWith('@endava.com')) {
    return NextResponse.json({ error: 'Email must be @endava.com' }, { status: 400 })
  }

  // Caller must have authority over the target region.
  const targetRegionId = data.region_id ?? null

  if ((data.role === 'security_champion' || data.role === 'regional_champion') && !targetRegionId) {
    return NextResponse.json({ error: 'region_id is required for this role' }, { status: 400 })
  }

  if (!canManageRegion(user, targetRegionId)) {
    return NextResponse.json({ error: 'You cannot invite to that region' }, { status: 403 })
  }

  // Regional champions can only invite security_champions in their region.
  if (callerRole === 'regional_champion' && data.role !== 'security_champion') {
    return NextResponse.json(
      { error: 'Regional champions can only invite security champions' },
      { status: 403 }
    )
  }

  // Global champions can invite GSC/RSC/SC, but only admin can invite admins
  // (admin role is not in ASSIGNABLE_ROLES, so this is enforced by the schema).
  // Regional champion role requires a region_id.
  if (data.role === 'regional_champion' && !targetRegionId) {
    return NextResponse.json(
      { error: 'regional_champion role requires a region_id' },
      { status: 400 }
    )
  }

  const db = getDatabase()
  const expiresAt = Math.floor(Date.now() / 1000) + (data.expires_in_days ?? 7) * 24 * 60 * 60
  const rawToken = randomBytes(32).toString('hex')
  const tokenHash = hashInvitationToken(rawToken)

  // The global API key returns a synthetic user with id=0 which doesn't exist in
  // the users table, causing a FK constraint failure. Resolve to the first real admin.
  let invitedById: number | null = user.id ?? null
  if (!invitedById) {
    const admin = db.prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`).get() as { id: number } | undefined
    invitedById = admin?.id ?? null
  }

  try {
    const insertResult = db.prepare(`
      INSERT INTO escp_invitations (
        email, role, region_id, intended_project_ids,
        token_hash, invited_by, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.email.toLowerCase(),
      data.role,
      targetRegionId,
      data.intended_project_ids ? JSON.stringify(data.intended_project_ids) : null,
      tokenHash,
      invitedById,
      expiresAt,
    )

    const invitationId = Number(insertResult.lastInsertRowid)
    logAuditEvent({
      action: 'invitation_create',
      actor: user.username,
      actor_id: user.id,
      target_type: 'invitation',
      target_id: invitationId,
      detail: { email: data.email, role: data.role, region_id: targetRegionId },
      ip_address: request.headers.get('x-real-ip') || 'unknown',
    })

    return NextResponse.json({
      invitation: {
        id: invitationId,
        email: data.email.toLowerCase(),
        role: data.role,
        region_id: targetRegionId,
        expires_at: expiresAt,
        status: 'pending',
      },
      // Show the raw token + URL ONCE. The admin must share this securely.
      token: rawToken,
      invite_url: `${request.nextUrl.origin}/invite/${rawToken}`,
    }, { status: 201 })
  } catch (err) {
    logger.error({ err }, 'POST /api/invitations failed')
    return NextResponse.json({ error: 'Failed to create invitation' }, { status: 500 })
  }
}
