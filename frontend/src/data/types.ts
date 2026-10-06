/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

// 一次校核/报警留下的版本快照：只追加，不改写，历史版本随时能往回查。
export type VersionEntry = {
  version: number
  action: string
  status: string
  operator: string
  conclusion: string
  at: string
}

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean | VersionEntry[]
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
  // 置为 true 的模块（如倾斜监测）走版本化保存：每次动作追加一条历史版本，并发时按版本号只认先到者。
  versioned?: boolean
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

// 动作负载：expectedVersion 是页面读出记录时的版本号，写回时不一致说明有人先动了这条记录。
export type ActionPayload = {
  expectedVersion?: number
  operator?: string
  conclusion?: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
