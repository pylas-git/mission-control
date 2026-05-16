'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

interface UserOption {
  id: number
  username: string
  display_name?: string | null
  email?: string | null
  role: string
  is_approved?: number
  region_id?: number | null
  region_name?: string | null
}

interface ChampionBeltState {
  user_id: number
  current_belt: number
  achieved_at: number | null
  expires_at: number | null
  grace_expires_at: number | null
  status: 'active' | 'grace' | 'expired'
  verified_by?: string | null
}

interface CourseProgress {
  course_id: number
  belt_level: number
  title: string
  url: string
  type: 'course' | 'lab'
  provider?: string | null
  sort_order: number
  status: 'not_started' | 'in_progress' | 'completed'
  completed_at?: number | null
  completed_via?: 'manual' | 'secureflag_sync' | null
  notes?: string | null
}

interface BeltRequirement {
  id: number
  belt_level: number
  title: string
  description?: string | null
  upstream_ref?: string | null
  sort_order: number
}

interface ChampionAssignment {
  project_id: number
  project_name: string
  target_belt: number | null
  project_current_belt: number | null
  belt_expires_at?: number | null
  is_primary: number
  belt_target_date?: number | null
  client_name: string
  region_name: string
  gap_status: 'qualified' | 'gap' | 'overdue'
  belt_gap: number
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

function BeltTabNav({
  levels,
  selectedLevel,
  currentBelt,
  courseGroups,
  onSelect,
}: {
  levels: number[]
  selectedLevel: number
  currentBelt: number
  courseGroups: Map<number, { status: string }[]>
  onSelect: (level: number) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const selectedIdx = levels.indexOf(selectedLevel)
  const dragging = useRef(false)
  const dragStart = useRef({ x: 0, scrollLeft: 0 })

  const scrollToTab = useCallback((idx: number) => {
    const container = scrollRef.current
    if (!container) return
    const tab = container.children[idx] as HTMLElement | undefined
    if (tab) tab.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [])

  const go = useCallback((delta: number) => {
    const next = Math.max(0, Math.min(levels.length - 1, selectedIdx + delta))
    onSelect(levels[next])
    scrollToTab(next)
  }, [levels, selectedIdx, onSelect, scrollToTab])

  useEffect(() => {
    scrollToTab(selectedIdx)
  }, [selectedIdx, scrollToTab])

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (!el) return
    dragging.current = true
    dragStart.current = { x: e.clientX, scrollLeft: el.scrollLeft }
    el.style.cursor = 'grabbing'
    el.style.userSelect = 'none'
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragging.current || !scrollRef.current) return
    const dx = e.clientX - dragStart.current.x
    scrollRef.current.scrollLeft = dragStart.current.scrollLeft - dx
  }, [])

  const onMouseUp = useCallback(() => {
    if (!scrollRef.current) return
    dragging.current = false
    scrollRef.current.style.cursor = 'grab'
    scrollRef.current.style.userSelect = ''
  }, [])

  return (
    <div className="flex items-stretch gap-2">
      <button
        onClick={() => go(-1)}
        disabled={selectedIdx <= 0}
        aria-label="Previous belt"
        className="flex items-center justify-center w-10 shrink-0 rounded-lg border border-border bg-card/40 text-xl text-muted-foreground hover:bg-card hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors self-stretch"
      >
        ‹
      </button>

      <div
        ref={scrollRef}
        className="flex flex-1 gap-3 overflow-x-auto scrollbar-none py-0.5 px-0.5"
        style={{ scrollbarWidth: 'none', cursor: 'grab' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        {levels.map(level => {
          const levelCourses = courseGroups.get(level) ?? []
          const completed = levelCourses.filter(c => c.status === 'completed').length
          const percent = levelCourses.length === 0 ? 0 : Math.round((completed / levelCourses.length) * 100)
          const isSelected = level === selectedLevel
          const isCurrent = level === currentBelt

          return (
            <button
              key={level}
              onClick={() => { if (!dragging.current) onSelect(level) }}
              onMouseDown={e => e.stopPropagation()}
              className={`min-w-[200px] shrink-0 rounded-lg border p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary
                ${isSelected ? 'border-primary bg-primary/10 ring-1 ring-primary/30' : 'border-border bg-card/30 hover:bg-card/50'}`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <BeltBadge level={level} />
                {isCurrent && <span className="text-[10px] uppercase tracking-wide text-primary font-semibold">Current</span>}
              </div>
              <div className="text-xs text-muted-foreground mb-2">{completed}/{levelCourses.length} complete</div>
              <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
              </div>
            </button>
          )
        })}
      </div>

      <button
        onClick={() => go(1)}
        disabled={selectedIdx >= levels.length - 1}
        aria-label="Next belt"
        className="flex items-center justify-center w-10 shrink-0 rounded-lg border border-border bg-card/40 text-xl text-muted-foreground hover:bg-card hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors self-stretch"
      >
        ›
      </button>
    </div>
  )
}

export function ChampionJourneyPanel() {
  const { currentUser } = useMissionControl()
  const [users, setUsers] = useState<UserOption[]>([])
  const [selectedChampionId, setSelectedChampionId] = useState<number | null>(currentUser?.id ?? null)
  const [requirements, setRequirements] = useState<BeltRequirement[]>([])
  const [belt, setBelt] = useState<ChampionBeltState | null>(null)
  const [progress, setProgress] = useState<CourseProgress[]>([])
  const [assignments, setAssignments] = useState<ChampionAssignment[]>([])
  const [selectedBeltLevel, setSelectedBeltLevel] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [savingCourseId, setSavingCourseId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const role = (currentUser?.role ?? '') as string
  const canBrowseChampions = role === 'admin' || role === 'global_champion' || role === 'regional_champion'

  const loadUsers = useCallback(async () => {
    if (!canBrowseChampions) {
      if (currentUser?.id) {
        setUsers([
          {
            id: currentUser.id,
            username: currentUser.username,
            display_name: currentUser.display_name,
            email: currentUser.email,
            role: currentUser.role,
          },
        ])
        setSelectedChampionId(currentUser.id)
      }
      return
    }

    const res = await fetch('/api/auth/users', { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    const allUsers: UserOption[] = Array.isArray(data.users) ? data.users : []
    const actor = allUsers.find(user => user.id === currentUser?.id)
    const actorRegionId = actor?.region_id ?? null
    const championRoles = new Set(['security_champion', 'regional_champion', 'global_champion'])

    const available = allUsers
      .filter((user: UserOption) => {
        const isChampion = championRoles.has(user.role)
        const isSelf = user.id === currentUser?.id
        const isApproved = user.is_approved !== 0

        if (!isApproved) return false
        if (!isChampion && !isSelf) return false

        // Regional champions can only inspect champions in their own region (or themselves).
        if (role === 'regional_champion' && !isSelf) {
          return actorRegionId != null && user.region_id === actorRegionId
        }

        return true
      })
      .sort((left, right) => {
        const leftName = (left.display_name || left.username || '').toLowerCase()
        const rightName = (right.display_name || right.username || '').toLowerCase()
        return leftName.localeCompare(rightName)
      })

    setUsers(available)
    setSelectedChampionId(prev => {
      if (prev != null && available.some(user => user.id === prev)) return prev
      return available[0]?.id ?? currentUser?.id ?? null
    })
  }, [canBrowseChampions, currentUser, role])

  const loadJourney = useCallback(async () => {
    if (!selectedChampionId) return
    setLoading(true)
    setError(null)
    try {
      const [beltRes, reqRes] = await Promise.all([
        fetch(`/api/champions/${selectedChampionId}/belt`, { cache: 'no-store' }),
        fetch('/api/belts/requirements', { cache: 'no-store' }),
      ])

      const beltData = await beltRes.json().catch(() => ({}))
      const reqData = await reqRes.json().catch(() => ({}))

      if (!beltRes.ok) {
        setError(beltData.error || 'Failed to load champion journey')
        setBelt(null)
        setProgress([])
        setAssignments([])
        return
      }

      setBelt(beltData.belt ?? null)
      setProgress(Array.isArray(beltData.progress) ? beltData.progress : [])
      setAssignments(Array.isArray(beltData.assignments) ? beltData.assignments : [])
      setRequirements(Array.isArray(reqData.requirements) ? reqData.requirements : [])
    } catch {
      setError('Failed to load champion journey')
      setBelt(null)
      setProgress([])
      setAssignments([])
    } finally {
      setLoading(false)
    }
  }, [selectedChampionId])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  useEffect(() => {
    loadJourney()
  }, [loadJourney])

  const selectedChampion = useMemo(
    () => users.find(user => user.id === selectedChampionId) ?? null,
    [users, selectedChampionId],
  )

  const courseGroups = useMemo(() => {
    const groups = new Map<number, CourseProgress[]>()
    for (const item of progress) {
      if (!groups.has(item.belt_level)) groups.set(item.belt_level, [])
      groups.get(item.belt_level)!.push(item)
    }
    return groups
  }, [progress])

  const requirementGroups = useMemo(() => {
    const groups = new Map<number, BeltRequirement[]>()
    for (const item of requirements) {
      if (!groups.has(item.belt_level)) groups.set(item.belt_level, [])
      groups.get(item.belt_level)!.push(item)
    }
    return groups
  }, [requirements])

  const learningSummary = useMemo(() => {
    const totalCourses = progress.length
    const completedCourses = progress.filter(item => item.status === 'completed').length
    const completionPercent = totalCourses === 0 ? 0 : Math.round((completedCourses / totalCourses) * 100)
    const currentLevel = belt?.current_belt ?? 0
    const nextLevel = currentLevel + 1
    const nextLevelCourses = progress.filter(item => item.belt_level === nextLevel)
    const nextLevelCompleted = nextLevelCourses.filter(item => item.status === 'completed').length
    const gapAssignments = assignments.filter(item => item.gap_status !== 'qualified').length

    return {
      totalCourses,
      completedCourses,
      completionPercent,
      currentLevel,
      nextLevel,
      nextLevelCourses: nextLevelCourses.length,
      nextLevelCompleted,
      gapAssignments,
    }
  }, [progress, belt, assignments])

  const visibleLevels = useMemo(() => {
    return BELT_NAMES.map((_, index) => index)
  }, [])

  const markCourseComplete = async (courseId: number) => {
    if (!selectedChampionId) return
    setSavingCourseId(courseId)
    setError(null)
    const res = await fetch(`/api/champions/${selectedChampionId}/belt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ course_id: courseId }),
    })
    const data = await res.json().catch(() => ({}))
    setSavingCourseId(null)

    if (!res.ok) {
      setError(data.error || 'Failed to update course progress')
      return
    }

    await loadJourney()
  }

  useEffect(() => {
    const currentLevel = belt?.current_belt ?? 0
    setSelectedBeltLevel(prev => {
      if (visibleLevels.includes(prev)) return prev
      if (visibleLevels.includes(currentLevel)) return currentLevel
      return visibleLevels[0] ?? currentLevel
    })
  }, [belt?.current_belt, visibleLevels])

  const selectedLevel = visibleLevels.includes(selectedBeltLevel)
    ? selectedBeltLevel
    : (visibleLevels[0] ?? (belt?.current_belt ?? 0))
  const selectedLevelRequirements = requirementGroups.get(selectedLevel) ?? []
  const selectedLevelCourses = (courseGroups.get(selectedLevel) ?? []).slice().sort((left, right) => left.sort_order - right.sort_order)
  const selectedLevelCompleted = selectedLevelCourses.filter(course => course.status === 'completed').length
  const selectedLevelPercent = selectedLevelCourses.length === 0 ? 0 : Math.round((selectedLevelCompleted / selectedLevelCourses.length) * 100)
  const isSelectedCurrent = selectedLevel === (belt?.current_belt ?? 0)

  return (
    <div className="p-6 w-full max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Learning</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track champion belt progression, completion status, and upcoming training.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-border bg-card/40 p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Overall Completion</div>
          <div className="mt-2 text-2xl font-semibold text-foreground">{learningSummary.completionPercent}%</div>
          <div className="text-xs text-muted-foreground mt-1">{learningSummary.completedCourses}/{learningSummary.totalCourses} course(s) complete</div>
        </div>
        <div className="rounded-lg border border-border bg-card/40 p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Current Belt</div>
          <div className="mt-2"><BeltBadge level={learningSummary.currentLevel} /></div>
          <div className="text-xs text-muted-foreground mt-2">Status: {belt?.status ?? 'unknown'}</div>
        </div>
        <div className="rounded-lg border border-border bg-card/40 p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Next Belt Progress</div>
          <div className="mt-2 text-2xl font-semibold text-foreground">{learningSummary.nextLevelCompleted}/{learningSummary.nextLevelCourses}</div>
          <div className="text-xs text-muted-foreground mt-1">toward L{learningSummary.nextLevel}</div>
        </div>
        <div className="rounded-lg border border-border bg-card/40 p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Project Gaps</div>
          <div className="mt-2 text-2xl font-semibold text-foreground">{learningSummary.gapAssignments}</div>
          <div className="text-xs text-muted-foreground mt-1">assignment(s) needing belt uplift</div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card/40 p-4 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Champion</div>
            {canBrowseChampions ? (
              <select
                value={selectedChampionId ?? ''}
                onChange={event => setSelectedChampionId(Number(event.target.value))}
                className="h-10 min-w-[260px] px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none"
              >
                {users.map(user => (
                  <option key={user.id} value={user.id}>
                    {(user.display_name || user.username)}{user.region_name ? ` — ${user.region_name}` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-sm font-medium text-foreground">{selectedChampion?.display_name || selectedChampion?.username || currentUser?.display_name || currentUser?.username}</div>
            )}
          </div>

          {belt && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div className="rounded-md border border-border bg-background/60 px-3 py-2">
                <div className="text-xs text-muted-foreground mb-1">Current Belt</div>
                <BeltBadge level={belt.current_belt ?? 0} />
              </div>
              <div className="rounded-md border border-border bg-background/60 px-3 py-2">
                <div className="text-xs text-muted-foreground mb-1">Status</div>
                <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${belt.status === 'active' ? 'bg-emerald-500/15 text-emerald-300' : belt.status === 'grace' ? 'bg-amber-500/15 text-amber-300' : 'bg-red-500/15 text-red-300'}`}>
                  {belt.status}
                </span>
              </div>
              <div className="rounded-md border border-border bg-background/60 px-3 py-2">
                <div className="text-xs text-muted-foreground mb-1">Renews</div>
                <div className="text-foreground">{formatDate(belt.expires_at)}</div>
              </div>
            </div>
          )}
        </div>

        {error && <div className="text-sm text-destructive">{error}</div>}
      </div>

      <div className="rounded-lg border border-border bg-card/40 p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-foreground">Project Qualification</div>
            <div className="text-xs text-muted-foreground">Assigned projects, target belts, and gap closure dates.</div>
          </div>
          <div className="text-xs text-muted-foreground">{assignments.length} assignment(s)</div>
        </div>

        {assignments.length === 0 ? (
          <div className="text-sm text-muted-foreground">No project assignments found for this champion.</div>
        ) : (
          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-left py-2.5 px-3">Project</th>
                  <th className="text-left py-2.5 px-3">Owner</th>
                  <th className="text-left py-2.5 px-3">Target</th>
                  <th className="text-left py-2.5 px-3">Gap</th>
                  <th className="text-left py-2.5 px-3">Target Date</th>
                  <th className="text-left py-2.5 px-3">Project Belt</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map(assignment => (
                  <tr key={assignment.project_id} className="border-b border-border/50 hover:bg-secondary/20 align-top">
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-foreground">{assignment.project_name}</div>
                      <div className="text-xs text-muted-foreground">{assignment.client_name} • {assignment.region_name}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${assignment.is_primary ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                        {assignment.is_primary ? 'Primary' : 'Assigned'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3"><BeltBadge level={assignment.target_belt ?? 0} /></td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${assignment.gap_status === 'qualified' ? 'bg-emerald-500/15 text-emerald-300' : assignment.gap_status === 'overdue' ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-300'}`}>
                          {assignment.gap_status}
                        </span>
                        {assignment.belt_gap > 0 && <span className="text-xs text-muted-foreground">{assignment.belt_gap} short</span>}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground">{formatDate(assignment.belt_target_date)}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <BeltBadge level={assignment.project_current_belt ?? 0} />
                        <span className="text-xs text-muted-foreground">renews {formatDate(assignment.belt_expires_at)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading journey…</div>
      ) : !selectedChampionId ? (
        <div className="text-sm text-muted-foreground">No champion available.</div>
      ) : (
        <div className="space-y-3">
          <BeltTabNav
            levels={visibleLevels}
            selectedLevel={selectedLevel}
            currentBelt={belt?.current_belt ?? 0}
            courseGroups={courseGroups}
            onSelect={setSelectedBeltLevel}
          />

          <div className="rounded-lg border border-border bg-card/30 p-4 space-y-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <BeltBadge level={selectedLevel} />
                <div className="text-sm text-muted-foreground">{selectedLevelPercent}% course completion</div>
              </div>
              <div className="text-xs text-muted-foreground">
                {selectedLevelRequirements.length} requirement(s) • {selectedLevelCompleted}/{selectedLevelCourses.length} course(s) complete
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-md border border-border bg-background/40 p-4">
                <div className="text-sm font-medium text-foreground mb-3">Requirements</div>
                {selectedLevelRequirements.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No requirements defined.</div>
                ) : (
                  <div className="space-y-3">
                    {selectedLevelRequirements.map(item => (
                      <div key={item.id} className="border-b border-border/60 pb-3 last:border-b-0 last:pb-0">
                        <div className="text-sm text-foreground">{item.title}</div>
                        {item.description && <div className="text-xs text-muted-foreground mt-1">{item.description}</div>}
                        {item.upstream_ref && (
                          <a href={item.upstream_ref} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs text-primary underline">
                            Source
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-md border border-border bg-background/40 p-4">
                <div className="text-sm font-medium text-foreground mb-3">Courses & Labs</div>
                {selectedLevelCourses.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No courses assigned for this belt yet.</div>
                ) : (
                  <div className="space-y-3">
                    {selectedLevelCourses.map(item => (
                      <div key={item.course_id} className="flex items-start justify-between gap-3 border-b border-border/60 pb-3 last:border-b-0 last:pb-0">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-sm text-foreground underline truncate">
                              {item.title}
                            </a>
                            <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium ${item.type === 'lab' ? 'bg-orange-500/15 text-orange-300' : 'bg-blue-500/15 text-blue-300'}`}>
                              {item.type}
                            </span>
                            <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium ${item.status === 'completed' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-secondary text-muted-foreground'}`}>
                              {item.status.replace('_', ' ')}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {item.provider || 'Provider not set'}
                            {item.completed_at ? ` • Completed ${formatDate(item.completed_at)}` : ''}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant={item.status === 'completed' ? 'ghost' : 'default'}
                          disabled={item.status === 'completed' || savingCourseId === item.course_id}
                          onClick={() => markCourseComplete(item.course_id)}
                        >
                          {savingCourseId === item.course_id ? 'Saving…' : item.status === 'completed' ? 'Done' : 'Mark complete'}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}