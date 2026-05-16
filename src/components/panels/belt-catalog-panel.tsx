'use client'

import { useState, useEffect, useCallback } from 'react'

const BELT_NAMES = ['White', 'Yellow', 'Orange', 'Green', 'Blue', 'Purple', 'Red', 'Brown', 'Black']
const BELT_COLORS = [
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

interface BeltRequirement {
  id: number
  belt_level: number
  title: string
  description?: string
  upstream_ref?: string
  sort_order: number
}

interface BeltCourse {
  id: number
  belt_level: number
  title: string
  url: string
  type: 'course' | 'lab'
  provider?: string
  sort_order: number
}

function BeltBadge({ level }: { level: number }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${BELT_COLORS[level]}`}>
      <span className="opacity-60">L{level}</span> {BELT_NAMES[level]}
    </span>
  )
}

function RequirementRow({
  req,
  canEdit,
  onEdit,
  onDelete,
}: {
  req: BeltRequirement
  canEdit: boolean
  onEdit: (r: BeltRequirement) => void
  onDelete: (id: number) => void
}) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{req.title}</p>
        {req.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{req.description}</p>}
        {req.upstream_ref && (
          <a href={req.upstream_ref} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline hover:opacity-80 mt-0.5 block truncate">{req.upstream_ref}</a>
        )}
      </div>
      {canEdit && (
        <div className="flex gap-1 shrink-0">
          <button onClick={() => onEdit(req)} className="px-2 py-1 text-xs rounded border hover:bg-accent">Edit</button>
          <button onClick={() => onDelete(req.id)} className="px-2 py-1 text-xs rounded border border-destructive text-destructive hover:bg-destructive/10">Del</button>
        </div>
      )}
    </div>
  )
}

function CourseRow({
  course,
  canEdit,
  onEdit,
  onDelete,
}: {
  course: BeltCourse
  canEdit: boolean
  onEdit: (c: BeltCourse) => void
  onDelete: (id: number) => void
}) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
      <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${course.type === 'lab' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800'}`}>
        {course.type}
      </span>
      <div className="flex-1 min-w-0">
        <a href={course.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium underline text-primary hover:opacity-80 truncate block">{course.title}</a>
        {course.provider && <p className="text-xs text-muted-foreground">{course.provider}</p>}
      </div>
      {canEdit && (
        <div className="flex gap-1 shrink-0">
          <button onClick={() => onEdit(course)} className="px-2 py-1 text-xs rounded border hover:bg-accent">Edit</button>
          <button onClick={() => onDelete(course.id)} className="px-2 py-1 text-xs rounded border border-destructive text-destructive hover:bg-destructive/10">Del</button>
        </div>
      )}
    </div>
  )
}

function RequirementForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<BeltRequirement>
  onSave: (data: Omit<BeltRequirement, 'id'>) => Promise<void>
  onCancel: () => void
}) {
  const [belt_level, setBeltLevel] = useState(initial?.belt_level ?? 0)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [upstream_ref, setUpstreamRef] = useState(initial?.upstream_ref ?? '')
  const [sort_order, setSortOrder] = useState(initial?.sort_order ?? 0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setError('Title is required'); return }
    setSaving(true)
    try {
      await onSave({ belt_level, title: title.trim(), description: description.trim() || undefined, upstream_ref: upstream_ref.trim() || undefined, sort_order })
    } catch (err: any) {
      setError(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-4 border rounded-lg bg-muted/30">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium block mb-1">Belt Level</label>
          <select value={belt_level} onChange={e => setBeltLevel(+e.target.value)} className="w-full border rounded px-2 py-1 text-sm bg-background">
            {BELT_NAMES.map((n, i) => <option key={i} value={i}>L{i} {n}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1">Sort Order</label>
          <input type="number" value={sort_order} onChange={e => setSortOrder(+e.target.value)} className="w-full border rounded px-2 py-1 text-sm bg-background" min={0} />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium block mb-1">Title *</label>
        <input value={title} onChange={e => setTitle(e.target.value)} className="w-full border rounded px-2 py-1 text-sm bg-background" placeholder="Requirement title" />
      </div>
      <div>
        <label className="text-xs font-medium block mb-1">Description</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="w-full border rounded px-2 py-1 text-sm bg-background resize-none" placeholder="Optional description" />
      </div>
      <div>
        <label className="text-xs font-medium block mb-1">Upstream Ref URL</label>
        <input value={upstream_ref} onChange={e => setUpstreamRef(e.target.value)} className="w-full border rounded px-2 py-1 text-sm bg-background" placeholder="https://..." />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm rounded border">Cancel</button>
      </div>
    </form>
  )
}

function CourseForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<BeltCourse>
  onSave: (data: Omit<BeltCourse, 'id'>) => Promise<void>
  onCancel: () => void
}) {
  const [belt_level, setBeltLevel] = useState(initial?.belt_level ?? 0)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [url, setUrl] = useState(initial?.url ?? '')
  const [type, setType] = useState<'course' | 'lab'>(initial?.type ?? 'course')
  const [provider, setProvider] = useState(initial?.provider ?? '')
  const [sort_order, setSortOrder] = useState(initial?.sort_order ?? 0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setError('Title is required'); return }
    if (!url.trim()) { setError('URL is required'); return }
    setSaving(true)
    try {
      await onSave({ belt_level, title: title.trim(), url: url.trim(), type, provider: provider.trim() || undefined, sort_order })
    } catch (err: any) {
      setError(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-4 border rounded-lg bg-muted/30">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium block mb-1">Belt Level</label>
          <select value={belt_level} onChange={e => setBeltLevel(+e.target.value)} className="w-full border rounded px-2 py-1 text-sm bg-background">
            {BELT_NAMES.map((n, i) => <option key={i} value={i}>L{i} {n}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1">Type</label>
          <select value={type} onChange={e => setType(e.target.value as any)} className="w-full border rounded px-2 py-1 text-sm bg-background">
            <option value="course">Course</option>
            <option value="lab">Lab</option>
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium block mb-1">Title *</label>
        <input value={title} onChange={e => setTitle(e.target.value)} className="w-full border rounded px-2 py-1 text-sm bg-background" placeholder="Course/lab title" />
      </div>
      <div>
        <label className="text-xs font-medium block mb-1">URL *</label>
        <input value={url} onChange={e => setUrl(e.target.value)} className="w-full border rounded px-2 py-1 text-sm bg-background" placeholder="https://secureflag.com/..." />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium block mb-1">Provider</label>
          <input value={provider} onChange={e => setProvider(e.target.value)} className="w-full border rounded px-2 py-1 text-sm bg-background" placeholder="SecureFlag" />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1">Sort Order</label>
          <input type="number" value={sort_order} onChange={e => setSortOrder(+e.target.value)} className="w-full border rounded px-2 py-1 text-sm bg-background" min={0} />
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm rounded border">Cancel</button>
      </div>
    </form>
  )
}

export function BeltCatalogPanel({ canEdit, initialView = 'requirements' }: { canEdit: boolean; initialView?: 'requirements' | 'courses' }) {
  const [view, setView] = useState<'requirements' | 'courses'>(initialView)
  const [requirements, setRequirements] = useState<BeltRequirement[]>([])
  const [courses, setCourses] = useState<BeltCourse[]>([])
  const [selectedBelt, setSelectedBelt] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingReq, setEditingReq] = useState<BeltRequirement | undefined>()
  const [editingCourse, setEditingCourse] = useState<BeltCourse | undefined>()

  const fetchRequirements = useCallback(async () => {
    setLoading(true)
    const url = selectedBelt !== null ? `/api/belts/requirements?belt_level=${selectedBelt}` : '/api/belts/requirements'
    const res = await fetch(url)
    const data = await res.json()
    setRequirements(data.requirements ?? [])
    setLoading(false)
  }, [selectedBelt])

  const fetchCourses = useCallback(async () => {
    setLoading(true)
    const url = selectedBelt !== null ? `/api/belts/courses?belt_level=${selectedBelt}` : '/api/belts/courses'
    const res = await fetch(url)
    const data = await res.json()
    setCourses(data.courses ?? [])
    setLoading(false)
  }, [selectedBelt])

  useEffect(() => {
    if (view === 'requirements') fetchRequirements()
    else fetchCourses()
  }, [view, fetchRequirements, fetchCourses])

  async function handleSaveRequirement(data: Omit<BeltRequirement, 'id'>) {
    const method = editingReq ? 'PUT' : 'POST'
    const body = editingReq ? { id: editingReq.id, ...data } : data
    const res = await fetch('/api/belts/requirements', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) { const e = await res.json(); throw new Error(e.error) }
    setShowForm(false)
    setEditingReq(undefined)
    fetchRequirements()
  }

  async function handleDeleteRequirement(id: number) {
    if (!confirm('Delete this requirement?')) return
    const res = await fetch('/api/belts/requirements', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    if (!res.ok) { const e = await res.json(); alert(e.error) }
    else fetchRequirements()
  }

  async function handleSaveCourse(data: Omit<BeltCourse, 'id'>) {
    const method = editingCourse ? 'PUT' : 'POST'
    const body = editingCourse ? { id: editingCourse.id, ...data } : data
    const res = await fetch('/api/belts/courses', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) { const e = await res.json(); throw new Error(e.error) }
    setShowForm(false)
    setEditingCourse(undefined)
    fetchCourses()
  }

  async function handleDeleteCourse(id: number) {
    if (!confirm('Delete this course/lab?')) return
    const res = await fetch('/api/belts/courses', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    if (!res.ok) { const e = await res.json(); alert(e.error) }
    else fetchCourses()
  }

  const groupedReqs: Record<number, BeltRequirement[]> = {}
  const groupedCourses: Record<number, BeltCourse[]> = {}

  if (selectedBelt === null) {
    for (const r of requirements) {
      if (!groupedReqs[r.belt_level]) groupedReqs[r.belt_level] = []
      groupedReqs[r.belt_level].push(r)
    }
    for (const c of courses) {
      if (!groupedCourses[c.belt_level]) groupedCourses[c.belt_level] = []
      groupedCourses[c.belt_level].push(c)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={selectedBelt === null ? '' : selectedBelt}
          onChange={e => setSelectedBelt(e.target.value === '' ? null : +e.target.value)}
          className="border rounded px-2 py-1 text-sm bg-background"
        >
          <option value="">All belts</option>
          {BELT_NAMES.map((n, i) => <option key={i} value={i}>L{i} — {n}</option>)}
        </select>

        {canEdit && (
          <button
            onClick={() => { setShowForm(true); setEditingReq(undefined); setEditingCourse(undefined) }}
            className="ml-auto px-3 py-1.5 text-sm rounded border bg-primary text-primary-foreground"
          >
            + Add {view === 'requirements' ? 'Requirement' : 'Course/Lab'}
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && view === 'requirements' && (
        <RequirementForm
          initial={editingReq ?? { belt_level: selectedBelt ?? 0 }}
          onSave={handleSaveRequirement}
          onCancel={() => { setShowForm(false); setEditingReq(undefined) }}
        />
      )}
      {showForm && view === 'courses' && (
        <CourseForm
          initial={editingCourse ?? { belt_level: selectedBelt ?? 0 }}
          onSave={handleSaveCourse}
          onCancel={() => { setShowForm(false); setEditingCourse(undefined) }}
        />
      )}

      {/* Content */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : view === 'requirements' ? (
        selectedBelt !== null ? (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <BeltBadge level={selectedBelt} />
              <span className="text-sm text-muted-foreground">{(groupedReqs[selectedBelt] ?? requirements).length} requirements</span>
            </div>
            {(requirements).map(r => (
              <RequirementRow key={r.id} req={r} canEdit={canEdit}
                onEdit={r => { setEditingReq(r); setShowForm(true) }}
                onDelete={handleDeleteRequirement}
              />
            ))}
            {requirements.length === 0 && <p className="text-sm text-muted-foreground">No requirements defined yet.</p>}
          </div>
        ) : (
          BELT_NAMES.map((_, i) => (
            <div key={i} className="rounded-lg border p-4">
              <div className="flex items-center gap-2 mb-2">
                <BeltBadge level={i} />
                <span className="text-xs text-muted-foreground">{(groupedReqs[i] ?? []).length} requirements</span>
              </div>
              {(groupedReqs[i] ?? []).map(r => (
                <RequirementRow key={r.id} req={r} canEdit={canEdit}
                  onEdit={r => { setEditingReq(r); setShowForm(true) }}
                  onDelete={handleDeleteRequirement}
                />
              ))}
              {!(groupedReqs[i] ?? []).length && <p className="text-xs text-muted-foreground">No requirements.</p>}
            </div>
          ))
        )
      ) : (
        selectedBelt !== null ? (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <BeltBadge level={selectedBelt} />
              <span className="text-sm text-muted-foreground">{courses.length} items</span>
            </div>
            {courses.map(c => (
              <CourseRow key={c.id} course={c} canEdit={canEdit}
                onEdit={c => { setEditingCourse(c); setShowForm(true) }}
                onDelete={handleDeleteCourse}
              />
            ))}
            {courses.length === 0 && <p className="text-sm text-muted-foreground">No courses or labs added yet.</p>}
          </div>
        ) : (
          BELT_NAMES.map((_, i) => (
            <div key={i} className="rounded-lg border p-4">
              <div className="flex items-center gap-2 mb-2">
                <BeltBadge level={i} />
                <span className="text-xs text-muted-foreground">{(groupedCourses[i] ?? []).length} items</span>
              </div>
              {(groupedCourses[i] ?? []).map(c => (
                <CourseRow key={c.id} course={c} canEdit={canEdit}
                  onEdit={c => { setEditingCourse(c); setShowForm(true) }}
                  onDelete={handleDeleteCourse}
                />
              ))}
              {!(groupedCourses[i] ?? []).length && <p className="text-xs text-muted-foreground">No courses or labs.</p>}
            </div>
          ))
        )
      )}
    </div>
  )
}

export function BeltRequirementsPanel({ canEdit }: { canEdit: boolean }) {
  return <BeltCatalogPanel canEdit={canEdit} initialView="requirements" />
}

export function BeltCoursesPanel({ canEdit }: { canEdit: boolean }) {
  return <BeltCatalogPanel canEdit={canEdit} initialView="courses" />
}
