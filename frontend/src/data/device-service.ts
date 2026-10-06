import { commitState, listRepairChecks, listRows } from './local-store'
import type { ActionResult, DeviceRepairCheck, EntryRow } from './types'

const DEVICE_STATUS = {
  normal: '正常运行',
  signalAbnormal: '信号异常',
  lowBattery: '低电量',
  repairing: '待维修',
  stopped: '已停用',
} as const

export function listDeviceRepairChecks(): DeviceRepairCheck[] {
  return listRepairChecks()
}

function findDevice(rows: EntryRow[], id: number): EntryRow | undefined {
  return rows.find((row) => Number(row.id) === id)
}

function nowLabel(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function nextCheckId(checks: DeviceRepairCheck[]): number {
  return checks.reduce((max, item) => Math.max(max, item.id), 0) + 1
}

/**
 * 报修设备：设备状态改「待维修」与生成「待维修核查项」是同一件事——
 * 两边在同一个原子提交里落盘，任何一边写失败，设备和核查项一起回退。
 */
export function reportDeviceRepair(id: number, reason: string): ActionResult {
  try {
    return commitState((draft) => {
      const row = findDevice(draft.entries.device ?? [], id)
      if (!row) {
        return { ok: false, message: `没有找到编号为 ${id} 的监测设备` }
      }
      if (String(row.status) === DEVICE_STATUS.repairing) {
        return { ok: false, message: '该设备已是「待维修」，核查项已生成，不用重复报修' }
      }
      if (String(row.status) === DEVICE_STATUS.stopped) {
        return { ok: false, message: '该设备已停用，不能再报修' }
      }

      const check: DeviceRepairCheck = {
        id: nextCheckId(draft.deviceRepairChecks),
        deviceId: id,
        deviceCode: String(row['设备编号'] ?? id),
        reason: reason.trim() || '设备巡检发现异常，需现场核查维修',
        createdAt: nowLabel(),
        status: '待核查',
        closedAt: null,
      }

      row.status = DEVICE_STATUS.repairing
      row.pending = true
      row.abnormal = true
      draft.deviceRepairChecks = [...draft.deviceRepairChecks, check]

      return {
        ok: true,
        message: `设备已报修并同步生成待维修核查项（#${check.id}），设备与核查项已一并落盘`,
      }
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知写入故障'
    return { ok: false, message: `设备写入失败，设备状态与核查项已一起回退：${detail}` }
  }
}

/** 确认修复：设备恢复运行，同设备未关闭的核查项在同一事务里一并核销。 */
export function confirmDeviceFixed(id: number): ActionResult {
  try {
    return commitState((draft) => {
      const row = findDevice(draft.entries.device ?? [], id)
      if (!row) {
        return { ok: false, message: `没有找到编号为 ${id} 的监测设备` }
      }
      if (String(row.status) === DEVICE_STATUS.normal) {
        return { ok: false, message: '该设备已是「正常运行」，不用重复确认' }
      }
      if (String(row.status) === DEVICE_STATUS.stopped) {
        return { ok: false, message: '该设备已停用，需重新启用后才能确认修复' }
      }
      const stamp = nowLabel()
      let closed = 0
      draft.deviceRepairChecks = draft.deviceRepairChecks.map((item) => {
        if (item.deviceId === id && item.status === '待核查') {
          closed += 1
          return { ...item, status: '已关闭' as const, closedAt: stamp }
        }
        return item
      })
      row.status = DEVICE_STATUS.normal
      row.pending = true
      row.abnormal = false
      return {
        ok: true,
        message: closed
          ? `设备已恢复运行，${closed} 条待维修核查项已核销`
          : '设备已恢复运行（无待核销的核查项）',
      }
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知写入故障'
    return { ok: false, message: `确认修复写入失败，已一起回退：${detail}` }
  }
}

/** 停用设备：设备停用，挂在它名下的待核查项同步核销。 */
export function stopDevice(id: number): ActionResult {
  try {
    return commitState((draft) => {
      const row = findDevice(draft.entries.device ?? [], id)
      if (!row) {
        return { ok: false, message: `没有找到编号为 ${id} 的监测设备` }
      }
      if (String(row.status) === DEVICE_STATUS.stopped) {
        return { ok: false, message: '该设备已是「已停用」，不用重复操作' }
      }
      const stamp = nowLabel()
      let closed = 0
      draft.deviceRepairChecks = draft.deviceRepairChecks.map((item) => {
        if (item.deviceId === id && item.status === '待核查') {
          closed += 1
          return { ...item, status: '已关闭' as const, closedAt: stamp }
        }
        return item
      })
      row.status = DEVICE_STATUS.stopped
      row.pending = false
      row.abnormal = false
      return {
        ok: true,
        message: closed
          ? `设备已停用，名下 ${closed} 条待维修核查项已同步核销`
          : '设备已停用',
      }
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知写入故障'
    return { ok: false, message: `停用写入失败，已一起回退：${detail}` }
  }
}

export function deviceRows(): EntryRow[] {
  return listRows('device')
}
