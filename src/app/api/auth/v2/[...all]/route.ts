/**
 * Better Auth handler — only mounted when AUTH_V2 feature flag is enabled.
 * Returns 404 otherwise so the route surface is invisible during dual-run.
 */
import { isAuthV2Enabled } from '@/lib/feature-flags'
import { getAuthV2 } from '@/lib/auth-v2'

async function handle(request: Request): Promise<Response> {
  if (!isAuthV2Enabled()) {
    return new Response('Not Found', { status: 404 })
  }
  try {
    const auth = getAuthV2()
    return await auth.handler(request)
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'auth_v2_unavailable', message: (err as Error).message }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    )
  }
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const DELETE = handle
export const PATCH = handle
