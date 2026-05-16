'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'

const BELT_NAMES = ['White', 'Yellow', 'Orange', 'Green', 'Blue', 'Purple', 'Red', 'Brown', 'Black']
const BELT_STYLES = [
  'bg-white border border-gray-300 text-gray-800',
  'bg-yellow-300 text-yellow-900',
  'bg-orange-400 text-white',
  'bg-green-600 text-white',
  'bg-blue-600 text-white',
  'bg-purple-600 text-white',
  'bg-red-600 text-white',
  'bg-amber-800 text-white',
  'bg-gray-900 text-white',
]

interface ProjectOption {
  id: number
  name: string
  client_name?: string
  region_name?: string
  current_belt?: number | null
  target_belt?: number | null
  has_gap?: number
  has_overdue_gap?: number
}

interface ChampionOption {
  user_id: number
  display_name: string
  username: string
  role: string
}

interface AssessmentCycle {
  id: number
  belt_level: number
  status: 'active' | 'renewal_open' | 'expired' | 'grace'
  started_at: number
  achieved_at?: number | null
  expires_at?: number | null
  grace_expires_at?: number | null
  primary_champion_id?: number | null
  primary_champion_name?: string | null
}

interface AssessmentItem {
  id: number
  assessment_id: number
  requirement_id?: number | null
  belt_level: number
  title: string
  description?: string | null
  sort_order?: number | null
  status: 'not_started' | 'in_progress' | 'submitted' | 'approved' | 'rejected' | 'out_of_scope'
  evidence_url?: string | null
  evidence_note?: string | null
  rejection_reason?: string | null
  is_in_scope?: number
}

function BeltBadge({ level }: { level: number }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${BELT_STYLES[level]}`}>
      <span className="opacity-60">L{level}</span>
      {BELT_NAMES[level]}
    </span>
  )
}

function formatDate(ts?: number | null) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleDateString()
}

function isValidEvidenceUrl(value: string) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function canSubmitEvidence(draft: { url: string; note: string }) {
  const url = draft.url.trim()
  const note = draft.note.trim()
  if (note.length > 0) return true
  if (url.length === 0) return false
  return isValidEvidenceUrl(url)
}

function statusClass(status: string) {
  switch (status) {
    case 'approved':
    case 'active':
      return 'bg-emerald-500/15 text-emerald-300'
    case 'submitted':
    case 'renewal_open':
    case 'grace':
      return 'bg-amber-500/15 text-amber-300'
    case 'rejected':
    case 'expired':
      return 'bg-red-500/15 text-red-300'
    case 'in_progress':
      return 'bg-blue-500/15 text-blue-300'
    default:
      return 'bg-secondary text-muted-foreground'
  }
}

export function ProjectAssessmentsPanel() {
  const { currentUser } = useMissionControl()
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
  const [champions, setChampions] = useState<ChampionOption[]>([])
  const [cycles, setCycles] = useState<AssessmentCycle[]>([])
  const [items, setItems] = useState<AssessmentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creatingCycle, setCreatingCycle] = useState(false)
  const [newBeltLevel, setNewBeltLevel] = useState(0)
  const [newPrimaryChampionId, setNewPrimaryChampionId] = useState('')
  const [actingItemId, setActingItemId] = useState<number | null>(null)
  const [editingItemId, setEditingItemId] = useState<number | null>(null)
  const [evidenceDrafts, setEvidenceDrafts] = useState<Record<number, { url: string; note: string; rejection: string }>>({})
  const [cycleStatusFilter, setCycleStatusFilter] = useState<'all' | AssessmentCycle['status']>('all')
  const [itemStatusFilter, setItemStatusFilter] = useState<'all' | AssessmentItem['status']>('all')
  const [itemQuery, setItemQuery] = useState('')

  const role = (currentUser?.role ?? '') as string
  const canCreateCycle = role === 'admin' || role === 'global_champion' || role === 'regional_champion'
  const canReview = canCreateCycle

  const loadProjects = useCallback(async () => {
    const res = await fetch('/api/projects', { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    const nextProjects = Array.isArray(data.projects) ? data.projects : []
    setProjects(nextProjects)
    setSelectedProjectId(prev => prev ?? nextProjects[0]?.id ?? null)
  }, [])

  const loadAssessment = useCallback(async () => {
    if (!selectedProjectId) return
    setLoading(true)
    setError(null)
    try {
      const [assessmentRes, championsRes] = await Promise.all([
        fetch(`/api/projects/${selectedProjectId}/assessment`, { cache: 'no-store' }),
        fetch(`/api/projects/${selectedProjectId}/champions`, { cache: 'no-store' }),
      ])

      const assessmentData = await assessmentRes.json().catch(() => ({}))
      const championsData = await championsRes.json().catch(() => ({}))

      if (!assessmentRes.ok) {
        setError(assessmentData.error || 'Failed to load assessments')
        setCycles([])
        setItems([])
        setChampions([])
        return
      }

      setCycles(Array.isArray(assessmentData.cycles) ? assessmentData.cycles : [])
      setItems(Array.isArray(assessmentData.items) ? assessmentData.items : [])
      setChampions(Array.isArray(championsData.champions) ? championsData.champions : [])
    } catch {
      setError('Failed to load assessments')
      setCycles([])
      setItems([])
      setChampions([])
    } finally {
      setLoading(false)
    }
  }, [selectedProjectId])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  useEffect(() => {
    loadAssessment()
  }, [loadAssessment])

  const selectedProject = useMemo(
    () => projects.find(project => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  )

  const itemsByCycle = useMemo(() => {
    const groups = new Map<number, AssessmentItem[]>()
    for (const item of items) {
      if (!groups.has(item.assessment_id)) groups.set(item.assessment_id, [])
      groups.get(item.assessment_id)!.push(item)
    }
    return groups
  }, [items])

  const normalizedItemQuery = itemQuery.trim().toLowerCase()

  const getVisibleItems = useCallback((cycleId: number) => {
    const cycleItems = (itemsByCycle.get(cycleId) ?? [])
      .slice()
      .sort((left, right) => (left.belt_level - right.belt_level) || ((left.sort_order ?? 0) - (right.sort_order ?? 0)) || (left.id - right.id))

    return cycleItems.filter(item => {
      if (itemStatusFilter !== 'all' && item.status !== itemStatusFilter) return false
      if (!normalizedItemQuery) return true

      const haystack = `${item.title} ${item.description ?? ''} ${item.evidence_note ?? ''} ${item.evidence_url ?? ''}`.toLowerCase()
      return haystack.includes(normalizedItemQuery)
    })
  }, [itemsByCycle, itemStatusFilter, normalizedItemQuery])

  const visibleCycles = useMemo(() => {
    return cycles.filter(cycle => {
      if (cycleStatusFilter !== 'all' && cycle.status !== cycleStatusFilter) return false
      return getVisibleItems(cycle.id).length > 0
    })
  }, [cycles, cycleStatusFilter, getVisibleItems])

  const visibleItemCount = useMemo(
    () => visibleCycles.reduce((total, cycle) => total + getVisibleItems(cycle.id).length, 0),
    [visibleCycles, getVisibleItems],
  )

  const assessmentSummary = useMemo(() => {
    const activeCycles = cycles.filter(cycle => cycle.status === 'active' || cycle.status === 'renewal_open' || cycle.status === 'grace').length
    const submittedItems = items.filter(item => item.status === 'submitted').length
    const approvedItems = items.filter(item => item.status === 'approved').length
    const totalInScope = items.filter(item => item.is_in_scope !== 0).length
    const approvalPercent = totalInScope === 0 ? 0 : Math.round((approvedItems / totalInScope) * 100)

    return {
      activeCycles,
      submittedItems,
      approvedItems,
      totalInScope,
      approvalPercent,
    }
  }, [cycles, items])

  const createCycle = async () => {
    if (!selectedProjectId) return
    setCreatingCycle(true)
    setError(null)
    const res = await fetch(`/api/projects/${selectedProjectId}/assessment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        belt_level: newBeltLevel,
        primary_champion_id: newPrimaryChampionId ? Number(newPrimaryChampionId) : undefined,
      }),
    })
    const data = await res.json().catch(() => ({}))
    setCreatingCycle(false)
    if (!res.ok) {
      setError(data.error || 'Failed to create assessment cycle')
      return
    }
    await loadAssessment()
  }

  const updateItem = async (item: AssessmentItem, status: 'in_progress' | 'submitted' | 'approved' | 'rejected') => {
    if (!selectedProjectId) return
    setActingItemId(item.id)
    setError(null)
    const draft = evidenceDrafts[item.id] ?? { url: '', note: '', rejection: '' }
    const payload: {
      status: 'in_progress' | 'submitted' | 'approved' | 'rejected'
      evidence_url?: string
      evidence_note?: string
      rejection_reason?: string
    } = { status }

    if (status === 'submitted') {
      const trimmedUrl = draft.url.trim()
      const trimmedNote = draft.note.trim()

      if (trimmedUrl.length > 0 && isValidEvidenceUrl(trimmedUrl)) {
        payload.evidence_url = trimmedUrl
      }

      if (trimmedNote.length > 0) {
        payload.evidence_note = trimmedNote
      }

      if (!payload.evidence_url && !payload.evidence_note) {
        setActingItemId(null)
        setError('Provide a valid evidence URL (http/https) or add an evidence note before submitting.')
        return
      }
    }

    if (status === 'rejected' && draft.rejection.trim().length > 0) {
      payload.rejection_reason = draft.rejection.trim()
    }

    const res = await fetch(`/api/projects/${selectedProjectId}/assessment/items/${item.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    setActingItemId(null)
    if (!res.ok) {
      setError(data.error || 'Failed to update assessment item')
      return
    }
    await loadAssessment()
  }

  return (
    <div className="p-6 w-full max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Assessments</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage project belt assessment cycles, evidence submission, and review workflow.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-border bg-card/40 p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Active Cycles</div>
          <div className="mt-2 text-2xl font-semibold text-foreground">{assessmentSummary.activeCycles}</div>
          <div className="text-xs text-muted-foreground mt-1">currently running for selected project</div>
        </div>
        <div className="rounded-lg border border-border bg-card/40 p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Submitted</div>
          <div className="mt-2 text-2xl font-semibold text-foreground">{assessmentSummary.submittedItems}</div>
          <div className="text-xs text-muted-foreground mt-1">item(s) waiting review</div>
        </div>
        <div className="rounded-lg border border-border bg-card/40 p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Approved</div>
          <div className="mt-2 text-2xl font-semibold text-foreground">{assessmentSummary.approvedItems}</div>
          <div className="text-xs text-muted-foreground mt-1">of {assessmentSummary.totalInScope} in-scope items</div>
        </div>
        <div className="rounded-lg border border-border bg-card/40 p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Completion</div>
          <div className="mt-2 text-2xl font-semibold text-foreground">{assessmentSummary.approvalPercent}%</div>
          <div className="text-xs text-muted-foreground mt-1">approved in-scope requirements</div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card/40 p-4 space-y-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_auto_auto_auto] lg:items-end">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Project</div>
            <select value={selectedProjectId ?? ''} onChange={event => setSelectedProjectId(Number(event.target.value))} className="h-10 w-full px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
              {projects.map(project => (
                <option key={project.id} value={project.id}>{project.name}{project.client_name ? ` — ${project.client_name}` : ''}{project.has_overdue_gap ? ' [OVERDUE GAP]' : project.has_gap ? ' [GAP]' : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Target Belt</div>
            <select value={newBeltLevel} onChange={event => setNewBeltLevel(Number(event.target.value))} className="h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
              {BELT_NAMES.map((name, level) => <option key={name} value={level}>L{level} {name}</option>)}
            </select>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Primary Champion</div>
            <select value={newPrimaryChampionId} onChange={event => setNewPrimaryChampionId(event.target.value)} className="h-10 min-w-[220px] px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
              <option value="">Unassigned</option>
              {champions.map(champion => <option key={champion.user_id} value={champion.user_id}>{champion.display_name || champion.username}</option>)}
            </select>
          </div>
          <Button onClick={createCycle} disabled={!canCreateCycle || !selectedProjectId || creatingCycle}>{creatingCycle ? 'Creating…' : 'New Cycle'}</Button>
        </div>

        {selectedProject && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
            <span>{selectedProject.client_name} • {selectedProject.region_name}</span>
            <span>Current <BeltBadge level={selectedProject.current_belt ?? 0} /></span>
            <span>Target <BeltBadge level={selectedProject.target_belt ?? 0} /></span>
            {selectedProject.has_overdue_gap ? <span className="px-2 py-0.5 rounded text-xs bg-red-500/15 text-red-300">Overdue project gap</span> : selectedProject.has_gap ? <span className="px-2 py-0.5 rounded text-xs bg-amber-500/15 text-amber-300">Project gap</span> : null}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Cycle Status</div>
            <select value={cycleStatusFilter} onChange={event => setCycleStatusFilter(event.target.value as 'all' | AssessmentCycle['status'])} className="h-9 w-full px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
              <option value="all">All cycle statuses</option>
              <option value="active">Active</option>
              <option value="renewal_open">Renewal open</option>
              <option value="grace">Grace</option>
              <option value="expired">Expired</option>
            </select>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Requirement Status</div>
            <select value={itemStatusFilter} onChange={event => setItemStatusFilter(event.target.value as 'all' | AssessmentItem['status'])} className="h-9 w-full px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
              <option value="all">All requirement statuses</option>
              <option value="not_started">Not started</option>
              <option value="in_progress">In progress</option>
              <option value="submitted">Submitted</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="out_of_scope">Out of scope</option>
            </select>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Search Requirements</div>
            <input value={itemQuery} onChange={event => setItemQuery(event.target.value)} placeholder="Title, description, evidence..." className="h-9 w-full px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none" />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>Showing {visibleItemCount} requirements across {visibleCycles.length} cycle(s)</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setCycleStatusFilter('all')
              setItemStatusFilter('all')
              setItemQuery('')
            }}
            disabled={cycleStatusFilter === 'all' && itemStatusFilter === 'all' && itemQuery.length === 0}
          >
            Reset filters
          </Button>
        </div>

        {error && <div className="text-sm text-destructive">{error}</div>}
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading assessments…</div>
      ) : cycles.length === 0 ? (
        <div className="text-sm text-muted-foreground">No assessment cycles for this project yet.</div>
      ) : visibleCycles.length === 0 ? (
        <div className="text-sm text-muted-foreground">No assessment data matches the selected filters.</div>
      ) : (
        <div className="space-y-4">
          {visibleCycles.map(cycle => {
            const cycleItems = getVisibleItems(cycle.id)
            return (
              <div key={cycle.id} className="rounded-lg border border-border bg-card/30 p-4 space-y-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-3 flex-wrap">
                    <BeltBadge level={cycle.belt_level} />
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${statusClass(cycle.status)}`}>{cycle.status}</span>
                    <span className="text-xs text-muted-foreground">Primary: {cycle.primary_champion_name || 'Unassigned'}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">Started {formatDate(cycle.started_at)} • Expires {formatDate(cycle.expires_at)}</div>
                </div>

                <div className="rounded-lg border border-border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="text-left py-2.5 px-3">Requirement</th>
                        <th className="text-left py-2.5 px-3">Status</th>
                        <th className="text-left py-2.5 px-3">Evidence</th>
                        <th className="text-right py-2.5 px-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cycleItems.map(item => {
                        const draft = evidenceDrafts[item.id] ?? { url: item.evidence_url || '', note: item.evidence_note || '', rejection: item.rejection_reason || '' }
                        return (
                          <tr key={item.id} className="border-b border-border/50 align-top hover:bg-secondary/20">
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-2 mb-1"><BeltBadge level={item.belt_level} /><span className="font-medium text-foreground">{item.title}</span></div>
                              {item.description && <div className="text-xs text-muted-foreground">{item.description}</div>}
                              {item.rejection_reason && <div className="text-xs text-red-300 mt-1">Rejected: {item.rejection_reason}</div>}
                            </td>
                            <td className="py-2.5 px-3"><span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${statusClass(item.status)}`}>{item.status.replace('_', ' ')}</span></td>
                            <td className="py-2.5 px-3 min-w-[280px]">
                              {editingItemId === item.id ? (
                                <div className="space-y-2">
                                  <input value={draft.url} onChange={event => setEvidenceDrafts(prev => ({ ...prev, [item.id]: { ...draft, url: event.target.value } }))} placeholder="Evidence URL" className="h-8 w-full px-2 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none" />
                                  <textarea value={draft.note} onChange={event => setEvidenceDrafts(prev => ({ ...prev, [item.id]: { ...draft, note: event.target.value } }))} placeholder="Evidence note" rows={2} className="w-full px-2 py-1 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none resize-none" />
                                  {item.status === 'submitted' && canReview && (
                                    <textarea value={draft.rejection} onChange={event => setEvidenceDrafts(prev => ({ ...prev, [item.id]: { ...draft, rejection: event.target.value } }))} placeholder="Rejection reason" rows={2} className="w-full px-2 py-1 rounded-md bg-secondary border border-border text-xs text-foreground focus:outline-none resize-none" />
                                  )}
                                  <div className="flex justify-end">
                                    <Button size="sm" variant="ghost" onClick={() => setEditingItemId(null)}>Done</Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="space-y-1 text-xs text-muted-foreground">
                                  {item.evidence_url ? <a href={item.evidence_url} target="_blank" rel="noopener noreferrer" className="text-primary underline">{item.evidence_url}</a> : <div>No evidence URL</div>}
                                  {item.evidence_note ? <div>{item.evidence_note}</div> : <div>No evidence note</div>}
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <div className="inline-flex items-center gap-2 flex-wrap justify-end">
                                <Button size="sm" variant="ghost" onClick={() => setEditingItemId(prev => prev === item.id ? null : item.id)} disabled={actingItemId === item.id}>
                                  {editingItemId === item.id ? 'Hide Evidence' : 'Edit Evidence'}
                                </Button>
                                {(item.status === 'not_started' || item.status === 'rejected') && <Button size="sm" variant="ghost" onClick={() => updateItem(item, 'in_progress')} disabled={actingItemId === item.id}>Start</Button>}
                                {item.status === 'in_progress' && <Button size="sm" onClick={() => updateItem(item, 'submitted')} disabled={actingItemId === item.id || !canSubmitEvidence(draft)}>Submit</Button>}
                                {item.status === 'submitted' && canReview && <Button size="sm" onClick={() => updateItem(item, 'approved')} disabled={actingItemId === item.id}>Approve</Button>}
                                {item.status === 'submitted' && canReview && <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => updateItem(item, 'rejected')} disabled={actingItemId === item.id}>Reject</Button>}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}