import {
  SEED_DEVICE_REPAIR_CHECKS,
  SEED_ROWS,
  SEED_TILT_REVIEWS,
} from './seed'
import type {
  DeviceRepairCheck,
  EntryRow,
  PersistState,
  TiltReviewDraft,
  TiltReviewVersion,
} from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'geohazard-monitor-prevention:entries'
const PERSIST_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function freshState(): PersistState {
  return {
    version: PERSIST_VERSION,
    entries: clone(SEED_ROWS),
    tiltReviews: clone(SEED_TILT_REVIEWS),
    deviceRepairChecks: clone(SEED_DEVICE_REPAIR_CHECKS),
    tiltDrafts: {},
  }
}

/**
 * 兼容老版本落盘格式：v1 直接是 Record<string, EntryRow[]>。
 * 老分区原样搬入 entries，新分区用播种数据补齐，绝不丢历史。
 */
function normalize(raw: unknown): PersistState {
  if (raw && typeof raw === 'object' && 'version' in raw) {
    const parsed = raw as PersistState
    return {
      version: PERSIST_VERSION,
      entries: { ...clone(SEED_ROWS), ...clone(parsed.entries ?? {}) },
      tiltReviews: clone(parsed.tiltReviews ?? SEED_TILT_REVIEWS),
      deviceRepairChecks: clone(parsed.deviceRepairChecks ?? SEED_DEVICE_REPAIR_CHECKS),
      tiltDrafts: clone(parsed.tiltDrafts ?? {}),
    }
  }
  if (raw && typeof raw === 'object') {
    return {
      version: PERSIST_VERSION,
      entries: { ...clone(SEED_ROWS), ...clone(raw as Record<string, EntryRow[]>) },
      tiltReviews: clone(SEED_TILT_REVIEWS),
      deviceRepairChecks: clone(SEED_DEVICE_REPAIR_CHECKS),
      tiltDrafts: {},
    }
  }
  return freshState()
}

function readStorage(): PersistState {
  if (typeof window === 'undefined' || !window.localStorage) {
    return freshState()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = freshState()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
  try {
    return normalize(JSON.parse(raw))
  } catch {
    const fallback = freshState()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: PersistState | null = null

function state(): PersistState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

/** 演练用：置 true 后下一次落盘必然失败，用于验证「写失败双方一起回退」。 */
let failNextWrite = false
export function __armWriteFault(): void {
  failNextWrite = true
}

export class CommitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommitError'
  }
}

/**
 * 原子提交：先在草稿上改，改完一次性整体落盘；
 * 落盘抛错时缓存保持提交前快照，设备状态与核查项谁都不会只写进去一半。
 */
export function commitState<T>(mutator: (draft: PersistState) => T): T {
  const snapshot = state()
  const draft = clone(snapshot)
  const result = mutator(draft)
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (failNextWrite) {
        failNextWrite = false
        throw new Error('localStorage 写入失败（模拟设备写入故障）')
      }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
    }
  } catch (error) {
    // 回退：缓存不动，调用方拿到异常后按「双方一起回退」提示。
    throw new CommitError(
      error instanceof Error ? error.message : '数据落盘失败，本次操作已整体回退',
    )
  }
  cache = draft
  return result
}

/** 刷新、返回、重进都走这里：永远返回持久化结果的副本，页面持有的对象不可能被悄悄改旧。 */
export function allRows(): Record<string, EntryRow[]> {
  return clone(state().entries)
}

export function listRows(key: string): EntryRow[] {
  return clone(state().entries[key] ?? [])
}

/** 通用模块保存口径：其他模块沿用，内部同样走原子提交。 */
export function saveRows(key: string, rows: EntryRow[]): void {
  commitState((draft) => {
    draft.entries[key] = clone(rows)
  })
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  commitState((draft) => {
    draft.entries[key] = clone(rows)
    if (key === 'tilt') {
      draft.tiltReviews = clone(SEED_TILT_REVIEWS)
      draft.tiltDrafts = {}
    }
    if (key === 'device') {
      draft.deviceRepairChecks = clone(SEED_DEVICE_REPAIR_CHECKS)
    }
  })
  return rows
}

// ---- 倾斜校核版本：只追加，不覆盖 ------------------------------------------

export function listTiltReviews(id: number): TiltReviewVersion[] {
  return clone(state().tiltReviews[id] ?? [])
}

// ---- 设备待维修核查项 ------------------------------------------------------

export function listRepairChecks(): DeviceRepairCheck[] {
  return clone(state().deviceRepairChecks)
}

// ---- 倾斜校核本地草稿：按记录编号分键，互不串值 ------------------------------

export function getTiltDraft(recordKey: string): TiltReviewDraft | null {
  return clone(state().tiltDrafts[recordKey] ?? null)
}

export function listTiltDrafts(): Record<string, TiltReviewDraft> {
  return clone(state().tiltDrafts)
}

export function storageKey(): string {
  return STORAGE_KEY
}
