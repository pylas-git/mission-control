/**
 * ESCP role-based access control (Phase 4 of the Better Auth migration plan).
 *
 * Role hierarchy:
 *   admin            — platform owner; can do anything
 *   global_champion  — Global Security Champion; can manage all regions/clients/projects
 *   regional_champion — Regional Security Champion; scoped to their `region_id`
 *   security_champion — assigned to specific projects via `escp_project_champions`
 *
 * Legacy roles (`operator`, `viewer`) are mapped to `security_champion` at
 * cutover time (Phase 6). Until then this module accepts both.
 */

import { getDatabase } from './db'
import type { User } from './auth'
import { getUserFromRequest } from './auth'

export type EscpRole =
  | 'admin'
  | 'global_champion'
  | 'regional_champion'
  | 'security_champion'

const LEGACY_ROLE_MAP: Record<string, EscpRole> = {
  admin: 'admin',
  operator: 'security_champion',
  viewer: 'security_champion',
}

/** Normalize a stored role (legacy or new) into the ESCP role taxonomy. */
export function normalizeRole(role: string | undefined | null): EscpRole {
  if (!role) return 'security_champion'
  if (role in LEGACY_ROLE_MAP) return LEGACY_ROLE_MAP[role]
  if (role === 'global_champion' || role === 'regional_champion' || role === 'security_champion' || role === 'admin') {
    return role
  }
  return 'security_champion'
}

const ROLE_RANK: Record<EscpRole, number> = {
  security_champion: 0,
  regional_champion: 1,
  global_champion: 2,
  admin: 3,
}

/** True if `actor`'s role is at least `min`. */
export function hasMinRole(actor: User, min: EscpRole): boolean {
  return ROLE_RANK[normalizeRole(actor.role)] >= ROLE_RANK[min]
}

interface UserRegionRow { region_id: number | null }

/** Returns the region_id this user is scoped to, or null for admin/global. */
export function getUserRegionId(userId: number): number | null {
  try {
    const db = getDatabase()
    const row = db.prepare(`SELECT region_id FROM users WHERE id = ?`).get(userId) as UserRegionRow | undefined
    return row?.region_id ?? null
  } catch {
    return null
  }
}

/**
 * Can the actor manage entities (clients, projects, invitations) within `regionId`?
 * - admin / global_champion: any region
 * - regional_champion: only their own region
 * - security_champion: never
 */
export function canManageRegion(actor: User, regionId: number | null): boolean {
  const role = normalizeRole(actor.role)
  if (role === 'admin' || role === 'global_champion') return true
  if (role === 'regional_champion') {
    if (regionId == null) return false
    return getUserRegionId(actor.id) === regionId
  }
  return false
}

/**
 * Can the actor manage a specific project?
 * Resolves the project's region via `escp_clients` and delegates to canManageRegion.
 */
export function canManageProject(actor: User, projectId: number): boolean {
  const role = normalizeRole(actor.role)
  if (role === 'admin' || role === 'global_champion') return true
  if (role !== 'regional_champion') return false
  try {
    const db = getDatabase()
    const row = db.prepare(`
      SELECT c.region_id as region_id
      FROM escp_projects p
      JOIN escp_clients c ON c.id = p.client_id
      WHERE p.id = ?
    `).get(projectId) as { region_id: number | null } | undefined
    if (!row) return false
    return canManageRegion(actor, row.region_id)
  } catch {
    return false
  }
}

/** True if the actor is assigned to the given project as a champion. */
export function isProjectChampion(actor: User, projectId: number): boolean {
  try {
    const db = getDatabase()
    const row = db.prepare(`
      SELECT 1 as ok FROM escp_project_champions WHERE project_id = ? AND user_id = ?
    `).get(projectId, actor.id) as { ok?: number } | undefined
    return !!row?.ok
  } catch {
    return false
  }
}

/** True if the actor can read the given project (manager OR assigned champion). */
export function canReadProject(actor: User, projectId: number): boolean {
  return canManageProject(actor, projectId) || isProjectChampion(actor, projectId)
}

/**
 * Express-style guard for API routes.
 * Returns the user on success, or an error envelope on failure.
 */
export function requireEscpRole(
  request: Request,
  minRole: EscpRole
): { user: User; error?: never; status?: never } | { user?: never; error: string; status: 401 | 403 } {
  const user = getUserFromRequest(request)
  if (!user) return { error: 'Authentication required', status: 401 }
  if (!hasMinRole(user, minRole)) {
    return { error: `Requires ${minRole} role or higher`, status: 403 }
  }
  return { user }
}
