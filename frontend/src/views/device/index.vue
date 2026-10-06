<template>
  <section class="page" data-module="device">
    <header class="page-head">
      <div>
        <h2>监测设备管理</h2>
        <p class="page-desc">维护监测设备，围绕设备编号、设备类型、所属隐患点、安装日期做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记监测设备</button>
        <button class="btn" type="button" @click="exportRows">导出监测设备清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-if="row.status !== '待维修' && row.status !== '已停用'"
              class="link"
              type="button"
              @click="runAction('报修设备', row)"
            >
              报修设备
            </button>
            <button
              v-if="row.status === '待维修'"
              class="link"
              type="button"
              @click="runAction('确认修复', row)"
            >
              确认修复
            </button>
            <button
              v-if="row.status !== '已停用'"
              class="link"
              type="button"
              @click="runAction('停用设备', row)"
            >
              停用设备
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无监测设备数据，可先登记监测设备</td>
        </tr>
      </tbody>
    </table>

    <article class="card-block repair-block">
      <h3 class="block-title">待维修核查项（与报修动作同一事务生成）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>核查项</th>
            <th>设备编号</th>
            <th>报修原因</th>
            <th>生成时间</th>
            <th>核查状态</th>
            <th>关闭时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in repairChecks" :key="item.id">
            <td>#{{ item.id }}</td>
            <td>{{ item.deviceCode }}</td>
            <td>{{ item.reason }}</td>
            <td>{{ item.createdAt }}</td>
            <td>{{ item.status }}</td>
            <td>{{ item.closedAt ?? '—' }}</td>
          </tr>
          <tr v-if="!repairChecks.length">
            <td colspan="6" class="empty-state">暂无核查项，对设备执行「报修设备」后会在此同步生成</td>
          </tr>
        </tbody>
      </table>
    </article>

    <article class="card-block repair-block">
      <h3 class="block-title">倾斜校核动态（与倾斜列表/详情同一读取口径）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>记录编号</th>
            <th>测点编号</th>
            <th>观测方向</th>
            <th>校核人</th>
            <th>复测结论</th>
            <th>记录状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in tiltViews" :key="item.id">
            <td>
              <RouterLink class="link" :to="`/tilt/${item.id}`">{{ item.recordCode || '—' }}</RouterLink>
            </td>
            <td>{{ item.pointCode || '—' }}</td>
            <td>{{ item.direction }}</td>
            <td>{{ item.reviewer }}</td>
            <td>{{ item.conclusion }}</td>
            <td>{{ item.status }}</td>
          </tr>
        </tbody>
      </table>
    </article>

    <footer class="page-foot">
      <span>共 {{ total }} 条监测设备记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, moduleMeta } from '@/api/local-service'
import {
  confirmDeviceFixed,
  deviceRows,
  listDeviceRepairChecks,
  reportDeviceRepair,
  stopDevice,
} from '@/data/device-service'
import { listTiltViews, type TiltViewRow } from '@/data/tilt-view'
import type { DeviceRepairCheck, EntryRow } from '@/data/types'

const meta = moduleMeta('device')
const columns = ['设备编号', '设备类型', '所属隐患点', '安装日期', '最近维护日', '电池余量', '通讯状态']
const statuses = ['正常运行', '信号异常', '低电量', '待维修', '已停用']
const stats = computed(() => [
  { label: '设备总数', value: rows.value.length },
  { label: '正常运行数', value: rows.value.filter((r) => r.status === '正常运行').length },
  { label: '待维修数', value: rows.value.filter((r) => r.status === '待维修').length },
])

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['设备编号', '设备类型', '所属隐患点']
const repairChecks = ref<DeviceRepairCheck[]>([])
const tiltViews = ref<TiltViewRow[]>([])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '监测设备登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  let result
  if (action === '报修设备') {
    const reason = window.prompt('请填写报修原因（可留空，使用默认核查描述）')
    if (reason === null) return
    result = reportDeviceRepair(Number(row.id), reason)
  } else if (action === '确认修复') {
    result = confirmDeviceFixed(Number(row.id))
  } else if (action === '停用设备') {
    result = stopDevice(Number(row.id))
  } else {
    result = { ok: false, message: '未知动作' }
  }
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    // 设备、核查项、倾斜动态都从同一份持久化状态读取，刷新/返回/重进结果一致。
    const all = deviceRows()
    const pairs = Object.entries(filters.value).filter(([, value]) => value.trim() !== '')
    rows.value = pairs.length
      ? all.filter((row) =>
          pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
        )
      : all
    total.value = rows.value.length
    repairChecks.value = listDeviceRepairChecks()
    tiltViews.value = listTiltViews()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '监测设备列表读取失败'
  }
}

onMounted(reload)
</script>
