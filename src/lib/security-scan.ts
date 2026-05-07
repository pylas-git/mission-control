import { existsSync, statSync, readdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { config } from '@/lib/config'
import { getDatabase } from '@/lib/db'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CheckSeverity = 'critical' | 'high' | 'medium' | 'low'
export type FixSafety = 'safe' | 'requires-restart' | 'requires-review' | 'manual-only'

export interface Check {
  id: string
  name: string
  status: 'pass' | 'fail' | 'warn'
  detail: string
  fix: string
  severity?: CheckSeverity
  fixSafety?: FixSafety
  platform?: 'linux' | 'darwin' | 'win32' | 'all'
}

export interface Category {
  score: number
  checks: Check[]
}

export interface ScanResult {
  overall: 'secure' | 'hardened' | 'needs-attention' | 'at-risk'
  score: number
  timestamp: number
  categories: {
    credentials: Category
    network: Category
    openclaw: Category
    runtime: Category
    os: Category
  }
}

// ---------------------------------------------------------------------------
// Fix safety map — exported for agent endpoint and UI
// ---------------------------------------------------------------------------

export const FIX_SAFETY: Record<string, FixSafety> = {
  env_permissions: 'safe',
  config_permissions: 'safe',
  world_writable: 'safe',
  hsts_enabled: 'requires-restart',
  cookie_secure: 'requires-restart',
  allowed_hosts: 'requires-restart',
  rate_limiting: 'requires-restart',
  api_key_set: 'requires-restart',
  log_redaction: 'requires-restart',
  dm_isolation: 'requires-restart',
  fs_workspace_only: 'requires-restart',
  exec_restricted: 'requires-review',
  elevated_disabled: 'requires-review',
  control_ui_device_auth: 'requires-review',
  control_ui_insecure_auth: 'requires-review',
}

// ---------------------------------------------------------------------------
// Severity-weighted scoring
// ---------------------------------------------------------------------------

const SEVERITY_WEIGHT: Record<CheckSeverity, number> = { critical: 4, high: 3, medium: 2, low: 1 }

const INSECURE_PASSWORDS = new Set([
  'admin', 'password', 'change-me-on-first-login', 'changeme', 'testpass123',
])

export function runSecurityScan(): ScanResult {
  const credentials = scanCredentials()
  const network = scanNetwork()
  const openclaw = scanOpenClaw()
  const runtime = scanRuntime()
  const osLevel = scanOS()

  const categories = { credentials, network, openclaw, runtime, os: osLevel }
  const allChecks = Object.values(categories).flatMap(c => c.checks)

  const weightedMax = allChecks.reduce((s, c) => s + SEVERITY_WEIGHT[c.severity ?? 'medium'], 0)
  const weightedScore = allChecks
    .filter(c => c.status === 'pass')
    .reduce((s, c) => s + SEVERITY_WEIGHT[c.severity ?? 'medium'], 0)
  const score = weightedMax > 0 ? Math.round((weightedScore / weightedMax) * 100) : 0

  let overall: ScanResult['overall']
  if (score >= 90) overall = 'hardened'
  else if (score >= 70) overall = 'secure'
  else if (score >= 40) overall = 'needs-attention'
  else overall = 'at-risk'

  return { overall, score, timestamp: Date.now(), categories }
}

export function readSystemUptimeSeconds(): number | null {
  try {
    const value = os.uptime()
    return Number.isFinite(value) && value >= 0 ? value : null
  } catch {
    return null
  }
}

function scoreCategory(checks: Check[]): Category {
  const weightedMax = checks.reduce((s, c) => s + SEVERITY_WEIGHT[c.severity ?? 'medium'], 0)
  const weightedScore = checks
    .filter(c => c.status === 'pass')
    .reduce((s, c) => s + SEVERITY_WEIGHT[c.severity ?? 'medium'], 0)
  return { score: weightedMax > 0 ? Math.round((weightedScore / weightedMax) * 100) : 100, checks }
}

// ---------------------------------------------------------------------------
// Exec helpers
// All exec calls below use only hardcoded string literals — no user input.
// ---------------------------------------------------------------------------

function tryExec(cmd: string, timeout = 5000): string | null {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch {
    return null
  }
}

const execCache = new Map<string, { value: string | null; ts: number }>()

function cachedExec(key: string, cmd: string, ttlMs = 60000): string | null {
  const cached = execCache.get(key)
  if (cached && Date.now() - cached.ts < ttlMs) return cached.value
  const value = tryExec(cmd)
  execCache.set(key, { value, ts: Date.now() })
  return value
}

/**
 * Runs a multi-line script that outputs KEY=VALUE pairs.
 * Returns a map of key -> value. Used to batch multiple sysctl reads.
 */
function tryExecBatch(script: string): Record<string, string> {
  const out = tryExec(script)
  if (!out) return {}
  const result: Record<string, string> = {}
  for (const line of out.split('\n')) {
    const eq = line.indexOf('=')
    if (eq > 0) result[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return result
}

// ---------------------------------------------------------------------------
// Category: Credentials
// ---------------------------------------------------------------------------

function scanCredentials(): Category {
  const checks: Check[] = []

  const authPass = process.env.AUTH_PASS || ''
  if (!authPass) {
    checks.push({ id: 'auth_pass', name: 'Admin password configured', status: 'fail', detail: 'AUTH_PASS is not configured', fix: 'Set AUTH_PASS in .env to a strong password (12+ characters)', severity: 'critical' })
  } else if (INSECURE_PASSWORDS.has(authPass)) {
    checks.push({ id: 'auth_pass', name: 'Admin password strength', status: 'fail', detail: 'AUTH_PASS is set to a known insecure default', fix: 'Change AUTH_PASS to a unique password with 12+ characters', severity: 'critical' })
  } else if (authPass.length < 12) {
    checks.push({ id: 'auth_pass', name: 'Admin password strength', status: 'warn', detail: `AUTH_PASS is only ${authPass.length} characters`, fix: 'Use a password with at least 12 characters', severity: 'critical' })
  } else {
    checks.push({ id: 'auth_pass', name: 'Admin password strength', status: 'pass', detail: 'AUTH_PASS is a strong, non-default password', fix: '', severity: 'critical' })
  }

  const apiKey = process.env.API_KEY || ''
  checks.push({
    id: 'api_key_set',
    name: 'API key configured',
    status: apiKey && apiKey !== 'generate-a-random-key' ? 'pass' : 'fail',
    detail: !apiKey ? 'API_KEY is not set' : apiKey === 'generate-a-random-key' ? 'API_KEY uses the default placeholder' : 'API_KEY is configured',
    fix: !apiKey || apiKey === 'generate-a-random-key' ? 'Run: bash scripts/generate-env.sh --force' : '',
    severity: 'critical',
  })

  const envPath = path.join(process.cwd(), '.env')
  if (existsSync(envPath)) {
    try {
      const stat = statSync(envPath)
      const mode = (stat.mode & 0o777).toString(8)
      checks.push({
        id: 'env_permissions',
        name: '.env file permissions',
        status: mode === '600' ? 'pass' : 'warn',
        detail: `.env permissions are ${mode}`,
        fix: mode !== '600' ? 'Run: chmod 600 .env' : '',
        severity: 'medium',
        fixSafety: 'safe',
      })
    } catch {
      checks.push({ id: 'env_permissions', name: '.env file permissions', status: 'warn', detail: 'Could not check .env permissions', fix: 'Run: chmod 600 .env', severity: 'medium', fixSafety: 'safe' })
    }
  }

  return scoreCategory(checks)
}

// ---------------------------------------------------------------------------
// Category: Network
// ---------------------------------------------------------------------------

function scanNetwork(): Category {
  const checks: Check[] = []

  const allowedHosts = (process.env.MC_ALLOWED_HOSTS || '').trim()
  const allowAny = process.env.MC_ALLOW_ANY_HOST
  checks.push({
    id: 'allowed_hosts',
    name: 'Host allowlist configured',
    status: allowAny === '1' || allowAny === 'true' ? 'fail' : allowedHosts ? 'pass' : 'warn',
    detail: allowAny === '1' || allowAny === 'true' ? 'Unrestricted host access is enabled — any host can connect' : allowedHosts ? `Allowed hosts: ${allowedHosts}` : 'No explicit host allowlist is configured',
    fix: allowAny ? 'Disable unrestricted host access and configure an explicit host allowlist' : !allowedHosts ? 'Configure an explicit host allowlist, for example localhost,127.0.0.1' : '',
    severity: 'high',
  })

  const hsts = process.env.MC_ENABLE_HSTS
  checks.push({
    id: 'hsts_enabled',
    name: 'HSTS enabled',
    status: hsts === '1' ? 'pass' : 'warn',
    detail: hsts === '1' ? 'Strict-Transport-Security header enabled' : 'HSTS is not enabled',
    fix: hsts !== '1' ? 'Set MC_ENABLE_HSTS=1 in .env (requires HTTPS)' : '',
    severity: 'medium',
  })

  const cookieSecure = process.env.MC_COOKIE_SECURE
  checks.push({
    id: 'cookie_secure',
    name: 'Secure cookies',
    status: cookieSecure === '1' || cookieSecure === 'true' ? 'pass' : 'warn',
    detail: cookieSecure === '1' || cookieSecure === 'true' ? 'Cookies marked secure' : 'Cookies not explicitly set to secure',
    fix: !(cookieSecure === '1' || cookieSecure === 'true') ? 'Set MC_COOKIE_SECURE=1 in .env (requires HTTPS)' : '',
    severity: 'medium',
  })

  return scoreCategory(checks)
}

// ---------------------------------------------------------------------------
// Category: Platform
// ---------------------------------------------------------------------------

function scanOpenClaw(): Category {
  const checks: Check[] = []
  const normalizedDataDir = path.resolve(config.dataDir)
  const normalizedDbPath = path.resolve(config.dbPath)
  const normalizedTokensPath = path.resolve(config.tokensPath)
  const dataDirExists = existsSync(config.dataDir)

  checks.push({
    id: 'platform_data_dir',
    name: 'Platform data directory ready',
    status: dataDirExists ? 'pass' : 'warn',
    detail: dataDirExists
      ? `Data directory available at ${config.dataDir}`
      : 'Configured data directory has not been created yet',
    fix: dataDirExists ? '' : 'Create the data directory or start the app once so it can initialize runtime storage',
    severity: 'low',
  })

  const dataPathsScoped =
    normalizedDbPath.startsWith(normalizedDataDir) &&
    normalizedTokensPath.startsWith(normalizedDataDir)

  checks.push({
    id: 'platform_data_scope',
    name: 'Sensitive files scoped to platform storage',
    status: dataPathsScoped ? 'pass' : 'warn',
    detail: dataPathsScoped
      ? 'Database and token files live inside the configured platform data directory'
      : 'One or more sensitive files are stored outside the configured platform data directory',
    fix: dataPathsScoped ? '' : 'Set MISSION_CONTROL_DB_PATH and MISSION_CONTROL_TOKENS_PATH under MISSION_CONTROL_DATA_DIR',
    severity: 'medium',
  })

  if (!existsSync(config.tokensPath)) {
    checks.push({
      id: 'platform_token_store',
      name: 'Integration token store initialized',
      status: 'pass',
      detail: 'No token store file has been created yet',
      fix: '',
      severity: 'low',
    })
  } else if (process.platform === 'win32') {
    checks.push({
      id: 'platform_token_store',
      name: 'Integration token store access',
      status: 'pass',
      detail: 'Token store exists; detailed permission checks are skipped on Windows',
      fix: '',
      severity: 'low',
    })
  } else {
    try {
      const stat = statSync(config.tokensPath)
      const mode = (stat.mode & 0o777).toString(8)
      checks.push({
        id: 'platform_token_store',
        name: 'Integration token store permissions',
        status: mode === '600' ? 'pass' : 'warn',
        detail: `Token store permissions are ${mode}`,
        fix: mode === '600' ? '' : `Run: chmod 600 ${config.tokensPath}`,
        severity: 'medium',
        fixSafety: 'safe',
      })
    } catch {
      checks.push({
        id: 'platform_token_store',
        name: 'Integration token store permissions',
        status: 'warn',
        detail: 'Could not verify token store permissions',
        fix: `Review access controls for ${config.tokensPath}`,
        severity: 'medium',
      })
    }
  }

  return scoreCategory(checks)
}

// ---------------------------------------------------------------------------
// Category: Runtime
// ---------------------------------------------------------------------------

function scanRuntime(): Category {
  const checks: Check[] = []

  try {
    require('@/lib/injection-guard')
    checks.push({
      id: 'injection_guard',
      name: 'Injection guard active',
      status: 'pass',
      detail: 'Prompt and command injection protection is loaded',
      fix: '',
      severity: 'critical',
    })
  } catch {
    checks.push({
      id: 'injection_guard',
      name: 'Injection guard active',
      status: 'fail',
      detail: 'Injection guard module not found',
      fix: 'Ensure src/lib/injection-guard.ts exists and is importable',
      severity: 'critical',
    })
  }

  const rlDisabled = process.env.MC_DISABLE_RATE_LIMIT
  checks.push({
    id: 'rate_limiting',
    name: 'Rate limiting active',
    status: !rlDisabled ? 'pass' : 'fail',
    detail: rlDisabled ? 'Rate limiting is disabled' : 'Rate limiting is active',
    fix: rlDisabled ? 'Remove MC_DISABLE_RATE_LIMIT from .env' : '',
    severity: 'high',
  })

  const isDocker = existsSync('/.dockerenv')
  if (isDocker) {
    checks.push({
      id: 'docker_detected',
      name: 'Running in Docker',
      status: 'pass',
      detail: 'Container environment detected',
      fix: '',
      severity: 'low',
    })
  }

  try {
    const backupDir = path.join(path.dirname(config.dbPath), 'backups')
    if (existsSync(backupDir)) {
      const files = readdirSync(backupDir)
        .filter((f: string) => f.endsWith('.db'))
        .map((f: string) => {
          const stat = statSync(path.join(backupDir, f))
          return { mtime: stat.mtimeMs }
        })
        .sort((a: any, b: any) => b.mtime - a.mtime)

      if (files.length > 0) {
        const ageHours = Math.round((Date.now() - files[0].mtime) / 3600000)
        checks.push({
          id: 'backup_recent',
          name: 'Recent backup exists',
          status: ageHours < 24 ? 'pass' : ageHours < 168 ? 'warn' : 'fail',
          detail: `Latest backup is ${ageHours}h old`,
          fix: ageHours >= 24 ? 'Enable auto_backup in Settings or run: curl -X POST /api/backup' : '',
          severity: 'medium',
        })
      } else {
        checks.push({ id: 'backup_recent', name: 'Recent backup exists', status: 'warn', detail: 'No backups found', fix: 'Enable auto_backup in Settings', severity: 'medium' })
      }
    } else {
      checks.push({ id: 'backup_recent', name: 'Recent backup exists', status: 'warn', detail: 'No backup directory', fix: 'Enable auto_backup in Settings', severity: 'medium' })
    }
  } catch {
    checks.push({ id: 'backup_recent', name: 'Recent backup exists', status: 'warn', detail: 'Could not check backups', fix: '', severity: 'medium' })
  }

  try {
    const db = getDatabase()
    const result = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string } | undefined
    checks.push({
      id: 'db_integrity',
      name: 'Database integrity',
      status: result?.integrity_check === 'ok' ? 'pass' : 'fail',
      detail: result?.integrity_check === 'ok' ? 'Integrity check passed' : `Integrity: ${result?.integrity_check || 'unknown'}`,
      fix: result?.integrity_check !== 'ok' ? 'Database may be corrupted — restore from backup' : '',
      severity: 'critical',
    })
  } catch {
    checks.push({ id: 'db_integrity', name: 'Database integrity', status: 'warn', detail: 'Could not run integrity check', fix: '', severity: 'critical' })
  }

  return scoreCategory(checks)
}

// ---------------------------------------------------------------------------
// Category: OS — base + platform-specific hardening checks
// ---------------------------------------------------------------------------

function scanOS(): Category {
  const checks: Check[] = []
  const platform = os.platform()
  const isLinux = platform === 'linux'
  const isDarwin = platform === 'darwin'
  const isWindows = platform === 'win32'

  // -- Cross-platform checks --

  const uid = process.getuid?.()
  if (uid !== undefined) {
    checks.push({
      id: 'not_root',
      name: 'Not running as root',
      status: uid === 0 ? 'fail' : 'pass',
      detail: uid === 0 ? 'Process is running as root (UID 0)' : `Running as UID ${uid}`,
      fix: uid === 0 ? 'Run Endava Security Champion Program as a non-root user' : '',
      severity: 'critical',
      platform: 'all',
    })
  }

  const nodeVersion = process.versions.node
  const nodeMajor = parseInt(nodeVersion.split('.')[0], 10)
  checks.push({
    id: 'node_supported',
    name: 'Node.js version supported',
    status: nodeMajor >= 20 ? 'pass' : nodeMajor >= 18 ? 'warn' : 'fail',
    detail: `Node.js v${nodeVersion}`,
    fix: nodeMajor < 20 ? 'Upgrade to Node.js 20 LTS or later' : '',
    severity: 'medium',
    platform: 'all',
  })

  // Node.js elevated capabilities (Linux only)
  if (isLinux && uid !== undefined && uid !== 0) {
    const caps = cachedExec('node_caps', 'getcap $(which node) 2>/dev/null')
    const hasCaps = caps ? caps.includes('=') : false
    checks.push({
      id: 'node_permissions',
      name: 'Node.js no elevated capabilities',
      status: hasCaps ? 'warn' : 'pass',
      detail: hasCaps ? `Node binary has capabilities: ${caps}` : 'Node binary has no special capabilities',
      fix: hasCaps ? 'Remove capabilities: sudo setcap -r $(which node)' : '',
      severity: 'medium',
      platform: 'linux',
    })
  }

  // Uptime
  const uptimeSeconds = readSystemUptimeSeconds()
  if (uptimeSeconds === null) {
    checks.push({
      id: 'uptime',
      name: 'System reboot freshness',
      status: 'warn',
      detail: 'System uptime is unavailable in this runtime environment',
      fix: '',
      severity: 'low',
      platform: 'all',
    })
  } else {
    const uptimeDays = Math.floor(uptimeSeconds / 86400)
    checks.push({
      id: 'uptime',
      name: 'System reboot freshness',
      status: uptimeDays < 30 ? 'pass' : uptimeDays < 90 ? 'warn' : 'fail',
      detail: `System uptime: ${uptimeDays} day${uptimeDays !== 1 ? 's' : ''}`,
      fix: uptimeDays >= 30 ? 'Consider rebooting to apply kernel and system updates' : '',
      severity: 'low',
      platform: 'all',
    })
  }

  // NTP sync
  if (isLinux) {
    const ntpStatus = cachedExec('ntp_sync', 'timedatectl status 2>/dev/null | grep -i "synchronized\\|ntp" | head -2')
    const ntpActive = ntpStatus?.toLowerCase().includes('yes') || ntpStatus?.toLowerCase().includes('active')
    checks.push({
      id: 'ntp_sync',
      name: 'Time synchronization',
      status: ntpActive ? 'pass' : 'warn',
      detail: ntpActive ? 'NTP synchronization is active' : 'NTP sync status unknown or inactive',
      fix: !ntpActive ? 'Enable NTP: sudo timedatectl set-ntp true' : '',
      severity: 'low',
      platform: 'linux',
    })
  } else if (isDarwin) {
    const ntpStatus = cachedExec('ntp_sync', 'systemsetup -getusingnetworktime 2>/dev/null')
    const ntpActive = ntpStatus?.toLowerCase().includes('on')
    checks.push({
      id: 'ntp_sync',
      name: 'Time synchronization',
      status: ntpActive ? 'pass' : 'warn',
      detail: ntpActive ? 'Network time is enabled' : 'Network time may be disabled',
      fix: !ntpActive ? 'Enable: sudo systemsetup -setusingnetworktime on' : '',
      severity: 'low',
      platform: 'darwin',
    })
  }

  // -- Firewall --

  if (isLinux) {
    const ufwStatus = tryExec('ufw status 2>/dev/null')
    const iptablesCount = tryExec('iptables -L -n 2>/dev/null | wc -l')
    const nftCount = tryExec('nft list ruleset 2>/dev/null | wc -l')
    const hasUfw = ufwStatus?.includes('active')
    const hasIptables = iptablesCount ? parseInt(iptablesCount, 10) > 8 : false
    const hasNft = nftCount ? parseInt(nftCount, 10) > 0 : false
    checks.push({
      id: 'firewall',
      name: 'Firewall active',
      status: hasUfw || hasIptables || hasNft ? 'pass' : 'warn',
      detail: hasUfw ? 'UFW firewall is active' : hasIptables ? 'iptables rules present' : hasNft ? 'nftables rules present' : 'No firewall detected',
      fix: !hasUfw && !hasIptables && !hasNft ? 'Enable a firewall: sudo ufw enable' : '',
      severity: 'critical',
      platform: 'linux',
    })
  } else if (isDarwin) {
    const pfStatus = tryExec('/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null')
    const fwEnabled = pfStatus?.includes('enabled')
    checks.push({
      id: 'firewall',
      name: 'Firewall active',
      status: fwEnabled ? 'pass' : 'warn',
      detail: fwEnabled ? 'macOS application firewall is enabled' : 'macOS firewall is disabled',
      fix: !fwEnabled ? 'Enable firewall: System Settings > Network > Firewall' : '',
      severity: 'critical',
      platform: 'darwin',
    })
  }

  // -- Open ports --

  if (isLinux || isDarwin) {
    const portCmd = isLinux
      ? 'ss -tlnp 2>/dev/null | tail -n +2 | wc -l'
      : 'netstat -an 2>/dev/null | grep LISTEN | wc -l'
    const portCount = tryExec(portCmd)
    const count = portCount ? parseInt(portCount.trim(), 10) : 0
    checks.push({
      id: 'open_ports',
      name: 'Listening ports',
      status: count <= 10 ? 'pass' : count <= 25 ? 'warn' : 'fail',
      detail: `${count} listening port${count !== 1 ? 's' : ''} detected`,
      fix: count > 10 ? 'Review open ports and close unnecessary services' : '',
      severity: 'medium',
      platform: isLinux ? 'linux' : 'darwin',
    })
  }

  // -- SSH hardening (Linux) --

  if (isLinux && existsSync('/etc/ssh/sshd_config')) {
    const sshdConfig = tryExec('grep -i "^PermitRootLogin" /etc/ssh/sshd_config 2>/dev/null')
    if (sshdConfig !== null) {
      const allowsRoot = sshdConfig.toLowerCase().includes('yes')
      checks.push({
        id: 'ssh_root',
        name: 'SSH root login disabled',
        status: allowsRoot ? 'fail' : 'pass',
        detail: allowsRoot ? 'SSH allows root login' : 'SSH root login is restricted',
        fix: allowsRoot ? 'Set PermitRootLogin no in /etc/ssh/sshd_config and restart sshd' : '',
        severity: 'critical',
        platform: 'linux',
      })
    }

    const sshPwAuth = tryExec('grep -i "^PasswordAuthentication" /etc/ssh/sshd_config 2>/dev/null')
    if (sshPwAuth !== null) {
      const allowsPw = sshPwAuth.toLowerCase().includes('yes')
      checks.push({
        id: 'ssh_password',
        name: 'SSH password auth disabled',
        status: allowsPw ? 'warn' : 'pass',
        detail: allowsPw ? 'SSH allows password authentication' : 'SSH uses key-based authentication only',
        fix: allowsPw ? 'Set PasswordAuthentication no in /etc/ssh/sshd_config' : '',
        severity: 'high',
        platform: 'linux',
      })
    }
  }

  // -- Auto updates --

  if (isLinux) {
    const hasUnattended = existsSync('/etc/apt/apt.conf.d/20auto-upgrades')
      || existsSync('/etc/yum/yum-cron.conf')
      || existsSync('/etc/dnf/automatic.conf')
    checks.push({
      id: 'auto_updates',
      name: 'Automatic security updates',
      status: hasUnattended ? 'pass' : 'warn',
      detail: hasUnattended ? 'Automatic update configuration found' : 'No automatic update configuration detected',
      fix: !hasUnattended ? 'Install unattended-upgrades (Debian/Ubuntu) or dnf-automatic (RHEL/Fedora)' : '',
      severity: 'medium',
      platform: 'linux',
    })
  } else if (isDarwin) {
    const autoUpdate = tryExec('defaults read /Library/Preferences/com.apple.SoftwareUpdate AutomaticCheckEnabled 2>/dev/null')
    checks.push({
      id: 'auto_updates',
      name: 'Automatic software updates',
      status: autoUpdate === '1' ? 'pass' : 'warn',
      detail: autoUpdate === '1' ? 'Automatic update checks enabled' : 'Automatic update status unknown',
      fix: autoUpdate !== '1' ? 'Enable in System Settings > General > Software Update' : '',
      severity: 'medium',
      platform: 'darwin',
    })
  }

  // -- Disk encryption --

  if (isDarwin) {
    const fvStatus = tryExec('fdesetup status 2>/dev/null')
    const encrypted = fvStatus?.includes('On')
    checks.push({
      id: 'disk_encryption',
      name: 'Disk encryption (FileVault)',
      status: encrypted ? 'pass' : 'fail',
      detail: encrypted ? 'FileVault is enabled' : 'FileVault is not enabled',
      fix: !encrypted ? 'Enable FileVault in System Settings > Privacy & Security' : '',
      severity: 'high',
      platform: 'darwin',
    })
  } else if (isLinux) {
    const luksDevices = tryExec('lsblk -o TYPE 2>/dev/null | grep -c crypt')
    const hasCrypt = luksDevices ? parseInt(luksDevices, 10) > 0 : false
    checks.push({
      id: 'disk_encryption',
      name: 'Disk encryption (LUKS)',
      status: hasCrypt ? 'pass' : 'warn',
      detail: hasCrypt ? 'Encrypted volumes detected' : 'No LUKS-encrypted volumes detected',
      fix: !hasCrypt ? 'Consider encrypting data volumes with LUKS' : '',
      severity: 'high',
      platform: 'linux',
    })
  }

  // -- World-writable files --

  if (isLinux || isDarwin) {
    const cwd = process.cwd()
    const wwFiles = tryExec(`find "${cwd}" -maxdepth 2 -perm -o+w -not -type l 2>/dev/null | head -5`)
    const wwCount = wwFiles ? wwFiles.split('\n').filter(Boolean).length : 0
    checks.push({
      id: 'world_writable',
      name: 'No world-writable app files',
      status: wwCount === 0 ? 'pass' : 'warn',
      detail: wwCount === 0 ? 'No world-writable files in app directory' : `${wwCount}+ world-writable file${wwCount > 1 ? 's' : ''} found`,
      fix: wwCount > 0 ? 'Run: chmod o-w on affected files' : '',
      severity: 'medium',
      fixSafety: 'safe',
      platform: isLinux ? 'linux' : 'darwin',
    })
  }

  // -- Linux-specific hardening --

  if (isLinux) {
    // Batch read kernel parameters in a single exec
    const kernelParams = tryExecBatch(
      'echo "aslr=$(cat /proc/sys/kernel/randomize_va_space 2>/dev/null)"; ' +
      'echo "core_pattern=$(cat /proc/sys/kernel/core_pattern 2>/dev/null)"; ' +
      'echo "syn_cookies=$(cat /proc/sys/net/ipv4/tcp_syncookies 2>/dev/null)"'
    )

    const aslr = kernelParams['aslr']
    checks.push({
      id: 'linux_aslr',
      name: 'Kernel ASLR enabled',
      status: aslr === '2' ? 'pass' : aslr === '1' ? 'warn' : 'fail',
      detail: aslr === '2' ? 'Full ASLR randomization active' : aslr === '1' ? 'Partial ASLR — upgrade to full' : aslr ? `ASLR value: ${aslr}` : 'Could not read ASLR status',
      fix: aslr !== '2' ? 'Set: sysctl -w kernel.randomize_va_space=2' : '',
      severity: 'critical',
      fixSafety: 'manual-only',
      platform: 'linux',
    })

    const corePattern = kernelParams['core_pattern'] || ''
    const coreToFile = !corePattern.startsWith('|') && corePattern !== ''
    checks.push({
      id: 'linux_core_dumps',
      name: 'Core dumps restricted',
      status: coreToFile ? 'warn' : 'pass',
      detail: coreToFile ? `Core pattern writes to file: ${corePattern}` : 'Core dumps piped to handler or disabled',
      fix: coreToFile ? 'Restrict core dumps: echo "|/bin/false" > /proc/sys/kernel/core_pattern' : '',
      severity: 'medium',
      fixSafety: 'manual-only',
      platform: 'linux',
    })

    const synCookies = kernelParams['syn_cookies']
    checks.push({
      id: 'linux_syn_cookies',
      name: 'TCP SYN cookies enabled',
      status: synCookies === '1' ? 'pass' : 'warn',
      detail: synCookies === '1' ? 'SYN cookie protection active' : 'SYN cookies are not enabled',
      fix: synCookies !== '1' ? 'Set: sysctl -w net.ipv4.tcp_syncookies=1' : '',
      severity: 'medium',
      fixSafety: 'manual-only',
      platform: 'linux',
    })

    // MAC framework
    const selinux = cachedExec('selinux', 'cat /sys/fs/selinux/enforce 2>/dev/null')
    const apparmor = cachedExec('apparmor', 'aa-status --enabled 2>/dev/null; echo $?')
    const hasSELinux = selinux === '1'
    const hasAppArmor = apparmor?.trim().endsWith('0')
    checks.push({
      id: 'linux_mac_framework',
      name: 'Mandatory access control',
      status: hasSELinux || hasAppArmor ? 'pass' : 'warn',
      detail: hasSELinux ? 'SELinux enforcing' : hasAppArmor ? 'AppArmor active' : 'No MAC framework detected',
      fix: !hasSELinux && !hasAppArmor ? 'Enable AppArmor or SELinux for mandatory access control' : '',
      severity: 'high',
      fixSafety: 'manual-only',
      platform: 'linux',
    })

    // fail2ban
    const f2bStatus = cachedExec('fail2ban', 'systemctl is-active fail2ban 2>/dev/null')
    checks.push({
      id: 'linux_fail2ban',
      name: 'Brute-force protection (fail2ban)',
      status: f2bStatus === 'active' ? 'pass' : 'warn',
      detail: f2bStatus === 'active' ? 'fail2ban is active' : 'fail2ban is not running',
      fix: f2bStatus !== 'active' ? 'Install and enable fail2ban: sudo apt install fail2ban && sudo systemctl enable --now fail2ban' : '',
      severity: 'medium',
      fixSafety: 'manual-only',
      platform: 'linux',
    })

    // /tmp noexec
    const tmpMount = cachedExec('tmp_mount', 'mount 2>/dev/null | grep " /tmp "')
    const tmpNoexec = tmpMount?.includes('noexec')
    checks.push({
      id: 'linux_tmp_noexec',
      name: '/tmp mounted noexec',
      status: tmpNoexec ? 'pass' : 'warn',
      detail: tmpNoexec ? '/tmp is mounted with noexec' : '/tmp may allow execution — consider noexec mount',
      fix: !tmpNoexec ? 'Add noexec,nosuid,nodev to /tmp mount options in /etc/fstab' : '',
      severity: 'medium',
      fixSafety: 'manual-only',
      platform: 'linux',
    })
  }

  // -- macOS-specific hardening --

  if (isDarwin) {
    const sipStatus = cachedExec('sip', 'csrutil status 2>/dev/null')
    const sipEnabled = sipStatus?.toLowerCase().includes('enabled')
    checks.push({
      id: 'macos_sip',
      name: 'System Integrity Protection',
      status: sipEnabled ? 'pass' : 'fail',
      detail: sipEnabled ? 'SIP is enabled' : 'SIP is disabled — system files are unprotected',
      fix: !sipEnabled ? 'Re-enable SIP from Recovery Mode: csrutil enable' : '',
      severity: 'critical',
      fixSafety: 'manual-only',
      platform: 'darwin',
    })

    const gkStatus = cachedExec('gatekeeper', 'spctl --status 2>/dev/null')
    const gkEnabled = gkStatus?.includes('enabled')
    checks.push({
      id: 'macos_gatekeeper',
      name: 'Gatekeeper active',
      status: gkEnabled ? 'pass' : 'warn',
      detail: gkEnabled ? 'Gatekeeper is enabled' : 'Gatekeeper is disabled',
      fix: !gkEnabled ? 'Enable Gatekeeper: sudo spctl --master-enable' : '',
      severity: 'high',
      fixSafety: 'manual-only',
      platform: 'darwin',
    })

    const stealthStatus = cachedExec('stealth', '/usr/libexec/ApplicationFirewall/socketfilterfw --getstealthmode 2>/dev/null')
    const stealthEnabled = stealthStatus?.includes('enabled')
    checks.push({
      id: 'macos_stealth_mode',
      name: 'Firewall stealth mode',
      status: stealthEnabled ? 'pass' : 'warn',
      detail: stealthEnabled ? 'Stealth mode is enabled' : 'Stealth mode is disabled',
      fix: !stealthEnabled ? 'Enable: sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setstealthmode on' : '',
      severity: 'medium',
      fixSafety: 'manual-only',
      platform: 'darwin',
    })

    const remoteLogin = cachedExec('remote_login', 'systemsetup -getremotelogin 2>/dev/null')
    const remoteOff = remoteLogin?.toLowerCase().includes('off')
    checks.push({
      id: 'macos_remote_login',
      name: 'Remote login disabled',
      status: remoteOff ? 'pass' : 'warn',
      detail: remoteOff ? 'Remote login (SSH) is disabled' : 'Remote login (SSH) is enabled',
      fix: !remoteOff ? 'Disable if not needed: sudo systemsetup -setremotelogin off' : '',
      severity: 'medium',
      fixSafety: 'manual-only',
      platform: 'darwin',
    })

    const guestAccount = cachedExec('guest', 'defaults read /Library/Preferences/com.apple.loginwindow GuestEnabled 2>/dev/null')
    const guestDisabled = guestAccount === '0'
    checks.push({
      id: 'macos_guest_account',
      name: 'Guest account disabled',
      status: guestDisabled || guestAccount === null ? 'pass' : 'warn',
      detail: guestDisabled || guestAccount === null ? 'Guest account is disabled' : 'Guest account is enabled',
      fix: !guestDisabled && guestAccount !== null ? 'Disable: sudo defaults write /Library/Preferences/com.apple.loginwindow GuestEnabled -bool false' : '',
      severity: 'low',
      fixSafety: 'manual-only',
      platform: 'darwin',
    })
  }

  // -- Windows-specific hardening --

  if (isWindows) {
    const defenderStatus = cachedExec('win_defender', 'powershell -NoProfile -Command "(Get-MpComputerStatus).RealTimeProtectionEnabled" 2>nul')
    checks.push({
      id: 'win_defender',
      name: 'Windows Defender active',
      status: defenderStatus === 'True' ? 'pass' : 'fail',
      detail: defenderStatus === 'True' ? 'Real-time protection is enabled' : 'Windows Defender real-time protection is not active',
      fix: defenderStatus !== 'True' ? 'Enable Windows Defender real-time protection in Windows Security settings' : '',
      severity: 'critical',
      fixSafety: 'manual-only',
      platform: 'win32',
    })

    const fwProfiles = cachedExec('win_firewall', 'powershell -NoProfile -Command "(Get-NetFirewallProfile | Where-Object {$_.Enabled -eq $true}).Count" 2>nul')
    const fwCount = fwProfiles ? parseInt(fwProfiles, 10) : 0
    checks.push({
      id: 'win_firewall',
      name: 'Windows Firewall active',
      status: fwCount >= 3 ? 'pass' : fwCount > 0 ? 'warn' : 'fail',
      detail: fwCount >= 3 ? 'All firewall profiles are active' : `${fwCount} of 3 firewall profiles active`,
      fix: fwCount < 3 ? 'Enable all firewall profiles in Windows Defender Firewall settings' : '',
      severity: 'critical',
      fixSafety: 'manual-only',
      platform: 'win32',
    })

    const bitlocker = cachedExec('win_bitlocker', 'powershell -NoProfile -Command "(Get-BitLockerVolume -MountPoint C:).ProtectionStatus" 2>nul')
    checks.push({
      id: 'win_bitlocker',
      name: 'BitLocker encryption',
      status: bitlocker === 'On' ? 'pass' : 'warn',
      detail: bitlocker === 'On' ? 'BitLocker is active on C:' : 'BitLocker is not active on C:',
      fix: bitlocker !== 'On' ? 'Enable BitLocker in Control Panel > BitLocker Drive Encryption' : '',
      severity: 'high',
      fixSafety: 'manual-only',
      platform: 'win32',
    })

    const uac = cachedExec('win_uac', 'powershell -NoProfile -Command "(Get-ItemProperty HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System).EnableLUA" 2>nul')
    checks.push({
      id: 'win_uac',
      name: 'UAC enabled',
      status: uac === '1' ? 'pass' : 'fail',
      detail: uac === '1' ? 'User Account Control is enabled' : 'UAC is disabled',
      fix: uac !== '1' ? 'Enable UAC in Control Panel > User Account Control Settings' : '',
      severity: 'high',
      fixSafety: 'manual-only',
      platform: 'win32',
    })

    const rdp = cachedExec('win_rdp', "powershell -NoProfile -Command \"(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server').fDenyTSConnections\" 2>nul")
    checks.push({
      id: 'win_rdp_disabled',
      name: 'Remote Desktop disabled',
      status: rdp === '1' ? 'pass' : 'warn',
      detail: rdp === '1' ? 'Remote Desktop is disabled' : 'Remote Desktop is enabled',
      fix: rdp !== '1' ? 'Disable RDP if not needed: System Properties > Remote > disable Remote Desktop' : '',
      severity: 'medium',
      fixSafety: 'manual-only',
      platform: 'win32',
    })

    const smb1 = cachedExec('win_smb1', 'powershell -NoProfile -Command "(Get-SmbServerConfiguration).EnableSMB1Protocol" 2>nul')
    checks.push({
      id: 'win_smb1_disabled',
      name: 'SMBv1 disabled',
      status: smb1 === 'False' ? 'pass' : 'warn',
      detail: smb1 === 'False' ? 'SMBv1 is disabled' : 'SMBv1 may be enabled',
      fix: smb1 !== 'False' ? 'Disable: Set-SmbServerConfiguration -EnableSMB1Protocol $false -Force' : '',
      severity: 'high',
      fixSafety: 'manual-only',
      platform: 'win32',
    })
  }

  return scoreCategory(checks)
}
