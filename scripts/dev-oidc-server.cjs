#!/usr/bin/env node
/**
 * dev-oidc-server.cjs
 *
 * Minimal local OIDC server for testing the AUTH_V2 / Microsoft Entra SSO
 * flow WITHOUT needing a real Entra tenant.
 *
 * Implements just enough of the OAuth 2.0 / OIDC spec to satisfy better-auth's
 * genericOAuth plugin:
 *   - GET  /.well-known/openid-configuration   (discovery doc)
 *   - GET  /jwks                               (JWK Set)
 *   - GET  /authorize                          (redirect back with code)
 *   - POST /token                              (exchange code → id_token)
 *   - GET  /userinfo                           (token → user claims)
 *
 * Usage:
 *   node scripts/dev-oidc-server.cjs
 *
 * Configure via env vars (or just accept the defaults):
 *   MOCK_OIDC_PORT       default 4011
 *   MOCK_OIDC_CLIENT_ID  default test-client
 *   MOCK_OIDC_SECRET     default test-secret
 *   MOCK_USER_EMAIL      default test.champion@endava.com
 *   MOCK_USER_NAME       default Test Champion
 *   MOCK_USER_OID        default mock-oid-000001
 *
 * Then in your .env:
 *   AUTH_V2=true
 *   AUTH_V2_MOCK_ISSUER=http://localhost:4011
 *   MS_ENTRA_CLIENT_ID=test-client
 *   MS_ENTRA_CLIENT_SECRET=test-secret
 *   MS_ENTRA_TENANT_ID=mock
 *
 * And create an invitation for MOCK_USER_EMAIL via the admin UI or:
 *   curl -X POST http://localhost:3000/api/invitations \
 *     -H 'x-api-key: <your-api-key>' \
 *     -H 'Content-Type: application/json' \
 *     -d '{"email":"test.champion@endava.com","role":"admin"}'
 *
 * IMPORTANT: development only. Do not run in production.
 */
'use strict'

const http = require('http')
const crypto = require('crypto')

// ── Config ───────────────────────────────────────────────────────────────────

const PORT        = parseInt(process.env.MOCK_OIDC_PORT     || '4011', 10)
const ISSUER      = `http://localhost:${PORT}`
const CLIENT_ID   = process.env.MOCK_OIDC_CLIENT_ID         || 'test-client'
const CLIENT_SECRET = process.env.MOCK_OIDC_SECRET          || 'test-secret'

const TEST_EMAIL  = process.env.MOCK_USER_EMAIL              || 'test.rscp@endava.com'
const TEST_NAME   = process.env.MOCK_USER_NAME               || 'Regional Test Champion'
const TEST_OID    = process.env.MOCK_USER_OID                || 'mock-oid-000002'

// ── RSA key pair (generated fresh each run) ──────────────────────────────────

console.log('[mock-oidc] Generating RSA-2048 key pair…')
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
})
const jwk = publicKey.export({ format: 'jwk' })
jwk.kid = 'mock-key-1'
jwk.use = 'sig'
jwk.alg = 'RS256'

// ── JWT helpers ───────────────────────────────────────────────────────────────

function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(typeof input === 'string' ? input : JSON.stringify(input))
  return buf.toString('base64url')
}

function signJwt(payload) {
  const header = { alg: 'RS256', typ: 'JWT', kid: 'mock-key-1' }
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(privateKey)
  return `${unsigned}.${b64url(sig)}`
}

function makeIdToken(clientId, nonce) {
  const now = Math.floor(Date.now() / 1000)
  return signJwt({
    iss: ISSUER,
    sub: TEST_OID,          // maps → account.accountId in better-auth
    aud: clientId,
    iat: now,
    exp: now + 3600,
    nonce: nonce || undefined,
    email: TEST_EMAIL,
    email_verified: true,
    name: TEST_NAME,
    preferred_username: TEST_EMAIL,
    oid: TEST_OID,           // Microsoft-specific claim
    tid: 'mock-tenant',      // Microsoft-specific claim
  })
}

function makeAccessToken() {
  const now = Math.floor(Date.now() / 1000)
  return signJwt({
    iss: ISSUER,
    sub: TEST_OID,
    iat: now,
    exp: now + 3600,
    email: TEST_EMAIL,
    scope: 'openid profile email',
  })
}

// ── In-flight auth codes ──────────────────────────────────────────────────────

// code → { redirectUri, nonce, clientId, state }
const pendingCodes = new Map()

function genCode() {
  return crypto.randomBytes(16).toString('hex')
}

// ── Discovery document ────────────────────────────────────────────────────────

const discoveryDoc = JSON.stringify({
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  jwks_uri: `${ISSUER}/jwks`,
  response_types_supported: ['code'],
  subject_types_supported: ['public'],
  id_token_signing_alg_values_supported: ['RS256'],
  scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
  token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
  claims_supported: ['sub', 'iss', 'name', 'email', 'preferred_username', 'oid', 'tid'],
  code_challenge_methods_supported: ['S256', 'plain'],
})

const jwksDoc = JSON.stringify({ keys: [jwk] })

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  // CORS for local dev
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  // ── Discovery ──────────────────────────────────────────────────────────────
  if (url.pathname === '/.well-known/openid-configuration') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(discoveryDoc)
    return
  }

  // ── JWKS ───────────────────────────────────────────────────────────────────
  if (url.pathname === '/jwks') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(jwksDoc)
    return
  }

  // ── Authorize ──────────────────────────────────────────────────────────────
  // Immediately redirects back with a code — no login UI needed.
  if (url.pathname === '/authorize' && req.method === 'GET') {
    const redirectUri = url.searchParams.get('redirect_uri')
    const state       = url.searchParams.get('state') || ''
    const nonce       = url.searchParams.get('nonce') || ''
    const cid         = url.searchParams.get('client_id') || CLIENT_ID

    if (!redirectUri) {
      res.writeHead(400)
      res.end('missing redirect_uri')
      return
    }

    const code = genCode()
    pendingCodes.set(code, { redirectUri, nonce, clientId: cid, state })
    // Auto-expire codes after 5 min
    setTimeout(() => pendingCodes.delete(code), 5 * 60 * 1000)

    const dest = new URL(redirectUri)
    dest.searchParams.set('code', code)
    if (state) dest.searchParams.set('state', state)

    console.log(`[mock-oidc] /authorize → redirecting ${TEST_EMAIL} (code=${code.slice(0, 8)}…)`)
    res.writeHead(302, { Location: dest.toString() })
    res.end()
    return
  }

  // ── Token ──────────────────────────────────────────────────────────────────
  if (url.pathname === '/token' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      const params = new URLSearchParams(body)
      const code = params.get('code')
      const meta = code ? pendingCodes.get(code) : null

      if (!meta) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Unknown or expired code' }))
        return
      }

      pendingCodes.delete(code)
      const idToken     = makeIdToken(meta.clientId, meta.nonce)
      const accessToken = makeAccessToken()

      console.log(`[mock-oidc] /token → issued tokens for ${TEST_EMAIL}`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        access_token:  accessToken,
        id_token:      idToken,
        token_type:    'Bearer',
        expires_in:    3600,
        scope:         'openid profile email',
      }))
    })
    return
  }

  // ── Userinfo ───────────────────────────────────────────────────────────────
  if (url.pathname === '/userinfo' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      sub:                TEST_OID,
      email:              TEST_EMAIL,
      email_verified:     true,
      name:               TEST_NAME,
      preferred_username: TEST_EMAIL,
      oid:                TEST_OID,
      tid:                'mock-tenant',
    }))
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║         Mock OIDC Server — DEVELOPMENT ONLY               ║
╠═══════════════════════════════════════════════════════════╣
║  Issuer:  ${ISSUER.padEnd(46)} ║
║  User:    ${TEST_EMAIL.padEnd(46)} ║
╠═══════════════════════════════════════════════════════════╣
║  1. Add to .env:                                          ║
║     AUTH_V2=true                                          ║
║     AUTH_V2_MOCK_ISSUER=http://localhost:${String(PORT).padEnd(17)}║
║     MS_ENTRA_CLIENT_ID=test-client                        ║
║     MS_ENTRA_CLIENT_SECRET=test-secret                    ║
║     MS_ENTRA_TENANT_ID=mock                               ║
║                                                           ║
║  2. Create an invitation:                                 ║
║     curl -X POST http://localhost:3000/api/invitations \\  ║
║       -H "x-api-key: <API_KEY>" \\                        ║
║       -H "Content-Type: application/json" \\              ║
║       -d '{"email":"${TEST_EMAIL.slice(0, 26).padEnd(26)}","role":"admin"}' ║             
║                                                           ║
║  3. Visit: http://localhost:3000/api/auth/v2/sign-in/     ║
║            oauth?providerId=microsoft-entra-id            ║
╚═══════════════════════════════════════════════════════════╝
`)
})

server.on('error', (err) => {
  console.error('[mock-oidc] Server error:', err.message)
  process.exit(1)
})
