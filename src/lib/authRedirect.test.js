import test from 'node:test'
import assert from 'node:assert/strict'

import { getEmailRedirectTo } from './authRedirect.js'

test('getEmailRedirectTo 优先使用显式配置的 app url，并去掉末尾斜杠', () => {
  const redirectTo = getEmailRedirectTo({
    configuredUrl: 'https://self-journal-kassia.vercel.app/',
    currentOrigin: 'http://localhost:5173',
  })

  assert.equal(redirectTo, 'https://self-journal-kassia.vercel.app')
})

test('getEmailRedirectTo 在无显式配置时回退到当前页面 origin', () => {
  const redirectTo = getEmailRedirectTo({
    currentOrigin: 'https://self-journal-kassia.vercel.app',
  })

  assert.equal(redirectTo, 'https://self-journal-kassia.vercel.app')
})

test('getEmailRedirectTo 在两者都没有时返回 undefined，交给上层决定是否传参', () => {
  const redirectTo = getEmailRedirectTo()

  assert.equal(redirectTo, undefined)
})
