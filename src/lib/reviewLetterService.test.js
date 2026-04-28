import test from 'node:test'
import assert from 'node:assert/strict'

import { getUserLetterPrefs, saveUserLetterPrefs } from './reviewLetterService.js'

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

test('saveUserLetterPrefs 写入 local fallback 时会规范化数据', async () => {
  global.localStorage = createFakeStorage()

  await saveUserLetterPrefs('u1', { type: 'days', count_threshold: 7 }, async () => {})

  const raw = JSON.parse(global.localStorage.getItem('letter_prefs_u1'))

  assert.equal(raw.type, 'count')
  assert.equal(raw.count_threshold, 7)
})

test('getUserLetterPrefs 从 local fallback 读取旧 days 值时会回退为 count', async () => {
  global.localStorage = createFakeStorage()
  global.localStorage.setItem('letter_prefs_u1', JSON.stringify({ type: 'days', count_threshold: 10 }))

  const prefs = await getUserLetterPrefs('u1')

  assert.equal(prefs.type, 'count')
  assert.equal(prefs.count_threshold, 10)
})
