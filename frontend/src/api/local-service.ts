import { MODULE_BY_KEY } from '@/data/modules'
import { REPAIR_KEY, allRows, listRows, resetRows, transact } from '@/data/local-store'
import type {
  ActionPayload,
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  VersionEntry,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 设备报修待办的状态口径：报修生成「待核查」，修复/停用时在同一事务里办结。
const REPAIR_OPEN = '待核查'
const REPAIR_DONE = '已办结'
const REPAIR_CLOSE_RESULT: Record<string, string> = {
  确认修复: '设备已修复',
  停用设备: '设备已停用',
}

function now(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 详情页与列表读同一个集合：重新进入时重新走这里，拿到的就是最近一次落盘的结果。
export function getEntry(key: string, id: number): EntryRow | undefined {
  return listRows(key).find((row) => Number(row.id) === id)
}

function isNegative(action: string): boolean {
  return NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb))
}

export function runAction(
  key: string,
  id: number,
  action: string,
  payload: ActionPayload = {},
): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  if (key === 'device') {
    return runDeviceAction(meta, id, action, target)
  }
  if (meta.versioned) {
    return runVersionedAction(meta, id, action, target, payload)
  }
  return runGenericAction(meta, id, action, target)
}

function runGenericAction(meta: ModuleMeta, id: number, action: string, target: string): ActionResult {
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  let result: ActionResult = { ok: false, message: '' }
  try {
    transact((db) => {
      const rows = db[meta.key] ?? []
      const index = rows.findIndex((row) => Number(row.id) === id)
      if (index < 0) {
        result = { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
        return
      }
      if (String(rows[index].status) === target) {
        result = { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
        return
      }
      const updated: EntryRow = {
        ...rows[index],
        status: target,
        pending: target !== lastStatus,
        abnormal: isNegative(action),
      }
      const next = [...rows]
      next[index] = updated
      db[meta.key] = next
      result = { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
    })
  } catch {
    return { ok: false, message: `${meta.entity}保存失败，本次${action}未写入，请重试` }
  }
  return result
}

// 版本化保存（倾斜监测）：每次校核/报警只追加一条历史版本，记录本身升到新版本，旧版本原样保留。
// 页面读出时的版本号与落盘前对不上，说明这条记录刚被别人校核或报警过，只认先到者。
function runVersionedAction(
  meta: ModuleMeta,
  id: number,
  action: string,
  target: string,
  payload: ActionPayload,
): ActionResult {
  const conclusion = (payload.conclusion ?? '').trim()
  if (action === '确认校核' && conclusion === '') {
    return { ok: false, message: `${meta.entity}确认校核前要先填写复测结论` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  let result: ActionResult = { ok: false, message: '' }
  try {
    transact((db) => {
      const rows = db[meta.key] ?? []
      const index = rows.findIndex((row) => Number(row.id) === id)
      if (index < 0) {
        result = { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
        return
      }
      const current = rows[index]
      if (String(current.status) === target) {
        result = { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
        return
      }
      const version = typeof current['版本'] === 'number' ? Number(current['版本']) : 1
      if (payload.expectedVersion !== undefined && payload.expectedVersion !== version) {
        result = {
          ok: false,
          message: `这条${meta.entity}刚被他人处理，已按先到者为准，请刷新后重试`,
        }
        return
      }
      const operator = (payload.operator ?? '').trim() || '值班管理员'
      const entry: VersionEntry = {
        version: version + 1,
        action,
        status: target,
        operator,
        conclusion,
        at: now(),
      }
      const history = Array.isArray(current['历史版本'])
        ? (current['历史版本'] as VersionEntry[])
        : []
      const updated: EntryRow = {
        ...current,
        status: target,
        pending: target !== lastStatus,
        abnormal: isNegative(action),
        '版本': version + 1,
        '历史版本': [...history, entry],
      }
      // 校核人与复测结论随确认校核一次写清，列表、详情、导出读的都是这同一份。
      if (action === '确认校核') {
        updated['校核人'] = operator
        updated['复测结论'] = conclusion
      }
      const next = [...rows]
      next[index] = updated
      db[meta.key] = next
      result = {
        ok: true,
        message: `${meta.entity}已${action}，当前状态「${target}」，已追加第 ${version + 1} 版`,
      }
    })
  } catch {
    return { ok: false, message: `${meta.entity}保存失败，本次${action}未写入，请重试` }
  }
  return result
}

// 设备动作与报修待办同一事务：报修时同步生成待维修核查项，修复/停用时把未办结的核查项一起办结；
// 落盘失败则设备台账与核查项一起回退，不会只写成功一边。
function runDeviceAction(meta: ModuleMeta, id: number, action: string, target: string): ActionResult {
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  let result: ActionResult = { ok: false, message: '' }
  try {
    transact((db) => {
      const rows = db[meta.key] ?? []
      const index = rows.findIndex((row) => Number(row.id) === id)
      if (index < 0) {
        result = { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
        return
      }
      if (String(rows[index].status) === target) {
        result = { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
        return
      }
      const updated: EntryRow = {
        ...rows[index],
        status: target,
        pending: target !== lastStatus,
        abnormal: isNegative(action),
      }
      const next = [...rows]
      next[index] = updated

      const todos = db[REPAIR_KEY] ?? []
      let nextTodos = todos
      let todoMessage = ''
      if (action === '报修设备') {
        const hasOpen = todos.some(
          (todo) => todo['设备编号'] === updated['设备编号'] && todo.status === REPAIR_OPEN,
        )
        if (!hasOpen) {
          nextTodos = [...todos, buildRepairTodo(updated, todos)]
          todoMessage = '，已同步生成待维修核查项'
        }
      } else {
        nextTodos = todos.map((todo) =>
          todo['设备编号'] === updated['设备编号'] && todo.status === REPAIR_OPEN
            ? {
                ...todo,
                status: REPAIR_DONE,
                pending: false,
                '核查结论': REPAIR_CLOSE_RESULT[action] ?? `设备已${action}`,
                '办结时间': now(),
              }
            : todo,
        )
      }
      db[meta.key] = next
      db[REPAIR_KEY] = nextTodos
      result = { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」${todoMessage}` }
    })
  } catch {
    return { ok: false, message: '设备写入失败，设备台账与待维修核查项已一起回退，请重试' }
  }
  return result
}

function buildRepairTodo(device: EntryRow, existing: EntryRow[]): EntryRow {
  const nextId = existing.reduce((max, todo) => Math.max(max, Number(todo.id) || 0), 0) + 1
  return {
    id: nextId,
    status: REPAIR_OPEN,
    pending: true,
    abnormal: false,
    '核查编号': `REPA-${String(nextId).padStart(4, '0')}`,
    '设备编号': String(device['设备编号'] ?? ''),
    '所属隐患点': String(device['所属隐患点'] ?? ''),
    '报修时间': now(),
    '办结时间': '',
    '核查结论': '',
  }
}

export function listRepairTodos(): EntryRow[] {
  return listRows(REPAIR_KEY)
}

// 安全网：台账里已是「待维修」但缺核查项的旧数据，进入设备页时幂等补上，不动已有核查项。
export function syncRepairTodos(): void {
  try {
    transact((db) => {
      const devices = db['device'] ?? []
      const todos = db[REPAIR_KEY] ?? []
      let acc = [...todos]
      for (const device of devices) {
        const needsTodo =
          String(device.status) === '待维修' &&
          !acc.some((todo) => todo['设备编号'] === device['设备编号'] && todo.status === REPAIR_OPEN)
        if (needsTodo) {
          acc = [...acc, buildRepairTodo(device, acc)]
        }
      }
      if (acc.length !== todos.length) {
        db[REPAIR_KEY] = acc
      }
    })
  } catch {
    // 补建失败不影响页面读取，下次进入会再试。
  }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
