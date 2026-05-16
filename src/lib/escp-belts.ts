import { getDatabase } from '@/lib/db'

type DbLike = ReturnType<typeof getDatabase>

export function getDefinedBeltLevels(db: DbLike): number[] {
  const rows = db.prepare('SELECT level FROM escp_belts ORDER BY level').all() as Array<{ level: number }>
  return rows.map(row => row.level)
}

export function beltLevelExists(db: DbLike, level: number): boolean {
  const row = db.prepare('SELECT level FROM escp_belts WHERE level = ?').get(level) as { level: number } | undefined
  return !!row
}

export function getDefaultBeltLevel(db: DbLike): number {
  const row = db.prepare('SELECT level FROM escp_belts ORDER BY level LIMIT 1').get() as { level: number } | undefined
  return row?.level ?? 0
}