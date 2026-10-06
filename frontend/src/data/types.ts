/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 倾斜校核结果的一个历史版本：校核动作只能追加新版本，任何历史版本都不允许覆盖。 */
export type TiltReviewVersion = {
  version: number
  reviewer: string
  conclusion: string
  direction: string
  note: string
  savedAt: string
  /** 本次校核落定后记录所处状态：已校核 / 需复测。 */
  recordStatus: string
}

/** 设备报修后同步生成的待维修核查项，与设备状态在同一个原子事务里落盘。 */
export type DeviceRepairCheck = {
  id: number
  deviceId: number
  deviceCode: string
  reason: string
  createdAt: string
  status: '待核查' | '已关闭'
  /** 关闭来源：确认修复随设备恢复一起关闭，停用设备时一并核销。 */
  closedAt: string | null
}

/** 本地暂存的倾斜校核草稿，按记录编号各存一份，互不串值。 */
export type TiltReviewDraft = {
  recordKey: string
  reviewer: string
  conclusion: string
  direction: string
  note: string
  savedAt: string
}

/** 持久化根结构：新增分区时提升 version，老格式按 entries-only 兼容读取。 */
export type PersistState = {
  version: number
  entries: Record<string, EntryRow[]>
  tiltReviews: Record<number, TiltReviewVersion[]>
  deviceRepairChecks: DeviceRepairCheck[]
  tiltDrafts: Record<string, TiltReviewDraft>
}
