import test from 'node:test'
import assert from 'node:assert/strict'

import {
  serializeDraftSnapshot,
  saveDraftSnapshot,
  loadDraftSnapshot,
  clearDraftSnapshot,
} from './draftStorage.js'

function createFakeStorage() {
  const store = new Map()
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, value)
    },
    removeItem(key) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
  }
}

test('serializeDraftSnapshot 保留正文/模板/时间/人物 dismiss 信息', () => {
  const serialized = serializeDraftSnapshot({
    content: 'hello',
    template: 'awareness',
    selectedDatetime: '2026-04-28T08:00:00.000Z',
    manualOverride: true,
    dismissedPeople: new Set(['张三']),
  })

  assert.equal(serialized.content, 'hello')
  assert.equal(serialized.template, 'awareness')
  assert.equal(serialized.manualOverride, true)
  assert.deepEqual(serialized.dismissedPeople, ['张三'])
})

test('loadDraftSnapshot 遇到坏 JSON 时返回 null 并清掉脏数据', () => {
  globalThis.localStorage = createFakeStorage()
  globalThis.localStorage.setItem('journal_draft_v2', '{bad json')

  const loaded = loadDraftSnapshot()

  assert.equal(loaded, null)
  assert.equal(globalThis.localStorage.getItem('journal_draft_v2'), null)
})

test('loadDraftSnapshot 遇到只有空格和换行的草稿时返回 null 并清掉脏数据', () => {
  globalThis.localStorage = createFakeStorage()
  globalThis.localStorage.setItem('journal_draft_v2', JSON.stringify({
    content: '  \n   ',
    savedAt: new Date().toISOString(),
  }))

  const loaded = loadDraftSnapshot()

  assert.equal(loaded, null)
  assert.equal(globalThis.localStorage.getItem('journal_draft_v2'), null)
})

test('loadDraftSnapshot 遇到存储 API 抛错时返回 null 不再二次抛错', () => {
  globalThis.localStorage = {
    getItem() {
      throw new Error('deny')
    },
    removeItem() {
      throw new Error('deny remove')
    },
  }

  assert.equal(loadDraftSnapshot(), null)
})

test('saveDraftSnapshot 写入后可按正确类型读回', () => {
  globalThis.localStorage = createFakeStorage()

  saveDraftSnapshot({
    content: 'hello',
    template: 'awareness',
    selectedDatetime: new Date('2026-04-28T08:00:00.000Z'),
    manualOverride: true,
    dismissedPeople: new Set(['张三']),
  })

  const loaded = loadDraftSnapshot()

  assert.equal(loaded.content, 'hello')
  assert.equal(loaded.template, 'awareness')
  assert.equal(loaded.manualOverride, true)
  assert.ok(loaded.selectedDatetime instanceof Date)
  assert.deepEqual([...loaded.dismissedPeople], ['张三'])
})

test('loadDraftSnapshot 超过 24 小时仍保留草稿正文', () => {
  globalThis.localStorage = createFakeStorage()
  globalThis.localStorage.setItem('journal_draft_v2', JSON.stringify({
    content: 'old draft',
    savedAt: '2026-04-26T08:00:00.000Z',
  }))

  const realNow = Date.now
  Date.now = () => new Date('2026-04-28T09:00:00.000Z').getTime()

  try {
    const loaded = loadDraftSnapshot()
    assert.equal(loaded.content, 'old draft')
  } finally {
    Date.now = realNow
  }
})

test('loadDraftSnapshot 遇到坏 savedAt 时保留正文', () => {
  globalThis.localStorage = createFakeStorage()
  globalThis.localStorage.setItem('journal_draft_v2', JSON.stringify({
    content: 'draft',
    savedAt: 'bad-date',
    template: 'awareness',
  }))

  const loaded = loadDraftSnapshot()

  assert.equal(loaded.content, 'draft')
  assert.equal(loaded.template, 'awareness')
})

test('loadDraftSnapshot 遇到坏 selectedDatetime 时只丢时间不丢正文', () => {
  globalThis.localStorage = createFakeStorage()
  globalThis.localStorage.setItem('journal_draft_v2', JSON.stringify({
    content: 'draft',
    savedAt: new Date().toISOString(),
    selectedDatetime: 'bad-date',
    manualOverride: true,
  }))

  const loaded = loadDraftSnapshot()

  assert.equal(loaded.content, 'draft')
  assert.equal(loaded.selectedDatetime, null)
  assert.equal(loaded.manualOverride, false)
})

test('clearDraftSnapshot 会删除草稿', () => {
  globalThis.localStorage = createFakeStorage()
  globalThis.localStorage.setItem('journal_draft_v2', JSON.stringify({ content: 'hello' }))

  clearDraftSnapshot()

  assert.equal(globalThis.localStorage.getItem('journal_draft_v2'), null)
})
