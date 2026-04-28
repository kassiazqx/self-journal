import test from 'node:test'
import assert from 'node:assert/strict'

import { getLetterPrefs, saveLetterPrefs } from './letterPrefsStorage.js'

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

test('getLetterPrefs 无存储时返回默认值', () => {
  global.localStorage = createFakeStorage()

  const prefs = getLetterPrefs('u1')

  assert.deepEqual(prefs, {
    type: 'count',
    count_threshold: 10,
    require_new_entries: true,
  })
})

test('saveLetterPrefs 写入本地时会规范化旧 days 值', () => {
  global.localStorage = createFakeStorage()

  saveLetterPrefs('u1', { type: 'days', count_threshold: 7 })

  const raw = JSON.parse(global.localStorage.getItem('letter_prefs_u1'))

  assert.equal(raw.type, 'count')
  assert.equal(raw.count_threshold, 7)
})

test('saveLetterPrefs 写入后可重新读取', () => {
  global.localStorage = createFakeStorage()

  saveLetterPrefs('u1', { type: 'manual', count_threshold: 12, require_new_entries: false })
  const prefs = getLetterPrefs('u1')

  assert.deepEqual(prefs, {
    type: 'manual',
    count_threshold: 12,
    require_new_entries: false,
  })
})

test('getLetterPrefs 从本地读取旧 days 值时会回退为 count', () => {
  global.localStorage = createFakeStorage()
  global.localStorage.setItem('letter_prefs_u1', JSON.stringify({ type: 'days', count_threshold: 10 }))

  const prefs = getLetterPrefs('u1')

  assert.equal(prefs.type, 'count')
  assert.equal(prefs.count_threshold, 10)
})

test('getLetterPrefs 遇到坏 JSON 时返回默认值并清理脏数据', () => {
  global.localStorage = createFakeStorage()
  global.localStorage.setItem('letter_prefs_u1', '{bad json')

  const prefs = getLetterPrefs('u1')

  assert.equal(prefs.type, 'count')
  assert.equal(global.localStorage.getItem('letter_prefs_u1'), null)
})
