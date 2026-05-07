/**
 * Feature flags for staged rollouts (read once at module init).
 *
 * AUTH_V2 — gates the Better Auth + Microsoft Entra SSO stack added in the
 *           ESCP auth migration. When false (default), legacy session-cookie
 *           auth in src/lib/auth.ts handles all requests. When true, the new
 *           handler at /api/auth/v2/* is mounted and the local login form
 *           is restricted to provider='local' users only.
 */
function readFlag(name: string, defaultValue: boolean): boolean {
  const raw = (process.env[name] || '').trim().toLowerCase()
  if (!raw) return defaultValue
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

export const featureFlags = {
  AUTH_V2: readFlag('AUTH_V2', false),
} as const

export function isAuthV2Enabled(): boolean {
  return featureFlags.AUTH_V2
}
