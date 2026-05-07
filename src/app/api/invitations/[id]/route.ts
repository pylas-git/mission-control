/**
 * DELETE /api/invitations/[id] — revoke a pending invitation.
 *
 * Permissions: admin, global_champion, regional_champion (own region).
 * Already-accepted invitations cannot be revoked (delete the user instead).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { canManageRegion, normalizeRole } from '@/lib/authz'

interface InviteRow {
  id: number
  email: string
  region_id: number | null
  accepted_at: number | null
  revoked_at: number | null
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (normalizeRole(user.role) === 'security_champion') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: idParam } = await params
  const id = Number(idParam)
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const db = getDatabase()
  const invite = db.prepare(`
    SELECT id, email, region_id, accepted_at, revoked_at
    FROM escp_invitations WHERE id = ?
  `).get(id) as InviteRow | undefined

  if (!invite) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (invite.accepted_at) {
    return NextResponse.json({ error: 'Cannot revoke an accepted invitation' }, { status: 409 })
  }
  if (invite.revoked_at) {
    return NextResponse.json({ error: 'Already revoked' }, { status: 409 })
  }

  if (!canManageRegion(user, invite.region_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const now = Math.floor(Date.now() / 1000)
  db.prepare(`UPDATE escp_invitations SET revoked_at = ?, revoked_by = ? WHERE id = ?`)
    .run(now, user.id, id)

  logAuditEvent({
    action: 'invitation_revoke',
    actor: user.username,
    actor_id: user.id,
    target_type: 'invitation',
    target_id: id,
    detail: { email: invite.email },
    ip_address: request.headers.get('x-real-ip') || 'unknown',
  })

  return NextResponse.json({ success: true })
}
