import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'geohazard-monitor-prevention:entries'

// 设备报修待办所在的集合键：跟设备台账放在同一份存储里，一次落盘同成败。
export const REPAIR_KEY = 'device_repair'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 旧数据迁移：早期版本没有版本号、历史版本和报修待办，读出来时补齐，不改动已有内容。
function migrate(db: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const tiltRows = db['tilt']
  if (Array.isArray(tiltRows)) {
    for (const row of tiltRows) {
      if (typeof row['版本'] !== 'number') {
        row['版本'] = 1
      }
      if (!Array.isArray(row['历史版本'])) {
        row['历史版本'] = []
      }
    }
  }
  if (!Array.isArray(db[REPAIR_KEY])) {
    db[REPAIR_KEY] = []
  }
  return db
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return migrate(fallback)
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = migrate(fallback)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return migrate({ ...fallback, ...parsed })
  } catch {
    const seeded = migrate(fallback)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
}

function persist(db: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  }
}

// 每次读都回 localStorage，不留内存缓存：刷新、返回、重进、别的页签写入，看到的都是同一份结果。
export function allRows(): Record<string, EntryRow[]> {
  return readStorage()
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

// 唯一的写入口：整个数据包一次落盘。多键改动（如设备台账 + 报修待办）要么一起生效，
// 要么落盘失败时一起留在旧值上，不会出现一半写成功的中间态。
export function transact(mutate: (db: Record<string, EntryRow[]>) => void): void {
  const db = readStorage()
  mutate(db)
  persist(db)
}

export function saveRows(key: string, rows: EntryRow[]): void {
  transact((db) => {
    db[key] = rows
  })
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
