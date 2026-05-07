import { NextRequest, NextResponse } from 'next/server'
import os from 'node:os'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { APP_VERSION } from '@/lib/version'

export async function GET(request: NextRequest) {
  // Docker/Kubernetes health probes must work without auth/cookies.
  const action = new URL(request.url).searchParams.get('action') || 'overview'
  if (action === 'health') {
    return NextResponse.json(performHealthCheck())
  }

  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    if (action === 'capabilities') {
      return NextResponse.json(getCapabilities())
    }
    if (action === 'overview' || action === 'dashboard') {
      return NextResponse.json(getOverview())
    }
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    logger.error({ err: error }, 'Status API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function performHealthCheck() {
  let dbOk = false
  try {
    getDatabase().prepare('SELECT 1').get()
    dbOk = true
  } catch {
    dbOk = false
  }
  return {
    status: dbOk ? 'ok' : 'degraded',
    version: APP_VERSION,
    db: dbOk,
    uptime: process.uptime(),
    timestamp: Date.now(),
  }
}

function getCapabilities() {
  let interfaceMode: 'essential' | 'full' = 'full'
  let dbConnected = false
  let authenticationConfigured = false
  let apiKeyConfigured = false

  try {
    const db = getDatabase()
    db.prepare('SELECT 1').get()
    dbConnected = true

    const row = db.prepare("SELECT value FROM settings WHERE key = 'general.interface_mode'").get() as { value?: string } | undefined
    if (row?.value === 'essential' || row?.value === 'full') interfaceMode = row.value

    // If at least one user exists, basic auth is configured for interactive login.
    const users = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count?: number } | undefined
    authenticationConfigured = (users?.count ?? 0) > 0
  } catch {
    // settings table may not exist yet
  }

  apiKeyConfigured = Boolean(process.env.API_KEY || process.env.AUTH_API_KEY)

  const emailServiceConfigured = Boolean(
    (process.env.SMTP_HOST && process.env.SMTP_PORT) ||
    (process.env.EMAIL_HOST && process.env.EMAIL_PORT) ||
    process.env.RESEND_API_KEY ||
    process.env.SENDGRID_API_KEY ||
    process.env.POSTMARK_SERVER_TOKEN
  )

  return {
    gateway: false,
    claudeHome: false,
    interfaceMode,
    dbConnected,
    authenticationConfigured,
    apiKeyConfigured,
    emailServiceConfigured,
    subscription: null,
    processUser: process.env.USER || process.env.USERNAME || null,
  }
}

function getOverview() {
  return {
    version: APP_VERSION,
    uptime: process.uptime(),
    memory: {
      total: os.totalmem(),
      free: os.freemem(),
    },
    platform: process.platform,
    nodeVersion: process.version,
  }
}
