import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeProviderSettings,
  mergeProviderSettings,
} from './storage.js'

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
