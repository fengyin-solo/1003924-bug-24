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
          <td v-for="column in columns" :key="column">{{ displayCell(column, row) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">详情</button>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无倾斜监测数据，可先登记倾斜记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条倾斜监测记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="detail" class="drawer-mask" @click.self="closeDetail">
      <aside class="drawer">
        <header class="drawer-head">
          <h3>倾斜记录详情 · {{ detail['记录编号'] }}</h3>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>
        <p class="drawer-sub">当前状态「{{ detail.status }}」 · 第 {{ detail['版本'] ?? 1 }} 版</p>

        <dl class="detail-grid">
          <template v-for="column in columns" :key="column">
            <dt>{{ column }}</dt>
            <dd>{{ displayCell(column, detail) }}</dd>
          </template>
        </dl>

        <h4 class="drawer-section">历史版本</h4>
        <table class="data-table">
          <thead>
            <tr>
              <th>版本</th>
              <th>动作</th>
              <th>结果状态</th>
              <th>校核人</th>
              <th>复测结论</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in historyOf(detail)" :key="entry.version">
              <td>第 {{ entry.version }} 版</td>
              <td>{{ entry.action }}</td>
              <td>{{ entry.status }}</td>
              <td>{{ entry.operator }}</td>
              <td>{{ entry.conclusion || '—' }}</td>
              <td>{{ entry.at }}</td>
            </tr>
            <tr v-if="!historyOf(detail).length">
              <td colspan="6" class="empty-state">暂无历史版本，校核或报警后在这里追加</td>
            </tr>
          </tbody>
        </table>

        <h4 class="drawer-section">校核登记</h4>
        <div class="verify-form">
          <label class="filter-item">
            <span>校核人</span>
            <input v-model="verifyForm.operator" placeholder="默认当前值班人" />
          </label>
          <label class="filter-item">
            <span>复测结论</span>
            <input v-model="verifyForm.conclusion" placeholder="确认校核前必填" />
          </label>
        </div>
        <div class="drawer-actions">
          <button
            v-for="action in actions"
            :key="action"
            class="btn"
            :class="{ primary: action === '确认校核' }"
            type="button"
            @click="runDetailAction(action)"
          >
            {{ action }}
          </button>
        </div>
        <p v-if="detailError" class="error-text">{{ detailError }}</p>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  getEntry,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, VersionEntry } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('tilt')
const session = useSessionStore()
const columns = ["记录编号", "测点编号", "观测方向", "倾斜角度", "变化量", "累积倾斜量", "观测人", "校核人", "复测结论", "记录状态"]
const actions = ["提交校核", "确认校核", "触发报警"]
const statuses = ["已观测", "待校核", "已校核", "超限报警", "需复测"]
const stats = [{"label": "本月观测数", "value": 0}, {"label": "超限报警数", "value": 0}, {"label": "待校核数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const detail = ref<EntryRow | null>(null)
const detailError = ref('')
const verifyForm = ref({ operator: session.operator, conclusion: '' })
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 旧记录可能没有观测方向：展示层统一按「未标注」显示，不回填数据。
function displayCell(column: string, row: EntryRow): string {
  const value = row[column]
  if (value === undefined || value === null || String(value) === '') {
    return column === '观测方向' ? '未标注' : '—'
  }
  return String(value)
}

function historyOf(row: EntryRow): VersionEntry[] {
  const history = row['历史版本']
  return Array.isArray(history) ? (history as VersionEntry[]) : []
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

function openDetail(row: EntryRow) {
  detailError.value = ''
  verifyForm.value = { operator: session.operator, conclusion: '' }
  detail.value = getEntry(meta.key, Number(row.id)) ?? null
}

function closeDetail() {
  detail.value = null
}

function refreshDetail() {
  if (detail.value) {
    detail.value = getEntry(meta.key, Number(detail.value.id)) ?? null
  }
}

function runAction(action: string, row: EntryRow) {
  // 确认校核要登记校核人与复测结论，统一进详情里走同一条保存链。
  if (action === '确认校核') {
    openDetail(row)
    return
  }
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, {
    expectedVersion: Number(row['版本'] ?? 1),
    operator: session.operator,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    reload()
    return
  }
  reload()
}

function runDetailAction(action: string) {
  if (!detail.value) {
    return
  }
  detailError.value = ''
  const result = applyAction(meta.key, Number(detail.value.id), action, {
    expectedVersion: Number(detail.value['版本'] ?? 1),
    operator: verifyForm.value.operator,
    conclusion: verifyForm.value.conclusion,
  })
  if (!result.ok) {
    detailError.value = result.message
    reload()
    refreshDetail()
    return
  }
  verifyForm.value = { ...verifyForm.value, conclusion: '' }
  reload()
  refreshDetail()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '倾斜监测列表读取失败'
  }
}

onMounted(reload)
</script>
