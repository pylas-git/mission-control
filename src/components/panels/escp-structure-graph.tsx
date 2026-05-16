'use client'

/**
 * ESCP Structure Graph — React Flow interactive hierarchy visualizer.
 *
 * Displays the Region → Account → Project hierarchy as an interactive graph.
 * Nodes are clickable, opening a right-side drawer with management actions.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import ReactFlow, {
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  NodeProps,
  Handle,
  Position,
  ReactFlowInstance,
  BackgroundVariant,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'

// ─── Belt helpers ───────────────────────────────────────────────────────────

const BELT_NAMES = ['White', 'Yellow', 'Orange', 'Green', 'Blue', 'Purple', 'Red', 'Brown', 'Black']
const BELT_COLORS: Record<number, string> = {
  0: '#e2e8f0', // White
  1: '#fbbf24', // Yellow
  2: '#f97316', // Orange
  3: '#22c55e', // Green
  4: '#3b82f6', // Blue
  5: '#a855f7', // Purple
  6: '#ef4444', // Red
  7: '#92400e', // Brown
  8: '#1f2937', // Black
}
const BELT_BG: Record<number, string> = {
  0: 'rgba(226,232,240,0.15)',
  1: 'rgba(251,191,36,0.15)',
  2: 'rgba(249,115,22,0.15)',
  3: 'rgba(34,197,94,0.15)',
  4: 'rgba(59,130,246,0.15)',
  5: 'rgba(168,85,247,0.15)',
  6: 'rgba(239,68,68,0.15)',
  7: 'rgba(146,64,14,0.15)',
  8: 'rgba(31,41,55,0.15)',
}

function beltLabel(level: number) {
  return `L${level} ${BELT_NAMES[level] ?? ''}`
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface Region {
  id: number
  name: string
  slug: string
  archived_at: number | null
  archive_reason: string | null
  regional_champion_name?: string | null
  accounts_count?: number
  projects_count?: number
}

interface Client {
  id: number
  region_id: number
  name: string
  slug: string
  archived_at: number | null
  archive_reason: string | null
  projects_count?: number
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
  archive_reason?: string | null
  has_gap?: number
  has_overdue_gap?: number
  belt_gap?: number
  primary_belt_target_date?: number | null
  target_belt?: number
  current_belt?: number
  champion_name?: string | null
  primary_champion_name?: string | null
  champion_count?: number
}

interface NodeData {
  kind: 'region' | 'account' | 'project'
  raw: Region | Client | Project
  childrenVisible: boolean
  onToggle: () => void
  onNodeClick: (kind: 'region' | 'account' | 'project', raw: Region | Client | Project) => void
}

const NODE_WIDTH = 220
const NODE_MIN_HEIGHT = 92

// ─── Status helpers ─────────────────────────────────────────────────────────

function projectStatus(p: Project): 'archived' | 'overdue' | 'gap' | 'normal' {
  if (p.archived_at) return 'archived'
  if (p.has_overdue_gap) return 'overdue'
  if (p.has_gap) return 'gap'
  return 'normal'
}

const STATUS_BORDER: Record<string, string> = {
  archived: 'border-border/40',
  overdue: 'border-red-500/60',
  gap: 'border-amber-500/60',
  normal: 'border-border/60',
}
const STATUS_TEXT: Record<string, string> = {
  archived: 'text-muted-foreground/50',
  overdue: 'text-red-300',
  gap: 'text-foreground',
  normal: 'text-foreground',
}

// ─── Node Components ─────────────────────────────────────────────────────────

function RegionNode({ data }: NodeProps<NodeData>) {
  const r = data.raw as Region
  const isArchived = !!r.archived_at
  const championName = r.regional_champion_name?.trim() ?? ''
  const championNameParts = championName.split(/\s+/).filter(Boolean)
  const championFirstName = championNameParts[0] ?? championName
  const championLastName = championNameParts.length > 1 ? championNameParts[championNameParts.length - 1] : ''
  const firstInitial = championFirstName.charAt(0).toUpperCase() || '?'
  return (
    <div
      className={`relative rounded-lg border px-3 py-2.5 cursor-pointer select-none transition-colors ${
        isArchived ? 'border-border/30 bg-secondary/20 opacity-60' : 'border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/15'
      }`}
      onClick={() => data.onNodeClick('region', r)}
      style={{ width: NODE_WIDTH, minHeight: NODE_MIN_HEIGHT, boxShadow: isArchived ? 'none' : '0 0 0 1px rgba(99,102,241,0.2)' }}
    >
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <div className="h-8 flex items-start pr-[118px]">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-400">Region</span>
          {isArchived && <span className="text-[9px] px-1 py-0.5 rounded bg-secondary text-muted-foreground/60">archived</span>}
        </div>
      </div>
      {r.regional_champion_name && (
        <div className="absolute top-0.5 right-1 w-[114px] h-8 pl-1 flex items-center gap-1 text-[9px] text-cyan-300/90" title={r.regional_champion_name}>
          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full overflow-hidden border border-cyan-300/40 bg-cyan-400/15 text-[7px] font-semibold text-cyan-200">
            {firstInitial}
          </span>
          <div className="flex flex-col justify-center items-start min-w-0 h-full leading-[1.05]">
            <span className="truncate w-full">{championFirstName}</span>
            <span className="truncate w-full opacity-95">{championLastName || championFirstName}</span>
          </div>
        </div>
      )}
      <div className={`h-5 text-sm font-semibold mt-0 truncate max-w-[180px] ${isArchived ? 'line-through text-muted-foreground/40' : 'text-foreground'}`}>
        {r.name}
      </div>
      <div className="h-4 text-[10px] text-muted-foreground mt-1">
        {r.accounts_count ?? 0} accounts · {r.projects_count ?? 0} projects
      </div>
    </div>
  )
}

function AccountNode({ data }: NodeProps<NodeData>) {
  const c = data.raw as Client
  const isArchived = !!c.archived_at
  return (
    <div
      className={`relative rounded-lg border px-3 py-2 cursor-pointer select-none transition-colors ${
        isArchived ? 'border-border/30 bg-secondary/20 opacity-60' : 'border-cyan-500/30 bg-cyan-500/5 hover:bg-cyan-500/10'
      }`}
      style={{ width: NODE_WIDTH, minHeight: NODE_MIN_HEIGHT }}
      onClick={() => data.onNodeClick('account', c)}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle id="out" type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <div className="h-4 flex items-center justify-between gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-400/80">Account</span>
        {isArchived && <span className="text-[9px] px-1 py-0.5 rounded bg-secondary text-muted-foreground/60">archived</span>}
      </div>
      <div className={`h-5 text-sm font-semibold mt-0 truncate max-w-[180px] ${isArchived ? 'line-through text-muted-foreground/40' : 'text-foreground'}`}>
        {c.name}
      </div>
      <div className="h-4 text-[10px] text-muted-foreground mt-1">{c.projects_count ?? 0} project{(c.projects_count ?? 0) !== 1 ? 's' : ''}</div>
    </div>
  )
}

function ProjectNode({ data }: NodeProps<NodeData>) {
  const p = data.raw as Project
  const status = projectStatus(p)
  const targetBelt = p.target_belt ?? 0
  const currentBelt = p.current_belt ?? 0
  const beltColor = BELT_COLORS[targetBelt] ?? BELT_COLORS[0]
  const beltBg = BELT_BG[targetBelt] ?? BELT_BG[0]
  const defaultProjectBg = 'rgb(11, 18, 32)'
  const projectBg = status === 'archived' ? 'rgb(30, 32, 40)' : targetBelt === 0 ? defaultProjectBg : 'rgb(12, 22, 36)'
  const beltBorderColor = targetBelt === 0 ? 'rgba(147,197,253,0.45)' : `${beltColor}66`
  const projectBorderColor = status === 'archived'
    ? 'rgba(148, 163, 184, 0.35)'
    : status === 'overdue'
      ? 'rgba(239, 68, 68, 0.6)'
      : beltBorderColor
  const championName = (p.primary_champion_name ?? p.champion_name ?? '').trim()
  const hasChampion = championName.length > 0
  const championNameParts = championName.split(/\s+/).filter(Boolean)
  const championFirstName = championNameParts[0] ?? championName
  const championLastName = championNameParts.length > 1 ? championNameParts[championNameParts.length - 1] : ''
  const champInitial = hasChampion ? (championFirstName.charAt(0).toUpperCase() || '?') : '?'
  const badgeFirstLine = hasChampion ? championFirstName : 'Unnasigned'
  const badgeSecondLine = hasChampion ? (championLastName || championFirstName) : ' '
  const badgeTitle = hasChampion ? championName : 'Unnasigned'
  const badgeWrapClass = hasChampion
    ? 'absolute top-0.5 right-1 w-[114px] h-8 pl-1 flex items-center gap-1 text-[9px] text-cyan-300/90'
    : 'absolute top-0.5 right-1 w-[114px] h-8 pl-1 flex items-center gap-1 text-[9px] text-amber-200'
  const badgeIconClass = hasChampion
    ? 'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full overflow-hidden border border-cyan-300/40 bg-cyan-400/15 text-[7px] font-semibold text-cyan-200'
    : 'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full overflow-hidden border border-amber-300/80 bg-amber-400/30 text-[9px] font-bold text-amber-100 shadow-[0_0_8px_rgba(251,191,36,0.35)]'

  return (
    <div
      className={`relative rounded-lg border px-3 py-2.5 cursor-pointer select-none transition-all hover:brightness-110 ${STATUS_BORDER[status]}`}
      style={{ width: NODE_WIDTH, minHeight: NODE_MIN_HEIGHT, background: projectBg, borderColor: projectBorderColor, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.02)' }}
      onClick={() => data.onNodeClick('project', p)}
    >
      <Handle id="in" type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle id="out" type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <div className="h-4 flex items-center gap-1 pr-[118px]">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300/90">Project</span>
        {status === 'archived' && <span className="text-[9px] px-1 py-0.5 rounded bg-secondary text-muted-foreground/60">archived</span>}
      </div>
      <div className={badgeWrapClass} title={badgeTitle}>
        <span className={badgeIconClass}>
          {champInitial}
        </span>
        <div className="flex flex-col justify-center items-start min-w-0 h-full leading-[1.05]">
          <span className={`truncate w-full ${hasChampion ? '' : 'font-bold uppercase tracking-[0.02em]'}`}>{badgeFirstLine}</span>
          <span className="truncate w-full opacity-95">{badgeSecondLine}</span>
        </div>
      </div>

      <div className={`h-5 text-sm font-semibold mt-0 truncate ${STATUS_TEXT[status]}`}>{p.name}</div>

      {/* Belt indicator */}
      {status !== 'archived' && (
        <div className="absolute bottom-2 left-3 flex items-center gap-1">
          <span
            className="text-[8px] px-2 py-0.5 rounded-full font-semibold"
            style={{ background: BELT_BG[currentBelt] ?? BELT_BG[0], color: BELT_COLORS[currentBelt] ?? BELT_COLORS[0], border: `1px solid ${(BELT_COLORS[currentBelt] ?? BELT_COLORS[0])}55` }}
          >
            {BELT_NAMES[currentBelt] ?? 'White'}
          </span>
          {targetBelt !== currentBelt && (<>
            <span className="text-[8px] text-muted-foreground/50">→</span>
            <span
              className="text-[8px] px-2 py-0.5 rounded-full font-semibold"
              style={{ background: BELT_BG[targetBelt] ?? BELT_BG[0], color: BELT_COLORS[targetBelt] ?? BELT_COLORS[0], border: `1px solid ${(BELT_COLORS[targetBelt] ?? BELT_COLORS[0])}55` }}
            >
              {BELT_NAMES[targetBelt] ?? 'White'}
            </span>
          </>)}
          {status === 'overdue' && <span className="text-[8px] text-red-400 ml-0.5">⚠</span>}
        </div>
      )}

    </div>
  )
}

const STRUCTURE_NODE_TYPES = Object.freeze({
  region: RegionNode,
  account: AccountNode,
  project: ProjectNode,
})

// ─── Layout helpers ──────────────────────────────────────────────────────────

const REGION_Y = 32
const ACCOUNT_Y_OFFSET = 148
const PROJECT_Y_OFFSET = 134
const REGION_GAP_X = 110
const PROJECT_COLS = 2
const PROJECT_COL_GAP_X = 20
const PROJECT_GAP_Y = 116
const REGIONS_PER_ROW = 2
const ROW_GAP_Y = 52
const PROJECT_GRID_WIDTH = PROJECT_COLS * NODE_WIDTH + (PROJECT_COLS - 1) * PROJECT_COL_GAP_X
const ACCOUNT_GAP_X = PROJECT_GRID_WIDTH + 40
const PROJECT_GRID_SIDE_OVERFLOW = Math.max(0, Math.floor((PROJECT_GRID_WIDTH - NODE_WIDTH) / 2))

function buildLayout(
  regions: Region[],
  clients: Client[],
  projects: Project[],
  collapsedRegions: Set<number>,
  collapsedAccounts: Set<number>,
  showArchived: boolean,
  onToggleRegion: (id: number) => void,
  onToggleAccount: (id: number) => void,
  onNodeClick: (kind: 'region' | 'account' | 'project', raw: Region | Client | Project) => void,
): { nodes: Node<NodeData>[]; edges: Edge[] } {
  const nodes: Node<NodeData>[] = []
  const edges: Edge[] = []

  const visibleRegions = (showArchived ? regions : regions.filter(r => !r.archived_at))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
  const regionRows: Region[][] = []
  for (let i = 0; i < visibleRegions.length; i += REGIONS_PER_ROW) {
    regionRows.push(visibleRegions.slice(i, i + REGIONS_PER_ROW))
  }

  let currentRowY = REGION_Y
  for (const row of regionRows) {
    let currentRegionStartX = 44
    let rowHeight = 180

    for (const region of row) {
      const regionClients = clients
        .filter(c => c.region_id === region.id && (showArchived || !c.archived_at))
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
      const regionExpanded = !collapsedRegions.has(region.id)

      const regionSpan = regionExpanded ? Math.max(1, regionClients.length) : 1
      // Reserve side overflow so project grids never collide across region boundaries.
      const accountBaseX = currentRegionStartX + PROJECT_GRID_SIDE_OVERFLOW
      const accountSpanWidth = NODE_WIDTH + (regionSpan - 1) * ACCOUNT_GAP_X
      const regionWidth = accountSpanWidth + PROJECT_GRID_SIDE_OVERFLOW * 2
      const regionCenterX = accountBaseX + Math.floor(((regionSpan - 1) * ACCOUNT_GAP_X) / 2)

      nodes.push({
        id: `region-${region.id}`,
        type: 'region',
        position: { x: regionCenterX, y: currentRowY },
        data: {
          kind: 'region',
          raw: region,
          childrenVisible: regionExpanded,
          onToggle: () => onToggleRegion(region.id),
          onNodeClick,
        },
      })

      let regionHeight = 170
      if (regionExpanded) {
        for (let i = 0; i < regionClients.length; i += 1) {
          const client = regionClients[i]
          const accountProjects = projects
            .filter(p => p.client_id === client.id && (showArchived || !p.archived_at))
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
          const accountExpanded = !collapsedAccounts.has(client.id)
          const accountX = accountBaseX + i * ACCOUNT_GAP_X
          const accountY = currentRowY + ACCOUNT_Y_OFFSET

          nodes.push({
            id: `account-${client.id}`,
            type: 'account',
            position: { x: accountX, y: accountY },
            data: {
              kind: 'account',
              raw: { ...client, projects_count: accountProjects.length },
              childrenVisible: accountExpanded,
              onToggle: () => onToggleAccount(client.id),
              onNodeClick,
            },
          })
          edges.push({
            id: `e-region-${region.id}-account-${client.id}`,
            source: `region-${region.id}`,
            target: `account-${client.id}`,
            type: 'simplebezier',
            style: { stroke: 'rgba(129,140,248,0.8)', strokeWidth: 2.6, opacity: 1 },
            animated: false,
          })

          if (accountExpanded) {
            const totalRows = Math.max(1, Math.ceil(accountProjects.length / PROJECT_COLS))
            const previousInColumn: Array<string | undefined> = new Array(PROJECT_COLS).fill(undefined)

            for (let row = 0; row < totalRows; row += 1) {
              const rowProjects = accountProjects.slice(row * PROJECT_COLS, row * PROJECT_COLS + PROJECT_COLS)
              const rowY = accountY + PROJECT_Y_OFFSET + row * PROJECT_GAP_Y

              const rowWidth = PROJECT_COLS * NODE_WIDTH + (PROJECT_COLS - 1) * PROJECT_COL_GAP_X
              const rowStartX = accountX + Math.floor((NODE_WIDTH - rowWidth) / 2)

              for (let col = 0; col < rowProjects.length; col += 1) {
                const project = rowProjects[col]
                const xProject = rowStartX + col * (NODE_WIDTH + PROJECT_COL_GAP_X)
                const yProject = rowY

                nodes.push({
                  id: `project-${project.id}`,
                  type: 'project',
                  position: { x: xProject, y: yProject },
                  data: {
                    kind: 'project',
                    raw: project,
                    childrenVisible: false,
                    onToggle: () => {},
                    onNodeClick,
                  },
                })

                const parentNodeId = row === 0
                  ? `account-${client.id}`
                  : (previousInColumn[col] ?? `account-${client.id}`)

                edges.push({
                  id: `e-project-parent-${parentNodeId}-project-${project.id}`,
                  source: parentNodeId,
                  target: `project-${project.id}`,
                  sourceHandle: parentNodeId.startsWith('account-') ? 'out' : 'out',
                  targetHandle: 'in',
                  type: 'simplebezier',
                  style: { stroke: 'rgba(34,211,238,0.56)', strokeWidth: 1.9, opacity: 0.9 },
                })

                previousInColumn[col] = `project-${project.id}`
              }
            }
            regionHeight = Math.max(
              regionHeight,
              ACCOUNT_Y_OFFSET + PROJECT_Y_OFFSET + totalRows * PROJECT_GAP_Y,
            )
          }
        }
      }

      rowHeight = Math.max(rowHeight, regionHeight)
      currentRegionStartX += regionWidth + REGION_GAP_X
    }

    currentRowY += rowHeight + ROW_GAP_Y
  }

  return { nodes, edges }
}

// ─── Drawer ──────────────────────────────────────────────────────────────────

interface DrawerProps {
  kind: 'region' | 'account' | 'project'
  raw: Region | Client | Project
  canManage: boolean
  onClose: () => void
  onRefresh: () => void
}

function StructureDrawer({ kind, raw, canManage, onClose, onRefresh }: DrawerProps) {
  const [submitting, setSubmitting] = useState(false)
  const [archiveReason, setArchiveReason] = useState('')
  const [showArchiveForm, setShowArchiveForm] = useState(false)
  const [showUnarchiveForm, setShowUnarchiveForm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [typedConfirm, setTypedConfirm] = useState('')
  const [error, setError] = useState('')
  const [editName, setEditName] = useState('')
  const [showEditForm, setShowEditForm] = useState(false)

  const isArchived = !!raw.archived_at
  const needsTypedConfirm = kind === 'region'
    ? (((raw as Region).accounts_count ?? 0) + ((raw as Region).projects_count ?? 0)) >= 10
    : kind === 'account'
      ? ((raw as Client).projects_count ?? 0) >= 10
      : false

  const apiPath = kind === 'region' ? '/api/regions' : kind === 'account' ? '/api/clients' : '/api/projects'

  const doArchive = async () => {
    if (!archiveReason.trim()) { setError('Archive reason is required'); return }
    if (needsTypedConfirm && typedConfirm !== raw.name) { setError('Type the name to confirm'); return }
    setSubmitting(true); setError('')
    const res = await fetch(apiPath, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: raw.id,
        archive: true,
        reason: archiveReason.trim(),
        confirm_text: typedConfirm.trim() || undefined,
      }),
    })
    setSubmitting(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || 'Failed to archive'); return }
    setShowArchiveForm(false); setArchiveReason(''); setTypedConfirm('')
    onRefresh(); onClose()
  }

  const doUnarchive = async () => {
    setSubmitting(true); setError('')
    const res = await fetch(apiPath, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: raw.id, archive: false, reason: archiveReason.trim() || undefined }),
    })
    setSubmitting(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || 'Failed to unarchive'); return }
    setShowUnarchiveForm(false); setArchiveReason('')
    onRefresh(); onClose()
  }

  const doDelete = async () => {
    if (isDeleteBlocked) {
      setError(deleteBlockedReason)
      return
    }
    setSubmitting(true); setError('')
    const res = await fetch(apiPath, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: raw.id }),
    })
    setSubmitting(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Failed to delete')
      setShowDeleteConfirm(false)
      return
    }
    onRefresh(); onClose()
  }

  const doEdit = async () => {
    if (!editName.trim()) { setShowEditForm(false); return }
    setSubmitting(true); setError('')
    const res = await fetch(apiPath, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: raw.id, name: editName.trim() }),
    })
    setSubmitting(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || 'Failed to update'); return }
    setShowEditForm(false)
    onRefresh()
  }

  const kindLabel = kind === 'region' ? 'Region' : kind === 'account' ? 'Account' : 'Project'
  const project = kind === 'project' ? raw as Project : null
  const region = kind === 'region' ? raw as Region : null
  const client = kind === 'account' ? raw as Client : null
  const isDeleteBlocked = kind === 'region'
    ? ((region?.accounts_count ?? 0) > 0 || (region?.projects_count ?? 0) > 0)
    : kind === 'account'
      ? ((client?.projects_count ?? 0) > 0)
      : false
  const deleteBlockedReason = kind === 'region'
    ? 'Delete is disabled because this region still has linked accounts/projects. Archive it or clear dependencies first.'
    : kind === 'account'
      ? 'Delete is disabled because this account still has linked projects. Archive it or clear dependencies first.'
      : ''

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />

      <div className="relative ml-auto w-[360px] bg-background border-l border-border shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{kindLabel}</div>
            <div className="text-base font-semibold text-foreground mt-0.5 max-w-[260px] truncate">{raw.name}</div>
            {raw.slug && <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">{raw.slug}</div>}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground mt-0.5 text-lg leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Archive notice */}
          {isArchived && (
            <div className="rounded-md border border-border/50 bg-secondary/30 px-3 py-2.5">
              <div className="text-xs font-medium text-muted-foreground">Archived</div>
              {raw.archive_reason && (
                <div className="text-xs text-muted-foreground/70 mt-1 italic">&ldquo;{raw.archive_reason}&rdquo;</div>
              )}
            </div>
          )}

          {/* Stats */}
          {region && (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded border border-border/50 bg-secondary/20 px-3 py-2">
                <div className="text-[10px] text-muted-foreground">Accounts</div>
                <div className="text-lg font-semibold">{region.accounts_count ?? 0}</div>
              </div>
              <div className="rounded border border-border/50 bg-secondary/20 px-3 py-2">
                <div className="text-[10px] text-muted-foreground">Projects</div>
                <div className="text-lg font-semibold">{region.projects_count ?? 0}</div>
              </div>
            </div>
          )}
          {client && (
            <div className="rounded border border-border/50 bg-secondary/20 px-3 py-2">
              <div className="text-[10px] text-muted-foreground">Projects</div>
              <div className="text-lg font-semibold">{client.projects_count ?? 0}</div>
            </div>
          )}

          {/* Project-specific details */}
          {project && (
            <div className="space-y-3">
              {/* Belt status */}
              <div className="rounded border border-border/50 bg-secondary/20 px-3 py-2.5">
                <div className="text-[10px] text-muted-foreground mb-1.5">Belt Status</div>
                <div className="flex items-center gap-2">
                  <span
                    className="text-xs px-2 py-0.5 rounded font-medium"
                    style={{
                      background: BELT_BG[project.current_belt ?? 0],
                      color: BELT_COLORS[project.current_belt ?? 0],
                      border: `1px solid ${BELT_COLORS[project.current_belt ?? 0]}40`,
                    }}
                  >
                    Current: {beltLabel(project.current_belt ?? 0)}
                  </span>
                  <span className="text-muted-foreground text-xs">→</span>
                  <span
                    className="text-xs px-2 py-0.5 rounded font-medium"
                    style={{
                      background: BELT_BG[project.target_belt ?? 0],
                      color: BELT_COLORS[project.target_belt ?? 0],
                      border: `1px solid ${BELT_COLORS[project.target_belt ?? 0]}40`,
                    }}
                  >
                    Target: {beltLabel(project.target_belt ?? 0)}
                  </span>
                </div>
                {(project.has_overdue_gap || project.has_gap) && (
                  <div className={`mt-2 text-xs font-medium ${project.has_overdue_gap ? 'text-red-400' : 'text-amber-400'}`}>
                    {project.has_overdue_gap ? '⚠ Belt target is overdue' : '△ Belt gap exists'}
                  </div>
                )}
              </div>

              {/* Champion */}
              <div className="rounded border border-border/50 bg-secondary/20 px-3 py-2.5">
                <div className="text-[10px] text-muted-foreground mb-1">Primary Champion</div>
                {project.champion_name ? (
                  <div className="text-sm text-foreground">
                    {project.champion_name}
                    {(project.champion_count ?? 1) > 1 && (
                      <span className="text-xs text-muted-foreground ml-1">+{(project.champion_count ?? 1) - 1} more</span>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-amber-500">No primary champion assigned</div>
                )}
              </div>
            </div>
          )}

          {/* Error */}
          {error && <div className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded">{error}</div>}

          {/* Inline Edit */}
          {showEditForm && (
            <div className="rounded border border-border/50 bg-secondary/10 p-3 space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Edit Name</div>
              <input
                autoFocus
                type="text"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') doEdit(); if (e.key === 'Escape') setShowEditForm(false) }}
                className="w-full h-8 px-2.5 rounded bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={doEdit} disabled={submitting || !editName.trim()}>
                  {submitting ? 'Saving…' : 'Save'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowEditForm(false)}>Cancel</Button>
              </div>
            </div>
          )}

          {/* Archive form */}
          {showArchiveForm && (
            <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
              <div className="text-xs font-medium text-amber-400">Archive {kindLabel}</div>
              <textarea
                placeholder="Reason for archiving (required)"
                value={archiveReason}
                onChange={e => setArchiveReason(e.target.value)}
                className="w-full h-20 px-2.5 py-2 rounded bg-secondary border border-border text-xs text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
              {needsTypedConfirm && (
                <div className="space-y-1">
                  <div className="text-[10px] text-muted-foreground">
                    Type <span className="font-mono font-medium text-foreground">{raw.name}</span> to confirm
                  </div>
                  <input
                    type="text"
                    value={typedConfirm}
                    onChange={e => setTypedConfirm(e.target.value)}
                    className="w-full h-8 px-2.5 rounded bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={doArchive} disabled={submitting || !archiveReason.trim() || (needsTypedConfirm && typedConfirm !== raw.name)}
                  className="bg-amber-600 hover:bg-amber-500 text-white">
                  {submitting ? 'Archiving…' : 'Archive'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowArchiveForm(false); setArchiveReason(''); setTypedConfirm('') }}>Cancel</Button>
              </div>
            </div>
          )}

          {/* Unarchive form */}
          {showUnarchiveForm && (
            <div className="rounded border border-border/50 bg-secondary/10 p-3 space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Unarchive {kindLabel}</div>
              <textarea
                placeholder="Reason (optional)"
                value={archiveReason}
                onChange={e => setArchiveReason(e.target.value)}
                className="w-full h-16 px-2.5 py-2 rounded bg-secondary border border-border text-xs text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={doUnarchive} disabled={submitting}>
                  {submitting ? 'Restoring…' : 'Unarchive'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowUnarchiveForm(false); setArchiveReason('') }}>Cancel</Button>
              </div>
            </div>
          )}

          {/* Delete confirm */}
          {showDeleteConfirm && (
            <div className="rounded border border-destructive/40 bg-destructive/5 p-3 space-y-2">
              <div className="text-xs font-medium text-destructive">Permanently delete &ldquo;{raw.name}&rdquo;?</div>
              <div className="text-xs text-muted-foreground">This action cannot be undone.</div>
              <div className="flex gap-2">
                <Button size="sm" onClick={doDelete} disabled={submitting}
                  className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
                  {submitting ? 'Deleting…' : 'Delete permanently'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        {canManage && !showArchiveForm && !showUnarchiveForm && !showDeleteConfirm && !showEditForm && (
          <div className="px-5 py-4 border-t border-border space-y-2">
            {!isArchived && (
              <Button size="sm" variant="outline" className="w-full justify-start"
                onClick={() => { setEditName(raw.name); setShowEditForm(true); setError('') }}>
                Edit name
              </Button>
            )}
            {!isArchived && (
              <Button size="sm" variant="outline" className="w-full justify-start text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                onClick={() => { setShowArchiveForm(true); setError('') }}>
                Archive {kindLabel.toLowerCase()}
              </Button>
            )}
            {isArchived && (
              <Button size="sm" variant="outline" className="w-full justify-start"
                onClick={() => { setShowUnarchiveForm(true); setError('') }}>
                Restore (unarchive)
              </Button>
            )}
            <div className="relative group">
              <Button size="sm" variant="outline" className="w-full justify-start text-destructive border-destructive/30 hover:bg-destructive/10"
                onClick={() => { if (!isDeleteBlocked) setShowDeleteConfirm(true); setError('') }}
                disabled={isDeleteBlocked}>
                Delete permanently
              </Button>
              {isDeleteBlocked && (
                <div className="pointer-events-none absolute right-0 bottom-full mb-2 z-10 hidden w-72 rounded-md border border-border bg-background px-2.5 py-2 text-[11px] text-muted-foreground shadow-lg group-hover:block group-focus-within:block">
                  {deleteBlockedReason}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Quick-create inline form ────────────────────────────────────────────────

interface QuickCreateProps {
  kind: 'region' | 'account' | 'project'
  regions: Region[]
  clients: Client[]
  onCreated: () => void
  onCancel: () => void
}

function QuickCreateForm({ kind, regions, clients, onCreated, onCancel }: QuickCreateProps) {
  const [name, setName] = useState('')
  const [regionId, setRegionId] = useState<number | ''>('')
  const [clientId, setClientId] = useState<number | ''>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const availableClients = regionId ? clients.filter(c => c.region_id === Number(regionId) && !c.archived_at) : []

  const submit = async () => {
    if (!name.trim()) return
    if (kind === 'account' && !regionId) { setError('Select a region'); return }
    if (kind === 'project' && !clientId) { setError('Select an account'); return }
    setSubmitting(true); setError('')
    const body: Record<string, unknown> = { name: name.trim() }
    if (kind === 'account') body.region_id = Number(regionId)
    if (kind === 'project') body.client_id = Number(clientId)
    const path = kind === 'region' ? '/api/regions' : kind === 'account' ? '/api/clients' : '/api/projects'
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setSubmitting(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || 'Failed to create'); return }
    onCreated()
  }

  const kindLabel = kind === 'region' ? 'Region' : kind === 'account' ? 'Account' : 'Project'

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2 max-w-sm">
      <div className="text-xs font-semibold text-primary">New {kindLabel}</div>
      {kind === 'account' && (
        <select
          value={regionId}
          onChange={e => setRegionId(Number(e.target.value) || '')}
          className="w-full h-8 px-2.5 rounded bg-secondary border border-border text-sm text-foreground focus:outline-none"
        >
          <option value="">Select region…</option>
          {regions.filter(r => !r.archived_at).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      )}
      {kind === 'project' && (
        <>
          <select
            value={regionId}
            onChange={e => { setRegionId(Number(e.target.value) || ''); setClientId('') }}
            className="w-full h-8 px-2.5 rounded bg-secondary border border-border text-sm text-foreground focus:outline-none"
          >
            <option value="">Select region…</option>
            {regions.filter(r => !r.archived_at).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select
            value={clientId}
            onChange={e => setClientId(Number(e.target.value) || '')}
            disabled={!regionId}
            className="w-full h-8 px-2.5 rounded bg-secondary border border-border text-sm text-foreground focus:outline-none disabled:opacity-50"
          >
            <option value="">Select account…</option>
            {availableClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </>
      )}
      <input
        autoFocus
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }}
        placeholder={`${kindLabel} name`}
        className="w-full h-8 px-2.5 rounded bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
      />
      {error && <div className="text-xs text-destructive">{error}</div>}
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={submitting || !name.trim()}>
          {submitting ? 'Creating…' : `Create ${kindLabel}`}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

export function EscpStructureGraph() {
  const [regions, setRegions] = useState<Region[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Array<{ kind: 'region' | 'account' | 'project'; item: Region | Client | Project }>>([])
  const [showSearchDropdown, setShowSearchDropdown] = useState(false)
  const [creating, setCreating] = useState<'region' | 'account' | 'project' | null>(null)

  const [collapsedRegions, setCollapsedRegions] = useState<Set<number>>(new Set())
  const [collapsedAccounts, setCollapsedAccounts] = useState<Set<number>>(new Set())
  const hasInitializedCollapse = useRef(false)

  const [drawer, setDrawer] = useState<{ kind: 'region' | 'account' | 'project'; raw: Region | Client | Project } | null>(null)

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<NodeData>([])
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([])
  const rfRef = useRef<ReactFlowInstance | null>(null)
  const hasAutoFitForCurrentLoad = useRef(false)

  const { currentUser } = useMissionControl()
  const canManage = currentUser?.role === 'admin' || (currentUser?.role as string) === 'global_champion'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const ia = showArchived ? '?includeArchived=true' : ''
      const [r, c, p] = await Promise.all([
        fetch(`/api/regions${ia}`).then(res => res.ok ? res.json() : { regions: [] }),
        fetch(`/api/clients${ia}`).then(res => res.ok ? res.json() : { clients: [] }),
        fetch(`/api/projects${ia}`).then(res => res.ok ? res.json() : { projects: [] }),
      ])
      setRegions(r.regions ?? [])
      setClients(c.clients ?? [])
      setProjects(p.projects ?? [])
    } finally {
      setLoading(false)
    }
  }, [showArchived])

  useEffect(() => { load() }, [load])

  // Start in a readable, low-noise state: collapsed regions/accounts by default.
  useEffect(() => {
    if (loading || hasInitializedCollapse.current) return
    if (regions.length === 0) return
    // Default: all nodes fully expanded
    setCollapsedRegions(new Set())
    setCollapsedAccounts(new Set())
    hasInitializedCollapse.current = true
  }, [loading, regions, clients])

  useEffect(() => {
    if (loading) {
      hasAutoFitForCurrentLoad.current = false
    }
  }, [loading])

  const onToggleRegion = useCallback((id: number) => {
    setCollapsedRegions(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const onToggleAccount = useCallback((id: number) => {
    setCollapsedAccounts(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const onNodeClick = useCallback((kind: 'region' | 'account' | 'project', raw: Region | Client | Project) => {
    setDrawer({ kind, raw })
  }, [])

  // Rebuild graph layout whenever data or collapse state changes
  useEffect(() => {
    if (loading) return
    const { nodes, edges } = buildLayout(
      regions, clients, projects,
      collapsedRegions, collapsedAccounts,
      showArchived,
      onToggleRegion, onToggleAccount, onNodeClick,
    )
    setRfNodes(nodes)
    setRfEdges(edges)
  }, [regions, clients, projects, collapsedRegions, collapsedAccounts, showArchived, loading, onToggleRegion, onToggleAccount, onNodeClick, setRfNodes, setRfEdges])

  // Search
  useEffect(() => {
    const q = search.trim().toLowerCase()
    if (!q) { setSearchResults([]); return }
    const results: Array<{ kind: 'region' | 'account' | 'project'; item: Region | Client | Project }> = []
    // Active first
    regions.filter(r => !r.archived_at && r.name.toLowerCase().includes(q)).forEach(r => results.push({ kind: 'region', item: r }))
    clients.filter(c => !c.archived_at && c.name.toLowerCase().includes(q)).forEach(c => results.push({ kind: 'account', item: c }))
    projects.filter(p => !p.archived_at && p.name.toLowerCase().includes(q)).forEach(p => results.push({ kind: 'project', item: p }))
    // Archived fallback
    if (results.length === 0) {
      regions.filter(r => r.archived_at && r.name.toLowerCase().includes(q)).forEach(r => results.push({ kind: 'region', item: r }))
      clients.filter(c => c.archived_at && c.name.toLowerCase().includes(q)).forEach(c => results.push({ kind: 'account', item: c }))
      projects.filter(p => p.archived_at && p.name.toLowerCase().includes(q)).forEach(p => results.push({ kind: 'project', item: p }))
    }
    setSearchResults(results.slice(0, 12))
  }, [search, regions, clients, projects])

  const handleSearchSelect = (kind: 'region' | 'account' | 'project', item: Region | Client | Project) => {
    setSearch('')
    setShowSearchDropdown(false)
    // If item is archived and we're not showing archived, enable it
    if (item.archived_at && !showArchived) {
      setShowArchived(true)
    }
    // Expand path to reach the node
    if (kind === 'project') {
      const p = item as Project
      setCollapsedAccounts(prev => { const n = new Set(prev); n.delete(p.client_id); return n })
      const c = clients.find(c => c.id === p.client_id)
      if (c) setCollapsedRegions(prev => { const n = new Set(prev); n.delete(c.region_id); return n })
    } else if (kind === 'account') {
      const c = item as Client
      setCollapsedRegions(prev => { const n = new Set(prev); n.delete(c.region_id); return n })
    }
    // Open drawer
    setDrawer({ kind, raw: item })
    // Fit view after a tick
    setTimeout(() => rfRef.current?.fitView({ padding: 0.2, duration: 600 }), 100)
  }

  const fitView = () => rfRef.current?.fitView({ padding: 0.15, duration: 600 })
  const resetView = () => {
    setCollapsedRegions(new Set())
    setCollapsedAccounts(new Set())
    setTimeout(fitView, 100)
  }

  // Auto-fit once after each successful data load so all regions are visible.
  useEffect(() => {
    if (loading || hasAutoFitForCurrentLoad.current) return
    if (!rfRef.current || rfNodes.length === 0) return
    hasAutoFitForCurrentLoad.current = true
    const t = setTimeout(() => {
      rfRef.current?.fitView({ padding: 0.16, duration: 450, minZoom: 0.72, maxZoom: 1.2 })
    }, 80)
    return () => clearTimeout(t)
  }, [loading, rfNodes.length])

  if (loading) return <div className="text-sm text-muted-foreground py-8 text-center">Loading structure…</div>

  const totalVisible = regions.filter(r => showArchived || !r.archived_at).length

  return (
    <div className="relative flex flex-col w-full overflow-hidden" style={{ height: 'calc(100dvh - 182px)' }}>
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap mb-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setShowSearchDropdown(true) }}
            onFocus={() => setShowSearchDropdown(true)}
            onBlur={() => setTimeout(() => setShowSearchDropdown(false), 150)}
            placeholder="Search regions, accounts, projects…"
            className="w-full h-8 px-3 rounded-md border border-border bg-secondary text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          {showSearchDropdown && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border border-border bg-background shadow-lg overflow-hidden max-h-64 overflow-y-auto">
              {searchResults.map(({ kind, item }) => (
                <button
                  key={`${kind}-${item.id}`}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary/60 transition-colors"
                  onClick={() => handleSearchSelect(kind, item)}
                >
                  <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                    kind === 'region' ? 'bg-indigo-500/20 text-indigo-400' :
                    kind === 'account' ? 'bg-cyan-500/20 text-cyan-400' :
                    'bg-secondary text-muted-foreground'
                  }`}>{kind}</span>
                  <span className="flex-1 truncate text-foreground">{item.name}</span>
                  {item.archived_at && <span className="text-[9px] text-muted-foreground/60 shrink-0">archived</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Controls */}
        <button onClick={fitView} className="text-xs px-2.5 py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/40">
          Fit
        </button>
        <button onClick={resetView} className="text-xs px-2.5 py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/40">
          Reset
        </button>
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={e => setShowArchived(e.target.checked)}
            className="accent-primary"
          />
          Show archived
        </label>
        <span className="text-xs text-muted-foreground">{totalVisible} region{totalVisible !== 1 ? 's' : ''}</span>

        {canManage && (
          <div className="flex items-center gap-1.5 ml-auto">
            <button onClick={() => setCreating('region')} className="text-xs px-2.5 py-1.5 rounded border border-primary/30 text-primary hover:bg-primary/10">+ Region</button>
            <button onClick={() => setCreating('account')} className="text-xs px-2.5 py-1.5 rounded border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10">+ Account</button>
            <button onClick={() => setCreating('project')} className="text-xs px-2.5 py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/30">+ Project</button>
          </div>
        )}
      </div>

      {/* Quick-create form */}
      {creating && (
        <div className="mb-3">
          <QuickCreateForm
            kind={creating}
            regions={regions}
            clients={clients}
            onCreated={() => { setCreating(null); load() }}
            onCancel={() => setCreating(null)}
          />
        </div>
      )}

      {/* Graph canvas */}
      <div
        className="rounded-lg border border-border overflow-hidden w-full flex-1 min-h-0"
      >
        {totalVisible === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            No regions to display. Create a region to get started.
          </div>
        ) : (
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={STRUCTURE_NODE_TYPES}
            nodesDraggable={false}
            nodesConnectable={false}
            zoomOnDoubleClick={false}
            minZoom={0.55}
            maxZoom={1.8}
            onInit={inst => {
              rfRef.current = inst
              setTimeout(() => inst.fitView({ padding: 0.16, minZoom: 0.72, maxZoom: 1.2 }), 50)
            }}
            fitView
            fitViewOptions={{ padding: 0.16, minZoom: 0.72, maxZoom: 1.2 }}
            attributionPosition="bottom-right"
            proOptions={{ hideAttribution: true }}
          >
            <Background color="rgba(255,255,255,0.04)" variant={BackgroundVariant.Dots} gap={20} size={1} />
            <Controls
              showInteractive={false}
              className="[&>button]:bg-secondary [&>button]:border-border [&>button]:text-muted-foreground"
            />
          </ReactFlow>
        )}
      </div>

      {/* Drawer */}
      {drawer && (
        <StructureDrawer
          kind={drawer.kind}
          raw={drawer.raw}
          canManage={canManage}
          onClose={() => setDrawer(null)}
          onRefresh={load}
        />
      )}
    </div>
  )
}
