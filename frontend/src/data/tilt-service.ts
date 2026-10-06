import {
  commitState,
  getTiltDraft,
  listRows,
  listTiltReviews,
} from './local-store'
import type { ActionResult, EntryRow, TiltReviewDraft, TiltReviewVersion } from './types'

// 倾斜记录的状态口径：列表、详情、设备三处共用，谁都不许自己另写一份。
export const TILT_STATUS = {
  observed: '已观测',
  pending: '待校核',
  reviewed: '已校核',
  alarmed: '超限报警',
  recheck: '需复测',
} as const

/** 允许做「确认校核」的状态：终态（已校核/超限报警/需复测）一律拒绝。 */
const REVIEWABLE_STATUSES = new Set<string>([TILT_STATUS.observed, TILT_STATUS.pending])
/**
 * 允许「触发报警」的状态：只有校核/报警都未落定的窗口可抢。
 * 一旦「确认校核」先落定为已校核/需复测，竞争即结束，报警不能再翻盘；
 * 反过来报警先落定，校核也进不来——同条记录只认先到者。
 */
const ALARMABLE_STATUSES = new Set<string>([TILT_STATUS.observed, TILT_STATUS.pending])

export type TiltReviewInput = {
  reviewer: string
  conclusion: string
  direction: string
  note: string
}

function findTilt(rows: EntryRow[], id: number): EntryRow | undefined {
  return rows.find((row) => Number(row.id) === id)
}

function trimOrError(input: TiltReviewInput): string | null {
  if (!input.reviewer.trim()) return '请填写校核人'
  if (!input.conclusion.trim()) return '请填写复测结论'
  return null
}

function nowLabel(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 确认校核：结果只能追加新版本，绝不覆盖历史。
 * 与「触发报警」共用同一状态检查口径，提交瞬间再查一次当前状态，
 * 两次同步动作之间先落盘的一方获胜，后到者原样拒绝（记录也不动）。
 */
export function submitTiltReview(id: number, input: TiltReviewInput): ActionResult {
  const validationError = trimOrError(input)
  if (validationError) {
    return { ok: false, message: validationError }
  }
  try {
    return commitState((draft) => {
      // CAS：以提交瞬间草稿里的状态为准，拦截同条记录的并发校核/报警。
      const row = findTilt(draft.entries.tilt ?? [], id)
      if (!row) {
        return { ok: false, message: `没有找到编号为 ${id} 的倾斜记录` }
      }
      const current = String(row.status)
      if (current === TILT_STATUS.reviewed || current === TILT_STATUS.recheck) {
        return { ok: false, message: '该倾斜记录已有校核结论，不能重复校核' }
      }
      if (current === TILT_STATUS.alarmed) {
        return { ok: false, message: '该记录已触发超限报警，校核动作未生效（以先到达的报警为准）' }
      }
      if (!REVIEWABLE_STATUSES.has(current)) {
        return { ok: false, message: `当前状态「${current}」不允许确认校核` }
      }

      const history = draft.tiltReviews[id] ?? []
      const recordStatus = input.conclusion.trim() === '需复测' ? TILT_STATUS.recheck : TILT_STATUS.reviewed
      const version: TiltReviewVersion = {
        version: history.length + 1,
        reviewer: input.reviewer.trim(),
        conclusion: input.conclusion.trim(),
        direction: input.direction.trim(),
        note: input.note.trim(),
        savedAt: nowLabel(),
        recordStatus,
      }
      // 只追加：历史数组整体保留，新版本 push 到末尾。
      draft.tiltReviews[id] = [...history, version]

      row.status = recordStatus
      row.pending = false
      row.abnormal = recordStatus === TILT_STATUS.recheck
      // 观测方向以校核口径补齐到记录上，但页面展示永远以最新版本为准。
      if (version.direction && !String(row['观测方向'] ?? '').trim()) {
        row['观测方向'] = version.direction
      }

      const recordKey = String(row['记录编号'] ?? id)
      delete draft.tiltDrafts[recordKey]

      return {
        ok: true,
        message: `校核完成（第 ${version.version} 版），当前状态「${recordStatus}」`,
      }
    })
  } catch {
    return { ok: false, message: '校核结果保存失败，已整体回退，请重试' }
  }
}

/**
 * 触发报警：与确认校核抢同一条记录。
 * 提交瞬间若状态已被校核/报警/复测先占，后到者拒绝；设备写入等下游失败由提交层统一回退。
 */
export function triggerTiltAlarm(id: number, reason = ''): ActionResult {
  try {
    return commitState((draft) => {
      const row = findTilt(draft.entries.tilt ?? [], id)
      if (!row) {
        return { ok: false, message: `没有找到编号为 ${id} 的倾斜记录` }
      }
      const current = String(row.status)
      if (current === TILT_STATUS.alarmed) {
        return { ok: false, message: '该记录已经是「超限报警」，不用重复操作' }
      }
      if (!ALARMABLE_STATUSES.has(current)) {
        return {
          ok: false,
          message: `该记录已被「${current}」先占用，报警未生效（同条记录只认先到者）`,
        }
      }      row.status = TILT_STATUS.alarmed
      row.pending = false
      row.abnormal = true
      if (reason.trim()) {
        row['报警原因'] = reason.trim()
      }
      return { ok: true, message: '已触发超限报警，当前状态「超限报警」' }
    })
  } catch {
    return { ok: false, message: '报警保存失败，已整体回退，请重试' }
  }
}

/** 提交校核（流转到待校核），与通用动作口径一致但走原子提交。 */
export function submitTiltForCheck(id: number): ActionResult {
  try {
    return commitState((draft) => {
      const row = findTilt(draft.entries.tilt ?? [], id)
      if (!row) {
        return { ok: false, message: `没有找到编号为 ${id} 的倾斜记录` }
      }
      const current = String(row.status)
      if (current === TILT_STATUS.pending) {
        return { ok: false, message: '倾斜记录已经提交校核，不用重复操作' }
      }
      if (current !== TILT_STATUS.observed) {
        return { ok: false, message: `当前状态「${current}」不能再提交校核` }
      }
      row.status = TILT_STATUS.pending
      row.pending = true
      return { ok: true, message: '倾斜记录已提交校核，当前状态「待校核」' }
    })
  } catch {
    return { ok: false, message: '提交失败，已整体回退，请重试' }
  }
}

/**
 * 本地保存校核草稿：按记录编号独立暂存。
 * 重新进入时只读当前这条记录自己的草稿，从列表/设备页带过来的旧值不会再串到表单里。
 */
export function saveTiltDraft(id: number, input: Partial<TiltReviewInput>): ActionResult {
  const rows = listRows('tilt')
  const row = findTilt(rows, id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的倾斜记录` }
  }
  const recordKey = String(row['记录编号'] ?? id)
  const draft: TiltReviewDraft = {
    recordKey,
    reviewer: input.reviewer ?? '',
    conclusion: input.conclusion ?? '',
    direction: input.direction ?? '',
    note: input.note ?? '',
    savedAt: nowLabel(),
  }
  try {
    commitState((state) => {
      state.tiltDrafts[recordKey] = draft
    })
    return { ok: true, message: '草稿已暂存到本机' }
  } catch {
    return { ok: false, message: '草稿暂存失败，请重试' }
  }
}

export function readTiltDraft(id: number): TiltReviewDraft | null {
  const rows = listRows('tilt')
  const row = findTilt(rows, id)
  if (!row) return null
  return getTiltDraft(String(row['记录编号'] ?? id))
}

export function tiltReviewHistory(id: number): TiltReviewVersion[] {
  return listTiltReviews(id)
}
