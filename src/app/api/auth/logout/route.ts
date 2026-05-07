import { NextResponse } from 'next/server'
import { destroySession, getUserFromRequest } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { getMcSessionCookieName, getMcSessionCookieOptions, isRequestSecure, parseMcSessionCookieHeader } from '@/lib/session-cookie'
import { isAuthV2Enabled } from '@/lib/feature-flags'

export async function POST(request: Request) {
  const user = getUserFromRequest(request)
  const cookieHeader = request.headers.get('cookie') || ''
  const token = parseMcSessionCookieHeader(cookieHeader)

  if (token) {
    destroySession(token)
  }

  if (user) {
    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    logAuditEvent({ action: 'logout', actor: user.username, actor_id: user.id, ip_address: ipAddress })
  }

  const response = NextResponse.json({ ok: true })
  const isSecureRequest = isRequestSecure(request)
  const cookieName = getMcSessionCookieName(isSecureRequest)
  response.cookies.set(cookieName, '', {
    ...getMcSessionCookieOptions({ maxAgeSeconds: 0, isSecureRequest }),
  })

  // Also clear AUTH_V2 (Better Auth) session when enabled.
  if (isAuthV2Enabled()) {
    try {
      const url = new URL(request.url)
      await fetch(`${url.origin}/api/auth/v2/sign-out`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: request.headers.get('cookie') || '',
        },
        body: '{}',
      })
    } catch {
      // Best effort: local logout is already applied above.
    }
  }

  return response
}
