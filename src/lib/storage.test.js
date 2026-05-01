import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeProviderSettings,
  mergeProviderSettings,
  getDefaultUserDataSeedVersion,
  saveDefaultUserDataSeedVersion,
} from './storage.js'

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

test('mergeProviderSettings 保留其他 provider 的 key', () => {
  const prev = {
    provider: 'gemini',
    providers: {
      gemini: { apiKey: 'g-1' },
      deepseek: { apiKey: 'd-1' },
    },
  }

  const next = mergeProviderSettings(prev, 'deepseek', 'd-2')

  assert.equal(next.provider, 'deepseek')
  assert.equal(next.providers.gemini.apiKey, 'g-1')
  assert.equal(next.providers.deepseek.apiKey, 'd-2')
})

test('normalizeProviderSettings 兼容旧结构', () => {
  const next = normalizeProviderSettings({ provider: 'gemini', apiKey: 'legacy-key' })

  assert.equal(next.provider, 'gemini')
  assert.equal(next.providers.gemini.apiKey, 'legacy-key')
  assert.equal(next.providers.deepseek.apiKey, '')
})

test('getDefaultUserDataSeedVersion 空存储时返回 0', () => {
  globalThis.localStorage = createFakeStorage()
  assert.equal(getDefaultUserDataSeedVersion('u1'), 0)
})

test('saveDefaultUserDataSeedVersion 写入后可读回 version', () => {
  globalThis.localStorage = createFakeStorage()

  saveDefaultUserDataSeedVersion('u1', 3)

  assert.equal(getDefaultUserDataSeedVersion('u1'), 3)
})
