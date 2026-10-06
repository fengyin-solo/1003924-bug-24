<template>
  <section class="page" data-module="tilt-detail">
    <header class="page-head">
      <div>
        <h2>倾斜记录详情</h2>
        <p class="page-desc">
          <RouterLink class="link" to="/tilt">返回倾斜监测列表</RouterLink>
          ｜记录 {{ view?.recordCode ?? '—' }}
        </p>
      </div>
    </header>

    <div v-if="!view" class="empty-state card-block">没有找到这条倾斜记录，请返回列表重新选择。</div>

    <template v-else>
      <article class="card-block detail-grid">
        <div class="detail-item"><span>记录编号</span><strong>{{ view.recordCode || '—' }}</strong></div>
        <div class="detail-item"><span>测点编号</span><strong>{{ view.pointCode || '—' }}</strong></div>
        <div class="detail-item"><span>观测方向</span><strong>{{ view.direction }}</strong></div>
        <div class="detail-item"><span>倾斜角度</span><strong>{{ view.angle }}</strong></div>
        <div class="detail-item"><span>变化量</span><strong>{{ view.delta }}</strong></div>
        <div class="detail-item"><span>累积倾斜量</span><strong>{{ view.cumulative }}</strong></div>
        <div class="detail-item"><span>观测人</span><strong>{{ view.observer }}</strong></div>
        <div class="detail-item"><span>校核人</span><strong>{{ view.reviewer }}</strong></div>
        <div class="detail-item"><span>复测结论</span><strong>{{ view.conclusion }}</strong></div>
        <div class="detail-item"><span>当前状态</span><strong>{{ view.status }}</strong></div>
      </article>

      <article class="card-block">
        <h3 class="block-title">确认校核</h3>
        <p v-if="!reviewable" class="block-tip">
          该记录当前为「{{ view.status }}」，校核通道已关闭；历史结论不可覆盖，只能在下方版本记录里追溯。
        </p>
        <form v-else class="review-form" @submit.prevent="submitReview">
          <label class="form-item">
            <span>校核人</span>
            <input v-model="form.reviewer" placeholder="填写校核人姓名" />
          </label>
          <label class="form-item">
            <span>复测结论</span>
            <select v-model="form.conclusion">
              <option value="" disabled>请选择复测结论</option>
              <option value="复测合格">复测合格</option>
              <option value="复测异常">复测异常</option>
              <option value="需复测">需复测</option>
            </select>
          </label>
          <label class="form-item">
            <span>观测方向</span>
            <input v-model="form.direction" placeholder="如：顺坡向 / 横向(EW)" />
          </label>
          <label class="form-item form-item-wide">
            <span>校核说明</span>
            <textarea v-model="form.note" rows="2" placeholder="现场校核情况说明（可选）"></textarea>
          </label>
          <div class="form-actions">
            <button
              v-if="view.status === '已观测'"
              class="btn"
              type="button"
              @click="submitForCheck"
            >
              提交校核
            </button>
            <button class="btn" type="button" @click="saveDraft">暂存草稿</button>
            <button class="btn primary" type="submit">确认校核（追加新版本）</button>
            <button
              v-if="canAlarm"
              class="btn"
              type="button"
              @click="raiseAlarm"
            >
              触发报警
            </button>
          </div>
        </form>
        <p v-if="draftHint" class="block-tip">{{ draftHint }}</p>
      </article>

      <article class="card-block">
        <h3 class="block-title">校核版本记录（只追加，不覆盖）</h3>
        <table v-if="view.history.length" class="data-table">
          <thead>
            <tr>
              <th>版本</th>
              <th>校核人</th>
              <th>复测结论</th>
              <th>观测方向</th>
              <th>校核说明</th>
              <th>保存时间</th>
              <th>落定状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in [...view.history].reverse()" :key="item.version">
              <td>v{{ item.version }}<span v-if="item.version === view.latestVersion?.version">（最新）</span></td>
              <td>{{ item.reviewer || '—' }}</td>
              <td>{{ item.conclusion || '—' }}</td>
              <td>{{ item.direction || unmarked }}</td>
              <td>{{ item.note || '—' }}</td>
              <td>{{ item.savedAt }}</td>
              <td>{{ item.recordStatus }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="block-tip">暂无校核版本，确认校核后会在这里追加第 1 版。</p>
      </article>

      <footer class="page-foot">
        <span v-if="message" :class="messageOk ? '' : 'error-text'">{{ message }}</span>
      </footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { useSessionStore } from '@/stores/session'
import {
  readTiltDraft,
  saveTiltDraft,
  submitTiltForCheck,
  submitTiltReview,
  triggerTiltAlarm,
} from '@/data/tilt-service'
import { getTiltView, UNMARKED_DIRECTION, type TiltViewRow } from '@/data/tilt-view'

const route = useRoute()
const session = useSessionStore()

const unmarked = UNMARKED_DIRECTION
const recordId = computed(() => Number(route.params.id))
const view = ref<TiltViewRow | null>(null)

const form = reactive({ reviewer: '', conclusion: '', direction: '', note: '' })
const message = ref('')
const messageOk = ref(true)
const draftHint = ref('')

const reviewable = computed(
  () => view.value !== null && ['已观测', '待校核'].includes(view.value.status),
)
const canAlarm = computed(
  () => view.value !== null && ['已观测', '待校核'].includes(view.value.status),
)

function notify(ok: boolean, text: string) {
  messageOk.value = ok
  message.value = text
}

/** 进入页面只回填「当前这条记录」自己的草稿或最新版本，旧记录不会把别的表单值带进来。 */
function hydrate() {
  view.value = getTiltView(recordId.value)
  draftHint.value = ''
  if (!view.value) return

  const draft = readTiltDraft(recordId.value)
  if (draft) {
    form.reviewer = draft.reviewer
    form.conclusion = draft.conclusion
    form.direction = draft.direction
    form.note = draft.note
    draftHint.value = `已回填本机暂存的草稿（${draft.savedAt} 保存），提交后草稿自动清除。`
    return
  }

  // 没草稿才用最新校核口径预填观测方向（旧记录缺方向留空，由用户补），
  // 校核人默认带当前值班人，结论必须重新选择，避免回显成上一条记录的旧值。
  const latest = view.value.latestVersion
  form.reviewer = latest?.reviewer || session.operator
  form.conclusion = ''
  form.direction = latest?.direction || (view.value.direction === UNMARKED_DIRECTION ? '' : view.value.direction)
  form.note = latest?.note || ''
}

function saveDraft() {
  const result = saveTiltDraft(recordId.value, { ...form })
  notify(result.ok, result.message)
}

function submitReview() {
  const result = submitTiltReview(recordId.value, { ...form })
  if (!result.ok) {
    notify(false, result.message)
    return
  }
  hydrate()
  notify(true, result.message)
}

function raiseAlarm() {
  const result = triggerTiltAlarm(recordId.value)
  if (!result.ok) {
    notify(false, result.message)
    return
  }
  hydrate()
  notify(true, result.message)
}

function submitForCheck() {
  const result = submitTiltForCheck(recordId.value)
  notify(result.ok, result.message)
  if (result.ok) hydrate()
}

watch(recordId, hydrate)
onMounted(hydrate)
</script>
