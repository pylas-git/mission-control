'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { formatEnumLabel } from '@/lib/format-enum-label'
import { useMissionControl } from '@/store'

// ─── Types ─────────────────────────────────────────────────────────────────

interface Invitation {
  id: number
  email: string
  role: string
  region_id: number | null
  region_name?: string | null
  invited_by_name: string | null
  created_at: number
  expires_at: number
  accepted_at: number | null
  revoked_at: number | null
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
}

interface Region {
  id: number
  name: string
  slug: string
}

interface Client {
  id: number
  region_id: number
  name: string
  slug: string
}

interface Project {
  id: number
  client_id: number
  name: string
  slug: string
  client_name?: string
  region_id?: number
  region_name?: string
  archived_at: number | null
}

interface Champion {
  user_id: number
  username: string
  display_name: string
  email: string | null
  role: string
}

interface User {
  id: number
  username: string
  display_name: string
  email: string | null
  role: string
  region_id?: number | null
  region_name?: string | null
  is_approved?: number
}

interface SelectOption {
  value: string
  label: string
}

// ─── Main Panel ─────────────────────────────────────────────────────────────

const TABS = ['Invitations', 'Structure', 'Champions'] as const
type Tab = typeof TABS[number]

type StructureMode = 'structure' | 'regions' | 'accounts' | 'projects'
type CrudKind = 'region' | 'account' | 'project'

function PanelShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="p-6 w-full max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>
      {children}
    </div>
  )
}

export function EscpAdminPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('Invitations')

  return (
    <PanelShell
      title="Security Champion Programme"
      description="Manage invitations, programme structure, and champion assignments."
    >

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border mb-6">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium rounded-t-md border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Invitations' && <InvitationsTab />}
      {activeTab === 'Structure' && <StructureTab />}
      {activeTab === 'Champions' && <ChampionsTab />}
    </PanelShell>
  )
}

export function RegionsAdminPanel() {
  return (
    <PanelShell
      title="Regions"
      description="Create and manage regions."
    >
      <StructureTab mode="regions" />
    </PanelShell>
  )
}

export function AccountsAdminPanel() {
  return (
    <PanelShell
      title="Accounts"
      description="Manage client accounts grouped by region."
    >
      <StructureTab mode="accounts" />
    </PanelShell>
  )
}

export function ProjectsAdminPanel() {
  return (
    <PanelShell
      title="Projects"
      description="Manage projects grouped by account."
    >
      <StructureTab mode="projects" />
    </PanelShell>
  )
}

export function ChampionsAdminPanel() {
  return (
    <PanelShell
      title="Champions"
      description="Manage champion users, change roles, and control access."
    >
      <div className="space-y-8">
        <InvitationsTab />
        <div className="border-t border-border pt-6">
          <ChampionsTab />
        </div>
      </div>
    </PanelShell>
  )
}

export function StructureAdminPanel() {
  return (
    <PanelShell
      title="Structure"
      description="Interactive graph view of region, account, and project hierarchy."
    >
      <StructureTab mode="structure" />
    </PanelShell>
  )
}

// ─── Roles Admin Panel ────────────────────────────────────────────────────────

const ROLE_DEFINITIONS = [
  {
    role: 'admin',
    label: 'Admin',
    badge: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    description: 'Full system access. Can manage all users, all ESCP data, system settings, and perform any action.',
    permissions: [
      'Manage all users and roles',
      'Create, edit, and delete regions, accounts, and projects',
      'Manage all security champions across all regions',
      'Send and revoke invitations',
      'Access audit trail and security settings',
      'View and modify system configuration',
    ],
  },
  {
    role: 'global_champion',
    label: 'Global Champion',
    badge: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
    description: 'Program-wide champion authority. Can manage all regions, accounts, projects, and champions.',
    permissions: [
      'Manage regions, accounts, and projects across the program',
      'Assign and remove security champions globally',
      'Send invitations to any role',
      'View all champions and program structure',
      'Access program-wide reports and metrics',
    ],
  },
  {
    role: 'regional_champion',
    label: 'Regional Champion',
    badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
    description: 'Authority scoped to an assigned region. Manages accounts, projects, and champions within that region.',
    permissions: [
      'Manage accounts and projects within own region',
      'Assign and remove security champions in own region',
      'Send invitations scoped to own region',
      'View champions and structure within own region',
    ],
  },
  {
    role: 'security_champion',
    label: 'Security Champion',
    badge: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    description: 'Practitioner role. Assigned to one or more projects to lead security practices.',
    permissions: [
      'View own assigned projects and accounts',
      'Access program resources and documentation',
      'Participate in champion activities and events',
    ],
  },
]

export function RolesAdminPanel() {
  return (
    <PanelShell
      title="Roles"
      description="Overview of all roles in the Security Champion Program and their associated permissions."
    >
      <div className="grid gap-4">
        {ROLE_DEFINITIONS.map(({ role, label, badge, description, permissions }) => (
          <div key={role} className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center gap-3 mb-2">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${badge}`}>
                {label}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mb-3">{description}</p>
            <ul className="space-y-1">
              {permissions.map(p => (
                <li key={p} className="flex items-start gap-2 text-sm text-foreground">
                  <span className="mt-1 shrink-0 text-green-500">✓</span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </PanelShell>
  )
}

// ─── Invitations Tab ─────────────────────────────────────────────────────────

function InvitationsTab() {
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [inviteQuery, setInviteQuery] = useState('')
  const [inviteRoleFilter, setInviteRoleFilter] = useState('all')
  const [inviteStatusFilter, setInviteStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ email: '', role: 'security_champion', region_id: '', expires_in_days: '7' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [lastToken, setLastToken] = useState<string | null>(null)
  const [pendingRevoke, setPendingRevoke] = useState<Invitation | null>(null)
  const { currentUser } = useMissionControl()

  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'global_champion' || currentUser?.role === 'regional_champion'
  const canInviteRegionalChampions = currentUser?.role === 'admin' || currentUser?.role === 'global_champion'
  const requiresInviteRegion = form.role !== 'global_champion'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [inv, reg] = await Promise.all([
        fetch('/api/invitations').then(r => r.ok ? r.json() : { invitations: [] }),
        fetch('/api/regions').then(r => r.ok ? r.json() : { regions: [] }),
      ])
      setInvitations(inv.invitations ?? [])
      setRegions(reg.regions ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!requiresInviteRegion) return
    if (form.region_id || regions.length !== 1) return
    setForm(prev => ({ ...prev, region_id: String(regions[0].id) }))
  }, [form.region_id, regions, requiresInviteRegion])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      if (requiresInviteRegion && !form.region_id) {
        setError('Region is required for this invitation')
        return
      }

      const body: Record<string, unknown> = {
        email: form.email,
        role: form.role,
        expires_in_days: Number(form.expires_in_days),
      }
      if (form.region_id) body.region_id = Number(form.region_id)

      const res = await fetch('/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Failed to create invitation')
        return
      }

      setLastToken(data.token || null)
      setForm({ email: '', role: 'security_champion', region_id: '', expires_in_days: '7' })
      setShowCreate(false)
      load()
    } finally {
      setSubmitting(false)
    }
  }

  const handleRevoke = async (id: number) => {
    await fetch(`/api/invitations?id=${id}`, { method: 'DELETE' })
    setPendingRevoke(null)
    load()
  }

  const invitationRoles = Array.from(new Set(invitations.map(inv => inv.role))).sort()
  const filteredInvitations = invitations.filter(inv => {
    const query = inviteQuery.trim().toLowerCase()
    const matchesQuery = !query ||
      inv.email.toLowerCase().includes(query) ||
      (inv.invited_by_name || '').toLowerCase().includes(query)
    const matchesRole = inviteRoleFilter === 'all' || inv.role === inviteRoleFilter
    const matchesStatus = inviteStatusFilter === 'all' || inv.status === inviteStatusFilter
    return matchesQuery && matchesRole && matchesStatus
  })
  const regionLabelById = new Map(regions.map(r => [r.id, r.name]))

  return (
    <div>
      {lastToken && (
        <div className="mb-4 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
          <div className="text-sm font-medium text-green-400 mb-1">Invitation created — share this token once:</div>
          <code className="text-xs text-green-300 break-all">{lastToken}</code>
          <Button variant="ghost" size="sm" className="mt-2 text-xs" onClick={() => setLastToken(null)}>Dismiss</Button>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted-foreground">{filteredInvitations.length} / {invitations.length} invitation(s)</span>
        {isAdmin && (
          <Button size="sm" onClick={() => setShowCreate(s => !s)}>
            {showCreate ? 'Cancel' : '+ New Invitation'}
          </Button>
        )}
      </div>

      <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input
          value={inviteQuery}
          onChange={e => setInviteQuery(e.target.value)}
          placeholder="Search by email or inviter"
          className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <FilterSelect
          value={inviteRoleFilter}
          onChange={setInviteRoleFilter}
          options={[
            { value: 'all', label: 'All roles' },
            ...invitationRoles.map(role => ({ value: role, label: formatEnumLabel(role) })),
          ]}
        />
        <FilterSelect
          value={inviteStatusFilter}
          onChange={setInviteStatusFilter}
          options={[
            { value: 'all', label: 'All statuses' },
            { value: 'pending', label: 'Pending' },
            { value: 'accepted', label: 'Accepted' },
            { value: 'revoked', label: 'Revoked' },
            { value: 'expired', label: 'Expired' },
          ]}
        />
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="mb-6 p-4 rounded-lg border border-border bg-card/50 space-y-3">
          <h3 className="text-sm font-medium text-foreground">Create Invitation</h3>
          {error && <div className="text-xs text-destructive">{error}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Email *</label>
              <input
                type="email" required
                value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="w-full h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Role *</label>
              <FilterSelect
                value={form.role}
                onChange={value => setForm(f => ({ ...f, role: value }))}
                options={[
                  { value: 'security_champion', label: 'Security Champion' },
                  ...(canInviteRegionalChampions ? [{ value: 'regional_champion', label: 'Regional Champion' }] : []),
                  ...((currentUser?.role === 'admin') ? [{ value: 'global_champion', label: 'Global Champion' }] : []),
                ]}
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Region {requiresInviteRegion ? '*' : '(optional)'}</label>
              <FilterSelect
                value={form.region_id}
                onChange={value => setForm(f => ({ ...f, region_id: value }))}
                options={[
                  ...(!requiresInviteRegion ? [{ value: '', label: '— none —' }] : []),
                  ...regions.map(region => ({ value: String(region.id), label: region.name })),
                ]}
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Expires in (days)</label>
              <input
                type="number" min="1" max="30"
                value={form.expires_in_days} onChange={e => setForm(f => ({ ...f, expires_in_days: e.target.value }))}
                className="w-full h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none"
              />
            </div>
          </div>
          <Button type="submit" size="sm" disabled={submitting}>{submitting ? 'Creating…' : 'Create'}</Button>
        </form>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : invitations.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">No invitations yet.</div>
      ) : filteredInvitations.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">No invitations match the current filters.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="text-left py-2 pr-4">Email</th>
                <th className="text-left py-2 pr-4">Role</th>
                <th className="text-left py-2 pr-4">Region</th>
                <th className="text-left py-2 pr-4">Status</th>
                <th className="text-left py-2 pr-4">Invited by</th>
                <th className="text-left py-2 pr-4">Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredInvitations.map(inv => (
                <tr key={inv.id} className="border-b border-border/50 hover:bg-secondary/30">
                  <td className="py-2 pr-4 text-foreground">{inv.email}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{formatEnumLabel(inv.role)}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{inv.region_name || (inv.region_id ? regionLabelById.get(inv.region_id) : null) || 'Global'}</td>
                  <td className="py-2 pr-4">
                    <InviteStatusBadge status={inv.status} />
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">{inv.invited_by_name || '—'}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{new Date(inv.expires_at * 1000).toLocaleDateString()}</td>
                  <td className="py-2 text-right">
                    {inv.status === 'pending' && isAdmin && (
                      <button
                        onClick={() => setPendingRevoke(inv)}
                        className="text-xs text-destructive hover:underline"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <InlineModal
        open={!!pendingRevoke}
        title="Revoke Invitation"
        description={pendingRevoke ? `Revoke invitation for ${pendingRevoke.email}?` : ''}
        onClose={() => setPendingRevoke(null)}
        actions={(
          <>
            <Button size="sm" variant="ghost" onClick={() => setPendingRevoke(null)}>Cancel</Button>
            <Button size="sm" className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => pendingRevoke && handleRevoke(pendingRevoke.id)}>
              Revoke
            </Button>
          </>
        )}
      />
    </div>
  )
}

function InviteStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-blue-500/10 text-blue-400',
    accepted: 'bg-green-500/10 text-green-400',
    revoked: 'bg-red-500/10 text-red-400',
    expired: 'bg-yellow-500/10 text-yellow-400',
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? ''}`}>
      {formatEnumLabel(status)}
    </span>
  )
}

// ─── Structure Tab ─────────────────────────────────────────────────────────────

function StructureTab({ mode = 'structure' }: { mode?: StructureMode }) {
  const [regions, setRegions] = useState<Region[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedRegions, setExpandedRegions] = useState<Set<number>>(new Set())
  const [expandedClients, setExpandedClients] = useState<Set<number>>(new Set())
  const [addingRegion, setAddingRegion] = useState(false)
  const [addingClientFor, setAddingClientFor] = useState<number | null>(null)
  const [addingProjectFor, setAddingProjectFor] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [editTarget, setEditTarget] = useState<{ kind: CrudKind; id: number; name: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ kind: CrudKind; id: number; name: string } | null>(null)
  const [editName, setEditName] = useState('')
  const [actionError, setActionError] = useState('')
  const { currentUser } = useMissionControl()
  const canManageScoped = currentUser?.role === 'admin' || currentUser?.role === 'global_champion' || currentUser?.role === 'regional_champion'
  const canManageRegions = currentUser?.role === 'admin' || currentUser?.role === 'global_champion'

  const endpointByKind: Record<CrudKind, '/api/regions' | '/api/clients' | '/api/projects'> = {
    region: '/api/regions',
    account: '/api/clients',
    project: '/api/projects',
  }

  const labelByKind: Record<CrudKind, string> = {
    region: 'Region',
    account: 'Account',
    project: 'Project',
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [r, c, p] = await Promise.all([
        fetch('/api/regions').then(res => res.ok ? res.json() : { regions: [] }),
        fetch('/api/clients').then(res => res.ok ? res.json() : { clients: [] }),
        fetch('/api/projects').then(res => res.ok ? res.json() : { projects: [] }),
      ])
      setRegions(r.regions ?? [])
      setClients(c.clients ?? [])
      setProjects(p.projects ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const toggleRegion = (id: number) =>
    setExpandedRegions(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleClient = (id: number) =>
    setExpandedClients(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const addRegion = async () => {
    if (!newName.trim()) return
    setSubmitting(true)
    await fetch('/api/regions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    })
    setNewName(''); setAddingRegion(false); setSubmitting(false); load()
  }

  const addClient = async (regionId: number) => {
    if (!newName.trim()) return
    setSubmitting(true)
    await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), region_id: regionId }),
    })
    setNewName(''); setAddingClientFor(null); setSubmitting(false); load()
  }

  const addProject = async (clientId: number) => {
    if (!newName.trim()) return
    setSubmitting(true)
    await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), client_id: clientId }),
    })
    setNewName(''); setAddingProjectFor(null); setSubmitting(false); load()
  }

  const openEditModal = (kind: CrudKind, id: number, name: string) => {
    setActionError('')
    setEditTarget({ kind, id, name })
    setEditName(name)
  }

  const openDeleteModal = (kind: CrudKind, id: number, name: string) => {
    setActionError('')
    setDeleteTarget({ kind, id, name })
  }

  const closeModals = () => {
    setEditTarget(null)
    setDeleteTarget(null)
    setActionError('')
  }

  const submitEdit = async () => {
    if (!editTarget) return
    const trimmed = editName.trim()
    if (!trimmed || trimmed === editTarget.name) {
      closeModals()
      return
    }

    setSubmitting(true)
    const res = await fetch(endpointByKind[editTarget.kind], {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editTarget.id, name: trimmed }),
    })
    setSubmitting(false)

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setActionError(data.error || `Failed to update ${editTarget.kind}`)
      return
    }

    closeModals()
    load()
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return

    setSubmitting(true)
    const res = await fetch(endpointByKind[deleteTarget.kind], {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: deleteTarget.id }),
    })
    setSubmitting(false)

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setActionError(data.error || `Failed to delete ${deleteTarget.kind}`)
      return
    }

    closeModals()
    load()
  }

  const crudModals = (
    <>
      <InlineModal
        open={!!editTarget}
        title={editTarget ? `Edit ${labelByKind[editTarget.kind]}` : ''}
        description={editTarget ? `Update the ${labelByKind[editTarget.kind].toLowerCase()} name.` : ''}
        onClose={closeModals}
        actions={(
          <>
            <Button size="sm" variant="ghost" onClick={closeModals} disabled={submitting}>Cancel</Button>
            <Button size="sm" onClick={submitEdit} disabled={submitting || !editName.trim()}>
              {submitting ? 'Saving…' : 'Save'}
            </Button>
          </>
        )}
      >
        <div className="space-y-2">
          <label className="block text-xs text-muted-foreground">Name</label>
          <input
            autoFocus
            type="text"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitEdit() }}
            className="w-full h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          {actionError && <div className="text-xs text-destructive">{actionError}</div>}
        </div>
      </InlineModal>

      <InlineModal
        open={!!deleteTarget}
        title={deleteTarget ? `Delete ${labelByKind[deleteTarget.kind]}` : ''}
        description={deleteTarget ? `This will permanently remove "${deleteTarget.name}".` : ''}
        onClose={closeModals}
        actions={(
          <>
            <Button size="sm" variant="ghost" onClick={closeModals} disabled={submitting}>Cancel</Button>
            <Button size="sm" onClick={confirmDelete} disabled={submitting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {submitting ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        )}
      >
        {actionError && <div className="text-xs text-destructive">{actionError}</div>}
      </InlineModal>
    </>
  )

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>

  if (mode === 'regions') {
    const totalAccounts = clients.length
    const totalProjects = projects.length

    return (
      <>
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-border bg-card/40 px-4 py-3">
            <div className="text-xs text-muted-foreground">Regions</div>
            <div className="text-2xl font-semibold text-foreground mt-1">{regions.length}</div>
          </div>
          <div className="rounded-lg border border-border bg-card/40 px-4 py-3">
            <div className="text-xs text-muted-foreground">Accounts</div>
            <div className="text-2xl font-semibold text-foreground mt-1">{totalAccounts}</div>
          </div>
          <div className="rounded-lg border border-border bg-card/40 px-4 py-3">
            <div className="text-xs text-muted-foreground">Projects</div>
            <div className="text-2xl font-semibold text-foreground mt-1">{totalProjects}</div>
          </div>
        </div>

        {regions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-sm text-muted-foreground text-center">
            No regions yet. Create one to get started.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {regions.map(region => {
              const regionClients = clients.filter(c => c.region_id === region.id)
              const regionProjects = projects.filter(p => regionClients.some(c => c.id === p.client_id))
              return (
                <div key={region.id} className="rounded-lg border border-border bg-card/50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">{region.name}</div>
                      <div className="text-xs text-muted-foreground mt-1">Regional segment</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] px-2 py-1 rounded bg-secondary text-muted-foreground">
                        {region.slug}
                      </span>
                      {canManageRegions && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openEditModal('region', region.id, region.name)}
                            className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                            disabled={submitting}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => openDeleteModal('region', region.id, region.name)}
                            className="text-[10px] px-1.5 py-0.5 rounded border border-border text-destructive/90 hover:text-destructive hover:border-destructive/50"
                            disabled={submitting}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-md border border-border/60 bg-background/30 px-2.5 py-2">
                      <div className="text-[10px] text-muted-foreground">Accounts</div>
                      <div className="text-sm font-medium text-foreground mt-0.5">{regionClients.length}</div>
                    </div>
                    <div className="rounded-md border border-border/60 bg-background/30 px-2.5 py-2">
                      <div className="text-[10px] text-muted-foreground">Projects</div>
                      <div className="text-sm font-medium text-foreground mt-0.5">{regionProjects.length}</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {canManageRegions && (
          <div className="pt-1">
            {addingRegion ? (
              <InlineAddForm
                placeholder="Region name"
                value={newName}
                onChange={setNewName}
                onSubmit={addRegion}
                onCancel={() => { setAddingRegion(false); setNewName('') }}
                submitting={submitting}
              />
            ) : (
              <button
                onClick={() => setAddingRegion(true)}
                className="text-sm text-primary hover:underline"
              >
                + Add region
              </button>
            )}
          </div>
        )}
      </div>
      {crudModals}
      </>
    )
  }

  if (mode === 'accounts') {
    return (
      <>
      <div className="space-y-3">
        {regions.map(region => {
          const regionClients = clients.filter(c => c.region_id === region.id)
          return (
            <div key={region.id} className="rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-2.5 bg-secondary/40">
                <div className="text-sm font-medium text-foreground">{region.name}</div>
              </div>
              <div className="px-4 py-3 space-y-2">
                {regionClients.map(client => (
                  <div key={client.id} className="flex items-center justify-between rounded border border-border/50 px-3 py-2">
                    <span className="text-sm text-foreground">{client.name}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {projects.filter(p => p.client_id === client.id).length} project(s)
                      </span>
                      {canManageScoped && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEditModal('account', client.id, client.name)}
                            className="text-xs px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                            disabled={submitting}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => openDeleteModal('account', client.id, client.name)}
                            className="text-xs px-1.5 py-0.5 rounded border border-border text-destructive/90 hover:text-destructive hover:border-destructive/50"
                            disabled={submitting}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {regionClients.length === 0 && (
                  <div className="text-xs text-muted-foreground">No accounts in this region.</div>
                )}

                {canManageScoped && (
                  addingClientFor === region.id ? (
                    <InlineAddForm
                      placeholder="Account name"
                      value={newName}
                      onChange={setNewName}
                      onSubmit={() => addClient(region.id)}
                      onCancel={() => { setAddingClientFor(null); setNewName('') }}
                      submitting={submitting}
                    />
                  ) : (
                    <button
                      onClick={() => { setAddingClientFor(region.id); setNewName('') }}
                      className="text-xs text-primary hover:underline"
                    >
                      + Add account
                    </button>
                  )
                )}
              </div>
            </div>
          )
        })}
      </div>
      {crudModals}
      </>
    )
  }

  if (mode === 'projects') {
    return (
      <>
      <div className="space-y-3">
        {clients.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">No accounts yet. Add accounts first.</div>
        ) : (
          clients.map(client => {
            const clientProjects = projects.filter(p => p.client_id === client.id)
            const region = regions.find(r => r.id === client.region_id)
            return (
              <div key={client.id} className="rounded-lg border border-border overflow-hidden">
                <div className="px-4 py-2.5 bg-secondary/40 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-foreground">{client.name}</div>
                    <div className="text-xs text-muted-foreground">{region?.name ?? 'Unknown region'}</div>
                  </div>
                  <span className="text-xs text-muted-foreground">{clientProjects.length} project(s)</span>
                </div>
                <div className="px-4 py-3 space-y-2">
                  {clientProjects.map(project => (
                    <div key={project.id} className="flex items-center justify-between rounded border border-border/50 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-foreground">{project.name}</span>
                        {project.archived_at && <span className="text-xs text-yellow-500">archived</span>}
                      </div>
                      {canManageScoped && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEditModal('project', project.id, project.name)}
                            className="text-xs px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                            disabled={submitting}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => openDeleteModal('project', project.id, project.name)}
                            className="text-xs px-1.5 py-0.5 rounded border border-border text-destructive/90 hover:text-destructive hover:border-destructive/50"
                            disabled={submitting}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {clientProjects.length === 0 && (
                    <div className="text-xs text-muted-foreground">No projects.</div>
                  )}

                  {canManageScoped && (
                    addingProjectFor === client.id ? (
                      <InlineAddForm
                        placeholder="Project name"
                        value={newName}
                        onChange={setNewName}
                        onSubmit={() => addProject(client.id)}
                        onCancel={() => { setAddingProjectFor(null); setNewName('') }}
                        submitting={submitting}
                      />
                    ) : (
                      <button
                        onClick={() => { setAddingProjectFor(client.id); setNewName('') }}
                        className="text-xs text-primary hover:underline"
                      >
                        + Add project
                      </button>
                    )
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
      {crudModals}
      </>
    )
  }

  return (
    <>
    <div className="space-y-2">
      {regions.length === 0 && (
        <div className="text-sm text-muted-foreground py-8 text-center">No regions yet. Create one to get started.</div>
      )}

      {regions.map(region => {
        const regionClients = clients.filter(c => c.region_id === region.id)
        const isOpen = expandedRegions.has(region.id)
        return (
          <div key={region.id} className="rounded-lg border border-border overflow-hidden">
            <div
              className="flex items-center gap-2 px-4 py-2.5 bg-secondary/40 cursor-pointer hover:bg-secondary/60 select-none"
              onClick={() => toggleRegion(region.id)}
            >
              <ChevronIcon open={isOpen} />
              <span className="text-sm font-medium text-foreground flex-1">{region.name}</span>
              <span className="text-xs text-muted-foreground">{regionClients.length} client(s)</span>
              {canManageScoped && (
                <button
                  onClick={e => { e.stopPropagation(); setAddingClientFor(region.id); setNewName(''); setExpandedRegions(s => new Set([...s, region.id])) }}
                  className="text-xs text-primary hover:underline ml-2"
                >
                  + client
                </button>
              )}
            </div>

            {isOpen && (
              <div className="px-4 pb-3 pt-2 space-y-2">
                {addingClientFor === region.id && (
                  <InlineAddForm
                    placeholder="Client name"
                    value={newName}
                    onChange={setNewName}
                    onSubmit={() => addClient(region.id)}
                    onCancel={() => { setAddingClientFor(null); setNewName('') }}
                    submitting={submitting}
                  />
                )}

                {regionClients.length === 0 && addingClientFor !== region.id && (
                  <div className="text-xs text-muted-foreground py-2 pl-4">No clients in this region.</div>
                )}

                {regionClients.map(client => {
                  const clientProjects = projects.filter(p => p.client_id === client.id)
                  const clientOpen = expandedClients.has(client.id)
                  return (
                    <div key={client.id} className="rounded border border-border/50">
                      <div
                        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-secondary/40 select-none"
                        onClick={() => toggleClient(client.id)}
                      >
                        <ChevronIcon open={clientOpen} small />
                        <span className="text-sm text-foreground flex-1">{client.name}</span>
                        <span className="text-xs text-muted-foreground">{clientProjects.length} project(s)</span>
                        {canManageScoped && (
                          <button
                            onClick={e => { e.stopPropagation(); setAddingProjectFor(client.id); setNewName(''); setExpandedClients(s => new Set([...s, client.id])) }}
                            className="text-xs text-primary hover:underline ml-2"
                          >
                            + project
                          </button>
                        )}
                      </div>

                      {clientOpen && (
                        <div className="px-6 pb-2 space-y-1">
                          {addingProjectFor === client.id && (
                            <InlineAddForm
                              placeholder="Project name"
                              value={newName}
                              onChange={setNewName}
                              onSubmit={() => addProject(client.id)}
                              onCancel={() => { setAddingProjectFor(null); setNewName('') }}
                              submitting={submitting}
                            />
                          )}
                          {clientProjects.length === 0 && addingProjectFor !== client.id && (
                            <div className="text-xs text-muted-foreground py-1.5">No projects.</div>
                          )}
                          {clientProjects.map(proj => (
                            <div key={proj.id} className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
                              <span className="w-1.5 h-1.5 rounded-full bg-border inline-block" />
                              <span>{proj.name}</span>
                              {proj.archived_at && <span className="text-xs text-yellow-500">(archived)</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {canManage && (
        addingRegion ? (
          <InlineAddForm
            placeholder="Region name"
            value={newName}
            onChange={setNewName}
            onSubmit={addRegion}
            onCancel={() => { setAddingRegion(false); setNewName('') }}
            submitting={submitting}
          />
        ) : (
          <button
            onClick={() => setAddingRegion(true)}
            className="mt-2 text-sm text-primary hover:underline"
          >
            + Add region
          </button>
        )
      )}
    </div>
    {crudModals}
    </>
  )
}

// ─── Champions Tab ─────────────────────────────────────────────────────────────

function ChampionsTab() {
  const [users, setUsers] = useState<User[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [userQuery, setUserQuery] = useState('')
  const [userRoleFilter, setUserRoleFilter] = useState('all')
  const [userAccessFilter, setUserAccessFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingUserId, setEditingUserId] = useState<number | null>(null)
  const [roleDraft, setRoleDraft] = useState('')
  const [regionDraft, setRegionDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<User | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const { currentUser } = useMissionControl()
  const canManage = currentUser?.role === 'admin' || currentUser?.role === 'global_champion' || currentUser?.role === 'regional_champion'
  const actorRole = currentUser?.role
  const currentUserRow = users.find(u => u.id === currentUser?.id)
  const currentUserRegionId = currentUserRow?.region_id ?? null
  const canRemoveUsers = actorRole === 'admin'

  const roleBadgeClass = (role: string) => {
    const cls: Record<string, string> = {
      admin: 'bg-red-500/15 text-red-300',
      global_champion: 'bg-indigo-500/15 text-indigo-300',
      regional_champion: 'bg-blue-500/15 text-blue-300',
      security_champion: 'bg-emerald-500/15 text-emerald-300',
    }
    return cls[role] || 'bg-secondary text-muted-foreground'
  }

  const loadUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [res, regionsRes] = await Promise.all([
        fetch('/api/auth/users', { cache: 'no-store' }),
        fetch('/api/regions', { cache: 'no-store' }),
      ])
      const data = await res.json().catch(() => ({}))
      const regionsData = await regionsRes.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Failed to load users')
        setUsers([])
        return
      }
      setUsers(Array.isArray(data.users) ? data.users : [])
      setRegions(Array.isArray(regionsData.regions) ? regionsData.regions : [])
    } catch {
      setError('Failed to load users')
      setUsers([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  const getRoleOptionsForUser = (user: User) => {
    if (actorRole === 'admin') {
      return ['admin', 'global_champion', 'regional_champion', 'security_champion']
    }
    if (actorRole === 'global_champion') {
      return user.role === 'regional_champion'
        ? ['regional_champion', 'security_champion']
        : ['global_champion', 'regional_champion', 'security_champion']
    }
    return ['security_champion']
  }

  const canEditUser = (user: User) => {
    if (!currentUser || user.id === currentUser.id) return false
    if (actorRole === 'admin') return true
    if (actorRole === 'global_champion') return user.role !== 'admin'
    if (actorRole === 'regional_champion') {
      return currentUserRegionId != null && user.region_id === currentUserRegionId && user.role === 'security_champion'
    }
    return false
  }

  const startEditRole = (u: User) => {
    if (!canEditUser(u)) return
    setFeedback(null)
    setEditingUserId(u.id)
    setRoleDraft(u.role)
    setRegionDraft(u.region_id ? String(u.region_id) : '')
  }

  const saveRole = async (u: User) => {
    if (!canEditUser(u) || !roleDraft) {
      setEditingUserId(null)
      return
    }
    const nextRegionId = regionDraft ? Number(regionDraft) : null
    const currentRegionId = u.region_id ?? null
    if (roleDraft === u.role && nextRegionId === currentRegionId) {
      setEditingUserId(null)
      return
    }
    setSaving(true)
    const res = await fetch('/api/auth/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, role: roleDraft, region_id: nextRegionId }),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)

    if (!res.ok) {
      setFeedback(data.error || 'Failed to update role')
      return
    }

    setFeedback('Role updated')
    setEditingUserId(null)
    loadUsers()
  }

  const deleteUser = async () => {
    if (!pendingDelete || !canChangeRoles) return
    setSaving(true)
    const res = await fetch('/api/auth/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: pendingDelete.id }),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)

    if (!res.ok) {
      setFeedback(data.error || 'Failed to delete user')
      return
    }

    setFeedback('User removed')
    setPendingDelete(null)
    loadUsers()
  }

  const userRoles = Array.from(new Set(users.map(u => u.role))).sort()
  const regionLabelById = new Map(regions.map(r => [r.id, r.name]))
  const filteredUsers = users.filter(u => {
    const query = userQuery.trim().toLowerCase()
    const matchesQuery = !query ||
      (u.display_name || '').toLowerCase().includes(query) ||
      u.username.toLowerCase().includes(query) ||
      (u.email || '').toLowerCase().includes(query)
    const matchesRole = userRoleFilter === 'all' || u.role === userRoleFilter
    const accessState = u.is_approved === 0 ? 'pending' : 'active'
    const matchesAccess = userAccessFilter === 'all' || accessState === userAccessFilter
    return matchesQuery && matchesRole && matchesAccess
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">{filteredUsers.length} / {users.length} user(s)</div>
        {!canManage && (
          <div className="text-xs text-muted-foreground rounded-md border border-border px-2 py-1">
            You do not have permission to manage champions.
          </div>
        )}
        {canManage && actorRole !== 'admin' && (
          <div className="text-xs text-muted-foreground rounded-md border border-border px-2 py-1">
            You can edit only users within your scope. Removing users requires admin permissions.
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input
          value={userQuery}
          onChange={e => setUserQuery(e.target.value)}
          placeholder="Search by name, username, email"
          className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <FilterSelect
          value={userRoleFilter}
          onChange={setUserRoleFilter}
          options={[
            { value: 'all', label: 'All roles' },
            ...userRoles.map(role => ({ value: role, label: formatEnumLabel(role) })),
          ]}
        />
        <FilterSelect
          value={userAccessFilter}
          onChange={setUserAccessFilter}
          options={[
            { value: 'all', label: 'All access' },
            { value: 'active', label: 'Active' },
            { value: 'pending', label: 'Pending' },
          ]}
        />
      </div>

      {feedback && (
        <div className="text-xs text-muted-foreground rounded-md border border-border bg-card/40 px-3 py-2">
          {feedback}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading users…</div>
      ) : error ? (
        <div className="text-sm text-destructive">{error}</div>
      ) : !canManage ? (
        <div className="text-sm text-muted-foreground">You do not have permission to manage champions.</div>
      ) : users.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">No users found.</div>
      ) : filteredUsers.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">No users match the current filters.</div>
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="text-left py-2.5 px-3">User</th>
                <th className="text-left py-2.5 px-3">Email</th>
                <th className="text-left py-2.5 px-3">Role</th>
                <th className="text-left py-2.5 px-3">Region</th>
                <th className="text-left py-2.5 px-3">Access</th>
                <th className="text-right py-2.5 px-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map(u => {
                const isSelf = u.id === currentUser?.id
                const isEditing = editingUserId === u.id
                const canEditThisUser = canEditUser(u)
                const availableRoleOptions = getRoleOptionsForUser(u)
                return (
                  <tr key={u.id} className="border-b border-border/50 hover:bg-secondary/20">
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-foreground">{u.display_name || u.username}</div>
                      <div className="text-xs text-muted-foreground">@{u.username}</div>
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground">{u.email || '—'}</td>
                    <td className="py-2.5 px-3">
                      {isEditing ? (
                        <select
                          value={roleDraft}
                          onChange={e => setRoleDraft(e.target.value)}
                          className="h-8 px-2 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none"
                        >
                          {availableRoleOptions.map(role => (
                            <option key={role} value={role}>{formatEnumLabel(role)}</option>
                          ))}
                        </select>
                      ) : (
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${roleBadgeClass(u.role)}`}>
                          {formatEnumLabel(u.role)}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground">
                      {isEditing ? (
                        <select
                          value={regionDraft}
                          onChange={e => setRegionDraft(e.target.value)}
                          disabled={actorRole === 'regional_champion'}
                          className="h-8 px-2 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none"
                        >
                          {actorRole !== 'regional_champion' && <option value="">Global</option>}
                          {regions.map(region => (
                            <option key={region.id} value={region.id}>{region.name}</option>
                          ))}
                        </select>
                      ) : (
                        u.region_name || (u.region_id ? regionLabelById.get(u.region_id) : null) || 'Global'
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${u.is_approved === 0 ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                        {u.is_approved === 0 ? 'Pending' : 'Active'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        {isEditing ? (
                          <>
                            <Button size="sm" onClick={() => saveRole(u)} disabled={saving || !canEditThisUser || isSelf || (roleDraft === u.role && (regionDraft ? Number(regionDraft) : null) === (u.region_id ?? null))}>
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingUserId(null)} disabled={saving}>Cancel</Button>
                          </>
                        ) : (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => startEditRole(u)} disabled={!canEditThisUser || isSelf}>
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setPendingDelete(u)}
                              disabled={!canRemoveUsers || isSelf}
                              className="text-destructive hover:text-destructive"
                            >
                              Remove
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <InlineModal
        open={!!pendingDelete}
        title="Remove User"
        description={pendingDelete ? `Remove ${pendingDelete.display_name || pendingDelete.username} from the program?` : ''}
        onClose={() => setPendingDelete(null)}
        actions={(
          <>
            <Button size="sm" variant="ghost" onClick={() => setPendingDelete(null)} disabled={saving}>Cancel</Button>
            <Button size="sm" className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={deleteUser} disabled={saving}>
              {saving ? 'Removing…' : 'Remove'}
            </Button>
          </>
        )}
      />
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function InlineModal({
  open,
  title,
  description,
  children,
  actions,
  onClose,
}: {
  open: boolean
  title: string
  description?: string
  children?: React.ReactNode
  actions?: React.ReactNode
  onClose: () => void
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/55"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        {children && <div className="mt-4">{children}</div>}
        {actions && <div className="mt-5 flex justify-end gap-2">{actions}</div>}
      </div>
    </div>
  )
}

function FilterSelect({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: SelectOption[] }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const selected = options.find(opt => opt.value === value) ?? options[0]

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="w-full h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 flex items-center justify-between"
      >
        <span className="truncate text-left">{selected?.label}</span>
        <svg className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4,6 8,10 12,6" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full mt-1 z-50 w-full rounded-md border border-border bg-card shadow-xl overflow-hidden">
          {options.map(opt => {
            const active = opt.value === value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false) }}
                className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${active ? 'bg-primary/20 text-foreground' : 'text-foreground hover:bg-secondary/70'}`}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ChevronIcon({ open, small }: { open: boolean; small?: boolean }) {
  return (
    <svg
      className={`${small ? 'w-3 h-3' : 'w-4 h-4'} text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
      viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  )
}

function InlineAddForm({
  placeholder, value, onChange, onSubmit, onCancel, submitting,
}: {
  placeholder: string
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
  submitting: boolean
}) {
  return (
    <div className="flex gap-2 my-1">
      <input
        autoFocus
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onSubmit(); if (e.key === 'Escape') onCancel() }}
        placeholder={placeholder}
        className="flex-1 h-8 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
      />
      <Button size="sm" onClick={onSubmit} disabled={!value.trim() || submitting}>Add</Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
    </div>
  )
}
