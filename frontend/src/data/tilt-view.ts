import { listRows, listTiltReviews } from './local-store'
import type { EntryRow, TiltReviewVersion } from './types'

// 列表、详情、设备三处看到的校核人 / 复测结论 / 观测方向必须完全一致：
// 统一从「最新校核版本」取，没有版本时退回记录原值，旧记录缺方向一律显示「未标注」。
export const UNMARKED_DIRECTION = '未标注'
export const NOT_REVIEWED = '—'

export type TiltViewRow = {
  id: number
  raw: EntryRow
  status: string
  recordCode: string
  pointCode: string
  direction: string
  angle: string
  delta: string
  cumulative: string
  observer: string
  reviewer: string
  conclusion: string
  latestVersion: TiltReviewVersion | null
  history: TiltReviewVersion[]
}

function text(value: unknown): string {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

function buildView(row: EntryRow): TiltViewRow {
  const history = listTiltReviews(Number(row.id))
  const latest = history.length ? history[history.length - 1] : null

  // 观测方向：优先最新校核版本，其次记录原值；都没有就是旧记录，按未标注显示。
  const versionDirection = latest ? text(latest.direction) : ''
  const recordDirection = text(row['观测方向'])
  const direction = versionDirection || recordDirection || UNMARKED_DIRECTION

  return {
    id: Number(row.id),
    raw: row,
    status: text(row.status),
    recordCode: text(row['记录编号']),
    pointCode: text(row['测点编号']),
    direction,
    angle: text(row['倾斜角度']) || NOT_REVIEWED,
    delta: text(row['变化量']) || NOT_REVIEWED,
    cumulative: text(row['累积倾斜量']) || NOT_REVIEWED,
    observer: text(row['观测人']) || NOT_REVIEWED,
    reviewer: latest ? text(latest.reviewer) || NOT_REVIEWED : NOT_REVIEWED,
    conclusion: latest ? text(latest.conclusion) || NOT_REVIEWED : NOT_REVIEWED,
    latestVersion: latest,
    history,
  }
}

export function listTiltViews(): TiltViewRow[] {
  return listRows('tilt').map(buildView)
}

export function getTiltView(id: number): TiltViewRow | null {
  const row = listRows('tilt').find((item) => Number(item.id) === id)
  return row ? buildView(row) : null
}
