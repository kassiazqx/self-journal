import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_CONTENT_CATEGORIES,
  DEFAULT_CORE_NEEDS,
  DEFAULT_CONTACTS,
  createDefaultCategoryRows,
  createDefaultCoreNeedRows,
  createDefaultContactRows,
} from './defaultUserData.js'

test('createDefaultCategoryRows 生成 content_category 行和递增 sort_order', () => {
  const rows = createDefaultCategoryRows('u1')

  assert.equal(rows.length, DEFAULT_CONTENT_CATEGORIES.length)
  assert.equal(rows[0].user_id, 'u1')
  assert.equal(rows[0].field_name, 'content_category')
  assert.equal(rows[0].sort_order, 0)
  assert.equal(rows.at(-1).sort_order, rows.length - 1)
})

test('createDefaultCoreNeedRows 生成 core_need 行和递增 sort_order', () => {
  const rows = createDefaultCoreNeedRows('u1')

  assert.equal(rows.length, DEFAULT_CORE_NEEDS.length)
  assert.equal(rows[0].field_name, 'core_need')
  assert.equal(rows[0].option_value, DEFAULT_CORE_NEEDS[0])
})

test('createDefaultContactRows 保留 canonical aliases group_name 和 sort_order', () => {
  const rows = createDefaultContactRows('u1')

  assert.equal(rows.length, DEFAULT_CONTACTS.length)
  assert.equal(rows[0].user_id, 'u1')
  assert.equal(typeof rows[0].canonical, 'string')
  assert.ok(Array.isArray(rows[0].aliases))
  assert.equal(rows[0].sort_order, 0)
})
