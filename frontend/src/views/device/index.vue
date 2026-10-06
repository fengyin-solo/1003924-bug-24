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
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无监测设备数据，可先登记监测设备</td>
        </tr>
      </tbody>
    </table>

    <section class="repair-panel">
      <header class="repair-head">
        <h3>待维修核查项</h3>
        <span class="repair-count">未办结 {{ openCount }} 项</span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>核查编号</th>
            <th>设备编号</th>
            <th>所属隐患点</th>
            <th>报修时间</th>
            <th>核查状态</th>
            <th>核查结论</th>
            <th>办结时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="todo in todos" :key="String(todo.id)">
            <td>{{ todo['核查编号'] }}</td>
            <td>{{ todo['设备编号'] }}</td>
            <td>{{ todo['所属隐患点'] }}</td>
            <td>{{ todo['报修时间'] }}</td>
            <td>{{ todo.status }}</td>
            <td>{{ todo['核查结论'] || '—' }}</td>
            <td>{{ todo['办结时间'] || '—' }}</td>
          </tr>
          <tr v-if="!todos.length">
            <td colspan="7" class="empty-state">暂无待维修核查项，报修设备后自动生成</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条监测设备记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  listRepairTodos,
  moduleMeta,
  runAction as applyAction,
  syncRepairTodos,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('device')
const columns = ["设备编号", "设备类型", "所属隐患点", "安装日期", "最近维护日", "电池余量", "通讯状态", "设备状态"]
const actions = ["报修设备", "确认修复", "停用设备"]
const statuses = ["正常运行", "信号异常", "低电量", "待维修", "已停用"]
const stats = [{"label": "设备总数", "value": 0}, {"label": "正常运行数", "value": 0}, {"label": "待维修数", "value": 0}]

const rows = ref<EntryRow[]>([])
const todos = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
// 台账与待办读同一份存储：未办结的排前面，刷新、返回、重进看到的都是同一结果。
const openCount = computed(
  () => todos.value.filter((todo) => String(todo.status) === '待核查').length,
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
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
  reloadTodos()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '监测设备列表读取失败'
  }
}

function reloadTodos() {
  const all = listRepairTodos()
  todos.value = [...all].sort((a, b) => Number(b.pending) - Number(a.pending) || Number(a.id) - Number(b.id))
}

onMounted(() => {
  // 先补建台账里漏掉的待维修核查项，再读列表，保证台账与待办一致。
  syncRepairTodos()
  reload()
  reloadTodos()
})
</script>
