import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_USER_DATA_SEED_VERSION,
  shouldSeedDefaultUserData,
  getMissingDefaultUserDataKinds,
  ensureDefaultUserData,
} from './defaultUserBootstrap.js'

test('shouldSeedDefaultUserData 只对真正全空的新用户返回 true', () => {
  assert.equal(shouldSeedDefaultUserData({
    entryCount: 0,
    categoryCount: 0,
    coreNeedCount: 0,
    contactCount: 0,
  }), true)

  assert.equal(shouldSeedDefaultUserData({
    entryCount: 1,
    categoryCount: 0,
    coreNeedCount: 0,
    contactCount: 0,
  }), false)
})

test('getMissingDefaultUserDataKinds 返回缺失集合', () => {
  assert.deepEqual(getMissingDefaultUserDataKinds({
    categoryCount: 11,
    coreNeedCount: 0,
    contactCount: 0,
  }), ['core_need', 'user_contacts'])
})

test('ensureDefaultUserData 对 brand-new user 执行插入并写 seed version', async () => {
  const calls = []
  let savedVersion = 0

  const result = await ensureDefaultUserData('u1', {
    getVersion: () => 0,
    saveVersion: (_scopeId, version) => { savedVersion = version },
    fetchState: async () => ({
      entryCount: 0,
      categoryCount: 0,
      coreNeedCount: 0,
      contactCount: 0,
    }),
    insertRows: async () => { calls.push('insert') },
  })

  assert.equal(result.status, 'seeded')
  assert.deepEqual(calls, ['insert'])
  assert.equal(savedVersion, DEFAULT_USER_DATA_SEED_VERSION)
})

test('ensureDefaultUserData marker 丢失但默认数据已存在时不重复插入', async () => {
  const calls = []
  let savedVersion = 0

  const result = await ensureDefaultUserData('u1', {
    getVersion: () => 0,
    saveVersion: (_scopeId, version) => { savedVersion = version },
    fetchState: async () => ({
      entryCount: 0,
      categoryCount: 11,
      coreNeedCount: 20,
      contactCount: 22,
    }),
    insertRows: async () => { calls.push('insert') },
  })

  assert.equal(result.status, 'already-present')
  assert.deepEqual(calls, [])
  assert.equal(savedVersion, DEFAULT_USER_DATA_SEED_VERSION)
})

test('ensureDefaultUserData 对过渡期只写了默认分类的新用户补齐缺失集合', async () => {
  const calls = []
  let savedVersion = 0

  const result = await ensureDefaultUserData('u1', {
    getVersion: () => 0,
    saveVersion: (_scopeId, version) => { savedVersion = version },
    fetchState: async () => ({
      entryCount: 0,
      categoryCount: 11,
      coreNeedCount: 0,
      contactCount: 0,
    }),
    insertRows: async (_userId, missingKinds) => { calls.push(missingKinds) },
  })

  assert.equal(result.status, 'seeded-missing')
  assert.deepEqual(calls, [['core_need', 'user_contacts']])
  assert.equal(savedVersion, DEFAULT_USER_DATA_SEED_VERSION)
})

test('ensureDefaultUserData 对 legacy user 只写 marker 不补默认值', async () => {
  const calls = []
  let savedVersion = 0

  const result = await ensureDefaultUserData('u1', {
    getVersion: () => 0,
    saveVersion: (_scopeId, version) => { savedVersion = version },
    fetchState: async () => ({
      entryCount: 2,
      categoryCount: 0,
      coreNeedCount: 0,
      contactCount: 0,
    }),
    insertRows: async () => { calls.push('insert') },
  })

  assert.equal(result.status, 'marked-legacy')
  assert.deepEqual(calls, [])
  assert.equal(savedVersion, DEFAULT_USER_DATA_SEED_VERSION)
})
