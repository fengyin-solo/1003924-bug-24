<template>
  <section class="page" data-module="tilt">
    <header class="page-head">
      <div>
        <h2>倾斜监测管理</h2>
        <p class="page-desc">维护倾斜记录，围绕记录编号、测点编号、观测方向、倾斜角度做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记倾斜记录</button>
        <button class="btn" type="button" @click="exportRows">导出倾斜监测清单</button>
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
      <label v-for="field in filterFields" :key="field.key" class="filter-item">
        <span>{{ field.label }}</span>
        <input v-model="filters[field.key]" :placeholder="`按${field.label}检索`" />
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
        <tr v-for="row in rows" :key="row.id">
          <td>
            <RouterLink class="link" :to="`/tilt/${row.id}`">{{ row.recordCode || '—' }}</RouterLink>
          </td>
          <td>{{ row.pointCode || '—' }}</td>
          <td>{{ row.direction }}</td>
          <td>{{ row.angle }}</td>
          <td>{{ row.delta }}</td>
          <td>{{ row.cumulative }}</td>
          <td>{{ row.observer }}</td>
          <td>{{ row.reviewer }}</td>
          <td>{{ row.conclusion }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-if="row.status === '已观测'"
              class="link"
              type="button"
              @click="runAction('提交校核', row)"
            >
              提交校核
            </button>
            <RouterLink class="link" :to="`/tilt/${row.id}`">查看详情</RouterLink>
            <button
              v-if="canAlarm(row.status)"
              class="link"
              type="button"
              @click="runAction('触发报警', row)"
            >
              触发报警
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无倾斜监测数据，可先登记倾斜记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条倾斜监测记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, moduleMeta } from '@/api/local-service'
import {
  submitTiltForCheck,
  triggerTiltAlarm,
} from '@/data/tilt-service'
import { listTiltViews, type TiltViewRow } from '@/data/tilt-view'

const meta = moduleMeta('tilt')
// 校核人 / 复测结论与详情、设备页同口径，直接由统一读模型带出。
const columns = ['记录编号', '测点编号', '观测方向', '倾斜角度', '变化量', '累积倾斜量', '观测人', '校核人', '复测结论']
const stats = computed(() => [
  { label: '本月观测数', value: rows.value.length },
  { label: '超限报警数', value: rows.value.filter((r) => r.status === '超限报警').length },
  { label: '待校核数', value: rows.value.filter((r) => r.status === '待校核').length },
])
const filterFields = [
  { key: 'recordCode', label: '记录编号' },
  { key: 'pointCode', label: '测点编号' },
  { key: 'direction', label: '观测方向' },
] as const

const rows = ref<TiltViewRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

const statuses = ['已观测', '待校核', '已校核', '超限报警', '需复测']
const statusSummary = ref(statuses.map((status) => ({ status, count: 0 })))

function canAlarm(status: string): boolean {
  return ['已观测', '待校核'].includes(status)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '倾斜记录登记入口尚未接入审批流'
}

function runAction(action: string, row: TiltViewRow) {
  errorMessage.value = ''
  let result
  if (action === '提交校核') {
    result = submitTiltForCheck(row.id)
  } else if (action === '触发报警') {
    result = triggerTiltAlarm(row.id)
  } else {
    result = { ok: false, message: '未知动作' }
  }
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function applyFilter(list: TiltViewRow[]): TiltViewRow[] {
  const pairs = Object.entries(filters.value).filter(([, value]) => value.trim() !== '')
  if (!pairs.length) return list
  return list.filter((row) =>
    pairs.every(([key, value]) =>
      String(row[key as keyof TiltViewRow] ?? '').includes(value.trim()),
    ),
  )
}

function reload() {
  errorMessage.value = ''
  try {
    const matched = applyFilter(listTiltViews())
    rows.value = matched
    total.value = matched.length
    statusSummary.value = statuses.map((status) => ({
      status,
      count: rows.value.filter((row) => row.status === status).length,
    }))
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '倾斜监测列表读取失败'
  }
}

onMounted(reload)
</script>
