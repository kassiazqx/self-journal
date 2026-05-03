import test from 'node:test'
import assert from 'node:assert/strict'

import { getExistingUserStorageStatePath, getBootstrapUserStorageStatePath } from './auth.ts'

test('auth helper 返回两套固定 storageState 路径', () => {
  assert.match(getExistingUserStorageStatePath(), /playwright\/\.auth\/existing-user\.json$/)
  assert.match(getBootstrapUserStorageStatePath(), /playwright\/\.auth\/bootstrap-user\.json$/)
})
