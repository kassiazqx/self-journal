import test from 'node:test'
import assert from 'node:assert/strict'

import { buildResetPlan } from './reset-fixtures.mjs'
import { getRequiredEnv, assertAllowedUserId } from './e2e-contract.mjs'

function createEnv() {
  return {
    E2E_SUPABASE_URL: 'https://example.supabase.co',
    E2E_SUPABASE_ANON_KEY: 'anon',
    E2E_SUPABASE_SERVICE_ROLE_KEY: 'service',
    E2E_EXISTING_USER_EMAIL: 'existing@example.com',
    E2E_EXISTING_USER_PASSWORD: 'pw-existing',
    E2E_BOOTSTRAP_USER_EMAIL: 'bootstrap@example.com',
    E2E_BOOTSTRAP_USER_PASSWORD: 'pw-bootstrap',
    E2E_EXISTING_USER_ID: 'u-existing',
    E2E_BOOTSTRAP_USER_ID: 'u-bootstrap',
  }
}

test('getRequiredEnv 返回两类账号与 key 契约', () => {
  const envConfig = getRequiredEnv(createEnv())

  assert.equal(envConfig.existingUser.email, 'existing@example.com')
  assert.equal(envConfig.bootstrapUser.id, 'u-bootstrap')
  assert.equal(envConfig.supabaseServiceRoleKey, 'service')
})

test('assertAllowedUserId 仅允许白名单用户', () => {
  const envConfig = getRequiredEnv(createEnv())

  assert.doesNotThrow(() => assertAllowedUserId('u-existing', envConfig))
  assert.throws(() => assertAllowedUserId('someone-else', envConfig), /非白名单/)
})

test('buildResetPlan 连续调用结果一致', () => {
  const envConfig = getRequiredEnv(createEnv())

  const first = buildResetPlan(envConfig)
  const second = buildResetPlan(envConfig)

  assert.deepEqual(second, first)
  assert.equal(first.existingUser.baselineEntry.user_id, 'u-existing')
  assert.equal(first.bootstrapUser.userId, 'u-bootstrap')
})
