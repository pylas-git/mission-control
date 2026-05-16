'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'

const BELT_NAMES = ['White', 'Yellow', 'Orange', 'Green', 'Blue', 'Purple', 'Red', 'Brown', 'Black']

interface UserOption {
  id: number
  username: string
  display_name?: string | null
  role: string
}

interface ProjectOption {
  id: number
  name: string
  client_name?: string
  has_gap?: number
  has_overdue_gap?: number
}

interface SkipRequest {
  id: number
  user_id: number
  from_belt: number
  to_belt: number
  reason_text: string
  requested_at: number
  status: 'pending' | 'approved' | 'rejected'
  user_name?: string
  user_email?: string
  requested_by_name?: string
}

interface Waiver {
  id: number
  project_id: number
  champion_user_id: number
  expires_at: number
  remediation_target_belt: number
  remediation_due_date: number
  remediation_notes?: string | null
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  project_name?: string
  champion_name?: string
  champion_email?: string
  requested_by_name?: string
}

function formatDate(ts?: number | null) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleDateString()
}

export function BeltRequestsPanel() {
  const { currentUser } = useMissionControl()
  const [users, setUsers] = useState<UserOption[]>([])
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [skipRequests, setSkipRequests] = useState<SkipRequest[]>([])
  const [waivers, setWaivers] = useState<Waiver[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [skipForm, setSkipForm] = useState({ user_id: '', from_belt: '0', to_belt: '1', reason_text: '' })
  const [waiverForm, setWaiverForm] = useState({ project_id: '', champion_user_id: '', expires_at: '', remediation_target_belt: '1', remediation_due_date: '', remediation_notes: '' })
  const [skipStatusFilter, setSkipStatusFilter] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [waiverStatusFilter, setWaiverStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'expired'>('pending')
  const [skipQuery, setSkipQuery] = useState('')
  const [waiverQuery, setWaiverQuery] = useState('')

  const role = currentUser?.role
  const canRequestSkip = role === 'admin' || role === 'global_champion' || role === 'regional_champion'
  const canReviewSkip = role === 'admin' || role === 'global_champion'
  const canRequestWaiver = role === 'admin' || role === 'global_champion' || role === 'regional_champion'
  const canReviewWaiver = role === 'admin' || role === 'global_champion'

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const requests: Promise<any>[] = [
        fetch('/api/auth/users', { cache: 'no-store' }).then(res => res.json().catch(() => ({}))),
        fetch('/api/projects', { cache: 'no-store' }).then(res => res.json().catch(() => ({}))),
      ]

      if (canReviewSkip) requests.push(fetch(`/api/belt-skips?status=${skipStatusFilter}`, { cache: 'no-store' }).then(res => res.json().catch(() => ({}))))
      if (canReviewWaiver) requests.push(fetch(`/api/qualification-waivers?status=${waiverStatusFilter}`, { cache: 'no-store' }).then(res => res.json().catch(() => ({}))))

      const [usersData, projectsData, skipData, waiverData] = await Promise.all(requests)
      setUsers(Array.isArray(usersData.users) ? usersData.users.filter((user: UserOption) => user.role !== 'admin') : [])
      setProjects(Array.isArray(projectsData.projects) ? projectsData.projects : [])
      setSkipRequests(Array.isArray(skipData?.skip_requests) ? skipData.skip_requests : [])
      setWaivers(Array.isArray(waiverData?.waivers) ? waiverData.waivers : [])
    } catch {
      setError('Failed to load request data')
    } finally {
      setLoading(false)
    }
  }, [canReviewSkip, canReviewWaiver, skipStatusFilter, waiverStatusFilter])

  useEffect(() => {
    loadData()
  }, [loadData])

  const normalizedSkipQuery = skipQuery.trim().toLowerCase()
  const normalizedWaiverQuery = waiverQuery.trim().toLowerCase()
  const skipReason = skipForm.reason_text.trim()
  const canSubmitSkip =
    skipForm.user_id.length > 0 &&
    skipReason.length > 0 &&
    Number(skipForm.to_belt) > Number(skipForm.from_belt)

  const visibleSkipRequests = useMemo(() => {
    return skipRequests.filter(request => {
      if (!normalizedSkipQuery) return true
      const haystack = `${request.user_name ?? ''} ${request.user_email ?? ''} ${request.requested_by_name ?? ''} ${request.reason_text}`.toLowerCase()
      return haystack.includes(normalizedSkipQuery)
    })
  }, [skipRequests, normalizedSkipQuery])

  const visibleWaivers = useMemo(() => {
    return waivers.filter(waiver => {
      if (!normalizedWaiverQuery) return true
      const haystack = `${waiver.project_name ?? ''} ${waiver.champion_name ?? ''} ${waiver.champion_email ?? ''} ${waiver.requested_by_name ?? ''} ${waiver.remediation_notes ?? ''}`.toLowerCase()
      return haystack.includes(normalizedWaiverQuery)
    })
  }, [waivers, normalizedWaiverQuery])

  const submitSkip = async () => {
    if (!canSubmitSkip) return

    const res = await fetch('/api/belt-skips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: Number(skipForm.user_id),
        from_belt: Number(skipForm.from_belt),
        to_belt: Number(skipForm.to_belt),
        reason_text: skipReason,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || 'Failed to create skip request')
      return
    }
    setSkipForm({ user_id: '', from_belt: '0', to_belt: '1', reason_text: '' })
    await loadData()
  }

  const reviewSkip = async (id: number, action: 'approved' | 'rejected') => {
    const res = await fetch('/api/belt-skips', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || 'Failed to review skip request')
      return
    }
    await loadData()
  }

  const submitWaiver = async () => {
    const res = await fetch('/api/qualification-waivers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: Number(waiverForm.project_id),
        champion_user_id: Number(waiverForm.champion_user_id),
        expires_at: Math.floor(new Date(waiverForm.expires_at).getTime() / 1000),
        remediation_target_belt: Number(waiverForm.remediation_target_belt),
        remediation_due_date: Math.floor(new Date(waiverForm.remediation_due_date).getTime() / 1000),
        remediation_notes: waiverForm.remediation_notes || undefined,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || 'Failed to create waiver request')
      return
    }
    setWaiverForm({ project_id: '', champion_user_id: '', expires_at: '', remediation_target_belt: '1', remediation_due_date: '', remediation_notes: '' })
    await loadData()
  }

  const reviewWaiver = async (id: number, action: 'approved' | 'rejected') => {
    const res = await fetch('/api/qualification-waivers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || 'Failed to review waiver')
      return
    }
    await loadData()
  }

  return (
    <div className="p-6 w-full max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Requests</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage belt skip requests and qualification waivers.</p>
      </div>

      {error && <div className="text-sm text-destructive">{error}</div>}

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-lg border border-border bg-card/30 p-4 space-y-4">
          <div>
            <div className="text-sm font-medium text-foreground">Belt Skip Requests</div>
            <div className="text-xs text-muted-foreground mt-1">Regional/global flows for non-sequential champion belt progression.</div>
          </div>

          {canRequestSkip && (
            <div className="grid gap-3">
              <select value={skipForm.user_id} onChange={event => setSkipForm(prev => ({ ...prev, user_id: event.target.value }))} className="h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
                <option value="">Champion</option>
                {users.map(user => <option key={user.id} value={user.id}>{user.display_name || user.username}</option>)}
              </select>
              <div className="grid gap-3 sm:grid-cols-2">
                <select value={skipForm.from_belt} onChange={event => setSkipForm(prev => ({ ...prev, from_belt: event.target.value }))} className="h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
                  {BELT_NAMES.map((name, level) => <option key={`from-${name}`} value={level}>From L{level} {name}</option>)}
                </select>
                <select value={skipForm.to_belt} onChange={event => setSkipForm(prev => ({ ...prev, to_belt: event.target.value }))} className="h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
                  {BELT_NAMES.map((name, level) => <option key={`to-${name}`} value={level}>To L{level} {name}</option>)}
                </select>
              </div>
              <textarea value={skipForm.reason_text} onChange={event => setSkipForm(prev => ({ ...prev, reason_text: event.target.value }))} rows={3} placeholder="Reason for skip request" className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none resize-none" />
              <Button onClick={submitSkip} disabled={!canSubmitSkip}>Submit Skip Request</Button>
            </div>
          )}

          {loading ? <div className="text-sm text-muted-foreground">Loading skip requests…</div> : skipRequests.length === 0 ? <div className="text-sm text-muted-foreground">No pending skip requests.</div> : (
            <div className="grid gap-2 sm:grid-cols-[180px_minmax(220px,1fr)]">
              <select value={skipStatusFilter} onChange={event => setSkipStatusFilter(event.target.value as 'pending' | 'approved' | 'rejected')} className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
              <input value={skipQuery} onChange={event => setSkipQuery(event.target.value)} placeholder="Search champion, requester, or reason" className="h-9 w-full px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none" />
            </div>
          )}

          {!loading && skipRequests.length > 0 && (
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>Showing {visibleSkipRequests.length} of {skipRequests.length} skip request(s)</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSkipStatusFilter('pending')
                  setSkipQuery('')
                }}
                disabled={skipStatusFilter === 'pending' && skipQuery.length === 0}
              >
                Reset skip filters
              </Button>
            </div>
          )}

          {loading ? null : skipRequests.length === 0 ? null : visibleSkipRequests.length === 0 ? (
            <div className="text-sm text-muted-foreground">No skip requests match current filters.</div>
          ) : (
            <div className="space-y-3">
              {visibleSkipRequests.map(request => (
                <div key={request.id} className="rounded-md border border-border bg-background/40 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-foreground">{request.user_name || request.user_email || `User ${request.user_id}`}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(request.requested_at)}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">Requested by {request.requested_by_name || 'Unknown'}</div>
                  <div className="text-sm text-foreground">L{request.from_belt} {BELT_NAMES[request.from_belt]} → L{request.to_belt} {BELT_NAMES[request.to_belt]}</div>
                  <div className="text-sm text-muted-foreground">{request.reason_text}</div>
                  {canReviewSkip && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => reviewSkip(request.id, 'approved')}>Approve</Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => reviewSkip(request.id, 'rejected')}>Reject</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card/30 p-4 space-y-4">
          <div>
            <div className="text-sm font-medium text-foreground">Qualification Waivers</div>
            <div className="text-xs text-muted-foreground mt-1">Allow unqualified primary owners with a time-boxed remediation plan.</div>
          </div>

          {canRequestWaiver && (
            <div className="grid gap-3">
              <select value={waiverForm.project_id} onChange={event => setWaiverForm(prev => ({ ...prev, project_id: event.target.value }))} className="h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
                <option value="">Project</option>
                {projects.map(project => <option key={project.id} value={project.id}>{project.name}{project.client_name ? ` — ${project.client_name}` : ''}{project.has_overdue_gap ? ' [OVERDUE GAP]' : project.has_gap ? ' [GAP]' : ''}</option>)}
              </select>
              <select value={waiverForm.champion_user_id} onChange={event => setWaiverForm(prev => ({ ...prev, champion_user_id: event.target.value }))} className="h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
                <option value="">Champion</option>
                {users.map(user => <option key={user.id} value={user.id}>{user.display_name || user.username}</option>)}
              </select>
              <div className="grid gap-3 sm:grid-cols-2">
                <input type="date" value={waiverForm.expires_at} onChange={event => setWaiverForm(prev => ({ ...prev, expires_at: event.target.value }))} className="h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none" />
                <input type="date" value={waiverForm.remediation_due_date} onChange={event => setWaiverForm(prev => ({ ...prev, remediation_due_date: event.target.value }))} className="h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none" />
              </div>
              <select value={waiverForm.remediation_target_belt} onChange={event => setWaiverForm(prev => ({ ...prev, remediation_target_belt: event.target.value }))} className="h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
                {BELT_NAMES.map((name, level) => <option key={`waiver-${name}`} value={level}>Remediation target: L{level} {name}</option>)}
              </select>
              <textarea value={waiverForm.remediation_notes} onChange={event => setWaiverForm(prev => ({ ...prev, remediation_notes: event.target.value }))} rows={3} placeholder="Remediation notes" className="w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none resize-none" />
              <Button onClick={submitWaiver}>Submit Waiver Request</Button>
            </div>
          )}

          {loading ? <div className="text-sm text-muted-foreground">Loading waivers…</div> : waivers.length === 0 ? <div className="text-sm text-muted-foreground">No waivers for this status.</div> : (
            <div className="grid gap-2 sm:grid-cols-[180px_minmax(220px,1fr)]">
              <select value={waiverStatusFilter} onChange={event => setWaiverStatusFilter(event.target.value as 'pending' | 'approved' | 'rejected' | 'expired')} className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="expired">Expired</option>
              </select>
              <input value={waiverQuery} onChange={event => setWaiverQuery(event.target.value)} placeholder="Search project, champion, or notes" className="h-9 w-full px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none" />
            </div>
          )}

          {!loading && waivers.length > 0 && (
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>Showing {visibleWaivers.length} of {waivers.length} waiver(s)</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setWaiverStatusFilter('pending')
                  setWaiverQuery('')
                }}
                disabled={waiverStatusFilter === 'pending' && waiverQuery.length === 0}
              >
                Reset waiver filters
              </Button>
            </div>
          )}

          {loading ? null : waivers.length === 0 ? null : visibleWaivers.length === 0 ? (
            <div className="text-sm text-muted-foreground">No waivers match current filters.</div>
          ) : (
            <div className="space-y-3">
              {visibleWaivers.map(waiver => (
                <div key={waiver.id} className="rounded-md border border-border bg-background/40 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-foreground">{waiver.project_name || `Project ${waiver.project_id}`}</div>
                    <div className="text-xs text-muted-foreground">Expires {formatDate(waiver.expires_at)}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">Champion: {waiver.champion_name || waiver.champion_email || waiver.champion_user_id}</div>
                  <div className="text-xs text-muted-foreground">Requested by {waiver.requested_by_name || 'Unknown'}</div>
                  <div className="text-sm text-foreground">Remediation target L{waiver.remediation_target_belt} {BELT_NAMES[waiver.remediation_target_belt]}</div>
                  <div className="text-sm text-muted-foreground">Due {formatDate(waiver.remediation_due_date)}</div>
                  {waiver.remediation_notes && <div className="text-sm text-muted-foreground">{waiver.remediation_notes}</div>}
                  {canReviewWaiver && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => reviewWaiver(waiver.id, 'approved')}>Approve</Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => reviewWaiver(waiver.id, 'rejected')}>Reject</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}