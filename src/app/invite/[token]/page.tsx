/**
 * Invitation landing page — /invite/[token]
 *
 * Looks up the invitation by hashed token (server-side), then either:
 *  - shows "Sign in with Microsoft" CTA (status pending), or
 *  - shows an error (revoked / expired / accepted / not found).
 *
 * The token is bound to the session via a short-lived signed cookie so that
 * the OIDC callback's user.create.before hook can correlate it with the
 * incoming Microsoft profile.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getDatabase } from '@/lib/db'
import { hashInvitationToken } from '@/lib/auth-v2'
import { isAuthV2Enabled } from '@/lib/feature-flags'

interface InviteRow {
  id: number
  email: string
  role: string
  region_id: number | null
  expires_at: number
  accepted_at: number | null
  revoked_at: number | null
}

interface RegionRow { name: string }

const INVITE_COOKIE_NAME = 'escp_invite_ctx'
const INVITE_COOKIE_TTL_SECONDS = 30 * 60 // 30m to complete the SSO round-trip

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  if (!isAuthV2Enabled()) {
    redirect('/')
  }

  const { token } = await params
  const tokenHash = hashInvitationToken(token)
  const db = getDatabase()
  const invite = db.prepare(`
    SELECT id, email, role, region_id, expires_at, accepted_at, revoked_at
    FROM escp_invitations WHERE token_hash = ?
  `).get(tokenHash) as InviteRow | undefined

  if (!invite) return <InviteError title="Invitation not found" body="The invitation link is invalid." />
  if (invite.revoked_at) return <InviteError title="Invitation revoked" body="This invitation has been revoked. Contact your administrator for a new one." />
  if (invite.accepted_at) return <InviteError title="Already accepted" body="This invitation has already been used. Sign in normally instead." />
  const now = Math.floor(Date.now() / 1000)
  if (invite.expires_at < now) return <InviteError title="Invitation expired" body="This invitation has expired. Contact your administrator for a new one." />

  let regionName: string | null = null
  if (invite.region_id) {
    const r = db.prepare(`SELECT name FROM escp_regions WHERE id = ?`).get(invite.region_id) as RegionRow | undefined
    regionName = r?.name || null
  }

  // Bind the invitation to this browser via a short-lived cookie. The OIDC
  // callback hook reads this to confirm the email matches the invitation.
  const cookieStore = await cookies()
  cookieStore.set(INVITE_COOKIE_NAME, String(invite.id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: INVITE_COOKIE_TTL_SECONDS,
  })

  // The /api/auth/v2/sign-in/oauth/microsoft-entra-id endpoint is provided by
  // the genericOAuth plugin. We pass the invite email as a hint so the user
  // doesn't have to type it on the Microsoft side.
  const ssoUrl =
    `/api/auth/v2/sign-in/oauth?` +
    new URLSearchParams({
      providerId: 'microsoft-entra-id',
      callbackURL: '/',
      loginHint: invite.email,
    }).toString()

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full space-y-6 text-center">
        <h1 className="text-2xl font-semibold">You&apos;re invited</h1>
        <p className="text-muted-foreground">
          You&apos;ve been invited to join the Endava Security Champion Program as{' '}
          <strong>{formatRole(invite.role)}</strong>
          {regionName ? <> for <strong>{regionName}</strong></> : null}.
        </p>
        <p className="text-sm text-muted-foreground">
          Sign in with your Endava Microsoft account using <strong>{invite.email}</strong>.
        </p>
        <a
          href={ssoUrl}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-primary-foreground font-medium hover:bg-primary/90 transition"
        >
          Sign in with Microsoft
        </a>
      </div>
    </div>
  )
}

function formatRole(role: string): string {
  switch (role) {
    case 'global_champion': return 'Global Security Champion'
    case 'regional_champion': return 'Regional Security Champion'
    case 'security_champion': return 'Security Champion'
    case 'admin': return 'Administrator'
    default: return role
  }
}

function InviteError({ title, body }: { title: string; body: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full space-y-4 text-center">
        <h1 className="text-2xl font-semibold text-destructive">{title}</h1>
        <p className="text-muted-foreground">{body}</p>
      </div>
    </div>
  )
}
